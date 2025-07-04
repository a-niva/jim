// ===== frontend/stats-charts.js - GESTION DES GRAPHIQUES STATS =====

// Import des couleurs musculaires
// Utiliser les fonctions depuis window car muscle-colors.js les expose globalement
const getMuscleColor = (muscle) => window.MuscleColors?.getMuscleColor?.(muscle) || '#94a3b8';
const getMuscleBackground = (muscle, opacity) => window.MuscleColors?.getMuscleBackground?.(muscle, opacity) || `rgba(148, 163, 184, ${opacity || 0.15})`;
const getChartColors = () => window.MuscleColors?.getChartColors;

// Variables globales pour les charts
let charts = {
    progression: null,
    timeDistribution: null,
    volumeBurndown: null,
    muscleBalance: null,
    mlConfidence: null
};

// Période actuelle pour le burndown
let currentBurndownPeriod = 'week';

// Référence à l'utilisateur courant
let currentUser = null;

// ===== INITIALISATION =====
// Helper pour accès sécurisé aux couleurs musculaires
function getSafeMuscleColor(muscle) {
    if (!window.MuscleColors || !window.MuscleColors.getMuscleColor) {
        console.warn('MuscleColors module not loaded, using default color');
        return '#94a3b8';
    }
    return window.MuscleColors.getMuscleColor(muscle) || '#94a3b8';
}

export async function initStatsCharts(userId, user) {
    if (!userId) return;
    
    // Stocker la référence à l'utilisateur
    currentUser = user || window.currentUser;
    
    // Vérifier s'il y a des données
    const hasData = await checkUserHasData(userId);
    if (!hasData) {
        document.getElementById('statsEmptyState').style.display = 'block';
        document.querySelector('.charts-tabs').style.display = 'none';
        return;
    }
    
    document.getElementById('statsEmptyState').style.display = 'none';
    document.querySelector('.charts-tabs').style.display = 'block';
    
    // Charger la liste des exercices
    await loadExercisesList(userId);
    
    // Initialiser les event listeners
    initStatsEventListeners();
    
    // Charger les graphiques de l'onglet actif
    loadActiveTabCharts(userId);
}

// ===== EVENT LISTENERS =====
function initStatsEventListeners() {
    // Tabs navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });
    
    // Sélecteur d'exercice
    document.getElementById('exerciseSelector').addEventListener('change', (e) => {
        if (e.target.value) {
            loadProgressionChart(currentUser.id, e.target.value);
        }
    });
    
    // Boutons de période
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentBurndownPeriod = e.target.dataset.period;
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            loadVolumeBurndownChart(currentUser.id, currentBurndownPeriod);
        });
    });
}

// ===== GESTION DES TABS =====
function switchTab(tabName) {
    // Mettre à jour les boutons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Mettre à jour le contenu
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
    
    // Charger les graphiques du nouvel onglet
    loadTabCharts(currentUser.id, tabName);
}

function loadActiveTabCharts(userId) {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    loadTabCharts(userId, activeTab);
}

async function loadTabCharts(userId, tabName) {
    switch (tabName) {
        case 'performance':
            await Promise.all([
                loadRecordsWaterfall(userId),
                loadTimeDistributionChart(userId)
            ]);
            // Charger la progression si un exercice est sélectionné
            const selectedExercise = document.getElementById('exerciseSelector').value;
            if (selectedExercise) {
                loadProgressionChart(userId, selectedExercise);
            }
            break;
            
        case 'adherence':
            await Promise.all([
                loadAttendanceCalendar(userId),
                loadVolumeBurndownChart(userId, currentBurndownPeriod)
            ]);
            break;
            
        case 'muscles':
            await Promise.all([
                loadMuscleSunburst(userId),
                loadRecoveryGantt(userId),
                loadMuscleBalanceChart(userId)
            ]);
            break;
            
        case 'analytics':
            await Promise.all([
                loadMLConfidenceChart(userId),
                loadMLSankeyDiagram(userId)
            ]);
            break;
    }
}

// ===== HELPERS =====
async function checkUserHasData(userId) {
    try {
        const stats = await window.apiGet(`/api/users/${userId}/stats`);
        return stats.total_workouts > 0;
    } catch (error) {
        console.error('Erreur vérification données:', error);
        return false;
    }
}

async function loadExercisesList(userId) {
    try {
        const records = await window.apiGet(`/api/users/${userId}/stats/personal-records`);
        const selector = document.getElementById('exerciseSelector');
        
        selector.innerHTML = '<option value="">Sélectionner un exercice...</option>';
        
        if (records.length === 0) return;
        
        // Extraire et dédupliquer les exercices, puis trier alphabétiquement
        const uniqueExercises = [...new Map(records.map(r => [r.exercise, r])).values()]
            .sort((a, b) => a.exercise.localeCompare(b.exercise));
        
        uniqueExercises.forEach(record => {
            const option = document.createElement('option');
            option.value = record.exerciseId;
            
            // Créer les pastilles de couleur pour les muscle_groups
            const colorDots = record.muscleGroups.map(muscle => {
                const color = getSafeMuscleColor(muscle);
                return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-left:4px;"></span>`;
            }).join('');
            
            option.innerHTML = `${record.exercise}${colorDots}`;
            selector.appendChild(option);
        });
    } catch (error) {
        console.error('Erreur chargement exercices:', error);
    }
}

// ===== GRAPHIQUE 1: PROGRESSION 1RM =====
// ===== GRAPHIQUE 1: PROGRESSION 1RM =====
async function loadProgressionChart(userId, exerciseId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/progression/${exerciseId}`);
        
        if (!data.data || data.data.length === 0) {
            document.getElementById('progressionInfo').innerHTML = 
                '<p class="text-muted">Pas assez de données pour cet exercice</p>';
            return;
        }
        
        const ctx = document.getElementById('progressionChart').getContext('2d');
        
        // Détruire le chart existant
        if (charts.progression) {
            charts.progression.destroy();
        }
        
        // Adapter l'affichage selon le type de métrique
        const labels = data.data.map(d => new Date(d.date).toLocaleDateString());
        const values = data.data.map(d => d.value);
        const fatigueData = data.data.map(d => d.fatigue);
        
        // Configuration adaptative
        let chartConfig = {
            label: '',
            yAxisTitle: '',
            tooltipCallback: null,
            color: '#3b82f6'
        };
        
        switch (data.metric_name) {
            case 'duration':
                chartConfig.label = 'Durée maximale';
                chartConfig.yAxisTitle = 'Secondes';
                chartConfig.color = '#10b981'; // Vert pour la durée
                chartConfig.tooltipCallback = (value) => `${value}s`;
                break;
                
            case 'reps':
                chartConfig.label = 'Répétitions maximales';
                chartConfig.yAxisTitle = 'Répétitions';
                chartConfig.color = '#f59e0b'; // Orange pour les reps
                chartConfig.tooltipCallback = (value) => `${value} reps`;
                break;
                
            case '1rm':
                chartConfig.label = '1RM Estimé';
                chartConfig.yAxisTitle = 'Poids (kg)';
                chartConfig.color = '#3b82f6'; // Bleu pour le poids
                chartConfig.tooltipCallback = (value, context) => {
                    const point = data.data[context.dataIndex];
                    return [`${value}kg`, `${point.weight}kg × ${point.reps} reps`];
                };
                break;
        }
        
        // Créer les gradients
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        const baseColor = chartConfig.color;
        gradient.addColorStop(0, `${baseColor}66`); // 40% opacity
        gradient.addColorStop(0.5, `${baseColor}33`); // 20% opacity
        gradient.addColorStop(1, `${baseColor}0D`); // 5% opacity
        
        // Calculer la ligne de tendance
        let trendData = [];
        if (data.trend) {
            for (let i = 0; i < data.data.length; i++) {
                trendData.push(data.trend.intercept + data.trend.slope * i);
            }
        }
        
        charts.progression = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: chartConfig.label,
                    data: values,
                    borderColor: chartConfig.color,
                    backgroundColor: gradient,
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: chartConfig.color,
                    pointBorderWidth: 2
                }, {
                    label: 'Tendance',
                    data: trendData,
                    borderColor: chartConfig.color,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                }, {
                    label: 'Fatigue',
                    data: fatigueData,
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    yAxisID: 'y1',
                    pointRadius: 4,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: chartConfig.yAxisTitle,
                            color: chartConfig.color,
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        ticks: {
                            color: chartConfig.color,
                            callback: function(value) {
                                if (data.metric_name === 'duration') {
                                    return value + 's';
                                } else if (data.metric_name === 'reps') {
                                    return value;
                                } else {
                                    return value + 'kg';
                                }
                            }
                        }
                    },
                    y1: {
                        position: 'right',
                        beginAtZero: true,
                        max: 5,
                        title: {
                            display: true,
                            text: 'Fatigue',
                            color: '#ef4444',
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            color: '#ef4444',
                            stepSize: 1
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (context.datasetIndex === 0) {
                                    if (data.metric_name === '1rm' && typeof chartConfig.tooltipCallback === 'function') {
                                        const result = chartConfig.tooltipCallback(
                                            context.parsed.y, 
                                            context
                                        );
                                        return Array.isArray(result) ? result : [result];
                                    } else {
                                        return context.dataset.label + ': ' + context.parsed.y + (
                                            data.metric_name === 'duration' ? 's' :
                                            data.metric_name === 'reps' ? ' reps' :
                                            'kg'
                                        );
                                    }
                                } else if (context.datasetIndex === 2) {
                                    return 'Fatigue: ' + context.parsed.y + '/5';
                                }
                                return context.dataset.label + ': ' + context.parsed.y;
                            }
                        }
                    }
                }
            }
        });
        
        // Afficher les infos de progression adaptées
        if (data.trend) {
            const progressionIcon = data.trend.progression_percent > 0 ? '📈' : '📉';
            const progressionText = `${progressionIcon} ${Math.abs(data.trend.progression_percent)}% `;
            
            let unitText = '';
            switch (data.metric_name) {
                case 'duration':
                    unitText = `Moyenne: ${Math.round(data.trend.average_value)}s`;
                    break;
                case 'reps':
                    unitText = `Moyenne: ${Math.round(data.trend.average_value)} reps`;
                    break;
                case '1rm':
                    unitText = `Progression de force`;
                    break;
            }
            
            document.getElementById('progressionInfo').innerHTML = `
                <div class="progression-summary">
                    <p>${progressionText} ${unitText}</p>
                    <p class="text-muted">Sur les ${data.data.length} dernières séances</p>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Erreur chargement progression:', error);
        document.getElementById('progressionInfo').innerHTML = 
            '<p class="text-muted">Erreur lors du chargement des données</p>';
    }
}

// ===== GRAPHIQUE 4: RECORDS PERSONNELS =====
async function loadRecordsWaterfall(userId) {
    try {
        const records = await window.apiGet(`/api/users/${userId}/stats/personal-records`);
        
        const container = document.getElementById('recordsWaterfall');
        if (!records || records.length === 0) {
            container.innerHTML = '<p class="text-muted">Aucun record enregistré</p>';
            return;
        }
        
        // Créer le waterfall
        container.innerHTML = records.slice(0, 10).map((record, index) => {
            const muscleColor = getSafeMuscleColor(record.muscleGroups[0] || 'default');
            const fatigueEmoji = ['💪', '😊', '😐', '😓', '😵'][record.fatigue - 1] || '😐';
            
            return `
                <div class="waterfall-item" style="animation-delay: ${index * 0.1}s">
                    <div class="waterfall-rank">#${index + 1}</div>
                    <div class="waterfall-content" style="border-left-color: ${muscleColor}">
                        <div class="waterfall-header">
                            <h4>${record.exercise}</h4>
                            <span class="waterfall-weight">${record.weight}kg</span>
                        </div>
                        <div class="waterfall-details">
                            <span>${record.reps} reps</span>
                            <span>${fatigueEmoji} Fatigue: ${record.fatigue}/5</span>
                            <span>📅 Il y a ${record.daysAgo}j</span>
                        </div>
                            <div class="waterfall-muscles">
                                ${record.muscleGroups.map(muscle => 
                                    `<span class="muscle-tag" style="background-color: ${getSafeMuscleColor(muscle)}">${muscle}</span>`
                                ).join('')}
                            </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Erreur chargement records:', error);
    }
}

// ===== GRAPHIQUE 5: CALENDRIER D'ASSIDUITÉ =====
async function loadAttendanceCalendar(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/attendance-calendar`);
        
        const container = document.getElementById('attendanceCalendar');
        container.innerHTML = '';
        
        // Créer le calendrier type GitHub
        const today = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6);
        
        // Créer la grille
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        
        // Headers des mois
        const monthsRow = document.createElement('div');
        monthsRow.className = 'calendar-months';

        // Cellules du calendrier
        const cellsContainer = document.createElement('div');
        cellsContainer.className = 'calendar-cells';

        // Obtenir la date de création du profil
        const userCreatedDate = new Date(currentUser.created_at);

        let currentMonth = -1;
        let monthStart = 0;

        for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
            // Ne pas afficher les dates avant la création du profil
            if (d < userCreatedDate) continue;
            
            const dateStr = d.toISOString().split('T')[0];
            const dayData = data.calendar[dateStr] || { workouts: 0, volume: 0 };
            
            // Ajouter le header du mois si nécessaire
            if (d.getMonth() !== currentMonth) {
                if (currentMonth !== -1) {
                    const monthLabel = document.createElement('div');
                    monthLabel.className = 'month-label';
                    monthLabel.style.gridColumn = `${monthStart + 1} / span ${d.getDate()}`;
                    monthLabel.textContent = new Date(d.getFullYear(), currentMonth).toLocaleDateString('fr-FR', { month: 'short' });
                    monthsRow.appendChild(monthLabel);
                }
                currentMonth = d.getMonth();
                monthStart = Math.floor((d - startDate) / (1000 * 60 * 60 * 24));
            }
            
            // Créer la cellule
            const cell = document.createElement('div');
            cell.className = 'calendar-cell';
            cell.dataset.date = dateStr;
            cell.dataset.workouts = dayData.workouts;
            cell.dataset.volume = dayData.volume;
            
            // Coloration selon l'intensité
            if (dayData.workouts === 0) {
                cell.classList.add('empty');
            } else if (dayData.volume > 5000) {
                cell.classList.add('high');
            } else if (dayData.volume > 2500) {
                cell.classList.add('medium');
            } else {
                cell.classList.add('low');
            }
            
            // Tooltip
            cell.title = `${d.toLocaleDateString('fr-FR')}\n${dayData.workouts} séance(s)\n${Math.round(dayData.volume)}kg de volume`;
            
            cellsContainer.appendChild(cell);
        }
        
        container.appendChild(monthsRow);
        container.appendChild(cellsContainer);
        
        // Analyser les semaines avec séances manquées
        const weeksAnalysis = data.weeksAnalysis.filter(w => w.missed > 0 && new Date(w.weekStart) < today);
        if (weeksAnalysis.length > 0) {
            const missedInfo = document.createElement('div');
            missedInfo.className = 'missed-weeks-info';
            missedInfo.innerHTML = `
                <h4>⚠️ Semaines avec séances manquées</h4>
                ${weeksAnalysis.slice(0, 5).map(week => `
                    <div class="missed-week">
                        <span>Semaine du ${new Date(week.weekStart).toLocaleDateString('fr-FR')}</span>
                        <span class="missed-count">${week.missed} manquée(s) sur ${week.target}</span>
                    </div>
                `).join('')}
            `;
            container.appendChild(missedInfo);
        }
        
    } catch (error) {
        console.error('Erreur chargement calendrier:', error);
    }
}

// ===== GRAPHIQUE 7: BURNDOWN VOLUME =====
async function loadVolumeBurndownChart(userId, period) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/volume-burndown/${period}`);
        
        const ctx = document.getElementById('volumeBurndownChart').getContext('2d');
        
        // Détruire le chart existant
        if (charts.volumeBurndown) {
            charts.volumeBurndown.destroy();
        }
        
        // Préparer les données
        const labels = data.dailyVolumes.map(d => new Date(d.date).toLocaleDateString('fr-FR', { 
            day: 'numeric',
            month: 'short'
        }));
        
        const cumulativeData = data.dailyVolumes.map(d => d.cumulativeVolume);
        const targetLine = data.dailyVolumes.map((d, i) => 
            data.targetVolume * (i + 1) / data.dailyVolumes.length
        );
        
        charts.volumeBurndown = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Volume réalisé',
                    data: cumulativeData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.2
                }, {
                    label: 'Objectif linéaire',
                    data: targetLine,
                    borderColor: '#6b7280',
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Volume (kg)'
                        }
                    }
                },
                plugins: {
                    annotation: {
                        annotations: {
                            target: {
                                type: 'line',
                                yMin: data.targetVolume,
                                yMax: data.targetVolume,
                                borderColor: '#10b981',
                                borderWidth: 2,
                                borderDash: [10, 5],
                                label: {
                                    content: 'Objectif',
                                    enabled: true,
                                    position: 'end'
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Afficher les stats
        const statsContainer = document.getElementById('burndownStats');
        const percentComplete = Math.round(data.currentVolume / data.targetVolume * 100);
        const statusClass = data.projection.onTrack ? 'success' : 'warning';
        
        statsContainer.innerHTML = `
            <div class="burndown-stat">
                <span class="stat-label">Progression</span>
                <span class="stat-value ${statusClass}">${percentComplete}%</span>
            </div>
            <div class="burndown-stat">
                <span class="stat-label">Volume actuel</span>
                <span class="stat-value">${Math.round(data.currentVolume)}kg</span>
            </div>
            <div class="burndown-stat">
                <span class="stat-label">Objectif</span>
                <span class="stat-value">${Math.round(data.targetVolume)}kg</span>
            </div>
            <div class="burndown-stat">
                <span class="stat-label">Rythme nécessaire</span>
                <span class="stat-value">${Math.round(data.projection.dailyRateNeeded)}kg/jour</span>
            </div>
        `;
        
    } catch (error) {
        console.error('Erreur chargement burndown:', error);
    }
}

// ===== GRAPHIQUE 9: SUNBURST VOLUME MUSCULAIRE =====
async function loadMuscleSunburst(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/muscle-sunburst`);
        
        const container = document.getElementById('muscleSunburst');
        
        // Utiliser D3.js pour créer le sunburst
        const width = container.offsetWidth;
        const height = 400;
        const radius = Math.min(width, height) / 2;
        
        // Nettoyer le container
        window.d3.select(container).selectAll("*").remove();
        
        const svg = window.d3.select(container)
            .append("svg")
            .attr("width", width)
            .attr("height", height);
        
        const g = svg.append("g")
            .attr("transform", `translate(${width/2},${height/2})`);
        
        // Créer la partition
        const partition = window.d3.partition()
            .size([2 * Math.PI, radius]);
        
        const root = window.d3.hierarchy(data)
            .sum(d => d.value)
            .sort((a, b) => b.value - a.value);
        
        partition(root);
        
        // Créer l'arc generator
        const arc = window.d3.arc()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .innerRadius(d => d.y0)
            .outerRadius(d => d.y1);
        
        // Créer les segments
        const paths = g.selectAll("path")
            .data(root.descendants())
            .enter().append("path")
            .attr("d", arc)
            .style("fill", d => {
                if (d.depth === 0) return "var(--bg-light)";
                if (d.depth === 1) return getMuscleColor(d.data.name);
                return getMuscleColor(d.data.name, false) + "CC";
            })
            .style("stroke", "var(--bg)")
            .style("stroke-width", 2)
            .style("cursor", "pointer")
            .on("click", clicked)
            .on("dblclick", (event) => event.stopPropagation())
            .on("dblclick", (event) => {
                event.stopPropagation();
                clicked(event, root);
            });
                    
        // Ajouter les labels
        const labels = g.selectAll("text")
            .data(root.descendants().filter(d => d.depth && (d.x1 - d.x0) > 0.1))
            .enter().append("text")
            .attr("transform", d => {
                const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
                const y = (d.y0 + d.y1) / 2;
                return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
            })
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .style("fill", "white")
            .style("font-size", "12px")
            .text(d => d.data.name);
        
        // Fonction de zoom
        function clicked(event, p) {
            const t = g.transition().duration(750);
            
            paths.transition(t)
                .attrTween("d", d => {
                    const i = window.d3.interpolate(d.x0, p.x0);
                    const j = window.d3.interpolate(d.x1, p.x1);
                    return t => {
                        d.x0 = i(t);
                        d.x1 = j(t);
                        return arc(d);
                    };
                });
            
            labels.transition(t)
                .attrTween("transform", d => {
                    return t => {
                        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
                        const y = (d.y0 + d.y1) / 2;
                        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
                    };
                })
                .style("opacity", d => (d.x1 - d.x0) > 0.1 ? 1 : 0);
        }
        // Ajouter un listener sur le conteneur pour dézoomer avec double-clic
        svg.on("dblclick", (event) => {
            clicked(event, root);
        });
        
    } catch (error) {
        console.error('Erreur chargement sunburst:', error);
    }
}

// ===== GRAPHIQUE 10: GANTT RÉCUPÉRATION =====
async function loadRecoveryGantt(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/recovery-gantt`);
        
        const container = document.getElementById('recoveryGantt');
        container.innerHTML = '';
        
        const muscles = Object.keys(data).sort();
        const now = new Date();
        
        muscles.forEach(muscle => {
            const recovery = data[muscle];
            const ganttBar = document.createElement('div');
            ganttBar.className = 'gantt-row';
            
            const muscleColor = getMuscleColor(muscle);
            const statusIcon = {
                'fresh': '✨',
                'recovered': '💪',
                'recovering': '🔄',
                'fatigued': '😓'
            }[recovery.status] || '🔄';
            
            ganttBar.innerHTML = `
                <div class="gantt-label" style="color: ${muscleColor}">
                    ${muscle.charAt(0).toUpperCase() + muscle.slice(1)}
                </div>
                <div class="gantt-bar-container">
                    <div class="gantt-bar" style="
                        width: ${recovery.recoveryPercent}%;
                        background: linear-gradient(to right, 
                            ${muscleColor}, 
                            ${getMuscleBackground(muscle, 0.3)}
                        );
                    ">
                        <span class="gantt-percent">${recovery.recoveryPercent}%</span>
                    </div>
                    <div class="gantt-info">
                        ${statusIcon}
                        ${recovery.hoursSince ? 
                            `${Math.round(recovery.hoursSince)}h` : 
                            'Jamais entraîné'
                        }
                    </div>
                </div>
            `;
            
            container.appendChild(ganttBar);
        });
        
    } catch (error) {
        console.error('Erreur chargement Gantt:', error);
    }
}

// ===== GRAPHIQUE 11: SPIDER ÉQUILIBRE MUSCULAIRE =====
async function loadMuscleBalanceChart(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/muscle-balance`);
        
        const ctx = document.getElementById('muscleBalanceChart').getContext('2d');
        
        // Détruire le chart existant
        if (charts.muscleBalance) {
            charts.muscleBalance.destroy();
        }
        
        // Couleurs par muscle
        const backgroundColors = data.muscles.map(m => getMuscleBackground(m, 0.3));
        const borderColors = data.muscles.map(m => getMuscleColor(m));
        
        charts.muscleBalance = new window.Chart(ctx, {
            type: 'radar',
            data: {
                labels: data.muscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)),
                datasets: [{
                    label: 'Volume actuel (%)',
                    data: data.ratios,
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderColor: '#3b82f6',
                    pointBackgroundColor: borderColors,
                    pointBorderColor: borderColors,
                    pointRadius: 6,
                    pointHoverRadius: 8
                }, {
                    label: 'Objectif (100%)',
                    data: new Array(data.muscles.length).fill(100),
                    backgroundColor: 'rgba(148, 163, 184, 0.1)',
                    borderColor: '#6b7280',
                    borderDash: [5, 5],
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 120,
                        ticks: {
                            stepSize: 20
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const muscle = data.muscles[context.dataIndex];
                                const volume = data.currentVolumes[context.dataIndex];
                                const target = data.targetVolumes[context.dataIndex];
                                return [
                                    `${context.dataset.label}: ${context.raw}%`,
                                    `Volume: ${Math.round(volume)}kg / ${Math.round(target)}kg`
                                ];
                            }
                        }
                    }
                }
            }
        });
        
        // Analyser les déséquilibres
        const insights = document.getElementById('balanceInsights');
        const overworked = data.muscles.filter((m, i) => data.ratios[i] > 120);
        const underworked = data.muscles.filter((m, i) => data.ratios[i] < 80);
        
        let insightsHTML = '<div class="balance-analysis">';
        
        if (overworked.length > 0) {
            insightsHTML += `
                <div class="insight warning">
                    <span class="insight-icon">⚠️</span>
                    <span>Muscles sur-sollicités: ${overworked.join(', ')}</span>
                </div>
            `;
        }
        
        if (underworked.length > 0) {
            insightsHTML += `
                <div class="insight info">
                    <span class="insight-icon">💡</span>
                    <span>À développer: ${underworked.join(', ')}</span>
                </div>
            `;
        }
        
        if (overworked.length === 0 && underworked.length === 0) {
            insightsHTML += `
                <div class="insight success">
                    <span class="insight-icon">✅</span>
                    <span>Équilibre musculaire optimal !</span>
                </div>
            `;
        }
        
        insightsHTML += '</div>';
        insights.innerHTML = insightsHTML;
        
    } catch (error) {
        console.error('Erreur chargement équilibre:', error);
    }
}

// ===== GRAPHIQUE 14: CONFIANCE ML =====
async function loadMLConfidenceChart(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/ml-confidence`);
        
        if (!data.data || data.data.length === 0) {
            document.getElementById('mlStats').innerHTML = 
                '<p class="text-muted">Pas encore de données ML</p>';
            return;
        }
        
        const ctx = document.getElementById('mlConfidenceChart').getContext('2d');
        
        // Détruire le chart existant
        if (charts.mlConfidence) {
            charts.mlConfidence.destroy();
        }
        
        // Préparer les données
        const labels = data.data.map(d => new Date(d.date).toLocaleDateString());
        const confidenceData = data.data.map(d => d.confidence * 100);
        const successData = data.data.map(d => d.success ? 100 : 0);
        
        charts.mlConfidence = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Confiance ML (%)',
                    data: confidenceData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.2,
                    yAxisID: 'y'
                }, {
                    label: 'Taux de réussite',
                    data: successData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    stepped: true,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Confiance (%)'
                        }
                    },
                    y1: {
                        display: false,
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });
        
        // Afficher les stats
        const trendIcon = {
            'improving': '📈',
            'stable': '➡️',
            'declining': '📉'
        }[data.trend] || '➡️';
        
        document.getElementById('mlStats').innerHTML = `
            <div class="ml-stats-grid">
                <div class="ml-stat">
                    <span class="stat-label">Confiance moyenne</span>
                    <span class="stat-value">${Math.round(data.averageConfidence * 100)}%</span>
                </div>
                <div class="ml-stat">
                    <span class="stat-label">Taux de suivi</span>
                    <span class="stat-value">${Math.round(data.followRate * 100)}%</span>
                </div>
                <div class="ml-stat">
                    <span class="stat-label">Tendance</span>
                    <span class="stat-value">${trendIcon} ${data.trend}</span>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Erreur chargement confiance ML:', error);
    }
}

// ===== GRAPHIQUE 15: SANKEY AJUSTEMENTS ML =====
async function loadMLSankeyDiagram(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/ml-adjustments-flow`);
        
        const container = document.getElementById('mlSankeyDiagram');
        
        if (!data.links || data.links.length === 0) {
            container.innerHTML = '<p class="text-muted">Pas assez de données pour le diagramme</p>';
            return;
        }
        
        // Dimensions
        const width = container.offsetWidth;
        const height = 400;
        const margin = { top: 10, right: 10, bottom: 10, left: 10 };
        
        // Nettoyer le container
        window.d3.select(container).selectAll("*").remove();
        
        const svg = window.d3.select(container)
            .append("svg")
            .attr("width", width)
            .attr("height", height);
        
        const sankey = window.d3.sankey()
            .nodeWidth(15)
            .nodePadding(10)
            .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);
        
        const { nodes, links } = sankey({
            nodes: data.nodes.map(d => Object.assign({}, d)),
            links: data.links.map(d => Object.assign({}, d))
        });
        
        // Créer les liens
        svg.append("g")
            .selectAll("path")
            .data(links)
            .join("path")
            .attr("d", window.d3.sankeyLinkHorizontal())
            .attr("stroke", d => {
                if (d.target.name === "Succès") return "var(--success)";
                if (d.target.name === "Échec") return "var(--danger)";
                return "var(--primary)";
            })
            .attr("stroke-width", d => Math.max(1, d.width))
            .attr("fill", "none")
            .attr("opacity", 0.5);
        
        // Créer les noeuds
        svg.append("g")
            .selectAll("rect")
            .data(nodes)
            .join("rect")
            .attr("x", d => d.x0)
            .attr("y", d => d.y0)
            .attr("height", d => d.y1 - d.y0)
            .attr("width", d => d.x1 - d.x0)
            .attr("fill", d => {
                if (d.name === "Succès") return "var(--success)";
                if (d.name === "Échec") return "var(--danger)";
                if (d.name.includes("Modifiées")) return "var(--warning)";
                return "var(--primary)";
            });
        
        // Ajouter les labels
        svg.append("g")
            .selectAll("text")
            .data(nodes)
            .join("text")
            .attr("x", d => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
            .attr("y", d => (d.y1 + d.y0) / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
            .style("fill", "var(--text)")
            .style("font-size", "12px")
            .text(d => d.name);
        
    } catch (error) {
        console.error('Erreur chargement Sankey:', error);
    }
}

// ===== GRAPHIQUE 18: DISTRIBUTION DU TEMPS =====
async function loadTimeDistributionChart(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/time-distribution`);
        
        if (!data.sessions || data.sessions.length === 0) {
            return;
        }
        
        const ctx = document.getElementById('timeDistributionChart').getContext('2d');
        
        // Détruire le chart existant
        if (charts.timeDistribution) {
            charts.timeDistribution.destroy();
        }
        
        // Préparer les données
        const labels = data.sessions.map(s => 
            new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        );
        
        // Inverser l'ordre des sessions pour avoir chronologique
        const reversedSessions = [...data.sessions].reverse();

        charts.timeDistribution = new window.Chart(ctx, {
            type: 'bar',
            data: {
                labels: reversedSessions.map(s => 
                    new Date(s.date).toLocaleDateString('fr-FR', { 
                        day: 'numeric', 
                        month: 'short' 
                    })
                ),
                datasets: [{
                    label: 'Exercice',
                    data: reversedSessions.map(s => s.exerciseTime),
                    backgroundColor: '#3b82f6',
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }, {
                    label: 'Repos',
                    data: reversedSessions.map(s => s.restTime),
                    backgroundColor: '#f59e0b',
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }, {
                    label: 'Transition',
                    data: reversedSessions.map(s => s.transitionTime),
                    backgroundColor: '#94a3b8',
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        grid: {
                            display: false
                        },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Temps (minutes)'
                        },
                        ticks: {
                            stepSize: 10
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#e5e7eb',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true,
                        callbacks: {
                            afterTitle: function(tooltipItems) {
                                const session = reversedSessions[tooltipItems[0].dataIndex];
                                return `${session.setsCount} séries`;
                            },
                            footer: function(tooltipItems) {
                                const session = reversedSessions[tooltipItems[0].dataIndex];
                                return `\nTotal: ${session.totalMinutes} min`;
                            }
                        }
                    }
                }
            }
        });
                
    } catch (error) {
        console.error('Erreur chargement distribution temps:', error);
    }
}

// ===== GRAPHIQUE INTENSITÉ/RÉCUPÉRATION =====
async function loadIntensityRecoveryChart(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/workout-intensity-recovery`);
        
        if (!data.sessions || data.sessions.length === 0) {
            return;
        }
        
        const ctx = document.getElementById('intensityRecoveryChart').getContext('2d');
        
        if (charts.intensityRecovery) {
            charts.intensityRecovery.destroy();
        }
        
        // Couleur par ancienneté (gradient du rouge au vert)
        const sessions = data.sessions.map(s => ({
            x: s.charge,
            y: s.ratio,
            color: `hsl(${Math.max(0, 120 - s.days_ago * 2)}, 70%, 50%)`,
            ...s
        }));
        
        charts.intensityRecovery = new window.Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Séances',
                    data: sessions,
                    backgroundColor: sessions.map(s => s.color),
                    borderColor: sessions.map(s => s.color),
                    pointRadius: 8,
                    pointHoverRadius: 12
                }, {
                    // Ligne médiane verticale
                    type: 'line',
                    label: 'Médiane Charge',
                    data: [
                        {x: data.medians.charge, y: Math.min(...sessions.map(s => s.y))},
                        {x: data.medians.charge, y: Math.max(...sessions.map(s => s.y))}
                    ],
                    borderColor: '#94a3b8',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    showLine: true
                }, {
                    // Ligne médiane horizontale  
                    type: 'line',
                    label: 'Médiane Récupération',
                    data: [
                        {x: Math.min(...sessions.map(s => s.x)), y: data.medians.ratio},
                        {x: Math.max(...sessions.map(s => s.x)), y: data.medians.ratio}
                    ],
                    borderColor: '#94a3b8',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    showLine: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: '⚡ Profil Intensité/Récupération par Séance'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const session = context.raw;
                                return [
                                    `Date: ${new Date(session.date).toLocaleDateString()}`,
                                    `Charge: ${session.charge} vol/min`,
                                    `Récupération: ${session.ratio} sec/vol`,
                                    `Volume: ${session.total_volume}`,
                                    `Durée: ${session.total_duration_minutes}min`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Charge (Volume/min)'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Ratio Récupération (sec repos/volume)'
                        }
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Erreur chargement graphique intensité/récupération:', error);
    }
}

// Export des fonctions pour app.js
window.initStatsCharts = initStatsCharts;