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
    }
    
    getCurrentWeekStart() {
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - now.getDay() + 1); // Lundi de cette semaine
        monday.setHours(0, 0, 0, 0);
        return monday;
    }
    
    render() {
        if (!this.planningData) {
            this.renderLoading();
            return;
        }
        
        const isMobile = window.innerWidth <= 768;
        
        this.container.innerHTML = `
            <div class="weekly-planner ${isMobile ? 'mobile' : 'desktop'}">
                <div class="planner-header">
                    ${this.renderWeekNavigation()}
                    ${this.renderWeekOverview()}
                </div>
                
                <div class="planner-grid">
                    ${this.renderWeekDays()}
                </div>
                
                ${!isMobile ? `
                    <div class="planner-sidebar">
                        ${this.renderRecoveryStatus()}
                        ${this.renderOptimizationSuggestions()}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Ajouter les event listeners après le rendu
        this.attachEventListeners();
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
        return this.planningData.planning_data.map(day => `
            <div class="day-column" data-date="${day.date}">
                <div class="day-header">
                    <h3>${this.getDayName(day.day_name)}</h3>
                    <span class="day-date">${new Date(day.date).getDate()}</span>
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
        `).join('');
    }
    
    renderSessionCard(session) {
        const muscleColors = session.primary_muscles?.map(muscle => 
            this.muscleColors[muscle] || '#6b7280'
        ) || ['#6b7280'];
        
        return `
            <div class="session-card" 
                 data-session-id="${session.id}"
                 style="border-left: 4px solid ${muscleColors[0]}">
                <div class="session-header">
                    <span class="session-time">
                        ${session.planned_time ? new Date(`2000-01-01T${session.planned_time}`).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}) : 'Pas d\'heure'}
                    </span>
                    <div class="session-actions">
                        <button class="action-btn" onclick="weeklyPlanner.editSession(${session.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn" onclick="weeklyPlanner.deleteSession(${session.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                <div class="session-content">
                    <div class="session-exercises">
                        ${session.exercises.length} exercices
                    </div>
                    <div class="session-duration">
                        ${session.estimated_duration || 0} min
                    </div>
                    ${session.predicted_quality_score ? `
                        <div class="session-score">
                            Score: ${Math.round(session.predicted_quality_score)}/100
                        </div>
                    ` : ''}
                </div>
                
                ${session.primary_muscles && session.primary_muscles.length > 0 ? `
                    <div class="session-muscles">
                        ${session.primary_muscles.map(muscle => `
                            <span class="muscle-tag" style="background: ${this.muscleColors[muscle] || '#6b7280'}">
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
    
    initializeDragDrop() {
        // Initialiser SortableJS pour le drag & drop entre jours
        const dayColumns = this.container.querySelectorAll('.day-sessions');
        
        dayColumns.forEach(column => {
            if (typeof Sortable !== 'undefined') {
                new Sortable(column, {
                    group: 'planning',
                    animation: 150,
                    ghostClass: 'session-ghost',
                    chosenClass: 'session-chosen',
                    onStart: (evt) => {
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
                // Fallback : ajouter des boutons up/down pour réorganiser
                this.addFallbackMoveButtons(column);
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
}

// Export global
window.WeeklyPlannerView = WeeklyPlannerView;