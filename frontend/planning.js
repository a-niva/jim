/**
 * PLANNING MANAGER - Système complet de gestion du planning
 * Vue verticale des semaines, édition séances, drag-drop, scoring temps réel
 */

class PlanningManager {
    constructor(containerId = 'planningContainer') {
        this.containerId = containerId;
        this.container = null;
        this.currentWeek = this.getCurrentWeek();
        this.weeksData = new Map(); // Cache des semaines
        this.draggedSession = null;
        this.swapMode = null; // Pour le système de swap exercices
        
        // Configuration
        this.maxSessionsPerDay = 2;
        this.weeksToShow = 8; // 4 semaines passées + 4 futures
        
        // Bind methods
        this.handleSessionClick = this.handleSessionClick.bind(this);
        this.handleDeleteSession = this.handleDeleteSession.bind(this);

        // Nouvelles propriétés pour navigation
        this.activeWeekIndex = 0; // Index de la semaine active
        this.weekKeys = []; // Liste ordonnée des clés de semaines
        this.isCurrentWeekVisible = true; // Pour gérer le bouton "Aujourd'hui"
        
        // Support swipe mobile
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.isSwipeEnabled = window.innerWidth <= 768;
        
        // Bind nouveaux methods
        this.navigateToWeek = this.navigateToWeek.bind(this);
        this.goToToday = this.goToToday.bind(this);
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);
    }
    
    // ===== INITIALISATION =====
    
    async initialize() {
        this.container = document.getElementById(this.containerId || 'planningContainer');
        if (!this.container) {
            console.error(`Container ${this.containerId || 'planningContainer'} introuvable`);
            return false;
        }
        
        // S'assurer que la vue parent est visible
        const planningView = document.getElementById('planning');
        if (planningView) {
            planningView.classList.add('active');
            planningView.style.display = 'block';
            // Forcer la visibilité
            planningView.style.visibility = 'visible';
            planningView.style.opacity = '1';
        }
        
        try {
            await this.loadWeeksData();
            this.render();
            this.initializeEventListeners();
            console.log('✅ PlanningManager initialisé');
            return true;
        } catch (error) {
            console.error('❌ Erreur initialisation Planning:', error);
            this.renderError();
            return false;
        }
    }
    
    getCurrentWeek() {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Lundi
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek;
    }
    
    async loadWeeksData() {
        const startDate = new Date(this.currentWeek);
        startDate.setDate(startDate.getDate() - (3 * 7)); // 3 semaines avant
        
        for (let i = 0; i < this.weeksToShow; i++) {
            const weekStart = new Date(startDate);
            weekStart.setDate(weekStart.getDate() + (i * 7));
            
            const weekKey = this.getWeekKey(weekStart);
            const weekData = await this.loadWeekData(weekStart);
            this.weeksData.set(weekKey, weekData);
        }
    }
    
    async loadWeekData(weekStart) {
        try {
            const weekStartStr = weekStart.toISOString().split('T')[0];
            const response = await window.apiGet(
                `/api/users/${window.currentUser.id}/weekly-planning?week_start=${weekStartStr}`
            );
            
            return response || this.generateEmptyWeek(weekStart);
        } catch (error) {
            console.warn('Erreur chargement semaine, utilisation fallback:', error);
            return this.generateEmptyWeek(weekStart);
        }
    }
    
    generateEmptyWeek(weekStart) {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            days.push({
                date: date.toISOString().split('T')[0],
                dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
                dayNumber: date.getDate(),
                sessions: [],
                canAddSession: true,
                warnings: []
            });
        }
        return { planning_data: days, week_score: 0 };
    }
    
    // ===== RENDU INTERFACE =====
    

    render() {
        // Trier les semaines par date
        this.weekKeys = Array.from(this.weeksData.keys()).sort();
        
        // Trouver l'index de la semaine courante
        const currentWeekKey = this.getWeekKey(this.currentWeek);
        this.activeWeekIndex = this.weekKeys.indexOf(currentWeekKey);
        if (this.activeWeekIndex === -1) this.activeWeekIndex = 0;
        
        this.updateCurrentWeekVisibility();
        
        const weeksHtml = this.weekKeys
            .map((weekKey, index) => this.renderWeek(weekKey, this.weeksData.get(weekKey), index))
            .join('');
        
        this.container.innerHTML = `
            <div class="planning-header">
                <h2><i class="fas fa-calendar-alt"></i> Planning</h2>
                <div class="planning-actions">
                    <button class="btn btn-primary" onclick="planningManager.showAddSessionModal()">
                        <i class="fas fa-plus"></i> Nouvelle séance
                    </button>
                    <button class="btn btn-secondary" onclick="planningManager.refresh()">
                        <i class="fas fa-sync-alt"></i> Actualiser
                    </button>
                </div>
            </div>
            
            <div class="week-navigation">
                <div class="nav-buttons">
                    <button class="nav-btn" onclick="planningManager.navigateToWeek(-1)" id="prevWeekBtn">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                </div>
                
                <div class="week-indicator" id="weekIndicator">
                    <!-- Sera mis à jour dynamiquement -->
                </div>
                
                <div class="nav-buttons">
                    <button class="today-btn" onclick="planningManager.goToToday()" 
                            id="todayBtn" style="display: none;">
                        <i class="fas fa-home"></i> Aujourd'hui
                    </button>
                    <button class="nav-btn" onclick="planningManager.navigateToWeek(1)" id="nextWeekBtn">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
            
            <div class="weeks-container" id="weeksContainer">
                <div class="swipe-indicator left" id="swipeLeft">
                    <i class="fas fa-chevron-left"></i>
                </div>
                <div class="swipe-indicator right" id="swipeRight">
                    <i class="fas fa-chevron-right"></i>
                </div>
                ${weeksHtml}
            </div>
        `;
        
        this.updateWeekDisplay();
        this.initializeDragDrop();
        this.initializeSwipe();
    }
    
    renderWeek(weekKey, weekData, index) {
        const isCurrentWeek = weekKey === this.getWeekKey(this.currentWeek);
        const weekStart = this.parseWeekKey(weekKey);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const daysHtml = weekData.planning_data
            .map(day => this.renderDay(day))
            .join('');
        
        // AJOUTER cette ligne pour gérer la classe active
        const isActive = index === this.activeWeekIndex;
        
        return `
            <div class="week-section ${isCurrentWeek ? 'current-week' : ''} ${isActive ? 'active' : ''}" 
                 data-week="${weekKey}" data-index="${index}">
                <div class="week-header">
                    <h3>
                        ${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} - 
                        ${weekEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                        ${isCurrentWeek ? '<span class="current-badge">Cette semaine</span>' : ''}
                    </h3>
                    <div class="week-score">
                        <div class="week-gauge">
                            <div class="week-gauge-fill" style="width: ${weekData.week_score || 0}%"></div>
                        </div>
                        <span>${weekData.week_score || 0}/100</span>
                    </div>
                </div>
                <div class="days-grid">
                    ${daysHtml}
                </div>
            </div>
        `;
    }
    
    renderDay(day) {
        const isToday = day.date === new Date().toISOString().split('T')[0];
        const sessionsHtml = day.sessions
            .map(session => this.renderSession(session, day.date))
            .join('');
        
        const addZoneHtml = day.canAddSession && day.sessions.length < this.maxSessionsPerDay 
            ? `<div class="add-session-zone" onclick="planningManager.showAddSessionModal('${day.date}')">
                 <i class="fas fa-plus"></i>
                 <span>Ajouter séance</span>
               </div>`
            : '';
        
        return `
            <div class="day-card ${isToday ? 'today' : ''}" data-date="${day.date}">
                <div class="day-header">
                    <span class="day-name">${day.dayName}</span>
                    <span class="day-number">${day.dayNumber}</span>
                </div>
                
                <div class="day-sessions" data-day="${day.date}">
                    ${sessionsHtml}
                    ${addZoneHtml}
                </div>
                
                ${day.warnings?.length > 0 ? `
                    <div class="day-warnings">
                        ${day.warnings.map(w => `<div class="warning-item">${w}</div>`).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    renderSession(session, date) {
        const score = session.predicted_quality_score || session.quality_score || 75;
        const duration = session.estimated_duration || 45;
        const exerciseCount = session.exercises?.length || 0;
        
        return `
            <div class="session-card" 
                 data-session-id="${session.id}" 
                 data-date="${date}"
                 onclick="planningManager.handleSessionClick('${session.id}')">
                
                <div class="session-header">
                    <div class="session-score">
                        <div class="score-gauge" style="background: ${this.getScoreGradient(score)}">
                            <span>${score}</span>
                        </div>
                    </div>
                    <button class="session-delete" 
                            onclick="event.stopPropagation(); planningManager.handleDeleteSession('${session.id}')"
                            title="Supprimer">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="session-content">
                    <div class="session-meta">
                        <span><i class="fas fa-clock"></i> ${duration}min</span>
                        <span><i class="fas fa-dumbbell"></i> ${exerciseCount} ex.</span>
                    </div>
                    
                    ${session.primary_muscles?.length > 0 ? `
                        <div class="session-muscles">
                            ${session.primary_muscles.slice(0, 3).map(muscle => 
                                `<span class="muscle-tag" style="background: ${this.getMuscleColor(muscle)}">${muscle}</span>`
                            ).join('')}
                            ${session.primary_muscles.length > 3 ? `<span class="muscle-more">+${session.primary_muscles.length - 3}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    // ===== DRAG & DROP SÉANCES =====
    
    initializeDragDrop() {
        // Attendre que SortableJS soit disponible
        if (typeof Sortable === 'undefined') {
            console.warn('SortableJS pas encore chargé, retry dans 100ms');
            setTimeout(() => this.initializeDragDrop(), 100);
            return;
        }
        
        console.log('✅ Initialisation drag-drop avec SortableJS');
        
        const dayContainers = this.container.querySelectorAll('.day-sessions');
        
        dayContainers.forEach(container => {
            new Sortable(container, {
                group: 'planning-sessions',
                animation: 200,
                ghostClass: 'session-ghost',
                chosenClass: 'session-chosen',
                dragClass: 'session-dragging',
                
                filter: '.add-session-zone',
                preventOnFilter: false,
                
                onStart: (evt) => {
                    this.draggedSession = evt.item.dataset.sessionId;
                    evt.item.classList.add('dragging');
                },
                
                onEnd: (evt) => {
                    evt.item.classList.remove('dragging');
                },
                
                onAdd: async (evt) => {
                    const sessionId = evt.item.dataset.sessionId;
                    const targetDate = evt.to.dataset.day;
                    const sourceDate = evt.from.dataset.day;
                    
                    // Vérifier la limite de séances par jour
                    const targetSessions = evt.to.querySelectorAll('.session-card').length;
                    if (targetSessions > this.maxSessionsPerDay) {
                        window.showToast(`Maximum ${this.maxSessionsPerDay} séances par jour`, 'warning');
                        evt.from.appendChild(evt.item);
                        return;
                    }
                    
                    try {
                        await this.moveSession(sessionId, sourceDate, targetDate);
                    } catch (error) {
                        console.error('Erreur déplacement:', error);
                        evt.from.appendChild(evt.item);
                    }
                }
            });
        });
    }
    
    async moveSession(sessionId, sourceDate, targetDate) {
        try {
            const result = await window.apiPut(`/api/planned-sessions/${sessionId}/move`, {
                new_date: targetDate
            });
            
            if (result.success) {
                window.showToast('Séance déplacée', 'success');
                await this.refresh();
            } else if (result.warnings?.length > 0) {
                this.showMoveConfirmation(sessionId, targetDate, result.warnings);
            }
        } catch (error) {
            throw error;
        }
    }
    
    showMoveConfirmation(sessionId, targetDate, warnings) {
        const warningsHtml = warnings.map(w => `<div class="warning-item">${w}</div>`).join('');
        
        const modalContent = `
            <div class="move-confirmation">
                <h3>⚠️ Confirmer le déplacement</h3>
                <div class="warnings-list">${warningsHtml}</div>
                <p>Voulez-vous quand même déplacer cette séance ?</p>
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="planningManager.confirmMove('${sessionId}', '${targetDate}')">
                        Déplacer quand même
                    </button>
                    <button class="btn btn-secondary" onclick="window.closeModal()">
                        Annuler
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('Attention', modalContent);
    }
    
    async confirmMove(sessionId, targetDate) {
        try {
            await window.apiPut(`/api/planned-sessions/${sessionId}/move`, {
                new_date: targetDate,
                force_move: true
            });
            
            window.closeModal();
            window.showToast('Séance déplacée', 'success');
            await this.refresh();
        } catch (error) {
            window.showToast('Erreur lors du déplacement', 'error');
        }
    }
    
    // ===== GESTION SÉANCES =====
    
    async handleSessionClick(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        await this.showSessionEditModal(session);
    }
    
    async handleDeleteSession(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        const modalContent = `
            <div class="delete-confirmation">
                <h3>🗑️ Supprimer la séance</h3>
                <p>Êtes-vous sûr de vouloir supprimer cette séance ?</p>
                <div class="session-preview">
                    <strong>${session.exercises?.length || 0} exercices</strong> • 
                    <strong>${session.estimated_duration || 45} minutes</strong>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-danger" onclick="planningManager.confirmDelete('${sessionId}')">
                        Supprimer
                    </button>
                    <button class="btn btn-secondary" onclick="window.closeModal()">
                        Annuler
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('Confirmation', modalContent);
    }
    
    async confirmDelete(sessionId) {
        try {
            await window.apiDelete(`/api/planned-sessions/${sessionId}`);
            window.closeModal();
            window.showToast('Séance supprimée', 'success');
            await this.refresh();
        } catch (error) {
            window.showToast('Erreur lors de la suppression', 'error');
        }
    }
    
    // ===== MODAL ÉDITION SÉANCE =====
    
    async showSessionEditModal(session) {
        const exercises = session.exercises || [];
        const userContext = await window.getUserContext();
        
        // Calculer le scoring initial avec le vrai SessionQualityEngine
        let currentScore;
        try {
            currentScore = await window.SessionQualityEngine.calculateScore(exercises, userContext);
        } catch (error) {
            console.error('Erreur SessionQualityEngine:', error);
            currentScore = window.SessionQualityEngine.getFallbackScore();
        }
        
        const duration = this.calculateSessionDuration(exercises);
        
        const modalContent = `
            <div class="session-edit-modal">
                <div class="session-edit-header">
                    <h3>Édition de séance</h3>
                    <div class="session-live-stats">
                        <div class="live-score">
                            <label>Score qualité</label>
                            <div class="score-display" id="liveScore">
                                <div class="score-gauge" style="background: ${this.getScoreGradient(currentScore.total)}">
                                    <span id="scoreValue">${currentScore.total}</span>
                                </div>
                            </div>
                        </div>
                        <div class="live-duration">
                            <label>Durée estimée</label>
                            <div class="duration-display" id="liveDuration">
                                <i class="fas fa-clock"></i>
                                <span id="durationValue">${duration}</span> min
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="exercises-section">
                    <div class="exercises-header">
                        <h4>Exercices (${exercises.length})</h4>
                        <button class="btn btn-sm btn-primary" onclick="planningManager.applyOptimalOrder('${session.id}')">
                            <i class="fas fa-magic"></i> Ordre optimal
                        </button>
                    </div>
                    
                    <div class="exercises-list" id="sessionExercisesList">
                        ${exercises.map((ex, index) => this.renderEditableExercise(ex, index, session.id)).join('')}
                    </div>
                    
                    <button class="btn btn-secondary btn-add" onclick="planningManager.showAddExerciseModal('${session.id}')">
                        <i class="fas fa-plus"></i> Ajouter exercice
                    </button>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="planningManager.startSession('${session.id}')">
                        <i class="fas fa-play"></i> Démarrer séance
                    </button>
                    <button class="btn btn-secondary" onclick="window.closeModal()">
                        Fermer
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('Séance', modalContent);
        
        // Initialiser drag & drop pour les exercices
        setTimeout(() => {
            this.initializeExerciseDragDrop(session.id);
        }, 100);
    }
    
    renderEditableExercise(exercise, index, sessionId) {
        const duration = this.calculateExerciseDuration(exercise);
        
        return `
            <div class="exercise-item" data-exercise-id="${exercise.exercise_id}" data-index="${index}">
                <div class="exercise-drag-handle">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                
                <div class="exercise-details">
                    <div class="exercise-name">${exercise.exercise_name || exercise.name}</div>
                    <div class="exercise-params">
                        <span class="sets-reps">${exercise.sets || 3} × ${exercise.reps_min || 8}-${exercise.reps_max || 12}</span>
                        <span class="rest-time">${exercise.rest_seconds || 90}s repos</span>
                        <span class="duration">${duration}min</span>
                    </div>
                    ${exercise.muscle_groups?.length > 0 ? `
                        <div class="exercise-muscles">
                            ${exercise.muscle_groups.slice(0, 2).map(m => 
                                `<span class="muscle-tag small">${m}</span>`
                            ).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="exercise-actions">
                    <button class="btn-action btn-swap" 
                            onclick="planningManager.showSwapModal('${sessionId}', ${index})"
                            title="Remplacer">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                    <button class="btn-action btn-delete" 
                            onclick="planningManager.removeExercise('${sessionId}', ${index})"
                            title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    // ===== DRAG & DROP EXERCICES =====
    
    initializeExerciseDragDrop(sessionId) {
        const container = document.getElementById('sessionExercisesList');
        if (!container || typeof Sortable === 'undefined') return;
        
        new Sortable(container, {
            handle: '.exercise-drag-handle',
            animation: 200,
            ghostClass: 'exercise-ghost',
            chosenClass: 'exercise-chosen',
            
            onEnd: async (evt) => {
                if (evt.oldIndex !== evt.newIndex) {
                    await this.reorderExercises(sessionId, evt.oldIndex, evt.newIndex);
                }
            }
        });
    }
    
    async reorderExercises(sessionId, oldIndex, newIndex) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises) return;
            
            // Réorganiser localement
            const exercises = [...session.exercises];
            const [moved] = exercises.splice(oldIndex, 1);
            exercises.splice(newIndex, 0, moved);
            session.exercises = exercises;
            
            // Recalculer le scoring
            await this.updateLiveScoring(exercises);
            
            // Sauvegarder
            await this.saveSessionChanges(sessionId, { exercises });
            
        } catch (error) {
            console.error('Erreur réorganisation:', error);
            window.showToast('Erreur lors de la réorganisation', 'error');
        }
    }
    
    async removeExercise(sessionId, exerciseIndex) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises) return;
            
            session.exercises.splice(exerciseIndex, 1);
            
            // Mettre à jour l'affichage
            const container = document.getElementById('sessionExercisesList');
            if (container) {
                container.innerHTML = session.exercises
                    .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                    .join('');
                this.initializeExerciseDragDrop(sessionId);
            }
            
            // Recalculer scoring et durée
            await this.updateLiveScoring(session.exercises);
            this.updateLiveDuration(session.exercises);
            
            // Sauvegarder
            await this.saveSessionChanges(sessionId, { exercises: session.exercises });
            
            window.showToast('Exercice supprimé', 'success');
            
        } catch (error) {
            console.error('Erreur suppression exercice:', error);
            window.showToast('Erreur lors de la suppression', 'error');
        }
    }
    
    // ===== SYSTÈME SWAP EXERCICES =====
    
    async showSwapModal(sessionId, exerciseIndex) {
        const session = this.findSessionById(sessionId);
        const exercise = session?.exercises[exerciseIndex];
        if (!exercise) return;
        
        const primaryMuscle = exercise.muscle_groups?.[0];
        if (!primaryMuscle) {
            window.showToast('Impossible de trouver des alternatives', 'warning');
            return;
        }
        
        try {
            // Récupérer les alternatives depuis l'API
            const alternatives = await window.apiGet(
                `/api/exercises/alternatives/${exercise.exercise_id}?muscle_group=${primaryMuscle}&user_id=${window.currentUser.id}`
            );
            
            const modalContent = `
                <div class="swap-modal">
                    <div class="swap-header">
                        <h3>Remplacer : ${exercise.exercise_name}</h3>
                        <p>Muscle principal : <span class="muscle-tag">${primaryMuscle}</span></p>
                    </div>
                    
                    <div class="alternatives-list">
                        ${alternatives.map(alt => this.renderAlternative(alt, sessionId, exerciseIndex)).join('')}
                    </div>
                    
                    <div class="modal-actions">
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            Annuler
                        </button>
                    </div>
                </div>
            `;
            
            window.showModal('Alternatives', modalContent);
            
        } catch (error) {
            console.error('Erreur chargement alternatives:', error);
            window.showToast('Erreur lors du chargement des alternatives', 'error');
        }
    }
    
    renderAlternative(alternative, sessionId, exerciseIndex) {
        const score = Math.round((alternative.score || 0.75) * 100);
        
        return `
            <div class="alternative-item" onclick="planningManager.performSwap('${sessionId}', ${exerciseIndex}, ${alternative.exercise_id})">
                <div class="alternative-header">
                    <div class="alternative-name">${alternative.name}</div>
                    <div class="alternative-score">
                        <div class="score-badge" style="background: ${this.getScoreGradient(score)}">
                            ${score}
                        </div>
                    </div>
                </div>
                
                <div class="alternative-details">
                    <div class="alternative-muscles">
                        ${alternative.muscle_groups?.slice(0, 3).map(m => 
                            `<span class="muscle-tag small">${m}</span>`
                        ).join('')}
                    </div>
                    <div class="alternative-equipment">
                        ${alternative.equipment_required?.slice(0, 2).map(eq => 
                            `<span class="equipment-tag">${eq}</span>`
                        ).join('')}
                    </div>
                </div>
                
                ${alternative.reason_match ? `
                    <div class="alternative-reason">${alternative.reason_match}</div>
                ` : ''}
            </div>
        `;
    }
    
    async performSwap(sessionId, exerciseIndex, newExerciseId) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises) return;
            
            // Récupérer les détails du nouvel exercice
            const newExercise = await window.apiGet(`/api/exercises/${newExerciseId}`);
            
            // Remplacer l'exercice
            session.exercises[exerciseIndex] = {
                exercise_id: newExercise.id,
                exercise_name: newExercise.name,
                sets: session.exercises[exerciseIndex].sets || 3,
                reps_min: session.exercises[exerciseIndex].reps_min || 8,
                reps_max: session.exercises[exerciseIndex].reps_max || 12,
                rest_seconds: session.exercises[exerciseIndex].rest_seconds || 90,
                muscle_groups: newExercise.muscle_groups || []
            };
            
            // Fermer le modal
            window.closeModal();
            
            // Mettre à jour l'affichage
            const container = document.getElementById('sessionExercisesList');
            if (container) {
                container.innerHTML = session.exercises
                    .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                    .join('');
                this.initializeExerciseDragDrop(sessionId);
            }
            
            // Recalculer scoring
            await this.updateLiveScoring(session.exercises);
            
            // Sauvegarder
            await this.saveSessionChanges(sessionId, { exercises: session.exercises });
            
            window.showToast(`Exercice remplacé par ${newExercise.name}`, 'success');
            
        } catch (error) {
            console.error('Erreur swap exercice:', error);
            window.showToast('Erreur lors du remplacement', 'error');
        }
    }
    
    // ===== SCORING ET DURÉE TEMPS RÉEL =====
    
    async updateLiveScoring(exercises) {
        try {
            const userContext = await window.getUserContext();
            const score = await window.SessionQualityEngine.calculateScore(exercises, userContext);
            
            const scoreElement = document.getElementById('scoreValue');
            const scoreDisplay = document.getElementById('liveScore');
            
            if (scoreElement && scoreDisplay) {
                scoreElement.textContent = score.total;
                const gauge = scoreDisplay.querySelector('.score-gauge');
                if (gauge) {
                    gauge.style.background = this.getScoreGradient(score.total);
                }
                
                // Ajouter feedback visuel si amélioration
                if (score.reorderImprovement) {
                    const improvement = score.orderBonus || 0;
                    if (improvement > 0) {
                        window.showToast(`Score amélioré de ${improvement} points`, 'success');
                    }
                }
            }
            
        } catch (error) {
            console.warn('Erreur calcul scoring live:', error);
            // Fallback avec SessionQualityEngine.getFallbackScore()
            const fallbackScore = window.SessionQualityEngine.getFallbackScore();
            const scoreElement = document.getElementById('scoreValue');
            if (scoreElement) {
                scoreElement.textContent = fallbackScore.total;
            }
        }
    }
    
    updateLiveDuration(exercises) {
        const duration = this.calculateSessionDuration(exercises);
        const durationElement = document.getElementById('durationValue');
        if (durationElement) {
            durationElement.textContent = duration;
        }
    }
    
    calculateSessionDuration(exercises) {
        return exercises.reduce((total, ex) => {
            const sets = ex.sets || 3;
            const restTime = (ex.rest_seconds || 90) / 60; // minutes
            const exerciseTime = sets * 2.5; // ~2.5min par série en moyenne
            return total + exerciseTime + (restTime * (sets - 1));
        }, 0).toFixed(0);
    }
    
    calculateExerciseDuration(exercise) {
        const sets = exercise.sets || 3;
        const restTime = (exercise.rest_seconds || 90) / 60;
        return (sets * 2.5 + restTime * (sets - 1)).toFixed(0);
    }
    
    // ===== UTILITAIRES =====
    
    async refresh() {
        await this.loadWeeksData();
        this.render();
    }
    
    findSessionById(sessionId) {
        for (const [weekKey, weekData] of this.weeksData.entries()) {
            for (const day of weekData.planning_data) {
                const session = day.sessions.find(s => s.id === sessionId);
                if (session) return session;
            }
        }
        return null;
    }
    
    async saveSessionChanges(sessionId, changes) {
        try {
            await window.apiPut(`/api/planned-sessions/${sessionId}`, changes);
        } catch (error) {
            console.error('Erreur sauvegarde session:', error);
            throw error;
        }
    }
    
    async startSession(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session?.exercises?.length) {
            window.showToast('Cette séance n\'a pas d\'exercices', 'warning');
            return;
        }
        
        window.closeModal();
        
        const sessionData = {
            selected_exercises: session.exercises,
            is_from_program: true,
            program_id: window.currentUser.current_program_id,
            session_id: sessionId
        };
        
        await window.startProgramWorkout(sessionData);
    }
    
    async applyOptimalOrder(sessionId) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises) return;
            
            const userContext = { user_id: window.currentUser.id };
            const optimalOrder = await window.SessionQualityEngine.generateOptimalOrder(
                session.exercises, 
                userContext
            );
            
            session.exercises = optimalOrder;
            
            // Mettre à jour l'affichage
            const container = document.getElementById('sessionExercisesList');
            if (container) {
                container.innerHTML = session.exercises
                    .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                    .join('');
                this.initializeExerciseDragDrop(sessionId);
            }
            
            await this.updateLiveScoring(session.exercises);
            await this.saveSessionChanges(sessionId, { exercises: session.exercises });
            
            window.showToast('Ordre optimal appliqué', 'success');
            
        } catch (error) {
            console.error('Erreur ordre optimal:', error);
            window.showToast('Erreur lors de l\'optimisation', 'error');
        }
    }
    
    async showAddSessionModal(date = null) {
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        try {
            // Utiliser la fonction existante pour récupérer le programme
            const program = await window.apiGet(`/api/users/${window.currentUser.id}/programs/active`);
            
            if (!program?.weekly_structure) {
                window.showToast('Créez d\'abord un programme pour ajouter des séances', 'warning');
                return;
            }
            
            // Extraire tous les exercices disponibles (même logique que les autres modals)
            const allExercises = [];
            for (const day of program.weekly_structure) {
                allExercises.push(...(day.exercises || []));
            }
            
            const uniqueExercises = allExercises.filter((ex, index, arr) => 
                arr.findIndex(e => e.exercise_id === ex.exercise_id) === index
            );
            
            const modalContent = `
                <div class="add-session-modal">
                    <h3><i class="fas fa-plus"></i> Créer une séance</h3>
                    <p>Date : <strong>${new Date(targetDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></p>
                    
                    <div class="exercise-selection">
                        <h4>Sélectionner les exercices</h4>
                        <div class="exercise-grid" id="exerciseSelectionGrid">
                            ${uniqueExercises.map(ex => `
                                <label class="exercise-checkbox">
                                    <input type="checkbox" value="${ex.exercise_id}" data-exercise='${JSON.stringify(ex)}'>
                                    <div class="exercise-card">
                                        <strong>${ex.exercise_name}</strong>
                                        <small>${ex.muscle_group} • ${ex.sets || 3}×${ex.reps_min || 8}-${ex.reps_max || 12}</small>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="session-preview" id="sessionPreview">
                        <p>Sélectionnez des exercices pour voir l'aperçu</p>
                    </div>
                    
                    <div class="modal-actions">
                        <button class="btn btn-primary" id="createSessionBtn" disabled onclick="planningManager.createSession('${targetDate}')">
                            Créer la séance
                        </button>
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            Annuler
                        </button>
                    </div>
                </div>
            `;
            
            window.showModal('Nouvelle séance', modalContent);
            
            // Initialiser l'interactivité avec les fonctions existantes
            this.initializeSessionCreation();
            
        } catch (error) {
            console.error('Erreur ouverture modal ajout:', error);
            window.showToast('Erreur lors de l\'ouverture du modal', 'error');
        }
    }

    initializeSessionCreation() {
        const checkboxes = document.querySelectorAll('#exerciseSelectionGrid input[type="checkbox"]');
        const createBtn = document.getElementById('createSessionBtn');
        const previewDiv = document.getElementById('sessionPreview');
        
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
                
                if (selected.length === 0) {
                    previewDiv.innerHTML = '<p>Sélectionnez des exercices pour voir l\'aperçu</p>';
                    createBtn.disabled = true;
                    return;
                }
                
                const exercises = selected.map(input => JSON.parse(input.dataset.exercise));
                const duration = this.calculateSessionDuration(exercises);
                
                previewDiv.innerHTML = `
                    <div class="session-summary">
                        <p><strong>${exercises.length} exercices</strong> • <strong>${duration} minutes</strong></p>
                        <div class="exercise-list">
                            ${exercises.map(ex => `
                                <div class="exercise-item">${ex.exercise_name}</div>
                            `).join('')}
                        </div>
                    </div>
                `;
                
                createBtn.disabled = false;
            });
        });
    }

    async createSession(targetDate) {
        const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
        
        if (selected.length === 0) {
            window.showToast('Sélectionnez au moins un exercice', 'warning');
            return;
        }
        
        try {
            const exercises = selected.map(input => JSON.parse(input.dataset.exercise));
            
            const sessionData = {
                planned_date: targetDate,
                exercises: exercises,
                estimated_duration: parseInt(this.calculateSessionDuration(exercises)),
                primary_muscles: [...new Set(exercises.map(ex => ex.muscle_group))],
                status: 'planned'
            };
            
            await window.apiPost(`/api/users/${window.currentUser.id}/planned-sessions`, sessionData);
            
            window.closeModal();
            window.showToast('Séance créée avec succès', 'success');
            await this.refresh();
            
        } catch (error) {
            console.error('Erreur création séance:', error);
            window.showToast('Erreur lors de la création', 'error');
        }
    }
    
    showAddExerciseModal(sessionId) {
        // TODO: Implémenter modal d'ajout d'exercice
        window.showToast('Fonction à implémenter', 'info');
    }
    
    // ===== HELPERS =====
    
    getWeekKey(date) {
        const year = date.getFullYear();
        const week = this.getWeekNumber(date);
        return `${year}-W${week.toString().padStart(2, '0')}`;
    }
    
    parseWeekKey(weekKey) {
        const [year, week] = weekKey.split('-W');
        return this.getDateFromWeek(parseInt(year), parseInt(week));
    }
    
    getWeekNumber(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
        const week1 = new Date(d.getFullYear(), 0, 4);
        return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    }
    
    getDateFromWeek(year, week) {
        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const dow = simple.getDay();
        const ISOweekStart = simple;
        if (dow <= 4) {
            ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
        } else {
            ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
        }
        return ISOweekStart;
    }
    
    getScoreGradient(score) {
        if (score >= 85) return 'linear-gradient(135deg, #10b981, #059669)';
        if (score >= 70) return 'linear-gradient(135deg, #f59e0b, #d97706)';
        if (score >= 50) return 'linear-gradient(135deg, #ef4444, #dc2626)';
        return 'linear-gradient(135deg, #6b7280, #4b5563)';
    }
    
    getMuscleColor(muscle) {
        const colors = {
            'chest': '#ec4899', 'pectoraux': '#ec4899',
            'back': '#3b82f6', 'dos': '#3b82f6',
            'legs': '#10b981', 'jambes': '#10b981',
            'shoulders': '#f59e0b', 'epaules': '#f59e0b',
            'arms': '#8b5cf6', 'bras': '#8b5cf6',
            'abs': '#ef4444', 'abdominaux': '#ef4444'
        };
        return colors[muscle.toLowerCase()] || '#6b7280';
    }
    
    initializeEventListeners() {
        // Les event listeners sont définis inline dans le HTML pour plus de simplicité
        
        // détecter changement de taille d'écran pour swipe
        window.addEventListener('resize', () => {
            this.isSwipeEnabled = window.innerWidth <= 768;
        });
    }
    
    renderError() {
        this.container.innerHTML = `
            <div class="planning-error">
                <h3>Erreur de chargement</h3>
                <p>Impossible de charger le planning. Veuillez réessayer.</p>
                <button class="btn btn-primary" onclick="planningManager.initialize()">
                    Réessayer
                </button>
            </div>
        `;
    }


    /**
     * Navigation entre semaines
     */
    navigateToWeek(direction) {
        const newIndex = this.activeWeekIndex + direction;
        
        if (newIndex >= 0 && newIndex < this.weekKeys.length) {
            this.activeWeekIndex = newIndex;
            this.updateWeekDisplay();
            this.updateCurrentWeekVisibility();
        }
    }

    /**
     * Retour à la semaine courante
     */
    goToToday() {
        const currentWeekKey = this.getWeekKey(this.currentWeek);
        const currentIndex = this.weekKeys.indexOf(currentWeekKey);
        
        if (currentIndex !== -1) {
            this.activeWeekIndex = currentIndex;
            this.updateWeekDisplay();
            this.updateCurrentWeekVisibility();
        }
    }

    /**
     * Met à jour l'affichage de la semaine active
     */
    updateWeekDisplay() {
        // Masquer toutes les semaines
        document.querySelectorAll('.week-section').forEach(week => {
            week.classList.remove('active');
        });
        
        // Afficher la semaine active
        const activeWeek = document.querySelector(`[data-index="${this.activeWeekIndex}"]`);
        if (activeWeek) {
            activeWeek.classList.add('active');
        }
        
        // Mettre à jour l'indicateur
        this.updateWeekIndicator();
        
        // Mettre à jour les boutons de navigation
        this.updateNavigationButtons();
    }

    /**
     * Met à jour l'indicateur de semaine
     */
    updateWeekIndicator() {
        const indicator = document.getElementById('weekIndicator');
        if (!indicator) return;
        
        const weekKey = this.weekKeys[this.activeWeekIndex];
        if (!weekKey) return;
        
        const weekStart = this.parseWeekKey(weekKey);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const isCurrentWeek = weekKey === this.getWeekKey(this.currentWeek);
        
        indicator.innerHTML = `
            ${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} - 
            ${weekEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            ${isCurrentWeek ? '<br><small style="color: var(--primary);">Cette semaine</small>' : ''}
        `;
    }

    /**
     * Met à jour l'état des boutons de navigation
     */
    updateNavigationButtons() {
        const prevBtn = document.getElementById('prevWeekBtn');
        const nextBtn = document.getElementById('nextWeekBtn');
        
        if (prevBtn) {
            prevBtn.disabled = this.activeWeekIndex <= 0;
        }
        
        if (nextBtn) {
            nextBtn.disabled = this.activeWeekIndex >= this.weekKeys.length - 1;
        }
    }

    /**
     * Gère la visibilité du bouton "Aujourd'hui"
     */
    updateCurrentWeekVisibility() {
        const currentWeekKey = this.getWeekKey(this.currentWeek);
        const activeWeekKey = this.weekKeys[this.activeWeekIndex];
        
        this.isCurrentWeekVisible = (currentWeekKey === activeWeekKey);
        
        const todayBtn = document.getElementById('todayBtn');
        if (todayBtn) {
            todayBtn.style.display = this.isCurrentWeekVisible ? 'none' : 'inline-block';
        }
    }

    /**
     * Initialise le support swipe mobile
     */
    initializeSwipe() {
        if (!this.isSwipeEnabled) return;
        
        const container = document.getElementById('weeksContainer');
        if (!container) return;
        
        container.addEventListener('touchstart', this.handleTouchStart, { passive: true });
        container.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        container.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    }

    /**
     * Gestion du début de swipe
     */
    handleTouchStart(e) {
        this.touchStartX = e.touches[0].clientX;
    }

    /**
     * Gestion du mouvement de swipe
     */
    handleTouchMove(e) {
        if (!this.touchStartX) return;
        
        this.touchEndX = e.touches[0].clientX;
        const diffX = this.touchStartX - this.touchEndX;
        
        // Afficher les indicateurs de swipe
        const container = document.getElementById('weeksContainer');
        if (Math.abs(diffX) > 30) {
            container.classList.add('swiping');
            e.preventDefault(); // Empêcher le scroll horizontal
        }
    }

    /**
     * Gestion de la fin de swipe
     */
    handleTouchEnd(e) {
        const container = document.getElementById('weeksContainer');
        container.classList.remove('swiping');
        
        if (!this.touchStartX || !this.touchEndX) return;
        
        const diffX = this.touchStartX - this.touchEndX;
        const minSwipeDistance = 50;
        
        if (Math.abs(diffX) > minSwipeDistance) {
            if (diffX > 0) {
                // Swipe vers la gauche = semaine suivante
                this.navigateToWeek(1);
            } else {
                // Swipe vers la droite = semaine précédente
                this.navigateToWeek(-1);
            }
        }
        
        // Reset
        this.touchStartX = 0;
        this.touchEndX = 0;
    } 
}

// Export global
window.PlanningManager = PlanningManager;

// Auto-initialisation si on est sur la vue planning
document.addEventListener('DOMContentLoaded', () => {
    // L'initialisation sera gérée par showView('planning')
});

// Fonction globale pour afficher le planning
window.showPlanning = async function() {
    console.log('🔍 showPlanning() appelée');
    
    // Fermer les modals ouverts
    if (window.closeModal) window.closeModal();
    
    // Afficher la vue planning
    window.showView('planning');
    
    // Forcer l'affichage après un court délai pour éviter la race condition
    setTimeout(async () => {
        const planningView = document.getElementById('planning');
        if (planningView) {
            planningView.style.display = 'block';
            planningView.classList.add('active');
        }
        
        if (!window.planningManager) {
            console.log('🆕 Création PlanningManager');
            window.planningManager = new PlanningManager();
        }
        
        const success = await window.planningManager.initialize();
        if (!success) {
            console.error('❌ Échec initialisation PlanningManager');
        }
    }, 100);
};

// ===== LOGIQUE BOUTON "PROGRAMME" =====

/**
 * Gère le bouton "Programme" sur le dashboard
 * - Si pas de programme → création de programme
 * - Si programme existe → choix entre les 3 prochaines séances
 */
window.showProgramInterface = async function() {
    try {
        // Vérifier si l'utilisateur a un programme actif
        const hasActiveProgram = await checkUserHasActiveProgram();
        
        if (!hasActiveProgram) {
            // Pas de programme → lancer la création
            await window.showProgramBuilder();
        } else {
            // Programme existe → afficher les prochaines séances
            await showUpcomingSessionsModal();
        }
        
    } catch (error) {
        console.error('Erreur interface programme:', error);
        window.showToast('Erreur lors du chargement', 'error');
    }
};

/**
 * Vérifie si l'utilisateur a un programme actif
 */
async function checkUserHasActiveProgram() {
    try {
        const response = await window.apiGet(`/api/users/${window.currentUser.id}/programs/active`);
        return response && response.id && response.weekly_structure;
    } catch (error) {
        console.log('Pas de programme actif:', error);
        return false;
    }
}

/**
 * Affiche le modal avec les 3 prochaines séances
 */
async function showUpcomingSessionsModal() {
    try {
        console.log('🔍 showUpcomingSessionsModal() appelée');
        
        // Récupérer les prochaines séances
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        
        const planning = await window.apiGet(
            `/api/users/${window.currentUser.id}/weekly-planning?week_start=${weekStartStr}`
        );
        
        if (!planning || !planning.planning_data) {
            showNoProgramSessionsModal();
            return;
        }
        
        // Extraire les 3 prochaines séances
        const upcomingSessions = [];
        for (const day of planning.planning_data) {
            for (const session of day.sessions || []) {
                if (new Date(day.date) >= new Date()) {
                    upcomingSessions.push({
                        ...session,
                        date: day.date,
                        dayName: new Date(day.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                    });
                }
            }
        }
        
        if (upcomingSessions.length === 0) {
            showNoProgramSessionsModal();
            return;
        }
        
        // Afficher le modal de choix
        const sessionsHtml = upcomingSessions.slice(0, 3).map((session, index) => `
            <button class="upcoming-session-btn" onclick="window.startSessionFromProgram('${session.id}')">
                <div class="session-info">
                    <h4>${session.dayName}</h4>
                    <p>${session.exercises?.length || 0} exercices • ${session.estimated_duration || 45}min</p>
                    <div class="session-score">
                        <div class="score-gauge-mini" style="background: ${getScoreColor(session.predicted_quality_score || 75)}">
                            ${session.predicted_quality_score || 75}
                        </div>
                    </div>
                </div>
                <i class="fas fa-play"></i>
            </button>
        `).join('');
        
        const modalContent = `
            <div class="upcoming-sessions-modal">
                <h3>Choisir votre séance</h3>
                <p>Sélectionnez une séance ou gérez votre planning :</p>
                
                <div class="upcoming-sessions">
                    ${sessionsHtml}
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="showPlanningFromProgram()">
                        <i class="fas fa-calendar"></i> Voir le planning complet
                    </button>
                    <button class="btn btn-outline" onclick="window.closeModal()">
                        Plus tard
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('Programme', modalContent);
        
    } catch (error) {
        console.error('Erreur récupération prochaines séances:', error);
        showNoProgramSessionsModal();
    }
}

/**
 * Extrait les 3 prochaines séances non complétées
 */
function getUpcomingSessions(planningData) {
    const sessions = [];
    const today = new Date().toISOString().split('T')[0];
    
    if (!planningData?.planning_data) return sessions;
    
    // Parcourir les jours à partir d'aujourd'hui
    for (const day of planningData.planning_data) {
        if (day.date >= today) {
            for (const session of day.sessions || []) {
                if (session.status !== 'completed' && sessions.length < 3) {
                    sessions.push({
                        ...session,
                        date: day.date,
                        dayName: day.dayName
                    });
                }
            }
        }
    }
    
    return sessions;
}

/**
 * Rendu d'une séance dans le modal des prochaines séances
 */
function renderUpcomingSession(session, index) {
    const isToday = session.date === new Date().toISOString().split('T')[0];
    const score = session.predicted_quality_score || 75;
    const duration = session.estimated_duration || 45;
    const exerciseCount = session.exercises?.length || 0;
    
    return `
        <div class="upcoming-session-card ${isToday ? 'today' : ''}" 
             onclick="startSessionFromProgram('${session.id}')">
            <div class="session-badge">
                ${index === 0 && isToday ? '<span class="today-badge">Aujourd\'hui</span>' : ''}
                ${index === 0 && !isToday ? '<span class="next-badge">Prochaine</span>' : ''}
            </div>
            
            <div class="session-info">
                <div class="session-date">
                    <i class="fas fa-calendar"></i>
                    ${new Date(session.date).toLocaleDateString('fr-FR', { 
                        weekday: 'long', 
                        day: 'numeric', 
                        month: 'long' 
                    })}
                </div>
                
                <div class="session-meta-row">
                    <span><i class="fas fa-clock"></i> ${duration}min</span>
                    <span><i class="fas fa-dumbbell"></i> ${exerciseCount} exercices</span>
                    <div class="session-score-mini">
                        <div class="score-dot" style="background: ${getScoreColor(score)}"></div>
                        ${score}/100
                    </div>
                </div>
                
                ${session.primary_muscles?.length > 0 ? `
                    <div class="session-muscles-mini">
                        ${session.primary_muscles.slice(0, 3).map(muscle => 
                            `<span class="muscle-dot" style="background: ${getMuscleColor(muscle)}"></span>`
                        ).join('')}
                        <span class="muscles-text">${session.primary_muscles.slice(0, 2).join(', ')}</span>
                    </div>
                ` : ''}
            </div>
            
            <div class="session-action">
                <i class="fas fa-play"></i>
            </div>
        </div>
    `;
}

/**
 * Démarre une séance depuis le modal Programme
 */
window.startSessionFromProgram = async function(sessionId) {
    try {
        window.closeModal();
        
        // Utiliser la même logique que le planning
        if (!window.planningManager) {
            window.planningManager = new PlanningManager();
        }
        
        // Simuler les données de session pour compatibility
        const sessionData = await window.apiGet(`/api/planned-sessions/${sessionId}`);
        
        if (!sessionData?.exercises?.length) {
            window.showToast('Cette séance n\'a pas d\'exercices', 'warning');
            return;
        }
        
        // Utiliser startProgramWorkout existant
        const workoutData = {
            selected_exercises: sessionData.exercises,
            is_from_program: true,
            program_id: window.currentUser.current_program_id,
            session_id: sessionId,
            session_type: 'planned'
        };
        
        window.currentWorkoutSession = {
            program: {
                id: window.currentUser.current_program_id,
                exercises: sessionData.exercises,
                session_duration_minutes: sessionData.estimated_duration
            },
            sessionId: sessionId,
            planned: true
        };
        
        await window.startProgramWorkout(workoutData);
        
    } catch (error) {
        console.error('Erreur démarrage séance depuis programme:', error);
        window.showToast('Erreur lors du démarrage', 'error');
    }
};

/**
 * Modal quand aucune séance n'est planifiée
 */
function showNoProgramSessionsModal() {
    const modalContent = `
        <div class="no-sessions-modal">
            <div class="empty-state">
                <i class="fas fa-calendar-times"></i>
                <h3>Aucune séance planifiée</h3>
                <p>Votre programme ne contient pas de séances pour les prochains jours.</p>
            </div>
            
            <div class="suggestions">
                <button class="btn btn-primary" onclick="window.closeModal(); window.showPlanning();">
                    <i class="fas fa-calendar-plus"></i> Planifier des séances
                </button>
                <button class="btn btn-secondary" onclick="window.closeModal(); window.startFreeWorkout();">
                    <i class="fas fa-dumbbell"></i> Séance libre
                </button>
            </div>
            
            <button class="btn btn-outline" onclick="window.closeModal()">
                Plus tard
            </button>
        </div>
    `;
    
    window.showModal('Programme', modalContent);
}

// Helpers pour les couleurs (réutilisent la logique du PlanningManager)
function getScoreColor(score) {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#f59e0b';
    if (score >= 50) return '#ef4444';
    return '#6b7280';
}

function getMuscleColor(muscle) {
    const colors = {
        'chest': '#ec4899', 'pectoraux': '#ec4899',
        'back': '#3b82f6', 'dos': '#3b82f6',
        'legs': '#10b981', 'jambes': '#10b981',
        'shoulders': '#f59e0b', 'epaules': '#f59e0b',
        'arms': '#8b5cf6', 'bras': '#8b5cf6',
        'abs': '#ef4444', 'abdominaux': '#ef4444'
    };
    return colors[muscle.toLowerCase()] || '#6b7280';
}

console.log('✅ Planning.js chargé avec logique Programme');
