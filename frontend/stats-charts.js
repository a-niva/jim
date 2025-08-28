(function() {
'use strict';

// ===== frontend/stats-charts.js - GESTION DES GRAPHIQUES STATS =====

// Import des couleurs musculaires

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

// ===== INITIALISATION =====
// Helper pour accès sécurisé aux couleurs musculaires
function getSafeMuscleColor(muscle) {
    if (!window.MuscleColors || !window.MuscleColors.getMuscleColor) {
        console.warn('MuscleColors module not loaded, using default color');
        return '#94a3b8';
    }
    return window.MuscleColors.getMuscleColor(muscle) || '#94a3b8';
}

async function initStatsCharts(userId, user) {
    if (!userId) return;
    
    // Stocker la référence à l'utilisateur
    window.currentUser = user || window.currentUser;
    
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
            loadProgressionChart(window.currentUser.id, e.target.value);
        }
    });
    
    // Boutons de période
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentBurndownPeriod = e.target.dataset.period;
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            loadVolumeBurndownChart(window.currentUser.id, currentBurndownPeriod);
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
    loadTabCharts(window.currentUser.id, tabName);
}

function loadActiveTabCharts(userId) {
    const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
    loadTabCharts(userId, activeTab);
}

async function loadTabCharts(userId, tabName) {
    switch (tabName) {
        case 'performance':
            await Promise.all([
                loadMuscleVolumeChart(userId),
                loadIntensityRecoveryChart(userId)
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


// ===== CHART VOLUME MUSCULAIRE - AIRES EMPILÉES =====
async function loadMuscleVolumeChart(userId) {
    const period = document.querySelector('.period-btn.active')?.dataset.period || '30';
    
    try {
        console.log('📊 Chargement chart volume musculaire - période:', period);
        
        // NOUVEL endpoint dédié
        const data = await window.apiGet(`/api/users/${userId}/stats/muscle-volume?days=${period}`);
        
        if (!data || !data.datasets || data.datasets.length === 0) {
            document.getElementById('recordsWaterfall').innerHTML = 
                '<p class="text-muted">Pas de données pour cette période</p>';
            return;
        }
        
        renderMuscleVolumeChart(data);
        
    } catch (error) {
        console.error('Erreur chart volume:', error);
        document.getElementById('recordsWaterfall').innerHTML = 
            '<p class="text-muted">Erreur chargement données</p>';
    }
}

function renderMuscleVolumeChart(chartData) {
    // Réutiliser le container existant
    const container = document.getElementById('recordsWaterfall');
    container.innerHTML = '<canvas id="muscleVolumeChart" style="height: 300px;"></canvas>';
    
    const ctx = document.getElementById('muscleVolumeChart').getContext('2d');
    
    // Utiliser les couleurs existantes
    const muscleColors = window.MuscleColors ?
        window.MuscleColors.getChartColors() :
        {
            dos: '#3b82f6',
            pectoraux: '#ec4899',
            jambes: '#10b981', 
            epaules: '#f59e0b',
            bras: '#8b5cf6',
            abdominaux: '#ef4444'
        };
    
    // CORRECTION : Reconstruire les dates complètes depuis les labels non-vides
    const allDates = [];
    const nonEmptyLabels = chartData.labels.filter(label => label !== "");
    
    if (nonEmptyLabels.length === 0) {
        console.error('Aucune date valide trouvée dans chartData.labels');
        return;
    }
    
    // Reconstruire la série temporelle complète
    const firstDate = new Date(nonEmptyLabels[0]);
    const dataLength = chartData.datasets[0]?.data?.length || 0;
    
    for (let i = 0; i < dataLength; i++) {
        const currentDate = new Date(firstDate);
        currentDate.setDate(firstDate.getDate() + i);
        allDates.push(currentDate.toISOString().split('T')[0]); // Format YYYY-MM-DD
    }
    
    // Préparer datasets avec format {x: date, y: value}
    const datasets = chartData.datasets.map(dataset => {
        const muscle = dataset.label.toLowerCase();
        const color = muscleColors[muscle] || '#6b7280';
        
        // Convertir data array en format temporel
        const timeSeriesData = dataset.data.map((value, index) => ({
            x: allDates[index],
            y: value
        }));
        
        return {
            label: dataset.label,
            data: timeSeriesData,
            backgroundColor: color + '60', // 60 = ~37% opacity
            borderColor: color,
            borderWidth: 1,
            fill: true,
            tension: 0.3
        };
    });
    
    // Chart avec axe temporel
    new Chart(ctx, {
        type: 'line',
        data: {
            datasets: datasets // Pas de labels - utilise les données temporelles
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: {
                            day: 'dd MMM'
                        },
                        tooltipFormat: 'dd MMM yyyy'
                    },
                    stacked: true,
                    title: {
                        display: true,
                        text: `Somme glissante ${chartData.period_days} jours`
                    },
                    ticks: {
                        maxTicksLimit: 8 // Limiter le nombre de labels pour la lisibilité
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Volume (kg)'
                    },
                    ticks: {
                        callback: function(value) {
                            return Math.round(value) + 'kg';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    callbacks: {
                        title: function(context) {
                            // Format de date lisible pour le tooltip
                            const date = new Date(context[0].parsed.x);
                            return date.toLocaleDateString('fr-FR', { 
                                weekday: 'short',
                                day: 'numeric', 
                                month: 'short' 
                            });
                        },
                        label: function(context) {
                            return `${context.dataset.label}: ${Math.round(context.parsed.y)}kg`;
                        }
                    }
                },
                legend: {
                    position: 'top'
                }
            },
            elements: {
                point: {
                    radius: 2
                }
            }
        }
    });
    
    console.log('✅ Chart volume musculaire créé avec axe temporel');
}

// Fonction pour boutons de période
function selectMuscleVolumePeriod(period) {
    // Mettre à jour boutons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-period="${period}"]`)?.classList.add('active');
    
    // Recharger
    if (window.currentUser?.id) {
        loadMuscleVolumeChart(window.currentUser.id);
    }
}

// Exposer globalement
window.loadMuscleVolumeChart = loadMuscleVolumeChart;
window.selectMuscleVolumePeriod = selectMuscleVolumePeriod;

/**
 * Module M6 - Fonction cleanup pour éviter memory leaks
 */
const M6 = {
    cleanup() {
        // Nettoyer containers DOM
        const containers = ['recordsWaterfall', 'progressionInfo', 'burndownStats'];
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = '';
            }
        });
        
        // Détruire charts actifs pour éviter memory leaks
        Object.keys(window.charts || {}).forEach(chartKey => {
            if (window.charts[chartKey]?.destroy) {
                window.charts[chartKey].destroy();
                window.charts[chartKey] = null;
            }
        });
        
        console.log('[M6] Cleanup effectué');
    }
};

// Exposition globale
window.M6 = M6;

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
        const userCreatedDate = new Date(window.currentUser.created_at);

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
// ===== GRAPHIQUE 7: PROGRESSION PROGRAMME OPTIMISÉE =====
async function loadVolumeBurndownChart(userId, period) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/volume-burndown/${period}`);
        
        if (!data.dailyVolumes || data.dailyVolumes.length === 0) {
            showVolumeEmptyState();
            return;
        }
        
        // Rendu en une seule passe pour la performance
        renderOptimizedVolumeChart(data, period);
        renderEnhancedStats(data, period);
        
    } catch (error) {
        console.error('Erreur chargement volume:', error);
        showVolumeErrorState();
    }
}

function renderOptimizedVolumeChart(data, period) {
    const ctx = document.getElementById('volumeBurndownChart').getContext('2d');
    
    if (charts.volumeBurndown) {
        charts.volumeBurndown.destroy();
    }
    
    // Optimisation : créer les datasets en une seule boucle
    const chartLabels = [];
    const realizationData = [];
    const targetData = [];
    const progressLine = [];
    
    const dailyTarget = data.targetVolume / data.dailyVolumes.length;
    
    data.dailyVolumes.forEach((d, i) => {
        chartLabels.push(new Date(d.date).toLocaleDateString('fr-FR', { 
            day: 'numeric',
            month: 'short'
        }));
        realizationData.push(d.cumulativeVolume);
        targetData.push((i + 1) * dailyTarget);
        progressLine.push(data.targetVolume);
    });
    
    charts.volumeBurndown = new window.Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Exercices réalisés',
                data: realizationData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#3b82f6',
                pointBorderWidth: 2
            }, {
                label: 'Rythme idéal',
                data: targetData,
                borderColor: '#10b981',
                borderDash: [8, 4],
                fill: false,
                pointRadius: 0,
                tension: 0.2
            }, {
                label: 'Objectif final',
                data: progressLine,
                borderColor: '#f59e0b',
                borderDash: [12, 8],
                fill: false,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            return `Jour ${context[0].dataIndex + 1}`;
                        },
                        label: function(context) {
                            const value = context.parsed.y;
                            return `${context.dataset.label}: ${Math.round(value)} exercices`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Exercices cumulés',
                        font: { size: 12, weight: 'bold' }
                    },
                    ticks: {
                        stepSize: Math.ceil(data.targetVolume / 10)
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: period === 'week' ? 'Jours' : 'Progression',
                        font: { size: 12 }
                    }
                }
            }
        }
    });
}

function renderEnhancedStats(data, period) {
    const container = document.getElementById('burndownStats');
    
    // Calculs optimisés
    const current = data.currentVolume;
    const target = data.targetVolume;
    const completion = Math.round((current / target) * 100);
    
    // Calcul tendance simple
    const volumes = data.dailyVolumes.map(d => d.cumulativeVolume);
    const velocity = volumes.length > 1 
        ? (volumes[volumes.length - 1] - volumes[0]) / (volumes.length - 1)
        : 0;
    
    // Estimation simple
    const remaining = target - current;
    const estimatedDays = velocity > 0 ? Math.ceil(remaining / velocity) : null;
    
    // Status
    const status = completion >= 85 ? { level: 'excellent', icon: '🔥', text: 'Excellent rythme' }
                 : completion >= 70 ? { level: 'good', icon: '💪', text: 'Bon rythme' }
                 : completion >= 50 ? { level: 'warning', icon: '⚡', text: 'Rattrapage possible' }
                 : { level: 'danger', icon: '🎯', text: 'Ajustement requis' };
    
    container.className = 'burndown-overview';
    container.innerHTML = `
        <div class="burndown-circle-container">
            <div class="burndown-progress-ring" style="--burndown-progress: ${completion}">
                <span class="burndown-progress-text">${completion}%</span>
            </div>
            <div class="burndown-circle-label">Progression</div>
        </div>
        
        <div class="burndown-summary-numbers">
            <div class="burndown-stat-block">
                <span class="burndown-stat-number">${current}</span>
                <span class="burndown-stat-caption">Réalisés</span>
            </div>
            <div class="burndown-divider">/</div>
            <div class="burndown-stat-block">
                <span class="burndown-stat-number">${target}</span>
                <span class="burndown-stat-caption">Objectif</span>
            </div>
        </div>
        
        <div class="burndown-insights-container">
            <div class="burndown-insight-card ${status.level}">
                <div class="burndown-insight-header">
                    <span class="burndown-insight-icon">${status.icon}</span>
                    <span class="burndown-insight-title">${status.text}</span>
                </div>
                <div class="burndown-insight-message">
                    ${generateBurndownMessage(completion, remaining, velocity, estimatedDays)}
                </div>
            </div>
            
            <div class="burndown-quick-metrics">
                <div class="burndown-quick-item">
                    <span class="burndown-quick-icon">⚡</span>
                    <span class="burndown-quick-text">${velocity.toFixed(1)} exercices/jour</span>
                </div>
                ${estimatedDays ? `
                <div class="burndown-quick-item">
                    <span class="burndown-quick-icon">📅</span>
                    <span class="burndown-quick-text">Objectif dans ~${estimatedDays}j</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

function generateBurndownMessage(completion, remaining, velocity, estimatedDays) {
    if (completion >= 85) {
        return "Rythme parfait ! Vous êtes en avance sur votre programme.";
    } else if (completion >= 70) {
        return `Encore ${remaining} exercices pour compléter votre objectif.`;
    } else if (velocity > 0 && estimatedDays) {
        return `À ce rythme, objectif atteint dans environ ${estimatedDays} jours.`;
    } else {
        return "Augmentez le rythme pour rattraper le programme prévu.";
    }
}

function showVolumeEmptyState() {
    document.getElementById('burndownStats').innerHTML = `
        <div class="burndown-empty-state">
            <div class="burndown-empty-icon">📋</div>
            <div class="burndown-empty-text">Aucun programme actif</div>
        </div>
    `;
}

function showVolumeErrorState() {
    document.getElementById('burndownStats').innerHTML = `
        <div class="burndown-empty-state error">
            <div class="burndown-empty-icon">⚠️</div>
            <div class="burndown-empty-text">Erreur de chargement</div>
        </div>
    `;
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
        
        const paths = g.selectAll("path")
            .data(root.descendants())
            .enter().append("path")
            .attr("d", arc)
            .style("fill", d => {
                if (d.depth === 0) return "var(--bg-light)";
                if (d.depth === 1) return window.MuscleColors?.getMuscleColor(d.data.name);
                return window.MuscleColors?.getMuscleColor(d.data.name, false) + "CC";
            })
            .style("stroke", "var(--bg)")
            .style("stroke-width", 2)
            .style("cursor", "pointer")
            .on("click", clicked)
            .on("dblclick", (event, d) => {
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
            
            const muscleColor = window.MuscleColors?.getMuscleColor(muscle);
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
                            ${window.MuscleColors?.getMuscleBackground(muscle, 0.3)}
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
        const backgroundColors = data.muscles.map(m => window.MuscleColors?.getMuscleBackground(m, 0.3));
        const borderColors = data.muscles.map(m => window.MuscleColors?.getMuscleColor(m));
        
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

// ===== NOUVEAU ML ANALYTICS - À REMPLACER dans frontend/stats-charts.js =====

// Variables globales pour les charts ML
let mlCharts = {};

// ===== DASHBOARD PRINCIPAL ML =====
async function loadMLDashboard(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/ml-insights`);
        
        if (data.error) {
            document.getElementById('mlStats').innerHTML = `
                <div class="ml-dashboard-empty">
                    <div class="empty-icon">🤖</div>
                    <h4>Pas encore de données ML</h4>
                    <p>Commencez à utiliser les recommandations ML pendant vos séances pour voir des insights apparaître ici.</p>
                </div>
            `;
            return;
        }
        
        const { overview, ml_performance, recent_activity } = data;
        
        // Dashboard principal avec métriques
        const dashboardHTML = `
            <div class="ml-dashboard">
                <div class="ml-metrics-grid">
                    <div class="metric-card primary">
                        <div class="metric-icon">🎯</div>
                        <div class="metric-content">
                            <div class="metric-value">${Math.round(ml_performance.avg_confidence * 100)}%</div>
                            <div class="metric-label">Confiance moyenne</div>
                            <div class="metric-trend ${ml_performance.confidence_trend}">
                                ${ml_performance.confidence_trend === 'improving' ? '📈 En amélioration' : 
                                  ml_performance.confidence_trend === 'declining' ? '📉 En baisse' : '➡️ Stable'}
                            </div>
                        </div>
                    </div>
                    
                    <div class="metric-card success">
                        <div class="metric-icon">✅</div>
                        <div class="metric-content">
                            <div class="metric-value">${Math.round(ml_performance.follow_rate_weight * 100)}%</div>
                            <div class="metric-label">Suivi des poids</div>
                            <div class="metric-detail">${ml_performance.sets_with_recommendations} recommandations</div>
                        </div>
                    </div>
                    
                    <div class="metric-card info">
                        <div class="metric-icon">📊</div>
                        <div class="metric-content">
                            <div class="metric-value">${Math.round(overview.ml_adoption_rate * 100)}%</div>
                            <div class="metric-label">Adoption ML</div>
                            <div class="metric-detail">${overview.ml_active_sessions}/${overview.total_sessions} séances</div>
                        </div>
                    </div>
                    
                    <div class="metric-card warning">
                        <div class="metric-icon">🔬</div>
                        <div class="metric-content">
                            <div class="metric-value">${Math.round(overview.data_quality_score * 100)}%</div>
                            <div class="metric-label">Qualité données</div>
                            <div class="metric-detail">Fatigue: ${overview.avg_fatigue}/5, Effort: ${overview.avg_effort}/5</div>
                        </div>
                    </div>
                </div>
                
                <div class="ml-activity-summary">
                    <h5>🔥 Activité récente</h5>
                    <div class="activity-bar">
                        <div class="activity-bar">
                            <span class="activity-label">7 derniers jours</span>
                            <div class="activity-progress">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${Math.min(100, (recent_activity.ml_active_last_7 / recent_activity.last_7_days) * 100)}%"></div>
                                </div>
                                <span class="progress-text">${recent_activity.ml_active_last_7}/${recent_activity.last_7_days} séries ML</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('mlStats').innerHTML = dashboardHTML;
        
    } catch (error) {
        console.error('Erreur chargement ML dashboard:', error);
        document.getElementById('mlStats').innerHTML = `
            <div class="error-state">
                <span class="error-icon">⚠️</span>
                <span>Erreur de chargement des données ML</span>
            </div>
        `;
    }
}

// ===== GRAPHIQUE DE PRÉCISION DES RECOMMANDATIONS =====
async function loadMLAccuracyChart(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/ml-recommendations-accuracy`);
        
        if (data.error) {
            const chartElement = document.getElementById('mlConfidenceChart');
            if (!chartElement) {
                console.warn('Element mlConfidenceChart non trouvé, tab probablement non actif');
                return;
            }
            chartElement.parentElement.innerHTML = `
                <div class="chart-placeholder">
                    <div class="placeholder-icon">📈</div>
                    <h4>Analyse de précision</h4>
                    <p>Utilisez les recommandations ML pour voir l'analyse de précision apparaître ici.</p>
                </div>
            `;
            return;
        }
        
        const chartElement = document.getElementById('mlConfidenceChart');
        if (!chartElement) {
            console.warn('Element mlConfidenceChart non trouvé pour le graphique');
            return;
        }
        const ctx = chartElement.getContext('2d');
        
        // Détruire le chart existant
        if (mlCharts.accuracy) {
            mlCharts.accuracy.destroy();
        }
        
        // Préparer les données pour le graphique
        const timelineData = data.accuracy_timeline;
        const labels = timelineData.map(d => new Date(d.date).toLocaleDateString());
        
        mlCharts.accuracy = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Écart poids (kg)',
                    data: timelineData.map(d => d.weight_diff),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.3,
                    yAxisID: 'y'
                }, {
                    label: 'Écart reps',
                    data: timelineData.map(d => d.reps_diff),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    tension: 0.3,
                    yAxisID: 'y1'
                }, {
                    label: 'Confiance ML (%)',
                    data: timelineData.map(d => d.confidence * 100),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.3,
                    yAxisID: 'y2'
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
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Écart poids (kg)'
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Écart reps'
                        },
                        grid: {
                            display: false
                        }
                    },
                    y2: {
                        beginAtZero: true,
                        max: 100,
                        display: false
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: function(context) {
                                const index = context[0].dataIndex;
                                const item = timelineData[index];
                                return [
                                    `Suggéré: ${item.weight_suggested}kg, ${item.reps_suggested} reps`,
                                    `Réalisé: ${item.weight_actual}kg, ${item.reps_actual} reps`,
                                    `Suivi: ${item.followed_weight ? '✅' : '❌'} poids, ${item.followed_reps ? '✅' : '❌'} reps`
                                ];
                            }
                        }
                    }
                }
            }
        });
        
        // Afficher les métriques de précision
        const metricsHTML = `
            <div class="accuracy-metrics">
                <div class="accuracy-metric">
                    <span class="metric-label">Précision poids</span>
                    <span class="metric-value ${data.metrics.weight_precision_rate > 0.7 ? 'good' : data.metrics.weight_precision_rate > 0.5 ? 'medium' : 'poor'}">
                        ${Math.round(data.metrics.weight_precision_rate * 100)}%
                    </span>
                </div>
                <div class="accuracy-metric">
                    <span class="metric-label">Précision reps</span>
                    <span class="metric-value ${data.metrics.reps_precision_rate > 0.8 ? 'good' : data.metrics.reps_precision_rate > 0.6 ? 'medium' : 'poor'}">
                        ${Math.round(data.metrics.reps_precision_rate * 100)}%
                    </span>
                </div>
                <div class="accuracy-metric">
                    <span class="metric-label">Écart moyen</span>
                    <span class="metric-value">±${data.metrics.avg_weight_deviation}kg</span>
                </div>
                <div class="accuracy-metric">
                    <span class="metric-label">Taux de suivi</span>
                    <span class="metric-value">${Math.round(data.metrics.overall_follow_rate * 100)}%</span>
                </div>
            </div>
        `;
        
        // Insérer directement dans le container ML Stats
        const mlStatsContainer = document.getElementById('mlStats');
        const existingMetrics = mlStatsContainer.querySelector('.accuracy-metrics');
        if (existingMetrics) {
            existingMetrics.remove();
        }
        mlStatsContainer.insertAdjacentHTML('beforeend', metricsHTML);
        
    } catch (error) {
        console.error('Erreur chargement précision ML:', error);
    }
}

// ===== ANALYSE DE PROGRESSION ML vs TRADITIONNEL =====

async function loadMLProgressionAnalysis(userId) {
    const container = document.getElementById('mlSankeyDiagram');
    
    if (!container) {
        console.error('Element mlSankeyDiagram non trouvé');
        return;
    }
    
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/ml-progression`);
        
        if (data.error || !data.exercises || data.exercises.length === 0) {
            container.innerHTML = `
                <div class="chart-placeholder">
                    <div class="placeholder-icon">📊</div>
                    <h4>Classement des exercices</h4>
                    <p>Effectuez plus de séances avec et sans ML pour voir le classement d'efficacité.</p>
                </div>
            `;
            return;
        }
        
        // Trier les exercices par impact ML (décroissant)
        const sortedExercises = data.exercises
            .filter(ex => ex.ml_sets >= 1 && ex.normal_sets >= 1) // Minimum 1 série chaque
            .sort((a, b) => b.improvement_factor - a.improvement_factor);
        
        if (sortedExercises.length === 0) {
            container.innerHTML = `
                <div class="chart-placeholder">
                    <div class="placeholder-icon">📊</div>
                    <h4>Pas assez de données</h4>
                    <p>Effectuez plus de séries avec et sans ML pour voir le classement.</p>
                </div>
            `;
            return;
        }
        
        // Générer le leaderboard
        let leaderboardHTML = `
            <div class="sankey-leaderboard">
                <div class="sankey-header">
                    <h4>🏆 Efficacité du ML par exercice</h4>
                    <p>Exercices classés par amélioration des performances</p>
                </div>
                <div class="sankey-list">
        `;
        
        sortedExercises.forEach((exercise, index) => {
            const improvementPercent = Math.round((exercise.improvement_factor - 1) * 100);
            const isPositive = improvementPercent > 0;
            const progressWidth = Math.min(Math.abs(improvementPercent), 100);
            
            leaderboardHTML += `
                <div class="sankey-exercise-card ${isPositive ? 'positive' : 'negative'}">
                    <div class="sankey-rank">#${index + 1}</div>
                    <div class="sankey-exercise-info">
                        <div class="sankey-exercise-name">${exercise.name}</div>
                        <div class="sankey-exercise-stats">
                            ML: ${exercise.ml_sets} séries • Normal: ${exercise.normal_sets} séries
                        </div>
                    </div>
                    <div class="sankey-impact">
                        <div class="sankey-progress-container">
                            <div class="sankey-progress-bar">
                                <div class="sankey-progress-fill ${isPositive ? 'positive' : 'negative'}" 
                                     style="width: ${progressWidth}%"></div>
                            </div>
                        </div>
                        <div class="sankey-impact-value ${isPositive ? 'positive' : 'negative'}">
                            ${isPositive ? '+' : ''}${improvementPercent}%
                        </div>
                    </div>
                </div>
            `;
        });
        
        leaderboardHTML += `
                </div>
            </div>
        `;
        
        container.innerHTML = leaderboardHTML;
        
        // Animation progressive des barres
        setTimeout(() => {
            document.querySelectorAll('.sankey-progress-fill').forEach((bar, index) => {
                setTimeout(() => {
                    bar.style.transform = 'scaleX(1)';
                }, index * 100);
            });
        }, 100);
        
    } catch (error) {
        console.error('Erreur chargement classement ML:', error);
        container.innerHTML = `
            <div class="chart-placeholder">
                <div class="placeholder-icon">❌</div>
                <h4>Erreur de chargement</h4>
                <p>Impossible de charger le classement des exercices.</p>
            </div>
        `;
    }
}

// ===== PATTERNS PAR EXERCICE =====
async function loadMLExercisePatterns(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/ml-exercise-patterns`);
        
        if (data.error) {
            return; // Pas d'affichage si pas de données
        }
        
        const patterns = Object.entries(data.exercise_patterns)
            .sort(([,a], [,b]) => b.ml_adoption_rate - a.ml_adoption_rate)
            .slice(0, 8); // Top 8
        
        let patternsHTML = `
            <div class="exercise-patterns">
                <h5>🎯 Utilisation ML par exercice</h5>
                <div class="patterns-grid">
        `;
        
        patterns.forEach(([exerciseName, pattern]) => {
            const adoptionPercent = Math.round(pattern.ml_adoption_rate * 100);
            const confidencePercent = Math.round(pattern.avg_confidence * 100);
            
            patternsHTML += `
                <div class="pattern-card">
                    <div class="pattern-header">
                        <h6>${exerciseName}</h6>
                        <span class="adoption-badge ${adoptionPercent > 50 ? 'high' : adoptionPercent > 20 ? 'medium' : 'low'}">
                            ${adoptionPercent}% ML
                        </span>
                    </div>
                    <div class="pattern-stats">
                        <div class="pattern-stat">
                            <span class="stat-label">Séries totales</span>
                            <span class="stat-value">${pattern.total_sets}</span>
                        </div>
                        <div class="pattern-stat">
                            <span class="stat-label">Confiance moy.</span>
                            <span class="stat-value">${confidencePercent}%</span>
                        </div>
                    </div>
                    <div class="pattern-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${adoptionPercent}%"></div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        patternsHTML += `
                </div>
                <div class="patterns-summary">
                    <p>💡 <strong>${data.summary.most_ml_friendly}</strong> est votre exercice le plus adapté au ML</p>
                </div>
            </div>
        `;
        
        // Ajouter après le dashboard principal
        const mlStatsDiv = document.getElementById('mlStats');
        mlStatsDiv.insertAdjacentHTML('beforeend', patternsHTML);
        
    } catch (error) {
        console.error('Erreur chargement patterns exercices:', error);
    }
}

// ===== FONCTION PRINCIPALE D'INITIALISATION =====
async function loadMLAnalytics(userId) {
    // Charger tous les composants ML
    await loadMLDashboard(userId);
    await loadMLAccuracyChart(userId);
    await loadMLProgressionAnalysis(userId);
    await loadMLExercisePatterns(userId);
}

// ===== REMPLACER LES ANCIENNES FONCTIONS =====
// Cette fonction remplace loadMLConfidenceChart
async function loadMLConfidenceChart(userId) {
    await loadMLAnalytics(userId);
}

// Cette fonction remplace loadMLSankeyDiagram  
async function loadMLSankeyDiagram(userId) {
    // Déjà géré dans loadMLAnalytics
    return;
}

// ===== GRAPHIQUE PROFIL SÉANCES =====
async function loadIntensityRecoveryChart(userId) {
    try {
        const data = await window.apiGet(`/api/users/${userId}/stats/workout-intensity-recovery`);
        
        if (!data.sessions || data.sessions.length === 0) {
            return;
        }
        
        // 🔍 DEBUG - Vérifier les valeurs des sessions
        console.log('📊 DEBUG Sessions data:', data.sessions.map(s => ({
            date: s.date,
            charge: s.charge,
            ratio: s.ratio,
            volume: s.total_volume,
            duration: s.total_duration_minutes
        })));
        
        const ctx = document.getElementById('intensityRecoveryChart').getContext('2d');
        
        if (charts.intensityRecovery) {
            charts.intensityRecovery.destroy();
        }
        
        // Calculer les extremums pour le gradient
        const maxDays = Math.max(...data.sessions.map(s => s.days_ago));
        const minDays = Math.min(...data.sessions.map(s => s.days_ago));
        
        // Nouveau gradient plus esthétique : Bleu → Vert → Jaune → Rouge
        function getColorFromAge(daysAgo) {
            const normalized = (daysAgo - minDays) / (maxDays - minDays || 1);
            
            if (normalized <= 0.33) {
                // Récent : Bleu → Vert
                const localNorm = normalized / 0.33;
                const hue = 240 - (localNorm * 60); // 240° (bleu) → 180° (cyan) → 120° (vert)
                return `hsl(${hue}, 80%, 55%)`;
            } else if (normalized <= 0.66) {
                // Moyen : Vert → Jaune
                const localNorm = (normalized - 0.33) / 0.33;
                const hue = 120 - (localNorm * 60); // 120° (vert) → 60° (jaune)
                return `hsl(${hue}, 75%, 50%)`;
            } else {
                // Ancien : Jaune → Rouge
                const localNorm = (normalized - 0.66) / 0.34;
                const hue = 60 - (localNorm * 60); // 60° (jaune) → 0° (rouge)
                return `hsl(${hue}, 85%, 45%)`;
            }
        }
        
        // Préparer les données avec couleurs graduelles
        const sessions = data.sessions.map(s => {
            const baseColor = getColorFromAge(s.days_ago);
            
            // Extraire les valeurs RGB pour ajouter la transparence
            const rgbMatch = baseColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
            let transparentColor = baseColor;
            
            if (rgbMatch) {
                const [, h, s, l] = rgbMatch;
                // Convertir en HSLA avec 40% d'opacité (0.4)
                transparentColor = `hsla(${h}, ${s}%, ${l}%, 0.4)`;
            }
            
            return {
                x: s.charge,
                y: s.ratio,
                backgroundColor: transparentColor, // 40% transparent
                borderColor: transparentColor,     // 40% transparent
                pointRadius: 4.8,        // 12 * 0.4 = 4.8 (réduction de 60%)
                pointHoverRadius: 6.4,   // 16 * 0.4 = 6.4 (réduction de 60%)
                borderWidth: 2,
                ...s
            };
        });
        
        charts.intensityRecovery = new window.Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Séances',
                    data: sessions,
                    backgroundColor: sessions.map(s => s.backgroundColor),
                    borderColor: sessions.map(s => s.borderColor),
                    pointRadius: sessions.map(s => s.pointRadius),
                    pointHoverRadius: sessions.map(s => s.pointHoverRadius),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'nearest'
                },
                layout: {
                    padding: {
                        top: 20,
                        right: 20,
                        bottom: 20,
                        left: 20
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: '🎯 Profil de Vos Séances',
                        font: { size: 18, weight: 'bold' },
                        color: '#e2e8f0', // Couleur claire pour contraste
                        padding: 25
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        borderColor: '#475569',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            title: () => 'Détails de la séance',
                            label: (context) => {
                                const session = context.raw;
                                const date = new Date(session.date).toLocaleDateString('fr-FR');
                                const category = getSessionCategory(session.charge, session.ratio, data.medians);
                                
                                return [
                                    `📅 ${date} (il y a ${session.days_ago} jours)`,
                                    `⚡ Densité: ${session.charge} points/min`,
                                    `⏱️ Récup: ${session.ratio} sec/point`,
                                    `💪 Volume: ${session.total_volume} points`,
                                    `⏳ Durée: ${session.total_duration_minutes}min`,
                                    `🎯 Type: ${category}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '⚡ Densité d\'Effort (points de volume par seconde)',
                            font: { size: 14, weight: 'bold' },
                            color: '#e2e8f0',
                            padding: 10
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.2)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#cbd5e1',
                            padding: 8
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: '⏱️ Besoin de Récupération (secondes de repos par point d\'effort)',
                            font: { size: 14, weight: 'bold' },
                            color: '#e2e8f0',
                            padding: 10
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.2)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#cbd5e1',
                            padding: 8,
                            // Améliorer l'affichage des petites valeurs
                            callback: function(value) {
                                return value.toFixed(3);
                            }
                        },
                        // Forcer un min/max pour mieux étaler les points
                        suggestedMin: 0,
                        suggestedMax: Math.max(...data.sessions.map(s => s.ratio)) * 1.2
                    }
                },
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                }
            },
            plugins: [{
                id: 'backgroundZones',
                beforeDraw: (chart) => {
                    const ctx = chart.ctx;
                    const chartArea = chart.chartArea;
                    const xScale = chart.scales.x;
                    const yScale = chart.scales.y;
                    
                    // Calculer les positions des médianes
                    const medianX = xScale.getPixelForValue(data.medians.charge);
                    const medianY = yScale.getPixelForValue(data.medians.ratio);
                    
                    ctx.save();
                    
                    // Zone 1: Faible densité + Forte récup = "Séances Récupératives" (Vert)
                    ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
                    ctx.fillRect(chartArea.left, chartArea.top, medianX - chartArea.left, medianY - chartArea.top);
                    
                    // Zone 2: Forte densité + Forte récup = "Séances Exigeantes" (Orange)
                    ctx.fillStyle = 'rgba(249, 115, 22, 0.12)';
                    ctx.fillRect(medianX, chartArea.top, chartArea.right - medianX, medianY - chartArea.top);
                    
                    // Zone 3: Faible densité + Faible récup = "Séances Légères" (Bleu)
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
                    ctx.fillRect(chartArea.left, medianY, medianX - chartArea.left, chartArea.bottom - medianY);
                    
                    // Zone 4: Forte densité + Faible récup = "Séances Intenses" (Rouge)
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
                    ctx.fillRect(medianX, medianY, chartArea.right - medianX, chartArea.bottom - medianY);
                    
                    // Lignes de séparation plus visibles
                    ctx.strokeStyle = 'rgba(203, 213, 225, 0.6)';
                    ctx.setLineDash([8, 4]);
                    ctx.lineWidth = 1.5;
                    
                    // Ligne verticale (médiane densité)
                    ctx.beginPath();
                    ctx.moveTo(medianX, chartArea.top);
                    ctx.lineTo(medianX, chartArea.bottom);
                    ctx.stroke();
                    
                    // Ligne horizontale (médiane récupération)
                    ctx.beginPath();
                    ctx.moveTo(chartArea.left, medianY);
                    ctx.lineTo(chartArea.right, medianY);
                    ctx.stroke();
                    
                    // Labels des zones avec couleur claire
                    ctx.setLineDash([]);
                    ctx.fillStyle = '#e2e8f0';
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    
                    // Positions des labels
                    const leftX = chartArea.left + (medianX - chartArea.left) / 2;
                    const rightX = medianX + (chartArea.right - medianX) / 2;
                    const topY = chartArea.top + 25;
                    const bottomY = chartArea.bottom - 15;
                    
                    ctx.fillText('🌱 Récupératives', leftX, topY);
                    ctx.fillText('🔥 Exigeantes', rightX, topY);
                    ctx.fillText('😌 Légères', leftX, bottomY);
                    ctx.fillText('⚡ Intenses', rightX, bottomY);
                    
                    ctx.restore();
                }
            }]
        });
        
    } catch (error) {
        console.error('Erreur chargement graphique profil séances:', error);
    }
}
// Fonction helper pour catégoriser les séances
function getSessionCategory(charge, ratio, medians) {
    const highDensity = charge > medians.charge;
    const highRecovery = ratio > medians.ratio;
    
    if (!highDensity && highRecovery) return 'Récupérative 🌱';
    if (highDensity && highRecovery) return 'Exigeante 🔥';
    if (!highDensity && !highRecovery) return 'Légère 😌';
    if (highDensity && !highRecovery) return 'Intense ⚡';
    
    return 'Non catégorisée';
}


// Export des fonctions pour app.js
window.initStatsCharts = initStatsCharts;

})(); // Fin de l'IIFE - TRÈS IMPORTANT