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

        // AJOUTER ces nouvelles propriétés pour Programme v2.0
        this.activeProgram = null;
        this.weeklyStructure = null;
        this.currentSortable = null; // Pour le drag & drop du modal de création
    }
    
    // ===== INITIALISATION =====
    
    async initialize() {
        this.container = document.getElementById(this.containerId || 'planningContainer');
        if (!this.container) {
            console.error(`Container ${this.containerId || 'planningContainer'} introuvable`);
            return false;
        }

        // NOUVEAU : Charger le programme actif AVANT de charger les semaines
        await this.loadActiveProgram();
        
        if (!this.activeProgram) {
            console.warn('⚠️ Aucun programme actif trouvé');
            this.showNoProgramMessage();
            return;
        }
        
        // Continuer avec le chargement normal

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

    // 3. AJOUTER cette nouvelle méthode pour charger le programme actif
    async loadActiveProgram() {
        try {
            const response = await window.apiGet(`/api/users/${window.currentUser.id}/programs/active`);
            // CORRECTIF : Le backend retourne directement l'objet programme
            if (response && response.id) {  // ← Vérifier .id au lieu de .program
                this.activeProgram = response;  // ← Utiliser response directement
                // Convertir le format si nécessaire
                if (response.weekly_structure) {
                    // Si c'est un array avec indices numériques, convertir en objet par jour
                    if (Array.isArray(response.weekly_structure)) {
                        this.weeklyStructure = this.convertArrayToWeeklyStructure(response.weekly_structure);
                    } else if (typeof response.weekly_structure === 'object') {
                        // Vérifier si les clés sont numériques
                        const keys = Object.keys(response.weekly_structure);
                        if (keys.every(k => !isNaN(k))) {
                            // Clés numériques, probablement un format de semaines
                            this.weeklyStructure = this.convertNumericToWeeklyStructure(response.weekly_structure);
                        } else {
                            // Format correct avec jours de la semaine
                            this.weeklyStructure = response.weekly_structure;
                        }
                    }
                } else {
                    this.weeklyStructure = {};
                }

                console.log('📅 Structure convertie:', this.weeklyStructure);
                console.log('📋 Programme actif chargé:', this.activeProgram.name);
                console.log('📅 Structure hebdomadaire:', this.weeklyStructure);
            } else {
                this.activeProgram = null;
                this.weeklyStructure = null;
            }
        } catch (error) {
            console.error('❌ Erreur chargement programme actif:', error);
            this.activeProgram = null;
            this.weeklyStructure = null;
        }
    }

    convertArrayToWeeklyStructure(arrayStructure) {
        console.log('🔄 Conversion array vers weekly_structure');
        const weeklyStructure = {};
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        // Si c'est un array de semaines
        if (arrayStructure.length > 0 && arrayStructure[0].sessions) {
            // Format: [{week: 1, sessions: [...]}, ...]
            const firstWeek = arrayStructure[0];
            firstWeek.sessions.forEach((session, index) => {
                const dayName = session.day || days[index % 7];
                if (!weeklyStructure[dayName]) {
                    weeklyStructure[dayName] = [];
                }
                weeklyStructure[dayName].push(session);
            });
        }
        
        return weeklyStructure;
    }

    convertNumericToWeeklyStructure(numericStructure) {
        console.log('🔄 Conversion clés numériques vers jours');
        const weeklyStructure = {};
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        // Parcourir les clés numériques
        Object.keys(numericStructure).forEach(key => {
            const dayIndex = parseInt(key);
            if (dayIndex >= 0 && dayIndex < 7) {
                const dayName = days[dayIndex];
                weeklyStructure[dayName] = numericStructure[key] || [];
            }
        });
        
        return weeklyStructure;
    }

    calculateExerciseDuration(exercise) {
        if (!exercise) return 5;
        
        const sets = exercise.sets || 3;
        const restSeconds = exercise.rest_seconds || 90;
        const timePerSet = exercise.exercise_type === 'isometric' ? 
            (exercise.reps_min || 30) / 60 :  // isometric: durée en minutes
            1.5; // autres: 1.5 min par série
        
        const restTime = ((sets - 1) * restSeconds) / 60; // minutes
        const workTime = sets * timePerSet;
        const setupTime = 1; // 1 min setup
        
        return Math.ceil(workTime + restTime + setupTime);
    }

    getMuscleGroupColor(muscleGroup) {
        const colorMap = {
            'chest': '#e74c3c',
            'back': '#3498db',
            'shoulders': '#f39c12',
            'arms': '#9b59b6',
            'legs': '#27ae60',
            'core': '#e67e22',
            'cardio': '#e91e63',
            'pectoraux': '#e74c3c',
            'dos': '#3498db',
            'épaules': '#f39c12',
            'bras': '#9b59b6',
            'jambes': '#27ae60',
            'abdominaux': '#e67e22'
        };
            
            const muscle = muscleGroup.toLowerCase();
            return colorMap[muscle] || '#6c757d';
        }

    getMuscleGroupIcon(muscle) {
        // Normaliser la clé
        const muscleKey = muscle.toLowerCase().replace(/[éè]/g, 'e');
        
        // Utiliser MUSCLE_GROUPS de app.js si disponible
        if (window.MUSCLE_GROUPS && window.MUSCLE_GROUPS[muscleKey]) {
            return window.MUSCLE_GROUPS[muscleKey].icon;
        }
        
        // Fallback avec mapping direct
        const iconMap = {
            'dos': '🔙',
            'pectoraux': '💪',
            'bras': '💪',
            'epaules': '🤷',
            'jambes': '🦵',
            'abdominaux': '🎯',
            'autres': '🏋️'
        };
        
        return iconMap[muscleKey] || '💪';
    }

    extractPrimaryMuscles(exercises) {
        if (!exercises || exercises.length === 0) return [];
        const muscles = new Set();
        exercises.forEach(ex => {
            if (ex.muscle_groups) {
                ex.muscle_groups.forEach(m => muscles.add(m));
            }
        });
        return Array.from(muscles).slice(0, 3); // Top 3
    }

    getCurrentWeek() {
        const now = new Date();
        const startOfWeek = new Date(now);
        // Correction du bug du dimanche
        const dayOfWeek = now.getDay();
        const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(now.getDate() + daysToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek;
    }
        
    async loadWeeksData() {
        const startDate = new Date(this.currentWeek);
        startDate.setDate(startDate.getDate() - (3 * 7)); // 3 semaines avant
        
        this.weeksData.clear();
        
        for (let i = 0; i < 8; i++) { // 8 semaines au total
            const weekStart = new Date(startDate.getTime());
            weekStart.setDate(startDate.getDate() + (i * 7));
            const weekKey = this.getWeekKey(weekStart);
            
            try {
                const weekData = await this.loadWeekData(weekStart);
                this.weeksData.set(weekKey, weekData);
                
                console.log(`✅ Semaine ${weekKey} chargée depuis le schedule`);
            } catch (error) {
                console.error(`❌ Erreur chargement semaine ${weekKey}:`, error);
                this.weeksData.set(weekKey, this.generateEmptyWeek(weekStart));
            }
        }
        
        console.log(`📋 Total semaines chargées: ${this.weeksData.size}`);
    }

    async loadWeekData(weekStart) {
        try {
            if (!this.activeProgram) {
                console.warn('Pas de programme actif, génération semaine vide');
                return this.generateEmptyWeek(weekStart);
            }
            
            // Format local pour éviter les problèmes timezone
            const year = weekStart.getFullYear();
            const month = String(weekStart.getMonth() + 1).padStart(2, '0');
            const day = String(weekStart.getDate()).padStart(2, '0');
            const weekStartStr = `${year}-${month}-${day}`;
            
            // CORRECTION : Utiliser le bon endpoint existant
            const response = await window.apiGet(
                `/api/programs/${this.activeProgram.id}/schedule?week_start=${weekStartStr}`
            );
            
            // CORRECTION : Transformer le format schedule vers planning_data
            return this.transformScheduleToWeekData(response, weekStart);
            
        } catch (error) {
            console.warn('Erreur chargement semaine, utilisation fallback:', error);
            return this.generateEmptyWeek(weekStart);
        }
    }

    transformScheduleToWeekData(scheduleResponse, weekStart) {
        const days = [];
        
        // ADAPTATION : scheduleResponse.schedule contient les sessions par date
        const scheduleData = scheduleResponse?.schedule || {};
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart.getTime()); // Clone propre
            date.setDate(weekStart.getDate() + i);
            // Utiliser format local pour éviter les problèmes timezone
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            // Chercher les sessions dans scheduleData pour cette date
            const sessions = [];
            if (scheduleData[dateStr]) {
                const sessionData = scheduleData[dateStr];
                sessions.push({
                    id: `${dateStr}_0`,
                    date: dateStr,
                    exercises: sessionData.exercises_snapshot || [],
                    estimated_duration: sessionData.estimated_duration || 60,
                    muscle_groups: sessionData.primary_muscles || [],
                    status: sessionData.status || 'planned',
                    predicted_quality_score: sessionData.predicted_score || 75,
                    time: sessionData.time || '18:00'
                });
            }
            
            days.push({
                date: dateStr,
                dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
                dayNumber: date.getDate(),
                sessions: sessions,
                canAddSession: sessions.length < 2,
                warnings: this.extractWarningsFromRecoveryStatus(scheduleResponse.muscle_recovery_status, dateStr)
            });
        }
        
        return { 
            planning_data: days, 
            week_score: this.calculateWeekScore(scheduleResponse)
        };
    }

    // Helpers pour extraire les données
    extractWarningsFromRecoveryStatus(recoveryStatus, dateStr) {
        // Transformer les warnings de récupération musculaire pour ce jour
        const warnings = [];
        if (recoveryStatus) {
            for (const [muscle, warning] of Object.entries(recoveryStatus)) {
                if (warning.includes(dateStr)) {
                    warnings.push(`Récupération ${muscle} : ${warning}`);
                }
            }
        }
        return warnings;
    }

    calculateWeekScore(scheduleResponse) {
        // Calculer le score de la semaine depuis les scores des sessions
        const sessions = Object.values(scheduleResponse?.schedule || {});
        if (sessions.length === 0) return 0;
        
        const avgScore = sessions.reduce((sum, session) => {
            return sum + (session.predicted_score || 0);
        }, 0) / sessions.length;
        
        return Math.round(avgScore);
    }

    generateWeekDataFromProgram(weekStart) {
        const days = [];
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart.getTime());
            date.setDate(weekStart.getDate() + i);
            // Format local cohérent
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const dayName = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i];
            
            // Récupérer les sessions depuis weekly_structure
            const sessionTemplates = this.activeProgram.weekly_structure[dayName] || [];
            
            // Vérifier si il y a une session dans le schedule pour cette date
            const scheduleSession = this.activeProgram.schedule?.[dateStr];
            
            const sessions = sessionTemplates.map((template, index) => ({
                id: `${dateStr}_${index}`,
                date: dateStr,
                exercises: template.exercises || [],
                estimated_duration: template.estimated_duration || 60,
                muscle_groups: template.primary_muscles || [],
                status: scheduleSession?.status || 'planned',
                predicted_quality_score: template.predicted_score || 75
            }));
            
            days.push({
                date: dateStr,
                dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
                dayNumber: date.getDate(),
                sessions: sessions,
                canAddSession: sessions.length < 2,
                warnings: []
            });
        }
        
        return { planning_data: days, week_score: 75 };
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
                    <button class="btn btn-sm btn-primary" onclick="planningManager.refresh()">
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
        const weekEnd = new Date(weekStart.getTime());
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
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const isToday = day.date === todayStr;
        const sessionsHtml = day.sessions
            .map(session => this.renderSession(session, day.date))
            .join('');
        
        const addZoneHtml = day.canAddSession && day.sessions.length < this.maxSessionsPerDay 
            ? `<div class="add-session-zone" onclick="planningManager.showAddSessionModal('${day.date}')">
                <i class="fas fa-plus"></i>
                <span>Ajouter séance</span>
            </div>`
            : '';
        
        // CORRECTION : Ajouter clic sur jour vide pour faciliter ajout de séance
        const dayClickHandler = day.sessions.length === 0 && day.canAddSession
            ? `onclick="planningManager.showAddSessionModal('${day.date}')"` 
            : '';
        
        const dayStyle = day.sessions.length === 0 && day.canAddSession
            ? 'cursor: pointer; border: 2px dashed var(--planning-border); opacity: 0.7;' 
            : '';
        
        return `
            <div class="day-card ${isToday ? 'today' : ''}" 
                data-date="${day.date}" 
                ${dayClickHandler}
                style="${dayStyle}">
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


    renderSession(session, dayData) {
        console.log('🎨 Rendu session:', session);
        
        // CONSERVER TOUTES LES FEATURES EXISTANTES
        const exercises = session.exercise_pool || session.exercises || [];
        const muscleGroups = session.muscle_groups || [];
        const status = session.status || 'planned';
        const quality = session.predicted_quality_score || 75;
        
        // Fonction couleur de qualité EXISTANTE (conserver)
        const getQualityColor = (score) => {
            if (score >= 85) return '#10b981'; // vert
            if (score >= 70) return '#f59e0b'; // orange  
            if (score >= 50) return '#ef4444'; // rouge
            return '#6b7280'; // gris
        };
        
        const qualityColor = getQualityColor(quality);
        
        // Fonction icône statut EXISTANTE (conserver)
        const getStatusIcon = (status) => {
            switch(status) {
                case 'completed': return 'fas fa-check-circle';
                case 'in_progress': return 'fas fa-play-circle';
                case 'planned': return 'fas fa-clock';
                case 'skipped': return 'fas fa-times-circle';
                default: return 'fas fa-calendar';
            }
        };
        
        const statusIcon = getStatusIcon(status);
        
        // AJOUTER couleur muscle en border-left (NOUVELLE FEATURE)
        const primaryMuscle = muscleGroups[0] || 'general';
        const muscleColor = window.MuscleColors?.getMuscleColor(primaryMuscle) || '#6b7280';
                
        return `
            <div class="session-card"      data-session-id="${session.id}"      style="border-left: 4px solid ${muscleColor}"     onclick="planningManager.showSessionEditModal(planningManager.findSessionById('${session.id}'))">
                <div class="session-header-centered">
                    <div class="session-quality-arc-centered">
                        <div class="arc-track"></div>
                        <div class="arc-fill" 
                            style="border-top-color: ${qualityColor}; 
                                    clip-path: polygon(0% 0%, ${quality || 0}% 0%, ${quality || 0}% 100%, 0% 100%);">
                        </div>
                        <span class="arc-score-centered" style="color: ${qualityColor}">${quality}</span>
                    </div>
                </div>
                
                <div class="session-duration-centered">
                    <i class="fas fa-clock"></i>
                    <span>${this.calculateSessionDuration(exercises)} min</span>
                </div>

                <div class="session-content">
                    <div class="session-meta">

                        ${muscleGroups.length > 0 ? `
                            <div class="session-muscles-centered">
                                ${muscleGroups.slice(0, 2).map(muscle => {
                                    const color = this.getMuscleGroupColor(muscle);
                                    return `<span class="session-muscle-chip" style="background-color: ${color}20; color: ${color}; border: 1px solid ${color}40;">${muscle}</span>`;
                                }).join('')}
                                ${muscleGroups.length > 2 ? `<span class="muscle-more">+${muscleGroups.length - 2}</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="session-exercises">
                        ${exercises.length > 0 ? exercises.slice(0, 3).map((ex, index) => `
                            <div class="exercise-preview-item" data-exercise-id="${ex.exercise_id || ex.id}">
                                <span class="exercise-number">${index + 1}</span>
                                <div class="exercise-info">
                                    <div class="exercise-name">${ex.name || ex.exercise_name || 'Exercice'}</div>
                                    <div class="exercise-params">${ex.sets || ex.default_sets || 3} × ${ex.reps || ex.default_reps_min || 8}-${ex.reps_max || ex.default_reps_max || 12}</div>
                                </div>
                            </div>
                        `).join('') : `
                            <div class="empty-preview">
                                <i class="fas fa-dumbbell"></i>
                                <span>Aucun exercice</span>
                            </div>
                        `}
                        
                        ${exercises.length > 3 ? `
                            <div class="exercise-preview-item exercise-more">
                                <span class="exercise-number">+</span>
                                <div class="exercise-info">
                                    <div class="exercise-name">${exercises.length - 3} autres exercices...</div>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="session-footer">
                        <button class="btn-start-compact" onclick="planningManager.startSession('${session.id}')" ${status === 'completed' ? 'disabled' : ''}>
                            <i class="fas fa-play"></i>
                            ${status === 'completed' ? 'Terminée' : status === 'in_progress' ? 'Continuer' : 'Démarrer'}
                        </button>
                    </div>
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
                // ... options existantes ...
                
                onAdd: async (evt) => {
                    const sessionId = evt.item.dataset.sessionId;
                    const targetDate = evt.to.dataset.day;
                    const sourceDate = evt.from.dataset.day;
                    
                    console.log('🎯 Drag&Drop détecté:', { sessionId, sourceDate, targetDate });
                    
                    // Vérifier la limite avant même d'essayer
                    const targetSessions = evt.to.querySelectorAll('.session-card').length;
                    if (targetSessions > this.maxSessionsPerDay) {
                        console.warn('⚠️ Limite séances/jour atteinte');
                        window.showToast('Maximum 2 séances par jour', 'warning');
                        evt.from.appendChild(evt.item);
                        return;
                    }
                    
                    try {
                        // Désactiver temporairement le drag&drop pendant l'opération
                        evt.to.classList.add('updating');
                        evt.from.classList.add('updating');
                        
                        // Au lieu d'appeler handleSessionMove qui modifie weekly_structure
                        // Appeler directement l'endpoint schedule
                        await window.apiPut(`/api/programs/${this.activeProgram.id}/schedule/${targetDate}`, {
                            move_from: sourceDate
                        });

                        console.log('✅ Séance déplacée dans le schedule');
                        window.showToast('Séance déplacée avec succès', 'success');
                        await this.refresh();
                        
                    } catch (error) {
                        console.error('❌ Erreur déplacement, annulation:', error);
                        
                        // Remettre l'élément à sa place d'origine
                        evt.from.appendChild(evt.item);
                        
                        // Message d'erreur contextuel
                        if (error.message.includes('Limite')) {
                            // Déjà géré par handleSessionMove
                        } else if (error.message.includes('réseau')) {
                            window.showToast('Problème de connexion', 'error');
                        } else {
                            window.showToast('Erreur lors du déplacement', 'error');
                        }
                    } finally {
                        // Réactiver le drag&drop
                        evt.to.classList.remove('updating');
                        evt.from.classList.remove('updating');
                    }
                }
            });
        });
    }
       
    // NOUVELLE MÉTHODE pour gérer le déplacement dans weekly_structure
    async handleSessionMove(sessionId, targetDate, sourceDate) {
        try {
            console.log('🔄 Déplacement session:', { sessionId, de: sourceDate, vers: targetDate });
            
            if (!this.activeProgram) {
                throw new Error('Pas de programme actif');
            }
            
            // Appeler directement l'endpoint de mise à jour du schedule
            await window.apiPut(`/api/programs/${this.activeProgram.id}/schedule/${targetDate}`, {
                move_from: sourceDate
            });
            
            console.log('✅ Séance déplacée dans le schedule');
            window.showToast('Séance déplacée avec succès', 'success');
            await this.refresh();
            
        } catch (error) {
            console.error('❌ Erreur déplacement séance:', error);
            
            // Gestion des erreurs spécifiques du backend
            if (error.message?.includes('Maximum 2 séances')) {
                window.showToast('Maximum 2 séances par jour', 'warning');
            } else if (error.message?.includes('Session source non trouvée')) {
                window.showToast('Session source introuvable', 'error');
            } else {
                window.showToast('Erreur lors du déplacement', 'error');
            }
            
            throw error; // Propagé pour que le drag&drop annule
        }
    }

    // ===== GESTION SÉANCES =====
    
    async handleSessionClick(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        await this.showSessionEditModal(session);
    }
    

    async handleDeleteSession(sessionId) {
        try {
            // Protection événement - utiliser try/catch au cas où event n'existe pas
            if (typeof event !== 'undefined') {
                event.stopPropagation();
            }
            
            const session = this.findSessionById(sessionId);
            if (!session) {
                console.warn('Séance introuvable:', sessionId);
                window.showToast('Séance introuvable', 'warning');
                return;
            }
            
            const modalContent = `
                <div class="delete-confirmation">
                    <h3>🗑️ Supprimer la séance</h3>
                    <p>Êtes-vous sûr de vouloir supprimer cette séance ?</p>
                    <div class="session-preview">
                        <strong>${session.exercises?.length || 0} exercices</strong> • 
                        <strong>${session.estimated_duration || 45} minutes</strong>
                        ${session.primary_muscles?.length > 0 ? `<br><small>Muscles: ${session.primary_muscles.join(', ')}</small>` : ''}
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-danger" onclick="planningManager.confirmDelete('${sessionId}')">
                            <i class="fas fa-trash"></i> Supprimer
                        </button>
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            <i class="fas fa-times"></i> Annuler
                        </button>
                    </div>
                </div>
            `;
            
            window.showModal('Confirmation', modalContent);
            
        } catch (error) {
            console.error('❌ Erreur handleDeleteSession:', error);
            window.showToast('Erreur lors de l\'ouverture', 'error');
        }
    }
        
    async confirmDelete(sessionId) {
        try {
            // ✅ CORRECTIF : Utiliser le nouvel endpoint schedule
            const sessionDate = this.findDateForSession(sessionId);
            if (!sessionDate) {
                throw new Error('Date de session introuvable');
            }
            
            await window.apiDelete(`/api/programs/${this.activeProgram.id}/schedule/${sessionDate}`);
            
            window.closeModal();
            window.showToast('Séance supprimée', 'success');
            await this.refresh();
            
        } catch (error) {
            console.error('❌ Erreur suppression:', error);
            window.showToast('Erreur lors de la suppression', 'error');
        }
    }

    // Extraction des muscles avec validation
    extractPrimaryMuscles(exercise_pool) {
        // Validation robuste pour exercise_pool
        if (!exercise_pool || !Array.isArray(exercise_pool) || exercise_pool.length === 0) {
            console.warn('⚠️ Pas d\'exercise_pool pour extraction muscles');
            return ['général'];
        }
        
        const muscleCount = {};
        
        // CORRECTION : utiliser exercise_pool au lieu de exercises
        exercise_pool.forEach(ex => {
            if (!ex || typeof ex !== 'object') return;
            
            // Utiliser muscle_groups si disponible (format v2.0)
            if (ex.muscle_groups && Array.isArray(ex.muscle_groups)) {
                ex.muscle_groups.forEach(muscle => {
                    if (muscle) {
                        muscleCount[muscle] = (muscleCount[muscle] || 0) + 1;
                    }
                });
            } else {
                // Fallback sur primary_muscle ou muscle_name
                const muscle = ex.primary_muscle || ex.muscle_name || 'autre';
                muscleCount[muscle] = (muscleCount[muscle] || 0) + 1;
            }
        });
        
        // Retourner les 3 muscles les plus fréquents
        const topMuscles = Object.entries(muscleCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([muscle]) => muscle);
        
        return topMuscles.length > 0 ? topMuscles : ['général'];
    }

    // Calcul durée avec validation
    calculateSessionDuration(exercise_pool) {
        if (!exercise_pool || !Array.isArray(exercise_pool)) {
            console.warn('⚠️ exercise_pool invalide pour calcul durée');
            return 45; // Durée par défaut
        }
        
        const duration = exercise_pool.reduce((total, ex) => {
            // Validation exercice
            if (!ex || typeof ex !== 'object') return total;
            
            const sets = parseInt(ex.sets) || 3;
            const restSeconds = parseInt(ex.rest_seconds) || 90;
            
            // Calcul conservateur
            const restTime = (restSeconds * (sets - 1)) / 60;
            const workTime = sets * 1.5; // 1.5min par série
            const setupTime = 1; // 1min de préparation
            
            return total + restTime + workTime + setupTime;
        }, 0);
        
        // Arrondir et borner entre 15 et 120 minutes
        return Math.max(15, Math.min(120, Math.round(duration)));
    }

    // Génération semaine vide (fallback)
    generateEmptyWeek(weekStart) {
        console.log('📋 Génération semaine vide pour:', weekStart);
        const days = [];
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart.getTime());
            date.setDate(weekStart.getDate() + i);
            
            // Format local cohérent
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            days.push({
                date: dateStr,
                dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
                dayNumber: date.getDate(),
                sessions: [],
                canAddSession: true,
                warnings: []
            });
        }
        
        return { 
            planning_data: days, 
            week_score: 0,
            total_sessions: 0,
            total_duration: 0
        };
    }
    
    removeExerciseFromSession(sessionId, exerciseId) {
        // Contexte d'édition : retirer et rafraîchir le modal
        try {
            const session = this.findSessionById(sessionId);
            if (!session) return;
            
            session.exercises = session.exercises.filter(ex => 
                (ex.exercise_id || ex.id) !== exerciseId
            );
            
            // Sauvegarder et rafraîchir
            this.saveSessionChanges(sessionId, { exercises: session.exercises })
                .then(() => {
                    this.showSessionEditModal(session);
                    window.showToast('Exercice retiré', 'success');
                })
                .catch(error => {
                    console.error('Erreur suppression:', error);
                    window.showToast('Erreur lors de la suppression', 'error');
                });
            
        } catch (error) {
            console.error('Erreur suppression exercice:', error);
            window.showToast('Erreur lors de la suppression', 'error');
        }
    }

    // ===== MODAL ÉDITION SÉANCE =====
    async showSessionEditModal(session) {
        try {
            const exercises = session.exercises || [];
            const date = new Date(session.scheduled_date || session.date);
            const formattedDate = date.toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            
            // Calculer les métriques actuelles
            const duration = this.calculateSessionDuration(exercises);
            const muscles = [...new Set(exercises.flatMap(ex => ex.muscle_groups || []))].filter(Boolean);
            
            // Score avec fallback
            let currentScore = 75;
            try {
                if (window.SessionQualityEngine && window.getUserContext) {
                    const userContext = await window.getUserContext();
                    const scoreData = await window.SessionQualityEngine.calculateScore(exercises, userContext);
                    currentScore = scoreData.total || 75;
                }
            } catch (error) {
                console.warn('⚠️ Scoring avancé non disponible');
                currentScore = this.calculatePreviewQualityScoreFallback(exercises);
            }
            
            const scoreColor = window.getScoreColor ? window.getScoreColor(currentScore) : '#10b981';
            
            // Générer la liste des exercices
            const exercisesHtml = exercises.map((ex, index) => `
                <div class="selected-exercise-item" 
                    data-exercise-id="${ex.exercise_id || ex.id}"
                    data-exercise='${JSON.stringify(ex).replace(/'/g, '&apos;')}'>
                    <div class="drag-handle">
                        <i class="fas fa-grip-vertical"></i>
                    </div>
                    <div class="exercise-content">
                        <span class="exercise-number">${index + 1}</span>
                        <div class="exercise-details">
                            <div class="exercise-name">${ex.exercise_name || ex.name}</div>
                            <div class="exercise-params">
                                ${ex.sets || 3} × ${ex.reps_min || 8}-${ex.reps_max || 12}
                            </div>
                        </div>
                    </div>
                    <button class="remove-btn" 
                            onclick="planningManager.removeExerciseFromSession('${session.id}', '${ex.exercise_id || ex.id}')"
                            title="Retirer">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
            
            // Générer les tags de muscles
            const muscleTags = muscles.map(muscle => {
                const color = this.getMuscleGroupColor?.(muscle) || '#6b7280';
                return `<span class="muscle-tag" style="background-color: ${color}20; color: ${color}; border: 1px solid ${color}40">${muscle}</span>`;
            }).join('');
            
            const modalContent = `
                <div class="planning-modal-vertical edit-mode">
                    <!-- Métriques en haut -->
                    <div class="session-metrics-row">
                        <div class="metric">
                            <i class="fas fa-list-ol"></i>
                            <span class="metric-value">${exercises.length}</span>
                            <span class="metric-label">exercices</span>
                        </div>
                        <div class="metric">
                            <i class="fas fa-clock"></i>
                            <span class="metric-value">${duration}</span>
                            <span class="metric-label">min</span>
                        </div>
                        <div class="metric">
                            <i class="fas fa-fire"></i>
                            <span class="metric-value">${muscles.length}</span>
                            <span class="metric-label">muscles</span>
                        </div>
                        <div class="metric quality-metric">
                            <i class="fas fa-chart-line" style="color: ${scoreColor}"></i>
                            <span id="scoreValue" class="metric-value" style="color: ${scoreColor}">${currentScore}%</span>
                            <span class="metric-label">qualité</span>
                        </div>
                    </div>
                    
                    <!-- Liste des exercices -->
                    <div class="exercises-edit-section">
                        <div class="preview-header">
                            <div class="header-content">
                                <i class="fas fa-dumbbell"></i>
                                <h4>Exercices de la séance</h4>
                            </div>
                            <button class="magic-wand-btn" 
                                    onclick="planningManager.optimizeExerciseOrder()"
                                    title="Optimiser l'ordre"
                                    ${exercises.length < 2 ? 'style="display: none;"' : ''}>
                                <i class="fas fa-magic"></i>
                            </button>
                        </div>
                        
                        <div id="previewExercisesList" class="selected-exercises-list">
                            ${exercisesHtml || '<div class="empty-preview"><i class="fas fa-exclamation-circle"></i><p>Aucun exercice</p></div>'}
                        </div>
                    </div>
                    
                    <!-- Groupes musculaires -->
                    ${muscles.length > 0 ? `
                        <div class="muscle-groups-tags">
                            ${muscleTags}
                        </div>
                    ` : ''}
                    
                    <!-- Actions -->
                    <div class="modal-actions-bottom">
                        <button class="btn btn-secondary ${session.session_ref && !session.session_ref.startsWith('manual_') ? 'disabled' : ''}" 
                                ${session.session_ref && !session.session_ref.startsWith('manual_') ? 
                                    'disabled title="Séance du programme non modifiable"' : 
                                    `onclick="planningManager.showAddSessionModal('${session.scheduled_date || session.date}', '${session.id}')"`
                                }>
                            <i class="fas fa-${session.session_ref && !session.session_ref.startsWith('manual_') ? 'lock' : 'plus'}"></i> 
                            Ajouter exercices
                        </button>
                        <button class="btn btn-primary" onclick="window.closeModal()">
                            <i class="fas fa-check"></i> Terminer
                        </button>
                    </div>
                </div>
            `;
            
            const modalTitle = `
                <div class="modal-title-with-date">
                    <span>Éditer la séance</span>
                    <div class="modal-subtitle">
                        <i class="fas fa-calendar-alt"></i>
                        <span>${formattedDate}</span>
                    </div>
                </div>
            `;
            
            window.showModal(modalTitle, modalContent);
            
            // Initialiser le drag & drop
            this.initializeExerciseDragDrop(session.id);
            
        } catch (error) {
            console.error('❌ Erreur modal édition:', error);
            window.showToast('Erreur lors de l\'ouverture', 'error');
        }
    }
        

    // 10. AJOUTER fonction pour optimiser l'ordre (si programme actif)
    async optimizeSessionOrder(sessionId) {
        try {
            const [programId, dayName, sessionIndex] = sessionId.split('_');
            
            if (!this.activeProgram) {
                window.showToast('Fonctionnalité disponible uniquement avec un programme', 'info');
                return;
            }
            
            // Utiliser l'endpoint Programme existant
            const response = await window.apiPut(`/api/programs/${programId}/reorder-session`, {
                day_name: dayName,
                session_index: parseInt(sessionIndex)
            });
            
            if (response.optimized_session) {
                // Mettre à jour weekly_structure
                this.weeklyStructure[dayName][parseInt(sessionIndex)] = response.optimized_session;
                
                // Rafraîchir l'affichage
                const container = document.getElementById('sessionExercisesList');
                if (container) {
                    container.innerHTML = response.optimized_session.exercises
                        .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                        .join('');
                }
                
                window.showToast(`Ordre optimisé (score: ${response.new_score}%)`, 'success');
            }
            
        } catch (error) {
            console.error('❌ Erreur optimisation ordre:', error);
            window.showToast('Optimisation non disponible', 'warning');
        }
    }

    renderEditableExercise(exercise, index, sessionId) {
        const exerciseId = exercise.exercise_id || exercise.id || 'unknown';
        const exerciseName = exercise.exercise_name || exercise.name || `Exercice ${index + 1}`;
        const sets = exercise.sets || 3;
        const repsMin = exercise.reps_min || exercise.rep_min || 8;
        const repsMax = exercise.reps_max || exercise.rep_max || 12;
        const restSeconds = exercise.rest_seconds || exercise.rest || 90;
        const muscleGroups = exercise.muscle_groups || [];
        const duration = this.calculateExerciseDuration(exercise);
        
        return `
            <div class="exercise-item" data-exercise-id="${exerciseId}" data-index="${index}">
                <div class="exercise-drag-handle">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                
                <div class="exercise-details">
                    <div class="exercise-name">${exerciseName}</div>
                    <div class="exercise-params">
                        <span class="sets-reps">${sets} × ${repsMin}-${repsMax}</span>
                        <span class="rest-time"><i class="fas fa-stopwatch"></i> ${restSeconds}s</span>
                        <span class="duration"><i class="fas fa-clock"></i> ${duration}min</span>
                    </div>
                    ${muscleGroups.length > 0 ? `
                        <div class="muscle-pills">
                            ${muscleGroups.map(muscle => {
                                const color = window.MuscleColors?.getMuscleColor ? 
                                    window.MuscleColors.getMuscleColor(muscle) : '#6b7280';
                                return `<span class="muscle-pill" style="background: ${color}">${muscle}</span>`;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="exercise-actions-item">
                    <button class="btn btn-sm btn-icon" 
                            onclick="planningManager.showSwapModal('${sessionId}', ${index})"
                            title="Remplacer">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                    <button class="btn btn-sm btn-icon btn-danger" 
                            onclick="planningManager.removeExercise('${sessionId}', ${index})"
                            title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }
    
    initializeEditDragDrop(sessionId) {
        const container = document.getElementById('sessionExercisesList');
        if (!container || !window.Sortable) return;
        
        new Sortable(container, {
            animation: 150,
            handle: '.exercise-drag-handle',
            ghostClass: 'exercise-ghost',
            chosenClass: 'exercise-chosen',
            onEnd: async (evt) => {
                if (evt.oldIndex === evt.newIndex) return;
                
                const session = this.findSessionById(sessionId);
                if (!session) return;
                
                const exercises = session.exercise_pool || session.exercises || [];
                const [removed] = exercises.splice(evt.oldIndex, 1);
                exercises.splice(evt.newIndex, 0, removed);
                
                // Recalculer le score
                const newScore = this.calculatePreviewQualityScoreFallback(exercises);
                const scoreElement = document.querySelector('.quality-score .stat-value');
                if (scoreElement) {
                    const scoreColor = newScore >= 85 ? '#10b981' : newScore >= 70 ? '#f59e0b' : '#ef4444';
                    
                    scoreElement.classList.add('updated');
                    scoreElement.textContent = `${newScore}%`;
                    scoreElement.style.color = scoreColor;
                    
                    const iconElement = document.querySelector('.quality-score i');
                    if (iconElement) {
                        iconElement.style.color = scoreColor;
                    }
                    
                    setTimeout(() => {
                        scoreElement.classList.remove('updated');
                    }, 600);
                }
                
                // Sauvegarder les changements
                try {
                    await this.saveSessionChanges(sessionId, { exercises });
                } catch (error) {
                    console.warn('Sauvegarde locale uniquement');
                    this.saveSessionToLocalStorage(sessionId, session);
                }
            }
        });
    }

    async applyOptimalOrderEdit(sessionId) {
        const session = this.findSessionById(sessionId);
        if (!session) return;
        
        const exercises = session.exercise_pool || session.exercises || [];
        if (exercises.length < 2) return;
        
        // Animation du bouton
        const btn = event.target.closest('button');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.style.transform = 'rotate(360deg)';
                setTimeout(() => {
                    icon.style.transform = '';
                }, 600);
            }
        }
        
        // Optimiser l'ordre (même logique que création)
        const optimized = [...exercises].sort((a, b) => {
            const aCompound = (a.muscle_groups?.length || 0) > 1 ? 1 : 0;
            const bCompound = (b.muscle_groups?.length || 0) > 1 ? 1 : 0;
            if (aCompound !== bCompound) return bCompound - aCompound;
            
            const aMuscle = a.muscle_groups?.[0] || '';
            const bMuscle = b.muscle_groups?.[0] || '';
            return aMuscle.localeCompare(bMuscle);
        });
        
        // Mettre à jour la session
        if (session.exercise_pool) {
            session.exercise_pool = optimized;
        } else {
            session.exercises = optimized;
        }
        
        // Réafficher la liste
        const container = document.getElementById('sessionExercisesList');
        if (container) {
            container.innerHTML = optimized.map((ex, index) => 
                this.renderEditableExercise(ex, index, sessionId)
            ).join('');
        }
        
        // Réinitialiser drag & drop
        this.initializeEditDragDrop(sessionId);
        
        // Recalculer et animer le score
        const newScore = this.calculatePreviewQualityScoreFallback(optimized);
        const scoreElement = document.querySelector('.quality-score .stat-value');
        if (scoreElement) {
            const scoreColor = newScore >= 85 ? '#10b981' : newScore >= 70 ? '#f59e0b' : '#ef4444';
            
            scoreElement.classList.add('updated');
            scoreElement.textContent = `${newScore}%`;
            scoreElement.style.color = scoreColor;
            
            const iconElement = document.querySelector('.quality-score i');
            if (iconElement) {
                iconElement.style.color = scoreColor;
            }
            
            setTimeout(() => {
                scoreElement.classList.remove('updated');
            }, 600);
        }
        
        window.showToast('Ordre optimisé', 'success');
        
        // Sauvegarder
        try {
            await this.saveSessionChanges(sessionId, { 
                exercises: optimized,
                predicted_quality_score: newScore 
            });
        } catch (error) {
            console.warn('Sauvegarde locale uniquement');
            this.saveSessionToLocalStorage(sessionId, session);
        }
    }

    // ===== DRAG & DROP EXERCICES =====
    // Fonction unifiée qui gère tous les cas
    initializeExerciseDragDrop(sessionId = null) {
        const container = document.getElementById('sessionExercisesList') || 
                        document.getElementById('previewExercisesList');
        
        if (!container || typeof Sortable === 'undefined') {
            console.warn('⚠️ Container ou SortableJS non disponible');
            return;
        }
        
        // CORRECTIF : Capturer le contexte correctement
        const self = this;  // Utiliser 'self' au lieu de 'planningManager'
        
        if (this.currentSortable) {
            this.currentSortable.destroy();
        }
        
        this.currentSortable = new Sortable(container, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            
            onEnd: async function(evt) {  // Utiliser function au lieu de arrow function
                if (evt.oldIndex === evt.newIndex) return;
                
                // Utiliser 'self' qui référence correctement l'instance
                if (self.updateExerciseNumbers) {
                    self.updateExerciseNumbers();
                }
                
                if (sessionId && self.sessions) {  // Vérifier que sessions existe
                    try {
                        const session = self.sessions.find(s => s.id === sessionId);
                        if (session) {
                            const items = container.querySelectorAll('.selected-exercise-item');
                            session.exercises = Array.from(items).map(item => {
                                try {
                                    return JSON.parse(item.dataset.exercise.replace(/&apos;/g, "'"));
                                } catch (e) {
                                    return null;
                                }
                            }).filter(Boolean);
                            
                            if (self.saveSessionChanges) {
                                await self.saveSessionChanges(sessionId, { exercises: session.exercises });
                            }
                        }
                    } catch (error) {
                        console.error('Erreur sauvegarde ordre:', error);
                    }
                }
                
                // Mettre à jour les métriques
                if (self.getPreviewExercises && self.updateSessionMetrics) {
                    const exercises = self.getPreviewExercises();
                    self.updateSessionMetrics(exercises);
                }
            }
        });
    }
    
    async reorderExercises(sessionId, oldIndex, newIndex) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises) return;
            
            // Réorganiser localement d'abord
            const exercises = [...session.exercises];
            const [moved] = exercises.splice(oldIndex, 1);
            exercises.splice(newIndex, 0, moved);
            session.exercises = exercises;
            
            // Parser sessionId pour Programme v2.0
            const sessionParts = sessionId.split('_');
            if (sessionParts.length === 3) {
                const [programId, weekIndex, sessionIndex] = sessionParts.map(Number);
                
                // Utiliser endpoint reorder-session EXISTANT
                const newOrder = exercises.map((ex, idx) => idx);
                const response = await window.apiPut(
                    `/api/programs/${programId}/reorder-session`,
                    {
                        week_index: weekIndex,
                        session_index: sessionIndex,
                        new_exercise_order: newOrder
                    }
                );
                
                if (response?.success) {
                    console.log('✅ Réorganisation v2.0 réussie');
                    window.showToast('Ordre mis à jour', 'success');
                }
            } else {
                // Fallback local
                console.warn('⚠️ Réorganisation locale seulement');
                window.showToast('Ordre mis à jour (local)', 'info');
            }
            
            // Recalculer le scoring
            await this.updateLiveScoring(exercises);
            
        } catch (error) {
            console.error('❌ Erreur réorganisation:', error);
            window.showToast('Erreur lors de la réorganisation', 'error');
        }
    }
    
    async removeExercise(sessionId, exerciseIndex) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises) return;
            
            const exerciseName = session.exercises[exerciseIndex]?.exercise_name || 'Exercice';
            if (!confirm(`Supprimer "${exerciseName}" ?`)) return;
            
            // Supprimer localement
            const removedExercise = session.exercises.splice(exerciseIndex, 1)[0];
            
            // Mettre à jour l'affichage immédiatement
            const container = document.getElementById('sessionExercisesList');
            if (container) {
                container.innerHTML = session.exercises
                    .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                    .join('');
                this.initializeExerciseDragDrop(sessionId);
            }
            
            // Recalculer métriques
            await this.updateLiveScoring(session.exercises);
            this.updateLiveDuration(session.exercises);
            
            // Sauvegarder avec gestion d'erreur
            try {
                await this.saveSessionChanges(sessionId, { exercises: session.exercises });
                window.showToast('Exercice supprimé', 'success');
            } catch (saveError) {
                console.warn('⚠️ Sauvegarde suppression échouée:', saveError);
                window.showToast('Exercice supprimé (sauvegarde locale)', 'info');
            }
            
        } catch (error) {
            console.error('❌ Erreur suppression exercice:', error);
            window.showToast('Erreur lors de la suppression', 'error');
        }
    }
    
    // ===== SYSTÈME SWAP EXERCICES =====
    async showSwapModal(sessionId, exerciseIndex) {
        try {
            const session = this.findSessionById(sessionId);
            const exercise = session?.exercises[exerciseIndex];
            if (!exercise) {
                window.showToast('Exercice introuvable', 'error');
                return;
            }
            
            // ✅ CORRECTIF : Utiliser alternatives v2.0
            const programId = this.activeProgram.id;
            
            try {
                // Utiliser l'endpoint v2.0 pour les alternatives
                const alternatives = await window.apiGet(
                    `/api/programs/${programId}/exercise-alternatives?exercise_id=${exercise.exercise_id}&session_context=true`
                );
                
                // Afficher modal avec alternatives scorées par ML
                const modalContent = `
                    <div class="swap-modal-v2">
                        <h3>Remplacer ${exercise.name}</h3>
                        <div class="current-exercise">
                            <h4>Exercice actuel</h4>
                            <div class="exercise-card current">
                                <span>${exercise.name}</span>
                                <div class="muscles">${exercise.muscle_groups?.join(', ') || ''}</div>
                            </div>
                        </div>
                        
                        <div class="alternatives-section">
                            <h4>Alternatives suggérées (${alternatives.length})</h4>
                            <div class="alternatives-list">
                                ${alternatives.map((alt, index) => `
                                    <div class="exercise-card alternative" 
                                        onclick="planningManager.executeSwap('${sessionId}', ${exerciseIndex}, ${alt.exercise_id})">
                                        <div class="exercise-info">
                                            <span class="name">${alt.name}</span>
                                            <div class="muscles">${alt.muscle_groups?.join(', ') || ''}</div>
                                            <div class="score">Score ML: ${alt.quality_score || 'N/A'}</div>
                                        </div>
                                        <div class="swap-reason">${alt.selection_reason || ''}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        
                        <div class="modal-actions">
                            <button class="btn btn-secondary" onclick="window.closeModal()">Annuler</button>
                        </div>
                    </div>
                `;
                
                window.showModal('Remplacer l\'exercice', modalContent);
                
            } catch (apiError) {
                console.warn('❌ API v2.0 indisponible, fallback ancien système:', apiError);
                
                // Fallback sur l'ancien système
                const primaryMuscle = exercise.muscle_groups?.[0] || 'pectoraux';
                const allExercises = await window.apiGet(`/api/exercises?muscle_group=${primaryMuscle}`);
                
                // Afficher modal simple sans scoring ML
                // ... code fallback existant
            }
            
        } catch (error) {
            console.error('❌ Erreur showSwapModal:', error);
            window.showToast('Erreur lors du chargement des alternatives', 'error');
        }
    }

    // Alternatives locales fallback
    async getLocalAlternatives(exercise, targetMuscle) {
        try {
            // Récupérer tous les exercices disponibles
            const allExercises = await window.apiGet(`/api/exercises?user_id=${window.currentUser.id}`);
            
            // Filtrer par muscle et exclure l'exercice actuel
            const alternatives = allExercises
                .filter(ex => {
                    if (ex.id === exercise.exercise_id) return false;
                    const muscles = ex.muscle_groups || [ex.muscle_group];
                    return muscles.some(muscle => 
                        muscle && muscle.toLowerCase().includes(targetMuscle.toLowerCase())
                    );
                })
                .slice(0, 6)
                .map(ex => ({
                    exercise_id: ex.id,
                    name: ex.name,
                    exercise_name: ex.name,
                    muscle_groups: ex.muscle_groups || [ex.muscle_group],
                    score: 0.7 + Math.random() * 0.25,
                    reason_match: 'Alternative locale'
                }));
            
            return alternatives;
            
        } catch (error) {
            console.warn('⚠️ Erreur alternatives locales:', error);
            return [];
        }
    }

    // Effectuer le swap
    async swapExercise(sessionId, exerciseIndex, newExerciseId) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises?.[exerciseIndex]) {
                window.showToast('Exercice introuvable', 'error');
                return;
            }
            
            // Récupérer détails nouvel exercice
            const newExercise = await window.apiGet(`/api/exercises/${newExerciseId}?user_id=${window.currentUser.id}`);
            
            // Remplacer exercice localement
            const oldExercise = session.exercises[exerciseIndex];
            session.exercises[exerciseIndex] = {
                exercise_id: newExercise.id,
                exercise_name: newExercise.name,
                muscle_groups: newExercise.muscle_groups || [newExercise.muscle_group],
                muscle_group: newExercise.muscle_group,
                sets: oldExercise.sets || 3,
                reps_min: oldExercise.reps_min || 8,
                reps_max: oldExercise.reps_max || 12,
                rest_seconds: oldExercise.rest_seconds || 90
            };
            
            // Mettre à jour affichage
            const container = document.getElementById('sessionExercisesList');
            if (container) {
                container.innerHTML = session.exercises
                    .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                    .join('');
                this.initializeExerciseDragDrop(sessionId);
            }
            
            // Recalculer métriques
            this.updateLiveDuration(session.exercises);
            await this.updateLiveScoring(session.exercises);
            
            // Sauvegarder avec gestion d'erreur
            try {
                await this.saveSessionChanges(sessionId, { exercises: session.exercises });
            } catch (saveError) {
                console.warn('⚠️ Sauvegarde swap échouée:', saveError);
            }
            
            window.closeModal();
            window.showToast(`Exercice remplacé par "${newExercise.name}"`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur swap exercice:', error);
            window.showToast('Erreur lors du remplacement', 'error');
        }
    }
    
    renderAlternative(alternative, sessionId, exerciseIndex) {
        const score = Math.round((alternative.score || 0.75) * 100);
        
        return `
            <div class="alternative-item" onclick="planningManager.performSwap('${sessionId}', ${exerciseIndex}, ${alternative.exercise_id})">
                <div class="alternative-header">
                    <div class="alternative-name">${alternative.name}</div>
                    <div class="alternative-score">
                        <div class="status-badge" style="background: ${this.getScoreGradient(score)}">
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
        // Validation d'entrée
        if (!exercises || !Array.isArray(exercises)) {
            console.warn('Exercices invalides pour scoring');
            return;
        }
        
        let scoreResult = null;
        let scoringMethod = 'unknown';
        
        try {
            // Tentative scoring avancé
            const userContext = await window.getUserContext();
            scoreResult = await window.SessionQualityEngine.calculateScore(exercises, userContext);
            scoringMethod = 'advanced';
            
        } catch (apiError) {
            console.warn('API scoring échoué, fallback local:', apiError);
            
            try {
                // Fallback déterministe local
                scoreResult = {
                    total: this.calculatePreviewQualityScoreFallback(exercises),
                    breakdown: null,
                    confidence: 0.6
                };
                scoringMethod = 'local';
                
            } catch (fallbackError) {
                console.error('Tous les systèmes de scoring échoués:', fallbackError);
                // Dernier recours
                scoreResult = window.SessionQualityEngine?.getFallbackScore() || { total: 70 };
                scoringMethod = 'emergency';
            }
        }
        
        // Mise à jour robuste de l'affichage
        this.displayScoreResult(scoreResult, scoringMethod);
        
        // Feedback utilisateur si amélioration détectée
        if (scoreResult.reorderImprovement && scoreResult.orderBonus > 0) {
            window.showToast(`Score amélioré de ${scoreResult.orderBonus} points`, 'success');
        }
    }

    // méthode helper pour l'affichage
    displayScoreResult(scoreResult, method = 'unknown') {
        const scoreValue = scoreResult.total || 70;
        
        // Multiples sélecteurs robustes
        const scoreElements = [
            document.getElementById('scoreValue'),
            document.querySelector('[data-score-display]'),
            document.querySelector('.quality-score .stat-value'),
            document.querySelector('.metric-value[data-score]')
        ].filter(Boolean);
        
        const gaugeElements = [
            document.getElementById('liveScore'),
            document.querySelector('.score-gauge'),
            document.querySelector('[data-score-gauge]')
        ].filter(Boolean);
        
        // Mise à jour de tous les éléments trouvés
        scoreElements.forEach(element => {
            element.textContent = `${scoreValue}%`;
            element.dataset.score = scoreValue;
            element.dataset.scoringMethod = method;
            
            // Couleur dynamique
            if (window.getScoreColor) {
                element.style.color = window.getScoreColor(scoreValue);
            }
        });
        
        // Mise à jour des jauges
        gaugeElements.forEach(gauge => {
            const fill = gauge.querySelector('.gauge-fill') || gauge.querySelector('[data-gauge-fill]');
            if (fill) {
                fill.style.width = `${scoreValue}%`;
                if (this.getScoreGradient) {
                    fill.style.background = this.getScoreGradient(scoreValue);
                }
            }
        });
        
        // Debug pour développement
        console.log(`🎯 Score affiché: ${scoreValue}% (méthode: ${method})`);
    }
    
    updateLiveDuration(exercises) {
        const duration = this.calculateSessionDuration(exercises);
        const durationElement = document.getElementById('durationValue');
        if (durationElement) {
            durationElement.textContent = duration;
        }
    }
    
    calculateSessionDuration(exercises) {
        if (!exercises || exercises.length === 0) return 30;
        
        const duration = exercises.reduce((total, ex) => {
            return total + this.calculateExerciseDuration(ex);
        }, 5); // 5 min échauffement
        
        return Math.max(15, Math.min(120, Math.round(duration)));
    }
    
    // ===== UTILITAIRES =====

    async refresh() {
        try {
            console.log('🔄 Actualisation du planning...');
            
            // Sauvegarder l'état actuel pour rollback si erreur
            const previousProgram = this.activeProgram;
            const previousStructure = this.weeklyStructure;
            
            try {
                // Recharger le programme actif
                await this.loadActiveProgram();
                
                // Recharger les semaines depuis weekly_structure
                await this.loadWeeksData();
                
                // Re-render l'interface
                this.render();
                
                console.log('✅ Planning actualisé avec succès');
            } catch (error) {
                // Rollback en cas d'erreur
                console.error('❌ Erreur actualisation, rollback:', error);
                this.activeProgram = previousProgram;
                this.weeklyStructure = previousStructure;
                throw error;
            }
            
        } catch (error) {
            console.error('❌ Erreur actualisation complète:', error);
            window.showToast('Erreur lors de l\'actualisation', 'error');
        }
    }
    

    findSessionById(sessionId) {
        console.log('🔍 Recherche session:', sessionId, 'dans', this.weeksData.size, 'semaines');
        
        for (const [weekKey, weekData] of this.weeksData.entries()) {
            console.log('🔍 Vérification semaine:', weekKey, 'avec', weekData?.planning_data?.length || 0, 'jours');
            
            if (!weekData || !weekData.planning_data) continue;
            
            for (const day of weekData.planning_data) {
                if (!day.sessions) continue;
                
                for (const session of day.sessions) {
                    console.log('🔍 Session trouvée:', {
                        id: session.id,
                        sessionId: sessionId,
                        match: session.id == sessionId
                    });
                    
                    // CORRECTION : Comparaison flexible pour gérer String vs Number
                    if (session.id == sessionId || session.id === sessionId) {
                        console.log('✅ Session trouvée!', session);
                        return session;
                    }
                }
            }
        }
        
        console.warn('❌ Session non trouvée:', sessionId);
        return null;
    }

    findDateForSession(sessionId) {
        // Chercher dans les données actuelles de la semaine
        for (const [weekKey, weekData] of this.weeksData.entries()) {
            if (weekData?.planning_data) {
                for (const day of weekData.planning_data) {
                    if (day.sessions) {
                        for (const session of day.sessions) {
                            if (session.id == sessionId) {
                                return day.date;
                            }
                        }
                    }
                }
            }
        }
        return null;
    }
            
    async saveSessionChanges(sessionId, changes = null) {
        if (!changes) {
            const exerciseItems = document.querySelectorAll('#sessionExercisesList .exercise-item');
            const exercises = Array.from(exerciseItems).map(item => ({
                exercise_id: parseInt(item.dataset.exerciseId),
                exercise_name: item.querySelector('.exercise-name')?.textContent || 'Exercise',
                sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90
            }));
            changes = { exercises };
        }
        
        if (!changes.exercises || !Array.isArray(changes.exercises)) {
            throw new Error('Format changes invalide');
        }

        try {
            console.log('💾 Sauvegarde session dans schedule:', sessionId, changes);
            
            // Trouver la date de la session
            const sessionDate = this.findDateForSession(sessionId);
            if (!sessionDate) {
                throw new Error('Date de session introuvable');
            }
            
            // Mettre à jour via l'endpoint schedule
            const response = await window.apiPut(
                `/api/programs/${this.activeProgram.id}/schedule/${sessionDate}`,
                {
                    exercises: changes.exercises || [],
                    status: changes.status,
                    modifications: [{
                        type: 'manual_edit',
                        timestamp: new Date().toISOString(),
                        changes: changes
                    }]
                }
            );
            
            console.log('✅ Session mise à jour dans le schedule');
            window.showToast('Modifications enregistrées', 'success');
            
            // Rafraîchir l'affichage
            await this.refresh();
            
            return response;
            
        } catch (error) {
            console.error('❌ Erreur sauvegarde session:', error);
            window.showToast('Erreur lors de la sauvegarde', 'error');
            throw error;
        }
    }

    // Sauvegarde locale fallback
    saveToLocalStorage(sessionId, changes) {
        try {
            const key = 'planning_local_changes';
            const existing = JSON.parse(localStorage.getItem(key) || '{}');
            existing[sessionId] = { ...changes, timestamp: new Date().toISOString() };
            localStorage.setItem(key, JSON.stringify(existing));
            console.log('✅ Sauvegarde locale:', sessionId);
        } catch (error) {
            console.error('❌ Erreur sauvegarde locale:', error);
        }
    }
    

    // 11. ADAPTER startSession() pour utiliser Programme v2.0
    async startSession(sessionId) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session) {
                window.showToast('Session introuvable', 'error');
                return;
            }
            
            // Toujours nettoyer et réinitialiser pour programme
            window.clearWorkoutState(); // Nettoie tout l'état existant
            
            // Réinitialiser complètement pour programme
            window.currentWorkoutSession = {
                type: 'program',
                program: {
                    ...this.activeProgram,
                    exercises: session.exercises || []
                },
                workout: null,
                currentExercise: null,
                currentSetNumber: 1,
                exerciseOrder: 1,
                globalSetCount: 0,
                sessionFatigue: 3,
                completedSets: [],
                totalRestTime: 0,
                totalSetTime: 0,
                startTime: new Date(),
                programExercises: {},
                completedExercisesCount: 0,
                skipped_exercises: [],
                session_metadata: {},
                swaps: [],
                modifications: [],
                pendingSwap: null
            };
            
            // Update schedule status
            if (this.activeProgram.format_version === "2.0" && this.activeProgram.schedule) {
                const sessionDate = Object.keys(this.activeProgram.schedule).find(date => {
                    return this.activeProgram.schedule[date].session_id === sessionId;
                });
                
                if (sessionDate) {
                    try {
                        await window.apiPut(`/api/programs/${this.activeProgram.id}/schedule/${sessionDate}`, {
                            status: "in_progress",
                            started_at: new Date().toISOString()
                        });
                        this.activeProgram.schedule[sessionDate].status = "in_progress";
                        this.activeProgram.schedule[sessionDate].started_at = new Date().toISOString();
                    } catch (apiError) {
                        console.warn('❌ Schedule update failed:', apiError);
                    }
                }
            }
            
            // Maintenant confirmStartProgramWorkout aura le bon état
            await window.confirmStartProgramWorkout();
            window.closeModal();
            
        } catch (error) {
            console.error('❌ startSession error:', error);
            window.showToast('Erreur lors du démarrage', 'error');
        }
    }


    // 12. AJOUTER message si pas de programme
    showNoProgramMessage() {
        this.container.innerHTML = `
            <div class="planning-empty">
                <i class="fas fa-calendar-times" style="font-size: 3rem; color: var(--text-muted); margin-bottom: 1rem;"></i>
                <h3>Aucun programme actif</h3>
                <p>Créez d'abord un programme pour utiliser le planning</p>
                <button class="btn btn-primary" onclick="window.showProgramBuilder()">
                    <i class="fas fa-plus"></i> Créer un programme
                </button>
            </div>
        `;
    }

    calculateMuscleRecovery(sessions) {
        const recovery = {};
        const today = new Date();
        
        sessions.forEach(session => {
            const sessionDate = new Date(session.planned_date);
            const daysSince = Math.floor((today - sessionDate) / (1000 * 60 * 60 * 24));
            
            session.primary_muscles.forEach(muscle => {
                if (!recovery[muscle] || daysSince < recovery[muscle].days_since) {
                    recovery[muscle] = {
                        last_trained: session.planned_date,
                        days_since: daysSince,
                        ready: daysSince >= 2
                    };
                }
            });
        });
        
        return recovery;
    }

    generateOptimizationSuggestions(sessions) {
        const suggestions = [];
        
        const muscleCount = {};
        sessions.forEach(s => {
            s.primary_muscles.forEach(m => {
                muscleCount[m] = (muscleCount[m] || 0) + 1;
            });
        });
        
        const counts = Object.values(muscleCount);
        if (counts.length > 0) {
            const max = Math.max(...counts);
            const min = Math.min(...counts);
            if (max > min * 2) {
                suggestions.push('Équilibrer la répartition entre groupes musculaires');
            }
        }
        
        return suggestions;
    }

    validateDayRecovery(sessions, date) {
        const warnings = [];
        
        if (sessions.length > 2) {
            warnings.push('Plus de 2 séances prévues');
        }
        
        return warnings;
    }

    async applyOptimalOrder(sessionId) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session?.exercises?.length) {
                window.showToast('Aucun exercice à réorganiser', 'warning');
                return;
            }
            
            console.log('🎯 Optimisation de l\'ordre des exercices pour session:', sessionId);
            
            // Essayer l'API d'optimisation avec fallback
            let optimizedExercises;
            let newScore = 75;
            
            try {
                if (this.activeProgram) {
                    const response = await window.apiPost(
                        `/api/programs/${this.activeProgram.id}/optimize-session-order`,
                        { exercise_pool: session.exercises }
                    );
                    
                    if (response.optimized_order && Array.isArray(response.optimized_order)) {
                        // Réorganiser selon l'ordre optimisé de l'API
                        const exerciseMap = new Map();
                        session.exercises.forEach(ex => {
                            exerciseMap.set(ex.exercise_id || ex.id, ex);
                        });
                        
                        optimizedExercises = response.optimized_order
                            .map(id => exerciseMap.get(id))
                            .filter(Boolean);
                        
                        newScore = Math.round(response.optimized_score || 75);
                        console.log('✅ Ordre optimisé par l\'API, nouveau score:', newScore);
                    } else {
                        throw new Error('Réponse API invalide');
                    }
                } else {
                    throw new Error('Aucun programme actif');
                }
            } catch (apiError) {
                console.warn('⚠️ API optimisation non disponible, utilisation logique locale');
                
                // Logique locale d'optimisation basique
                optimizedExercises = this.applyLocalOptimalOrder(session.exercises);
                
                // Calcul de score local basique
                if (window.SessionQualityEngine && window.SessionQualityEngine.calculateSessionScore) {
                    try {
                        const scoreData = window.SessionQualityEngine.calculateSessionScore(optimizedExercises);
                        newScore = Math.round(scoreData.total || 75);
                    } catch (e) {
                        newScore = 75 + Math.floor(Math.random() * 10); // Score aléatoire pour simulation
                    }
                }
            }
            
            // Mettre à jour la session
            session.exercises = optimizedExercises;
            session.predicted_quality_score = newScore;
            
            // Mettre à jour l'affichage dans le modal d'édition
            const container = document.getElementById('sessionExercisesList');
            if (container) {
                container.innerHTML = optimizedExercises.map((ex, index) => `
                    <div class="exercise-preview-item" data-exercise-index="${index}">
                        <span class="exercise-drag-handle">
                            <i class="fas fa-grip-vertical"></i>
                        </span>
                        <span class="exercise-number">${index + 1}</span>
                        <div class="exercise-info">
                            <div class="exercise-name">${ex.name || ex.exercise_name || 'Exercice sans nom'}</div>
                            <div class="exercise-params">
                                ${ex.default_sets || ex.sets || 3} séries × 
                                ${ex.default_reps_min || ex.reps || 8}-${ex.default_reps_max || ex.reps || 12} reps
                            </div>
                        </div>
                        <div class="exercise-actions">
                            <button class="btn btn-sm btn-outline" onclick="planningManager.editExercise('${sessionId}', ${index})" title="Modifier l'exercice">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline btn-danger" onclick="planningManager.removeExercise('${sessionId}', ${index})" title="Supprimer l'exercice">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
                
                // Animation des numéros
                const numbers = container.querySelectorAll('.exercise-number');
                numbers.forEach((num, index) => {
                    num.style.transform = 'scale(0.8)';
                    setTimeout(() => {
                        num.style.transform = 'scale(1)';
                    }, index * 100 + 200);
                });
            }
            
            // Mettre à jour le score affiché
            const scoreElement = document.getElementById('scoreValue');
            if (scoreElement) {
                const oldScore = parseInt(scoreElement.textContent) || 75;
                
                // Animation du score
                scoreElement.style.transform = 'scale(1.2)';
                scoreElement.style.transition = 'all 0.3s ease';
                
                setTimeout(() => {
                    scoreElement.textContent = newScore;
                    
                    // Couleur selon le score
                    const scoreColor = newScore >= 85 ? '#10b981' : newScore >= 70 ? '#f59e0b' : '#ef4444';
                    scoreElement.style.color = scoreColor;
                    
                    const iconElement = scoreElement.parentNode.querySelector('i');
                    if (iconElement) {
                        iconElement.style.color = scoreColor;
                    }
                    
                    setTimeout(() => {
                        scoreElement.style.transform = 'scale(1)';
                    }, 300);
                }, 150);
            }
            
            // Réinitialiser le drag & drop
            this.initializeExerciseDragDrop(sessionId);
            
            // Sauvegarder les changements
            try {
                await this.saveSessionChanges(sessionId, { 
                    exercises: optimizedExercises, 
                    predicted_quality_score: newScore 
                });
                window.showToast(`Ordre optimisé (score: ${newScore}%)`, 'success');
            } catch (saveError) {
                console.warn('⚠️ Sauvegarde locale uniquement');
                this.saveSessionToLocalStorage(sessionId, session);
                window.showToast(`Ordre optimisé localement (score: ${newScore}%)`, 'info');
            }
            
        } catch (error) {
            console.error('❌ Erreur optimisation ordre:', error);
            window.showToast('Erreur lors de l\'optimisation', 'error');
        }
    }

    // Fonction d'optimisation locale basique
    applyLocalOptimalOrder(exercises) {
        if (!exercises || exercises.length <= 1) return exercises;
        
        // Logique basique : alterner groupes musculaires et organiser par intensité
        const exercisesCopy = [...exercises];
        
        // Trier par groupes musculaires pour éviter la fatigue consécutive
        const muscleGroups = new Map();
        exercisesCopy.forEach((ex, index) => {
            const primaryMuscle = ex.muscle_groups?.[0] || 'autre';
            if (!muscleGroups.has(primaryMuscle)) {
                muscleGroups.set(primaryMuscle, []);
            }
            muscleGroups.get(primaryMuscle).push({ exercise: ex, originalIndex: index });
        });
        
        // Réorganiser en alternant les groupes musculaires
        const reordered = [];
        const muscleEntries = Array.from(muscleGroups.entries());
        
        let maxLength = Math.max(...muscleEntries.map(([_, exs]) => exs.length));
        
        for (let i = 0; i < maxLength; i++) {
            muscleEntries.forEach(([muscle, exs]) => {
                if (exs[i]) {
                    reordered.push(exs[i].exercise);
                }
            });
        }
        
        return reordered.length > 0 ? reordered : exercisesCopy;
    }

    // NOUVELLE MÉTHODE - Optimisation locale
    optimizeExercisesLocally(exercises) {
        const scored = exercises.map((ex, index) => {
            let score = 0;
            const muscles = ex.muscle_groups || [];
            
            // Exercices composés d'abord
            if (muscles.length > 1) score += 10;
            
            // Gros groupes musculaires prioritaires
            const bigMuscles = ['legs', 'back', 'chest', 'shoulders'];
            if (muscles.some(m => bigMuscles.includes(m.toLowerCase()))) score += 5;
            
            // Éviter isolation en début
            const isolation = ['biceps', 'triceps', 'calves'];
            if (muscles.length === 1 && muscles.some(m => isolation.includes(m.toLowerCase()))) {
                score -= 5;
            }
            
            return { ...ex, score, originalIndex: index };
        });
        
        // Trier par score décroissant
        const optimized = scored
            .sort((a, b) => b.score - a.score)
            .map(ex => {
                delete ex.score;
                delete ex.originalIndex;
                return ex;
            });
        
        const improvement = Math.min(exercises.length * 2, 15);
        
        return { exercises: optimized, improvement };
    }

    async showAddSessionModal(targetDate, sessionIdToEdit = null) {
        try {
            const formattedDate = new Date(targetDate).toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            
            // Récupérer les exercices disponibles
            const exercisesResponse = await window.apiGet(`/api/exercises?user_id=${window.currentUser.id}`);
            
            // CORRECTIF : Déclarer sortedExercises dès le début
            let sortedExercises = exercisesResponse || [];
            
            // Si édition, récupérer les exercices déjà dans la session
            let existingExerciseIds = [];
            if (sessionIdToEdit && this.sessions) {
                const session = this.sessions.find(s => s.id === sessionIdToEdit);
                if (session && session.exercises) {
                    existingExerciseIds = session.exercises.map(ex => ex.id || ex.exercise_id);
                }
            }
            
            // Trier les exercices par contribution au score si la fonction existe
            if (this.sortExercisesByContribution || window.sortExercisesByContribution) {
                try {
                    sortedExercises = await (this.sortExercisesByContribution || window.sortExercisesByContribution)(exercisesResponse);
                } catch (e) {
                    console.warn('Tri par contribution non disponible, ordre par défaut');
                    // sortedExercises garde sa valeur initiale
                }
            }
            
            // CORRECTIF : S'assurer que sortedExercises est un array valide
            if (!Array.isArray(sortedExercises)) {
                console.error('sortedExercises n\'est pas un array valide');
                sortedExercises = [];
            }
            
            // Grouper par muscle après le tri
            const exercisesByMuscle = {};
            sortedExercises.forEach(exercise => {
                const muscle = exercise.muscle_groups?.[0] || 'Autres';
                if (!exercisesByMuscle[muscle]) {
                    exercisesByMuscle[muscle] = [];
                }
                exercisesByMuscle[muscle].push(exercise);
            });
            
            // Générer HTML pour chaque groupe musculaire
            const muscleGroupsHtml = Object.entries(exercisesByMuscle).map(([muscle, exercises]) => {
                const muscleColor = this.getMuscleGroupColor?.(muscle) || '#6b7280';
                const muscleIcon = this.getMuscleGroupIcon?.(muscle) || '💪';
                
                return `
                    <div class="muscle-group-section" data-muscle="${muscle}">
                        <div class="muscle-group-header">
                            <span class="muscle-icon" style="color: ${muscleColor}">${muscleIcon}</span>
                            <span class="muscle-name">${muscle}</span>
                            <span class="muscle-count">${exercises.length}</span>
                        </div>
                        <div class="muscle-exercises-panel">
                            ${exercises.map(ex => {
                                const isDisabled = existingExerciseIds.includes(ex.id);
                                const exerciseData = JSON.stringify({
                                    exercise_id: ex.id,
                                    exercise_name: ex.name,
                                    muscle_groups: ex.muscle_groups || [],
                                    sets: ex.default_sets || 3,
                                    reps_min: ex.default_reps_min || 8,
                                    reps_max: ex.default_reps_max || 12,
                                    rest_time: ex.default_rest_time || 90,
                                    equipment: ex.equipment || 'Aucun'
                                }).replace(/"/g, '&quot;');
                                
                                const truncatedName = ex.name.length > 25 ? ex.name.substring(0, 22) + '...' : ex.name;
                                
                                return `
                                    <label class="exercise-option ${isDisabled ? 'disabled' : ''}" title="${ex.name}">
                                        <input type="checkbox" 
                                            value="${ex.id}"
                                            data-exercise="${exerciseData}"
                                            ${isDisabled ? 'disabled' : ''}>
                                        <div class="exercise-option-content">
                                            <div class="exercise-name">${truncatedName}</div>
                                            <div class="exercise-params">
                                                ${ex.default_sets || 3} × ${ex.default_reps_min || 8}-${ex.default_reps_max || 12}
                                            </div>
                                        </div>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');
            
            // Structure HTML verticale complète
            const modalContent = `
                <div class="planning-modal-vertical">
                    <!-- Section exercices disponibles -->
                    <div class="exercises-selection-section">
                        <div class="section-header clickable" onclick="planningManager.toggleExercisesList()">
                            <div class="header-content">
                                <i class="fas fa-dumbbell"></i>
                                <h4>Exercices disponibles</h4>
                                <span class="exercise-count-badge">${sortedExercises.length}</span>
                                <i class="fas fa-chevron-down toggle-chevron"></i>
                            </div>
                            <div class="selection-info">
                                <span id="selectedCount">0</span> sélectionné(s)
                            </div>
                        </div>
                        
                        <!-- Barre de recherche discrète -->
                        <div class="search-bar-container">
                            <i class="fas fa-search search-icon"></i>
                            <input type="text" 
                                class="exercise-search-input" 
                                placeholder="Rechercher..."
                                oninput="planningManager.filterExercises(this.value)">
                        </div>
                        
                        <!-- Liste des exercices sur 2 colonnes -->
                        <div class="exercises-list-container">
                            <div class="exercises-grid" id="exerciseSelectionGrid">
                                ${muscleGroupsHtml}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Section aperçu de la séance -->
                    <div class="session-preview-section">
                        <div class="preview-header">
                            <div class="header-content">
                                <i class="fas fa-eye"></i>
                                <h4>Aperçu de la séance</h4>
                            </div>
                            <button class="magic-wand-btn" 
                                    id="optimizeBtn"
                                    style="display: none;"
                                    onclick="planningManager.optimizeExerciseOrder()"
                                    title="Optimiser l'ordre">
                                <i class="fas fa-magic"></i>
                            </button>
                        </div>
                        
                        <!-- Métriques avec icônes -->
                        <div class="session-metrics-row" id="sessionMetrics" style="display: none;">
                            <div class="metric">
                                <i class="fas fa-list-ol"></i>
                                <span class="metric-value" id="exerciseCountMetric">0</span>
                                <span class="metric-label">exercices</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-clock"></i>
                                <span class="metric-value" id="durationMetric">0</span>
                                <span class="metric-label">min</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-fire"></i>
                                <span class="metric-value" id="muscleCountMetric">0</span>
                                <span class="metric-label">muscles</span>
                            </div>
                            <div class="metric quality-metric">
                                <i class="fas fa-chart-line"></i>
                                <span class="metric-value" id="qualityMetric" data-score="0">0%</span>
                                <span class="metric-label">qualité</span>
                            </div>
                        </div>
                        
                        <!-- Liste des exercices sélectionnés -->
                        <div id="previewExercisesList" class="selected-exercises-list">
                            <div class="empty-preview">
                                <i class="fas fa-hand-pointer"></i>
                                <p>Sélectionnez des exercices</p>
                            </div>
                        </div>
                        
                        <!-- Groupes musculaires colorés -->
                        <div class="muscle-groups-tags" id="muscleGroupsSummary" style="display: none;">
                            <!-- Généré dynamiquement -->
                        </div>
                    </div>
                    
                    <!-- Actions -->
                    <div class="modal-actions-bottom">
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            Annuler
                        </button>
                        <button class="btn btn-primary" 
                                id="createSessionBtn" 
                                disabled
                                onclick="planningManager.${sessionIdToEdit ? `addExercisesToSession('${sessionIdToEdit}')` : `createSession('${targetDate}')`}">
                            <i class="fas fa-check"></i> 
                            ${sessionIdToEdit ? 'Ajouter' : 'Créer la séance'}
                        </button>
                    </div>
                </div>
            `;
            
            // Utiliser le système modal standard avec titre et sous-titre
            const modalTitle = `
                <div class="modal-title-with-date">
                    <span>${sessionIdToEdit ? 'Ajouter des exercices' : 'Créer une séance'}</span>
                    <div class="modal-subtitle">
                        <i class="fas fa-calendar-alt"></i>
                        <span>${formattedDate}</span>
                    </div>
                </div>
            `;
            
            window.showModal(modalTitle, modalContent);
            
            // Initialiser les fonctionnalités
            this.initializeSessionCreation(sessionIdToEdit);
            
        } catch (error) {
            console.error('❌ Erreur ouverture modal:', error);
            window.showToast('Erreur lors de l\'ouverture', 'error');
        }
    }

    async addExercisesToSession(sessionId) {
        try {
            const session = this.findSessionById(sessionId);
            if (!session) {
                window.showToast('Session introuvable', 'error');
                return;
            }
            
            const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
            if (selected.length === 0) {
                window.showToast('Aucun exercice sélectionné', 'warning');
                return;
            }
            
            const newExercises = selected.map(input => {
                try {
                    const jsonData = input.dataset.exercise.replace(/&apos;/g, "'");
                    return JSON.parse(jsonData);
                } catch (e) {
                    return null;
                }
            }).filter(Boolean);
            
            // Ajouter les nouveaux exercices à la session
            session.exercises = session.exercises || [];
            session.exercises.push(...newExercises);
            
            // Recalculer le score
            if (window.SessionQualityEngine) {
                try {
                    const scoreData = await window.SessionQualityEngine.calculateSessionScore(session.exercises);
                    session.predicted_quality_score = Math.round(scoreData.total || 75);
                } catch (e) {
                    console.warn('Calcul score fallback:', e);
                }
            }
            
            // Sauvegarder
            try {
                await this.saveSessionChanges(sessionId, session);
                window.showToast(`${newExercises.length} exercice(s) ajouté(s)`, 'success');
            } catch (e) {
                console.warn('Sauvegarde locale:', e);
                this.saveSessionToLocalStorage(sessionId, session);
            }
            
            window.closeModal();
            
            // Rouvrir le modal d'édition
            setTimeout(() => {
                this.showSessionEditModal(session);
            }, 300);
            
        } catch (error) {
            console.error('❌ Erreur ajout exercices:', error);
            window.showToast('Erreur lors de l\'ajout', 'error');
        }
    }

    // NOUVELLE méthode pour tronquer les noms
    truncateText(text, maxLength = 25) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    }

    // NOUVELLE méthode pour toggle exercices
    toggleExercisesList() {
        const container = document.querySelector('.exercises-list-container');
        const searchContainer = document.querySelector('.search-bar-container');
        const chevron = document.querySelector('.toggle-chevron');
        
        if (!container || !chevron) return;
        
        const isCollapsed = container.classList.contains('collapsed');
        
        if (isCollapsed) {
            container.classList.remove('collapsed');
            if (searchContainer) searchContainer.style.display = 'flex';
            chevron.classList.remove('closed');
        } else {
            container.classList.add('collapsed');
            if (searchContainer) searchContainer.style.display = 'none';
            chevron.classList.add('closed');
        }
        
        localStorage.setItem('exercisesSectionCollapsed', !isCollapsed);
    }

    updateSessionMetrics(exercises) {
        // Nombre d'exercices
        const exerciseCountEl = document.getElementById('exerciseCountMetric');
        if (exerciseCountEl) {
            exerciseCountEl.textContent = exercises.length;
        }
        
        // Durée estimée
        const durationEl = document.getElementById('durationMetric');
        if (durationEl) {
            const duration = this.calculateSessionDuration(exercises);
            durationEl.textContent = duration;
        }
        
        // Muscles travaillés
        const muscles = [...new Set(exercises.flatMap(ex => ex.muscle_groups || []))].filter(Boolean);
        const muscleCountEl = document.getElementById('muscleCountMetric');
        if (muscleCountEl) {
            muscleCountEl.textContent = muscles.length;
        }
        
        // Score de qualité
        const scoreElement = document.getElementById('qualityMetric');
        if (scoreElement) {
            const score = this.calculatePreviewQualityScoreFallback(exercises);
            const oldScore = parseInt(scoreElement.dataset.score) || 0;
            
            if (score !== oldScore) {
                // Utiliser getScoreColor de session_quality_engine.js si disponible
                const scoreColor = window.getScoreColor ? window.getScoreColor(score) : (
                    score >= 85 ? '#10b981' : 
                    score >= 70 ? '#f59e0b' : 
                    '#ef4444'
                );
                scoreElement.textContent = `${score}%`;
                scoreElement.dataset.score = score;
                scoreElement.style.color = scoreColor;
                
                // Chercher l'icône dans le parent correct
                const metricDiv = scoreElement.closest('.quality-metric');
                if (metricDiv) {
                    const icon = metricDiv.querySelector('i');
                    if (icon) icon.style.color = scoreColor;
                }
                
                // Animation du changement si animateScoreChange existe
                if (oldScore > 0) {
                    if (this.animateScoreChange) {
                        this.animateScoreChange(scoreElement, oldScore, score);
                    } else {
                        // Animation simple
                        scoreElement.classList.add('score-updating');
                        setTimeout(() => scoreElement.classList.remove('score-updating'), 600);
                    }
                }
            }
        }
        
        // Mise à jour des groupes musculaires colorés
        const muscleGroupsSummary = document.getElementById('muscleGroupsSummary');
        if (muscleGroupsSummary) {
            if (muscles.length > 0) {
                const muscleTags = muscles.map(muscle => {
                    const color = this.getMuscleGroupColor?.(muscle) || '#6b7280';
                    return `<span class="muscle-tag" style="background-color: ${color}20; color: ${color}; border: 1px solid ${color}40">${muscle}</span>`;
                }).join('');
                
                muscleGroupsSummary.innerHTML = muscleTags;
                muscleGroupsSummary.style.display = 'flex';
            } else {
                muscleGroupsSummary.style.display = 'none';
            }
        }
    }

    // méthode pour initialiser la création de séance
    initializeSessionCreation(sessionIdToEdit = null) {
        const checkboxes = document.querySelectorAll('.exercise-option input[type="checkbox"]');
        const createBtn = document.getElementById('createSessionBtn');
        const selectedCounter = document.getElementById('selectedCount');
        
        // Configuration
        const maxExercises = 8;
        let debounceTimer = null;
        
        // Fonction de mise à jour de l'aperçu
        const updatePreview = () => {
            const selected = Array.from(checkboxes).filter(cb => cb.checked);
            if (selectedCounter) {  // Vérifier l'existence
                selectedCounter.textContent = selected.length;
            }
            
            // Activer/désactiver le bouton
            if (createBtn) {
                createBtn.disabled = selected.length === 0;
            }
            
            // Limiter le nombre d'exercices
            if (selected.length >= maxExercises) {
                checkboxes.forEach(cb => {
                    if (!cb.checked && !cb.disabled) {
                        cb.setAttribute('data-was-disabled', 'temp');
                        cb.disabled = true;
                    }
                });
            } else {
                checkboxes.forEach(cb => {
                    if (cb.getAttribute('data-was-disabled') === 'temp') {
                        cb.disabled = false;
                        cb.removeAttribute('data-was-disabled');
                    }
                });
            }
            
            // Mettre à jour l'aperçu
            const previewList = document.getElementById('previewExercisesList');
            if (!previewList) return;
            
            if (selected.length === 0) {
                previewList.innerHTML = `
                    <div class="empty-preview">
                        <i class="fas fa-hand-pointer"></i>
                        <p>Sélectionnez des exercices</p>
                    </div>
                `;
                
                const metrics = document.getElementById('sessionMetrics');
                const summary = document.getElementById('muscleGroupsSummary');
                const optimizeBtn = document.getElementById('optimizeBtn');
                
                if (metrics) metrics.style.display = 'none';
                if (summary) summary.style.display = 'none';
                if (optimizeBtn) optimizeBtn.style.display = 'none';
            } else {
                // Construire la liste des exercices
                const exercises = selected.map(cb => {
                    try {
                        return JSON.parse(cb.dataset.exercise.replace(/&quot;/g, '"'));
                    } catch (e) {
                        console.error('Erreur parsing exercice:', e);
                        return null;
                    }
                }).filter(Boolean);
                
                // Générer le HTML des exercices
                const exercisesHtml = exercises.map((ex, index) => `
                    <div class="selected-exercise-item" 
                        data-exercise-id="${ex.exercise_id}"
                        data-exercise='${JSON.stringify(ex).replace(/'/g, '&apos;')}'>
                        <div class="drag-handle">
                            <i class="fas fa-grip-vertical"></i>
                        </div>
                        <div class="exercise-content">
                            <span class="exercise-number">${index + 1}</span>
                            <div class="exercise-details">
                                <div class="exercise-name">${ex.exercise_name}</div>
                                <div class="exercise-params">
                                    ${ex.sets} × ${ex.reps_min}-${ex.reps_max}
                                </div>
                            </div>
                        </div>
                        <button class="remove-btn" 
                                onclick="planningManager.removeExerciseFromPreview('${ex.exercise_id}')"
                                title="Retirer">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('');
                
                previewList.innerHTML = exercisesHtml;
                
                // Afficher les métriques
                const metrics = document.getElementById('sessionMetrics');
                if (metrics) metrics.style.display = 'flex';
                
                // Mettre à jour les métriques
                if (this.updateSessionMetrics) {
                    this.updateSessionMetrics(exercises);
                }
                
                // Afficher la baguette magique si 2+ exercices
                const optimizeBtn = document.getElementById('optimizeBtn');
                if (optimizeBtn) {
                    optimizeBtn.style.display = exercises.length >= 2 ? 'flex' : 'none';
                }
                
                // Initialiser le drag & drop
                if (this.initializeExerciseDragDrop) {
                    this.initializeExerciseDragDrop();
                }
                
                // Initialiser le swipe mobile
                if ('ontouchstart' in window && this.initializeMobileSwipe) {
                    this.initializeMobileSwipe();
                }
            }
        };
        
        // CORRECTIF : Stocker la fonction pour y accéder depuis removeExerciseFromPreview
        this._updatePreviewFunction = updatePreview;
        
        // Attacher les event listeners
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(updatePreview, 100);
            });
        });
        
        // Initialiser l'état
        updatePreview();
        
        // Restaurer l'état collapsé si sauvegardé
        const isCollapsed = localStorage.getItem('exercisesSectionCollapsed') === 'true';
        if (isCollapsed && this.toggleExercisesList) {
            this.toggleExercisesList();
        }
    }
        
    // Utiliser toggleExercisesList existante ou l'adapter pour la nouvelle structure
    toggleExercisesList() {
        // Adapter pour la structure verticale
        const container = document.querySelector('.exercises-list-container');
        const searchContainer = document.querySelector('.search-bar-container');
        const chevron = document.querySelector('.toggle-chevron');
        
        if (!container || !chevron) return;
        
        const isCollapsed = container.classList.contains('collapsed');
        
        if (isCollapsed) {
            container.classList.remove('collapsed');
            if (searchContainer) searchContainer.style.display = 'flex';
            chevron.classList.remove('closed');
        } else {
            container.classList.add('collapsed');
            if (searchContainer) searchContainer.style.display = 'none';
            chevron.classList.add('closed');
        }
        
        // Sauvegarder préférence
        localStorage.setItem('exercisesSectionCollapsed', !isCollapsed);
    }

    // GARDER cette méthode existante
    calculatePreviewQualityScoreFallback(exercises) {
        if (!exercises || exercises.length === 0) return 0;
        
        const muscleGroups = [...new Set(exercises.flatMap(ex => ex.muscle_groups || []))];
        const muscleCount = muscleGroups.length;
        const exerciseCount = exercises.length;
        
        let score = 50;
        
        // Bonus diversité musculaire
        score += Math.min(25, muscleCount * 8);
        
        // Bonus nombre d'exercices optimal
        if (exerciseCount >= 3 && exerciseCount <= 6) {
            score += 15;
        } else if (exerciseCount < 3) {
            score += exerciseCount * 5;
        } else {
            score += Math.max(0, 15 - (exerciseCount - 6) * 3);
        }
        
        // Bonus équilibre
        const avgExercisesPerMuscle = exerciseCount / muscleCount;
        if (avgExercisesPerMuscle >= 1.5 && avgExercisesPerMuscle <= 2.5) {
            score += 10;
        }
        
        return Math.min(100, Math.round(score));
    }

    async sortExercisesByContribution(exercises) {
        // TOUJOURS retourner un array, jamais undefined
        if (!exercises || !Array.isArray(exercises)) {
            console.warn('sortExercisesByContribution: input invalide');
            return [];
        }
        
        // Si pas de SessionQualityEngine, retourner les exercices non triés
        if (!window.SessionQualityEngine || typeof window.SessionQualityEngine.sortByQualityContribution !== 'function') {
            console.warn('SessionQualityEngine.sortByQualityContribution non disponible');
            return exercises; // Retourner l'array original, PAS undefined !
        }
        
        try {
            const sorted = await window.SessionQualityEngine.sortByQualityContribution(exercises);
            // Vérifier que le résultat est valide
            return Array.isArray(sorted) ? sorted : exercises;
        } catch (error) {
            console.error('Erreur tri par contribution:', error);
            return exercises; // En cas d'erreur, retourner l'original
        }
    }

    filterExercises(searchTerm) {
        // Détecter si on est dans le modal planning
        if (document.querySelector('.planning-modal-vertical')) {
            const term = searchTerm.toLowerCase().trim();
            const muscleGroups = document.querySelectorAll('.muscle-group-section');
            
            muscleGroups.forEach(group => {
                let hasVisibleExercise = false;
                
                group.querySelectorAll('.exercise-option').forEach(option => {
                    const exerciseName = option.querySelector('.exercise-name').textContent.toLowerCase();
                    const muscleName = group.dataset.muscle.toLowerCase();
                    
                    if (!term || exerciseName.includes(term) || muscleName.includes(term)) {
                        option.style.display = 'flex';
                        hasVisibleExercise = true;
                    } else {
                        option.style.display = 'none';
                    }
                });
                
                group.style.display = hasVisibleExercise ? 'block' : 'none';
            });
            return;
        }
        
        // Code existant pour le contexte original...
        const filter = searchTerm || document.getElementById('muscleFilter')?.value || '';
        const exercises = document.querySelectorAll('.exercise-item');
        
        exercises.forEach(exercise => {
            const text = exercise.textContent.toLowerCase();
            const exerciseId = parseInt(exercise.dataset.exerciseId);
            
            let visible = false;
            
            if (!filter) {
                visible = true;
            } else if (filter === 'favoris') {
                visible = window.userFavorites?.includes(exerciseId) || false;
            } else {
                visible = text.includes(filter.toLowerCase());
            }
            
            exercise.style.display = visible ? 'block' : 'none';
        });
    }

    // Fonction helper pour calcul de score fallback
    calculatePreviewQualityScoreFallback(exercises) {
        if (!exercises || exercises.length === 0) return 0;
        
        const muscleGroups = [...new Set(exercises.flatMap(ex => ex.muscle_groups || []))];
        const muscleCount = muscleGroups.length;
        const exerciseCount = exercises.length;
        
        let score = 50;
        
        // Bonus diversité musculaire
        score += Math.min(25, muscleCount * 8);
        
        // Bonus nombre d'exercices optimal
        if (exerciseCount >= 3 && exerciseCount <= 6) {
            score += 15;
        } else if (exerciseCount < 3) {
            score += exerciseCount * 5;
        } else {
            score += Math.max(0, 15 - (exerciseCount - 6) * 3);
        }
        
        // Bonus équilibre
        const avgExercisesPerMuscle = exerciseCount / muscleCount;
        if (avgExercisesPerMuscle >= 1.5 && avgExercisesPerMuscle <= 2.5) {
            score += 10;
        }
        
        return Math.min(100, Math.round(score));
    }

    // Fonction pour retirer un exercice de l'aperçu
    removeExerciseFromPreview(exerciseId) {
        try {
            // Décocher la checkbox correspondante
            const checkbox = document.querySelector(`input[value="${exerciseId}"]`);
            if (checkbox) {
                checkbox.checked = false;
                checkbox.disabled = false;
            }
            
            // Déclencher manuellement l'événement change pour mettre à jour l'aperçu
            const event = new Event('change', { bubbles: true });
            if (checkbox) checkbox.dispatchEvent(event);
            
            // Alternative : Si initializeSessionCreation a stocké updatePreview
            if (this._updatePreviewFunction) {
                this._updatePreviewFunction();
            }
            
        } catch (error) {
            console.error('Erreur suppression exercice preview:', error);
        }
    }

    // Fonction pour optimiser l'ordre dans l'aperçu
    async optimizePreviewOrder() {
        const previewItems = document.querySelectorAll('#previewExercisesList .exercise-preview-item');
        
        if (previewItems.length < 2) {
            window.showToast('Au moins 2 exercices nécessaires pour optimiser', 'info');
            return;
        }
        
        try {
            // Extraire les exercices dans l'ordre actuel
            const exercises = this.getPreviewExercises();
            
            // Réorganisation locale basique
            const optimized = this.applyLocalOptimalOrder(exercises);
            
            // Reconstruire l'aperçu avec le nouvel ordre
            const container = document.getElementById('previewExercisesList');
            if (container) {
                container.innerHTML = optimized.map((ex, index) => `
                    <div class="exercise-preview-item" 
                        data-exercise-id="${ex.exercise_id}"
                        data-exercise='${JSON.stringify(ex).replace(/'/g, '&apos;')}'>
                        <span class="exercise-drag-handle">
                            <i class="fas fa-grip-vertical"></i>
                        </span>
                        <span class="exercise-number">${index + 1}</span>
                        <div class="exercise-info">
                            <div class="exercise-name">${ex.exercise_name}</div>
                            <div class="exercise-params">${ex.sets || 3} × ${ex.reps_min || 8}-${ex.reps_max || 12}</div>
                        </div>
                        <button class="btn btn-sm btn-outline btn-danger exercise-remove" 
                                onclick="planningManager.removeExerciseFromPreview('${ex.exercise_id}')"
                                title="Retirer cet exercice">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `).join('');
                
                // Réinitialiser le drag & drop
                this.initializeExerciseDragDrop();
                
                window.showToast('Ordre des exercices optimisé', 'success');
            }
            
        } catch (error) {
            console.error('❌ Erreur optimisation preview:', error);
            window.showToast('Erreur lors de l\'optimisation', 'error');
        }
    }


    // AJOUTER mise à jour animée du score
    updateScoreDisplay(newScore) {
        const scoreElement = document.querySelector('.quality-score .stat-value');
        if (!scoreElement) return;
        
        const oldScore = parseInt(scoreElement.dataset.score) || 75;
        const scoreColor = this.getScoreColor ? this.getScoreColor(newScore) : '#10b981';
        
        // Animation du changement
        scoreElement.style.transform = 'scale(1.2)';
        scoreElement.textContent = `${newScore}%`;
        scoreElement.style.color = scoreColor;
        scoreElement.dataset.score = newScore;
        
        const iconElement = document.querySelector('.quality-score i');
        if (iconElement) {
            iconElement.style.color = scoreColor;
        }
        
        // Afficher le delta
        const delta = newScore - oldScore;
        if (Math.abs(delta) > 0) {
            const deltaElement = document.createElement('span');
            deltaElement.className = 'score-delta';
            deltaElement.textContent = delta > 0 ? `+${delta}` : `${delta}`;
            deltaElement.style.color = delta > 0 ? '#10b981' : '#ef4444';
            scoreElement.parentElement.appendChild(deltaElement);
            
            setTimeout(() => {
                deltaElement.style.opacity = '0';
                setTimeout(() => deltaElement.remove(), 300);
            }, 2000);
        }
        
        setTimeout(() => {
            scoreElement.style.transform = 'scale(1)';
        }, 300);
    }

    // Support swipe mobile
    initializeMobileSwipe() {
        // Vérifier le support tactile
        if (!('ontouchstart' in window)) return;
        
        const items = document.querySelectorAll('.exercise-preview-item');

            
        items.forEach(item => {
            let startX = 0;
            let currentX = 0;
            let isDragging = false;
            
            const handleStart = (e) => {
                if (e.target.closest('.exercise-drag-handle')) return;
                
                const touch = e.type.includes('touch') ? e.touches[0] : e;
                startX = touch.clientX;
                isDragging = true;
                item.style.transition = 'none';
            };
            
            const handleMove = (e) => {
                if (!isDragging) return;
                e.preventDefault();
                
                const touch = e.type.includes('touch') ? e.touches[0] : e;
                currentX = touch.clientX;
                const diff = startX - currentX;
                
                if (diff > 0) {
                    item.style.transform = `translateX(-${Math.min(diff, 100)}px)`;
                    item.style.opacity = Math.max(0.3, 1 - (diff / 200));
                    
                    if (diff > 50) {
                        item.classList.add('swipe-delete');
                    } else {
                        item.classList.remove('swipe-delete');
                    }
                }
            };
            
            const handleEnd = (e) => {
                if (!isDragging) return;
                isDragging = false;
                
                const diff = startX - currentX;
                item.style.transition = 'all 0.3s ease';
                
                if (diff > 80) {
                    // Swipe pour supprimer
                    item.style.transform = 'translateX(-120%)';
                    item.style.opacity = '0';
                    
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                    
                    setTimeout(() => {
                        const exerciseId = item.dataset.exerciseId;
                        this.removeExerciseFromPreview(exerciseId);
                    }, 300);
                } else {
                    // Annuler
                    item.style.transform = '';
                    item.style.opacity = '';
                    item.classList.remove('swipe-delete');
                }
            };
            
            // Support tactile
            item.addEventListener('touchstart', handleStart, { passive: true });
            item.addEventListener('touchmove', handleMove, { passive: false });
            item.addEventListener('touchend', handleEnd);
        });
    }

    // mise à jour des numéros
    updateExerciseNumbers() {
        const items = document.querySelectorAll('#previewExercisesList .selected-exercise-item');
        items.forEach((item, index) => {
            const numberEl = item.querySelector('.exercise-number');
            if (numberEl) {
                numberEl.textContent = index + 1;
                // Petite animation
                numberEl.classList.add('updating');
                setTimeout(() => numberEl.classList.remove('updating'), 300);
            }
        });
    }

    // Fonction pour récupérer les exercices de l'aperçu
    getPreviewExercises() {
        const container = document.getElementById('previewExercisesList');
        if (!container) return [];
        
        const items = container.querySelectorAll('.selected-exercise-item');
        return Array.from(items).map(item => {
            try {
                return JSON.parse(item.dataset.exercise.replace(/&apos;/g, "'"));
            } catch (e) {
                return null;
            }
        }).filter(Boolean);
    }

    // 6. REMPLACER createSession() par cette version qui modifie weekly_structure
    async createSession(targetDate) {
        // CORRECTION : Validation et normalisation de la date
        let normalizedDate;
        try {
            const dateObj = new Date(targetDate);
            if (isNaN(dateObj.getTime())) {
                throw new Error('Date invalide');
            }
            normalizedDate = dateObj.toISOString().split('T')[0];
        } catch (e) {
            console.error('❌ Erreur format date:', targetDate, e);
            window.showToast('Format de date invalide', 'error');
            return;
        }

        const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
        
        if (selected.length === 0) {
            window.showToast('Sélectionnez au moins un exercice', 'warning');
            return;
        }
        
        // CORRECTION : Validation robuste des exercices
        const exercises = selected.map(input => {
            try {
                if (!input.dataset.exercise) {
                    console.warn('⚠️ Input sans data-exercise:', input);
                    return null;
                }
                return JSON.parse(input.dataset.exercise);
            } catch (e) {
                console.error('Erreur parsing exercice:', e);
                return null;
            }
        }).filter(Boolean);
        
        if (exercises.length === 0) {
            window.showToast('Erreur dans la sélection d\'exercices', 'error');
            return;
        }

        try {
            console.log(`🔧 Création séance pour ${normalizedDate}`);
            console.log(`📊 ${selected.length} exercices sélectionnés`);
            
            const exercises = selected.map(input => {
                try {
                    const exerciseData = JSON.parse(input.dataset.exercise);
                    
                    // Validation des données d'exercice
                    if (!exerciseData.exercise_id || !exerciseData.exercise_name) {
                        console.warn('⚠️ Exercice invalide ignoré:', exerciseData);
                        return null;
                    }
                    
                    return exerciseData;
                } catch (e) {
                    console.error('❌ Erreur parsing exercice:', e);
                    return null;
                }
            }).filter(Boolean);
            
            if (exercises.length === 0) {
                window.showToast('Erreur dans la sélection d\'exercices', 'error');
                return;
            }
            // Vérifier limite de séances par jour via l'API
            try {
                const existingSchedule = await window.apiGet(`/api/programs/${this.activeProgram.id}/schedule?week_start=${targetDate}`);
                const daySchedule = existingSchedule.planning_data?.find(day => day.date === targetDate);
                if (daySchedule && daySchedule.sessions && daySchedule.sessions.length >= 2) {
                    window.showToast('Maximum 2 séances par jour atteint', 'warning');
                    return;
                }
            } catch (error) {
                console.warn('⚠️ Impossible de vérifier les séances existantes, continuation...');
            }
            
            // Calculer la durée estimée - utiliser la logique du backend
            const estimatedDuration = exercises.reduce((total, ex) => {
                const sets = ex.sets || 3;
                const restSeconds = ex.rest_seconds || 90;
                
                // Logique identique à calculate_session_duration du backend
                const restTime = (restSeconds * (sets - 1)) / 60;
                const workTime = sets * 2; // 2min par série (plus réaliste que 1.5)
                const setupTime = 1; // 1min de préparation par exercice
                
                return total + restTime + workTime + setupTime;
            }, 0);
            
            // Préparer la nouvelle session au format v2.0
            const newSession = {
                exercise_pool: exercises.map(ex => ({
                    exercise_id: ex.exercise_id,
                    exercise_name: ex.exercise_name || ex.name,
                    sets: ex.sets || 3,
                    reps_min: ex.reps_min || 8,
                    reps_max: ex.reps_max || 12,
                    rest_seconds: ex.rest_seconds || 90,
                    muscle_groups: ex.muscle_groups || [ex.primary_muscle || 'autre'],
                    equipment_required: ex.equipment_required || ex.equipment || []
                })),
                session_type: 'custom',
                created_date: targetDate,
                estimated_duration: Math.round(estimatedDuration),
                target_duration: Math.round(estimatedDuration),
                primary_muscles: this.extractPrimaryMuscles(exercises),
                quality_score: 75,
                focus: this.extractPrimaryMuscles(exercises)[0] || 'général'
            };
            
            console.log('📝 Nouvelle session créée:', newSession);
            
            console.log('📤 Envoi ajout au planning...');

            // Préparer les données pour l'endpoint schedule
            const scheduleData = {
                date: normalizedDate,
                exercises: newSession.exercise_pool,
                estimated_duration: newSession.estimated_duration,
                primary_muscles: newSession.primary_muscles,
                quality_score: newSession.quality_score,
                status: 'planned',
                session_type: 'custom'
            };

            try {
                const response = await window.apiPost(`/api/programs/${this.activeProgram.id}/schedule`, scheduleData);
                console.log('✅ Séance ajoutée au planning avec succès');
                
                window.closeModal();
                window.showToast('Séance créée avec succès', 'success');
                await this.refresh();
                
            } catch (error) {
                console.error('❌ Erreur ajout planning:', error);
                
                // Messages d'erreur plus précis
                if (error.message?.includes('400') && error.message?.includes('existe déjà')) {
                    window.showToast('Une séance existe déjà à cette date', 'warning');
                } else if (error.message?.includes('400') && error.message?.includes('Maximum')) {
                    window.showToast('Maximum 2 séances par jour atteint', 'warning');
                } else {
                    window.showToast('Erreur lors de la création', 'error');
                }
                throw error;
            }
            
        } catch (error) {
            console.error('❌ Erreur création séance:', error);
            window.showToast('Erreur lors de la création', 'error');
        }
    }
    
    async optimizeExerciseOrder() {
        const container = document.getElementById('previewExercisesList');
        const items = container?.querySelectorAll('.selected-exercise-item');
        
        if (!items || items.length < 2) {
            window.showToast('Au moins 2 exercices nécessaires', 'info');
            return;
        }
        
        const btn = document.getElementById('optimizeBtn');
        if (btn) btn.classList.add('optimizing');
        
        try {
            // Récupérer les exercices actuels
            const exercises = Array.from(items).map(item => {
                try {
                    return JSON.parse(item.dataset.exercise.replace(/&apos;/g, "'"));
                } catch (e) {
                    return null;
                }
            }).filter(Boolean);
            
            console.log('Exercices avant optimisation:', exercises.map(e => e.exercise_name));
            
            let optimizedOrder = exercises;
            
            // Essayer l'optimisation serveur si disponible
            if (this.activeProgram?.id && window.apiPost) {
                try {
                    // Utiliser l'endpoint serveur reorder_session_exercises
                    const response = await window.apiPost(
                        `/api/sessions/reorder`,
                        { 
                            exercises: exercises.map(ex => ({
                                exercise_id: ex.exercise_id,
                                exercise_name: ex.exercise_name,
                                muscle_groups: ex.muscle_groups,
                                sets: ex.sets,
                                reps_min: ex.reps_min,
                                reps_max: ex.reps_max
                            }))
                        }
                    );
                    
                    if (response.optimized_exercises) {
                        optimizedOrder = response.optimized_exercises;
                        console.log('Optimisation serveur réussie');
                    }
                } catch (error) {
                    console.warn('Optimisation serveur non disponible:', error);
                    // Fallback à l'optimisation locale
                }
            }
            
            // Si pas d'optimisation serveur, utiliser l'algorithme local amélioré
            if (optimizedOrder === exercises) {
                // Essayer d'abord l'alternance par muscle
                const alternated = this.alternateByMuscleGroup(exercises);
                
                // Si l'alternance change vraiment l'ordre, l'utiliser
                const orderChanged = alternated.some((ex, i) => ex.exercise_id !== exercises[i].exercise_id);
                
                if (orderChanged) {
                    optimizedOrder = alternated;
                } else {
                    // Sinon, essayer un tri par type d'exercice (composé d'abord)
                    optimizedOrder = [...exercises].sort((a, b) => {
                        const aCompound = (a.muscle_groups?.length || 0) > 1 ? 1 : 0;
                        const bCompound = (b.muscle_groups?.length || 0) > 1 ? 1 : 0;
                        return bCompound - aCompound;
                    });
                }
            }
            
            console.log('Exercices après optimisation:', optimizedOrder.map(e => e.exercise_name));
            
            // Réorganiser le DOM avec animation
            container.innerHTML = '';
            optimizedOrder.forEach((ex, index) => {
                const html = `
                    <div class="selected-exercise-item animated-entry" 
                        data-exercise-id="${ex.exercise_id}"
                        data-exercise='${JSON.stringify(ex).replace(/'/g, '&apos;')}'>
                        <div class="drag-handle">
                            <i class="fas fa-grip-vertical"></i>
                        </div>
                        <div class="exercise-content">
                            <span class="exercise-number">${index + 1}</span>
                            <div class="exercise-details">
                                <div class="exercise-name">${ex.exercise_name}</div>
                                <div class="exercise-params">
                                    ${ex.sets} × ${ex.reps_min}-${ex.reps_max}
                                </div>
                            </div>
                        </div>
                        <button class="remove-btn" 
                                onclick="planningManager.removeExerciseFromPreview('${ex.exercise_id}')"
                                title="Retirer">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', html);
            });
            
            // Recalculer les métriques
            this.updateSessionMetrics(optimizedOrder);
            
            // Réinitialiser le drag & drop
            this.initializeExerciseDragDrop();
            
            // Feedback
            window.showToast('Ordre optimisé pour une meilleure performance', 'success');
            
        } finally {
            if (btn) {
                setTimeout(() => btn.classList.remove('optimizing'), 600);
            }
        }
    }

    // FALLBACK minimal si applyLocalOptimalOrder n'existe pas
    alternateByMuscleGroup(exercises) {
        if (!exercises || exercises.length < 2) return exercises;
        
        // Grouper par muscle
        const byMuscle = {};
        exercises.forEach(ex => {
            const muscle = ex.muscle_groups?.[0] || 'Autres';
            if (!byMuscle[muscle]) byMuscle[muscle] = [];
            byMuscle[muscle].push(ex);
        });
        
        const muscleGroups = Object.keys(byMuscle);
        console.log('Groupes musculaires trouvés:', muscleGroups);
        
        // Si un seul groupe musculaire, pas d'alternance possible
        if (muscleGroups.length <= 1) {
            console.log('Un seul groupe musculaire, pas d\'alternance');
            return exercises;
        }
        
        // Construire l'ordre alterné
        const optimized = [];
        let hasMore = true;
        let index = 0;
        
        while (hasMore) {
            hasMore = false;
            for (const muscle of muscleGroups) {
                if (byMuscle[muscle][index]) {
                    optimized.push(byMuscle[muscle][index]);
                    hasMore = true;
                }
            }
            index++;
        }
        
        console.log('Ordre original:', exercises.map(e => `${e.exercise_name} (${e.muscle_groups?.[0]})`));
        console.log('Ordre alterné:', optimized.map(e => `${e.exercise_name} (${e.muscle_groups?.[0]})`));
        
        return optimized;
    }

    optimizeLocally() {
        console.log('🔧 Optimisation locale de l\'ordre');
        
        const container = document.getElementById('previewExercisesList');
        const items = Array.from(container.querySelectorAll('.exercise-preview-item'));
        
        if (items.length < 2) return;
        
        // Extraire les données
        const exercises = items.map(item => ({
            element: item,
            data: JSON.parse(item.dataset.exercise)
        }));
        
        // Grouper par muscle principal
        const byMuscle = {};
        exercises.forEach(item => {
            const muscles = item.data.muscle_groups || [];
            const primaryMuscle = muscles[0] || 'autre';
            
            if (!byMuscle[primaryMuscle]) {
                byMuscle[primaryMuscle] = [];
            }
            byMuscle[primaryMuscle].push(item);
        });
        
        // Créer un ordre alterné entre groupes musculaires
        const muscleGroups = Object.keys(byMuscle);
        const optimized = [];
        
        // Distribuer en alternant les groupes
        let maxLength = Math.max(...muscleGroups.map(m => byMuscle[m].length));
        
        for (let i = 0; i < maxLength; i++) {
            muscleGroups.forEach(muscle => {
                if (byMuscle[muscle][i]) {
                    optimized.push(byMuscle[muscle][i]);
                }
            });
        }
        
        // Réorganiser dans le DOM
        optimized.forEach((item, index) => {
            container.appendChild(item.element);
            // Mettre à jour le numéro
            const numberSpan = item.element.querySelector('.exercise-number');
            if (numberSpan) {
                numberSpan.textContent = index + 1;
            }
        });
        
        // Recalculer le score localement
        const newScore = this.calculateLocalScore(optimized.map(item => item.data));
        
        // Animer le changement
        const scoreElement = document.querySelector('.quality-score .stat-value');
        if (scoreElement) {
            const oldScore = parseInt(scoreElement.dataset.score) || 75;
            this.animateScoreChange(scoreElement, oldScore, newScore);
            
            const newColor = window.getScoreColor?.(newScore) ?? '#6b7280';
            scoreElement.style.color = newColor;
            scoreElement.previousElementSibling.style.color = newColor;
        }
        
        window.showToast('Ordre optimisé localement', 'success');
    }

    animateScoreChange(element, fromScore, toScore) {
        const duration = 600;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function
            const easeOutQuad = t => t * (2 - t);
            const easedProgress = easeOutQuad(progress);
            
            const currentScore = Math.round(fromScore + (toScore - fromScore) * easedProgress);
            element.textContent = `${currentScore}%`;
            element.dataset.score = currentScore;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        requestAnimationFrame(animate);
    }

    calculateLocalScore(exercises) {
        // Calcul simple basé sur l'alternance des groupes musculaires
        let score = 75;
        
        // Bonus pour diversité
        const uniqueMuscles = new Set(exercises.flatMap(ex => ex.muscle_groups || []));
        score += Math.min(uniqueMuscles.size * 3, 15);
        
        // Bonus pour non-répétition consécutive du même muscle
        for (let i = 1; i < exercises.length; i++) {
            const prevMuscles = exercises[i-1].muscle_groups || [];
            const currMuscles = exercises[i].muscle_groups || [];
            
            const hasOverlap = prevMuscles.some(m => currMuscles.includes(m));
            if (!hasOverlap) {
                score += 1;
            }
        }
        
        return Math.min(Math.round(score), 95);
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
        const weekEnd = new Date(weekStart.getTime());
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

    // ===== NOUVELLES FONCTIONS À AJOUTER EN FIN DE planning.js =====

    // Animation baguette magique
    showMagicButtonIfNeeded(exerciseCount) {
        const optimizeBtn = document.getElementById('optimizeBtn');
        if (!optimizeBtn) return;
        
        if (exerciseCount >= 2) {
            optimizeBtn.style.display = 'flex';
            setTimeout(() => {
                optimizeBtn.style.opacity = '1';
                optimizeBtn.style.animation = 'pulse-magic 2s infinite';
            }, 50);
        } else {
            optimizeBtn.style.opacity = '0';
            setTimeout(() => optimizeBtn.style.display = 'none', 300);
        }
    }

    // Modal d'ajout d'exercice à séance existante
    async showAddExerciseToSession(sessionId) {
        try {
            console.log('🔍 Ajout exercice à la session:', sessionId);
            
            const session = this.findSessionById(sessionId);
            if (!session) {
                window.showToast('Session introuvable', 'error');
                return;
            }
            
            const exercisesResponse = await window.apiGet(`/api/exercises?user_id=${window.currentUser.id}`);
            
            // Exclure les exercices déjà présents
            const currentExerciseIds = (session.exercise_pool || session.exercises || [])
                .map(ex => ex.exercise_id || ex.id)
                .filter(Boolean);
            
            const availableExercises = exercisesResponse.filter(ex => 
                !currentExerciseIds.includes(ex.id)
            );
            
            if (availableExercises.length === 0) {
                window.showToast('Tous les exercices sont déjà dans cette séance', 'info');
                return;
            }
            
            // Grouper par muscle
            const exercisesByMuscle = {};
            availableExercises.forEach(exercise => {
                const muscle = exercise.muscle_groups?.[0] || exercise.body_part || 'Autres';
                if (!exercisesByMuscle[muscle]) {
                    exercisesByMuscle[muscle] = [];
                }
                exercisesByMuscle[muscle].push(exercise);
            });
            
            const muscleGroupsHtml = Object.entries(exercisesByMuscle).map(([muscle, exercises]) => {
                const color = window.MuscleColors?.getMuscleColor ? 
                    window.MuscleColors.getMuscleColor(muscle) : '#6b7280';
                
                return `
                    <div class="exercise-group">
                        <h5 class="muscle-group-header" style="border-left: 4px solid ${color};">
                            ${muscle.charAt(0).toUpperCase() + muscle.slice(1)} (${exercises.length})
                        </h5>
                        <div class="exercise-grid">
                            ${exercises.map(ex => `
                                <label class="exercise-option">
                                    <input type="radio" name="newExercise" value="${ex.id}" 
                                        data-exercise='${JSON.stringify({
                                            exercise_id: ex.id,
                                            exercise_name: ex.name,
                                            muscle_groups: ex.muscle_groups || [muscle],
                                            sets: 3,
                                            reps_min: 8,
                                            reps_max: 12,
                                            rest_seconds: 90
                                        }).replace(/'/g, '&apos;')}'>
                                    <div class="exercise-option-card">
                                        <div class="exercise-name">${ex.name}</div>
                                        <div class="exercise-details">3×8-12</div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('');
            
            const modalContent = `
                <div class="add-exercise-modal">
                    <div class="modal-header-section">
                        <h3><i class="fas fa-plus"></i> Ajouter un exercice</h3>
                        <p>Sélectionnez un exercice à ajouter à cette séance</p>
                    </div>
                    
                    <div class="modal-body-section">
                        <div class="exercise-groups-container" style="max-height: 400px; overflow-y: auto;">
                            ${muscleGroupsHtml}
                        </div>
                    </div>
                    
                    <div class="modal-actions">
                        <button class="btn btn-primary" id="addExerciseBtn" disabled 
                                onclick="planningManager.addExerciseToSession('${sessionId}')">
                            <i class="fas fa-plus"></i> Ajouter
                        </button>
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            <i class="fas fa-times"></i> Annuler
                        </button>
                    </div>
                </div>
            `;
            
            window.showModal('', modalContent);
            
            // Activer le bouton quand un exercice est sélectionné
            setTimeout(() => {
                const radios = document.querySelectorAll('input[name="newExercise"]');
                const addBtn = document.getElementById('addExerciseBtn');
                
                radios.forEach(radio => {
                    radio.addEventListener('change', () => {
                        addBtn.disabled = !document.querySelector('input[name="newExercise"]:checked');
                    });
                });
            }, 100);
            
        } catch (error) {
            console.error('❌ Erreur ouverture modal ajout exercice:', error);
            window.showToast('Erreur lors de l\'ouverture', 'error');
        }
    }

    // Ajouter effectivement l'exercice
    async addExerciseToSession(sessionId) {
        try {
            const selectedRadio = document.querySelector('input[name="newExercise"]:checked');
            if (!selectedRadio) {
                window.showToast('Sélectionnez un exercice', 'warning');
                return;
            }
            
            const newExercise = JSON.parse(selectedRadio.dataset.exercise.replace(/&apos;/g, "'"));
            const session = this.findSessionById(sessionId);
            
            if (!session) {
                window.showToast('Session introuvable', 'error');
                return;
            }
            
            // Ajouter l'exercice
            if (session.exercise_pool) {
                session.exercise_pool.push(newExercise);
            } else if (session.exercises) {
                session.exercises.push(newExercise);
            } else {
                session.exercise_pool = [newExercise];
            }
            
            // Sauvegarder
            const exercises = session.exercise_pool || session.exercises;
            await this.saveSessionChanges(sessionId, { exercises });
            
            window.closeModal();
            window.showToast(`${newExercise.exercise_name} ajouté à la séance`, 'success');
            
            // Rafraîchir le modal d'édition s'il était ouvert
            const editModal = document.querySelector('.edit-session-modal-v2');
            if (editModal) {
                await this.showSessionEditModal(session);
            }
            
        } catch (error) {
            console.error('❌ Erreur ajout exercice:', error);
            window.showToast('Erreur lors de l\'ajout', 'error');
        }
    }

    async ensureActiveProgram() {
    if (this.activeProgram && this.activeProgram.id) {
        return this.activeProgram;
    }
    
    console.log('🔄 Rechargement du programme actif...');
    try {
        await this.loadActiveProgram();
        if (!this.activeProgram) {
            throw new Error('Aucun programme actif trouvé');
        }
        return this.activeProgram;
    } catch (error) {
        console.error('❌ Impossible de charger le programme actif:', error);
        throw new Error('Aucun programme actif disponible');
    }
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
        console.log('🔍 Recherche prochaines séances...');
        
        // Récupérer le programme actif
        const activeProgram = await window.apiGet(
            `/api/users/${window.currentUser.id}/programs/active`
        );
        
        if (!activeProgram || !activeProgram.weekly_structure) {
            console.warn('⚠️ Pas de programme ou structure invalide');
            showNoProgramSessionsModal();
            return;
        }
        
        // Valider weekly_structure
        if (typeof activeProgram.weekly_structure !== 'object') {
            console.error('❌ Format weekly_structure invalide:', activeProgram.weekly_structure);
            showNoProgramSessionsModal();
            return;
        }
        
        // Extraire les 3 prochaines séances
        const today = new Date();
        const upcomingSessions = [];
        
        console.log('📅 Recherche sur 7 prochains jours...');
        
        // Parcourir les 7 prochains jours
        for (let i = 0; i < 7 && upcomingSessions.length < 3; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(checkDate.getDate() + i);
            const dayName = checkDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            
            const daySessions = activeProgram.weekly_structure[dayName] || [];
            
            daySessions.forEach((session, index) => {
                if (upcomingSessions.length < 3) {
                    // Validation session
                    if (!session.exercises || session.exercises.length === 0) {
                        console.warn(`⚠️ Session ${dayName}[${index}] sans exercices, ignorée`);
                        return;
                    }
                    
                    upcomingSessions.push({
                        id: `${activeProgram.id}_${dayName}_${index}`,
                        date: checkDate.toISOString().split('T')[0],
                        dayName: checkDate.toLocaleDateString('fr-FR', { 
                            weekday: 'long', 
                            day: 'numeric', 
                            month: 'long' 
                        }),
                        exercises: session.exercises,
                        estimated_duration: session.estimated_duration || 45,
                        predicted_quality_score: session.quality_score || 75,
                        is_today: i === 0
                    });
                }
            });
        }
        
        console.log(`✅ ${upcomingSessions.length} séances trouvées`);
        
        if (upcomingSessions.length === 0) {
            showNoProgramSessionsModal();
            return;
        }
        
        // Générer le HTML des sessions
        const sessionsHtml = upcomingSessions.map((session, index) => `
            <button class="upcoming-session-btn ${session.is_today ? 'today' : ''}" 
                    onclick="window.startSessionFromProgram('${session.id}')">
                <div class="session-info">
                    <h4>${session.dayName}</h4>
                    <p>${session.exercises?.length || 0} exercices • ${session.estimated_duration}min</p>
                    <div class="session-score">
                        <div class="score-gauge-mini" 
                             style="background: ${getScoreColor(session.predicted_quality_score)}">
                            ${session.predicted_quality_score}
                        </div>
                    </div>
                </div>
                <i class="fas fa-play"></i>
                ${session.is_today ? '<span class="today-badge">Aujourd\'hui</span>' : ''}
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
        console.error('❌ Erreur récupération prochaines séances:', error);
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
       
        // Récupérer la session depuis le planning manager (format v2.0)
        const session = window.planningManager.findSessionById(sessionId);
        
        if (!session) {
            window.showToast('Session introuvable', 'error');
            return;
        }
        
        // Convertir exercise_pool vers le format attendu par startProgramWorkout
        const exercises = session.exercise_pool || [];
        
        if (exercises.length === 0) {
            window.showToast('Cette séance n\'a pas d\'exercices', 'warning');
            return;
        }
       
        // Adapter pour startProgramWorkout existant
        const workoutData = {
            selected_exercises: exercises, // exercise_pool converti
            is_from_program: true,
            program_id: window.currentUser.current_program_id || session.program_id,
            session_id: sessionId,
            session_type: session.session_type || 'planned'
        };
       
        window.currentWorkoutSession = {
            program: {
                id: window.currentUser.current_program_id || session.program_id,
                exercises: exercises, // exercise_pool pour compatibilité
                session_duration_minutes: session.estimated_duration || 45
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

// Exposer la fonction globalement pour app.js
window.showUpcomingSessionsModal = showUpcomingSessionsModal;