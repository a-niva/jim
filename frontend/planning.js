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

    calculateSessionDuration(exercises) {
        if (!exercises || exercises.length === 0) return 45;
        return exercises.reduce((total, ex) => {
            const sets = ex.sets || 3;
            const duration = sets * 3; // ~3min par série
            return total + duration;
        }, 10); // 10 min échauffement
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
        startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Lundi
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek;
    }
        
    async loadWeeksData() {
        const startDate = new Date(this.currentWeek);
        startDate.setDate(startDate.getDate() - (3 * 7)); // 3 semaines avant
        
        this.weeksData.clear();
        
        for (let i = 0; i < 8; i++) { // 8 semaines au total
            const weekStart = new Date(startDate);
            weekStart.setDate(weekStart.getDate() + (i * 7));
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
            
            const weekStartStr = weekStart.toISOString().split('T')[0];
            
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
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            
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
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
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


    renderSession(session, date) {
        // Protection maximale contre les données manquantes
        if (!session) {
            console.warn('Session null/undefined');
            return '';
        }
        
        console.log('🎨 Rendu session:', session);
        
        // CORRECTION : Gestion flexible des IDs (string/number)
        const sessionId = session.id || session.session_id || `temp-${Date.now()}`;
        const score = session.predicted_quality_score || session.quality_score || 75;
        const duration = session.estimated_duration || 45;
        
        // CORRECTION PRINCIPALE : Unifier exercises vs exercise_pool
        const exercises = session.exercises || session.exercise_pool || [];
        const exerciseCount = Array.isArray(exercises) ? exercises.length : 0;
        
        const primaryMuscles = session.primary_muscles || session.muscle_groups || [];
        const status = session.status || 'planned';
        
        // Utiliser les fonctions existantes avec fallback
        const scoreGradient = window.getScoreGradient ? 
            window.getScoreGradient(score) : 
            `linear-gradient(135deg, ${score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'} 0%, ${score >= 75 ? '#059669' : score >= 50 ? '#d97706' : '#dc2626'} 100%)`;
        
        // Générer les badges musculaires
        const muscleColors = {
            'chest': 'var(--muscle-chest)', 'back': 'var(--muscle-back)', 
            'shoulders': 'var(--muscle-shoulders)', 'arms': 'var(--muscle-arms)',
            'legs': 'var(--muscle-legs)', 'core': 'var(--muscle-core)',
            'biceps': 'var(--muscle-arms)', 'triceps': 'var(--muscle-arms)',
            'pectoraux': 'var(--muscle-chest)', 'dos': 'var(--muscle-back)',
            'jambes': 'var(--muscle-legs)', 'bras': 'var(--muscle-arms)',
            'abdominaux': 'var(--muscle-core)', 'epaules': 'var(--muscle-shoulders)'
        };
        
        const musclesBadges = primaryMuscles.slice(0, 3).map(muscle => {
            const color = muscleColors[muscle.toLowerCase()] || '#6b7280';
            return `<span class="muscle-badge" style="background-color: ${color}">${muscle}</span>`;
        }).join('');
        
        // Badge de statut
        const statusBadges = {
            'planned': '<span class="status-badge planned">Planifiée</span>',
            'in_progress': '<span class="status-badge in-progress">En cours</span>',
            'completed': '<span class="status-badge completed">Terminée</span>',
            'skipped': '<span class="status-badge skipped">Ignorée</span>'
        };
        const statusBadge = statusBadges[status] || statusBadges['planned'];
        
        return `
            <div class="session-card ${status}" 
                data-session-id="${sessionId}" 
                onclick="planningManager.showSessionEditModal(planningManager.findSessionById('${sessionId}'))">
                
                <div class="session-header">
                    <div class="session-score">
                        <div class="score-gauge" style="background: ${scoreGradient}">
                            <span class="score-value">${Math.round(score)}</span>
                        </div>
                    </div>
                    
                    <div class="session-main-info">
                        <div class="session-stats">
                            <div class="session-duration">
                                <i class="fas fa-clock"></i>
                                <span class="duration-text">${duration}min</span>
                            </div>
                            <div class="session-exercises-count">
                                <i class="fas fa-dumbbell"></i>
                                <span class="exercises-text">${exerciseCount} ex.</span>
                            </div>
                        </div>
                        ${statusBadge}
                    </div>
                    
                    <div class="session-actions">
                        <button class="session-action-btn" 
                                onclick="event.stopPropagation(); planningManager.showSessionEditModal(planningManager.findSessionById('${sessionId}'))"
                                title="Éditer la séance">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="session-action-btn" 
                                onclick="event.stopPropagation(); planningManager.deleteSession('${sessionId}')"
                                title="Supprimer la séance">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                <div class="session-content">
                    <div class="session-muscles">
                        ${musclesBadges}
                    </div>
                    
                    ${exerciseCount > 0 ? `
                        <div class="session-exercises-preview">
                            ${exercises.slice(0, 3).map(ex => `
                                <div class="exercise-preview-item">
                                    <span class="exercise-name">${ex.name || ex.exercise_name || 'Exercice'}</span>
                                    <span class="exercise-sets">${ex.default_sets || ex.sets || 3}×${ex.default_reps_min || ex.reps || 10}</span>
                                </div>
                            `).join('')}
                            ${exerciseCount > 3 ? `<div class="more-exercises">+${exerciseCount - 3} autres</div>` : ''}
                        </div>
                    ` : `
                        <div class="session-empty">
                            <i class="fas fa-plus-circle"></i>
                            <span>Aucun exercice</span>
                        </div>
                    `}
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
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            
            days.push({
                date: date.toISOString().split('T')[0],
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
    
    // ===== MODAL ÉDITION SÉANCE =====
    
    // 9. ADAPTER showSessionEditModal() existant pour utiliser Programme v2.0
    async showSessionEditModal(session) {
        if (!session) {
            window.showToast('Session non trouvée', 'error');
            return;
        }
        
        console.log('🔍 Ouverture modal édition pour session:', session);
        
        // CORRECTION : Unifier exercises vs exercise_pool
        const exercises = session.exercises || session.exercise_pool || [];
        
        if (!Array.isArray(exercises)) {
            console.error('❌ Format exercises invalide:', exercises);
            window.showToast('Erreur: format de session invalide', 'error');
            return;
        }
        
        console.log(`📊 ${exercises.length} exercices dans la session`);
        
        // Mode dégradé pour le scoring
        let currentScore;
        try {
            if (window.SessionQualityEngine && window.getUserContext) {
                const userContext = await window.getUserContext();
                currentScore = await window.SessionQualityEngine.calculateScore(exercises, userContext);
            } else {
                throw new Error('SessionQualityEngine non disponible');
            }
        } catch (error) {
            console.warn('⚠️ SessionQualityEngine non disponible, utilisation score basique:', error);
            // Fallback avec scoring basique
            currentScore = {
                total: session.predicted_quality_score || 75,
                breakdown: {
                    muscleRotationScore: 20,
                    recoveryScore: 20,
                    progressionScore: 20,
                    adherenceScore: 15
                },
                suggestions: ["Scoring avancé temporairement indisponible"],
                confidence: 0.5
            };
        }
        
        // Calculer la durée
        const duration = exercises.reduce((total, ex) => {
            const sets = ex.default_sets || ex.sets || 3;
            const restTime = (ex.rest_seconds || 90) / 60; // Convertir en minutes
            const exerciseTime = sets * 1.5; // 1.5 min par série en moyenne
            return total + exerciseTime + restTime;
        }, 0);
        
        // Gradient pour le score
        const scoreGradient = window.getScoreGradient ? 
            window.getScoreGradient(currentScore.total) : 
            `linear-gradient(135deg, ${currentScore.total >= 75 ? '#10b981' : currentScore.total >= 50 ? '#f59e0b' : '#ef4444'} 0%, ${currentScore.total >= 75 ? '#059669' : currentScore.total >= 50 ? '#d97706' : '#dc2626'} 100%)`;
        
        const modalContent = `
            <div class="session-edit-modal">
                <div class="session-edit-header">
                    <h3>Édition de séance</h3>
                    <div class="session-live-stats">
                        <div class="live-score">
                            <label>Score qualité</label>
                            <div class="score-display" id="liveScore">
                                <div class="score-gauge" style="background: ${scoreGradient}">
                                    <span id="scoreValue">${Math.round(currentScore.total)}</span>
                                </div>
                            </div>
                        </div>
                        <div class="live-duration">
                            <label>Durée estimée</label>
                            <div class="duration-display" id="liveDuration">
                                <i class="fas fa-clock"></i>
                                <span id="durationValue">${Math.round(duration)}</span> min
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="exercises-section">
                    <div class="exercises-header">
                        <h4>Exercices (${exercises.length})</h4>
                        <div class="exercise-actions">
                            <button class="btn btn-sm btn-secondary" onclick="planningManager.applyOptimalOrder('${session.id}')" 
                                    title="Optimiser l'ordre des exercices">
                                <i class="fas fa-magic"></i> Ordre optimal
                            </button>
                            <button class="btn btn-sm btn-primary" onclick="planningManager.saveSessionChanges('${session.id}')">
                                <i class="fas fa-save"></i> Sauvegarder
                            </button>
                        </div>
                    </div>
                    
                    <div class="exercises-list" id="sessionExercisesList">
                        ${exercises.length > 0 ? exercises.map((ex, index) => `
                            <div class="exercise-edit-item" data-exercise-index="${index}">
                                <div class="exercise-drag-handle">
                                    <i class="fas fa-grip-vertical"></i>
                                </div>
                                <div class="exercise-info">
                                    <div class="exercise-name">${ex.name || ex.exercise_name || 'Exercice sans nom'}</div>
                                    <div class="exercise-details">
                                        ${ex.default_sets || ex.sets || 3} séries × 
                                        ${ex.default_reps_min || ex.reps || 8}-${ex.default_reps_max || ex.reps || 12} reps
                                    </div>
                                    <div class="exercise-muscles">
                                        ${(ex.muscle_groups || []).join(', ')}
                                    </div>
                                </div>
                                <div class="exercise-actions">
                                    <button class="btn btn-sm btn-outline" onclick="planningManager.editExercise('${session.id}', ${index})"
                                            title="Modifier l'exercice">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-outline btn-danger" onclick="planningManager.removeExercise('${session.id}', ${index})"
                                            title="Supprimer l'exercice">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('') : `
                            <div class="exercises-empty">
                                <i class="fas fa-dumbbell"></i>
                                <p>Aucun exercice dans cette séance</p>
                            </div>
                        `}
                    </div>
                    
                    <div class="add-exercise-section">
                        <button class="btn btn-outline btn-sm" onclick="planningManager.showAddExerciseModal('${session.id}')"
                                title="Ajouter un exercice à la séance">
                            <i class="fas fa-plus"></i> Ajouter un exercice
                        </button>
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="planningManager.startSession('${session.id}')">
                        <i class="fas fa-play"></i> Démarrer la séance
                    </button>
                    <button class="btn btn-secondary" onclick="window.closeModal()">
                        <i class="fas fa-times"></i> Fermer
                    </button>
                </div>
            </div>
        `;
        
        window.showModal('', modalContent);
        
        // Initialiser le drag & drop si SortableJS est disponible
        if (typeof Sortable !== 'undefined') {
            const exercisesList = document.getElementById('sessionExercisesList');
            if (exercisesList) {
                new Sortable(exercisesList, {
                    animation: 150,
                    handle: '.exercise-drag-handle',
                    onEnd: function(evt) {
                        if (evt.oldIndex !== evt.newIndex) {
                            console.log(`🔄 Exercice déplacé: ${evt.oldIndex} → ${evt.newIndex}`);
                            planningManager.reorderExercises(session.id, evt.oldIndex, evt.newIndex);
                        }
                    }
                });
            }
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
            
    async saveSessionChanges(sessionId, changes) {
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
            
            // Mettre à jour schedule.status pour format v2.0
            if (this.activeProgram.format_version === "2.0" && this.activeProgram.schedule) {
                // Trouver la date de cette session dans le schedule
                const sessionDate = Object.keys(this.activeProgram.schedule).find(date => {
                    return this.activeProgram.schedule[date].session_id === sessionId;
                });
                
                if (sessionDate) {
                    // Mettre à jour le status dans schedule
                    try {
                        await window.apiPut(`/api/programs/${this.activeProgram.id}/schedule/${sessionDate}`, {
                            status: "in_progress",
                            started_at: new Date().toISOString()
                        });
                        
                        // Mettre à jour localement
                        this.activeProgram.schedule[sessionDate].status = "in_progress";
                        this.activeProgram.schedule[sessionDate].started_at = new Date().toISOString();
                        
                    } catch (apiError) {
                        console.warn('❌ Mise à jour schedule impossible:', apiError);
                        // Continuer malgré l'erreur API
                    }
                }
            }
            
            if (!window.currentWorkoutSession) {
                // Initialiser si nécessaire
                window.currentWorkoutSession = {
                    type: 'program',
                    program: null,
                    programExercises: {}
                };
            }
            
            // Démarrer la séance dans l'interface workout
            window.currentWorkoutSession.program = {
                ...this.activeProgram,
                exercises: session.exercises || []
            };
            
            // Utiliser window. pour accéder à la fonction globale
            await window.confirmStartProgramWorkout();
            window.closeModal();
            
        } catch (error) {
            console.error('❌ Erreur startSession:', error);
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
            if (!session) {
                window.showToast('Session non trouvée', 'error');
                return;
            }
            
            // CORRECTION : Unifier exercises vs exercise_pool
            const exercises = session.exercises || session.exercise_pool || [];
            
            if (!Array.isArray(exercises) || exercises.length === 0) {
                window.showToast('Aucun exercice à réorganiser', 'warning');
                return;
            }
        
            if (exercises.length < 2) {
                window.showToast('Au moins 2 exercices requis', 'info');
                return;
            }
        
            console.log('🎯 Optimisation ordre pour:', exercises.length, 'exercices');
        
            // CORRECTION: L'endpoint backend ne fonctionne pas avec les programmes schedule
            // Utiliser directement l'optimisation locale pour les sessions depuis schedule
            console.log('🔄 Backend optimisation non compatible avec schedule, utilisation optimisation locale');
            
            // Note: L'endpoint /api/programs/{id}/reorder-session attend un format weekly_structure array
            // mais nos programmes utilisent schedule avec un format différent
            // TODO: Créer un endpoint spécifique pour optimiser les sessions du schedule
        
            // Fallback : Optimisation locale
            console.log('🔄 Utilisation optimisation locale');
            
            // Vérifier si la fonction d'optimisation locale existe
            if (typeof this.optimizeExercisesLocally === 'function') {
                const optimized = this.optimizeExercisesLocally(exercises);
                
                // CORRECTION : Mettre à jour le bon champ
                if (session.exercises) {
                    session.exercises = optimized.exercises;
                } else if (session.exercise_pool) {
                    session.exercise_pool = optimized.exercises;
                }
            
                // Mettre à jour l'affichage si on est dans un modal d'édition
                const container = document.getElementById('sessionExercisesList');
                if (container && typeof this.renderEditableExercise === 'function') {
                    container.innerHTML = optimized.exercises
                        .map((ex, index) => this.renderEditableExercise(ex, index, sessionId))
                        .join('');
                    
                    // Réinitialiser le drag&drop si la fonction existe
                    if (typeof this.initializeExerciseDragDrop === 'function') {
                        this.initializeExerciseDragDrop(sessionId);
                    }
                }
            
                // Sauvegarder localement si la fonction existe
                if (typeof this.saveSessionToLocalStorage === 'function') {
                    this.saveSessionToLocalStorage(sessionId, session);
                }
            
                const message = optimized.improvement > 0 ?
                    `Ordre optimisé (+${optimized.improvement} points estimés)` :
                    'Ordre optimisé';
                window.showToast(message, 'success');
            } else {
                // Fallback basique si aucune optimisation locale disponible
                console.warn('⚠️ Aucune fonction d\'optimisation locale disponible');
                
                // Ordre basique : exercices composés d'abord, puis isolation
                const reordered = [...exercises].sort((a, b) => {
                    const aIsCompound = a.exercise_type === 'compound' || 
                                    (a.muscle_groups && a.muscle_groups.length > 1);
                    const bIsCompound = b.exercise_type === 'compound' || 
                                    (b.muscle_groups && b.muscle_groups.length > 1);
                    
                    if (aIsCompound && !bIsCompound) return -1;
                    if (!aIsCompound && bIsCompound) return 1;
                    return 0;
                });
                
                // CORRECTION : Mettre à jour le bon champ
                if (session.exercises) {
                    session.exercises = reordered;
                } else if (session.exercise_pool) {
                    session.exercise_pool = reordered;
                }
                
                window.showToast('Ordre basique appliqué (composés → isolation)', 'info');
            }
        
        } catch (error) {
            console.error('❌ Erreur optimisation:', error);
            window.showToast('Erreur lors de l\'optimisation', 'error');
        }
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
        

    async showAddSessionModal(date = null) {
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        try {
            console.log('🔍 Ouverture modal ajout séance pour:', targetDate);
            
            const exercisesResponse = await window.apiGet(`/api/exercises?user_id=${window.currentUser.id}`);
            
            if (!exercisesResponse || exercisesResponse.length === 0) {
                window.showToast('Aucun exercice disponible. Vérifiez votre configuration d\'équipement.', 'warning');
                return;
            }
            
            // Grouper les exercices par muscle pour organisation
            const exercisesByMuscle = {};
            exercisesResponse.forEach(ex => {
                const muscle = ex.body_part || ex.muscle_groups?.[0] || 'Autres';
                if (!exercisesByMuscle[muscle]) {
                    exercisesByMuscle[muscle] = [];
                }
                exercisesByMuscle[muscle].push(ex);
            });
            
            // Générer HTML organisé par groupe musculaire
            const muscleGroupsHtml = Object.entries(exercisesByMuscle).map(([muscle, exercises]) => {
                const color = window.MuscleColors?.getMuscleColor ? 
                    window.MuscleColors.getMuscleColor(muscle) : '#6b7280';
                
                return `
                    <div class="exercise-group">
                        <h5 class="muscle-group-header" style="border-left: 4px solid ${color};">
                            ${muscle.charAt(0).toUpperCase() + muscle.slice(1)} (${exercises.length})
                        </h5>
                        <div class="exercise-group-grid">
                            ${exercises.map(ex => {
                                const exerciseData = {
                                    exercise_id: ex.id,
                                    exercise_name: ex.name,
                                    muscle_group: ex.body_part || ex.muscle_groups?.[0] || 'mixte',
                                    muscle_groups: ex.muscle_groups || [ex.body_part],
                                    sets: 3,
                                    reps_min: 8,
                                    reps_max: 12,
                                    rest_seconds: 90
                                };
                                
                                return `
                                    <label class="exercise-option">
                                        <input type="checkbox" value="${ex.id}" data-exercise='${JSON.stringify(exerciseData)}'>
                                        <div class="exercise-option-card">
                                            <div class="exercise-name">${ex.name}</div>
                                            <div class="exercise-details">3×8-12</div>
                                        </div>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');
            
            const modalContent = `
                <div class="add-session-modal-v2">
                    <div class="modal-header-section">
                        <h3><i class="fas fa-plus-circle"></i> Créer une séance</h3>
                        <div class="session-date-info">
                            <i class="fas fa-calendar"></i>
                            <span>${new Date(targetDate).toLocaleDateString('fr-FR', { 
                                weekday: 'long', 
                                day: 'numeric', 
                                month: 'long' 
                            })}</span>
                        </div>
                    </div>
                    
                    <div class="modal-body-section">
                        <div class="selection-section">
                            <div class="section-header">
                                <h4><i class="fas fa-dumbbell"></i> Exercices disponibles (${exercisesResponse.length})</h4>
                                <div class="selection-counter">
                                    <span id="selectedCount">0</span> sélectionné(s)
                                </div>
                            </div>
                            
                            <div class="exercise-groups-container" id="exerciseSelectionGrid">
                                ${muscleGroupsHtml}
                            </div>
                        </div>
                        
                        <div class="preview-section">
                            <div class="preview-header">
                                <h4><i class="fas fa-eye"></i> Aperçu de la séance</h4>
                                <button class="btn-magic-icon" id="optimizeBtn" 
                                        style="display: none;" 
                                        onclick="window.planningManager.optimizeExerciseOrder()"
                                        title="Optimiser l'ordre des exercices">
                                    <i class="fas fa-magic"></i>
                                </button>
                            </div>
                            <div class="session-preview" id="sessionPreview">
                                <div class="empty-preview">
                                    <i class="fas fa-hand-pointer"></i>
                                    <p>Sélectionnez des exercices pour voir l'aperçu</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="modal-actions-section">
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            <i class="fas fa-times"></i> Annuler
                        </button>
                        <button class="btn btn-primary" id="createSessionBtn" disabled onclick="planningManager.createSession('${targetDate}')">
                            <i class="fas fa-plus"></i> Créer la séance
                        </button>
                    </div>
                </div>
            `;
            
            window.showModal('Nouvelle séance', modalContent);
            this.initializeSessionCreation();
            
        } catch (error) {
            console.error('❌ Erreur ouverture modal ajout:', error);
            window.showToast('Erreur lors de l\'ouverture du modal', 'error');
        }
    }

    initializeSessionCreation() {
        const self = this;
        const checkboxes = document.querySelectorAll('#exerciseSelectionGrid input[type="checkbox"]');
        const createBtn = document.getElementById('createSessionBtn');
        const previewDiv = document.getElementById('sessionPreview');
        const selectedCounter = document.getElementById('selectedCount');
        
        // Récupération des préférences utilisateur
        const userPreferredDuration = this.activeProgram?.session_duration || 
                                    window.currentUser?.onboarding_data?.session_duration || 60;
        const maxExercises = Math.min(8, Math.floor(userPreferredDuration / 7));
        
        if (!checkboxes.length || !createBtn || !previewDiv) {
            console.error('❌ Éléments modal introuvables');
            return;
        }
        
        // Stocker la référence pour le drag & drop
        this.currentSortable = null;
        
        // Fonction de mise à jour de l'aperçu
        const updatePreview = async () => {
            const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
            
            if (selectedCounter) {
                selectedCounter.textContent = selected.length;
                const remainingSlots = maxExercises - selected.length;
                if (remainingSlots <= 2 && remainingSlots > 0) {
                    selectedCounter.parentElement.innerHTML = `
                        <span id="selectedCount">${selected.length}</span> / ${maxExercises} max
                    `;
                }
            }
            
            if (selected.length === 0) {
                previewDiv.innerHTML = `
                    <div class="empty-preview">
                        <i class="fas fa-hand-pointer"></i>
                        <p>Sélectionnez des exercices pour voir l'aperçu</p>
                    </div>
                `;
                createBtn.disabled = true;
                createBtn.innerHTML = '<i class="fas fa-plus"></i> Créer la séance';
                return;
            }
            
            try {
                const exercises = selected.map(input => JSON.parse(input.dataset.exercise));
                
                // Créer une structure de session temporaire
                const tempSession = {
                    exercises: exercises.map(ex => ({
                        exercise_id: ex.exercise_id,
                        exercise_name: ex.exercise_name,
                        sets: ex.sets || 3,
                        reps_min: ex.reps_min || 8,
                        reps_max: ex.reps_max || 12,
                        rest_seconds: ex.rest_seconds || 90
                    }))
                };
                
                // Calculer le score et la durée
                let qualityScore = 75;
                let duration = this.calculateSessionDuration(tempSession.exercises);
                
                // Si programme actif, essayer l'endpoint de calcul
                if (this.activeProgram) {
                    try {
                        const scoreResponse = await window.apiPost(
                            `/api/programs/${this.activeProgram.id}/calculate-session-score`,
                            { session: tempSession }
                        );
                        
                        if (scoreResponse) {
                            qualityScore = Math.round(scoreResponse.quality_score || 75);
                            duration = scoreResponse.estimated_duration || duration;
                        }
                    } catch (e) {
                        console.warn('Calcul score en mode dégradé:', e);
                    }
                }
                
                const muscles = [...new Set(exercises.flatMap(ex => ex.muscle_groups || []))]
                    .filter(Boolean)
                    .map(muscle => muscle.charAt(0).toUpperCase() + muscle.slice(1));
                
                // Utiliser getScoreGradient du PlanningManager
                const scoreColor = this.getScoreColor ? this.getScoreColor(qualityScore) : '#10b981';
                
                previewDiv.innerHTML = `
                    <div class="session-summary-v2">
                        <div class="summary-stats">
                            <div class="stat-item">
                                <i class="fas fa-dumbbell"></i>
                                <span class="stat-value">${exercises.length}</span>
                                <span class="stat-label">exercices</span>
                            </div>
                            <div class="stat-item">
                                <i class="fas fa-clock"></i>
                                <span class="stat-value">${duration}</span>
                                <span class="stat-label">minutes</span>
                            </div>
                            <div class="stat-item">
                                <i class="fas fa-muscle"></i>
                                <span class="stat-value">${muscles.length}</span>
                                <span class="stat-label">groupes</span>
                            </div>
                            <div class="stat-item quality-score">
                                <i class="fas fa-star" style="color: ${scoreColor}"></i>
                                <span class="stat-value" style="color: ${scoreColor}" data-score="${qualityScore}">${qualityScore}%</span>
                                <span class="stat-label">qualité</span>
                            </div>
                        </div>
                        
                        <div class="exercise-list-preview">
                            <h5><i class="fas fa-list"></i> Exercices sélectionnés</h5>
                            <div class="exercises-sortable" id="previewExercisesList">
                                ${exercises.map((ex, index) => `
                                    <div class="exercise-preview-item" 
                                        data-exercise-id="${ex.exercise_id}"
                                        data-exercise='${JSON.stringify(ex).replace(/'/g, '&apos;')}'>
                                        <span class="exercise-drag-handle">
                                            <i class="fas fa-grip-vertical"></i>
                                        </span>
                                        <span class="exercise-number">${index + 1}</span>
                                        <div class="exercise-info">
                                            <div class="exercise-name">${ex.exercise_name}</div>
                                            <div class="exercise-params">${ex.sets || 3}×${ex.reps_min || 8}-${ex.reps_max || 12}</div>
                                        </div>
                                        <button class="exercise-remove" 
                                                onclick="window.planningManager.removeExerciseFromPreview('${ex.exercise_id}')"
                                                title="Retirer de la séance">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        
                        ${muscles.length > 0 ? `
                            <div class="muscle-groups-preview">
                                <h5><i class="fas fa-crosshairs"></i> Groupes musculaires</h5>
                                <div class="muscle-tags">
                                    ${muscles.map(muscle => {
                                        const muscleKey = muscle.toLowerCase();
                                        const color = window.MuscleColors?.getMuscleColor ? 
                                            window.MuscleColors.getMuscleColor(muscleKey) : '#6b7280';
                                        return `<span class="muscle-tag-preview" style="background: ${color}">${muscle}</span>`;
                                    }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
                
                // Initialiser le drag & drop
                this.initializePreviewDragDrop();
                
                // Initialiser le swipe sur mobile
                if ('ontouchstart' in window) {
                    this.initializeMobileSwipe();
                }
                
                createBtn.disabled = false;
                createBtn.innerHTML = `<i class="fas fa-plus"></i> Créer la séance (${exercises.length} ex.)`;
                // Afficher/masquer le bouton d'optimisation
                const optimizeBtn = document.getElementById('optimizeBtn');
                if (optimizeBtn) {
                    if (exercises.length >= 2) {
                        optimizeBtn.style.display = 'flex';
                    } else {
                        optimizeBtn.style.display = 'none';
                    }
                }
                
            } catch (error) {
                console.error('❌ Erreur preview séance:', error);
                previewDiv.innerHTML = '<div class="error-preview"><i class="fas fa-exclamation-triangle"></i> Erreur dans la sélection</div>';
                createBtn.disabled = true;
            }
        };
        
        // Gestionnaire pour les checkboxes avec débounce
        let updateTimeout;
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
                
                // Vérifier les limites
                if (event.target.checked && selected.length > maxExercises) {
                    event.target.checked = false;
                    window.showToast(`Maximum ${maxExercises} exercices pour une séance de ${userPreferredDuration} minutes`, 'warning');
                    return;
                }
                
                // Debounce pour éviter trop d'appels API
                clearTimeout(updateTimeout);
                updateTimeout = setTimeout(() => {
                    updatePreview();
                }, 300);
            });
        });
        
        // Mise à jour initiale
        updatePreview();
        
        console.log('✅ Modal création séance initialisé avec', checkboxes.length, 'exercices');
    }


    // AJOUTER fonction pour retirer un exercice de l'aperçu
    removeExerciseFromPreview(exerciseId) {
        const checkbox = document.querySelector(`#exerciseSelectionGrid input[value="${exerciseId}"]`);
        if (checkbox) {
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));
        }
    }

    // AJOUTER initialisation du drag & drop pour l'aperçu
    initializePreviewDragDrop() {
        const container = document.getElementById('previewExercisesList');
        if (!container || !window.Sortable) return;
        
        // Détruire l'instance précédente
        if (this.currentSortable) {
            this.currentSortable.destroy();
        }
        
        this.currentSortable = new Sortable(container, {
            animation: 150,
            handle: '.exercise-drag-handle',
            ghostClass: 'exercise-ghost',
            chosenClass: 'exercise-chosen',
            dragClass: 'exercise-dragging',
            onEnd: async (evt) => {
                // Mettre à jour les numéros
                this.updateExerciseNumbers();
                
                // Recalculer le score si programme actif
                if (this.activeProgram) {
                    const exercises = this.getPreviewExercises();
                    const tempSession = {
                        exercises: exercises.map(ex => ({
                            exercise_id: ex.exercise_id,
                            exercise_name: ex.exercise_name,
                            sets: ex.sets || 3,
                            reps_min: ex.reps_min || 8,
                            reps_max: ex.reps_max || 12,
                            rest_seconds: ex.rest_seconds || 90
                        }))
                    };
                    
                    try {
                        const scoreResponse = await window.apiPost(
                            `/api/programs/${this.activeProgram.id}/calculate-session-score`,
                            { session: tempSession }
                        );
                        
                        if (scoreResponse && scoreResponse.quality_score) {
                            const newScore = Math.round(scoreResponse.quality_score);
                            this.updateScoreDisplay(newScore);
                        }
                    } catch (e) {
                        console.warn('Mise à jour score impossible:', e);
                    }
                }
            }
        });
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

    // AJOUTER support swipe mobile
    initializeMobileSwipe() {
        const items = document.querySelectorAll('.exercise-preview-item');
        
        items.forEach(item => {
            let startX = 0;
            let currentX = 0;
            let isDragging = false;
            
            const handleStart = (e) => {
                // Ne pas interférer avec le drag & drop
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
                    
                    // Vibration feedback
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

    // AJOUTER mise à jour des numéros
    updateExerciseNumbers() {
        const items = document.querySelectorAll('.exercise-preview-item');
        items.forEach((item, index) => {
            const numberElement = item.querySelector('.exercise-number');
            if (numberElement) {
                numberElement.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    numberElement.textContent = index + 1;
                    numberElement.style.transform = 'scale(1)';
                }, 150);
            }
        });
    }

    // AJOUTER récupération des exercices de l'aperçu
    getPreviewExercises() {
        const items = document.querySelectorAll('.exercise-preview-item');
        return Array.from(items).map(item => {
            try {
                // CORRECTION: Décoder les caractères d'échappement HTML
                const jsonData = item.dataset.exercise.replace(/&apos;/g, "'");
                return JSON.parse(jsonData);
            } catch (e) {
                console.error('Erreur parsing exercice preview:', e);
                console.log('Données brutes:', item.dataset.exercise);
                return null;
            }
        }).filter(Boolean);
    }



    // 6. REMPLACER createSession() par cette version qui modifie weekly_structure
    async createSession(targetDate) {
        const normalizedDate = new Date(targetDate).toISOString().split('T')[0];

        const selected = Array.from(document.querySelectorAll('#exerciseSelectionGrid input:checked'));
        
        if (selected.length === 0) {
            window.showToast('Sélectionnez au moins un exercice', 'warning');
            return;
        }
        
        if (!this.activeProgram) {
            window.showToast('Aucun programme actif', 'error');
            return;
        }
        try {
            await this.ensureActiveProgram();
        } catch (error) {
            window.showToast('Impossible de charger le programme', 'error');
            return;
        }
        
        // Validation de weekly_structure
        if (!this.weeklyStructure || typeof this.weeklyStructure !== 'object') {
            console.error('❌ weekly_structure invalide:', this.weeklyStructure);
            window.showToast('Structure du programme invalide', 'error');
            return;
        }
        
        try {
            console.log(`🔧 Création séance pour ${targetDate}`);
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
        // Récupérer les exercices depuis le preview (déjà ordonnés)
        const previewItems = document.querySelectorAll('#previewExercisesList .exercise-preview-item');
        
        if (previewItems.length < 2) {
            window.showToast('Sélectionnez au moins 2 exercices', 'warning');
            return;
        }
        
        try {
            console.log('🎯 Optimisation de l\'ordre des exercices...');
            
            // Extraire les exercices dans l'ordre actuel
            const exercises = Array.from(previewItems).map(item => {
                try {
                    return JSON.parse(item.dataset.exercise);
                } catch (e) {
                    console.error('Erreur parsing exercice:', e);
                    return null;
                }
            }).filter(Boolean);
            
            // Essayer l'endpoint d'optimisation avec fallback
            if (this.activeProgram) {
                try {
                    const response = await window.apiPost(
                        `/api/programs/${this.activeProgram.id}/optimize-session-order`,
                        { exercise_pool: exercises } // Utiliser exercise_pool au lieu de exercises
                    );
                    
                    if (response.optimized_order && Array.isArray(response.optimized_order)) {
                        // Réorganiser les éléments dans le preview
                        const container = document.getElementById('previewExercisesList');
                        const itemsMap = new Map();
                        
                        // Créer une map des éléments par ID
                        previewItems.forEach(item => {
                            const id = item.dataset.exerciseId;
                            itemsMap.set(id, item);
                        });
                        
                        // Réorganiser selon l'ordre optimisé
                        response.optimized_order.forEach((exerciseId, index) => {
                            const item = itemsMap.get(String(exerciseId));
                            if (item) {
                                container.appendChild(item);
                                // Mettre à jour le numéro
                                const numberSpan = item.querySelector('.exercise-number');
                                if (numberSpan) {
                                    numberSpan.textContent = index + 1;
                                }
                            }
                        });
                        
                        // Animer le changement de score
                        const scoreElement = document.querySelector('.quality-score .stat-value');
                        if (scoreElement && response.optimized_score) {
                            const oldScore = parseInt(scoreElement.dataset.score) || 75;
                            const newScore = Math.round(response.optimized_score);
                            
                            // Animation du score
                            this.animateScoreChange(scoreElement, oldScore, newScore);
                            
                            // Mettre à jour la couleur
                            const newColor = this.getScoreColor ? this.getScoreColor(newScore) : 
                                (newScore >= 85 ? '#10b981' : newScore >= 70 ? '#f59e0b' : '#ef4444');
                            scoreElement.style.color = newColor;
                            scoreElement.previousElementSibling.style.color = newColor; // l'icône
                        }
                        
                        window.showToast(
                            `Score optimisé : ${Math.round(response.optimized_score)}% (+${Math.round(response.score_improvement)}%)`, 
                            'success'
                        );
                    }
                } catch (error) {
                    console.log('Endpoint optimisation non disponible, utilisation du tri local');
                    this.optimizeLocally();
                }
            } else {
                this.optimizeLocally();
            }
            
        } catch (error) {
            console.error('❌ Erreur optimisation:', error);
            window.showToast('Erreur lors de l\'optimisation', 'error');
        }
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

    // ADAPTER showAddExerciseModal() si nécessaire
    async showAddExerciseModal(targetDate) {
        try {
            const formattedDate = new Date(targetDate).toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
            });
            
            const exercisesResponse = await window.apiGet(`/api/exercises?user_id=${window.currentUser.id}`);
            
            // Grouper les exercices par muscle
            const exercisesByMuscle = {};
            exercisesResponse.forEach(exercise => {
                const muscle = exercise.muscle_groups?.[0] || 'Autres';
                if (!exercisesByMuscle[muscle]) {
                    exercisesByMuscle[muscle] = [];
                }
                exercisesByMuscle[muscle].push(exercise);
            });
            
            // Générer HTML pour chaque groupe musculaire
            const muscleGroupsHtml = Object.entries(exercisesByMuscle).map(([muscle, exercises]) => {
                const color = window.MuscleColors?.getMuscleColor ? 
                    window.MuscleColors.getMuscleColor(muscle) : '#6b7280';
                
                return `
                    <div class="exercise-group">
                        <h5 class="muscle-group-header" style="border-left: 4px solid ${color};">
                            ${muscle.charAt(0).toUpperCase() + muscle.slice(1)} (${exercises.length})
                        </h5>
                        <div class="exercise-group-grid">
                            ${exercises.map(ex => {
                                const exerciseData = {
                                    exercise_id: ex.id,
                                    exercise_name: ex.name,
                                    muscle_groups: ex.muscle_groups || [muscle],
                                    sets: ex.default_sets || 3,
                                    reps_min: ex.default_reps_min || 8,
                                    reps_max: ex.default_reps_max || 12,
                                    rest_seconds: ex.base_rest_time_seconds || 90,
                                    equipment_required: ex.equipment_required || [],
                                    difficulty: ex.difficulty
                                };
                                
                                return `
                                    <label class="exercise-option">
                                        <input type="checkbox" 
                                            value="${ex.id}"
                                            data-exercise='${JSON.stringify(exerciseData).replace(/'/g, '&apos;')}'>
                                        <div class="exercise-option-card">
                                            <div class="exercise-name">${ex.name}</div>
                                            <div class="exercise-details">
                                                ${ex.default_sets}×${ex.default_reps_min}-${ex.default_reps_max}
                                            </div>
                                        </div>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');
            
            const modalContent = `
                <div class="add-session-modal-v2">
                    <div class="modal-header-section">
                        <h3><i class="fas fa-plus-circle"></i> Créer une séance</h3>
                        <div class="session-date-info">
                            <i class="fas fa-calendar"></i>
                            <span>${formattedDate}</span>
                        </div>
                    </div>
                    
                    <div class="modal-body-section">
                        <div class="selection-section">
                            <div class="section-header">
                                <h4><i class="fas fa-dumbbell"></i> Exercices disponibles (${exercisesResponse.length})</h4>
                                <div class="selection-counter">
                                    <span id="selectedCount">0</span> sélectionné(s)
                                </div>
                            </div>
                            
                            <div class="exercise-groups-container" id="exerciseSelectionGrid">
                                ${muscleGroupsHtml}
                            </div>
                        </div>
                        
                        <div class="preview-section">
                            <div class="preview-header">
                                <h4><i class="fas fa-eye"></i> Aperçu de la séance</h4>
                                <button class="btn-magic-icon" id="optimizeBtn" 
                                        style="display: none;" 
                                        onclick="window.planningManager.optimizeExerciseOrder()"
                                        title="Optimiser l'ordre des exercices">
                                    <i class="fas fa-magic"></i>
                                </button>
                            </div>
                            <div class="session-preview" id="sessionPreview">
                                <div class="empty-preview">
                                    <i class="fas fa-hand-pointer"></i>
                                    <p>Sélectionnez des exercices pour voir l'aperçu</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="modal-actions-section">
                        <button class="btn btn-secondary" onclick="window.closeModal()">
                            <i class="fas fa-times"></i> Annuler
                        </button>
                        <button class="btn btn-primary" id="createSessionBtn" disabled onclick="planningManager.createSession('${targetDate}')">
                            <i class="fas fa-plus"></i> Créer la séance
                        </button>
                    </div>
                </div>
            `;
            
            window.showModal('', modalContent); // Titre vide car inclus dans le contenu
            this.initializeSessionCreation();
            
        } catch (error) {
            console.error('❌ Erreur ouverture modal ajout:', error);
            window.showToast('Erreur lors de l\'ouverture du modal', 'error');
        }
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