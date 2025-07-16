// ===== PROGRAM MANAGER VIEW =====
class ProgramManagerView {
    constructor() {
        this.program = null;
        this.currentWeekView = 1;
        this.initialized = false;
    }
    
    async initialize() {
        try {
            // Récupérer le programme actif format v2.0
            const response = await window.apiGet(`/api/users/${window.currentUser.id}/programs/active`);
            
            if (!response || response.format_version !== "2.0") {
                console.log("Aucun programme v2.0 trouvé");
                return false;
            }
            
            this.program = response;
            this.initialized = true;
            this.render();
            return true;
            
        } catch (error) {
            console.error("Erreur chargement programme:", error);
            window.showToast("Erreur lors du chargement du programme", "error");
            return false;
        }
    }
    
    render() {
        const container = document.getElementById('programManagerView');
        if (!container) {
            console.error("Container programManagerView non trouvé");
            return;
        }
        
        container.innerHTML = `
            <div class="program-manager-container">
                <div class="program-header">
                    <h2>${this.program.name}</h2>
                    <div class="program-meta">
                        <span class="meta-item">
                            <i class="fas fa-calendar-week"></i>
                            Semaine ${this.program.current_week} sur ${this.program.duration_weeks}
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-dumbbell"></i>
                            ${this.program.sessions_per_week} séances/semaine
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-clock"></i>
                            ${this.program.session_duration_minutes} min/séance
                        </span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${(this.program.current_week / this.program.duration_weeks) * 100}%"></div>
                        </div>
                        <span class="progress-text">${Math.round((this.program.current_week / this.program.duration_weeks) * 100)}% complété</span>
                    </div>
                </div>
                
                <div class="week-navigation">
                    <button class="btn-nav" onclick="window.programManager.previousWeek()" 
                        ${this.currentWeekView === 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <h3>Semaine ${this.currentWeekView}</h3>
                    <button class="btn-nav" onclick="window.programManager.nextWeek()"
                        ${this.currentWeekView === this.program.duration_weeks ? 'disabled' : ''}>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
                
                <div class="week-structure" id="weekStructureContainer">
                    ${this.renderWeekStructure()}
                </div>
                
                <div class="program-actions">
                    <button class="btn btn-primary" onclick="window.programManager.startCurrentSession()">
                        <i class="fas fa-play"></i>
                        Démarrer la séance du jour
                    </button>
                    <button class="btn btn-secondary" onclick="window.showWeeklyPlanning()">
                        <i class="fas fa-calendar-alt"></i>
                        Voir le planning hebdomadaire
                    </button>
                </div>
            </div>
        `;
    }
    
    renderWeekStructure() {
        const weekData = this.program.weekly_structure[this.currentWeekView - 1];
        if (!weekData || !weekData.sessions) {
            return '<p class="no-data">Aucune donnée pour cette semaine</p>';
        }
        
        return `
            <div class="sessions-grid">
                ${weekData.sessions.map((session, index) => `
                    <div class="session-card ${this.isCurrentSession(index + 1) ? 'current' : ''}">
                        <div class="session-header">
                            <h4>Séance ${index + 1}</h4>
                            <span class="session-focus">${this.getFocusLabel(session.focus)}</span>
                        </div>
                        <div class="session-details">
                            <p><i class="fas fa-list"></i> ${session.exercise_pool.length} exercices</p>
                            <p><i class="fas fa-clock"></i> ${session.target_duration || this.program.session_duration_minutes} min</p>
                        </div>
                        <div class="exercise-preview">
                            ${this.renderExercisePreview(session.exercise_pool.slice(0, 3))}
                            ${session.exercise_pool.length > 3 ? `<p class="more">+${session.exercise_pool.length - 3} autres...</p>` : ''}
                        </div>
                        ${this.program.base_quality_score ? `
                            <div class="quality-indicator">
                                <span class="quality-score" style="color: ${this.getScoreColor(this.program.base_quality_score)}">
                                    <i class="fas fa-star"></i> ${Math.round(this.program.base_quality_score)}%
                                </span>
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    renderExercisePreview(exercises) {
        return exercises.map(ex => `
            <div class="exercise-item-preview">
                <span class="exercise-name">${this.getExerciseName(ex.exercise_id)}</span>
                <span class="exercise-sets">${ex.sets}×${ex.reps_min}-${ex.reps_max}</span>
            </div>
        `).join('');
    }
    
    getExerciseName(exerciseId) {
        // Pour l'instant, retourner un placeholder
        // Dans une version complète, faire un lookup dans une table d'exercices
        return `Exercice #${exerciseId}`;
    }
    
    getFocusLabel(focus) {
        const labels = {
            'upper': 'Haut du corps',
            'lower': 'Bas du corps',
            'full': 'Corps complet',
            'push': 'Poussée',
            'pull': 'Tirage',
            'legs': 'Jambes',
            'core': 'Gainage'
        };
        return labels[focus] || focus;
    }
    
    getScoreColor(score) {
        if (score >= 80) return '#22c55e';
        if (score >= 60) return '#f59e0b';
        return '#ef4444';
    }
    
    isCurrentSession(sessionNumber) {
        return this.currentWeekView === this.program.current_week && 
               sessionNumber === this.program.current_session_in_week;
    }
    
    previousWeek() {
        if (this.currentWeekView > 1) {
            this.currentWeekView--;
            this.render();
        }
    }
    
    nextWeek() {
        if (this.currentWeekView < this.program.duration_weeks) {
            this.currentWeekView++;
            this.render();
        }
    }
    
    async startCurrentSession() {
        try {
            window.showToast("Démarrage de la séance...", "info");
            await window.startProgramWorkout();
        } catch (error) {
            console.error("Erreur démarrage séance:", error);
            window.showToast("Erreur lors du démarrage de la séance", "error");
        }
    }
}

// Instance globale
window.programManager = null;