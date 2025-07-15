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
        
        // Couleurs par groupe musculaire (réutilise les couleurs existantes)
        this.muscleColors = {
            'pectoraux': '#ec4899',
            'dos': '#3b82f6', 
            'jambes': '#10b981',
            'epaules': '#f59e0b',
            'bras': '#8b5cf6',
            'abdominaux': '#ef4444'
        };
        
        //  Scoring et swipe handler
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
    
    async loadWeeklyPlanning() {
        const weekStart = this.currentWeekStart.toISOString().split('T')[0];
        this.planningData = await window.apiGet(`/api/users/${window.currentUser.id}/weekly-planning?week_start=${weekStart}`);
        
        // AJOUTER CES LOGS TEMPORAIRES
        console.log('🔍 Planning data reçue:', this.planningData);
        console.log('🔍 Structure planning_data:', this.planningData?.planning_data);
    }
        
    getCurrentWeekStart() {
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - now.getDay() + 1); // Lundi de cette semaine
        monday.setHours(0, 0, 0, 0);
        return monday;
    }
    
    // Calculer le score d'un jour
    calculateDayScore(dayData) {
        if (!dayData.sessions || dayData.sessions.length === 0) return 100;
        
        let score = 100;
        const sessions = dayData.sessions;
        
        // Pénalité pour ordre non optimal
        sessions.forEach((session, index) => {
            if (index > 0) {
                const prevSession = sessions[index - 1];
                // Si même groupe musculaire consécutif, pénalité
                const commonMuscles = session.primary_muscles?.filter(m => 
                    prevSession.primary_muscles?.includes(m)
                );
                if (commonMuscles?.length > 0) {
                    score -= 15;
                }
            }
        });
        
        // Pénalité pour warnings de récupération
        if (dayData.recovery_warnings?.length > 0) {
            score -= dayData.recovery_warnings.length * 10;
        }
        
        // Bonus pour nombre optimal de séances (1-2 par jour)
        if (sessions.length === 1 || sessions.length === 2) {
            score += 10;
        } else if (sessions.length > 2) {
            score -= (sessions.length - 2) * 10;
        }
        
        return Math.max(0, Math.min(100, score));
    }

    render() {
        console.log('🔍 render() appelé, planningData:', this.planningData);
        
        if (!this.planningData) {
            console.log('⚠️ Pas de planningData, affichage loading');
            this.renderLoading();
            return;
        }
        
        console.log('🔍 Données planningData disponibles, structure:', Object.keys(this.planningData));
        
        const isMobile = window.innerWidth <= 768;
        
        try {
            console.log('🔍 Génération du contenu HTML...');
            
            const navigationHTML = this.renderWeekNavigation();
            console.log('✅ Navigation HTML généré');
            
            const overviewHTML = this.renderWeekOverview();
            console.log('✅ Overview HTML généré');
            
            const weekDaysHTML = this.renderWeekDays();
            console.log('✅ WeekDays HTML généré');
            
            // Méthodes pas encore implémentées - fallback temporaire
            const recoveryHTML = this.renderRecoveryStatus ? this.renderRecoveryStatus() : '<p>Recovery status en développement</p>';
            const optimizationHTML = this.renderOptimizationSuggestions ? this.renderOptimizationSuggestions() : '<p>Suggestions en développement</p>';
            
            this.container.innerHTML = `
                <div class="weekly-planner ${isMobile ? 'mobile' : 'desktop'}" style="min-height: 600px; height: auto; display: flex; flex-direction: column;">
                    <div class="planner-header">
                        ${navigationHTML}
                        ${overviewHTML}
                    </div>
                    
                    <div class="planner-grid">
                        ${weekDaysHTML}
                    </div>
                    
                    ${!isMobile ? `
                        <div class="planner-sidebar">
                            ${recoveryHTML}
                            ${optimizationHTML}
                        </div>
                    ` : ''}
                </div>
            `;
            
            console.log('✅ HTML injecté dans le conteneur');
            
            // DIAGNOSTIC VISIBILITÉ
            console.log('🔍 Conteneur styles:', {
                display: this.container.style.display,
                visibility: this.container.style.visibility,
                height: this.container.offsetHeight,
                width: this.container.offsetWidth,
                childrenCount: this.container.children.length
            });

            // Vérifier le premier enfant (weekly-planner div)
            const weeklyPlannerDiv = this.container.querySelector('.weekly-planner');
            if (weeklyPlannerDiv) {
                console.log('✅ Weekly planner div trouvé:', {
                    display: getComputedStyle(weeklyPlannerDiv).display,
                    height: weeklyPlannerDiv.offsetHeight,
                    childrenCount: weeklyPlannerDiv.children.length
                });
            } else {
                console.error('❌ Weekly planner div NON TROUVÉ !');
            }

            // Vérifier la grille
            const plannerGrid = this.container.querySelector('.planner-grid');
            if (plannerGrid) {
                console.log('✅ Planner grid trouvé:', {
                    display: getComputedStyle(plannerGrid).display,
                    gridTemplateColumns: getComputedStyle(plannerGrid).gridTemplateColumns,
                    height: plannerGrid.offsetHeight,
                    childrenCount: plannerGrid.children.length
                });
            } else {
                console.error('❌ Planner grid NON TROUVÉ !');
            }

            // Ajouter les event listeners après le rendu
            this.attachEventListeners();
            this.initSwipeHandlers(); // NOUVEAU
            console.log('✅ Event listeners attachés');
            
        } catch (error) {
            console.error('❌ Erreur dans render():', error);
            this.container.innerHTML = `<div class="error">Erreur de rendu: ${error.message}</div>`;
        }
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
                <button class="btn btn-primary" onclick="weeklyPlanner.addSession()">
                    + Ajouter séance
                </button>
            </div>
        `;
    }
        
    renderWeekDays() {
        const today = new Date().toISOString().split('T')[0];
        
        return this.planningData.planning_data.map(day => {
            const dayScore = this.calculateDayScore(day);
            this.dayScores[day.date] = dayScore;
            const isToday = day.date === today;
            
            // Couleur du score
            let scoreColor = '#10b981'; // vert
            if (dayScore < 40) scoreColor = '#ef4444'; // rouge
            else if (dayScore < 70) scoreColor = '#f59e0b'; // orange
            
            return `
                <div class="day-column ${isToday ? 'today' : ''}" data-date="${day.date}">
                    <div class="day-header">
                        <div>
                            <h3>${this.getDayName(day.day_name)}</h3>
                            <span class="day-date">${new Date(day.date).getDate()}</span>
                        </div>
                        <div class="day-score" style="--score-percent: ${dayScore}; --score-color: ${scoreColor}">
                            <div class="day-score-bg"></div>
                            <div class="day-score-center">${dayScore}</div>
                        </div>
                        ${day.recovery_warnings.length > 0 ? 
                            `<i class="fas fa-exclamation-triangle warning-icon" title="${day.recovery_warnings.join(', ')}"></i>` 
                            : ''
                        }
                    </div>
                    
                    <div class="day-sessions" data-day="${day.date}">
                        ${day.sessions.map(session => this.renderSessionCard(session)).join('')}
                        
                        ${day.can_add_session ? `
                            <div class="add-session-zone" onclick="weeklyPlanner.addSessionToDay('${day.date}')">
                                <i class="fas fa-plus"></i>
                                <span>Ajouter séance</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    ${day.recovery_warnings.length > 0 ? `
                        <div class="day-warnings">
                            ${day.recovery_warnings.map(warning => `
                                <div class="warning-item">${warning}</div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
        
    renderSessionCard(session) {
        // Détecter si c'est une session temporaire
        const isTemporary = String(session.id).startsWith('temp_');
        
        // Mapper et nettoyer les noms de muscles
        const getValidMuscleColor = (muscles) => {
            if (!muscles || !muscles.length) return '#6366f1';
            
            const muscleMapping = {
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
            
            for (const muscle of muscles) {
                const color = muscleMapping[muscle.toLowerCase()];
                if (color) return color;
            }
            
            return '#6366f1';
        };

        const borderColor = getValidMuscleColor(session.primary_muscles);
        const score = session.predicted_quality_score || 75;
        
        // Gradient de score
        let scoreGradient = `linear-gradient(90deg, #10b981 0%, #10b981 100%)`;
        if (score < 40) {
            scoreGradient = `linear-gradient(90deg, #ef4444 0%, #dc2626 100%)`;
        } else if (score < 70) {
            scoreGradient = `linear-gradient(90deg, #f59e0b 0%, #d97706 100%)`;
        }
        
        return `
            <div class="session-card ${isTemporary ? 'session-temporary' : ''}" 
                data-session-id="${session.id}"
                data-is-temporary="${isTemporary}"
                style="border-left-color: ${borderColor}">
                <div class="session-header">
                    <span class="session-time">
                        ${session.planned_time ? 
                            new Date(`2000-01-01T${session.planned_time}`).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}) : 
                            'Horaire libre'}
                    </span>
                    <div class="session-actions">
                        ${!isTemporary ? `
                            <button class="action-btn" onclick="weeklyPlanner.showSessionDeepDive('${session.id}')">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="action-btn" onclick="weeklyPlanner.editSession('${session.id}')">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="action-btn" onclick="weeklyPlanner.deleteSession('${session.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : `
                            <span class="temp-badge">Auto</span>
                        `}
                    </div>
                </div>
                
                <div class="session-content">
                    <div class="session-info">
                        <span><i class="fas fa-dumbbell"></i> ${session.exercises?.length || 0}</span>
                        <span><i class="fas fa-clock"></i> ${session.estimated_duration || 45}min</span>
                    </div>
                </div>
                
                <!-- Mini jauge de score -->
                <div class="session-score-bar">
                    <div class="session-score-fill" 
                        style="width: ${score}%; --score-gradient: ${scoreGradient}"></div>
                </div>
                
                ${session.primary_muscles && session.primary_muscles.length > 0 ? `
                    <div class="session-muscles">
                        ${session.primary_muscles.slice(0, 3).map(muscle => `
                            <span class="muscle-tag" style="background: ${this.muscleColors[muscle] || 'var(--bg-tertiary)'}22; color: ${this.muscleColors[muscle] || 'var(--text-muted)'}">
                                ${muscle}
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    renderRecoveryStatus() {
        const recoveryData = this.planningData.muscle_recovery_status;
        
        return `
            <div class="recovery-status">
                <h3>État de récupération</h3>
                <div class="recovery-list">
                    ${Object.entries(recoveryData).map(([muscle, data]) => `
                        <div class="recovery-item">
                            <span class="muscle-name">${muscle}</span>
                            <div class="recovery-bar">
                                <div class="recovery-fill" 
                                     style="width: ${data.recovery_level * 100}%; 
                                            background: ${data.recovery_level > 0.7 ? '#10b981' : data.recovery_level > 0.4 ? '#f59e0b' : '#ef4444'}">
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
    
    // ... Méthodes utilitaires et event handlers
    
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
        // Event listeners pour les interactions
        console.log('Event listeners attachés');
    }
    
    initSwipeHandlers() {
        // Mobile uniquement
        if (window.innerWidth > 768) return;
        
        // Swipe sur les cards de session
        document.querySelectorAll('.session-card').forEach(card => {
            const sessionId = card.dataset.sessionId;
            const handler = new SwipeHandler(card, {
                threshold: 50,
                onSwipeLeft: () => {
                    card.classList.add('swipe-left');
                    setTimeout(() => {
                        if (confirm('Supprimer cette séance ?')) {
                            this.deleteSession(sessionId);
                        } else {
                            card.classList.remove('swipe-left');
                        }
                    }, 300);
                },
                onSwipeRight: () => {
                    this.editSession(sessionId);
                }
            });
            this.swipeHandlers.set(sessionId, handler);
        });
        
        // Swipe sur le header pour navigation
        const header = this.container.querySelector('.week-navigation');
        if (header) {
            new SwipeHandler(header, {
                threshold: 100,
                onSwipeLeft: () => this.nextWeek(),
                onSwipeRight: () => this.previousWeek()
            });
        }
    }


    initializeDragDrop() {
        const dayColumns = this.container.querySelectorAll('.day-sessions');
        
        dayColumns.forEach(column => {
            if (typeof Sortable !== 'undefined') {
                new Sortable(column, {
                    group: 'planning',
                    animation: 150,
                    ghostClass: 'session-ghost',
                    chosenClass: 'session-chosen',
                    filter: '.session-temporary', // NOUVEAU : Exclure les sessions temporaires
                    onStart: (evt) => {
                        // Vérifier si c'est une session temporaire
                        if (evt.item.classList.contains('session-temporary')) {
                            evt.preventDefault();
                            window.showToast('Les séances auto-générées ne peuvent pas être déplacées', 'info');
                            return false;
                        }
                        this.draggedSession = evt.item.dataset.sessionId;
                    },
                    onEnd: async (evt) => {
                        if (evt.from !== evt.to) {
                            await this.handleSessionMove(evt);
                        }
                    }
                });
            } else {
                console.warn('SortableJS non disponible - drag & drop désactivé');
            }
        });
    }
    
    addFallbackMoveButtons(column) {
        // Méthode fallback si SortableJS n'est pas disponible
        const sessionCards = column.querySelectorAll('.session-card');
        sessionCards.forEach((card, index) => {
            const moveButtons = document.createElement('div');
            moveButtons.className = 'move-buttons';
            moveButtons.innerHTML = `
                <button class="move-btn up" ${index === 0 ? 'disabled' : ''} 
                        onclick="weeklyPlanner.moveSessionUp('${card.dataset.sessionId}')">↑</button>
                <button class="move-btn down" ${index === sessionCards.length - 1 ? 'disabled' : ''} 
                        onclick="weeklyPlanner.moveSessionDown('${card.dataset.sessionId}')">↓</button>
            `;
            card.appendChild(moveButtons);
        });
    }

    async handleSessionMove(evt) {
        const sessionId = this.draggedSession;
        const newDate = evt.to.dataset.day;
        
        // NOUVEAU : Vérifier si la session est temporaire
        const sessionCard = evt.item;
        const isTemporary = sessionCard.dataset.isTemporary === 'true';
        
        if (isTemporary) {
            window.showToast('Les séances auto-générées ne peuvent pas être déplacées', 'warning');
            // Restaurer la position originale
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
            await this.refresh(); // Restaurer l'état
        }
    }
    
    // Méthodes de navigation
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
    
    // Méthodes d'interaction
    addSession() {
        console.log('Ajouter nouvelle séance');
        // À implémenter : modal création séance
    }
    
    addSessionToDay(date) {
        console.log('Ajouter séance au jour:', date);
        // À implémenter : modal création séance pour un jour spécifique
    }
    
    editSession(sessionId) {
        console.log('Éditer séance:', sessionId);
        // À implémenter : modal édition séance
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
            this.refresh(); // Restaurer position
        }
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

    //  Modal de détails session
    showSessionDeepDive(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h2>Analyse de la séance</h2>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="session-deep-dive">
                        <div class="score-display">
                            <h3>Score de qualité</h3>
                            <div class="score-large">${session.predicted_quality_score || 0}/100</div>
                            <div class="score-breakdown">
                                <div class="breakdown-item">
                                    <span>Rotation musculaire</span>
                                    <span>${session.muscle_rotation_score || 0}/25</span>
                                </div>
                                <div class="breakdown-item">
                                    <span>Récupération</span>
                                    <span>${session.recovery_score || 0}/25</span>
                                </div>
                                <div class="breakdown-item">
                                    <span>Progression</span>
                                    <span>${session.progression_score || 0}/25</span>
                                </div>
                                <div class="breakdown-item">
                                    <span>Adhérence prédite</span>
                                    <span>${session.adherence_score || 0}/25</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="exercises-list">
                            <h3>Exercices planifiés</h3>
                            ${session.exercises?.map((ex, idx) => `
                                <div class="exercise-item">
                                    <span class="exercise-number">${idx + 1}</span>
                                    <span class="exercise-name">${ex.name}</span>
                                    <span class="exercise-sets">${ex.sets} × ${ex.reps}</span>
                                </div>
                            `).join('') || '<p>Aucun exercice planifié</p>'}
                        </div>
                    </div>
                    
                    <div class="modal-actions">
                        <button class="btn btn-primary" onclick="weeklyPlanner.startSession(${session.id})">
                            Commencer la séance
                        </button>
                        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        modal.onclick = () => modal.remove();
        document.body.appendChild(modal);
    }

    //  Helper pour trouver une session
    findSessionById(sessionId) {
        for (const day of this.planningData.planning_data) {
            const session = day.sessions.find(s => s.id == sessionId);
            if (session) return session;
        }
        return null;
    }
}

// Export global
window.WeeklyPlannerView = WeeklyPlannerView;


// NOUVEAU : Gestionnaire de swipe générique
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
        
        // Vérifier que c'est bien un swipe horizontal
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.threshold) {
            if (diffX > 0) {
                this.onSwipeRight();
            } else {
                this.onSwipeLeft();
            }
        }
        
        // Reset
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

window.SwipeHandler = SwipeHandler;