// ===== FITNESS COACH - APPLICATION PRINCIPALE =====
// Version complète avec toutes les features restaurées

// ===== ÉTAT GLOBAL =====
let setTimer = null;
let currentUser = null;
let currentWorkout = null;
let currentExercise = null;
let currentSet = 1;
let workoutTimer = null;
let restTimer = null;
let currentStep = 1;
let currentWorkoutSession = {
    workout: null,
    currentExercise: null,
    currentSetNumber: 1,
    exerciseOrder: 1,
    globalSetCount: 0,
    sessionFatigue: 3,
    completedSets: [],
    type: 'free',
    totalRestTime: 0,
    totalSetTime: 0,
    programExercises: {},
    completedExercisesCount: 0,
    totalSets: 3,
    maxSets: 10,
    availableWeights: []
};

// ===== MACHINE D'ÉTAT SÉANCE =====
const WorkoutStates = {
    IDLE: 'idle',
    READY: 'ready',
    EXECUTING: 'executing',
    FEEDBACK: 'feedback',
    RESTING: 'resting',
    COMPLETED: 'completed',
    PAUSED: 'paused'
};

let workoutState = {
    current: WorkoutStates.IDLE,
    exerciseStartTime: null,
    setStartTime: null,
    restStartTime: null,
    pendingSetData: null,
    pausedFrom: null
};

// ===== HISTORIQUE DE NAVIGATION =====
const workoutHistory = {
    states: [],
    maxSize: 50,
    push(state) {
        this.states.push(JSON.parse(JSON.stringify(state)));
        if (this.states.length > this.maxSize) {
            this.states.shift();
        }
    },
    canUndo() {
        return this.states.length > 1;
    },
    undo() {
        if (this.canUndo()) {
            this.states.pop();
            return this.states[this.states.length - 1];
        }
        return null;
    }
};

// ===== GESTIONNAIRE CENTRALISÉ D'ÉTAT DE SÉANCE =====
const SessionStateManager = {
    timers: {
        workout: null,
        set: null,
        rest: null,
        autosave: null
    },
    
    startTimer(type, callback, interval = 1000) {
        this.stopTimer(type);
        this.timers[type] = setInterval(callback, interval);
    },
    
    stopTimer(type) {
        if (this.timers[type]) {
            clearInterval(this.timers[type]);
            this.timers[type] = null;
        }
    },
    
    stopAllTimers() {
        Object.keys(this.timers).forEach(type => this.stopTimer(type));
    },
    
    updateCounters() {
        if (!currentWorkoutSession || !currentExercise) return;
        
        const globalStats = {
            totalSets: currentWorkoutSession.completedSets.length,
            currentExerciseIndex: currentWorkoutSession.exerciseOrder || 1,
            totalExercises: currentWorkoutSession.program?.exercises?.length || 0
        };
        
        const exerciseStats = {
            completedSets: currentWorkoutSession.completedSets.filter(
                s => s.exercise_id === currentExercise.id
            ).length,
            totalSets: currentWorkoutSession.totalSets || 3,
            currentSet: currentSet
        };
        
        if (currentWorkoutSession.type === 'program') {
            const exerciseState = currentWorkoutSession.programExercises[currentExercise.id];
            if (exerciseState) {
                exerciseState.completedSets = exerciseStats.completedSets;
                exerciseState.isCompleted = exerciseStats.completedSets >= exerciseState.totalSets;
                
                currentWorkoutSession.completedExercisesCount = Object.values(
                    currentWorkoutSession.programExercises
                ).filter(ex => ex.isCompleted).length;
            }
        }
        
        this.updateAllDisplays(globalStats, exerciseStats);
    },
    
    updateAllDisplays(globalStats, exerciseStats) {
        const setProgressEl = document.getElementById('setProgress');
        if (setProgressEl) {
            setProgressEl.textContent = `Série ${exerciseStats.currentSet}/${exerciseStats.totalSets}`;
        }
        
        if (currentWorkoutSession.type === 'program') {
            const exerciseProgressEl = document.getElementById('exerciseProgress');
            if (exerciseProgressEl) {
                exerciseProgressEl.textContent = `Exercice ${globalStats.currentExerciseIndex}/${globalStats.totalExercises}`;
            }
            this.updateProgramListItem(currentExercise.id);
        }
        
        this.updateSeriesDotsDisplay(exerciseStats);
        this.updateSetsHistoryDisplay();
        updateSetNavigationButtons();
    },
    
    updateProgramListItem(exerciseId) {
        const exerciseCard = document.querySelector(`[data-exercise-id="${exerciseId}"]`);
        if (!exerciseCard) {
            loadProgramExercisesList();
            return;
        }
        
        const exerciseState = currentWorkoutSession.programExercises[exerciseId];
        const progressEl = exerciseCard.querySelector('.sets-progress');
        if (progressEl) {
            progressEl.textContent = `${exerciseState.completedSets}/${exerciseState.totalSets}`;
        }
        
        if (exerciseState.isCompleted && !exerciseCard.querySelector('.completed-badge')) {
            const badge = document.createElement('div');
            badge.className = 'completed-badge';
            badge.textContent = 'Terminé';
            exerciseCard.prepend(badge);
        }
    },
    
    updateSeriesDotsDisplay(exerciseStats) {
        const dotsContainer = document.querySelector('.series-dots');
        if (!dotsContainer) return;
        
        dotsContainer.innerHTML = '';
        for (let i = 1; i <= exerciseStats.totalSets; i++) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            if (i <= exerciseStats.completedSets) {
                dot.classList.add('completed');
            } else if (i === exerciseStats.currentSet) {
                dot.classList.add('active');
            }
            dotsContainer.appendChild(dot);
        }
    },
    
    updateSetsHistoryDisplay() {
        const container = document.getElementById('setsHistory');
        if (!container || !currentExercise) return;
        
        const exerciseSets = currentWorkoutSession.completedSets.filter(
            s => s.exercise_id === currentExercise.id
        );
        
        container.innerHTML = exerciseSets.map((set, index) => {
            const duration = set.duration_seconds ? 
                `${Math.floor(set.duration_seconds / 60)}:${(set.duration_seconds % 60).toString().padStart(2, '0')}` : 
                '--:--';
            
            const estimated1RM = set.weight > 0 ? calculateEstimated1RM(set.weight, set.reps) : 0;
            
            return `
                <div class="set-done">
                    <div class="set-main-info">
                        ${set.weight}kg × ${set.reps} • ${duration}
                    </div>
                    <div class="set-feedback-info">
                        💪${set.effort_level}/5 ${set.fatigue_level ? `• 😴${set.fatigue_level}/5` : ''}
                        ${estimated1RM > 0 ? `• 1RM: ${estimated1RM.toFixed(1)}kg` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }
};

// ===== GESTIONNAIRE DE TRANSITIONS D'ÉTAT =====
const StateTransitionManager = {
    validTransitions: {
        [WorkoutStates.IDLE]: [WorkoutStates.READY],
        [WorkoutStates.READY]: [WorkoutStates.EXECUTING, WorkoutStates.IDLE],
        [WorkoutStates.EXECUTING]: [WorkoutStates.FEEDBACK, WorkoutStates.READY],
        [WorkoutStates.FEEDBACK]: [WorkoutStates.RESTING, WorkoutStates.READY, WorkoutStates.COMPLETED],
        [WorkoutStates.RESTING]: [WorkoutStates.READY, WorkoutStates.IDLE, WorkoutStates.COMPLETED],
        [WorkoutStates.PAUSED]: [WorkoutStates.READY, WorkoutStates.EXECUTING, WorkoutStates.RESTING],
        [WorkoutStates.COMPLETED]: [WorkoutStates.IDLE]
    },
    
    canTransition(from, to) {
        return this.validTransitions[from]?.includes(to) || false;
    },
    
    transition(newState, options = {}) {
        const currentState = workoutState.current;
        
        if (!this.canTransition(currentState, newState)) {
            console.warn(`Transition invalide: ${currentState} -> ${newState}`);
            return false;
        }
        
        workoutHistory.push(workoutState);
        this.cleanup(currentState);
        workoutState.current = newState;
        this.initialize(newState, options);
        SessionStateManager.updateCounters();
        
        return true;
    },
    
    cleanup(state) {
        switch (state) {
            case WorkoutStates.EXECUTING:
                SessionStateManager.stopTimer('set');
                break;
            case WorkoutStates.RESTING:
                SessionStateManager.stopTimer('rest');
                document.getElementById('restPeriod').style.display = 'none';
                break;
            case WorkoutStates.FEEDBACK:
                document.querySelectorAll('.emoji-btn').forEach(btn => {
                    btn.classList.remove('selected');
                    btn.style.backgroundColor = '';
                });
                break;
        }
    },
    
    initialize(state, options) {
        switch (state) {
            case WorkoutStates.READY:
                document.getElementById('executeSetBtn').style.display = 'block';
                document.getElementById('setFeedback').style.display = 'none';
                startSetTimer();
                break;
                
            case WorkoutStates.EXECUTING:
                workoutState.setStartTime = new Date();
                document.getElementById('executeSetBtn').style.display = 'none';
                break;
                
            case WorkoutStates.FEEDBACK:
                document.getElementById('setFeedback').style.display = 'block';
                break;
                
            case WorkoutStates.RESTING:
                const restTime = options.restTime || 60;
                startRestPeriod(restTime);
                break;
                
            case WorkoutStates.COMPLETED:
                showSessionSummary();
                break;
        }
    }
};

// ===== GESTION DU MODE HORS LIGNE =====
const OfflineManager = {
    queue: [],
    
    async sync() {
        if (!navigator.onLine) return;
        
        while (this.queue.length > 0) {
            const action = this.queue.shift();
            try {
                await action();
            } catch (error) {
                this.queue.unshift(action);
                break;
            }
        }
        
        localStorage.setItem('offlineQueue', JSON.stringify(this.queue));
    },
    
    addToQueue(action) {
        this.queue.push(action);
        localStorage.setItem('offlineQueue', JSON.stringify(this.queue));
    },
    
    loadQueue() {
        try {
            const saved = localStorage.getItem('offlineQueue');
            if (saved) {
                this.queue = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Erreur chargement queue offline:', error);
        }
    }
};

// ===== CONFIGURATION =====
const totalSteps = 4;

const EQUIPMENT_CONFIG = {
    barbell_athletic: { name: 'Barre athlétique (20kg)', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="8" y="22" width="32" height="4" rx="2"/><rect x="4" y="20" width="4" height="8" rx="2"/><rect x="40" y="20" width="4" height="8" rx="2"/><circle cx="6" cy="24" r="1"/><circle cx="42" cy="24" r="1"/></svg>`, type: 'barbell', defaultWeight: 20 },
    barbell_ez: { name: 'Barre EZ/Curl (10kg)', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><path d="M8 24 Q16 20 24 24 Q32 28 40 24" stroke="currentColor" stroke-width="4" fill="none"/><rect x="4" y="22" width="3" height="4" rx="1"/><rect x="41" y="22" width="3" height="4" rx="1"/></svg>`, type: 'barbell', defaultWeight: 10 },
    barbell_short_pair: { name: 'Paire barres courtes', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="6" y="14" width="16" height="3" rx="1"/><rect x="26" y="14" width="16" height="3" rx="1"/><rect x="4" y="12" width="2" height="7" rx="1"/><rect x="22" y="12" width="2" height="7" rx="1"/><rect x="24" y="12" width="2" height="7" rx="1"/><rect x="42" y="12" width="2" height="7" rx="1"/><rect x="6" y="31" width="16" height="3" rx="1"/><rect x="26" y="31" width="16" height="3" rx="1"/><rect x="4" y="29" width="2" height="7" rx="1"/><rect x="22" y="29" width="2" height="7" rx="1"/><rect x="24" y="29" width="2" height="7" rx="1"/><rect x="42" y="29" width="2" height="7" rx="1"/></svg>`, type: 'adjustable', defaultWeight: 2.5 },
    dumbbells: { name: 'Dumbbells fixes', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="18" y="22" width="12" height="4" rx="2"/><rect x="12" y="18" width="6" height="12" rx="3"/><rect x="30" y="18" width="6" height="12" rx="3"/><rect x="10" y="20" width="2" height="8" rx="1"/><rect x="36" y="20" width="2" height="8" rx="1"/></svg>`, type: 'fixed_weights' },
    weight_plates: { name: 'Disques de musculation', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="4" fill="currentColor"/><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="1"/><text x="24" y="28" text-anchor="middle" font-size="8" fill="currentColor">20</text></svg>`, type: 'plates', required_for: ['barbell_athletic', 'barbell_ez', 'barbell_short_pair'] },
    resistance_bands: { name: 'Élastiques', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><path d="M8 24 Q16 16 24 24 Q32 32 40 24" stroke="currentColor" stroke-width="3" fill="none"/><circle cx="8" cy="24" r="3"/><circle cx="40" cy="24" r="3"/><path d="M8 28 Q16 20 24 28 Q32 36 40 28" stroke="currentColor" stroke-width="2" fill="none" opacity="0.6"/></svg>`, type: 'resistance' },
    kettlebells: { name: 'Kettlebells', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="20" y="12" width="8" height="6" rx="4"/><path d="M16 18 Q16 30 24 32 Q32 30 32 18" fill="currentColor"/><circle cx="24" cy="26" r="8" fill="currentColor"/></svg>`, type: 'fixed_weights' },
    pull_up_bar: { name: 'Barre de traction', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="8" y="12" width="32" height="3" rx="1"/><rect x="6" y="10" width="4" height="8" rx="2"/><rect x="38" y="10" width="4" height="8" rx="2"/><path d="M20 18 Q20 28 24 32 Q28 28 28 18" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="24" cy="32" r="2"/></svg>`, type: 'bodyweight' },
    dip_bar: { name: 'Barre de dips', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="12" y="16" width="8" height="3" rx="1"/><rect x="28" y="16" width="8" height="3" rx="1"/><rect x="10" y="14" width="3" height="8" rx="1"/><rect x="35" y="14" width="3" height="8" rx="1"/><path d="M22 22 Q22 28 24 30 Q26 28 26 22" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="24" cy="30" r="2"/></svg>`, type: 'bodyweight' },
    bench: { name: 'Banc de musculation', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="8" y="20" width="32" height="6" rx="3"/><rect x="6" y="26" width="4" height="12" rx="2"/><rect x="38" y="26" width="4" height="12" rx="2"/><rect x="12" y="14" width="24" height="6" rx="3"/></svg>`, type: 'bench', hasOptions: true },
    cable_machine: { name: 'Machine à poulies', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="6" y="8" width="4" height="32" rx="2"/><rect x="38" y="8" width="4" height="32" rx="2"/><circle cx="24" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 15 L24 30" stroke="currentColor" stroke-width="2"/><rect x="20" y="30" width="8" height="4" rx="2"/></svg>`, type: 'machine' },
    leg_press: { name: 'Presse à cuisses', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="8" y="28" width="32" height="8" rx="2"/><rect x="12" y="18" width="24" height="10" rx="2"/><path d="M16 18 L16 12 Q16 10 18 10 L30 10 Q32 10 32 12 L32 18" stroke="currentColor" stroke-width="2" fill="none"/></svg>`, type: 'machine' },
    lat_pulldown: { name: 'Tirage vertical', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="6" y="8" width="36" height="4" rx="2"/><rect x="4" y="6" width="4" height="8" rx="2"/><rect x="40" y="6" width="4" height="8" rx="2"/><path d="M20 12 L20 22 L16 26 L32 26 L28 22 L28 12" stroke="currentColor" stroke-width="2" fill="none"/><rect x="18" y="22" width="12" height="3" rx="1"/></svg>`, type: 'machine' },
    chest_press: { name: 'Développé machine', icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor"><rect x="8" y="18" width="32" height="12" rx="3"/><rect x="6" y="30" width="4" height="8" rx="2"/><rect x="38" y="30" width="4" height="8" rx="2"/><path d="M16 18 L16 14 Q16 12 18 12 L30 12 Q32 12 32 14 L32 18" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="20" cy="24" r="2"/><circle cx="28" cy="24" r="2"/></svg>`, type: 'machine' }
};

// Constantes pour la configuration
const PLATE_WEIGHTS = [1.25, 2, 2.5, 5, 10, 15, 20, 25];
const RESISTANCE_TENSIONS = [5, 10, 15, 20, 25, 30, 35, 40];
const DEFAULT_PLATE_COUNTS = { 1.25: 8, 2: 2, 2.5: 4, 5: 4, 10: 2, 15: 2, 20: 0, 25: 0 };
const DEFAULT_RESISTANCE_COUNTS = { 15: 1, 30: 1 };

const MUSCLE_GROUPS = {
    dos: { name: 'Dos', icon: '🔙' },
    pectoraux: { name: 'Pectoraux', icon: '💪' },
    bras: { name: 'Bras', icon: '💪' },
    epaules: { name: 'Épaules', icon: '🤷' },
    jambes: { name: 'Jambes', icon: '🦵' },
    abdominaux: { name: 'Abdominaux', icon: '🎯' }
};

// ===== INITIALISATION =====
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Démarrage de Fitness Coach');
    
    initializeTheme();
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const savedUserId = localStorage.getItem('fitness_user_id');
    
    if (savedUserId) {
        try {
            currentUser = await apiGet(`/api/users/${savedUserId}`);
            await loadUserAvailableWeights();
            showMainInterface();
            if (action) handleUrlAction(action);
        } catch (error) {
            console.log('Utilisateur non trouvé, affichage page d\'accueil');
            localStorage.removeItem('fitness_user_id');
            showHomePage();
        }
    } else {
        showHomePage();
        if (document.readyState === 'complete') {
            loadExistingProfiles();
        } else {
            window.addEventListener('load', loadExistingProfiles);
        }
    }
    
    setupEventListeners();
    registerServiceWorker();
    OfflineManager.loadQueue();
    
    const savedState = loadWorkoutState();
    if (savedState?.workout) {
        setTimeout(() => {
            if (confirm('Une séance était en cours. Reprendre ?')) {
                restoreWorkoutSession(savedState);
            } else {
                clearWorkoutState();
            }
        }, 500);
    }
    
    autoSaveWorkoutState();
    setTimeout(() => requestNotificationPermission(), 2000);
});

// ===== THEME MANAGEMENT =====
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    showToast(`Thème ${document.body.classList.contains('dark-mode') ? 'sombre' : 'clair'} activé`, 'info');
}

// ===== GESTION DES ACTIONS URL =====
function handleUrlAction(action) {
    switch (action) {
        case 'free-workout':
            setTimeout(() => startFreeWorkout(), 500);
            break;
        case 'program-workout':
            setTimeout(() => startProgramWorkout(), 500);
            break;
        default:
            console.log('Action URL inconnue:', action);
    }
}

// ===== PROGRESSIVE WEB APP =====
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            console.log('Service Worker support détecté');
            // await navigator.serviceWorker.register('/sw.js');
        } catch (error) {
            console.log('Erreur Service Worker:', error);
        }
    }
}

// ===== NAVIGATION =====
function showView(viewName) {
    if (!currentUser && ['dashboard', 'stats', 'profile'].includes(viewName)) {
        console.error('Pas d\'utilisateur chargé, retour à l\'accueil');
        showHomePage();
        return;
    }
    
    document.querySelectorAll('.view, .onboarding').forEach(el => {
        el.classList.remove('active');
    });
    
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
    });
    
    const view = document.getElementById(viewName);
    if (view) {
        view.classList.add('active');
    }
    
    const navItem = document.querySelector(`[onclick="showView('${viewName}')"]`);
    if (navItem) {
        navItem.classList.add('active');
    }
    
    switch (viewName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'stats':
            loadStats();
            break;
        case 'profile':
            loadProfile();
            break;
    }
}

function showMainInterface() {
    document.getElementById('onboarding').classList.remove('active');
    document.getElementById('progressContainer').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'flex';
    
    if (currentUser) {
        document.getElementById('userInitial').textContent = currentUser.name[0].toUpperCase();
        document.getElementById('userInitial').style.display = 'flex';
    }
    
    showView('dashboard');
}

function showOnboarding() {
    document.getElementById('onboarding').classList.add('active');
    document.getElementById('progressContainer').style.display = 'block';
    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('userInitial').style.display = 'none';
    
    currentStep = 1;
    showStep(1);
    updateProgressBar();
    loadEquipmentStep();
}

function showHomePage() {
    document.getElementById('onboarding').classList.remove('active');
    document.getElementById('progressContainer').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('userInitial').style.display = 'none';
    
    document.querySelectorAll('.view').forEach(el => {
        el.classList.remove('active');
    });
    
    document.getElementById('home').classList.add('active');
    loadExistingProfiles();
    
    setTimeout(() => {
        const container = document.getElementById('existingProfiles');
        if (container && container.innerHTML.trim() === '') {
            console.log('Rechargement des profils (tentative de secours)');
            loadExistingProfiles();
        }
    }, 1000);
}

async function loadExistingProfiles() {
    const container = document.getElementById('existingProfiles');
    if (!container) {
        console.error('Container existingProfiles non trouvé !');
        setTimeout(() => loadExistingProfiles(), 500);
        return;
    }
    
    container.style.display = 'block';
    container.innerHTML = '<p style="text-align: center;">Chargement des profils...</p>';
    
    try {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const users = await response.json();
        console.log(`${users.length} profils trouvés`);
        
        container.innerHTML = '';
        
        if (users.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Aucun profil existant</p>';
            return;
        }
        
        const divider = document.createElement('div');
        divider.className = 'profiles-divider';
        divider.textContent = 'ou continuez avec';
        container.appendChild(divider);
        
        for (const user of users) {
            const age = new Date().getFullYear() - new Date(user.birth_date).getFullYear();
            const profileBtn = document.createElement('button');
            profileBtn.className = 'profile-btn';
            profileBtn.onclick = () => {
                currentUser = user;
                localStorage.setItem('fitness_user_id', user.id);
                loadUserAvailableWeights().then(() => showMainInterface());
            };
            
            profileBtn.innerHTML = `
                <div class="profile-avatar">${user.name[0].toUpperCase()}</div>
                <div class="profile-info">
                    <div class="profile-name">${user.name}</div>
                    <div class="profile-details">
                        <div class="profile-stats">
                            <span class="profile-stat">🎂 ${age} ans</span>
                            <span class="profile-stat" id="stats-${user.id}">💪 ... séances</span>
                        </div>
                    </div>
                </div>
            `;
            
            container.appendChild(profileBtn);
            
            apiGet(`/api/users/${user.id}/stats`)
                .then(stats => {
                    const statsEl = document.getElementById(`stats-${user.id}`);
                    if (statsEl) statsEl.textContent = `💪 ${stats.total_workouts} séances`;
                })
                .catch(err => console.warn(`Stats non disponibles pour user ${user.id}`, err));
        }
    } catch (error) {
        console.error('Erreur chargement des profils:', error);
        container.innerHTML = `
            <p style="text-align: center; color: var(--danger);">
                Erreur de chargement des profils<br>
                <button class="btn btn-sm btn-secondary" onclick="loadExistingProfiles()">Réessayer</button>
            </p>
        `;
    }
}

function startNewProfile() {
    document.getElementById('home').classList.remove('active');
    showOnboarding();
}

// ===== ONBOARDING =====
function showStep(step) {
    document.querySelectorAll('.onboarding-step').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById(`step${step}`).classList.add('active');
}

function nextStep() {
    if (validateCurrentStep()) {
        if (currentStep < totalSteps) {
            currentStep++;
            showStep(currentStep);
            updateProgressBar();
            
            if (currentStep === 3) {
                loadDetailedEquipmentConfig();
            }
        }
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        showStep(currentStep);
        updateProgressBar();
    }
}

function updateProgressBar() {
    const progress = (currentStep - 1) / (totalSteps - 1) * 100;
    document.getElementById('progressBar').style.width = `${progress}%`;
}

function validateCurrentStep() {
    switch (currentStep) {
        case 1:
            const name = document.getElementById('userName').value.trim();
            const birthDate = document.getElementById('birthDate').value;
            const height = document.getElementById('height').value;
            const weight = document.getElementById('weight').value;
            
            if (!name || !birthDate || !height || !weight) {
                showToast('Veuillez remplir tous les champs', 'error');
                return false;
            }
            
            if (weight < 30 || weight > 300) {
                showToast('Poids invalide (30-300 kg)', 'error');
                return false;
            }
            
            if (height < 100 || height > 250) {
                showToast('Taille invalide (100-250 cm)', 'error');
                return false;
            }
            
            return true;
            
        case 2:
            const selectedEquipment = document.querySelectorAll('.equipment-card.selected');
            if (selectedEquipment.length === 0) {
                showToast('Sélectionnez au moins un équipement', 'error');
                return false;
            }
            return true;
            
        case 3:
            try {
                const config = collectEquipmentConfig();
                const errors = validateEquipmentConfig(config);
                if (errors.length > 0) {
                    showToast(errors[0], 'error');
                    return false;
                }
                return true;
            } catch (error) {
                showToast(error.message, 'error');
                return false;
            }
            
        case 4:
            const focusAreas = document.querySelectorAll('input[type="checkbox"]:checked');
            if (focusAreas.length === 0) {
                showToast('Sélectionnez au moins une zone à travailler', 'error');
                return false;
            }
            return true;
    }
    
    return true;
}

function loadEquipmentStep() {
    const grid = document.getElementById('equipmentGrid');
    grid.innerHTML = '';
    
    Object.entries(EQUIPMENT_CONFIG).forEach(([key, config]) => {
        const card = document.createElement('div');
        card.className = 'equipment-card';
        card.dataset.equipment = key;
        
        card.innerHTML = `
            <div class="equipment-icon">${config.icon}</div>
            <div class="equipment-name">${config.name}</div>
        `;
        
        card.addEventListener('click', () => toggleEquipment(card));
        grid.appendChild(card);
    });
}

function toggleEquipment(card) {
    card.classList.toggle('selected');
}

function loadDetailedEquipmentConfig() {
    const container = document.getElementById('detailedConfig');
    const selectedCards = document.querySelectorAll('.equipment-card.selected');
    
    container.innerHTML = '';
    
    selectedCards.forEach(card => {
        const equipment = card.dataset.equipment;
        const config = EQUIPMENT_CONFIG[equipment];
        
        const section = document.createElement('div');
        section.className = 'equipment-detail';
        
        let detailHTML = `<h3>${config.icon} ${config.name}</h3>`;
        
        switch (config.type) {
            case 'barbell':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids de la barre (kg)</label>
                        <input type="number" id="${equipment}_weight" value="${config.defaultWeight}" 
                               min="${Math.max(5, config.defaultWeight - 5)}" 
                               max="${config.defaultWeight + 10}" step="0.5">
                    </div>
                `;
                break;
                
            case 'adjustable':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids par barre courte (kg)</label>
                        <input type="number" id="${equipment}_weight" value="${config.defaultWeight}" 
                               min="1" max="5" step="0.5">
                    </div>
                    <div class="form-group">
                        <label>Nombre de barres courtes</label>
                        <input type="number" id="${equipment}_count" value="2" min="2" max="6">
                        <small>Minimum 2 pour faire une paire</small>
                    </div>
                `;
                break;
                
            case 'fixed_weights':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids disponibles (kg)</label>
                        <input type="text" id="${equipment}_weights" 
                               placeholder="${equipment === 'dumbbells' ? '5, 10, 15, 20, 25, 30' : '8, 12, 16, 20, 24'}" 
                               value="${equipment === 'dumbbells' ? '5, 10, 15, 20, 25, 30' : '8, 12, 16, 20, 24'}">
                        <small>${equipment === 'dumbbells' ? 'Dumbbells fixes d\'un seul tenant' : ''}, séparés par des virgules</small>
                    </div>
                `;
                break;
                
            case 'plates':
                detailHTML += `
                    <div class="form-group">
                        <label>Disques disponibles par poids</label>
                        <div class="plates-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 1rem; margin-top: 1rem;">
                            ${PLATE_WEIGHTS.map(weight => `
                                <div class="plate-input" style="text-align: center;">
                                    <label style="display: block; font-size: 0.9rem; margin-bottom: 0.25rem;">${weight}kg</label>
                                    <input type="number" id="plate_${weight.toString().replace('.', '_')}" 
                                           min="0" max="20" value="${DEFAULT_PLATE_COUNTS[weight] || 0}" 
                                           style="width: 100%; text-align: center;">
                                </div>
                            `).join('')}
                        </div>
                        <small style="display: block; margin-top: 0.5rem;">Nombre de disques par poids. Minimum 2 par poids pour faire une paire.</small>
                    </div>
                `;
                break;
                
            case 'bodyweight':
                detailHTML += `
                    <div class="form-group">
                        <label>Possibilité d'ajouter du lest</label>
                        <label class="checkbox-option">
                            <input type="checkbox" id="${equipment}_weighted">
                            <span>Oui, je peux ajouter du poids (ceinture de lest, gilet...)</span>
                        </label>
                    </div>
                    <div class="form-group" id="${equipment}_weights_container" style="display: none;">
                        <label>Poids de lest disponibles (kg)</label>
                        <input type="text" id="${equipment}_weights" placeholder="5, 10, 15, 20" value="5, 10, 15, 20">
                    </div>
                `;
                break;
                
            case 'resistance':
                detailHTML += `
                    <div class="form-group">
                        <label>Tensions disponibles (kg équivalent)</label>
                        <div class="resistance-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 1rem; margin-top: 1rem;">
                            ${RESISTANCE_TENSIONS.map(tension => `
                                <div class="tension-input" style="text-align: center;">
                                    <label style="display: block; font-size: 0.9rem; margin-bottom: 0.25rem;">${tension}kg</label>
                                    <input type="number" id="tension_${tension}" min="0" max="10" 
                                           value="${DEFAULT_RESISTANCE_COUNTS[tension] || 0}" 
                                           style="width: 100%; text-align: center;">
                                </div>
                            `).join('')}
                        </div>
                        <small style="display: block; margin-top: 0.5rem;">Nombre d'élastiques par tension disponible.</small>
                    </div>
                    <div class="form-group">
                        <label>Possibilité de combiner les élastiques</label>
                        <label class="checkbox-option">
                            <input type="checkbox" id="${equipment}_combinable" checked>
                            <span>Oui, je peux utiliser plusieurs élastiques ensemble</span>
                        </label>
                    </div>
                `;
                break;
                
            case 'bench':
                detailHTML += `
                    <div class="form-group">
                        <label>Positions disponibles du banc</label>
                        <div class="bench-options" style="display: grid; gap: 0.75rem; margin-top: 1rem;">
                            <label class="checkbox-option">
                                <input type="checkbox" id="${equipment}_flat" checked>
                                <span>🛏️ Position plate (obligatoire)</span>
                            </label>
                            <label class="checkbox-option">
                                <input type="checkbox" id="${equipment}_incline_up" checked>
                                <span>📐 Inclinable vers le haut (développé incliné)</span>
                            </label>
                            <label class="checkbox-option">
                                <input type="checkbox" id="${equipment}_decline" checked>
                                <span>📉 Inclinable vers le bas (développé décliné)</span>
                            </label>
                        </div>
                        <small style="display: block; margin-top: 0.5rem;">Configuration complète recommandée pour un maximum d'exercices.</small>
                    </div>
                    <div class="form-group">
                        <label>Réglages disponibles</label>
                        <div class="bench-settings" style="display: grid; gap: 0.75rem; margin-top: 1rem;">
                            <label class="checkbox-option">
                                <input type="checkbox" id="${equipment}_height_adjustable">
                                <span>📏 Hauteur réglable</span>
                            </label>
                            <label class="checkbox-option">
                                <input type="checkbox" id="${equipment}_has_rack">
                                <span>🏗️ Support de barre intégré</span>
                            </label>
                            <label class="checkbox-option">
                                <input type="checkbox" id="${equipment}_preacher_curl">
                                <span>💪 Pupitre à biceps (preacher curl)</span>
                            </label>
                        </div>
                    </div>
                `;
                break;
                
            case 'machine':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids maximum de la machine (kg)</label>
                        <input type="number" id="${equipment}_max_weight" value="100" min="50" max="300" step="5">
                    </div>
                    <div class="form-group">
                        <label>Incrément minimum (kg)</label>
                        <input type="number" id="${equipment}_increment" value="5" min="1" max="10" step="0.5">
                    </div>
                `;
                break;
                
            default:
                detailHTML += `<p>Équipement disponible ✅</p>`;
        }
        
        section.innerHTML = detailHTML;
        container.appendChild(section);
        
        // Setup event listeners pour équipement bodyweight
        if (config.type === 'bodyweight') {
            const checkbox = document.getElementById(`${equipment}_weighted`);
            const weightsContainer = document.getElementById(`${equipment}_weights_container`);
            checkbox?.addEventListener('change', () => {
                weightsContainer.style.display = checkbox.checked ? 'block' : 'none';
            });
        }
    });
    
    showEquipmentWarnings();
    setTimeout(() => showConfigurationSummary(), 500);
}

function showConfigurationSummary() {
    const config = collectEquipmentConfig();
    const summary = document.createElement('div');
    summary.className = 'config-summary';
    summary.style.cssText = 'background: var(--bg-secondary); padding: 1rem; border-radius: var(--radius); margin-top: 1rem;';
    
    let summaryHTML = '<h4>Résumé de votre configuration :</h4><ul>';
    
    // Calculer les possibilités
    if (config.weight_plates?.weights) {
        const plateCombinations = calculateAvailableWeightsFromPlates(config.weight_plates.weights);
        summaryHTML += `<li>Disques : ${Object.keys(config.weight_plates.weights).length} poids différents permettant ${plateCombinations.length} combinaisons</li>`;
    }
    
    if (config.bench?.available) {
        const benchCapabilities = getBenchCapabilities(config);
        summaryHTML += `<li>Banc : ${benchCapabilities.capabilities.join(', ')}</li>`;
    }
    
    summaryHTML += '</ul>';
    summary.innerHTML = summaryHTML;
    
    const container = document.getElementById('detailedConfig');
    const existingSummary = container.querySelector('.config-summary');
    if (existingSummary) {
        existingSummary.remove();
    }
    container.appendChild(summary);
}

function calculateAvailableWeightsFromPlates(platesConfig, barbellWeight = 0) {
    const weights = new Set([barbellWeight]);
    
    Object.entries(platesConfig).forEach(([weight, count]) => {
        const plateWeight = parseFloat(weight);
        const currentWeights = Array.from(weights);
        
        for (let i = 1; i <= Math.min(count, 2); i++) {
            currentWeights.forEach(w => {
                weights.add(w + plateWeight * 2 * i); // *2 car on charge des deux côtés
            });
        }
    });
    
    return Array.from(weights).sort((a, b) => a - b).filter(w => w > 0 && w <= 300);
}

function showEquipmentWarnings() {
    const selectedCards = document.querySelectorAll('.equipment-card.selected');
    const selectedEquipment = Array.from(selectedCards).map(card => card.dataset.equipment);
    const warnings = [];
    
    // Vérifications des dépendances
    const barbellsRequiringPlates = ['barbell_athletic', 'barbell_ez', 'barbell_short_pair'];
    const hasBarbell = barbellsRequiringPlates.some(b => selectedEquipment.includes(b));
    
    if (hasBarbell && !selectedEquipment.includes('weight_plates')) {
        warnings.push('⚠️ Les barres nécessitent des disques de musculation');
    }
    
    if (selectedEquipment.includes('bench')) {
        const benchCapabilities = getBenchCapabilities(collectEquipmentConfig());
        if (benchCapabilities.available && benchCapabilities.exerciseCount < 10) {
            warnings.push(`ℹ️ Configuration basique du banc (${benchCapabilities.exerciseCount} exercices compatibles)`);
        }
    }
    
    const hasBarbell2 = ['barbell_athletic', 'barbell_ez'].some(b => selectedEquipment.includes(b));
    if (hasBarbell2 && !selectedEquipment.includes('bench')) {
        warnings.push('💡 Conseil: Un banc multiplierait vos possibilités d\'exercices avec barres');
    }
    
    if (warnings.length > 0) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'equipment-warnings';
        warningDiv.style.cssText = 'background: var(--warning); color: white; padding: 1rem; border-radius: var(--radius); margin-top: 1rem;';
        warningDiv.innerHTML = warnings.join('<br>');
        document.getElementById('detailedConfig').appendChild(warningDiv);
    }
}

function validateEquipmentConfig(config) {
    const errors = [];
    
    // Vérifier les disques pour les barres
    const barbellsRequiringPlates = ['barbell_athletic', 'barbell_ez', 'barbell_short_pair'];
    const hasBarbell = barbellsRequiringPlates.some(b => config[b]?.available);
    
    if (hasBarbell && !config.weight_plates?.available) {
        errors.push('Les disques sont obligatoires pour utiliser les barres');
    }
    
    // Vérifier les barres courtes
    if (config.barbell_short_pair?.available && config.barbell_short_pair?.count < 2) {
        errors.push('Au moins 2 barres courtes sont nécessaires');
    }
    
    // Vérifier qu'il y a au moins un équipement de force
    const forceEquipment = ['dumbbells', 'barbell_athletic', 'barbell_ez', 'barbell_short_pair'];
    if (!forceEquipment.some(eq => config[eq]?.available)) {
        errors.push('Sélectionnez au moins un équipement de musculation');
    }
    
    // Vérifier les élastiques
    if (config.resistance_bands?.available) {
        const tensions = config.resistance_bands.tensions || {};
        const hasTensions = Object.values(tensions).some(count => count > 0);
        if (!hasTensions) {
            errors.push('Sélectionnez au moins une tension d\'élastique');
        }
    }
    
    // Vérifier le banc
    if (config.bench?.available) {
        const positions = config.bench.positions || {};
        if (!positions.flat) {
            errors.push('La position plate du banc est obligatoire');
        }
        
        const hasAnyPosition = Object.values(positions).some(p => p === true);
        if (!hasAnyPosition) {
            errors.push('Sélectionnez au moins une position pour le banc');
        }
    }
    
    return errors;
}

function getBenchCapabilities(config) {
    const bench = config.bench;
    if (!bench?.available) return { available: false, capabilities: [] };
    
    const capabilities = [];
    const positions = bench.positions || {};
    const settings = bench.settings || {};
    
    if (positions.flat) capabilities.push('Développé couché plat');
    if (positions.incline_up) capabilities.push('Développé incliné');
    if (positions.decline) capabilities.push('Développé décliné');
    if (settings.has_rack) capabilities.push('Support de barre intégré');
    if (settings.preacher_curl) capabilities.push('Curl pupitre');
    if (settings.height_adjustable) capabilities.push('Hauteur réglable');
    
    return {
        available: true,
        capabilities,
        exerciseCount: estimateExerciseCompatibilityFromBench(positions, settings)
    };
}

function estimateExerciseCompatibilityFromBench(positions, settings) {
    let exerciseCount = 0;
    
    if (positions.flat) exerciseCount += 15; // Développé couché, écartés, etc.
    if (positions.incline_up) exerciseCount += 8; // Développé incliné, etc.
    if (positions.decline) exerciseCount += 5; // Développé décliné, etc.
    if (settings.preacher_curl) exerciseCount += 3; // Curl pupitre variations
    
    return exerciseCount;
}

async function completeOnboarding() {
    if (!validateCurrentStep()) return;
    
    try {
        showToast('Création de votre profil...', 'info');
        
        const userData = {
            name: document.getElementById('userName').value.trim(),
            birth_date: document.getElementById('birthDate').value + 'T00:00:00',
            height: parseFloat(document.getElementById('height').value),
            weight: parseFloat(document.getElementById('weight').value),
            experience_level: document.querySelector('input[name="experience"]:checked').value,
            equipment_config: collectEquipmentConfig()
        };
        
        currentUser = await apiPost('/api/users', userData);
        localStorage.setItem('fitness_user_id', currentUser.id);
        
        // Sauvegarder dans la liste des profils
        const profiles = JSON.parse(localStorage.getItem('fitness_profiles') || '[]');
        if (!profiles.includes(currentUser.id)) {
            profiles.push(currentUser.id);
            localStorage.setItem('fitness_profiles', JSON.stringify(profiles));
        }
        
        // Créer un programme si des zones focus sont sélectionnées
        const focusAreas = Array.from(document.querySelectorAll('input[name="focusAreas"]:checked'))
            .map(cb => cb.value);
        
        if (focusAreas.length > 0) {
            const programData = {
                name: document.getElementById('programName').value || 'Mon programme',
                sessions_per_week: parseInt(document.getElementById('sessionsPerWeek').value),
                session_duration_minutes: parseInt(document.getElementById('sessionDuration').value),
                focus_areas: focusAreas
            };
            
            await apiPost(`/api/users/${currentUser.id}/programs`, programData);
        }
        
        showToast('Profil créé avec succès ! 🎉', 'success');
        await loadUserAvailableWeights();
        showMainInterface();
        
    } catch (error) {
        console.error('Erreur création profil:', error);
        showToast('Erreur lors de la création du profil', 'error');
    }
}

function collectEquipmentConfig() {
    const config = {};
    const selectedCards = document.querySelectorAll('.equipment-card.selected');
    
    selectedCards.forEach(card => {
        const equipment = card.dataset.equipment;
        const equipmentType = EQUIPMENT_CONFIG[equipment].type;
        
        config[equipment] = { available: true };
        
        switch (equipmentType) {
            case 'barbell':
            case 'adjustable':
                const weightInput = document.getElementById(`${equipment}_weight`);
                if (weightInput) {
                    config[equipment].weight = parseFloat(weightInput.value);
                }
                
                if (equipment === 'barbell_short_pair') {
                    const countInput = document.getElementById(`${equipment}_count`);
                    if (countInput) {
                        config[equipment].count = parseInt(countInput.value);
                    }
                }
                break;
                
            case 'fixed_weights':
                const weightsInput = document.getElementById(`${equipment}_weights`);
                if (weightsInput) {
                    config[equipment].weights = weightsInput.value
                        .split(',')
                        .map(w => parseFloat(w.trim()))
                        .filter(w => !isNaN(w) && w > 0)
                        .sort((a, b) => a - b);
                }
                break;
                
            case 'plates':
                const plateWeights = {};
                PLATE_WEIGHTS.forEach(weight => {
                    const input = document.getElementById(`plate_${weight.toString().replace('.', '_')}`);
                    if (input) {
                        const count = parseInt(input.value);
                        if (count > 0) {
                            plateWeights[weight] = count;
                        }
                    }
                });
                config[equipment].weights = plateWeights;
                break;
                
            case 'bodyweight':
                const weightedCheckbox = document.getElementById(`${equipment}_weighted`);
                const weightsInput2 = document.getElementById(`${equipment}_weights`);
                
                if (weightedCheckbox) {
                    config[equipment].can_add_weight = weightedCheckbox.checked;
                    
                    if (weightedCheckbox.checked && weightsInput2) {
                        config[equipment].additional_weights = weightsInput2.value
                            .split(',')
                            .map(w => parseFloat(w.trim()))
                            .filter(w => !isNaN(w) && w > 0)
                            .sort((a, b) => a - b);
                    }
                }
                break;
                
            case 'resistance':
                const tensions = {};
                RESISTANCE_TENSIONS.forEach(tension => {
                    const input = document.getElementById(`tension_${tension}`);
                    if (input) {
                        const count = parseInt(input.value);
                        if (count > 0) {
                            tensions[tension] = count;
                        }
                    }
                });
                config[equipment].tensions = tensions;
                
                const combinableCheckbox = document.getElementById(`${equipment}_combinable`);
                if (combinableCheckbox) {
                    config[equipment].combinable = combinableCheckbox.checked;
                }
                break;
                
            case 'bench':
                const positions = {
                    flat: document.getElementById(`${equipment}_flat`)?.checked || false,
                    incline_up: document.getElementById(`${equipment}_incline_up`)?.checked || false,
                    decline: document.getElementById(`${equipment}_decline`)?.checked || false
                };
                
                const settings = {
                    height_adjustable: document.getElementById(`${equipment}_height_adjustable`)?.checked || false,
                    has_rack: document.getElementById(`${equipment}_has_rack`)?.checked || false,
                    preacher_curl: document.getElementById(`${equipment}_preacher_curl`)?.checked || false
                };
                
                config[equipment].positions = positions;
                config[equipment].settings = settings;
                
                if (!positions.flat) {
                    throw new Error('La position plate du banc est obligatoire');
                }
                break;
                
            case 'machine':
                const maxWeight = document.getElementById(`${equipment}_max_weight`);
                const increment = document.getElementById(`${equipment}_increment`);
                
                if (maxWeight) config[equipment].max_weight = parseFloat(maxWeight.value);
                if (increment) config[equipment].increment = parseFloat(increment.value);
                break;
        }
    });
    
    const errors = validateEquipmentConfig(config);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    
    return config;
}

// ===== DASHBOARD =====
async function loadDashboard() {
    if (!currentUser) return;
    
    try {
        // Vérifier s'il y a une séance active
        const activeWorkout = await apiGet(`/api/users/${currentUser.id}/workouts/active`);
        if (activeWorkout) {
            showWorkoutResumeBanner(activeWorkout);
        }
    } catch (error) {
        // Pas de séance active
    }
    
    // Message de bienvenue
    const welcomeMsg = document.getElementById('welcomeMessage');
    const hour = new Date().getHours();
    let greeting = 'Bonsoir';
    if (hour < 12) greeting = 'Bonjour';
    else if (hour < 18) greeting = 'Bon après-midi';
    
    welcomeMsg.innerHTML = `
        <h2>${greeting} ${currentUser.name} ! 👋</h2>
        <p>Prêt pour votre prochaine séance ?</p>
    `;
    
    try {
        const [stats, muscleReadiness] = await Promise.all([
            apiGet(`/api/users/${currentUser.id}/stats`),
            apiGet(`/api/users/${currentUser.id}/muscle-recovery`)
        ]);
        
        loadMuscleReadiness(muscleReadiness);
        loadRecentWorkouts(stats.recent_workouts);
        
    } catch (error) {
        console.error('Erreur chargement dashboard:', error);
        // Charger avec des données par défaut si erreur
        loadMuscleReadiness();
        loadRecentWorkouts([]);
    }
}

function showWorkoutResumeBanner(workout) {
    const banner = document.createElement('div');
    banner.className = 'workout-resume-banner';
    banner.style.cssText = `
        background: linear-gradient(135deg, var(--warning), #f97316);
        color: white;
        padding: 1rem;
        border-radius: var(--radius);
        margin-bottom: 1rem;
        text-align: center;
        cursor: pointer;
        animation: pulse 2s infinite;
    `;
    
    const startedAt = new Date(workout.started_at);
    const elapsed = startedAt && !isNaN(startedAt) ? 
        Math.floor((new Date() - startedAt) / 60000) : 0;
    
    banner.innerHTML = `
        <h3>⏱️ Séance en cours</h3>
        <p>Démarrée il y a ${elapsed} minutes</p>
        <button class="btn" style="background: white; color: var(--warning); margin-top: 0.5rem;" 
                onclick="resumeWorkoutById(${workout.id})">
            Reprendre la séance
        </button>
    `;
    
    const welcomeMsg = document.getElementById('welcomeMessage');
    welcomeMsg.parentNode.insertBefore(banner, welcomeMsg.nextSibling);
}

async function resumeWorkoutById(workoutId) {
    try {
        currentWorkout = await apiGet(`/api/workouts/${workoutId}`);
        showView('workout');
        
        if (currentWorkout.type === 'free') {
            setupFreeWorkout();
        } else {
            const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
            setupProgramWorkout(program);
        }
        
        showToast('Séance reprise', 'success');
    } catch (error) {
        console.error('Erreur reprise séance:', error);
        showToast('Erreur lors de la reprise de séance', 'error');
    }
}

function loadMuscleReadiness(data) {
    const defaultData = [
        { name: 'Dos', status: 'ready', lastTrained: null },
        { name: 'Pectoraux', status: 'recovering', lastTrained: '2 jours' },
        { name: 'Bras', status: 'ready', lastTrained: null },
        { name: 'Épaules', status: 'fatigued', lastTrained: '1 jour' },
        { name: 'Jambes', status: 'ready', lastTrained: null },
        { name: 'Abdominaux', status: 'recovering', lastTrained: '1 jour' }
    ];
    
    const muscles = data || defaultData;
    const container = document.getElementById('muscleReadiness');
    
    const statusText = {
        ready: 'Prêt à l\'entraînement',
        recovering: 'En récupération',
        fatigued: 'Fatigué'
    };
    
    const statusColors = {
        ready: 'var(--success)',
        recovering: 'var(--warning)',
        fatigued: 'var(--danger)'
    };
    
    container.innerHTML = muscles.map(muscle => {
        const status = statusText[muscle.status];
        const color = statusColors[muscle.status];
        
        return `
            <div class="muscle-item ${muscle.status}">
                <div class="muscle-indicator" style="background-color: ${color}"></div>
                <div class="muscle-info">
                    <h4>${muscle.name}</h4>
                    <p>${status}${muscle.lastTrained ? ` • Dernier entraînement : ${muscle.lastTrained}` : ''}</p>
                </div>
            </div>
        `;
    }).join('');
}

function loadRecentWorkouts(workouts) {
    const container = document.getElementById('recentWorkouts');
    
    if (!workouts || workouts.length === 0) {
        container.innerHTML = '<p class="text-center">Aucune séance récente</p>';
        return;
    }
    
    container.innerHTML = workouts.slice(0, 3).map(workout => {
        const date = new Date(workout.completed_at);
        const duration = workout.total_duration_minutes || 0;
        const volume = workout.total_volume || 0;
        
        return `
            <div class="workout-item">
                <div class="workout-header">
                    <strong>${workout.type === 'program' ? 'Programme' : 'Libre'}</strong>
                    <div class="workout-date">${formatDate(date)}</div>
                </div>
                <div class="workout-stats">
                    <span>${duration} min</span>
                    <span>${volume} kg</span>
                    <span>${workout.total_sets} séries</span>
                </div>
            </div>
        `;
    }).join('');
}

// ===== SÉANCES =====
async function startFreeWorkout() {
    try {
        const workoutData = {
            type: 'free'
        };
        
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        currentWorkout = response.workout;
        currentWorkoutSession.type = 'free';
        
        showView('workout');
        setupFreeWorkout();
        
    } catch (error) {
        console.error('Erreur démarrage séance libre:', error);
        showToast('Erreur lors du démarrage de la séance', 'error');
    }
}

async function startProgramWorkout() {
    clearWorkoutState();
    currentSet = 1;
    
    try {
        const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
        
        if (!program) {
            showToast('Aucun programme actif. Créez-en un dans les paramètres.', 'info');
            return;
        }
        
        const workoutData = {
            type: 'program',
            program_id: program.id
        };
        
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        currentWorkout = response.workout;
        currentWorkoutSession.type = 'program';
        currentWorkoutSession.program = program;
        currentWorkoutSession.programExercises = {};
        
        // Initialiser l'état de chaque exercice
        program.exercises.forEach((ex, index) => {
            currentWorkoutSession.programExercises[ex.exercise_id] = {
                index,
                exerciseId: ex.exercise_id,
                totalSets: ex.sets || 3,
                targetReps: ex.target_reps || 10,
                restTime: ex.rest_seconds || 90,
                completedSets: 0,
                isCompleted: false,
                isSkipped: false,
                startTime: null,
                endTime: null
            };
        });
        
        showView('workout');
        setupProgramWorkout(program);
        
    } catch (error) {
        console.error('Erreur démarrage séance programme:', error);
        showToast('Erreur lors du démarrage de la séance', 'error');
    }
}

function setupFreeWorkout() {
    document.getElementById('exerciseSelection').style.display = 'block';
    document.getElementById('currentExercise').style.display = 'none';
    document.getElementById('programExercisesContainer').style.display = 'none';
    
    loadAvailableExercises();
    startWorkoutTimer();
}

function setupProgramWorkout(program) {
    document.getElementById('exerciseSelection').style.display = 'none';
    document.getElementById('programExercisesContainer').style.display = 'block';
    
    currentWorkoutSession.program = program;
    currentWorkoutSession.type = 'program';
    currentWorkoutSession.exerciseOrder = 0;
    
    loadProgramExercisesList();
    
    if (program.exercises.length > 0) {
        selectProgramExercise(program.exercises[0].exercise_id, true);
    }
    
    startWorkoutTimer();
}

function startWorkoutTimer() {
    const startTime = new Date();
    SessionStateManager.startTimer('workout', () => {
        const elapsed = new Date() - startTime;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('workoutTimer').textContent = 
            `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    });
}

function startSetTimer() {
    workoutState.setStartTime = new Date();
    SessionStateManager.startTimer('set', () => {
        const elapsed = Math.floor((new Date() - workoutState.setStartTime) / 1000);
        document.getElementById('setTimer').textContent = formatTime(elapsed);
        
        // Alerte si la série dure trop longtemps
        if (elapsed === 120) {
            playRestSound('warning');
            showToast('2 minutes écoulées', 'warning');
        }
    });
}

function updateSetTimer() {
    if (!workoutState.setStartTime) return;
    const elapsed = new Date() - workoutState.setStartTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('setTimer').textContent = 
        `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ===== SÉLECTION ET GESTION DES EXERCICES =====
async function selectExercise(exercise) {
    currentExercise = exercise;
    currentWorkoutSession.currentExercise = exercise;
    currentSet = 1;
    currentWorkoutSession.currentSetNumber = 1;
    currentWorkoutSession.totalSets = exercise.default_sets || 3;
    currentWorkoutSession.maxSets = 6;
    
    workoutState.exerciseStartTime = new Date();
    
    // Masquer la sélection et afficher l'exercice
    document.getElementById('exerciseSelection').style.display = 'none';
    document.getElementById('currentExercise').style.display = 'block';
    
    // Mettre à jour toutes les infos de l'exercice
    document.getElementById('exerciseName').textContent = exercise.name;
    document.getElementById('exerciseInstructions').textContent = 
        exercise.instructions || 'Effectuez cet exercice avec une forme correcte';
    
    // Afficher les détails supplémentaires s'ils existent
    const difficultyEl = document.getElementById('exerciseDifficulty');
    if (difficultyEl) {
        difficultyEl.textContent = `Difficulté: ${exercise.difficulty || 'Intermédiaire'}`;
    }
    
    const musclesEl = document.getElementById('exerciseMuscles');
    if (musclesEl && exercise.muscle_groups) {
        musclesEl.textContent = `Muscles: ${exercise.muscle_groups.join(', ')}`;
    }
    
    // Gérer l'affichage du bouton "Changer d'exercice" selon le mode
    const changeExerciseBtn = document.querySelector('.btn-change-exercise');
    if (changeExerciseBtn) {
        changeExerciseBtn.style.display = currentWorkoutSession.type === 'program' ? 'none' : 'flex';
    }
    
    // Charger les recommandations initiales
    await updateSetRecommendations();
    
    // Transition vers READY
    StateTransitionManager.transition(WorkoutStates.READY);
    
    showToast(`Exercice sélectionné: ${exercise.name}`, 'success');
}

// Protection contre double-clic
let isProcessing = false;

async function executeSet() {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        if (!validateSessionState()) return;
        
        const weight = parseFloat(document.getElementById('setWeight').value) || 0;
        const reps = parseInt(document.getElementById('setReps').value) || 0;
        
        if (!reps) {
            showToast('Veuillez indiquer le nombre de répétitions', 'warning');
            return;
        }
        
        if (reps === 0 && weight === 0) {
            showToast('Veuillez entrer au moins les répétitions ou le poids', 'warning');
            return;
        }
        
        // Vérification de sécurité du poids
        if (weight > 0) {
            const safetyCheck = await checkSafeWeight(weight, currentExercise);
            if (!safetyCheck.safe) {
                if (!confirm(safetyCheck.message)) {
                    return;
                }
            }
        }
        
        if (!StateTransitionManager.transition(WorkoutStates.EXECUTING)) {
            return;
        }
        
        const duration = Math.round((new Date() - workoutState.setStartTime) / 1000);
        
        workoutState.pendingSetData = {
            exercise_id: currentExercise.id,
            set_number: currentSet,
            weight: weight,
            reps: reps,
            duration_seconds: duration,
            exercise_order_in_session: currentWorkoutSession.exerciseOrder,
            set_order_in_session: currentWorkoutSession.globalSetCount + 1,
            rest_time_planned: currentExercise.base_rest_time_seconds || 60
        };
        
        // Transition vers feedback
        StateTransitionManager.transition(WorkoutStates.FEEDBACK);
        
        // Analyse de performance en temps réel
        analyzeSetPerformance(workoutState.pendingSetData);
        
    } finally {
        isProcessing = false;
    }
}

async function validateSet() {
    const fatigue = document.querySelector('.emoji-btn[data-fatigue].selected')?.dataset.fatigue;
    const effort = document.querySelector('.emoji-btn[data-effort].selected')?.dataset.effort;
    
    if (!fatigue || !effort) {
        showToast('Veuillez indiquer votre fatigue et effort', 'warning');
        return;
    }
    
    if (!workoutState.pendingSetData) {
        console.error('Pas de données de série en attente');
        return;
    }
    
    workoutState.pendingSetData.fatigue_level = parseInt(fatigue);
    workoutState.pendingSetData.effort_level = parseInt(effort);
    
    try {
        // Validation des données
        validateSetData(workoutState.pendingSetData);
        
        // Enregistrement (avec gestion offline)
        if (navigator.onLine) {
            await apiPost(`/api/workouts/${currentWorkout.id}/sets`, workoutState.pendingSetData);
        } else {
            OfflineManager.addToQueue(() => 
                apiPost(`/api/workouts/${currentWorkout.id}/sets`, workoutState.pendingSetData)
            );
        }
        
        // Ajouter aux séries complétées
        currentWorkoutSession.completedSets.push(workoutState.pendingSetData);
        currentWorkoutSession.globalSetCount++;
        
        // Mise à jour immédiate de tous les compteurs
        SessionStateManager.updateCounters();
        
        // Détection de fatigue excessive
        detectOvertraining();
        
        showToast('Feedback enregistré !', 'success');
        
        // Vérifier si toutes les séries sont terminées
        const completedForThisExercise = currentWorkoutSession.completedSets.filter(
            s => s.exercise_id === currentExercise.id
        ).length;
        
        if (completedForThisExercise >= currentWorkoutSession.totalSets) {
            showSetCompletionOptions();
        } else {
            // Calculer le temps de repos adaptatif
            const restTime = calculateAdaptiveRestTime(
                currentExercise,
                parseInt(fatigue),
                parseInt(effort),
                currentSet
            );
            
            // Transition vers repos
            StateTransitionManager.transition(WorkoutStates.RESTING, { restTime });
        }
        
        workoutState.pendingSetData = null;
        
    } catch (error) {
        console.error('Erreur validation série:', error);
        showToast(error.message || 'Erreur lors de l\'enregistrement', 'error');
    }
}

function validateSetData(data) {
    if (data.reps <= 0) {
        throw new Error('Le nombre de répétitions doit être positif');
    }
    if (data.weight < 0) {
        throw new Error('Le poids ne peut pas être négatif');
    }
    if (data.set_number > currentWorkoutSession.maxSets) {
        throw new Error('Nombre maximum de séries dépassé');
    }
}

// ===== GESTION DU REPOS =====
function startRestPeriod(restTime) {
    document.getElementById('restPeriod').style.display = 'flex';
    document.getElementById('setFeedback').style.display = 'none';
    
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        inputSection.style.display = 'none';
    }
    
    let timeLeft = restTime;
    const initialTime = restTime;
    
    updateRestTimer(timeLeft);
    playRestSound('start');
    
    if (navigator.vibrate) {
        navigator.vibrate(200);
    }
    
    SessionStateManager.startTimer('rest', () => {
        timeLeft--;
        currentWorkoutSession.totalRestTime++;
        
        updateRestTimer(timeLeft);
        
        const progressFill = document.getElementById('restProgressFill');
        if (progressFill) {
            const progress = ((initialTime - timeLeft) / initialTime) * 100;
            progressFill.style.width = `${progress}%`;
        }
        
        // Alertes sonores
        if (timeLeft === 30) {
            playRestSound('warning');
            showToast('30 secondes restantes', 'warning');
        } else if (timeLeft === 10) {
            playRestSound('warning');
        }
        
        if (timeLeft <= 0) {
            SessionStateManager.stopTimer('rest');
            completeRest();
            playRestSound('end');
            
            // Notification
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Temps de repos terminé !', {
                    body: 'Prêt pour la prochaine série ?',
                    icon: '/icon-192.png',
                    vibrate: [200, 100, 200]
                });
            }
        }
    });
}

function updateRestTimer(timeLeft) {
    const timerEl = document.getElementById('restTimer');
    if (timerEl) {
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

function completeRest() {
    // Passer à la série suivante
    currentSet++;
    currentWorkoutSession.currentSetNumber = currentSet;
    
    // Réafficher l'interface de saisie
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        inputSection.style.display = 'block';
    }
    
    document.getElementById('restPeriod').style.display = 'none';
    
    // Transition vers READY pour la nouvelle série
    StateTransitionManager.transition(WorkoutStates.READY);
    
    // Mise à jour des recommandations pour la nouvelle série
    updateSetRecommendations();
}

function skipRest() {
    if (workoutState.current === WorkoutStates.RESTING) {
        SessionStateManager.stopTimer('rest');
        completeRest();
        showToast('Repos ignoré', 'info');
    }
}

function addRestTime(seconds) {
    if (workoutState.current === WorkoutStates.RESTING) {
        SessionStateManager.stopTimer('rest');
        const currentTimeText = document.getElementById('restTimer').textContent;
        const [mins, secs] = currentTimeText.split(':').map(Number);
        const currentTime = mins * 60 + secs;
        startRestPeriod(currentTime + seconds);
        showToast(`+${seconds} secondes ajoutées`, 'info');
    }
}

function endRest() {
    if (workoutState.current === WorkoutStates.RESTING) {
        SessionStateManager.stopTimer('rest');
        completeRest();
    }
}

// ===== GESTION DES SÉRIES ET NAVIGATION =====
function previousSet() {
    if (currentSet <= 1) return;
    
    if ([WorkoutStates.RESTING, WorkoutStates.FEEDBACK].includes(workoutState.current)) {
        if (!confirm('Voulez-vous vraiment revenir à la série précédente ?')) {
            return;
        }
    }
    
    currentSet--;
    currentWorkoutSession.currentSetNumber = currentSet;
    
    SessionStateManager.stopAllTimers();
    StateTransitionManager.transition(WorkoutStates.READY);
    
    // Recharger les données de la série précédente si elle existe
    const previousSetData = currentWorkoutSession.completedSets.find(
        s => s.exercise_id === currentExercise.id && s.set_number === currentSet
    );
    
    if (previousSetData) {
        document.getElementById('setWeight').value = previousSetData.weight || '';
        document.getElementById('setReps').value = previousSetData.reps || '';
    }
}

function changeExercise() {
    if (currentWorkoutSession.type === 'program') {
        showProgramExerciseList();
        return;
    }
    
    // Vérifier l'état actuel
    if ([WorkoutStates.EXECUTING, WorkoutStates.FEEDBACK, WorkoutStates.RESTING].includes(workoutState.current)) {
        if (!confirm('Une série est en cours. Voulez-vous vraiment changer d\'exercice ?')) {
            return;
        }
    }
    
    if (currentExercise && currentWorkoutSession.type === 'program') {
        saveCurrentExerciseState();
    }
    
    showExerciseSelection();
}

function showExerciseSelection() {
    document.getElementById('exerciseSelection').style.display = 'block';
    document.getElementById('currentExercise').style.display = 'none';
    currentExercise = null;
    currentSet = 1;
    StateTransitionManager.transition(WorkoutStates.IDLE);
    loadAvailableExercises();
}

function showSetCompletionOptions() {
    const completedSets = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id === currentExercise.id
    ).length;
    
    const modalContent = `
        <div style="text-align: center;">
            <p>${completedSets} séries de ${currentExercise.name} complétées</p>
            <p>Temps de repos total: ${formatTime(currentWorkoutSession.totalRestTime)}</p>
            <div style="display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <button class="btn btn-secondary" onclick="handleExtraSet(); closeModal();">
                    Série supplémentaire
                </button>
                <button class="btn btn-primary" onclick="finishExercise(); closeModal();">
                    ${currentWorkout.type === 'free' ? 'Changer d\'exercice' : 'Exercice suivant'}
                </button>
                <button class="btn btn-danger" onclick="endWorkout(); closeModal();">
                    Terminer la séance
                </button>
            </div>
        </div>
    `;
    showModal('Exercice terminé', modalContent);
}

function handleExtraSet() {
    // Vérifier qu'on n'a pas déjà des séries non complétées
    const completedForExercise = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id === currentExercise.id
    ).length;
    
    if (completedForExercise < currentWorkoutSession.totalSets) {
        showToast(`Il reste ${currentWorkoutSession.totalSets - completedForExercise} série(s) à faire`, 'warning');
        return;
    }
    
    if (currentWorkoutSession.totalSets >= currentWorkoutSession.maxSets) {
        showToast('Nombre maximum de séries atteint', 'warning');
        return;
    }
    
    currentWorkoutSession.totalSets++;
    currentSet = currentWorkoutSession.totalSets;
    currentWorkoutSession.currentSetNumber = currentSet;
    
    if (currentWorkoutSession.type === 'program' && currentExercise) {
        const exerciseState = currentWorkoutSession.programExercises[currentExercise.id];
        if (exerciseState) {
            exerciseState.totalSets = currentWorkoutSession.totalSets;
            exerciseState.isCompleted = false;
        }
    }
    
    StateTransitionManager.transition(WorkoutStates.READY);
    SessionStateManager.updateCounters();
    
    showToast(`Série ${currentSet} ajoutée !`, 'success');
}

function addExtraSet() {
    handleExtraSet();
}

function finishExercise() {
    if (currentExercise && currentWorkoutSession.type === 'program') {
        saveCurrentExerciseState();
    }
    
    SessionStateManager.stopTimer('set');
    
    if (currentWorkout.type === 'free') {
        showExerciseSelection();
    } else {
        // PROGRAMME: trouver le prochain exercice
        const currentIndex = currentWorkoutSession.programExercises[currentExercise.id].index;
        const nextExerciseData = currentWorkoutSession.program.exercises[currentIndex + 1];
        
        if (nextExerciseData) {
            selectProgramExercise(nextExerciseData.exercise_id);
        } else {
            // Tous les exercices sont terminés
            showModal('Programme complété ! 🎉', `
                <div style="text-align: center;">
                    <p style="font-size: 1.2rem; margin-bottom: 2rem;">
                        Félicitations ! Vous avez terminé tous les exercices !
                    </p>
                    <button class="btn btn-primary" onclick="endWorkout(); closeModal();">
                        Terminer la séance
                    </button>
                </div>
            `);
        }
    }
}

// ===== GESTION PROGRAMME =====
async function selectProgramExercise(exerciseId, isInitialLoad = false) {
    if (!currentWorkoutSession.program) return;
    
    if (!isInitialLoad) {
        const needsConfirmation = [
            WorkoutStates.EXECUTING,
            WorkoutStates.FEEDBACK,
            WorkoutStates.RESTING
        ].includes(workoutState.current);
        
        if (needsConfirmation) {
            const messages = {
                [WorkoutStates.EXECUTING]: 'Une série est en cours.',
                [WorkoutStates.FEEDBACK]: 'Vous n\'avez pas terminé le feedback.',
                [WorkoutStates.RESTING]: 'Vous êtes en période de repos.'
            };
            
            if (!confirm(`${messages[workoutState.current]} Voulez-vous vraiment changer d'exercice ?`)) {
                return;
            }
        }
        
        if (currentExercise) {
            await saveCurrentExerciseState();
            SessionStateManager.updateCounters();
        }
    }
    
    SessionStateManager.stopAllTimers();
    
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const newExercise = exercises.find(ex => ex.id === exerciseId);
        
        if (!newExercise) {
            showToast('Exercice non trouvé', 'error');
            return;
        }
        
        currentWorkoutSession.type = 'program';
        
        const exerciseState = currentWorkoutSession.programExercises[exerciseId];
        exerciseState.startTime = exerciseState.startTime || new Date();
        
        const exerciseObj = {
            id: newExercise.id,
            name: newExercise.name,
            instructions: newExercise.instructions,
            base_rest_time_seconds: exerciseState.restTime || newExercise.base_rest_time_seconds,
            default_reps_min: newExercise.default_reps_min,
            default_reps_max: newExercise.default_reps_max,
            default_sets: exerciseState.totalSets,
            intensity_factor: newExercise.intensity_factor,
            muscle_groups: newExercise.muscle_groups,
            difficulty: newExercise.difficulty
        };
        
        currentSet = exerciseState.completedSets + 1;
        currentWorkoutSession.currentSetNumber = currentSet;
        currentWorkoutSession.exerciseOrder = exerciseState.index + 1;
        currentWorkoutSession.totalSets = exerciseState.totalSets;
        
        await selectExercise(exerciseObj);
        
        document.getElementById('programExercisesContainer').style.display = 'none';
        
        loadProgramExercisesList();
        
        if (!SessionStateManager.timers.workout) {
            startWorkoutTimer();
        }
        
        if (!isInitialLoad) {
            showToast(`Exercice changé : ${newExercise.name}`, 'success');
        }
        
    } catch (error) {
        console.error('Erreur changement exercice:', error);
        showToast('Erreur lors du changement d\'exercice', 'error');
    }
}

async function saveCurrentExerciseState() {
    if (!currentExercise || !currentWorkoutSession.programExercises[currentExercise.id]) return;
    
    const exerciseState = currentWorkoutSession.programExercises[currentExercise.id];
    const completedSetsForThisExercise = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id === currentExercise.id
    ).length;
    
    exerciseState.completedSets = completedSetsForThisExercise;
    exerciseState.endTime = new Date();
    
    if (completedSetsForThisExercise >= exerciseState.totalSets) {
        exerciseState.isCompleted = true;
        currentWorkoutSession.completedExercisesCount++;
    }
}

async function loadProgramExercisesList() {
    if (!currentWorkoutSession.program) return;
    
    const timeline = document.getElementById('exercisesTimeline');
    const progressText = document.getElementById('programProgressText');
    const progressFill = document.getElementById('programProgressFill');
    
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        
        timeline.innerHTML = '';
        
        const completedCount = Object.values(currentWorkoutSession.programExercises)
            .filter(ex => ex.isCompleted).length;
        const totalCount = currentWorkoutSession.program.exercises.length;
        
        progressText.textContent = `${completedCount}/${totalCount} exercices complétés`;
        progressFill.style.width = `${(completedCount / totalCount) * 100}%`;
        
        currentWorkoutSession.program.exercises.forEach((exerciseData, index) => {
            const exercise = exercises.find(ex => ex.id === exerciseData.exercise_id);
            if (!exercise) return;
            
            const exerciseState = currentWorkoutSession.programExercises[exerciseData.exercise_id];
            const isCurrentExercise = currentExercise && currentExercise.id === exerciseData.exercise_id;
            
            const item = document.createElement('div');
            item.className = `exercise-timeline-item ${isCurrentExercise ? 'current' : ''} ${exerciseState.isCompleted ? 'completed' : ''}`;
            item.style.animationDelay = `${index * 0.1}s`;
            item.setAttribute('data-exercise-id', exerciseData.exercise_id);
            
            item.innerHTML = `
                <div class="timeline-connector">${index + 1}</div>
                <div class="exercise-timeline-card" onclick="handleExerciseCardClick(${exerciseData.exercise_id})">
                    ${exerciseState.isCompleted ? '<div class="completed-badge">Terminé</div>' : ''}
                    <div class="exercise-card-content">
                        <div class="exercise-card-top">
                            <div class="exercise-card-info">
                                <div class="exercise-card-name">${exercise.name}</div>
                                <div class="exercise-card-muscles">
                                    ${exercise.muscle_groups.map(muscle => 
                                        `<span class="muscle-chip">${muscle}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            <div class="exercise-card-stats">
                                <div class="sets-progress">${exerciseState.completedSets}/${exerciseState.totalSets}</div>
                                <div class="sets-label">séries</div>
                            </div>
                        </div>
                        <div class="exercise-card-actions">
                            ${isCurrentExercise ? 
                                '<button class="exercise-action-btn primary" disabled>En cours</button>' :
                                exerciseState.isCompleted ?
                                '<button class="exercise-action-btn" onclick="event.stopPropagation(); restartExercise(' + exerciseData.exercise_id + ')">Refaire</button>' :
                                '<button class="exercise-action-btn" onclick="event.stopPropagation(); selectProgramExercise(' + exerciseData.exercise_id + ')">Commencer</button>'
                            }
                        </div>
                    </div>
                </div>
            `;
            
            timeline.appendChild(item);
        });
        
    } catch (error) {
        console.error('Erreur chargement liste exercices programme:', error);
    }
}

function handleExerciseCardClick(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    if (currentExercise && currentExercise.id === exerciseId) {
        showToast('Vous êtes déjà sur cet exercice', 'info');
        return;
    }
    
    if (exerciseState.isCompleted) {
        if (confirm('Cet exercice est déjà terminé. Voulez-vous le refaire ?')) {
            restartExercise(exerciseId);
        }
    } else {
        selectProgramExercise(exerciseId);
    }
}

async function restartExercise(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    exerciseState.completedSets = 0;
    exerciseState.isCompleted = false;
    exerciseState.startTime = new Date();
    exerciseState.endTime = null;
    
    currentWorkoutSession.completedSets = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id !== exerciseId
    );
    
    currentWorkoutSession.completedExercisesCount = Object.values(currentWorkoutSession.programExercises)
        .filter(ex => ex.isCompleted).length;
    
    await selectProgramExercise(exerciseId);
}

function showProgramExerciseList() {
    if (currentWorkoutSession.type === 'program') {
        document.getElementById('currentExercise').style.display = 'none';
        document.getElementById('programExercisesContainer').style.display = 'block';
        loadProgramExercisesList();
    }
}

// ===== FONCTIONS UTILITAIRES SÉANCES =====
async function loadAvailableExercises() {
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const container = document.getElementById('exerciseList');
        
        // Ajouter un filtre par muscle
        const filterHTML = `
            <div class="exercise-filters" style="margin-bottom: 1rem;">
                <select id="muscleFilter" class="form-control" onchange="filterExercises()">
                    <option value="">Tous les muscles</option>
                    ${Object.entries(MUSCLE_GROUPS).map(([key, muscle]) => 
                        `<option value="${key}">${muscle.icon} ${muscle.name}</option>`
                    ).join('')}
                </select>
            </div>
        `;
        
        container.innerHTML = filterHTML + exercises.map(exercise => `
            <div class="exercise-item" data-muscles="${exercise.muscle_groups.join(',')}" 
                 onclick="selectExercise({id: ${exercise.id}, name: '${exercise.name.replace(/'/g, "\\'")}', instructions: '${(exercise.instructions || '').replace(/'/g, "\\'")}', base_rest_time_seconds: ${exercise.base_rest_time_seconds || 60}, default_reps_min: ${exercise.default_reps_min || 8}, default_reps_max: ${exercise.default_reps_max || 12}, default_sets: ${exercise.default_sets || 3}, intensity_factor: ${exercise.intensity_factor || 1.0}, muscle_groups: [${exercise.muscle_groups.map(m => `'${m}'`).join(',')}], difficulty: '${exercise.difficulty || 'Intermédiaire'}' })">
                <h4>${exercise.name}</h4>
                <p>${exercise.muscle_groups.join(', ')} • ${exercise.difficulty}</p>
                <div class="exercise-meta">
                    <span>🎯 ${exercise.default_reps_min}-${exercise.default_reps_max} reps</span>
                    <span>⏱️ ${Math.floor((exercise.base_rest_time_seconds || 60) / 60)}:${((exercise.base_rest_time_seconds || 60) % 60).toString().padStart(2, '0')}</span>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Erreur chargement exercices:', error);
        showToast('Erreur chargement des exercices', 'error');
    }
}

function filterExercises() {
    const filter = document.getElementById('muscleFilter').value;
    const exercises = document.querySelectorAll('.exercise-item');
    
    exercises.forEach(exercise => {
        const muscles = exercise.dataset.muscles;
        const visible = !filter || muscles.includes(filter);
        exercise.style.display = visible ? 'block' : 'none';
    });
}

// ===== RECOMMANDATIONS ET ML =====
async function updateSetRecommendations() {
    if (!currentExercise || !currentWorkout) return;
    
    try {
        const recommendations = await apiPost(
            `/api/workouts/${currentWorkout.id}/recommendations`,
            {
                exercise_id: currentExercise.id,
                set_number: currentSet,
                fatigue_level: currentWorkoutSession.sessionFatigue
            }
        );
        
        // Mettre à jour les champs avec les recommandations
        if (recommendations.weight !== null) {
            document.getElementById('setWeight').value = findClosestAvailableWeight(recommendations.weight);
        }
        
        if (recommendations.reps !== null) {
            document.getElementById('setReps').value = recommendations.reps;
        }
        
        // Afficher le niveau de confiance
        const confidenceEl = document.getElementById('recConfidence');
        if (confidenceEl && recommendations.confidence) {
            confidenceEl.textContent = `Confiance: ${Math.round(recommendations.confidence * 100)}%`;
        }
        
        // Afficher les suggestions d'échauffement pour la première série
        if (currentSet === 1 && recommendations.warmup_sets) {
            showWarmupSuggestions(recommendations.warmup_sets);
        }
        
    } catch (error) {
        console.error('Erreur recommandations ML:', error);
        // Fallback sur des valeurs par défaut
        getSuggestedWeight(currentExercise.id, currentSet);
    }
}

function showWarmupSuggestions(warmupSets) {
    if (!warmupSets || warmupSets.length === 0) return;
    
    const warmupHTML = `
        <div class="warmup-suggestions" style="background: var(--info); color: white; padding: 1rem; border-radius: var(--radius); margin-bottom: 1rem;">
            <h4>Échauffement recommandé :</h4>
            ${warmupSets.map((set, index) => 
                `<p>Série ${index + 1}: ${set.weight}kg × ${set.reps} reps</p>`
            ).join('')}
        </div>
    `;
    
    const container = document.querySelector('.workout-content');
    const existingWarmup = container.querySelector('.warmup-suggestions');
    if (existingWarmup) {
        existingWarmup.remove();
    }
    
    container.insertAdjacentHTML('afterbegin', warmupHTML);
}

async function getSuggestedWeight(exerciseId, setNumber) {
    if (!currentUser || !currentWorkoutSession.availableWeights.length) return null;
    
    try {
        // Chercher l'historique récent de cet exercice
        const recentSets = currentWorkoutSession.completedSets
            .filter(s => s.exercise_id === exerciseId)
            .slice(-3);
        
        if (recentSets.length > 0) {
            // Calculer la moyenne des poids récents
            const avgWeight = recentSets.reduce((sum, set) => sum + set.weight, 0) / recentSets.length;
            
            // Ajuster selon le numéro de série (dégressif)
            let suggestedWeight = avgWeight * (1 - (setNumber - 1) * 0.05);
            
            return findClosestAvailableWeight(suggestedWeight);
        }
        
        // Sinon, utiliser une estimation basée sur le poids corporel
        const bodyWeight = currentUser.weight;
        let baseWeight = bodyWeight * 0.3; // 30% du poids corporel comme base
        
        // Ajuster selon le type d'exercice
        if (currentExercise.muscle_groups?.includes('jambes')) {
            baseWeight *= 1.5; // Les jambes sont plus fortes
        } else if (currentExercise.muscle_groups?.includes('bras')) {
            baseWeight *= 0.5; // Les bras sont plus faibles
        }
        
        return findClosestAvailableWeight(baseWeight);
        
    } catch (error) {
        console.error('Erreur calcul poids suggéré:', error);
        return null;
    }
}

function findClosestAvailableWeight(targetWeight) {
    const weights = currentWorkoutSession.availableWeights;
    if (!weights || weights.length === 0) return targetWeight;
    
    return weights.reduce((closest, weight) => {
        return Math.abs(weight - targetWeight) < Math.abs(closest - targetWeight) ? weight : closest;
    });
}

async function loadUserAvailableWeights() {
    if (!currentUser) return;
    
    try {
        const response = await apiGet(`/api/users/${currentUser.id}/available-weights`);
        currentWorkoutSession.availableWeights = response.available_weights || [];
    } catch (error) {
        console.error('Erreur chargement poids disponibles:', error);
        currentWorkoutSession.availableWeights = [];
    }
}

// ===== AJUSTEMENT DES POIDS =====
function adjustWeightUp() {
    if (!validateSessionState()) return;
    
    const weightInput = document.getElementById('setWeight');
    const currentWeight = parseFloat(weightInput.value) || 0;
    const availableWeights = currentWorkoutSession.availableWeights;
    
    if (availableWeights && availableWeights.length > 0) {
        const nextWeight = availableWeights.find(w => w > currentWeight);
        if (nextWeight) {
            weightInput.value = nextWeight;
        } else {
            showToast('Poids maximum atteint', 'info');
        }
    } else {
        // Fallback : augmenter de 2.5kg
        weightInput.value = currentWeight + 2.5;
    }
}

function adjustWeightDown() {
    if (!validateSessionState()) return;
    
    const weightInput = document.getElementById('setWeight');
    const currentWeight = parseFloat(weightInput.value) || 0;
    const availableWeights = currentWorkoutSession.availableWeights;
    
    if (availableWeights && availableWeights.length > 0) {
        const prevWeight = availableWeights.reverse().find(w => w < currentWeight);
        availableWeights.reverse(); // Remettre dans l'ordre
        if (prevWeight !== undefined) {
            weightInput.value = prevWeight;
        } else if (currentWeight > 0) {
            weightInput.value = 0; // Poids du corps
        }
    } else {
        // Fallback : diminuer de 2.5kg
        if (currentWeight >= 2.5) {
            weightInput.value = currentWeight - 2.5;
        } else {
            weightInput.value = 0;
        }
    }
}

function adjustReps(delta) {
    const repsInput = document.getElementById('setReps');
    const current = parseInt(repsInput.value) || 0;
    repsInput.value = Math.max(1, current + delta);
}

// ===== GESTION DE LA FATIGUE =====
function setSessionFatigue(value) {
    currentWorkoutSession.sessionFatigue = value;
    
    // Mettre à jour l'affichage
    document.querySelectorAll('.fatigue-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (parseInt(btn.dataset.value) === value) {
            btn.classList.add('selected');
        }
    });
    
    // Adapter le programme si nécessaire
    if (currentWorkoutSession.type === 'program') {
        adaptProgramToFatigue();
    }
    
    showToast(`Fatigue de session: ${value}/5`, 'info');
}

function adaptProgramToFatigue() {
    if (currentWorkoutSession.sessionFatigue >= 4) {
        // Réduire le volume restant si très fatigué
        showModal('Fatigue élevée détectée', `
            <p>Votre niveau de fatigue est élevé (${currentWorkoutSession.sessionFatigue}/5).</p>
            <p>Voulez-vous adapter le programme ?</p>
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1rem;">
                <button class="btn btn-primary" onclick="reduceProgramVolume(); closeModal();">
                    Réduire le volume
                </button>
                <button class="btn btn-secondary" onclick="closeModal();">
                    Continuer normalement
                </button>
            </div>
        `);
    }
}

function reduceProgramVolume() {
    // Réduire d'une série tous les exercices restants
    Object.values(currentWorkoutSession.programExercises).forEach(exercise => {
        if (!exercise.isCompleted) {
            exercise.totalSets = Math.max(1, exercise.totalSets - 1);
        }
    });
    
    showToast('Volume adapté à votre fatigue', 'success');
}

function selectFatigue(button, value) {
    document.querySelectorAll('.emoji-btn[data-fatigue]').forEach(btn => {
        btn.classList.remove('selected');
        btn.style.backgroundColor = '';
    });
    
    button.classList.add('selected');
    currentWorkoutSession.currentSetFatigue = value;
    
    const colors = ['#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444'];
    button.style.backgroundColor = colors[value - 1];
    
    if (document.querySelector('.emoji-btn[data-effort].selected')) {
        validateSet();
    }
}

function selectEffort(button, value) {
    document.querySelectorAll('.emoji-btn[data-effort]').forEach(btn => {
        btn.classList.remove('selected');
        btn.style.backgroundColor = '';
    });
    
    button.classList.add('selected');
    currentWorkoutSession.currentSetEffort = value;
    
    const colors = ['#3b82f6', '#06b6d4', '#10b981', '#f97316', '#dc2626'];
    button.style.backgroundColor = colors[value - 1];
    
    if (document.querySelector('.emoji-btn[data-fatigue].selected')) {
        validateSet();
    }
}

// ===== ANALYTICS ET INSIGHTS =====
function calculateAdaptiveRestTime(exercise, fatigue, effort, setNumber) {
    let baseRest = exercise.base_rest_time_seconds || 60;
    
    // Ajustement selon l'intensité de l'exercice
    baseRest *= (exercise.intensity_factor || 1.0);
    
    // Ajustement selon la fatigue
    const fatigueMultiplier = {
        1: 0.8,  // Très frais = moins de repos
        2: 0.9,
        3: 1.0,  // Normal
        4: 1.2,
        5: 1.4   // Très fatigué = plus de repos
    }[fatigue] || 1.0;
    
    // Ajustement selon l'effort
    const effortMultiplier = {
        1: 0.8,  // Très facile = moins de repos
        2: 0.9,
        3: 1.0,  // Modéré
        4: 1.3,
        5: 1.5   // Échec = beaucoup plus de repos
    }[effort] || 1.0;
    
    // Plus de repos pour les séries avancées
    const setMultiplier = 1 + (setNumber - 1) * 0.1;
    
    const finalRest = Math.round(baseRest * fatigueMultiplier * effortMultiplier * setMultiplier);
    
    // Limites raisonnables
    return Math.max(30, Math.min(300, finalRest));
}

function calculateEstimated1RM(weight, reps) {
    // Formule d'Epley
    if (reps === 1) return weight;
    return weight * (1 + reps / 30);
}

async function analyzeSetPerformance(setData) {
    try {
        const analysis = await apiPost('/api/analytics/set-performance', setData);
        
        if (analysis.feedback) {
            showToast(analysis.feedback, analysis.quality > 0.7 ? 'success' : 'warning');
        }
        
        return analysis;
    } catch (error) {
        console.error('Erreur analyse performance:', error);
        return null;
    }
}

function analyzeMuscleSymmetry(workoutHistory) {
    const muscleWork = {};
    
    // Compter le volume par groupe musculaire
    workoutHistory.forEach(set => {
        const exercise = set.exercise;
        if (exercise && exercise.muscle_groups) {
            exercise.muscle_groups.forEach(muscle => {
                if (!muscleWork[muscle]) muscleWork[muscle] = 0;
                muscleWork[muscle] += set.weight * set.reps;
            });
        }
    });
    
    // Détecter les déséquilibres
    const imbalances = [];
    
    // Gauche/Droite (si applicable)
    const leftRight = ['biceps_gauche', 'biceps_droit', 'quadriceps_gauche', 'quadriceps_droit'];
    // ... logique de détection
    
    return imbalances;
}

async function checkSafeWeight(weight, exercise) {
    // Récupérer l'historique récent
    const recentSets = currentWorkoutSession.completedSets
        .filter(s => s.exercise_id === exercise.id)
        .slice(-5);
    
    if (recentSets.length === 0) {
        return { safe: true };
    }
    
    const maxRecentWeight = Math.max(...recentSets.map(s => s.weight));
    const increase = (weight - maxRecentWeight) / maxRecentWeight;
    
    if (increase > 0.1) { // Plus de 10% d'augmentation
        return {
            safe: false,
            message: `Attention ! Vous augmentez de ${Math.round(increase * 100)}%. Êtes-vous sûr ?`
        };
    }
    
    return { safe: true };
}

function detectOvertraining() {
    if (currentWorkoutSession.completedSets.length < 5) return;
    
    const recentFatigue = currentWorkoutSession.completedSets
        .slice(-5)
        .map(s => s.fatigue_level)
        .reduce((a, b) => a + b, 0) / 5;
    
    if (recentFatigue >= 4.5) {
        showModal('Fatigue excessive détectée', `
            <p>Votre fatigue moyenne sur les 5 dernières séries est très élevée (${recentFatigue.toFixed(1)}/5).</p>
            <p>Il est recommandé de :</p>
            <ul>
                <li>Terminer la séance</li>
                <li>Bien vous hydrater</li>
                <li>Prévoir au moins 48h de repos</li>
            </ul>
            <button class="btn btn-primary" onclick="closeModal()">Compris</button>
        `);
    }
}

// ===== FIN DE SÉANCE =====
function pauseWorkout() {
    if (workoutState.current === WorkoutStates.PAUSED) {
        resumeWorkout();
        return;
    }
    
    workoutState.pausedFrom = workoutState.current;
    workoutState.current = WorkoutStates.PAUSED;
    
    SessionStateManager.stopAllTimers();
    showToast('Séance en pause', 'info');
    
    // Afficher un indicateur de pause
    const pauseIndicator = document.createElement('div');
    pauseIndicator.id = 'pauseIndicator';
    pauseIndicator.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 2rem;
        border-radius: var(--radius);
        z-index: 1000;
    `;
    pauseIndicator.innerHTML = `
        <h3>⏸️ Séance en pause</h3>
        <button class="btn btn-primary" onclick="pauseWorkout()">Reprendre</button>
    `;
    document.body.appendChild(pauseIndicator);
}

function resumeWorkout() {
    const pauseIndicator = document.getElementById('pauseIndicator');
    if (pauseIndicator) pauseIndicator.remove();
    
    const fromState = workoutState.pausedFrom;
    workoutState.current = fromState;
    
    // Redémarrer les timers appropriés
    startWorkoutTimer();
    
    if (fromState === WorkoutStates.READY || fromState === WorkoutStates.EXECUTING) {
        startSetTimer();
    } else if (fromState === WorkoutStates.RESTING) {
        // Reprendre le repos où on l'a laissé
        const restTimeEl = document.getElementById('restTimer');
        if (restTimeEl) {
            const [mins, secs] = restTimeEl.textContent.split(':').map(Number);
            startRestPeriod(mins * 60 + secs);
        }
    }
    
    showToast('Séance reprise', 'success');
}

function abandonWorkout() {
    if (!confirm('Êtes-vous sûr de vouloir abandonner cette séance ? Les données seront perdues.')) {
        return;
    }
    
    SessionStateManager.stopAllTimers();
    
    apiPut(`/api/workouts/${currentWorkout.id}`, { status: 'abandoned' })
        .then(() => {
            clearWorkoutState();
            showView('dashboard');
            showToast('Séance abandonnée', 'info');
        })
        .catch(error => {
            console.error('Erreur abandon séance:', error);
            showToast('Erreur lors de l\'abandon', 'error');
        });
}

function abandonCurrentSet() {
    if (workoutState.current !== WorkoutStates.EXECUTING) return;
    
    if (confirm('Abandonner cette série ?')) {
        workoutState.pendingSetData = null;
        StateTransitionManager.transition(WorkoutStates.READY);
        showToast('Série abandonnée', 'info');
    }
}

function endWorkout() {
    SessionStateManager.stopAllTimers();
    
    const stats = calculateSessionStats();
    
    apiPut(`/api/workouts/${currentWorkout.id}`, { 
        status: 'completed',
        total_duration_minutes: Math.floor((new Date() - new Date(currentWorkout.started_at)) / 60000),
        total_volume_kg: stats.totalVolume,
        total_sets: stats.totalSets
    })
        .then(() => {
            StateTransitionManager.transition(WorkoutStates.COMPLETED);
            clearWorkoutState();
        })
        .catch(error => {
            console.error('Erreur fin séance:', error);
            showToast('Erreur lors de la fin de séance', 'error');
        });
}

function calculateSessionStats() {
    const stats = {
        totalSets: currentWorkoutSession.completedSets.length,
        totalVolume: 0,
        averageFatigue: 0,
        averageEffort: 0,
        exercisesCount: new Set(currentWorkoutSession.completedSets.map(s => s.exercise_id)).size,
        maxWeight: 0,
        totalReps: 0
    };
    
    if (stats.totalSets > 0) {
        stats.totalVolume = currentWorkoutSession.completedSets.reduce((total, set) => {
            return total + ((set.weight || 0) * set.reps);
        }, 0);
        
        stats.averageFatigue = currentWorkoutSession.completedSets.reduce((sum, set) => {
            return sum + (set.fatigue_level || 0);
        }, 0) / stats.totalSets;
        
        stats.averageEffort = currentWorkoutSession.completedSets.reduce((sum, set) => {
            return sum + (set.effort_level || 0);
        }, 0) / stats.totalSets;
        
        stats.maxWeight = Math.max(...currentWorkoutSession.completedSets.map(s => s.weight || 0));
        stats.totalReps = currentWorkoutSession.completedSets.reduce((sum, set) => sum + set.reps, 0);
    }
    
    return stats;
}

function showSessionSummary() {
    const stats = calculateSessionStats();
    const duration = Math.floor((new Date() - new Date(currentWorkout.started_at)) / 60000);
    
    showModal('Résumé de la séance', `
        <div class="session-summary">
            <h3 style="text-align: center; margin-bottom: 2rem;">Excellent travail ! 💪</h3>
            
            <div class="summary-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                <div class="summary-stat">
                    <div class="stat-value">${stats.totalSets}</div>
                    <div class="stat-label">Séries totales</div>
                </div>
                <div class="summary-stat">
                    <div class="stat-value">${Math.round(stats.totalVolume)}kg</div>
                    <div class="stat-label">Volume total</div>
                </div>
                <div class="summary-stat">
                    <div class="stat-value">${stats.exercisesCount}</div>
                    <div class="stat-label">Exercices</div>
                </div>
                <div class="summary-stat">
                    <div class="stat-value">${duration}min</div>
                    <div class="stat-label">Durée totale</div>
                </div>
                <div class="summary-stat">
                    <div class="stat-value">${stats.totalReps}</div>
                    <div class="stat-label">Répétitions</div>
                </div>
                <div class="summary-stat">
                    <div class="stat-value">${stats.maxWeight}kg</div>
                    <div class="stat-label">Poids max</div>
                </div>
            </div>
            
            <div class="summary-feedback" style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--radius); margin-bottom: 2rem;">
                <p>Fatigue moyenne: ${stats.averageFatigue.toFixed(1)}/5</p>
                <p>Effort moyen: ${stats.averageEffort.toFixed(1)}/5</p>
            </div>
            
            <div style="text-align: center;">
                <p style="margin-bottom: 1rem;">${getMotivationalMessage(stats)}</p>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button class="btn btn-secondary" onclick="shareWorkoutSummary(${JSON.stringify(stats).replace(/"/g, '&quot;')}); closeModal();">
                        Partager
                    </button>
                    <button class="btn btn-primary" onclick="closeModal(); showView('dashboard');">
                        Retour au dashboard
                    </button>
                </div>
            </div>
        </div>
    `);
}

function getMotivationalMessage(stats) {
    if (stats.averageEffort > 4.5) {
        return "Séance intense ! Assurez-vous de bien récupérer 💪";
    } else if (stats.totalVolume > 5000) {
        return "Volume impressionnant ! Vous progressez bien 🚀";
    } else if (stats.exercisesCount >= 5) {
        return "Séance complète ! Tous les muscles ont travaillé 💯";
    } else {
        return "Bon travail ! Continuez comme ça 👏";
    }
}

// ===== STATISTIQUES ET PROFIL =====
async function loadStats() {
    try {
        const [stats, progress, records] = await Promise.all([
            apiGet(`/api/users/${currentUser.id}/stats`),
            apiGet(`/api/users/${currentUser.id}/progress?days=30`),
            apiGet(`/api/users/${currentUser.id}/personal-records`)
        ]);
        
        const content = document.getElementById('statsContent');
        
        content.innerHTML = `
            <div class="stats-overview">
                <h3>Vue d'ensemble</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">${stats.total_workouts}</div>
                        <div class="stat-label">Séances totales</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${Math.round(stats.total_volume_kg)}kg</div>
                        <div class="stat-label">Volume total soulevé</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${stats.total_sets}</div>
                        <div class="stat-label">Séries totales</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${Math.round(stats.avg_workout_duration)}min</div>
                        <div class="stat-label">Durée moyenne</div>
                    </div>
                </div>
            </div>
            
            <div class="progress-section">
                <h3>Progression (30 derniers jours)</h3>
                <canvas id="progressChart" width="400" height="200"></canvas>
            </div>
            
            <div class="records-section">
                <h3>Records personnels</h3>
                ${records && records.length > 0 ? 
                    records.map(record => `
                        <div class="record-item">
                            <h4>${record.exercise_name}</h4>
                            <p>${record.max_weight}kg × ${record.reps} reps (1RM: ${calculateEstimated1RM(record.max_weight, record.reps).toFixed(1)}kg)</p>
                            <small>${formatDate(new Date(record.achieved_at))}</small>
                        </div>
                    `).join('') :
                    '<p>Aucun record enregistré</p>'
                }
            </div>
            
            <div class="actions-section" style="margin-top: 2rem;">
                <button class="btn btn-secondary" onclick="exportWorkoutData()">
                    Exporter les données
                </button>
            </div>
        `;
        
        // Afficher le graphique de progression
        if (progress && progress.length > 0) {
            renderProgressChart(progress);
        }
        
    } catch (error) {
        console.error('Erreur chargement stats:', error);
        showToast('Erreur chargement des statistiques', 'error');
    }
}

function renderProgressChart(progressData) {
    const ctx = document.getElementById('progressChart');
    if (!ctx) return;
    
    // Simple visualization avec canvas
    const canvas = ctx.getContext('2d');
    const width = ctx.width;
    const height = ctx.height;
    
    // Clear canvas
    canvas.clearRect(0, 0, width, height);
    
    // Draw axes
    canvas.beginPath();
    canvas.moveTo(40, 10);
    canvas.lineTo(40, height - 30);
    canvas.lineTo(width - 10, height - 30);
    canvas.stroke();
    
    // Plot data
    if (progressData.length > 0) {
        const maxVolume = Math.max(...progressData.map(d => d.total_volume || 0));
        const xStep = (width - 60) / (progressData.length - 1);
        const yScale = (height - 50) / maxVolume;
        
        canvas.beginPath();
        canvas.strokeStyle = 'var(--primary)';
        canvas.lineWidth = 2;
        
        progressData.forEach((point, index) => {
            const x = 40 + index * xStep;
            const y = height - 30 - (point.total_volume * yScale);
            
            if (index === 0) {
                canvas.moveTo(x, y);
            } else {
                canvas.lineTo(x, y);
            }
            
            // Draw point
            canvas.fillStyle = 'var(--primary)';
            canvas.beginPath();
            canvas.arc(x, y, 3, 0, 2 * Math.PI);
            canvas.fill();
        });
        
        canvas.stroke();
    }
}

async function loadProfile() {
    if (!currentUser) return;
    
    const age = new Date().getFullYear() - new Date(currentUser.birth_date).getFullYear();
    const bmi = (currentUser.weight / Math.pow(currentUser.height / 100, 2)).toFixed(1);
    
    document.getElementById('profileName').textContent = currentUser.name;
    document.getElementById('profileAge').textContent = `${age} ans`;
    document.getElementById('profileHeight').textContent = `${currentUser.height} cm`;
    document.getElementById('profileWeight').textContent = `${currentUser.weight} kg`;
    
    // Ajouter l'IMC
    const bmiEl = document.getElementById('profileBMI');
    if (bmiEl) {
        bmiEl.textContent = `IMC: ${bmi}`;
    }
    
    // Afficher le niveau d'expérience
    const expEl = document.getElementById('profileExperience');
    if (expEl) {
        const levels = {
            beginner: 'Débutant',
            intermediate: 'Intermédiaire',
            advanced: 'Avancé'
        };
        expEl.textContent = `Niveau: ${levels[currentUser.experience_level] || 'Intermédiaire'}`;
    }
}

// ===== GESTION DE L'ÉQUIPEMENT =====
function editEquipment() {
    showModal('Modifier l\'équipement', `
        <div id="equipmentEditModal">
            <p>Configuration actuelle :</p>
            <div id="currentEquipmentList" style="max-height: 300px; overflow-y: auto; margin: 1rem 0;">
                ${renderCurrentEquipment()}
            </div>
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <button class="btn btn-secondary" onclick="toggleModalEquipment()">
                    Modifier
                </button>
                <button class="btn btn-primary" onclick="closeModal()">
                    Fermer
                </button>
            </div>
        </div>
    `);
}

function renderCurrentEquipment() {
    if (!currentUser || !currentUser.equipment_config) {
        return '<p>Aucun équipement configuré</p>';
    }
    
    const config = currentUser.equipment_config;
    let html = '<ul style="list-style: none; padding: 0;">';
    
    Object.entries(config).forEach(([key, value]) => {
        if (value.available) {
            const equipment = EQUIPMENT_CONFIG[key];
            html += `<li style="margin: 0.5rem 0;">${equipment.icon} ${equipment.name}`;
            
            // Détails spécifiques selon le type
            if (value.weight) {
                html += ` (${value.weight}kg)`;
            }
            if (value.weights && Array.isArray(value.weights)) {
                html += ` - Poids: ${value.weights.join(', ')}kg`;
            }
            if (value.count) {
                html += ` × ${value.count}`;
            }
            
            html += '</li>';
        }
    });
    
    html += '</ul>';
    return html;
}

function toggleModalEquipment() {
    // Créer une interface pour modifier l'équipement
    const modalContent = document.getElementById('equipmentEditModal');
    
    modalContent.innerHTML = `
        <h4>Sélectionnez votre équipement :</h4>
        <div class="equipment-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; max-height: 400px; overflow-y: auto;">
            ${Object.entries(EQUIPMENT_CONFIG).map(([key, config]) => {
                const isSelected = currentUser.equipment_config[key]?.available || false;
                return `
                    <div class="equipment-card ${isSelected ? 'selected' : ''}" 
                         data-equipment="${key}"
                         onclick="this.classList.toggle('selected')"
                         style="padding: 1rem; border: 2px solid var(--border); border-radius: var(--radius); cursor: pointer;">
                        <div class="equipment-icon" style="font-size: 2rem; text-align: center;">${config.icon}</div>
                        <div class="equipment-name" style="text-align: center; margin-top: 0.5rem;">${config.name}</div>
                    </div>
                `;
            }).join('')}
        </div>
        <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
            <button class="btn btn-primary" onclick="saveEquipmentChanges()">
                Sauvegarder
            </button>
            <button class="btn btn-secondary" onclick="editEquipment()">
                Annuler
            </button>
        </div>
    `;
}

async function saveEquipmentChanges() {
    const selectedCards = document.querySelectorAll('#equipmentEditModal .equipment-card.selected');
    const newConfig = {};
    
    selectedCards.forEach(card => {
        const equipment = card.dataset.equipment;
        newConfig[equipment] = { available: true };
        
        // Pour une configuration complète, il faudrait ouvrir l'onboarding
        // ou créer une interface détaillée ici
    });
    
    try {
        // Mettre à jour l'utilisateur
        const updatedUser = await apiPut(`/api/users/${currentUser.id}`, {
            equipment_config: newConfig
        });
        
        currentUser = updatedUser;
        await loadUserAvailableWeights();
        
        showToast('Équipement mis à jour', 'success');
        closeModal();
        
    } catch (error) {
        console.error('Erreur mise à jour équipement:', error);
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

// ===== EXPORT ET PARTAGE =====
function exportWorkoutData(format = 'json') {
    showModal('Exporter les données', `
        <p>Choisissez le format d'export :</p>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin: 2rem 0;">
            <button class="btn btn-primary" onclick="performExport('json')">
                📄 JSON (données complètes)
            </button>
            <button class="btn btn-primary" onclick="performExport('csv')">
                📊 CSV (tableur)
            </button>
            <button class="btn btn-primary" onclick="performExport('pdf')">
                📑 PDF (rapport)
            </button>
        </div>
        <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
    `);
}

async function performExport(format) {
    try {
        showToast('Préparation de l\'export...', 'info');
        
        const response = await apiGet(`/api/users/${currentUser.id}/export?format=${format}`);
        
        // Créer un lien de téléchargement
        const blob = new Blob([JSON.stringify(response)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fitness-data-${currentUser.name}-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Export réussi !', 'success');
        closeModal();
        
    } catch (error) {
        console.error('Erreur export:', error);
        showToast('Erreur lors de l\'export', 'error');
    }
}

function shareWorkoutSummary(stats) {
    const text = `J'ai complété une séance fitness ! 💪
${stats.totalSets} séries | ${Math.round(stats.totalVolume)}kg soulevés | ${stats.exercisesCount} exercices`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Ma séance fitness',
            text: text,
            url: window.location.origin
        }).catch(err => console.log('Erreur partage:', err));
    } else {
        // Fallback : copier dans le presse-papiers
        navigator.clipboard.writeText(text)
            .then(() => showToast('Résumé copié !', 'success'))
            .catch(() => showToast('Erreur de copie', 'error'));
    }
}

// ===== GESTION HISTORIQUE =====
async function clearHistory() {
    if (!confirm('Voulez-vous vraiment supprimer tout votre historique ?')) return;
    
    if (!confirm('Cette action est IRRÉVERSIBLE. Êtes-vous vraiment sûr ?')) return;
    
    try {
        await apiDelete(`/api/users/${currentUser.id}/history`);
        showToast('Historique vidé avec succès', 'success');
        loadDashboard();
    } catch (error) {
        console.error('Erreur suppression historique:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
}

async function deleteProfile() {
    if (!confirm('Êtes-vous sûr de vouloir supprimer définitivement votre profil ? Cette action est irréversible.')) {
        return;
    }
    
    const confirmText = prompt('Tapez "SUPPRIMER" pour confirmer :');
    if (confirmText !== 'SUPPRIMER') {
        return;
    }
    
    try {
        await apiDelete(`/api/users/${currentUser.id}`);
        localStorage.removeItem('fitness_user_id');
        
        // Retirer de la liste des profils
        const profiles = JSON.parse(localStorage.getItem('fitness_profiles') || '[]');
        const index = profiles.indexOf(currentUser.id);
        if (index > -1) {
            profiles.splice(index, 1);
            localStorage.setItem('fitness_profiles', JSON.stringify(profiles));
        }
        
        currentUser = null;
        showToast('Profil supprimé', 'info');
        showHomePage();
        
    } catch (error) {
        console.error('Erreur suppression profil:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
}

// ===== MODALS =====
function showModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// ===== UTILITAIRES =====
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '1rem',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '500',
        zIndex: '1000',
        maxWidth: '300px',
        animation: 'slideIn 0.3s ease'
    });
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    toast.style.background = colors[type] || colors.info;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(date) {
    const now = new Date();
    const diffTime = now - date;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Aujourd\'hui';
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    
    return date.toLocaleDateString('fr-FR');
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Modal
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') {
            closeModal();
        }
    });
    
    // Raccourcis clavier
    document.addEventListener('keydown', (e) => {
        // Espace pour pause/reprise pendant l'entraînement
        if (e.code === 'Space' && currentWorkout) {
            e.preventDefault();
            if (workoutState.current === WorkoutStates.RESTING) {
                skipRest();
            } else if (workoutState.current === WorkoutStates.PAUSED) {
                pauseWorkout();
            }
        }
        
        // Échap pour fermer les modals
        if (e.code === 'Escape') {
            const modal = document.getElementById('modal');
            if (modal.style.display === 'flex') {
                closeModal();
            }
        }
    });
    
    // Gestion du thème
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Protection contre la navigation accidentelle
    window.addEventListener('beforeunload', (e) => {
        if (currentWorkout && currentWorkoutSession.completedSets.length > 0) {
            e.preventDefault();
            e.returnValue = 'Une séance est en cours. Voulez-vous vraiment quitter ?';
            saveWorkoutState();
        }
    });
    
    // Protection contre le retour arrière
    window.addEventListener('popstate', (e) => {
        if (currentWorkout) {
            e.preventDefault();
            showToast('Utilisez les boutons de l\'application', 'warning');
            history.pushState(null, '', location.href);
        }
    });
}

// ===== SONS ET VIBRATIONS =====
function playRestSound(type) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        switch (type) {
            case 'start':
                // Son de début : deux bips courts
                oscillator.frequency.value = 440;
                gainNode.gain.value = 0.3;
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.1);
                
                setTimeout(() => {
                    const osc2 = audioContext.createOscillator();
                    osc2.connect(gainNode);
                    osc2.frequency.value = 440;
                    osc2.start();
                    osc2.stop(audioContext.currentTime + 0.1);
                }, 150);
                break;
                
            case 'warning':
                // Son d'avertissement : trois bips rapides
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        const osc = audioContext.createOscillator();
                        osc.connect(gainNode);
                        osc.frequency.value = 660;
                        gainNode.gain.value = 0.4;
                        osc.start();
                        osc.stop(audioContext.currentTime + 0.1);
                    }, i * 200);
                }
                break;
                
            case 'end':
                // Son de fin : mélodie ascendante
                const frequencies = [523, 659, 784, 1047];
                frequencies.forEach((freq, i) => {
                    setTimeout(() => {
                        const osc = audioContext.createOscillator();
                        osc.connect(gainNode);
                        osc.frequency.value = freq;
                        gainNode.gain.value = 0.5;
                        osc.start();
                        osc.stop(audioContext.currentTime + 0.15);
                    }, i * 100);
                });
                
                vibratePattern([200, 100, 200]);
                break;
        }
    } catch (error) {
        console.log('Erreur audio:', error);
    }
}

function vibratePattern(pattern) {
    if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
    }
}

// ===== GESTION DES ERREURS ET OFFLINE =====
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
    isOnline = true;
    showToast('Connexion rétablie', 'success');
    OfflineManager.sync();
});

window.addEventListener('offline', () => {
    isOnline = false;
    showToast('Mode hors ligne activé', 'warning');
});

// ===== SAUVEGARDE ET RÉCUPÉRATION D'ÉTAT =====
function saveWorkoutState() {
    if (!currentWorkout) return;
    
    const state = {
        workout: currentWorkout,
        currentExercise: currentExercise,
        currentSet: currentSet,
        exerciseOrder: currentWorkoutSession.exerciseOrder,
        globalSetCount: currentWorkoutSession.globalSetCount,
        sessionFatigue: currentWorkoutSession.sessionFatigue,
        completedSets: currentWorkoutSession.completedSets,
        type: currentWorkoutSession.type,
        programExercises: currentWorkoutSession.programExercises,
        completedExercisesCount: currentWorkoutSession.completedExercisesCount,
        totalSets: currentWorkoutSession.totalSets,
        program: currentWorkoutSession.program,
        timestamp: new Date().toISOString()
    };
    
    localStorage.setItem('fitness_workout_state', JSON.stringify(state));
}

function loadWorkoutState() {
    try {
        const savedState = localStorage.getItem('fitness_workout_state');
        if (savedState) {
            const state = JSON.parse(savedState);
            
            // Vérifier que l'état n'est pas trop vieux (24h)
            const stateAge = new Date() - new Date(state.timestamp);
            if (stateAge < 24 * 60 * 60 * 1000) {
                return state;
            }
        }
    } catch (error) {
        console.error('Erreur chargement état séance:', error);
    }
    
    return null;
}

function clearWorkoutState() {
    currentWorkout = null;
    currentExercise = null;
    currentSet = 1;
    
    workoutState = {
        current: WorkoutStates.IDLE,
        exerciseStartTime: null,
        setStartTime: null,
        restStartTime: null,
        pendingSetData: null
    };
    
    currentWorkoutSession = {
        workout: null,
        currentExercise: null,
        currentSetNumber: 1,
        exerciseOrder: 1,
        globalSetCount: 0,
        sessionFatigue: 3,
        completedSets: [],
        type: 'free',
        totalRestTime: 0,
        totalSetTime: 0,
        programExercises: {},
        completedExercisesCount: 0,
        totalSets: 3,
        maxSets: 10,
        availableWeights: []
    };
    
    SessionStateManager.stopAllTimers();
    localStorage.removeItem('fitness_workout_state');
}

function restoreWorkoutSession(state) {
    currentWorkout = state.workout;
    currentExercise = state.currentExercise;
    currentSet = state.currentSet || 1;
    
    currentWorkoutSession = {
        ...currentWorkoutSession,
        ...state,
        workout: state.workout,
        availableWeights: currentWorkoutSession.availableWeights // Garder les poids chargés
    };
    
    showView('workout');
    
    if (currentWorkout.type === 'free') {
        setupFreeWorkout();
        if (currentExercise) {
            selectExercise(currentExercise);
        }
    } else {
        setupProgramWorkout(currentWorkoutSession.program);
        if (currentExercise) {
            document.getElementById('programExercisesContainer').style.display = 'none';
            document.getElementById('currentExercise').style.display = 'block';
        }
    }
    
    showToast('Séance restaurée', 'success');
}

function autoSaveWorkoutState() {
    SessionStateManager.startTimer('autosave', () => {
        if (currentWorkout && workoutState.current !== WorkoutStates.IDLE) {
            saveWorkoutState();
        }
    }, 30000); // Toutes les 30 secondes
}

// ===== NOTIFICATIONS =====
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            showToast('Notifications activées', 'success');
        }
    }
}

function sendNotification(title, body, options = {}) {
    if ('Notification' in window && Notification.permission === 'granted') {
        return new Notification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'fitness-workout',
            vibrate: [200, 100, 200],
            ...options
        });
    }
}

// ===== API AVEC GESTION D'ERREUR AMÉLIORÉE =====
async function apiRequest(url, options = {}) {
    if (!isOnline && !url.includes('health')) {
        throw new Error('Aucune connexion internet');
    }
    
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
                typeof errorData.detail === 'string' ? 
                    errorData.detail : 
                    JSON.stringify(errorData.detail) || `HTTP ${response.status}: ${response.statusText}`
            );
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('Erreur API:', error);
        
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Problème de connexion au serveur');
        }
        if (error.message.includes('404')) {
            throw new Error('Ressource non trouvée');
        }
        if (error.message.includes('500')) {
            throw new Error('Erreur interne du serveur');
        }
        
        throw error;
    }
}

function apiGet(url) {
    return apiRequest(url);
}

function apiPost(url, data) {
    return apiRequest(url, {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

function apiPut(url, data = {}) {
    return apiRequest(url, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

function apiDelete(url) {
    return apiRequest(url, {
        method: 'DELETE'
    });
}

// ===== VALIDATION ET GESTION D'ERREURS =====
function validateSessionState() {
    if (!currentWorkout) {
        console.error('Pas de séance active');
        showToast('Erreur: Aucune séance active', 'error');
        showView('dashboard');
        return false;
    }
    
    if (!currentExercise) {
        console.error('Pas d\'exercice sélectionné');
        showToast('Erreur: Aucun exercice sélectionné', 'error');
        return false;
    }
    
    return true;
}

function updateSetNavigationButtons() {
    const prevBtn = document.getElementById('prevSetBtn');
    const nextBtn = document.getElementById('nextSetBtn');
    const addSetBtn = document.getElementById('addSetBtn');
    
    if (prevBtn) {
        prevBtn.disabled = currentSet <= 1;
    }
    
    if (nextBtn) {
        // Masquer le bouton "suivant" si on n'est pas à la dernière série
        nextBtn.style.display = currentSet >= currentWorkoutSession.totalSets ? 'none' : 'block';
    }
    
    if (addSetBtn) {
        // Afficher le bouton d'ajout de série uniquement à la dernière série
        addSetBtn.style.display = currentSet >= currentWorkoutSession.totalSets ? 'block' : 'none';
        addSetBtn.disabled = currentWorkoutSession.totalSets >= currentWorkoutSession.maxSets;
    }
}

function updateSeriesDots() {
    // Alias pour la fonction dans SessionStateManager
    const exerciseStats = {
        completedSets: currentWorkoutSession.completedSets.filter(
            s => s.exercise_id === currentExercise.id
        ).length,
        totalSets: currentWorkoutSession.totalSets || 3,
        currentSet: currentSet
    };
    
    SessionStateManager.updateSeriesDotsDisplay(exerciseStats);
}

function updateHeaderProgress() {
    SessionStateManager.updateCounters();
}

function updateProgramExerciseProgress() {
    if (currentWorkoutSession.type === 'program') {
        loadProgramExercisesList();
    }
}

// ===== FONCTIONS D'EXPOSITION =====
window.showHomePage = showHomePage;
window.startNewProfile = startNewProfile;
window.loadProfile = loadProfile;
window.showView = showView;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.completeOnboarding = completeOnboarding;
window.startFreeWorkout = startFreeWorkout;
window.startProgramWorkout = startProgramWorkout;
window.selectExercise = selectExercise;
window.editEquipment = editEquipment;
window.clearHistory = clearHistory;
window.deleteProfile = deleteProfile;
window.closeModal = closeModal;
window.toggleModalEquipment = toggleModalEquipment;
window.saveEquipmentChanges = saveEquipmentChanges;
window.resumeWorkout = resumeWorkout;
window.resumeWorkoutById = resumeWorkoutById;

// Fonctions pour l'interface de séance
window.setSessionFatigue = setSessionFatigue;
window.adjustReps = adjustReps;
window.executeSet = executeSet;
window.setFatigue = selectFatigue;
window.setEffort = selectEffort;
window.validateSet = validateSet;
window.previousSet = previousSet;
window.changeExercise = changeExercise;
window.skipRest = skipRest;
window.addRestTime = addRestTime;
window.endRest = endRest;
window.pauseWorkout = pauseWorkout;
window.abandonWorkout = abandonWorkout;
window.abandonCurrentSet = abandonCurrentSet;
window.endWorkout = endWorkout;
window.addExtraSet = addExtraSet;
window.updateSetNavigationButtons = updateSetNavigationButtons;
window.selectFatigue = selectFatigue;
window.selectEffort = selectEffort;
window.adjustWeightUp = adjustWeightUp;
window.adjustWeightDown = adjustWeightDown;
window.updateSeriesDots = updateSeriesDots;
window.handleExtraSet = handleExtraSet;
window.completeRest = completeRest;
window.playRestSound = playRestSound;
window.selectProgramExercise = selectProgramExercise;
window.restartExercise = restartExercise;
window.handleExerciseCardClick = handleExerciseCardClick;
window.showProgramExerciseList = showProgramExerciseList;
window.updateHeaderProgress = updateHeaderProgress;
window.updateProgramExerciseProgress = updateProgramExerciseProgress;
window.finishExercise = finishExercise;
window.filterExercises = filterExercises;
window.toggleTheme = toggleTheme;
window.shareWorkoutSummary = shareWorkoutSummary;
window.performExport = performExport;
window.exportWorkoutData = exportWorkoutData;
window.showConfigurationSummary = showConfigurationSummary;