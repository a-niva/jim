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
                
                <div class="score-display" id="scoreDisplay" style="display: none;">
                    <h3>Score de Qualité</h3>
                    <div class="score-gauge">
                        <div class="score-value" id="currentScore">--%</div>
                        <div class="score-bar">
                            <div class="score-fill" id="scoreFill" style="width: 0%"></div>
                        </div>
                    </div>
                    <div class="score-feedback" id="scoreFeedback"></div>
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
                        <button class="btn-icon" onclick="window.programManager.editSession(${index})" title="Modifier">
                            <i class="fas fa-edit"></i>
                        </button>
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

    async editSession(sessionIndex) {
        const weekData = this.program.weekly_structure[this.currentWeekView - 1];
        const session = weekData.sessions[sessionIndex];
        
        // Afficher le score actuel
        const scoreDisplay = document.getElementById('scoreDisplay');
        if (scoreDisplay) {
            scoreDisplay.style.display = 'block';
            this.updateScoreDisplay(session.quality_score || 75);
        }
        
        // Créer le modal d'édition
        const modalContent = `
            <div class="session-editor">
                <h3>Modifier la séance ${sessionIndex + 1}</h3>
                <p class="session-focus">Focus: ${this.getFocusLabel(session.focus)}</p>
                
                <div class="sortable-instructions">
                    <i class="fas fa-info-circle"></i>
                    Glissez-déposez pour réorganiser les exercices
                </div>
                
                <div class="exercise-list-editable" id="editableExercises" data-session="${sessionIndex}">
                    ${session.exercise_pool.map((ex, idx) => `
                        <div class="exercise-item-editable" data-index="${idx}" data-exercise-id="${ex.exercise_id}">
                            <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
                            <span class="exercise-name">${ex.exercise_name || this.getExerciseName(ex.exercise_id)}</span>
                            <span class="exercise-sets">${ex.sets}×${ex.reps_min}-${ex.reps_max}</span>
                            <button class="btn-xs btn-swap" onclick="window.programManager.showAlternatives(${sessionIndex}, ${idx})">
                                <i class="fas fa-exchange-alt"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="window.programManager.saveSessionChanges(${sessionIndex})">
                        Enregistrer
                    </button>
                    <button class="btn btn-secondary" onclick="window.closeModal()">
                        Annuler
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('Modifier la séance', modalContent);
        
        // Initialiser Sortable après affichage du modal
        setTimeout(() => this.initializeSortable(sessionIndex), 100);
    }
    
    initializeSortable(sessionIndex) {
        const container = document.getElementById('editableExercises');
        if (!container) return;
        
        if (window.Sortable) {
            new window.Sortable(container, {
                handle: '.drag-handle',
                animation: 150,
                onEnd: async (evt) => {
                    // Calculer le nouvel ordre
                    const newOrder = Array.from(container.children).map(el => 
                        parseInt(el.dataset.index)
                    );
                    
                    // Appeler l'API pour sauvegarder et obtenir le nouveau score
                    await this.reorderExercises(sessionIndex, newOrder);
                }
            });
        }
    }
    
    async reorderExercises(sessionIndex, newOrder) {
        try {
            const response = await window.apiPut(
                `/api/programs/${this.program.id}/reorder-session`,
                {
                    week_index: this.currentWeekView - 1,
                    session_index: sessionIndex,
                    new_exercise_order: newOrder
                }
            );
            
            if (response.success) {
                // Mettre à jour le score affiché
                this.updateScoreDisplay(response.new_score);
                
                // Afficher le feedback
                const feedback = document.getElementById('scoreFeedback');
                if (feedback) {
                    feedback.textContent = response.message;
                    feedback.className = response.score_delta > 0 ? 'positive' : 
                                       response.score_delta < 0 ? 'negative' : 'neutral';
                }
                
                // Mettre à jour l'ordre localement
                const weekData = this.program.weekly_structure[this.currentWeekView - 1];
                const session = weekData.sessions[sessionIndex];
                const reordered = newOrder.map(idx => session.exercise_pool[idx]);
                session.exercise_pool = reordered;
                session.quality_score = response.new_score;
                
                window.showToast(response.message, response.score_delta >= 0 ? 'success' : 'warning');
            }
        } catch (error) {
            console.error('Erreur réorganisation:', error);
            window.showToast('Erreur lors de la réorganisation', 'error');
        }
    }
    
    async showAlternatives(sessionIndex, exerciseIndex) {
        try {
            const response = await window.apiGet(
                `/api/programs/${this.program.id}/exercise-alternatives?week_index=${this.currentWeekView - 1}&session_index=${sessionIndex}&exercise_index=${exerciseIndex}`
            );
            
            const modalContent = `
                <div class="alternatives-container">
                    <h3>Remplacer: ${response.current_exercise.name}</h3>
                    <p class="current-muscles">Muscles: ${response.current_exercise.muscle_groups.join(', ')}</p>
                    
                    <div class="alternatives-list">
                        ${response.alternatives.map(alt => `
                            <div class="alternative-item ${!alt.can_perform ? 'disabled' : ''}" 
                                 onclick="${alt.can_perform ? `window.programManager.selectAlternative(${sessionIndex}, ${exerciseIndex}, ${alt.exercise_id})` : ''}">
                                <div class="alternative-info">
                                    <h4>${alt.name}</h4>
                                    <p>${alt.muscle_groups.join(', ')}</p>
                                    <p class="difficulty">${alt.difficulty}</p>
                                </div>
                                <div class="alternative-score">
                                    <span class="score">${alt.score}%</span>
                                    ${!alt.can_perform ? '<span class="warning">Équipement manquant</span>' : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            window.showModal('Choisir une alternative', modalContent);
            
        } catch (error) {
            console.error('Erreur chargement alternatives:', error);
            window.showToast('Erreur lors du chargement des alternatives', 'error');
        }
    }
    
    async selectAlternative(sessionIndex, exerciseIndex, newExerciseId) {
        try {
            const response = await window.apiPost(
                `/api/programs/${this.program.id}/swap-exercise`,
                {
                    week_index: this.currentWeekView - 1,
                    session_index: sessionIndex,
                    exercise_index: exerciseIndex,
                    new_exercise_id: newExerciseId
                }
            );
            
            if (response.success) {
                // Mettre à jour localement
                const session = this.program.weekly_structure[this.currentWeekView - 1].sessions[sessionIndex];
                session.exercise_pool[exerciseIndex] = response.new_exercise;
                session.quality_score = response.new_score;
                
                // Fermer le modal et rafraîchir
                window.closeModal();
                this.editSession(sessionIndex); // Rouvrir l'éditeur avec les changements
                
                window.showToast(response.message, response.score_impact >= 0 ? 'success' : 'warning');
            }
        } catch (error) {
            console.error('Erreur remplacement exercice:', error);
            window.showToast('Erreur lors du remplacement', 'error');
        }
    }
    
    updateScoreDisplay(score) {
        const scoreValue = document.getElementById('currentScore');
        const scoreFill = document.getElementById('scoreFill');
        
        if (scoreValue) scoreValue.textContent = `${Math.round(score)}%`;
        if (scoreFill) {
            scoreFill.style.width = `${score}%`;
            scoreFill.style.backgroundColor = this.getScoreColor(score);
        }
    }
    
    async saveSessionChanges(sessionIndex) {
        window.closeModal();
        window.showToast('Modifications enregistrées', 'success');
        this.render(); // Rafraîchir l'affichage
    }

}

// Instance globale
window.programManager = null;