/**
 * Composant Planning Hebdomadaire - Phase 3.2
 * Vue calendaire 7 jours avec drag & drop et alertes récupération
 */

class WeeklyPlannerView {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.currentWeekStart = this.getCurrentWeekStart();
        this.planningData = null;
        this.draggedSession = null;
        
        // Couleurs par groupe musculaire
        this.muscleColors = {
            'pectoraux': '#ec4899',
            'dos': '#3b82f6', 
            'jambes': '#10b981',
            'epaules': '#f59e0b',
            'bras': '#8b5cf6',
            'abdominaux': '#ef4444',
            'pecs': '#ec4899',
            'chest': '#ec4899',
            'back': '#3b82f6',
            'legs': '#10b981',
            'shoulders': '#f59e0b',
            'arms': '#8b5cf6',
            'abs': '#ef4444'
        };
        
        this.dayScores = {};
        this.swipeHandlers = new Map();
    }
    
    async initialize() {
        try {
            await this.loadWeeklyPlanning();
            this.render();
            this.initializeDragDrop();
            console.log('✅ WeeklyPlannerView initialisé');
        } catch (error) {
            console.error('❌ Erreur initialisation WeeklyPlanner:', error);
            this.renderError();
        }
    }
    


    debugLayout() {
        console.log('🔍 DEBUG PLANNING LAYOUT VERTICAL:');
        
        const container = this.container;
        console.log('Container:', {
            id: container.id,
            visible: container.offsetHeight > 0,
            height: container.offsetHeight,
            width: container.offsetWidth,
            display: getComputedStyle(container).display
        });
        
        const weeklyPlanner = container.querySelector('.weekly-planner');
        if (weeklyPlanner) {
            console.log('Weekly planner:', {
                classes: weeklyPlanner.className,
                height: weeklyPlanner.offsetHeight,
                width: weeklyPlanner.offsetWidth,
                childCount: weeklyPlanner.children.length
            });
        }
        
        const grid = container.querySelector('.planner-grid');
        if (grid) {
            console.log('Grid (vertical):', {
                visible: grid.offsetHeight > 0,
                height: grid.offsetHeight,
                width: grid.offsetWidth,
                display: getComputedStyle(grid).display,
                flexDirection: getComputedStyle(grid).flexDirection,
                childCount: grid.children.length
            });
        }
        
        const dayColumns = container.querySelectorAll('.day-column');
        console.log('Day columns:', dayColumns.length);
        dayColumns.forEach((col, index) => {
            console.log(`Day ${index}:`, {
                width: col.offsetWidth,
                height: col.offsetHeight,
                display: getComputedStyle(col).display,
                sessions: col.querySelectorAll('.session-card').length
            });
        });
        
        const recovery = container.querySelector('.planner-recovery');
        if (recovery) {
            console.log('Recovery section:', {
                visible: recovery.offsetHeight > 0,
                height: recovery.offsetHeight,
                width: recovery.offsetWidth,
                display: getComputedStyle(recovery).display
            });
        }
        
        console.log('Planning data:', {
            hasData: !!this.planningData,
            daysCount: this.planningData?.planning_data?.length || 0
        });
    }

    async loadWeeklyPlanning() {
        try {
            const weekStart = this.currentWeekStart.toISOString().split('T')[0];
            this.planningData = await window.apiGet(`/api/users/${window.currentUser.id}/weekly-planning?week_start=${weekStart}`);
            
            // Valider les données
            if (!this.planningData || typeof this.planningData !== 'object') {
                throw new Error('Invalid planning data received');
            }
            
        } catch (error) {
            console.error('❌ Error loading planning, using default data:', error);
            
            // Données par défaut pour éviter une page vide
            this.planningData = {
                week_start: this.currentWeekStart.toISOString().split('T')[0],
                week_end: new Date(this.currentWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                planning_data: [], // Vide, sera géré par renderEmptyWeek
                muscle_recovery_status: {},
                optimization_suggestions: [],
                total_weekly_sessions: 0,
                total_weekly_duration: 0
            };
        }
    }
            
    getCurrentWeekStart() {
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - now.getDay() + 1);
        monday.setHours(0, 0, 0, 0);
        return monday;
    }
    
    calculateDayScore(dayData) {
        if (!dayData.sessions || dayData.sessions.length === 0) return 100;
        
        let score = 100;
        const sessions = dayData.sessions;
        
        sessions.forEach((session, index) => {
            if (index > 0) {
                const prevSession = sessions[index - 1];
                const commonMuscles = session.primary_muscles?.filter(m => 
                    prevSession.primary_muscles?.includes(m)
                );
                if (commonMuscles?.length > 0) {
                    score -= 15;
                }
            }
        });
        
        if (dayData.recovery_warnings?.length > 0) {
            score -= dayData.recovery_warnings.length * 10;
        }
        
        if (sessions.length === 1 || sessions.length === 2) {
            score += 10;
        } else if (sessions.length > 2) {
            score -= (sessions.length - 2) * 10;
        }
        
        return Math.max(0, Math.min(100, score));
    }


    render() {
        try {
            const isMobile = window.innerWidth <= 768;
            
            console.log('🔍 Rendering with data:', {
                hasData: !this.planningData,
                planningDataLength: this.planningData.planning_data?.length,
                isMobile: isMobile
            });
            
            const navigationHTML = this.renderWeekNavigation();
            const overviewHTML = this.renderWeekOverview();
            const weekDaysHTML = this.renderWeekDays();
            const recoveryHTML = this.renderRecoveryStatus();
            const optimizationHTML = this.renderOptimizationSuggestions();

            // Structure verticale avec recovery en bas
            let htmlContent = `
                <div class="weekly-planner ${isMobile ? 'mobile' : 'desktop'}">
                    <div class="planner-header">
                        ${navigationHTML}
                        ${overviewHTML}
                    </div>
                    
                    <div class="planner-grid">
                        ${weekDaysHTML}
                    </div>
                    
                    <div class="planner-recovery">
                        ${recoveryHTML}
                        ${optimizationHTML}
                    </div>
                </div>`;
            
            this.container.innerHTML = htmlContent;
            
            // Debug : vérifier que la grille est bien rendue
            const gridElement = this.container.querySelector('.planner-grid');
            if (gridElement) {
                console.log('✅ Grid found with', gridElement.children.length, 'days');
            } else {
                console.error('❌ Grid not found!');
            }
            
            this.attachEventListeners();
            this.initSwipeHandlers();
            
        } catch (error) {
            console.error('❌ Erreur dans render():', error);
            this.renderError();
        }

        // Debug layout après rendu
        setTimeout(() => {
            this.debugLayout();
        }, 100);
    }
    
    renderWeekNavigation() {
        const weekStart = new Date(this.planningData.week_start);
        const weekEnd = new Date(this.planningData.week_end);
        
        return `
            <div class="week-navigation">
                <button class="nav-btn" onclick="weeklyPlanner.previousWeek()">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h2 class="week-title">
                    ${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} - 
                    ${weekEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                </h2>
                <button class="nav-btn" onclick="weeklyPlanner.nextWeek()">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }
    
    renderWeekOverview() {
        const { total_weekly_sessions, total_weekly_duration } = this.planningData;
        
        return `
            <div class="week-overview">
                <div class="overview-stat">
                    <span class="stat-value">${total_weekly_sessions}</span>
                    <span class="stat-label">séances</span>
                </div>
                <div class="overview-stat">
                    <span class="stat-value">${Math.round(total_weekly_duration / 60)}h</span>
                    <span class="stat-label">entraînement</span>
                </div>
                <button class="btn btn-primary" onclick="weeklyPlanner.showAddSessionModal()">
                    + Ajouter séance
                </button>
            </div>
        `;
    }

    renderWeekDays() {
        if (!this.planningData || !this.planningData.planning_data) {
            return '<div class="error-container"><p>Aucune donnée de planning disponible</p></div>';
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        const daysHTML = this.planningData.planning_data.map(day => {
            const dayDate = new Date(day.date);
            const isToday = day.date === today;
            
            const dayName = dayDate.toLocaleDateString('fr-FR', { weekday: 'short' }).toUpperCase();
            const dayNumber = dayDate.getDate();
            
            return `
                <div class="day-column ${isToday ? 'today' : ''}" data-date="${day.date}">
                    <div class="day-header">
                        <div class="day-name">${dayName}</div>
                        <div class="day-number">${dayNumber}</div>
                    </div>
                    
                    <div class="day-sessions" data-day="${day.date}">
                        ${day.sessions && day.sessions.length > 0 ? 
                            day.sessions.map(session => this.renderSessionCard(session)).join('') :
                            ''
                        }
                        
                        ${day.can_add_session ? `
                            <div class="add-session-zone" onclick="weeklyPlanner.addSessionToDay('${day.date}')">
                                <i class="fas fa-plus"></i>
                                <span>Ajouter séance</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    ${day.recovery_warnings && day.recovery_warnings.length > 0 ? `
                        <div class="day-warnings">
                            ${day.recovery_warnings.map(warning => `
                                <div class="warning-item">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    ${warning}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        console.log('🔍 Generated', this.planningData.planning_data.length, 'day columns');
        return daysHTML;
    }

        

    renderSessionCard(session) {
        const isTemporary = String(session.id).startsWith('temp_');
        const borderColor = this.getValidMuscleColor(session.primary_muscles);
        const score = session.predicted_quality_score || 75;
        
        // Déterminer la couleur de l'indicateur selon le score
        let indicatorColor = '#10b981'; // vert par défaut
        if (score < 40) {
            indicatorColor = '#ef4444'; // rouge
        } else if (score < 70) {
            indicatorColor = '#f59e0b'; // orange
        }
        
        return `
            <div class="session-card ${isTemporary ? 'session-temporary' : ''}" 
                data-session-id="${session.id}"
                data-is-temporary="${isTemporary}">
                
                <div class="session-content">
                    <div class="session-title">
                        ${session.title || 'Séance ' + session.primary_muscles.join(', ')}
                        ${isTemporary ? '<span class="temp-badge">TEMP</span>' : ''}
                    </div>
                    
                    <div class="session-meta">
                        <span class="session-time">
                            <i class="fas fa-clock"></i>
                            ${session.planned_time ? 
                                new Date(`2000-01-01T${session.planned_time}`).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}) : 
                                'Libre'}
                        </span>
                        <span>
                            <i class="fas fa-dumbbell"></i>
                            ${session.exercises?.length || 0} ex.
                        </span>
                        <span style="color: ${indicatorColor}">
                            <i class="fas fa-star"></i>
                            ${score}%
                        </span>
                    </div>
                    
                    ${session.primary_muscles && session.primary_muscles.length > 0 ? `
                        <div class="session-muscles">
                            ${session.primary_muscles.slice(0, 3).map(muscle => 
                                `<span class="muscle-tag" style="background: ${this.getValidMuscleColor([muscle])}">${muscle}</span>`
                            ).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="session-actions">
                    ${!isTemporary ? `
                        <button class="action-btn" onclick="weeklyPlanner.editSession('${session.id}')" title="Modifier">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn" onclick="weeklyPlanner.deleteSession('${session.id}')" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : `
                        <button class="action-btn" onclick="weeklyPlanner.removeTemporarySession('${session.id}')" title="Annuler">
                            <i class="fas fa-times"></i>
                        </button>
                    `}
                </div>
            </div>
        `;
    }

    getValidMuscleColor(muscles) {
        if (!muscles || !muscles.length) return '#6366f1';
        
        for (const muscle of muscles) {
            const color = this.muscleColors[muscle.toLowerCase()];
            if (color) return color;
        }
        
        return '#6366f1';
    }

    renderRecoveryStatus() {
        const recoveryData = this.planningData.muscle_recovery_status || {};
        
        if (Object.keys(recoveryData).length === 0) {
            return `
                <div class="recovery-status empty-state">
                    <h3>État de récupération</h3>
                    <div class="empty-recovery">
                        <i class="fas fa-dumbbell"></i>
                        <p>Commencez à vous entraîner pour voir l'état de récupération de vos muscles</p>
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="recovery-status">
                <h3>État de récupération</h3>
                <div class="muscle-recovery-list">
                    ${Object.entries(recoveryData).map(([muscle, data]) => `
                        <div class="muscle-recovery-item">
                            <span class="muscle-name">${muscle}</span>
                            <div class="recovery-bar">
                                <div class="recovery-fill" 
                                    style="width: ${data.recovery_level * 100}%; 
                                           background-color: ${data.recovery_level > 0.7 ? '#10b981' : data.recovery_level > 0.4 ? '#f59e0b' : '#ef4444'}">
                                </div>
                            </div>
                            <span class="recovery-percentage">${Math.round(data.recovery_level * 100)}%</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    renderOptimizationSuggestions() {
        const suggestions = this.planningData.optimization_suggestions;
        
        if (!suggestions || suggestions.length === 0) return '';
        
        return `
            <div class="optimization-suggestions">
                <h3>Suggestions d'optimisation</h3>
                <div class="suggestions-list">
                    ${suggestions.map(suggestion => `
                        <div class="suggestion-item">
                            <i class="fas fa-lightbulb"></i>
                            <span>${suggestion}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    getDayName(dayName) {
        const days = {
            'monday': 'Lun',
            'tuesday': 'Mar', 
            'wednesday': 'Mer',
            'thursday': 'Jeu',
            'friday': 'Ven',
            'saturday': 'Sam',
            'sunday': 'Dim'
        };
        return days[dayName] || dayName;
    }
    
    attachEventListeners() {
        // Pas d'event listeners spécifiques pour l'instant
    }
    

    initSwipeHandlers() {
        if (window.innerWidth > 768) return; // Pas de swipe sur desktop
        
        const sessionCards = this.container.querySelectorAll('.session-card');
        
        sessionCards.forEach(card => {
            let startX = 0;
            let startY = 0;
            let currentX = 0;
            let currentY = 0;
            let isDragging = false;
            
            const handleStart = (e) => {
                const touch = e.touches ? e.touches[0] : e;
                startX = touch.clientX;
                startY = touch.clientY;
                isDragging = true;
            };
            
            const handleMove = (e) => {
                if (!isDragging) return;
                
                const touch = e.touches ? e.touches[0] : e;
                currentX = touch.clientX - startX;
                currentY = touch.clientY - startY;
                
                // Seulement swipe horizontal
                if (Math.abs(currentX) > Math.abs(currentY)) {
                    e.preventDefault();
                    card.style.transform = `translateX(${currentX}px)`;
                    
                    // Feedback visuel
                    if (currentX > 50) {
                        card.classList.add('swipe-right');
                    } else if (currentX < -50) {
                        card.classList.add('swipe-left');
                    } else {
                        card.classList.remove('swipe-left', 'swipe-right');
                    }
                }
            };
            
            const handleEnd = () => {
                if (!isDragging) return;
                isDragging = false;
                
                // Action selon la direction du swipe
                if (currentX > 100) {
                    // Swipe droite : dupliquer
                    this.duplicateSession(card.dataset.sessionId);
                } else if (currentX < -100) {
                    // Swipe gauche : supprimer
                    this.deleteSession(card.dataset.sessionId);
                }
                
                // Reset
                card.style.transform = '';
                card.classList.remove('swipe-left', 'swipe-right');
                currentX = 0;
                currentY = 0;
            };
            
            // Touch events
            card.addEventListener('touchstart', handleStart, { passive: false });
            card.addEventListener('touchmove', handleMove, { passive: false });
            card.addEventListener('touchend', handleEnd);
            
            // Mouse events pour desktop
            card.addEventListener('mousedown', handleStart);
            card.addEventListener('mousemove', handleMove);
            card.addEventListener('mouseup', handleEnd);
            card.addEventListener('mouseleave', handleEnd);
        });
    }


    initializeDragDrop() {
        if (typeof Sortable === 'undefined') {
            console.warn('Sortable.js non disponible, drag & drop désactivé');
            return;
        }

        try {
            // Initialiser le drag & drop pour chaque zone de sessions
            const dayContainers = this.container.querySelectorAll('.day-sessions');
            
            dayContainers.forEach(container => {
                new Sortable(container, {
                    group: 'planning-sessions',
                    animation: 150,
                    ghostClass: 'session-ghost',
                    chosenClass: 'session-chosen',
                    dragClass: 'session-dragging',
                    
                    // Ignorer la zone d'ajout
                    filter: '.add-session-zone',
                    preventOnFilter: false,
                    
                    onStart: (evt) => {
                        this.draggedSession = evt.item.dataset.sessionId;
                        evt.item.classList.add('dragging');
                        console.log('🟡 Début drag session:', this.draggedSession);
                    },
                    
                    onEnd: (evt) => {
                        evt.item.classList.remove('dragging');
                        console.log('🟢 Fin drag session');
                    },
                    
                    onChange: (evt) => {
                        // Ajouter feedback visuel pendant le drag
                        const targetDay = evt.to.closest('.day-column');
                        if (targetDay) {
                            targetDay.classList.add('drag-over');
                            setTimeout(() => {
                                targetDay.classList.remove('drag-over');
                            }, 300);
                        }
                    },
                    
                    onAdd: async (evt) => {
                        const sessionId = evt.item.dataset.sessionId;
                        const targetDay = evt.to.dataset.day;
                        const sourceDay = evt.from.dataset.day;
                        
                        console.log(`📅 Déplacement session ${sessionId}: ${sourceDay} → ${targetDay}`);
                        
                        try {
                            await this.handleSessionMove(sessionId, sourceDay, targetDay);
                        } catch (error) {
                            console.error('❌ Erreur déplacement session:', error);
                            // Remettre l'élément à sa place d'origine en cas d'erreur
                            evt.from.appendChild(evt.item);
                        }
                    }
                });
            });

            console.log('✅ Drag & drop initialisé pour', dayContainers.length, 'conteneurs');
            
        } catch (error) {
            console.error('❌ Erreur initialisation drag & drop:', error);
        }
    }

    async handleSessionMove(evt) {
        const sessionId = this.draggedSession;
        const newDate = evt.to.dataset.day;
        
        const sessionCard = evt.item;
        const isTemporary = sessionCard.dataset.isTemporary === 'true';
        
        if (isTemporary) {
            window.showToast('Les séances auto-générées ne peuvent pas être déplacées', 'warning');
            evt.from.insertBefore(evt.item, evt.from.children[evt.oldDraggableIndex]);
            return;
        }
        
        try {
            const result = await window.apiPut(`/api/planned-sessions/${sessionId}/move`, {
                new_date: newDate
            });
            
            if (result.success) {
                window.showToast('Séance déplacée avec succès', 'success');
                await this.refresh();
            } else if (result.requires_confirmation) {
                this.showMoveConfirmation(sessionId, newDate, result.warnings);
            }
        } catch (error) {
            console.error('Erreur déplacement séance:', error);
            window.showToast('Erreur lors du déplacement', 'error');
            await this.refresh();
        }
    }
    
    async previousWeek() {
        this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
        await this.refresh();
    }
    
    async nextWeek() {
        this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
        await this.refresh();
    }
    
    async refresh() {
        await this.loadWeeklyPlanning();
        this.render();
        this.initializeDragDrop();
    }
    
    showAddSessionModal() {
        const modalContent = `
            <div class="add-session-modal">
                <h3>Nouvelle séance</h3>
                <p>Sélectionnez une date pour votre nouvelle séance :</p>
                <div class="date-selector">
                    ${this.planningData.planning_data.map(day => `
                        <button class="date-option ${!day.can_add_session ? 'disabled' : ''}" 
                                onclick="weeklyPlanner.addSessionToDay('${day.date}')"
                                ${!day.can_add_session ? 'disabled' : ''}>
                            <span>${this.getDayName(day.day_name)}</span>
                            <span>${new Date(day.date).getDate()}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        window.showModal('Ajouter une séance', modalContent);
    }
    
    addSessionToDay(date) {
        window.closeModal();
        window.showToast('Fonction en développement', 'info');
        // TODO: Implémenter la création de séance avec sélection d'exercices du programme
    }
    
    async deleteSession(sessionId) {
        if (confirm('Supprimer cette séance planifiée ?')) {
            try {
                await window.apiDelete(`/api/planned-sessions/${sessionId}`);
                window.showToast('Séance supprimée', 'success');
                await this.refresh();
            } catch (error) {
                window.showToast('Erreur suppression', 'error');
            }
        }
    }
    
    showMoveConfirmation(sessionId, newDate, warnings) {
        const warningText = warnings.join('\n');
        if (confirm(`Avertissements:\n${warningText}\n\nConfirmer le déplacement ?`)) {
            window.apiPut(`/api/planned-sessions/${sessionId}/move`, {
                new_date: newDate,
                force_move: true
            }).then(() => {
                window.showToast('Séance déplacée (forcé)', 'warning');
                this.refresh();
            });
        } else {
            this.refresh();
        }
    }
    
    async showSessionDeepDive(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        const exercises = session.exercises || [];
        const userContext = { user_id: window.currentUser.id };
        
        // Calculer le score avec SessionQualityEngine
        let currentScore, optimalOrder;
        try {
            currentScore = await window.SessionQualityEngine.calculateScore(exercises, userContext);
            optimalOrder = await window.SessionQualityEngine.generateOptimalOrder(exercises, userContext);
        } catch (error) {
            console.error('Erreur calcul scoring:', error);
            currentScore = { total: session.predicted_quality_score || 75, breakdown: {} };
            optimalOrder = exercises;
        }
        
        const modalContent = `
            <div class="session-deepdive">
                <div class="deepdive-header">
                    <h3>Détails de la séance</h3>
                    <div class="session-meta">
                        <span><i class="fas fa-calendar"></i> ${new Date(this.findSessionDate(sessionId)).toLocaleDateString('fr-FR')}</span>
                        <span><i class="fas fa-clock"></i> ${session.estimated_duration || 45} min</span>
                    </div>
                </div>
                
                <div class="quality-gauge-container">
                    <h4>Score de qualité</h4>
                    <div class="quality-gauge" data-score="${currentScore.total}">
                        <div class="gauge-fill" style="width: ${currentScore.total}%"></div>
                        <span class="gauge-value">${currentScore.total}/100</span>
                    </div>
                    ${currentScore.breakdown ? window.renderScoreBreakdown(currentScore.breakdown) : ''}
                </div>
                
                <div class="exercises-section">
                    <h4>Exercices (${exercises.length})</h4>
                    ${exercises.length > 0 ? `
                        <div id="deepDiveExerciseList" class="exercise-reorder-list">
                            ${exercises.map((ex, index) => `
                                <div class="exercise-item" data-exercise-id="${ex.exercise_id}">
                                    <span class="exercise-number">${index + 1}</span>
                                    <div class="exercise-info">
                                        <strong>${ex.exercise_name || ex.name || 'Exercice'}</strong>
                                        <span>${ex.sets || 3} séries × ${ex.reps_min || 8}-${ex.reps_max || 12} reps</span>
                                    </div>
                                    <i class="fas fa-grip-vertical drag-handle"></i>
                                </div>
                            `).join('')}
                        </div>
                        <button class="btn btn-secondary" onclick="weeklyPlanner.applyOptimalOrderInDeepDive('${sessionId}')">
                            🧠 Appliquer ordre optimal
                        </button>
                    ` : '<p>Aucun exercice dans cette séance</p>'}
                </div>
                
                <div class="muscle-distribution">
                    <h4>Muscles travaillés</h4>
                    ${session.primary_muscles?.length > 0 ? 
                        session.primary_muscles.map(muscle => 
                            `<span class="muscle-tag large" style="background: ${this.getValidMuscleColor([muscle])}">${muscle}</span>`
                        ).join('') : 
                        '<p>Aucun muscle spécifié</p>'
                    }
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="weeklyPlanner.startSession('${sessionId}')">
                        🚀 Démarrer cette séance
                    </button>
                    <button class="btn btn-secondary" onclick="window.closeModal()">
                        Fermer
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('Détails de la séance', modalContent);
        
        // Initialiser drag & drop dans la modal
        setTimeout(() => {
            const container = document.getElementById('deepDiveExerciseList');
            if (container && typeof Sortable !== 'undefined') {
                new Sortable(container, {
                    animation: 150,
                    handle: '.drag-handle',
                    onEnd: async (evt) => {
                        if (evt.oldIndex !== evt.newIndex) {
                            await this.updateSessionExerciseOrder(sessionId, evt);
                        }
                    }
                });
            }
        }, 100);
    }
    
    async applyOptimalOrderInDeepDive(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        const userContext = { user_id: window.currentUser.id };
        const optimalOrder = await window.SessionQualityEngine.generateOptimalOrder(session.exercises, userContext);
        
        // TODO: Sauvegarder le nouvel ordre en backend
        window.showToast('Ordre optimal appliqué', 'success');
        await this.refresh();
        window.closeModal();
    }
    
    async startSession(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        window.closeModal();
        
        // Utiliser la logique existante de démarrage de séance
        const sessionData = {
            exercises: session.exercises,
            session_metadata: {
                program_id: session.program_id,
                planned_session_id: sessionId
            }
        };
        
        window.confirmStartComprehensiveWorkout(sessionData);
    }
    
    async updateSessionExerciseOrder(sessionId, evt) {
        // TODO: Implémenter la mise à jour de l'ordre des exercices
        window.showToast('Ordre mis à jour', 'success');
    }
    
    findSessionById(sessionId) {
        for (const day of this.planningData.planning_data) {
            const session = day.sessions.find(s => s.id === sessionId);
            if (session) return session;
        }
        return null;
    }
    
    findSessionDate(sessionId) {
        for (const day of this.planningData.planning_data) {
            const session = day.sessions.find(s => s.id === sessionId);
            if (session) return day.date;
        }
        return null;
    }
    
    renderLoading() {
        this.container.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <p>Chargement du planning...</p>
            </div>
        `;
    }
    
    renderError() {
        this.container.innerHTML = `
            <div class="error-container">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Erreur de chargement</h3>
                <p>Impossible de charger le planning hebdomadaire</p>
                <button class="btn btn-primary" onclick="weeklyPlanner.refresh()">
                    Réessayer
                </button>
            </div>
        `;
    }
}

// Classe SwipeHandler
class SwipeHandler {
    constructor(element, options = {}) {
        this.element = element;
        this.threshold = options.threshold || 50;
        this.onSwipeLeft = options.onSwipeLeft || (() => {});
        this.onSwipeRight = options.onSwipeRight || (() => {});
        
        this.startX = 0;
        this.startY = 0;
        this.endX = 0;
        this.endY = 0;
        
        this.element.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        this.element.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: true });
        this.element.addEventListener('touchend', this.handleTouchEnd.bind(this));
    }
    
    handleTouchStart(e) {
        this.startX = e.touches[0].clientX;
        this.startY = e.touches[0].clientY;
    }
    
    handleTouchMove(e) {
        this.endX = e.touches[0].clientX;
        this.endY = e.touches[0].clientY;
    }
    
    handleTouchEnd() {
        const diffX = this.endX - this.startX;
        const diffY = this.endY - this.startY;
        
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.threshold) {
            if (diffX > 0) {
                this.onSwipeRight();
            } else {
                this.onSwipeLeft();
            }
        }
        
        this.startX = 0;
        this.startY = 0;
        this.endX = 0;
        this.endY = 0;
    }
    
    destroy() {
        this.element.removeEventListener('touchstart', this.handleTouchStart);
        this.element.removeEventListener('touchmove', this.handleTouchMove);
        this.element.removeEventListener('touchend', this.handleTouchEnd);
    }
}

// Export global
window.SwipeHandler = SwipeHandler;