// ===== FITNESS COACH - APPLICATION PRINCIPALE =====

// ===== ÉTAT GLOBAL =====
let setTimer = null; 
let currentUser = null;
let userFavorites = [];
let currentWorkout = null;
let currentExercise = null;
let currentSet = 1;
let workoutTimer = null;
let restTimer = null;
let notificationTimeout = null;
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
    // MODULE 0 : Nouvelles propriétés
    skipped_exercises: [],  // Liste des exercices skippés
    session_metadata: {},   // Métadonnées de session
    // MODULE 2 : Support du système de swap
    swaps: [],              // [{original_id, new_id, reason, timestamp, sets_before}]
    modifications: [],      // Tracking global des modifications
    pendingSwap: null       // Swap en cours (pour recovery)
};

// ===== MACHINE D'ÉTAT SÉANCE =====
const WorkoutStates = {
    IDLE: 'idle',
    READY: 'ready',          // Prêt pour une série
    EXECUTING: 'executing',   // Série en cours
    FEEDBACK: 'feedback',     // En attente du feedback
    RESTING: 'resting',       // Période de repos
    TRANSITIONING: 'transitioning',
    COMPLETED: 'completed'    // Exercice/séance terminé
};

let workoutState = {
    current: WorkoutStates.IDLE,
    exerciseStartTime: null,
    setStartTime: null,
    restStartTime: null,
    pendingSetData: null
};

function transitionTo(state) {
    // CONSERVER LA LOGIQUE EXISTANTE DE NETTOYAGE DES TIMERS
    switch(workoutState.current) {
        case WorkoutStates.RESTING:
            if (restTimer) {
                clearInterval(restTimer);
                restTimer = null;
            }
            break;
        case WorkoutStates.EXECUTING:
            if (setTimer) {
                clearInterval(setTimer);
                setTimer = null;
            }
            break;
    }
    
    workoutState.current = state;
    
    // Cacher tout par défaut
    const elements = {
        executeBtn: document.getElementById('executeSetBtn'),
        setFeedback: document.getElementById('setFeedback'),
        restPeriod: document.getElementById('restPeriod'),
        inputSection: document.querySelector('.input-section')
    };
    
    // Cacher tous les éléments qui existent
    Object.values(elements).forEach(el => {
        if (el) el.style.display = 'none';
    });
    
    // Afficher selon l'état
    switch(state) {
        case WorkoutStates.READY:
            if (elements.executeBtn) elements.executeBtn.style.display = 'block';
            if (elements.inputSection) elements.inputSection.style.display = 'block';
            break;
            
        case WorkoutStates.FEEDBACK:
            if (elements.setFeedback) elements.setFeedback.style.display = 'block';
            break;
            
        case WorkoutStates.RESTING:
            if (elements.setFeedback) elements.setFeedback.style.display = 'block';
            if (elements.restPeriod) elements.restPeriod.style.display = 'flex';
            break;
            
        case WorkoutStates.COMPLETED:
            // Géré par les fonctions spécifiques
            break;

        case WorkoutStates.TRANSITIONING:
            // État temporaire : tout est masqué
            break;
    }
}

function updateUIForState(state) {
    // CORRECTION: Arrêter tous les timers selon l'état
    switch(state) {
        case WorkoutStates.RESTING:
            // En repos: arrêter le timer de série mais garder le timer global
            if (setTimer) {
                clearInterval(setTimer);
                setTimer = null;
            }
            break;
            
        case WorkoutStates.READY:
            // Prêt: arrêter le repos mais garder le timer global
            if (restTimer) {
                clearInterval(restTimer);
                restTimer = null;
            }
            // CORRECTION: Réinitialiser les sélections de feedback
            resetFeedbackSelection();
            break;
            
        case WorkoutStates.IDLE:
            // Idle: arrêter TOUS les timers
            if (setTimer) {
                clearInterval(setTimer);
                setTimer = null;
            }
            if (restTimer) {
                clearInterval(restTimer);
                restTimer = null;
            }
            break;
    }
    
    // Cacher tout par défaut
    document.getElementById('executeSetBtn').style.display = 'none';
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('restPeriod').style.display = 'none';
    
    // Récupérer le panneau des inputs
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        inputSection.style.display = 'none';
    }
    
    switch(state) {
        case WorkoutStates.READY:
            const executeBtn = document.getElementById('executeSetBtn');
            if (executeBtn) {
                executeBtn.style.display = 'block';
            }
            if (inputSection) inputSection.style.display = 'block';
            break;
            
        case WorkoutStates.FEEDBACK:
            document.getElementById('setFeedback').style.display = 'block';
            break;
            
        case WorkoutStates.RESTING:
            document.getElementById('setFeedback').style.display = 'block';
            document.getElementById('restPeriod').style.display = 'flex';
            break;
            
        case WorkoutStates.COMPLETED:
            // Géré par les fonctions spécifiques
            break;
    }
}


// ===== CONFIGURATION =====
const totalSteps = 5;

// Configuration équipement disponible
const EQUIPMENT_CONFIG = {
    // Barres spécialisées
    barbell_athletic: { 
        name: 'Barre athlétique (20kg)', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="8" y="22" width="32" height="4" rx="2"/>
            <rect x="4" y="20" width="4" height="8" rx="2"/>
            <rect x="40" y="20" width="4" height="8" rx="2"/>
            <circle cx="6" cy="24" r="1"/>
            <circle cx="42" cy="24" r="1"/>
        </svg>`, 
        type: 'barbell', 
        defaultWeight: 20 
    },
    barbell_ez: { 
        name: 'Barre EZ/Curl (10kg)', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <path d="M8 24 Q16 20 24 24 Q32 28 40 24" stroke="currentColor" stroke-width="4" fill="none"/>
            <rect x="4" y="22" width="3" height="4" rx="1"/>
            <rect x="41" y="22" width="3" height="4" rx="1"/>
        </svg>`, 
        type: 'barbell', 
        defaultWeight: 10 
    },
    barbell_short_pair: { 
        name: 'Paire barres courtes', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="6" y="14" width="16" height="3" rx="1"/>
            <rect x="26" y="14" width="16" height="3" rx="1"/>
            <rect x="4" y="12" width="2" height="7" rx="1"/>
            <rect x="22" y="12" width="2" height="7" rx="1"/>
            <rect x="24" y="12" width="2" height="7" rx="1"/>
            <rect x="42" y="12" width="2" height="7" rx="1"/>
            <rect x="6" y="31" width="16" height="3" rx="1"/>
            <rect x="26" y="31" width="16" height="3" rx="1"/>
            <rect x="4" y="29" width="2" height="7" rx="1"/>
            <rect x="22" y="29" width="2" height="7" rx="1"/>
            <rect x="24" y="29" width="2" height="7" rx="1"/>
            <rect x="42" y="29" width="2" height="7" rx="1"/>
        </svg>`, 
        type: 'adjustable', 
        defaultWeight: 2.5 
    },
    
    // Poids fixes et ajustables
    dumbbells: { 
        name: 'Dumbbells fixes', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="18" y="22" width="12" height="4" rx="2"/>
            <rect x="12" y="18" width="6" height="12" rx="3"/>
            <rect x="30" y="18" width="6" height="12" rx="3"/>
            <rect x="10" y="20" width="2" height="8" rx="1"/>
            <rect x="36" y="20" width="2" height="8" rx="1"/>
        </svg>`, 
        type: 'fixed_weights' 
    },
    weight_plates: { 
        name: 'Disques de musculation', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3"/>
            <circle cx="24" cy="24" r="4" fill="currentColor"/>
            <circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="1"/>
            <text x="24" y="28" text-anchor="middle" font-size="8" fill="currentColor">20</text>
        </svg>`, 
        type: 'plates', 
        required_for: ['barbell_athletic', 'barbell_ez', 'barbell_short_pair'] 
    },
    
    // Équipement cardio/fonctionnel
    resistance_bands: { 
        name: 'Élastiques', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <path d="M8 24 Q16 16 24 24 Q32 32 40 24" stroke="currentColor" stroke-width="3" fill="none"/>
            <circle cx="8" cy="24" r="3"/>
            <circle cx="40" cy="24" r="3"/>
            <path d="M8 28 Q16 20 24 28 Q32 36 40 28" stroke="currentColor" stroke-width="2" fill="none" opacity="0.6"/>
        </svg>`, 
        type: 'resistance' 
    },
    kettlebells: { 
        name: 'Kettlebells', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="20" y="12" width="8" height="6" rx="4"/>
            <path d="M16 18 Q16 30 24 32 Q32 30 32 18" fill="currentColor"/>
            <circle cx="24" cy="26" r="8" fill="currentColor"/>
        </svg>`, 
        type: 'fixed_weights' 
    },
    pull_up_bar: { 
        name: 'Barre de traction', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="8" y="12" width="32" height="3" rx="1"/>
            <rect x="6" y="10" width="4" height="8" rx="2"/>
            <rect x="38" y="10" width="4" height="8" rx="2"/>
            <path d="M20 18 Q20 28 24 32 Q28 28 28 18" stroke="currentColor" stroke-width="2" fill="none"/>
            <circle cx="24" cy="32" r="2"/>
        </svg>`, 
        type: 'bodyweight' 
    },
    dip_bar: { 
        name: 'Barre de dips', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="12" y="16" width="8" height="3" rx="1"/>
            <rect x="28" y="16" width="8" height="3" rx="1"/>
            <rect x="10" y="14" width="3" height="8" rx="1"/>
            <rect x="35" y="14" width="3" height="8" rx="1"/>
            <path d="M22 22 Q22 28 24 30 Q26 28 26 22" stroke="currentColor" stroke-width="2" fill="none"/>
            <circle cx="24" cy="30" r="2"/>
        </svg>`, 
        type: 'bodyweight' 
    },
    bench: { 
        name: 'Banc de musculation', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="8" y="20" width="32" height="6" rx="3"/>
            <rect x="6" y="26" width="4" height="12" rx="2"/>
            <rect x="38" y="26" width="4" height="12" rx="2"/>
            <rect x="12" y="14" width="24" height="6" rx="3"/>
        </svg>`, 
        type: 'bench', 
        hasOptions: true 
    },
    cable_machine: { 
        name: 'Machine à poulies', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="6" y="8" width="4" height="32" rx="2"/>
            <rect x="38" y="8" width="4" height="32" rx="2"/>
            <circle cx="24" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M24 15 L24 30" stroke="currentColor" stroke-width="2"/>
            <rect x="20" y="30" width="8" height="4" rx="2"/>
        </svg>`, 
        type: 'machine' 
    },
    leg_press: { 
        name: 'Presse à cuisses', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="8" y="28" width="32" height="8" rx="2"/>
            <rect x="12" y="18" width="24" height="10" rx="2"/>
            <path d="M16 18 L16 12 Q16 10 18 10 L30 10 Q32 10 32 12 L32 18" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>`, 
        type: 'machine' 
    },
    lat_pulldown: { 
        name: 'Tirage vertical', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="6" y="8" width="36" height="4" rx="2"/>
            <rect x="4" y="6" width="4" height="8" rx="2"/>
            <rect x="40" y="6" width="4" height="8" rx="2"/>
            <path d="M20 12 L20 22 L16 26 L32 26 L28 22 L28 12" stroke="currentColor" stroke-width="2" fill="none"/>
            <rect x="18" y="22" width="12" height="3" rx="1"/>
        </svg>`, 
        type: 'machine' 
    },
    chest_press: { 
        name: 'Développé machine', 
        icon: `<svg viewBox="0 0 48 48" width="32" height="32" fill="currentColor">
            <rect x="8" y="18" width="32" height="12" rx="3"/>
            <rect x="6" y="30" width="4" height="8" rx="2"/>
            <rect x="38" y="30" width="4" height="8" rx="2"/>
            <path d="M16 18 L16 14 Q16 12 18 12 L30 12 Q32 12 32 14 L32 18" stroke="currentColor" stroke-width="2" fill="none"/>
            <circle cx="20" cy="24" r="2"/>
            <circle cx="28" cy="24" r="2"/>
        </svg>`, 
        type: 'machine' 
    }
};



function validateEquipmentConfig(config) {
    const errors = [];
    
    // Vérifier que les disques sont disponibles si des barres le requièrent
    const barbellsRequiringPlates = ['barbell_athletic', 'barbell_ez', 'barbell_short_pair'];
    const hasBarbell = barbellsRequiringPlates.some(b => config[b]?.available);
    
    if (hasBarbell && !config.weight_plates?.available) {
        errors.push('Les disques sont obligatoires pour utiliser les barres');
    }
    
    // Vérifier les paires de barres courtes
    if (config.barbell_short_pair?.available && config.barbell_short_pair?.count < 2) {
        errors.push('Au moins 2 barres courtes sont nécessaires');
    }
    
    // Vérifier qu'au moins un équipement de force est disponible
    const forceEquipment = ['dumbbells', 'barbell_athletic', 'barbell_ez', 'barbell_short_pair'];
    if (!forceEquipment.some(eq => config[eq]?.available)) {
        errors.push('Sélectionnez au moins un équipement de musculation');
    }
    
    // Vérifier les élastiques si sélectionnés
    if (config.resistance_bands?.available) {
        const tensions = config.resistance_bands.tensions || {};
        const hasTensions = Object.values(tensions).some(count => count > 0);
        
        if (!hasTensions) {
            errors.push('Sélectionnez au moins une tension d\'élastique');
        }
    }

    // Vérifier la configuration du banc
    if (config.bench?.available) {
        const positions = config.bench.positions || {};
        
        if (!positions.flat) {
            errors.push('La position plate du banc est obligatoire');
        }
        
        // Au moins une position doit être disponible
        const hasAnyPosition = Object.values(positions).some(p => p === true);
        if (!hasAnyPosition) {
            errors.push('Sélectionnez au moins une position pour le banc');
        }
    }

    return errors;
}

async function showAvailableWeightsPreview() {
    if (!currentUser) return;
    
    try {
        const weightsData = await apiGet(`/api/users/${currentUser.id}/available-weights`);
        const weights = weightsData.available_weights;
        
        console.log('Poids disponibles:', weights.slice(0, 20)); // Afficher les 20 premiers
        
        // Organiser par type d'équipement pour l'affichage
        const organized = {
            bodyweight: [currentUser.weight],
            dumbbells: weights.filter(w => w <= 50),
            barbell: weights.filter(w => w >= 20 && w <= 200),
            resistance: weights.filter(w => w <= 40 && Number.isInteger(w))
        };
        
        console.log('Organisé par type:', organized);
        
    } catch (error) {
        console.error('Erreur chargement poids:', error);
    }
}

const PLATE_WEIGHTS = [1.25, 2, 2.5, 5, 10, 15, 20, 25]; // Poids standards
const RESISTANCE_TENSIONS = [5, 10, 15, 20, 25, 30, 35, 40]; // Tensions standards en kg équivalent
const DEFAULT_PLATE_COUNTS = {
    1.25: 8,
    2: 2,
    2.5: 4, 
    5: 4,
    10: 2,
    15: 2,
    20: 0,
    25: 0
};
const DEFAULT_RESISTANCE_COUNTS = {
    15: 1,
    30: 1
};

// Zones musculaires spécifiques
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
    
    // Vérifier les paramètres URL pour les raccourcis PWA
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    
    // Charger l'utilisateur depuis localStorage
    const savedUserId = localStorage.getItem('fitness_user_id');
    if (savedUserId) {
        try {
            currentUser = await apiGet(`/api/users/${savedUserId}`);
            
            // Charger les favoris depuis le backend
            if (!currentUser.favorite_exercises || currentUser.favorite_exercises.length === 0) {
                try {
                    const favoritesResponse = await apiGet(`/api/users/${savedUserId}/favorites`);
                    currentUser.favorite_exercises = favoritesResponse.favorites || [];
                    console.log('Favoris chargés depuis API:', currentUser.favorite_exercises);
                } catch (error) {
                    console.log('Aucun favori trouvé');
                    currentUser.favorite_exercises = [];
                }
            } else {
                console.log('Favoris déjà présents:', currentUser.favorite_exercises);
            }
            
            showMainInterface();
            
            // Exécuter l'action demandée si l'utilisateur est connecté
            if (action) {
                handleUrlAction(action);
            }
            
        } catch (error) {
            console.log('Utilisateur non trouvé, affichage page d\'accueil');
            localStorage.removeItem('fitness_user_id');
            showHomePage(); 
        }
    } else {
        showHomePage();
        // S'assurer que la page est complètement chargée avant de charger les profils
        if (document.readyState === 'complete') {
            loadExistingProfiles();
        } else {
            window.addEventListener('load', loadExistingProfiles);
        }
    }
    
    setupEventListeners();
    registerServiceWorker();
});

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
            // Pour l'instant, pas de service worker complexe
            console.log('Service Worker support détecté');
        } catch (error) {
            console.log('Erreur Service Worker:', error);
        }
    }
}

// ===== NAVIGATION =====
function showView(viewName) {
    console.log(`🔍 showView(${viewName}) - currentUser:`, currentUser ? currentUser.name : 'UNDEFINED');

    // Gérer le cas où currentUser est perdu
    if (!currentUser && ['dashboard', 'stats', 'profile'].includes(viewName)) {
        const savedUserId = localStorage.getItem('fitness_user_id');  // ← AJOUTER CETTE LIGNE
        if (savedUserId) {
            // Recharger l'utilisateur de façon asynchrone
            console.log('currentUser perdu, rechargement depuis localStorage...');
            apiGet(`/api/users/${savedUserId}`)
                .then(user => {
                    currentUser = user;
                    window.currentUser = user;
                    console.log('Utilisateur rechargé:', currentUser.name);
                    // Relancer showView maintenant que currentUser est disponible
                    showView(viewName);
                })
                .catch(error => {
                    console.error('Impossible de recharger l\'utilisateur:', error);
                    localStorage.removeItem('fitness_user_id');
                    showHomePage();
                });
            return; // Sortir et attendre le rechargement
        } else {
            console.error('Pas d\'utilisateur chargé, retour à l\'accueil');
            showHomePage();
            return;
        }
    }
    
    // Reste du code exactement identique
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
    if (['dashboard', 'stats', 'profile', 'home', 'workout'].includes(viewName)) {
        document.getElementById('bottomNav').style.display = 'flex';
        
        // Double vérification après un court délai
        setTimeout(() => {
            const nav = document.getElementById('bottomNav');
            if (nav && nav.style.display !== 'flex') {
                nav.style.display = 'flex';
                console.log('Navigation forcée à s\'afficher');
            }
        }, 50);
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
        
        window.currentUser = currentUser;
    }
    
    showView('dashboard');

    // Forcer l'affichage de la navigation après un court délai
    setTimeout(() => {
        document.getElementById('bottomNav').style.display = 'flex';
    }, 100);
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

function showHomePage() {  // ← SUPPRIMER LE PARAMÈTRE
    // Masquer tout
    document.getElementById('onboarding').classList.remove('active');
    document.getElementById('progressContainer').style.display = 'none';
    // Afficher la navigation si un utilisateur est connecté
    if (currentUser) {
        document.getElementById('bottomNav').style.display = 'flex';
    } else {
        document.getElementById('bottomNav').style.display = 'none';
    }
    document.getElementById('userInitial').style.display = 'none';
    
    // Masquer toutes les vues
    document.querySelectorAll('.view').forEach(el => {
        el.classList.remove('active');
    });
    
    // Afficher la page d'accueil
    document.getElementById('home').classList.add('active');
    
    // Charger les profils existants
    loadExistingProfiles();
    // Appel de secours si le premier échoue
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
        // Réessayer après un court délai si l'élément n'est pas encore dans le DOM
        setTimeout(() => loadExistingProfiles(), 500);
        return;
    }
    
    // S'assurer que le container est visible
    container.style.display = 'block';
    container.innerHTML = '<p style="text-align: center;">Chargement des profils...</p>';
    
    try {
        const response = await fetch('/api/users');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const users = await response.json();
        console.log(`${users.length} profils trouvés`);
        
        container.innerHTML = ''; // Vider le message de chargement
        
        if (users.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Aucun profil existant</p>';
            return;
        }
        
        // Ajouter le séparateur
        const divider = document.createElement('div');
        divider.className = 'profiles-divider';
        divider.textContent = 'ou continuez avec';
        container.appendChild(divider);
        
        // Afficher chaque profil
        for (const user of users) {
            const age = new Date().getFullYear() - new Date(user.birth_date).getFullYear();
            
            const profileBtn = document.createElement('button');
            profileBtn.className = 'profile-btn';
            profileBtn.onclick = () => {
                currentUser = user;
                localStorage.setItem('fitness_user_id', user.id);
                showMainInterface();
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
            
            // Charger les stats de façon asynchrone
            apiGet(`/api/users/${user.id}/stats`)
                .then(stats => {
                    const statsEl = document.getElementById(`stats-${user.id}`);
                    if (statsEl) {
                        statsEl.textContent = `💪 ${stats.total_workouts} séances`;
                    }
                })
                .catch(err => {
                    console.warn(`Stats non disponibles pour user ${user.id}`, err);
                });
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
            return true;
            
        case 2:
            const selectedEquipment = document.querySelectorAll('.equipment-card.selected');
            if (selectedEquipment.length === 0) {
                showToast('Sélectionnez au moins un équipement', 'error');
                return false;
            }
            return true;
            
        case 3:
            return true; // Configuration détaillée optionnelle

        case 4: // Nouveau case pour l'étape 3.5
            // La validation est automatique car un radio est toujours sélectionné
            return true;
            
        case 5:
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
                               min="${Math.max(5, config.defaultWeight - 5)}" max="${config.defaultWeight + 10}" step="0.5">
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
                if (equipment === 'dumbbells') {
                    detailHTML += `
                        <div class="form-group">
                            <label>Poids disponibles (kg)</label>
                            <input type="text" id="${equipment}_weights" 
                                   placeholder="5, 10, 15, 20, 25, 30" value="5, 10, 15, 20, 25, 30">
                            <small>Dumbbells fixes d'un seul tenant, séparés par des virgules</small>
                        </div>
                    `;
                } else if (equipment === 'kettlebells') {
                    detailHTML += `
                        <div class="form-group">
                            <label>Poids disponibles (kg)</label>
                            <input type="text" id="${equipment}_weights" 
                                   placeholder="8, 12, 16, 20, 24" value="8, 12, 16, 20, 24">
                        </div>
                    `;
                }
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
                        <small style="display: block; margin-top: 0.5rem;">
                            Nombre de disques par poids. Minimum 2 par poids pour faire une paire.
                        </small>
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
                                    <input type="number" id="tension_${tension}" 
                                        min="0" max="10" value="${DEFAULT_RESISTANCE_COUNTS[tension] || 0}" 
                                        style="width: 100%; text-align: center;">
                                </div>
                            `).join('')}
                        </div>
                        <small style="display: block; margin-top: 0.5rem;">
                            Nombre d'élastiques par tension disponible.
                        </small>
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
                        <small style="display: block; margin-top: 0.5rem;">
                            Configuration complète recommandée pour un maximum d'exercices.
                        </small>
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
        
        // Event listeners pour équipement avec lest
        if (config.type === 'bodyweight') {
            const checkbox = document.getElementById(`${equipment}_weighted`);
            const weightsContainer = document.getElementById(`${equipment}_weights_container`);
            
            checkbox?.addEventListener('change', () => {
                weightsContainer.style.display = checkbox.checked ? 'block' : 'none';
            });
        }
    });
    
    // Afficher les warnings si nécessaire
    showEquipmentWarnings();
    
    // Afficher le résumé de configuration
    setTimeout(() => {
        showConfigurationSummary();
    }, 500); // Délai pour que les inputs soient initialisés
}

function getBenchCapabilities(config) {
    /**
     * Retourne les capacités du banc configuré
     */
    const bench = config.bench;
    if (!bench?.available) {
        return { available: false, capabilities: [] };
    }
    
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
        capabilities: capabilities,
        exerciseCount: estimateExerciseCompatibilityFromBench(positions, settings) // CORRECTION ICI
    };
}

function estimateExerciseCompatibilityFromBench(positions, settings) {
    let exerciseCount = 0;
    
    if (positions.flat) exerciseCount += 15; // Développé, rowing, etc.
    if (positions.incline_up) exerciseCount += 8; // Développé incliné, etc.
    if (positions.decline) exerciseCount += 5; // Développé décliné, etc.
    if (settings.preacher_curl) exerciseCount += 3; // Curls
    
    return exerciseCount;
}

function _estimateExerciseCompatibility(positions, settings) {
    let exerciseCount = 0;
    
    if (positions.flat) exerciseCount += 15; // Développé, rowing, etc.
    if (positions.incline_up) exerciseCount += 8; // Développé incliné, etc.
    if (positions.decline) exerciseCount += 5; // Développé décliné, etc.
    if (settings.preacher_curl) exerciseCount += 3; // Curls
    
    return exerciseCount;
}

function showEquipmentWarnings() {
    const selectedCards = document.querySelectorAll('.equipment-card.selected');
    const selectedEquipment = Array.from(selectedCards).map(card => card.dataset.equipment);
    
    const warnings = [];
    // Nouveau warning pour les bancs
    if (selectedEquipment.includes('bench')) {
        const benchCapabilities = getBenchCapabilities(collectEquipmentConfig());
        if (benchCapabilities.available && benchCapabilities.exerciseCount < 10) {
            warnings.push(`ℹ️ Configuration basique du banc (${benchCapabilities.exerciseCount} exercices compatibles)`);
        }
    }
    // Vérifier les dépendances
    const barbellsRequiringPlates = ['barbell_athletic', 'barbell_ez', 'barbell_short_pair'];
    const hasBarbell = ['barbell_athletic', 'barbell_ez'].some(b => selectedEquipment.includes(b));
    if (hasBarbell && !selectedEquipment.includes('bench')) {
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

async function completeOnboarding() {
    if (!validateCurrentStep()) return;
    
    try {
        showToast('Création de votre profil...', 'info');
        
        // Collecter les données du formulaire
        const userData = {
            name: document.getElementById('userName').value.trim(),
            birth_date: document.getElementById('birthDate').value + 'T00:00:00',
            height: parseFloat(document.getElementById('height').value),
            weight: parseFloat(document.getElementById('weight').value),
            experience_level: document.querySelector('input[name="experience"]:checked').value,
            equipment_config: collectEquipmentConfig(),
            prefer_weight_changes_between_sets: document.querySelector('input[name="weightPreference"]:checked').value === 'true'
        };
                
        // Créer l'utilisateur
        currentUser = await apiPost('/api/users', userData);
        localStorage.setItem('fitness_user_id', currentUser.id);
        // Ajouter à la liste des profils
        const profiles = JSON.parse(localStorage.getItem('fitness_profiles') || '[]');
        if (!profiles.includes(currentUser.id)) {
            profiles.push(currentUser.id);
            localStorage.setItem('fitness_profiles', JSON.stringify(profiles));
        }
        
        // Créer le programme si des zones sont sélectionnées
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
                // Positions obligatoires et optionnelles
                const positions = {
                    flat: document.getElementById(`${equipment}_flat`)?.checked || false,
                    incline_up: document.getElementById(`${equipment}_incline_up`)?.checked || false,
                    decline: document.getElementById(`${equipment}_decline`)?.checked || false
                };
                
                // Réglages supplémentaires
                const settings = {
                    height_adjustable: document.getElementById(`${equipment}_height_adjustable`)?.checked || false,
                    has_rack: document.getElementById(`${equipment}_has_rack`)?.checked || false,
                    preacher_curl: document.getElementById(`${equipment}_preacher_curl`)?.checked || false
                };
                
                config[equipment].positions = positions;
                config[equipment].settings = settings;
                
                // Validation : au moins la position plate doit être disponible
                if (!positions.flat) {
                    throw new Error('La position plate du banc est obligatoire');
                }
                break;

            case 'machine':
                const maxWeight = document.getElementById(`${equipment}_max_weight`);
                const increment = document.getElementById(`${equipment}_increment`);
                if (maxWeight) {
                    config[equipment].max_weight = parseFloat(maxWeight.value);
                }
                if (increment) {
                    config[equipment].increment = parseFloat(increment.value);
                }
                break;
        }
    });
    
    // Validation finale
    const errors = validateEquipmentConfig(config);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    
    return config;
}

// ===== DASHBOARD =====

async function loadDashboard() {
    if (!currentUser) {
        console.error('loadDashboard: currentUser non défini');
        return;
    }
    
    // S'assurer que la navigation est visible sur le dashboard
    document.getElementById('bottomNav').style.display = 'flex';
    
    // Supprimer toute bannière existante d'abord
    const existingBanner = document.querySelector('.workout-resume-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // Vérifier s'il y a une séance active
    try {
        const activeWorkout = await apiGet(`/api/users/${currentUser.id}/workouts/active`);
        if (activeWorkout && activeWorkout.id) {
            showWorkoutResumeBanner(activeWorkout);
        }
    } catch (error) {
        // Pas de séance active, c'est normal - ne rien afficher
        console.log('Pas de séance active');
    }
    
    // Message de bienvenue
    const welcomeMsg = document.getElementById('welcomeMessage');
    const hour = new Date().getHours();
    let greeting = 'Bonsoir';
    if (hour < 12) greeting = 'Bonjour';
    else if (hour < 18) greeting = 'Bon après-midi';
    
    welcomeMsg.innerHTML = `
        <h2>${greeting} ${currentUser.name} !</h2>
        <p>Prêt pour votre séance ?</p>
    `;
    
    // Charger les statistiques
    try {
        const stats = await apiGet(`/api/users/${currentUser.id}/stats`);
        
        document.getElementById('totalWorkouts').textContent = stats.total_workouts;
        document.getElementById('totalVolume').textContent = `${(stats.total_volume_kg / 1000).toFixed(1)}t`;
        document.getElementById('lastWorkout').textContent = 
            stats.last_workout_date ? new Date(stats.last_workout_date).toLocaleDateString() : '-';
        
        // AJOUT MANQUANT 1: Charger l'état musculaire
        await loadMuscleReadiness();
        
        // AJOUT MANQUANT 2: Charger les séances récentes avec exercices enrichis
        if (stats.recent_workouts) {
            const enrichedWorkouts = await enrichWorkoutsWithExercises(stats.recent_workouts);
            loadRecentWorkouts(enrichedWorkouts);
        }
        
        // NOUVEAU: Initialiser les graphiques
        if (typeof initStatsCharts === 'function') {
            await initStatsCharts(currentUser.id, currentUser);
        }
        
    } catch (error) {
        console.error('Erreur chargement stats:', error);
        // En cas d'erreur, appeler quand même les fonctions avec des valeurs par défaut
        await loadMuscleReadiness();
        loadRecentWorkouts([]);
    }
    
    // NOUVEAU: Conteneur pour le widget programme
    const workoutSection = document.querySelector('.workout-options');
    if (workoutSection) {
        // Injecter le widget avant les boutons existants
        const widgetContainer = document.createElement('div');
        widgetContainer.id = 'programStatusWidget';
        workoutSection.insertBefore(widgetContainer, workoutSection.firstChild);
        
        // Charger le statut du programme
        await loadProgramStatus();
    }
}


async function loadProgramStatus() {
    try {
        const status = await apiGet(`/api/users/${currentUser.id}/program-status`);
        
        if (!status) {
            // Pas de programme actif, afficher le bouton classique
            document.getElementById('programStatusWidget').innerHTML = `
                <button class="btn btn-primary" onclick="showView('settings')">
                    <i class="fas fa-plus"></i> Créer un programme
                </button>
            `;
            return;
        }
        
        // Calculer la progression de la semaine
        const weekProgress = (status.sessions_this_week / status.target_sessions) * 100;
        const isLate = status.sessions_this_week < Math.floor((new Date().getDay() / 7) * status.target_sessions);
        
        // Déterminer l'emoji et la couleur selon l'état
        let statusEmoji = '📊';
        let statusColor = 'var(--primary)';
        let encouragement = '';
        
        if (status.on_track) {
            statusEmoji = '✅';
            statusColor = 'var(--success)';
            encouragement = 'Vous êtes sur la bonne voie !';
        } else if (isLate) {
            statusEmoji = '⏰';
            statusColor = 'var(--warning)';
            encouragement = 'Il est temps de s\'y remettre !';
        }
        
        if (status.sessions_this_week >= status.target_sessions) {
            statusEmoji = '🎉';
            statusColor = 'var(--success)';
            encouragement = 'Objectif hebdomadaire atteint !';
        }
        
        // Générer le HTML du widget
        document.getElementById('programStatusWidget').innerHTML = `
            <div class="program-status-card" style="
                background: var(--card-bg);
                border-radius: 12px;
                padding: 1.5rem;
                margin-bottom: 1.5rem;
                border: 1px solid var(--border-color);
                position: relative;
                overflow: hidden;
            ">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
                        ${statusEmoji} ${status.program_name || 'Mon Programme'}
                    </h3>
                    <span style="color: var(--text-muted); font-size: 0.9rem;">
                        Semaine ${status.current_week}/${status.total_weeks}
                    </span>
                </div>
                
                <!-- Progression de la semaine -->
                <div style="margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span style="font-size: 0.9rem;">Séances cette semaine</span>
                        <span style="font-weight: 600; color: ${statusColor};">
                            ${status.sessions_this_week}/${status.target_sessions}
                        </span>
                    </div>
                    <div style="
                        background: var(--bg-secondary);
                        height: 8px;
                        border-radius: 4px;
                        overflow: hidden;
                    ">
                        <div style="
                            background: ${statusColor};
                            height: 100%;
                            width: ${Math.min(weekProgress, 100)}%;
                            transition: width 0.3s ease;
                        "></div>
                    </div>
                    ${encouragement ? `<p style="margin-top: 0.5rem; margin-bottom: 0; color: var(--text-muted); font-size: 0.85rem;">${encouragement}</p>` : ''}
                </div>
                
                <!-- Prochaine séance -->
                <div style="
                    background: var(--bg-secondary);
                    border-radius: 8px;
                    padding: 1rem;
                    margin-bottom: 1rem;
                ">
                    <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--text-muted);">
                        Prochaine séance
                    </h4>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <i class="fas fa-dumbbell" style="color: var(--primary);"></i>
                        <span style="font-weight: 500;">${status.next_session_preview.muscles}</span>
                    </div>
                    <div style="display: flex; gap: 1rem; font-size: 0.85rem; color: var(--text-muted);">
                        <span><i class="fas fa-list"></i> ${status.next_session_preview.exercises_count} exercices</span>
                        <span><i class="fas fa-clock"></i> ~${status.next_session_preview.estimated_duration}min</span>
                    </div>
                    ${status.next_session_preview.ml_adaptations !== 'Standard' ? `
                        <div style="
                            margin-top: 0.75rem;
                            padding: 0.5rem;
                            background: var(--primary-light);
                            border-radius: 4px;
                            font-size: 0.85rem;
                            color: var(--primary);
                        ">
                            <i class="fas fa-brain"></i> ML: ${status.next_session_preview.ml_adaptations}
                        </div>
                    ` : ''}
                </div>
                
                <!-- Bouton action -->
                <button class="btn btn-primary" style="width: 100%;" onclick="startProgramWorkout()">
                    <i class="fas fa-play"></i> Commencer la séance
                </button>
            </div>
        `;
        
    } catch (error) {
        console.error('Erreur chargement statut programme:', error);
        // Fallback silencieux
        document.getElementById('programStatusWidget').innerHTML = `
            <button class="btn btn-primary btn-large" onclick="startProgramWorkout()">
                <i class="fas fa-calendar-check"></i> Séance programme
            </button>
        `;
    }
}

async function enrichWorkoutsWithExercises(workouts) {
    if (!workouts || workouts.length === 0) return [];
    
    const enrichedWorkouts = [];
    
    for (const workout of workouts) {
        const enrichedWorkout = { ...workout };
        
        // Charger les sets de cette séance
        try {
            const sets = await apiGet(`/api/workouts/${workout.id}/sets`);
            
            // Grouper les sets par exercice
            const exerciseMap = new Map();
            
            for (const set of sets) {
                if (!exerciseMap.has(set.exercise_id)) {
                    // Charger les infos de l'exercice
                    const exercise = await apiGet(`/api/exercises/${set.exercise_id}`);
                    exerciseMap.set(set.exercise_id, {
                        id: exercise.id,
                        name: exercise.name,
                        muscle_groups: exercise.muscle_groups || [],
                        sets: 0,
                        reps: 0,
                        weight: 0
                    });
                }
                
                const exerciseData = exerciseMap.get(set.exercise_id);
                exerciseData.sets += 1;
                exerciseData.reps += set.reps || 0;
                exerciseData.weight = Math.max(exerciseData.weight, set.weight || 0);
            }
            
            // Convertir en array d'exercices
            enrichedWorkout.exercises = Array.from(exerciseMap.values());
            
        } catch (error) {
            console.warn(`Impossible de charger les exercices pour la séance ${workout.id}`);
            enrichedWorkout.exercises = [];
        }
        
        enrichedWorkouts.push(enrichedWorkout);
    }
    
    return enrichedWorkouts;
}

async function showWorkoutResumeBanner(workout) {
    if (!currentUser || !document.getElementById('dashboard')) {
        console.log('Dashboard non disponible, banner ignoré');
        return;
    }
    
    // Supprimer toute bannière existante
    const existingBanner = document.querySelector('.workout-resume-banner');
    if (existingBanner) {
        existingBanner.remove();
    }
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
    `;
    
    // Forcer l'interprétation UTC de la date de démarrage
    const startedAt = new Date(workout.started_at + (workout.started_at.includes('Z') ? '' : 'Z'));
    const elapsed = startedAt && !isNaN(startedAt) ?
        Math.floor((new Date() - startedAt) / 60000) : 0;
        
    banner.innerHTML = `
        <button class="banner-close" onclick="this.parentElement.remove()" style="position: absolute; top: 0.5rem; right: 0.5rem; background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;">×</button>
        <h3>⏱️ Séance en cours</h3>
        <p>Démarrée il y a ${elapsed} minutes</p>
        <div style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.5rem;">
            <button class="btn" style="background: white; color: var(--warning);" 
                    onclick="resumeWorkout(${workout.id})">
                Reprendre la séance
            </button>
            <button class="btn" style="background: rgba(255,255,255,0.2); color: white;" 
                    onclick="abandonActiveWorkout(${workout.id})">
                Abandonner
            </button>
        </div>
    `;
    
    const welcomeMsg = document.getElementById('welcomeMessage');
    welcomeMsg.parentNode.insertBefore(banner, welcomeMsg.nextSibling);
}

async function resumeWorkout(workoutId) {
    try {
        // Vérifier que l'ID est valide
        if (!workoutId || workoutId === 'undefined') {
            throw new Error('ID de séance invalide');
        }
        
        // Récupérer les données de la séance via apiGet qui gère automatiquement les erreurs
        const workout = await apiGet(`/api/workouts/${workoutId}`);

        if (!workout || !workout.id) {
            throw new Error('Données de séance invalides');
        }
        currentWorkout = workout;
        
        // Configurer l'interface selon le type
        if (workout.type === 'program') {
            // Récupérer le programme associé
            const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
            if (program) {
                await setupProgramWorkout(program);
            } else {
                throw new Error('Programme associé non trouvé');
            }
        } else {
            setupFreeWorkout();
        }
        
        showView('workout');
        showToast('Séance reprise avec succès', 'success');
        
    } catch (error) {
        console.error('Erreur reprise séance:', error);
        showToast(`Impossible de reprendre la séance: ${error.message}`, 'error');
        
        // Nettoyer l'état en cas d'erreur
        localStorage.removeItem('fitness_workout_state');
        const banner = document.querySelector('.workout-resume-banner');
        if (banner) banner.remove();
    }
}

async function abandonActiveWorkout(workoutId) {
    if (confirm('Êtes-vous sûr de vouloir abandonner cette séance ?')) {
        // Nettoyer IMMÉDIATEMENT l'état local et la bannière
        localStorage.removeItem('fitness_workout_state');
        clearWorkoutState();
        const banner = document.querySelector('.workout-resume-banner');
        if (banner) banner.remove();
        
        try {
            // Tenter l'API en arrière-plan
            await apiPut(`/api/workouts/${workoutId}/complete`, {
                total_duration: 0,
                total_rest_time: 0
            });
            showToast('Séance abandonnée', 'info');
        } catch (error) {
            console.error('Erreur API abandon:', error);
            showToast('Séance abandonnée (hors ligne)', 'info');
        }
        
        // FORCER le rechargement du dashboard pour être sûr
        loadDashboard();
    }
}

// ===== MODULE 0 : GESTION DES EXERCICES SKIPPÉS =====

async function skipExercise(exerciseId, reason) {
    console.log(`📊 MODULE 0 - Skipping exercise ${exerciseId} for reason: ${reason}`);
    
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    if (!exerciseState) {
        console.error(`Exercise ${exerciseId} not found in current session`);
        return;
    }
    
    const exerciseName = getExerciseName(exerciseId);
    
    // Créer l'entrée de skip
    const skipEntry = {
        exercise_id: parseInt(exerciseId),
        reason: reason,
        planned_sets: exerciseState.totalSets,
        completed_sets: exerciseState.completedSets || 0,
        timestamp: new Date().toISOString(),
        exercise_order: exerciseState.index + 1,
        exercise_name: exerciseName
    };
    
    // Ajouter à la liste des skips
    currentWorkoutSession.skipped_exercises.push(skipEntry);
    
    // Marquer l'exercice comme skippé (NOUVELLE propriété)
    exerciseState.isSkipped = true;
    exerciseState.skipReason = reason;
    exerciseState.endTime = new Date();
    
    // Fermer le modal s'il est ouvert
    closeModal();
    
    // Mettre à jour l'affichage
    loadProgramExercisesList();
    updateHeaderProgress();
    
    showToast(`✅ Exercice passé : ${exerciseName}`, 'info');
    
    // Analytics temps réel
    if (typeof trackEvent === 'function') {
        trackEvent('exercise_skipped', {
            exercise_id: exerciseId,
            reason: reason,
            workout_progress: Math.round((currentWorkoutSession.completedExercisesCount / 
                             Object.keys(currentWorkoutSession.programExercises).length) * 100)
        });
    }
}

function showSkipModal(exerciseId) {
    const exerciseName = getExerciseName(exerciseId);
    
    showModal('Passer l\'exercice', `
        <div style="text-align: center; padding: 1rem;">
            <p style="margin-bottom: 1.5rem; font-size: 1.1rem;">
                Pourquoi voulez-vous passer <strong>"${exerciseName}"</strong> ?
            </p>
            <div class="skip-reasons-grid">
                <button onclick="skipExercise(${exerciseId}, 'time')" class="skip-reason-btn">
                    <i class="fas fa-clock"></i>
                    <span>Manque de temps</span>
                </button>
                <button onclick="skipExercise(${exerciseId}, 'fatigue')" class="skip-reason-btn">
                    <i class="fas fa-tired"></i>
                    <span>Trop fatigué</span>
                </button>
                <button onclick="skipExercise(${exerciseId}, 'equipment')" class="skip-reason-btn">
                    <i class="fas fa-dumbbell"></i>
                    <span>Équipement indisponible</span>
                </button>
                <button onclick="skipExercise(${exerciseId}, 'other')" class="skip-reason-btn">
                    <i class="fas fa-question-circle"></i>
                    <span>Autre raison</span>
                </button>
            </div>
        </div>
    `);
}

async function restartSkippedExercise(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    // Retirer de la liste des skips
    currentWorkoutSession.skipped_exercises = currentWorkoutSession.skipped_exercises.filter(
        skip => skip.exercise_id !== exerciseId
    );
    
    // Réinitialiser l'état de l'exercice
    exerciseState.isSkipped = false;
    exerciseState.skipReason = null;
    exerciseState.completedSets = 0;
    exerciseState.isCompleted = false;
    exerciseState.startTime = new Date();
    exerciseState.endTime = null;
    
    // Supprimer les séries de cet exercice de l'historique
    currentWorkoutSession.completedSets = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id !== exerciseId
    );
    
    // Sélectionner l'exercice
    await selectProgramExercise(exerciseId);
    
    showToast('Exercice repris', 'success');
}

// Fonction utilitaire pour récupérer le nom d'un exercice
function getExerciseName(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    if (exerciseState && exerciseState.name) {
        return exerciseState.name;
    }
    
    // Fallback : rechercher dans la liste des exercices chargés
    const exerciseElement = document.querySelector(`[data-exercise-id="${exerciseId}"] .exercise-name`);
    return exerciseElement ? exerciseElement.textContent : `Exercice ${exerciseId}`;
}

// ===== GESTION ÉTATS BOUTON PRINCIPAL =====
function updateExecuteButtonState(state = 'ready') {
    const executeBtn = document.getElementById('executeSetBtn');
    if (!executeBtn) return;
    
    // Nettoyer toutes les classes d'état
    executeBtn.classList.remove('ready', 'btn-danger', 'btn-success');
    
    switch (state) {
        case 'ready':
            executeBtn.classList.add('ready', 'btn-success');
            executeBtn.innerHTML = '✅';
            executeBtn.onclick = executeSet;
            break;
            
        case 'isometric-start':
            executeBtn.classList.add('btn-success');
            executeBtn.innerHTML = '✅';
            executeBtn.onclick = () => handleIsometricAction();
            break;
            
        case 'isometric-stop':
            executeBtn.classList.add('btn-danger');
            executeBtn.innerHTML = '⏹️';
            executeBtn.onclick = () => handleIsometricAction();
            break;
            
        case 'disabled':
            executeBtn.classList.remove('ready');
            executeBtn.style.opacity = '0.5';
            executeBtn.style.cursor = 'not-allowed';
            break;
    }
}

async function loadMuscleReadiness() {
    const container = document.getElementById('muscleReadiness');
    
    // Utiliser la configuration centralisée
    const muscleGroups = [
        { name: 'Dos', key: 'dos' },
        { name: 'Pectoraux', key: 'pectoraux' },
        { name: 'Jambes', key: 'jambes' },
        { name: 'Épaules', key: 'epaules' },
        { name: 'Bras', key: 'bras' },
        { name: 'Abdominaux', key: 'abdominaux' }
    ];
        
    try {
        // Appeler l'API de récupération musculaire
        const recoveryData = await apiGet(`/api/users/${currentUser.id}/stats/recovery-gantt`);
        
        container.innerHTML = muscleGroups.map(muscle => {
            const recovery = recoveryData[muscle.key];
            
            if (!recovery) {
                // Pas de données = muscle frais
                const gradientStyle = `
                    background: var(--bg-card);
                    border-top: 1px solid var(--border);
                    border-right: 1px solid var(--border);
                    border-bottom: 1px solid var(--border);
                    border-left: 4px solid var(--muscle-${muscle.key});
                    position: relative;
                `;

                const overlayStyle = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: var(--muscle-${muscle.key});
                    opacity: 0.15;
                    z-index: 1;
                `;

                return `
                    <div class="muscle-item ready muscle-border-left-${muscle.key}" 
                         style="${gradientStyle}">
                        <div style="${overlayStyle}"></div>
                        <div class="muscle-info">
                            <h4 class="muscle-title-${muscle.key}">${muscle.name}</h4>
                            <p class="muscle-status-text">Prêt à l'entraînement</p>
                        </div>
                        <div class="muscle-indicator">
                            <div class="indicator-dot muscle-bg-${muscle.key}"></div>
                        </div>
                    </div>
                `;
            }
            
            // Déterminer l'état selon le pourcentage de récupération
            let status = 'ready';
            let statusText = 'Prêt à l\'entraînement';
            let statusClass = 'ready';
            
            if (recovery.recoveryPercent < 50) {
                status = 'fatigued';
                statusText = `En récupération (${recovery.recoveryPercent}%)`;
                statusClass = 'fatigued';
            } else if (recovery.recoveryPercent < 90) {
                status = 'recovering';
                statusText = `Récupération avancée (${recovery.recoveryPercent}%)`;
                statusClass = 'recovering';
            }
            
            // Afficher le temps depuis la dernière séance
            const timeInfo = recovery.hoursSince ? 
                `Dernière séance: ${Math.round(recovery.hoursSince)}h` : 
                'Jamais entraîné';
            
            // Calculer le pourcentage de couleur (inverse de la récupération)
            const colorPercent = 100 - recovery.recoveryPercent;

            // Background subtil avec overlay
            const gradientStyle = `
                background: var(--bg-card);
                border-top: 1px solid var(--border);
                border-right: 1px solid var(--border);
                border-bottom: 1px solid var(--border);
                border-left: 4px solid var(--muscle-${muscle.key});
                position: relative;
            `;

            const overlayStyle = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(to right, 
                    var(--muscle-${muscle.key}) 0%, 
                    var(--muscle-${muscle.key}) ${colorPercent}%, 
                    transparent ${colorPercent}%, 
                    transparent 100%);
                opacity: 0.15;
                z-index: 1;
            `;

            return `
                <div class="muscle-item ${statusClass} muscle-border-left-${muscle.key}" 
                     style="${gradientStyle}">
                    <div style="${overlayStyle}"></div>
                    <div class="muscle-info">
                        <h4 class="muscle-title-${muscle.key}">${muscle.name}</h4>
                        <p class="muscle-status-text">${statusText}</p>
                        <small class="muscle-time-info">${timeInfo}</small>
                    </div>
                    <div class="muscle-indicator">
                        <div class="indicator-dot muscle-bg-${muscle.key}"></div>
                        ${recovery.recoveryPercent < 100 ? 
                            `<span class="recovery-badge">${recovery.recoveryPercent}%</span>` : 
                            ''
                        }
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Erreur chargement état musculaire:', error);
        
        // Si pas de données, afficher tous les muscles comme prêts
        container.innerHTML = muscleGroups.map(muscle => {
            const gradientStyle = `
                background: var(--bg-card);
                border-top: 1px solid var(--border);
                border-right: 1px solid var(--border);
                border-bottom: 1px solid var(--border);
                border-left: 4px solid var(--muscle-${muscle.key});
                position: relative;
            `;

            const overlayStyle = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--muscle-${muscle.key});
                opacity: 0.15;
                z-index: 1;
            `;

            return `
                <div class="muscle-item ready muscle-border-left-${muscle.key}" 
                     style="${gradientStyle}">
                    <div style="${overlayStyle}"></div>
                    <div class="muscle-info">
                        <h4 class="muscle-title-${muscle.key}">${muscle.name}</h4>
                        <p class="muscle-status-text">Prêt à l'entraînement</p>
                    </div>
                    <div class="muscle-indicator">
                        <div class="indicator-dot muscle-bg-${muscle.key}"></div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function isWorkoutComplete(workout) {
    // Pour les séances programme, vérifier si tous les exercices et séries ont été complétés
    if (workout.type !== 'program' || !workout.program_data) return false;
    
    const expectedSets = workout.program_data.exercises.reduce((total, ex) => total + (ex.sets || 3), 0);
    const completedSets = workout.total_sets || 0;
    
    return completedSets >= expectedSets;
}

function loadRecentWorkouts(workouts) {
    const container = document.getElementById('recentWorkouts');
    if (!container) return;

    if (!workouts || workouts.length === 0) {
        container.innerHTML = `
            <div class="empty-workouts">
                <p>Aucune séance récente</p>
                <small>Commencez votre première séance !</small>
            </div>
        `;
        return;
    }

    // Filtrer les séances avec au moins une série
    const validWorkouts = workouts.filter(w => w.total_sets > 0);
    if (validWorkouts.length === 0) {
        container.innerHTML = `
            <div class="empty-workouts">
                <p>Aucune séance récente</p>
                <small>Commencez une séance pour voir votre historique</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = workouts.slice(0, 3).map(workout => {
        // Toutes les variables doivent être déclarées ICI, à l'intérieur du map
        const date = new Date(workout.started_at || workout.completed_at);
        const duration = workout.total_duration_minutes || 0;
        const restTimeSeconds = workout.total_rest_time_seconds || 0;
        const realDurationSeconds = duration * 60;
        const exerciseTimeSeconds = Math.max(0, realDurationSeconds - restTimeSeconds);
        const totalSeconds = duration * 60;
        
        // Variables pour les stats - DÉCLARER ICI
        const totalSets = workout.total_sets || 0;

        const displayDuration = duration;
        const restRatio = displayDuration > 0 ? 
            Math.min((restTimeSeconds / totalSeconds * 100), 100).toFixed(0) : 0;
        
        // Calcul du temps écoulé - CORRECTION FUSEAU HORAIRE
        const now = new Date();
        const workoutDateStr = workout.started_at || workout.completed_at;
        // Forcer l'interprétation UTC si pas de timezone explicite
        const workoutDate = new Date(workoutDateStr + (workoutDateStr.includes('Z') ? '' : 'Z'));
        const diffMs = now - workoutDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

        let timeAgo = 'Aujourd\'hui';
        if (diffDays > 0) {
            timeAgo = diffDays === 1 ? 'Hier' : `Il y a ${diffDays} jours`;
        } else if (diffHours > 0) {
            timeAgo = `Il y a ${diffHours}h`;
        } else {
            timeAgo = 'À l\'instant';
        }
        
        // Récupérer les muscles travaillés
        const musclesWorked = workout.exercises ? 
            [...new Set(workout.exercises.flatMap(ex => ex.muscle_groups || []))] : [];

        // Calculer la distribution musculaire corrigée
        const muscleDistribution = {};
        if (workout.exercises) {
            workout.exercises.forEach(ex => {
                const muscleCount = ex.muscle_groups ? ex.muscle_groups.length : 0;
                if (muscleCount > 0) {
                    ex.muscle_groups.forEach(muscle => {
                        muscleDistribution[muscle] = (muscleDistribution[muscle] || 0) + (1 / muscleCount);
                    });
                }
            });
        }

        // Convertir en pourcentages
        const totalExercises = Object.values(muscleDistribution).reduce((a, b) => a + b, 0);
        const musclePercentages = {};
        Object.entries(muscleDistribution).forEach(([muscle, count]) => {
            musclePercentages[muscle] = Math.round((count / totalExercises) * 100);
        });
        
        // Créer les badges de muscles avec emojis
        const muscleEmojis = {
            'Pectoraux': '🫁',
            'Dos': '🏋🏻‍♂️', 
            'Jambes': '🦵',
            'Épaules': '🤷',
            'Epaules': '🤷',
            'Bras': '🦾',
            'Abdominaux': '🍫'
        };
        
        const muscleBadges = musclesWorked.slice(0, 3).map(muscle => 
            `<span class="muscle-badge">${muscleEmojis[muscle] || '💪'} ${muscle}</span>`
        ).join('');
        
        const additionalMuscles = musclesWorked.length > 3 ? 
            `<span class="muscle-badge more">+${musclesWorked.length - 3}</span>` : '';
        
        // Calculer le volume total
        const totalVolume = workout.total_volume || 0;
        const volumeDisplay = totalVolume > 1000 ? 
            `${(totalVolume / 1000).toFixed(1)}t` : `${totalVolume}kg`;
        
        // Calculer les temps de manière plus robuste
        const totalDurationSeconds = (workout.total_duration_minutes || 0) * 60;
        const exerciseSeconds = workout.total_exercise_time_seconds || 0;
        const restSeconds = workout.total_rest_time_seconds || 0;
        const transitionSeconds = workout.total_transition_time_seconds || 
            Math.max(0, totalDurationSeconds - exerciseSeconds - restSeconds);

        // Calculer les pourcentages pour la barre
        const exercisePercent = totalDurationSeconds > 0 ? 
            (exerciseSeconds / totalDurationSeconds * 100).toFixed(1) : 0;
        const restPercent = totalDurationSeconds > 0 ? 
            (restSeconds / totalDurationSeconds * 100).toFixed(1) : 0;
        const transitionPercent = totalDurationSeconds > 0 ? 
            (transitionSeconds / totalDurationSeconds * 100).toFixed(1) : 0;

        return `
            <div class="workout-card">
                <!-- Ligne 1: Header -->
                <div class="workout-header-line">
                    <div class="workout-type">
                        <span class="type-emoji">${workout.type === 'program' ? '📋' : '🕊️'}</span>
                        <span class="type-text">${workout.type === 'program' ? 'Programme' : 'Séance libre'}</span>
                    </div>
                    <div class="workout-meta">
                        <span class="time-ago">${timeAgo}</span>
                    </div>
                    <div class="workout-duration-main">
                        <span class="duration-value">${displayDuration}</span>
                        <span class="duration-unit">min</span>
                    </div>
                </div>
                
                <!-- Ligne 2: Barre de temps segmentée -->
                <div class="time-distribution-line">
                    <div class="time-bar-container">
                        <div class="time-segment exercise" style="width: ${exercisePercent}%">
                            <span class="segment-emoji">💪</span>
                            <span class="segment-time">${Math.round(exerciseSeconds)}s</span>
                        </div>
                        <div class="time-segment rest" style="width: ${restPercent}%">
                            <span class="segment-emoji">😮‍💨</span>
                            <span class="segment-time">${Math.round(restSeconds)}s</span>
                        </div>
                        <div class="time-segment transition" style="width: ${transitionPercent}%">
                            <span class="segment-emoji">⚙️</span>
                            <span class="segment-time">${Math.round(transitionSeconds)}s</span>
                        </div>
                    </div>
                </div>

                <!-- Ligne 3: Distribution musculaire -->
                <div class="muscle-distribution-line">
                    ${Object.entries(musclePercentages)
                        .sort(([,a], [,b]) => b - a)
                        .map(([muscle, percent]) => {
                            // Normaliser avec majuscule
                            const muscleName = muscle.charAt(0).toUpperCase() + muscle.slice(1).toLowerCase();
                            const emoji = muscleEmojis[muscleName] || muscleEmojis[muscle] || '💪';
                            return `
                                <div class="muscle-badge-proportional" style="flex: ${percent}">
                                    <span class="muscle-emoji">${emoji}</span>
                                    <span class="muscle-name">${muscleName}</span>
                                    <span class="muscle-percent">${percent}%</span>
                                </div>
                            `;
                        }).join('')}
                </div>
                                
                <div class="workout-stats-line">
                    <span class="stat-item">
                        <span class="stat-icon">📊</span>
                        ${totalSets} ${totalSets <= 1 ? 'série' : 'séries'}
                    </span>
                    <span class="stat-item">
                        <span class="stat-icon">⚖️</span>
                        ${volumeDisplay}
                    </span>
                    <span class="stat-item">
                        <span class="stat-icon">🏋️</span>
                        ${(() => {
                            const count = workout.total_exercises || (workout.exercises ? workout.exercises.length : 0);
                            return `${count} ${count <= 1 ? 'exercice' : 'exercices'}`;
                        })()}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

function generateMuscleDistribution(workout) {
    if (!workout.exercises || workout.exercises.length === 0) return '';
    
    const muscleVolumes = {};
    let totalVolume = 0;
    
    // Calculer le volume par muscle
    workout.exercises.forEach(ex => {
        const volume = ex.sets * ex.reps * (ex.weight || 1);
        const muscleCount = (ex.muscle_groups || []).length || 1;
        const volumePerMuscle = volume / muscleCount;
        
        (ex.muscle_groups || []).forEach(muscle => {
            const key = muscle.toLowerCase();
            muscleVolumes[key] = (muscleVolumes[key] || 0) + volumePerMuscle;
            totalVolume += volumePerMuscle;
        });
    });
    
    // Générer les segments
    // Mapping des emojis pour chaque muscle
    const muscleEmojis = {
        'dos': '🏋🏻‍♂️',
        'pectoraux': '🫁',
        'jambes': '🦵',
        'epaules': '🤷🏻',
        'bras': '🦾',
        'abdominaux': '🍫'
    };

    // Générer les segments
    return Object.entries(muscleVolumes)
        .map(([muscle, volume]) => {
            const percentage = Math.round((volume / totalVolume) * 100);
            const emoji = muscleEmojis[muscle] || '💪';
            const muscleName = muscle.charAt(0).toUpperCase() + muscle.slice(1);
            
            return `<div class="muscle-segment"
                        data-muscle="${muscle}"
                        data-percentage="${percentage}%"
                        style="width: ${percentage}%; background: ${window.MuscleColors.getMuscleColor(muscle)}"
                        onclick="toggleMuscleTooltip(this)">
                        <div class="muscle-tooltip">
                            <span class="muscle-emoji">${emoji}</span>
                            <span class="muscle-name">${muscleName}</span>
                            <span class="muscle-percentage">${percentage}%</span>
                        </div>
                    </div>`;
        })
        .join('');
}

// Fonction pour gérer le clic sur les segments
function toggleMuscleTooltip(segment) {
    // Retirer la classe active de tous les autres segments
    document.querySelectorAll('.muscle-segment.active').forEach(s => {
        if (s !== segment) s.classList.remove('active');
    });
    
    // Toggle la classe active sur le segment cliqué
    segment.classList.toggle('active');
    
    // Fermer automatiquement après 3 secondes
    if (segment.classList.contains('active')) {
        setTimeout(() => {
            segment.classList.remove('active');
        }, 3000);
    }
}


// ===== SÉANCES =====
async function startFreeWorkout() {
    try {
        // Nettoyer TOUT l'état avant de commencer
        clearWorkoutState();
        localStorage.removeItem('fitness_workout_state');
        
        // Supprimer toute bannière résiduelle
        const oldBanner = document.querySelector('.workout-resume-banner');
        if (oldBanner) oldBanner.remove();
        
        const workoutData = { type: 'free' };
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        
        currentWorkout = response.workout;
        currentWorkoutSession.type = 'free';
        currentWorkoutSession.workout = response.workout;
        // MODULE 0 : Préserver les propriétés essentielles
        currentWorkoutSession.skipped_exercises = currentWorkoutSession.skipped_exercises || [];
        currentWorkoutSession.session_metadata = currentWorkoutSession.session_metadata || {};

        // MODULE 2 : Initialiser propriétés swap system
        currentWorkoutSession.swaps = currentWorkoutSession.swaps || [];
        currentWorkoutSession.modifications = currentWorkoutSession.modifications || [];
        currentWorkoutSession.pendingSwap = null;
                
        // Toujours resynchroniser les favoris
        try {
            const favoritesResponse = await apiGet(`/api/users/${currentUser.id}/favorites`);
            currentUser.favorite_exercises = favoritesResponse.favorites || [];
            console.log('✅ Favoris resynchronisés pour séance libre:', currentUser.favorite_exercises.length);
        } catch (error) {
            console.log('❌ Erreur sync favoris, utilisation cache:', error);
            currentUser.favorite_exercises = currentUser.favorite_exercises || [];
        }
        
        showView('workout');
        setupFreeWorkout();
        
    } catch (error) {
        console.error('Erreur démarrage séance libre:', error);
        showToast('Erreur lors du démarrage de la séance', 'error');
    }
}

async function startProgramWorkout() {
    console.log('Démarrage séance programme...');
    
    try {
        // Récupérer le programme actif
        let activeProgram = await apiGet(`/api/users/${currentUser.id}/programs/active`);
        
        if (!activeProgram) {
            showToast('Aucun programme actif trouvé', 'error');
            return;
        }
        
        console.log('Programme récupéré:', activeProgram.name);
        
        // SIMPLIFICATION : On force tout en v2.0 avec ML
        // Si vous recréez la BDD, assurez-vous que tous les programmes ont le format exercise_pool
        
        try {
            showToast('Préparation de votre séance personnalisée...', 'info');
            
            // Toujours utiliser la sélection ML
            const mlSession = await apiGet(`/api/users/${currentUser.id}/programs/next-session`);
            console.log('Réponse ML reçue:', mlSession);
            
            // Vérifier la structure de la réponse
            if (!mlSession.selected_exercises || !Array.isArray(mlSession.selected_exercises)) {
                throw new Error('Format de réponse invalide - pas de selected_exercises');
            }
            
            // Enrichir le programme avec la sélection ML
            const enrichedExercises = mlSession.selected_exercises.map(ex => ({
                exercise_id: ex.exercise_id,
                exercise_name: ex.exercise_name || ex.name,
                sets: ex.sets || 3,
                reps: ex.reps || 10,
                rest_seconds: ex.rest_seconds || 90,
                muscle_groups: ex.muscle_groups || [],
                score: ex.score || 0,
                selection_reason: ex.selection_reason || 'Sélection standard',
                ml_selected: true
            }));
            
            // Initialiser la session complète avec toutes les métadonnées
            currentWorkoutSession = {
                type: 'program',
                program: {
                    ...activeProgram,
                    exercises: enrichedExercises  // Remplacer par la sélection ML
                },
                exerciseOrder: 0,
                globalSetCount: 0,
                completedSets: [],
                sessionFatigue: 3,
                currentSetFatigue: null,
                currentSetEffort: null,
                totalWorkoutTime: 0,
                totalRestTime: 0,
                totalSetTime: 0,
                
                // Métadonnées ML
                mlSelection: mlSession,
                formatUsed: 'pool',
                mlSelectionUsed: true,
                sessionMetadata: {
                    totalExercises: enrichedExercises.length,
                    averageScore: (enrichedExercises.reduce((sum, ex) => sum + (ex.score || 0), 0) / enrichedExercises.length).toFixed(3),
                    selectionMethod: 'ML Intelligence',
                    mlConfidence: mlSession.session_metadata?.ml_confidence || 0,
                    muscleDistribution: mlSession.session_metadata?.muscle_distribution || {},
                    warnings: mlSession.session_metadata?.warnings || []
                },
                
                // Pour la phase 1.4
                programExercises: {},
                completedExercisesCount: 0,
                // MODULE 0 : Propriétés essentielles
                skipped_exercises: [],
                session_metadata: {}
            };
            
            // Initialiser l'état de chaque exercice pour la UI
            enrichedExercises.forEach((exerciseData, index) => {
                currentWorkoutSession.programExercises[exerciseData.exercise_id] = {
                    ...exerciseData,
                    completedSets: 0,
                    totalSets: exerciseData.sets || 3,
                    isCompleted: false,
                    index: index,
                    startTime: null,
                    endTime: null,
                    mlReason: exerciseData.selection_reason,
                    mlScore: exerciseData.score
                };
            });
            
            console.log('📊 Session ML configurée:');
            console.log('   Exercices:', currentWorkoutSession.sessionMetadata.totalExercises);
            console.log('   Score moyen:', currentWorkoutSession.sessionMetadata.averageScore);
            console.log('   Confiance ML:', currentWorkoutSession.sessionMetadata.mlConfidence);
            console.log('   Distribution:', currentWorkoutSession.sessionMetadata.muscleDistribution);
            
            // Si des warnings ML, les afficher
            if (currentWorkoutSession.sessionMetadata.warnings.length > 0) {
                currentWorkoutSession.sessionMetadata.warnings.forEach(warning => {
                    showToast(warning, 'warning', 3000);
                });
            }
            
            // Afficher un aperçu de la session si disponible
            if (mlSession.session_metadata && window.showSessionPreview) {
                showSessionPreview(mlSession.session_metadata);
            }
            
            // Afficher le modal de confirmation enrichi
            showProgramStartModal(currentWorkoutSession.program);
            
        } catch (error) {
            console.error('❌ Erreur sélection ML:', error);
            
            // FALLBACK SIMPLE : Si le ML échoue, on prend juste les premiers exercices du pool
            if (activeProgram.exercises?.exercise_pool && activeProgram.exercises.exercise_pool.length > 0) {
                showToast('Sélection ML indisponible - Mode basique', 'warning');
                
                const fallbackExercises = activeProgram.exercises.exercise_pool.slice(0, 6).map((ex, index) => ({
                    exercise_id: ex.exercise_id,
                    exercise_name: ex.name || `Exercice ${index + 1}`,
                    sets: ex.sets || 3,
                    reps: ex.reps || 10,
                    rest_seconds: ex.rest_seconds || 90,
                    muscle_groups: ex.muscle_groups || [],
                    score: 0,
                    selection_reason: 'Sélection de secours',
                    ml_selected: false
                }));
                
                // Initialiser avec le fallback
                currentWorkoutSession = {
                    type: 'program',
                    program: {
                        ...activeProgram,
                        exercises: fallbackExercises
                    },
                    exerciseOrder: 0,
                    globalSetCount: 0,
                    completedSets: [],
                    sessionFatigue: 3,
                    formatUsed: 'fallback',
                    mlSelectionUsed: false,
                    sessionMetadata: {
                        totalExercises: fallbackExercises.length,
                        selectionMethod: 'Fallback (ML indisponible)'
                    }
                };
                
                showProgramStartModal(currentWorkoutSession.program);
                
            } else {
                showToast('Erreur : Format de programme incompatible', 'error');
                console.error('Programme sans exercise_pool:', activeProgram);
            }
        }
        
    } catch (error) {
        console.error('Erreur chargement programme:', error);
        showToast('Erreur lors du chargement du programme', 'error');
    }
}

async function setupProgramWorkoutWithSelection(program, sessionData) {
    // Vérification de sécurité
    if (!program || !sessionData || !sessionData.selected_exercises) {
        console.error('Données de session invalides:', sessionData);
        showToast('Erreur : données de session invalides', 'error');
        return;
    }
    
    document.getElementById('workoutTitle').textContent = 'Séance programme';
    document.getElementById('exerciseSelection').style.display = 'none';
    
    // Stocker le programme et la sélection ML dans la session
    currentWorkoutSession.program = program;
    currentWorkoutSession.mlSelection = sessionData;
    currentWorkoutSession.programExercises = {};
    currentWorkoutSession.completedExercisesCount = 0;
    currentWorkoutSession.type = 'program';
    currentWorkoutSession.exerciseOrder = 0;
    // MODULE 0 : Préserver les propriétés
    currentWorkoutSession.skipped_exercises = currentWorkoutSession.skipped_exercises || [];
    currentWorkoutSession.session_metadata = currentWorkoutSession.session_metadata || {};
        
    // Initialiser l'état de chaque exercice sélectionné par le ML
    sessionData.selected_exercises.forEach((exerciseData, index) => {
        currentWorkoutSession.programExercises[exerciseData.exercise_id] = {
            ...exerciseData,
            completedSets: 0,
            totalSets: exerciseData.sets || 3,
            isCompleted: false,
            index: index,
            startTime: null,
            endTime: null,
            mlReason: exerciseData.selection_reason || null,
            mlScore: exerciseData.score || null,
            // MODULE 2 : Propriétés swap
            swapped: false,
            swappedFrom: null,
            swappedTo: null,
            swapReason: null
        };
    });

// MODULE 2 : Initialiser les propriétés swap pour cette session
currentWorkoutSession.swaps = currentWorkoutSession.swaps || [];
currentWorkoutSession.modifications = currentWorkoutSession.modifications || [];
currentWorkoutSession.pendingSwap = null;
    
    // Remplacer les exercices du programme par ceux sélectionnés
    program.exercises = sessionData.selected_exercises;
    
    // Afficher la liste des exercices
    document.getElementById('programExercisesContainer').style.display = 'block';
    loadProgramExercisesList();
    
    // Afficher un aperçu de la session si des données sont disponibles
    if (sessionData.session_metadata) {
        showSessionPreview(sessionData.session_metadata);
    }
    
    // Prendre le premier exercice
    const firstExercise = sessionData.selected_exercises[0];
    if (firstExercise) {
        setTimeout(() => selectProgramExercise(firstExercise.exercise_id, true), 500);
    }
    
    enableHorizontalScroll();
    startWorkoutTimer();
}

function showSessionPreview(metadata) {
    if (!metadata) return;
    
    const previewHTML = `
        <div class="session-preview">
            <div class="preview-header">
                <h4>📊 Aperçu de votre séance personnalisée</h4>
                ${metadata.ml_confidence ? `<span class="ml-confidence">Confiance ML: ${Math.round(metadata.ml_confidence * 100)}%</span>` : ''}
            </div>
            <div class="preview-content">
                ${metadata.muscle_distribution ? `
                    <div class="muscle-distribution">
                        <h5>Répartition musculaire</h5>
                        <div class="distribution-bar">
                            ${generateMuscleDistribution(metadata.muscle_distribution)}
                        </div>
                    </div>
                ` : ''}
                ${metadata.estimated_duration ? `
                    <p><i class="fas fa-clock"></i> Durée estimée: ${metadata.estimated_duration} min</p>
                ` : ''}
                ${metadata.warnings && metadata.warnings.length > 0 ? `
                    <div class="session-warnings">
                        ${metadata.warnings.map(w => `<p class="warning"><i class="fas fa-exclamation-triangle"></i> ${w}</p>`).join('')}
                    </div>
                ` : ''}
            </div>
            <button class="btn-secondary" onclick="regenerateSession()">
                <i class="fas fa-sync"></i> Régénérer la sélection
            </button>
        </div>
    `;
    
    // Afficher le preview dans un toast ou modal temporaire
    // Créer un conteneur temporaire pour le preview
    const previewContainer = document.createElement('div');
    previewContainer.innerHTML = previewHTML;
    previewContainer.style.cssText = `
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1000;
        max-width: 400px;
        animation: slideIn 0.3s ease;
    `;

    // Ajouter au body
    document.body.appendChild(previewContainer);

    // Retirer après 5 secondes
    setTimeout(() => {
        previewContainer.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => previewContainer.remove(), 300);
    }, 5000);
}
async function regenerateSession() {
    if (!currentWorkoutSession.program) return;
    
    try {
        showToast('Génération d\'une nouvelle sélection...', 'info');
        const session = await apiGet(`/api/users/${currentUser.id}/programs/next-session`);
        
        // Réinitialiser avec la nouvelle sélection
        currentWorkoutSession.programExercises = {};
        currentWorkoutSession.completedExercisesCount = 0;
        currentWorkoutSession.exerciseOrder = 0;
        
        await setupProgramWorkoutWithSelection(currentWorkoutSession.program, session);
        showToast('Nouvelle sélection générée !', 'success');
        
    } catch (error) {
        console.error('Erreur régénération:', error);
        showToast('Impossible de régénérer la sélection', 'error');
    }
}

// Fonction helper pour enrichir le modal de démarrage
function showProgramStartModal(program) {
    if (!program) {
        console.error('Programme invalide pour le modal');
        return;
    }
    
    // Calculer la durée estimée et le nombre d'exercices
    const exerciseCount = program.exercises.length;
    const estimatedDuration = program.session_duration_minutes || 45;
    const isMLSelected = program.exercises[0]?.ml_selected || false;
    const formatType = currentWorkoutSession?.formatUsed || 'unknown';
    
    // Vérifier si les éléments modal existent
    const modalElement = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    if (!modalElement || !modalTitle || !modalBody) {
        // Fallback : utiliser confirm() temporaire
        const message = `🚀 Démarrer "${program.name}" ?\n\n` +
                       `📊 ${exerciseCount} exercices (${estimatedDuration}min)\n` +
                       `${isMLSelected ? '🧠 Sélection ML activée' : '📋 Programme standard'}\n` +
                       `🎯 Format: ${formatType === 'pool' ? 'Pool dynamique' : 'Liste statique'}`;
        
        if (confirm(message)) {
            confirmStartProgramWorkout();
        }
        return;
    }
    
    // Créer le contenu du modal enrichi
    const modalContentHTML = `
        <div class="program-start-info">
            <h3>${program.name}</h3>
            <div class="program-details">
                <p><strong>Exercices :</strong> ${exerciseCount}</p>
                <p><strong>Durée estimée :</strong> ${estimatedDuration} min</p>
                <p><strong>Focus :</strong> ${program.focus_areas?.join(', ') || 'Non spécifié'}</p>
                ${isMLSelected ? `
                    <p><strong>🧠 Sélection :</strong> Intelligence ML activée</p>
                ` : `
                    <p><strong>📋 Sélection :</strong> Programme standard</p>
                `}
                <p><strong>Format :</strong> ${formatType === 'pool' ? 'Pool dynamique' : 'Liste statique'}</p>
            </div>
            
            ${isMLSelected ? `
                <div class="ml-info" style="
                    background: var(--primary-light); 
                    border-radius: 8px; 
                    padding: 1rem; 
                    margin: 1rem 0;
                    border-left: 4px solid var(--primary);
                ">
                    <h4 style="margin: 0 0 0.5rem 0; color: var(--primary);">
                        🎯 Exercices sélectionnés intelligemment
                    </h4>
                    <p style="margin: 0; font-size: 0.9rem; color: var(--text-muted);">
                        Basé sur votre récupération musculaire, historique et objectifs
                    </p>
                </div>
            ` : ''}
            
            <div class="exercise-list" style="margin-top: 1rem; max-height: 200px; overflow-y: auto;">
                <h4>Programme du jour :</h4>
                <ul style="list-style: none; padding: 0;">
                    ${program.exercises.map((ex, index) => `
                        <li style="
                            padding: 0.5rem 0; 
                            border-bottom: 1px solid var(--border);
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        ">
                            <span>
                                ${index + 1}. ${ex.exercise_name} 
                                <small style="color: var(--text-muted);">
                                    (${ex.sets || 3}×${ex.reps_min || 10}-${ex.reps_max || 12})
                                </small>
                            </span>
                            ${ex.ml_selected && ex.priority_score ? `
                                <small style="
                                    background: var(--primary-light);
                                    color: var(--primary);
                                    padding: 0.2rem 0.4rem;
                                    border-radius: 4px;
                                    font-weight: 500;
                                ">
                                    ${ex.priority_score.toFixed(2)}
                                </small>
                            ` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        </div>
        
        <div class="modal-actions" style="margin-top: 1.5rem; display: flex; gap: 1rem;">
            <button class="btn btn-secondary" onclick="closeModal()" style="flex: 1;">
                Annuler
            </button>
            <button class="btn btn-primary" onclick="confirmStartProgramWorkout()" style="flex: 2;">
                🚀 Commencer la séance
            </button>
        </div>
    `;
    
    // Afficher le modal
    modalTitle.textContent = 'Démarrage séance programme';
    modalBody.innerHTML = modalContentHTML;
    modalElement.style.display = 'flex';
}

// Nouvelle fonction pour afficher le panneau de preview
async function showProgramPreview(program, status) {
    // Récupérer les détails des exercices SANS recommandations
    let exerciseDetails = [];
    
    if (program.exercises && program.exercises.length > 0) {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        
        for (let i = 0; i < Math.min(program.exercises.length, 7); i++) {
            const ex = program.exercises[i];
            const exerciseInfo = exercises.find(e => e.id === ex.exercise_id);
            
            if (exerciseInfo) {
                exerciseDetails.push({
                    name: exerciseInfo.name,
                    sets: ex.sets || 3,
                    reps_min: ex.reps_min || exerciseInfo.default_reps_min || 8,
                    reps_max: ex.reps_max || exerciseInfo.default_reps_max || 12
                });
            }
        }
    }
    
    // Créer la liste formatée avec une fourchette de reps
    const exercisesList = exerciseDetails
        .map(ex => {
            const repsStr = ex.reps_min === ex.reps_max ? 
                `${ex.reps_min}` : 
                `${ex.reps_min}-${ex.reps_max}`;
            
            return `
                <li style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem;
                    background: var(--bg-secondary);
                    border-radius: 6px;
                    margin-bottom: 0.5rem;
                ">
                    <span style="font-weight: 500;">${ex.name}</span>
                    <span style="
                        color: var(--primary);
                        font-weight: 600;
                        font-size: 0.9rem;
                    ">${ex.sets}×${repsStr}</span>
                </li>`;
        }).join('');
    
    const hasMore = program.exercises.length > 7 ? 
        `<li style="
            text-align: center;
            color: var(--text-muted);
            padding: 0.5rem;
            font-style: italic;
        ">+${program.exercises.length - 7} autres exercices</li>` : '';
    
    // Analyser les changements ML
    let adaptationsHtml = '';
    if (status && status.next_session_preview.ml_adaptations !== 'Standard') {
        adaptationsHtml = `
            <div style="
                background: var(--info-light);
                border: 1px solid var(--info);
                border-radius: 8px;
                padding: 1rem;
                margin-bottom: 1.5rem;
            ">
                <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--info-dark);">
                    <i class="fas fa-brain"></i> Adaptations intelligentes
                </h4>
                <div style="font-size: 0.85rem; color: var(--info-dark);">
                    ${status.next_session_preview.ml_adaptations}
                </div>
            </div>
        `;
    }
    
    // Toggle pour la préférence de poids
    const weightToggleHtml = `
        <div style="
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
        ">
            <span style="font-size: 0.9rem;">
                <i class="fas fa-weight"></i> Variation des poids entre séries
            </span>
            <label class="toggle-switch" style="margin: 0;">
                <input type="checkbox" id="tempWeightPreference"
                       ${currentUser.prefer_weight_changes_between_sets ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>
    `;
    
    const modalContent = `
        <div style="max-width: 600px; margin: 0 auto;">
            <!-- Header avec progression -->
            <div style="
                background: var(--primary-light);
                margin: -1rem -1.5rem 1.5rem;
                padding: 1.5rem;
                text-align: center;
                border-radius: 8px 8px 0 0;
            ">
                <h2 style="margin: 0 0 0.5rem 0; color: var(--primary);">
                    ${status ? status.next_session_preview.muscles : 'Séance Programme'}
                </h2>
                <p style="margin: 0; color: var(--primary-dark); opacity: 0.8;">
                    Semaine ${status ? status.current_week : '1'} • 
                    ${status ? status.next_session_preview.estimated_duration : program.session_duration_minutes}min
                </p>
            </div>
            
            <!-- Toggle préférence de poids -->
            ${weightToggleHtml}
            
            <!-- Liste des exercices -->
            <div style="margin-bottom: 1.5rem;">
                <h3 style="margin: 0 0 1rem 0; font-size: 1rem;">
                    Programme du jour (${exerciseDetails.length} exercices)
                </h3>
                <ul style="list-style: none; padding: 0; margin: 0;">
                    ${exercisesList}
                    ${hasMore}
                </ul>
            </div>
            
            <!-- Adaptations ML si présentes -->
            ${adaptationsHtml}
            
            <!-- Note sur les recommandations -->
            <div style="
                background: var(--bg-light);
                border-radius: 6px;
                padding: 0.75rem;
                margin-bottom: 1.5rem;
                font-size: 0.85rem;
                color: var(--text-muted);
                text-align: center;
            ">
                <i class="fas fa-info-circle"></i> 
                Les poids et répétitions exacts seront calculés par l'IA pendant la séance
            </div>
            
            <!-- Actions -->
            <div style="display: flex; gap: 1rem;">
                <button class="btn btn-primary" style="flex: 1;" onclick="confirmStartProgramWorkout()">
                    <i class="fas fa-play"></i> Commencer
                </button>
                <button class="btn btn-secondary" onclick="closeModal()">
                    Annuler
                </button>
            </div>
        </div>
    `;
    
    showModal('Aperçu de votre séance', modalContent);
    
    // Ajouter l'event listener pour le toggle temporaire
    setTimeout(() => {
        const tempToggle = document.getElementById('tempWeightPreference');
        if (tempToggle) {
            tempToggle.addEventListener('change', async (e) => {
                try {
                    await apiPut(`/api/users/${currentUser.id}/preferences`, {
                        prefer_weight_changes_between_sets: e.target.checked
                    });
                    currentUser.prefer_weight_changes_between_sets = e.target.checked;
                    showToast('Préférence mise à jour', 'success');
                } catch (error) {
                    e.target.checked = !e.target.checked;
                    showToast('Erreur lors de la mise à jour', 'error');
                }
            });
        }
    }, 100);
}

// Nouvelle fonction pour confirmer et démarrer vraiment la séance
async function confirmStartProgramWorkout() {
    console.log('1. confirmStartProgramWorkout - début');
    console.log('2. currentWorkoutSession:', currentWorkoutSession);
    console.log('3. currentWorkoutSession.program:', currentWorkoutSession?.program);
    
    try {
        // Vérifier que la session est bien initialisée
        if (!currentWorkoutSession || !currentWorkoutSession.program) {
            console.error('Session non initialisée:', currentWorkoutSession);
            showToast('Erreur : session non initialisée', 'error');
            return;
        }
        
        // Créer la séance avec le programme de la session
        const workoutData = {
            type: 'program',
            program_id: currentWorkoutSession.program.id
        };
        
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        currentWorkout = response.workout;  // L'API retourne {message: "...", workout: {...}}
                
        // Appeler setupProgramWorkout avec le programme de la session
        await setupProgramWorkout(currentWorkoutSession.program);
        
        // Fermer le modal et passer à l'écran de séance
        closeModal();
        showView('workout');
        
    } catch (error) {
        console.error('Erreur démarrage séance:', error);
        showToast('Erreur lors du démarrage', 'error');
    }
}

function setupFreeWorkout() {
    // Supprimer ou commenter cette ligne qui cause l'erreur
    // document.getElementById('workoutTitle').textContent = '🕊️ Séance libre';
    
    // Afficher les sections appropriées
    const exerciseSelection = document.getElementById('exerciseSelection');
    const currentExercise = document.getElementById('currentExercise');
    const programExercisesContainer = document.getElementById('programExercisesContainer');
    const workoutHeader = document.getElementById('workoutHeader');
    const fatigueTracker = document.getElementById('fatigueTracker');
    
    if (exerciseSelection) exerciseSelection.style.display = 'block';
    if (currentExercise) currentExercise.style.display = 'none';
    if (programExercisesContainer) programExercisesContainer.style.display = 'none';
    if (workoutHeader) workoutHeader.style.display = 'block';
    if (fatigueTracker) fatigueTracker.style.display = 'block';

    loadAvailableExercises();
    enableHorizontalScroll();
    startWorkoutTimer();
}

async function setupProgramWorkout(program) {
    // Vérification de sécurité
    if (!program || !program.exercises) {
        console.error('Programme invalide:', program);
        showToast('Erreur : programme invalide', 'error');
        return;
    }
    
    // Configurer le titre SI L'ÉLÉMENT EXISTE
    const workoutTitle = document.getElementById('workoutTitle');
    if (workoutTitle) {
        workoutTitle.textContent = 'Séance programme';
    }
    
    // Cacher la sélection d'exercices SI ELLE EXISTE
    const exerciseSelection = document.getElementById('exerciseSelection');
    if (exerciseSelection) {
        exerciseSelection.style.display = 'none';
    }
    
    // Stocker le programme dans la session - CONSERVER TOUTES LES PROPRIÉTÉS
    currentWorkoutSession.program = program;
    currentWorkoutSession.programExercises = {};
    currentWorkoutSession.completedExercisesCount = 0;
    currentWorkoutSession.type = 'program'; // Important pour les vérifications
    currentWorkoutSession.exerciseOrder = 0; // Initialisé à 0, sera incrémenté à 1 lors de la sélection
    // MODULE 0 : Préserver les propriétés
    currentWorkoutSession.skipped_exercises = currentWorkoutSession.skipped_exercises || [];
    currentWorkoutSession.session_metadata = currentWorkoutSession.session_metadata || {};

    // MODULE 2 : Initialiser propriétés swap system
    currentWorkoutSession.swaps = currentWorkoutSession.swaps || [];
    currentWorkoutSession.modifications = currentWorkoutSession.modifications || [];
    currentWorkoutSession.pendingSwap = null;

    // Initialiser l'état de chaque exercice - CONSERVER
    program.exercises.forEach((exerciseData, index) => {
        currentWorkoutSession.programExercises[exerciseData.exercise_id] = {
            ...exerciseData,
            completedSets: 0,
            totalSets: exerciseData.sets || 3,
            isCompleted: false,
            index: index,
            startTime: null,
            endTime: null,
            // MODULE 2 : Propriétés swap
            swapped: false,
            swappedFrom: null,
            swappedTo: null,
            swapReason: null
        };
    });
    
    // Afficher la liste des exercices SI LE CONTAINER EXISTE
    const programExercisesContainer = document.getElementById('programExercisesContainer');
    if (programExercisesContainer) {
        programExercisesContainer.style.display = 'block';
    }
    
    // Charger la liste
    loadProgramExercisesList();
    
    // Prendre le premier exercice non complété
    const firstExercise = program.exercises[0];
    if (firstExercise) {
        // Attendre que la sélection soit terminée avant de continuer
        await selectProgramExercise(firstExercise.exercise_id, true);
    }
    
    startWorkoutTimer();
    // Note: loadProgramExercisesList() est appelé deux fois dans l'original, je conserve ce comportement
    loadProgramExercisesList();
}

// Fonction pour sélectionner un exercice par ID
async function selectExerciseById(exerciseId) {
    try {
        // Récupérer l'exercice depuis l'API
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const exercise = exercises.find(ex => ex.id === exerciseId);
        
        if (exercise) {
            selectExercise({
                id: exercise.id,
                name: exercise.name,
                instructions: exercise.instructions || '',
                muscle_groups: exercise.muscle_groups,
                equipment_required: exercise.equipment_required || [],
                difficulty: exercise.difficulty,
                default_sets: exercise.default_sets || 3,
                default_reps_min: exercise.default_reps_min || 8,
                default_reps_max: exercise.default_reps_max || 12,
                base_rest_time_seconds: exercise.base_rest_time_seconds || 90
            });
        }
    } catch (error) {
        console.error('Erreur sélection exercice:', error);
        showToast('Erreur lors de la sélection', 'error');
    }
}


async function selectExercise(exercise, skipValidation = false) {
    // Pour le setup initial, on peut skipper la validation
    if (!skipValidation && !validateSessionState(true)) return;
    
    // Vérifier que l'exercice est valide
    if (!exercise || !exercise.id) {
        console.error('Exercice invalide:', exercise);
        showToast('Erreur: exercice invalide', 'error');
        return;
    }
    
    currentExercise = exercise;
    currentSet = currentSet || 1;
    
    // Récupérer les détails complets de l'exercice si nécessaire
    if (!exercise.weight_type) {
        try {
            const fullExercise = await apiGet(`/api/exercises/${exercise.id}`);
            currentExercise = fullExercise;
        } catch (error) {
            console.error('Erreur chargement exercice complet:', error);
            currentExercise = exercise;
        }
    } else {
        currentExercise = exercise;
    }
    
    currentSet = 1;
    currentWorkoutSession.currentExercise = exercise;
    currentWorkoutSession.currentSetNumber = 1;
    currentWorkoutSession.totalSets = exercise.default_sets || 3;
    currentWorkoutSession.maxSets = 6;
   
    // Enregistrer le début de l'exercice
    workoutState.exerciseStartTime = new Date();
   
    document.getElementById('exerciseSelection').style.display = 'none';
    document.getElementById('currentExercise').style.display = 'block';
    if (currentWorkoutSession.type === 'program') {
        const programExercisesContainer = document.getElementById('programExercisesContainer');
        if (programExercisesContainer) {
            programExercisesContainer.style.display = 'block';
        }
    }
    document.getElementById('exerciseName').textContent = exercise.name;
    document.getElementById('exerciseInstructions').textContent = exercise.instructions || 'Effectuez cet exercice avec une forme correcte';

    // Initialiser les settings ML pour cet exercice
    if (!currentWorkoutSession.mlSettings) {
        currentWorkoutSession.mlSettings = {};
    }
    if (!currentWorkoutSession.mlSettings[exercise.id]) {
        currentWorkoutSession.mlSettings[exercise.id] = {
            autoAdjust: currentUser.prefer_weight_changes_between_sets,
            lastManualWeight: null,
            lastMLWeight: null,
            confidence: null
        };
    }

    // Afficher le toggle ML si exercice avec poids
    if (exercise.weight_type !== 'bodyweight' && exercise.exercise_type !== 'isometric') {
        const mlToggleHtml = renderMLToggle(exercise.id);
        const exerciseHeader = document.querySelector('#currentExercise .exercise-header');
        if (exerciseHeader) {
            const existingToggle = exerciseHeader.querySelector('.ml-toggle-container');
            if (existingToggle) existingToggle.remove();
            exerciseHeader.insertAdjacentHTML('beforeend', mlToggleHtml);
        }
    }
    // Gérer l'affichage du bouton "Changer d'exercice" selon le mode
    const changeExerciseBtn = document.querySelector('.btn-change-exercise');
    if (changeExerciseBtn) {
        changeExerciseBtn.style.display = currentWorkoutSession.type === 'program' ? 'none' : 'flex';
    }
    
    updateSeriesDots();
   
    // Appeler les recommandations dans un try-catch pour éviter les interruptions
    try {
        await updateSetRecommendations();
    } catch (error) {
        console.error('Erreur recommandations:', error);
        // Continuer malgré l'erreur
    }
   
    // Mettre à jour les compteurs d'en-tête
    updateHeaderProgress();
   
    // Forcer la transition vers READY après sélection
    transitionTo(WorkoutStates.READY);
    
    // Démarrer le timer de la première série
    startSetTimer();
}

// Nouvelle fonction pour le rendu du toggle ML
function renderMLToggle(exerciseId) {
    const isEnabled = currentWorkoutSession.mlSettings[exerciseId]?.autoAdjust ?? 
                     currentUser.prefer_weight_changes_between_sets;
    
    return `
        <div class="ml-toggle-container">
            <label class="toggle-switch">
                <input type="checkbox" 
                       id="mlToggle-${exerciseId}"
                       ${isEnabled ? 'checked' : ''}
                       onchange="toggleMLAdjustment(${exerciseId})">
                <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">
                <i class="fas fa-brain"></i> Ajustement IA
                ${isEnabled ? '(Actif)' : '(Manuel)'}
            </span>
        </div>
    `;
}

// PHASE 2.2 : Indicateurs de confiance
// Confiance ML
function renderMLConfidence(confidence) {
    if (!confidence || confidence === 1.0) return '';
    
    const level = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
    const icon = { 'high': '🟢', 'medium': '🟡', 'low': '🔴' }[level];
    const text = { 'high': 'Confiance élevée', 'medium': 'Confiance modérée', 'low': 'Confiance faible' }[level];
    
    return `
        <div class="ml-confidence" title="${text}: ${Math.round(confidence * 100)}%">
            ${icon} ${Math.round(confidence * 100)}%
        </div>
    `;
}

// Fonction pour gérer le toggle
function toggleMLAdjustment(exerciseId) {
    console.log('🔄 Toggle ML appelé pour exercice:', exerciseId);
    
    if (!currentWorkoutSession.mlSettings) {
        currentWorkoutSession.mlSettings = {};
    }
    
    if (!currentWorkoutSession.mlSettings[exerciseId]) {
        currentWorkoutSession.mlSettings[exerciseId] = {
            autoAdjust: currentUser?.prefer_weight_changes_between_sets ?? true
        };
    }
    
    // CORRECTION : Lire depuis l'événement au lieu du DOM
    const toggleElement = document.getElementById(`mlToggle-${exerciseId}`) || document.getElementById('mlToggle');
    
    if (!toggleElement) {
        console.error('❌ Toggle ML introuvable');
        return;
    }
    
    // L'état est déjà changé par le navigateur, on lit la nouvelle valeur
    const newState = toggleElement.checked;
    
    // Mettre à jour l'état interne
    currentWorkoutSession.mlSettings[exerciseId].autoAdjust = newState;
    
    console.log('🔄 Nouvel état ML:', newState);
    
    // Mettre à jour immédiatement tous les autres éléments UI
    const aiStatusEl = document.getElementById('aiStatus');
    if (aiStatusEl) {
        aiStatusEl.textContent = newState ? 'Actif' : 'Inactif';
        aiStatusEl.className = newState ? 'status-active' : 'status-inactive';
    }
    
    // Mettre à jour le label du toggle
    const toggleLabel = toggleElement.closest('.ml-toggle-container')?.querySelector('.toggle-label');
    if (toggleLabel) {
        toggleLabel.innerHTML = `<i class="fas fa-brain"></i> Ajustement IA ${newState ? '(Actif)' : '(Manuel)'}`;
    }
    
    // Appliquer les changements immédiatement
    if (typeof updateSetRecommendations === 'function') {
        updateSetRecommendations();
    }
    
    showToast(`Ajustement IA ${newState ? 'activé' : 'désactivé'}`, 'info');
}

// === PHASE 2.2 : VISUALISATION TRANSPARENTE ML ===

// Component d'explication ML
function renderMLExplanation(recommendation) {
    // Ne pas afficher si pas de reasoning ou si c'est banal
    if (!recommendation || !recommendation.reasoning || 
        recommendation.reasoning === "Conditions normales" || 
        recommendation.reasoning === "Mode manuel activé") {
        return '';
    }
    
    const changeIcon = {
        'increase': '↗️',
        'decrease': '↘️', 
        'same': '➡️'
    };
    
    // Déterminer la couleur selon le type de changement
    const changeClass = recommendation.weight_change === 'increase' ? 'ml-increase' : 
                       recommendation.weight_change === 'decrease' ? 'ml-decrease' : 
                       'ml-same';
    
    return `
        <div class="ml-explanation ${changeClass}">
            <div class="ml-badge">
                <i class="fas fa-brain"></i> 
                <span class="ml-change-icon">${changeIcon[recommendation.weight_change] || '➡️'}</span>
            </div>
            <div class="ml-reasoning">
                ${recommendation.reasoning}
            </div>
            ${recommendation.baseline_weight ? 
                `<div class="ml-baseline">
                    <span class="baseline-label">Base:</span> ${recommendation.baseline_weight}kg 
                    → <span class="suggested-weight">${recommendation.weight_recommendation}kg</span>
                </div>` : ''
            }
            ${recommendation.confidence ? renderMLConfidence(recommendation.confidence) : ''}
        </div>
    `;
}

function displayRecommendations(recommendations) {
    if (!recommendations) return;
    
    // Récupérer les poids disponibles
    const availableWeights = JSON.parse(sessionStorage.getItem('availableWeights') || '[]');
    
    // Mettre à jour le poids suggéré avec validation
    const weightElement = document.getElementById('setWeight');
    if (weightElement && recommendations.weight_recommendation) {
        const currentWeight = parseFloat(weightElement.textContent);
        let targetWeight = recommendations.weight_recommendation;
        
        // VALIDATION : Vérifier que le poids est réalisable
        if (availableWeights.length > 0 && !availableWeights.includes(targetWeight)) {
            console.error('[Display] Poids ML non réalisable:', targetWeight);
            console.log('[Display] Poids disponibles:', availableWeights);
            
            // Trouver le plus proche
            const closest = availableWeights.reduce((prev, curr) => 
                Math.abs(curr - targetWeight) < Math.abs(prev - targetWeight) ? curr : prev
            );
            
            console.log('[Display] Ajustement:', targetWeight, '→', closest);
            showToast(`Poids ajusté à ${closest}kg (équipement disponible)`, 'warning');
            
            targetWeight = closest;
            
            // Mettre à jour la recommandation pour cohérence
            recommendations.weight_recommendation = closest;
        }
        
        // Mettre à jour l'affichage si différent
        if (currentWeight !== targetWeight) {
            weightElement.textContent = targetWeight;
            
            // Ajouter animation
            weightElement.classList.add('ml-updated');
            setTimeout(() => weightElement.classList.remove('ml-updated'), 600);
        }
    }
    
    // Afficher l'explication ML dans le bon conteneur
    const explanationContainer = document.querySelector('.ml-explanation-wrapper') || 
                               document.getElementById('mlExplanation');
    
    if (explanationContainer) {
        const explanationHTML = renderMLExplanation(recommendations);
        if (explanationHTML) {
            explanationContainer.innerHTML = explanationHTML;
            explanationContainer.style.display = 'block';
        } else {
            explanationContainer.style.display = 'none';
        }
    }
    
    // Mettre à jour l'aide au montage avec le poids validé
    if (currentUser?.show_plate_helper && recommendations.weight_recommendation) {
        console.log('[Display] Mise à jour aide montage avec:', recommendations.weight_recommendation);
        setTimeout(() => updatePlateHelper(recommendations.weight_recommendation), 100);
    }
    
    // Afficher les indicateurs de confiance si disponibles
    if (typeof renderConfidenceIndicators === 'function') {
        renderConfidenceIndicators(recommendations);
    }
    
    // Mettre à jour l'historique ML
    if (typeof addToMLHistory === 'function' && currentExercise) {
        addToMLHistory(currentExercise.id, recommendations);
    }
}

// Historique ML
function addToMLHistory(exerciseId, recommendation) {
    if (!currentWorkoutSession.mlHistory) {
        currentWorkoutSession.mlHistory = {};
    }
    
    if (!currentWorkoutSession.mlHistory[exerciseId]) {
        currentWorkoutSession.mlHistory[exerciseId] = [];
    }
    
    currentWorkoutSession.mlHistory[exerciseId].push({
        setNumber: currentSet,
        timestamp: new Date(),
        weight: recommendation.weight_recommendation || recommendation.weight,
        reps: recommendation.reps_recommendation || recommendation.reps,
        confidence: recommendation.confidence || 0,
        reasoning: recommendation.reasoning || "Recommandation standard",
        accepted: null
    });
}

// Affichage de l'historique ML
function renderMLHistory(exerciseId) {
    const history = currentWorkoutSession.mlHistory?.[exerciseId] || [];
    
    if (history.length === 0) {
        return '';
    }
    
    // Ne montrer que les 5 dernières pour l'espace
    const recentHistory = history.slice(-5);
    
    return `
        <div class="ml-history-container">
            <div class="ml-history-header" onclick="toggleMLHistory()">
                <h4>
                    <i class="fas fa-history"></i> 
                    Historique IA 
                    <span class="history-count">(${history.length})</span>
                </h4>
                <i class="fas fa-chevron-down toggle-icon"></i>
            </div>
            <div class="ml-history-timeline" id="mlHistoryTimeline" style="display: none;">
                ${recentHistory.map(h => `
                    <div class="ml-history-item ${h.accepted === false ? 'modified' : h.accepted === true ? 'accepted' : 'pending'}">
                        <div class="history-header">
                            <span class="set-num">Série ${h.setNumber}</span>
                            <span class="history-time">${formatTimeAgo(h.timestamp)}</span>
                        </div>
                        <div class="history-content">
                            <span class="history-weight">${h.weight}kg</span>
                            ${h.reps ? `<span class="history-reps">× ${h.reps}</span>` : ''}
                            <span class="history-confidence" title="Confiance: ${Math.round(h.confidence * 100)}%">
                                ${getConfidenceIcon(h.confidence)}
                            </span>
                        </div>
                        <div class="history-reason">${h.reason}</div>
                        ${h.accepted === false ? '<div class="override-badge">Modifié par vous</div>' : ''}
                    </div>
                `).join('')}
                ${history.length > 5 ? `
                    <div class="history-more">
                        ... et ${history.length - 5} autres ajustements
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Helpers pour l'affichage
function formatTimeAgo(timestamp) {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    if (seconds < 60) return 'À l\'instant';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Il y a ${minutes}min`;
    return `Il y a ${Math.floor(minutes / 60)}h`;
}

function getConfidenceIcon(confidence) {
    if (confidence >= 0.8) return '🟢';
    if (confidence >= 0.6) return '🟡';
    return '🔴';
}

// Toggle historique ML
function toggleMLHistory() {
    const timeline = document.getElementById('mlHistoryTimeline');
    const icon = document.querySelector('.toggle-icon');
    
    if (timeline.style.display === 'none') {
        timeline.style.display = 'block';
        icon.textContent = '▲';
        updateMLHistoryDisplay();
    } else {
        timeline.style.display = 'none';
        icon.textContent = '▼';
    }
}

// Enregistrer décision ML
function recordMLDecision(exerciseId, setNumber, accepted) {
    if (!currentWorkoutSession.mlHistory?.[exerciseId]) return;
    
    const history = currentWorkoutSession.mlHistory[exerciseId];
    const lastEntry = history[history.length - 1];
    if (lastEntry) {
        lastEntry.accepted = accepted;
    }
    
    // Optionnel : envoyer au backend pour apprentissage
    apiPost(`/api/ml/feedback`, {
        exercise_id: exerciseId,
        set_number: setNumber,
        recommendation: lastEntry,
        accepted: accepted
    }).catch(err => console.warn('ML feedback failed:', err));
}

// Mettre à jour l'affichage de l'historique ML
function updateMLHistoryDisplay() {
    if (!currentExercise || !currentWorkoutSession.mlHistory) return;
    
    const history = currentWorkoutSession.mlHistory[currentExercise.id];
    if (!history || history.length === 0) return;
    
    // Mettre à jour le compteur S'IL EXISTE
    const countEl = document.getElementById('mlHistoryCount');
    if (countEl) {
        countEl.textContent = history.length;
    }
    
    // Afficher l'historique S'IL EXISTE un container
    const container = document.getElementById('mlHistoryContainer');
    if (container) {
        container.innerHTML = history.slice(-3).map((entry, idx) => `
            <div class="ml-history-item">
                <span class="history-set">Série ${idx + 1}</span>
                <span class="history-data">${entry.weight}kg × ${entry.reps}</span>
                ${entry.accepted ? '✓' : '✗'}
            </div>
        `).join('');
    }
}

function updateSeriesDots() {
    const dotsContainer = document.querySelector('.series-dots');
    if (!dotsContainer) return;
    
    // Vider et recréer les dots selon le nombre de séries
    dotsContainer.innerHTML = '';
    
    for (let i = 1; i <= (currentWorkoutSession.totalSets || 3); i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        if (i < currentSet) {
            dot.classList.add('completed');
        } else if (i === currentSet) {
            dot.classList.add('active');
        }
        dotsContainer.appendChild(dot);
    }
}

function updateHeaderProgress() {
    // Mettre à jour le compteur de série
    const setProgressEl = document.getElementById('setProgress');
    if (setProgressEl) {
        setProgressEl.textContent = `Série ${currentSet}/${currentWorkoutSession.totalSets}`;
    }
    
    // Mettre à jour le compteur d'exercice (pour le mode programme)
    if (currentWorkoutSession.type === 'program' && currentWorkoutSession.program) {
        const exerciseProgressEl = document.getElementById('exerciseProgress');
        if (exerciseProgressEl) {
            const totalExercises = currentWorkoutSession.program.exercises.length;
            const currentExerciseIndex = currentWorkoutSession.exerciseOrder || 1;
            exerciseProgressEl.textContent = `Exercice ${currentExerciseIndex}/${totalExercises}`;
        }
    }
    
    // Mettre à jour la liste du programme si visible
    if (currentWorkoutSession.type === 'program') {
        updateProgramExerciseProgress();
    }
}

function updateProgramExerciseProgress() {
    if (!currentWorkoutSession.programExercises) return;
    
    // Recharger simplement toute la liste pour mettre à jour les compteurs
    loadProgramExercisesList();
}

function updateSetNavigationButtons() {
    const prevBtn = document.getElementById('prevSetBtn');
    const nextBtn = document.getElementById('nextSetBtn');
    const addSetBtn = document.getElementById('addSetBtn');
    
    // Bouton précédent
    if (prevBtn) {
        prevBtn.style.display = currentSet > 1 ? 'inline-block' : 'none';
    }
    
    // Bouton suivant
    if (nextBtn) {
        if (currentSet < currentWorkoutSession.totalSets) {
            nextBtn.textContent = 'Série suivante →';
            nextBtn.style.display = 'inline-block';
        } else if (currentSet === currentWorkoutSession.totalSets) {
            nextBtn.textContent = 'Terminer l\'exercice →';
            nextBtn.style.display = 'inline-block';
        } else {
            nextBtn.style.display = 'none';
        }
    }
    
    // Bouton ajouter série (visible seulement sur la dernière série prévue)
    if (addSetBtn) {
        addSetBtn.style.display = (currentSet === currentWorkoutSession.totalSets && 
                                  currentWorkoutSession.totalSets < currentWorkoutSession.maxSets) 
                                  ? 'inline-block' : 'none';
    }
}

async function updateSetRecommendations() {
    if (!currentUser || !currentWorkout || !currentExercise) return;

    // NETTOYAGE PRÉVENTIF : Supprimer tout timer isométrique résiduel
    const existingTimer = document.getElementById('isometric-timer');
    if (existingTimer) {
        console.log('🧹 Nettoyage timer isométrique résiduel');
        existingTimer.remove();
    }
    
    // Restaurer executeSetBtn si masqué par erreur
    const executeBtn = document.getElementById('executeSetBtn');
    if (executeBtn && executeBtn.hasAttribute('data-isometric-disabled') && 
        currentExercise.exercise_type !== 'isometric') {
        console.log('🔧 Restauration executeSetBtn incorrectement masqué');
        executeBtn.style.display = 'block';
        executeBtn.removeAttribute('data-isometric-disabled');
    }

    try {
        // CORRECTION 1 : Déplacer sessionHistory AVANT son utilisation
        const sessionSets = currentWorkoutSession.completedSets.filter(s => s.exercise_id === currentExercise.id);
        const sessionHistory = sessionSets.map(set => ({
            weight: set.weight,
            reps: set.reps,
            fatigue_level: set.fatigue_level,
            effort_level: set.effort_level,
            set_number: set.set_number,
            actual_rest_duration: set.actual_rest_duration_seconds
        }));

        // CORRECTION 2 : Vérifier si ML est activé AVANT l'appel API
        const mlEnabled = currentWorkoutSession.mlSettings?.[currentExercise.id]?.autoAdjust ?? true;

        let recommendations; // CORRECTION 3 : UNE SEULE déclaration

        if (!mlEnabled) {
            // Mode manuel : utiliser les valeurs par défaut ou précédentes
            const lastSet = sessionSets.slice(-1)[0];
            
            recommendations = {
                weight_recommendation: lastSet?.weight || currentExercise.default_weight || 20,
                reps_recommendation: currentExercise.default_reps_min || 12,
                confidence: 1.0,
                reasoning: "Mode manuel activé",
                weight_change: "same",
                reps_change: "same",
                adaptation_strategy: "fixed_weight"
            };
            
            console.log('🔧 Mode manuel - Recommandations fixées');
        } else {
            // Mode ML : appeler l'API
            recommendations = await apiPost(`/api/workouts/${currentWorkout.id}/recommendations`, {
                exercise_id: currentExercise.id,
                set_number: currentSet,
                current_fatigue: currentWorkoutSession.sessionFatigue,
                previous_effort: currentSet > 1 ? 
                    sessionSets.slice(-1)[0]?.effort_level || 3 : 3,
                exercise_order: currentWorkoutSession.exerciseOrder,
                set_order_global: currentWorkoutSession.globalSetCount + 1,
                last_rest_duration: currentWorkoutSession.lastActualRestDuration,
                session_history: sessionHistory,
                completed_sets_this_exercise: sessionSets.length
            });

            // CORRECTION 4 : Validation des recommandations reçues
            if (!recommendations || (recommendations.weight_recommendation === null && recommendations.weight_recommendation === undefined)) {
                console.warn('⚠️ Recommandations ML invalides, fallback sur valeurs par défaut');
                recommendations = {
                    weight_recommendation: currentExercise.default_weight || 20,
                    reps_recommendation: currentExercise.default_reps_min || 12,
                    confidence: 0.3,
                    reasoning: "Données insuffisantes, valeurs par défaut utilisées",
                    weight_change: "same",
                    reps_change: "same",
                    adaptation_strategy: "fixed_weight"
                };
            }
        }

        // Stocker TOUTES les recommandations pour utilisation ultérieure
        // Validation des poids pairs pour dumbbells
        if (currentExercise?.equipment_required?.includes('dumbbells') && 
            recommendations.weight_recommendation && 
            recommendations.weight_recommendation % 2 !== 0) {
            
            console.warn('[ML] Correction poids impair pour dumbbells:', recommendations.weight_recommendation);
            
            // Arrondir au pair le plus proche
            const originalWeight = recommendations.weight_recommendation;
            recommendations.weight_recommendation = Math.round(originalWeight / 2) * 2;
            
            // Ajouter une note dans le reasoning
            if (!recommendations.reasoning.includes('Ajusté pour paire')) {
                recommendations.reasoning = (recommendations.reasoning || '') + 
                    ` (Ajusté de ${originalWeight}kg à ${recommendations.weight_recommendation}kg pour paire d'haltères)`;
            }
        }
        workoutState.currentRecommendation = recommendations;
        // Sauvegarder pour calcul de précision au prochain set
        workoutState.lastRecommendation = workoutState.currentRecommendation || null;
        
        // Afficher le temps de repos recommandé dans l'interface si disponible
        if (recommendations.rest_seconds_recommendation) {
            const restHint = document.getElementById('restHint');
            if (restHint) {
                restHint.textContent = `Repos: ${recommendations.rest_seconds_recommendation}s`;
                if (recommendations.rest_range) {
                    restHint.title = `Plage recommandée: ${recommendations.rest_range.min}-${recommendations.rest_range.max}s`;
                }
            }
        }

        // === NOUVELLE INTERFACE : Mise à jour de la ligne AI compacte ===
        const aiStatusEl = document.getElementById('aiStatus');
        const aiConfidenceEl = document.getElementById('aiConfidence');
        
        if (aiStatusEl && currentExercise) {
            const mlSettings = currentWorkoutSession.mlSettings?.[currentExercise.id];
            const isActive = mlSettings?.autoAdjust ?? currentUser.prefer_weight_changes_between_sets;
            
            // ✅ CALCUL DYNAMIQUE de confiance qui évolue pendant la séance
            let confidence = recommendations.confidence || 0.5; // Base backend
            
            if (isActive) {
                // ✅ Bonus confiance selon séries accomplies sur cet exercice cette séance
                const completedSetsThisExercise = sessionSets.length;
                
                if (completedSetsThisExercise > 0) {
                    // +8% par série complétée, max +32% (4 séries)
                    const sessionBonus = Math.min(0.32, completedSetsThisExercise * 0.08);
                    confidence = Math.min(0.95, confidence + sessionBonus);
                    
                    // ✅ Bonus supplémentaire si les recommandations sont précises
                    const lastSet = sessionSets.slice(-1)[0];
                        
                    if (lastSet && workoutState.lastRecommendation) {
                        const weightAccuracy = lastSet.weight ? 
                            1 - Math.abs(lastSet.weight - workoutState.lastRecommendation.weight_recommendation) / workoutState.lastRecommendation.weight_recommendation 
                            : 1;
                        const repsAccuracy = 1 - Math.abs(lastSet.reps - workoutState.lastRecommendation.reps_recommendation) / workoutState.lastRecommendation.reps_recommendation;
                        
                        if (weightAccuracy > 0.9 && repsAccuracy > 0.9) {
                            confidence = Math.min(0.98, confidence + 0.1); // +10% si très précis
                        }
                    }
                }
            }
            
            aiStatusEl.textContent = isActive ? 'Actif' : 'Inactif';
            if (aiConfidenceEl) {
                aiConfidenceEl.textContent = Math.round(confidence * 100);
            }
        }

        // GARDER : Gestion manuelle par exercice
        if (!currentWorkoutSession.mlSettings[currentExercise.id]?.autoAdjust) {
            // Mode manuel : utiliser les valeurs précédentes ou par défaut
            const lastSet = sessionSets.slice(-1)[0];
            const lastWeight = lastSet?.weight || 
                            currentWorkoutSession.mlSettings[currentExercise.id]?.lastManualWeight ||
                            recommendations.baseline_weight;
            
            recommendations.weight_recommendation = lastWeight;
            recommendations.reasoning = "Mode manuel activé - Ajustements IA désactivés";
            recommendations.confidence = 1.0;
            recommendations.weight_change = "same";
        }

        // PHASE 2.2 : Ajouter à l'historique ML
        addToMLHistory(currentExercise.id, recommendations);

        // GARDER : Déterminer le type d'exercice
        const exerciseType = getExerciseType(currentExercise);

        // GARDER : Appliquer la configuration UI selon le type
        await configureUIForExerciseType(exerciseType, recommendations);
        
        // GARDER : AFFICHAGE différentiel des recommandations
        displayRecommendationChanges(recommendations);

        // GARDER : MISE À JOUR des détails IA pour debug
        updateAIDetailsPanel(recommendations);

        // === Mise à jour des détails AI ===
        if (document.getElementById('aiWeightRec')) {
            // NOUVEAU: Ne pas afficher 0 directement
            let displayWeight = recommendations.weight_recommendation;
            if (displayWeight === 0 || displayWeight === null || displayWeight === undefined) {
                if (currentExercise?.weight_type === 'bodyweight') {
                    document.getElementById('aiWeightRec').textContent = 'Poids du corps';
                } else {
                    // Utiliser une valeur fallback sensée
                    const fallback = currentExercise?.base_weights_kg?.[currentUser?.experience_level || 'intermediate']?.base || 20;
                    document.getElementById('aiWeightRec').textContent = `~${fallback}kg`;
                }
            } else {
                document.getElementById('aiWeightRec').textContent = `${displayWeight}kg`;
            }
        }
        // AJOUTER les lignes manquantes :
        if (document.getElementById('aiRepsRec')) {
            document.getElementById('aiRepsRec').textContent = recommendations.reps_recommendation || 10;
        }
        if (document.getElementById('aiStrategy')) {
            const strategy = recommendations.adaptation_strategy || 'Standard';
            document.getElementById('aiStrategy').textContent = strategy === 'fixed_weight' ? 'Poids fixe' : 'Progressif';
        }
        if (document.getElementById('aiReason')) {
            document.getElementById('aiReason').textContent = recommendations.reasoning || 'Données insuffisantes';
        }
        
        // GARDER : Traduire la stratégie
        const strategyTranslations = {
            'progressive': 'Progressive',
            'maintain': 'Maintien',
            'deload': 'Décharge',
            'fixed_weight': 'Poids fixe',
            'Standard': 'Standard'
        };

        if (document.getElementById('aiStrategy')) {
            const strategy = recommendations.adaptation_strategy || 'Standard';
            document.getElementById('aiStrategy').textContent = strategyTranslations[strategy] || strategy;
        }
        if (document.getElementById('aiReason')) {
            document.getElementById('aiReason').textContent = recommendations.reasoning || 'Données insuffisantes';
        }

        // PHASE 2.2 : Afficher l'explication ML (conserver pour compatibilité)
        const mlExplanationContainer = document.getElementById('mlExplanationContainer');
        if (mlExplanationContainer && recommendations.reasoning && 
            recommendations.reasoning !== "Conditions normales" && 
            recommendations.reasoning !== "Mode manuel activé") {
            mlExplanationContainer.innerHTML = renderMLExplanation(recommendations);
            mlExplanationContainer.style.display = 'block';
        } else if (mlExplanationContainer) {
            mlExplanationContainer.style.display = 'none';
        }

        // PHASE 2.2 : Afficher toggle ML (conserver pour compatibilité)
        const mlToggleContainer = document.getElementById('mlToggleContainer');
        if (mlToggleContainer) {
            mlToggleContainer.innerHTML = renderMLToggle(currentExercise.id);
            mlToggleContainer.style.display = 'block';
        }

        // PHASE 2.2 : Afficher indicateur de confiance
        renderConfidenceIndicators(recommendations);

        // PHASE 2.2 : Mettre à jour l'historique ML si affiché
        updateMLHistoryDisplay();
        // Afficher les recommandations mises à jour
        displayRecommendations(recommendations);


    } catch (error) {
        console.error('Erreur recommandations ML:', error);
        
        // Fallback sur valeurs par défaut
        const exerciseType = getExerciseType(currentExercise);
        applyDefaultValues(currentExercise);
        
        // Masquer les composants ML en cas d'erreur
        ['mlExplanationContainer', 'mlToggleContainer', 'mlConfidenceContainer'].forEach(id => {
            const container = document.getElementById(id);
            if (container) container.style.display = 'none';
        });
        
        // === NOUVELLE INTERFACE : Mettre à jour le statut en cas d'erreur ===
        const aiStatusEl = document.getElementById('aiStatus');
        if (aiStatusEl) {
            aiStatusEl.textContent = 'Erreur';
        }
    }
}

// Affichage des changements de recommandations
// AJOUTER ces fonctions manquantes
function displayRecommendationChanges(recommendations) {
    if (!workoutState.lastRecommendation || currentSet === 1) return;
    
    const weightChange = recommendations.weight_recommendation - workoutState.lastRecommendation.weight_recommendation;
    const repsChange = recommendations.reps_recommendation - workoutState.lastRecommendation.reps_recommendation;
    
    let changeMessage = '';
    if (Math.abs(weightChange) >= 1) {
        const direction = weightChange > 0 ? '↗️' : '↘️';
        changeMessage += `Poids ${direction} ${Math.abs(weightChange).toFixed(1)}kg `;
    }
    if (Math.abs(repsChange) >= 1) {
        const direction = repsChange > 0 ? '↗️' : '↘️';
        changeMessage += `Reps ${direction} ${Math.abs(repsChange)} `;
    }
    
    if (changeMessage) {
        const reason = recommendations.reasoning || 'Ajustement basé sur fatigue/effort';
        showToast(`🤖 IA: ${changeMessage.trim()} (${reason})`, 'info', 4000);
    }
}

function updateAIDetailsPanel(recommendations) {
    const aiWeightEl = document.getElementById('aiWeightRec');
    const aiRepsEl = document.getElementById('aiRepsRec');
    const aiStrategyEl = document.getElementById('aiStrategy');
    const aiReasonEl = document.getElementById('aiReason');
    
    // Gestion intelligente du poids
    if (aiWeightEl) {
        let weightText = '--kg';
        if (currentExercise?.weight_type === 'bodyweight') {
            weightText = 'Poids du corps';
        } else if (recommendations.weight_recommendation && recommendations.weight_recommendation > 0) {
            weightText = `${recommendations.weight_recommendation}kg`;
        } else if (recommendations.weight_recommendation === 0) {
            // Cas spécifique du 0 - utiliser une valeur par défaut sensée
            const fallbackWeight = currentExercise?.base_weights_kg?.[currentUser?.experience_level || 'intermediate']?.base || 20;
            weightText = `~${fallbackWeight}kg (défaut)`;
        }
        aiWeightEl.textContent = weightText;
    }
    
    if (aiRepsEl) aiRepsEl.textContent = recommendations.reps_recommendation || '--';
    if (aiStrategyEl) aiStrategyEl.textContent = recommendations.adaptation_strategy === 'fixed_weight' ? 'Poids fixe' : 'Progressif';
    if (aiReasonEl) aiReasonEl.textContent = recommendations.reasoning || 'Recommandation standard';
}


// Toggle détails IA
function toggleAIDetails() {
    const panel = document.getElementById('aiDetailsPanel');
    const button = document.querySelector('.ai-expand-btn svg');
    
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        button.style.transform = 'rotate(180deg)';
    } else {
        panel.style.display = 'none';
        button.style.transform = 'rotate(0deg)';
    }
}

// Fonction syncMLToggles manquante
function syncMLToggles() {
    if (!currentExercise || !currentWorkoutSession.mlSettings) return;
    
    const exerciseId = currentExercise.id;
    const currentState = currentWorkoutSession.mlSettings[exerciseId]?.autoAdjust ?? true;
    
    // Synchroniser tous les toggles avec l'état actuel
    const toggles = document.querySelectorAll('[id^="mlToggle"]');
    toggles.forEach(toggle => {
        if (toggle.checked !== currentState) {
            toggle.checked = currentState;
        }
    });
    
    // Mettre à jour les textes d'état
    const statusElements = document.querySelectorAll('.toggle-label, #aiStatus');
    statusElements.forEach(el => {
        if (el.id === 'aiStatus') {
            el.textContent = currentState ? 'Actif' : 'Inactif';
        } else if (el.classList.contains('toggle-label')) {
            const label = el.querySelector('span') || el;
            if (label.textContent.includes('Ajustement IA')) {
                label.textContent = `🧠 Ajustement IA (${currentState ? 'Actif' : 'Manuel'})`;
            }
        }
    });
    
    console.log(`🔄 syncMLToggles: état synchronisé à ${currentState} pour exercice ${exerciseId}`);
}

function renderConfidenceIndicators(recommendations) {
    const container = document.getElementById('mlConfidenceContainer');
    if (!container) return;
    
    // Ne pas afficher si toutes les confiances sont élevées
    const weights = [
        recommendations.weight_confidence || recommendations.confidence,
        recommendations.reps_confidence,
        recommendations.rest_confidence
    ].filter(c => c !== undefined);
    
    if (weights.every(c => c >= 0.9)) {
        container.style.display = 'none';
        return;
    }
    
    const details = recommendations.confidence_details || {};
    
    container.innerHTML = `
        <div class="ml-confidence-panel">
            <h5>Fiabilité des recommandations</h5>
            
            ${renderSingleConfidence('Poids', recommendations.weight_confidence || recommendations.confidence, 'weight')}
            ${renderSingleConfidence('Répétitions', recommendations.reps_confidence, 'reps')}
            ${renderSingleConfidence('Repos', recommendations.rest_confidence, 'rest')}
            
            ${details.sample_size ? `
                <div class="confidence-meta">
                    <small>
                        Basé sur ${details.sample_size} séance${details.sample_size > 1 ? 's' : ''}
                        ${details.data_recency_days !== null ? 
                          ` • Dernière il y a ${details.data_recency_days}j` : ''}
                    </small>
                </div>
            ` : ''}
        </div>
    `;
    
    container.style.display = 'block';
}

function renderSingleConfidence(label, confidence, type) {
    if (!confidence) return '';
    
    const percent = Math.round(confidence * 100);
    let status, color;
    
    // Seuils basés sur la littérature statistique
    if (percent >= 80) {
        status = 'Élevée';
        color = 'var(--success)';
    } else if (percent >= 60) {
        status = 'Modérée';
        color = 'var(--warning)';
    } else {
        status = 'En apprentissage';
        color = 'var(--danger)';
    }
    
    return `
        <div class="confidence-item">
            <div class="confidence-label">
                <span>${label}</span>
                <span class="confidence-status" style="color: ${color}">${status}</span>
            </div>
            <div class="confidence-bar">
                <div class="confidence-fill" style="width: ${percent}%; background: ${color}"></div>
            </div>
            <span class="confidence-percent">${percent}%</span>
        </div>
    `;
}

// Fonction helper pour déterminer le type d'exercice
function getExerciseType(exercise) {
    console.log('=== DEBUG getExerciseType ===');
    console.log('Exercise:', exercise.name);
    console.log('exercise_type:', exercise.exercise_type);
    console.log('weight_type:', exercise.weight_type);
    
    if (exercise.exercise_type === 'isometric') {
        console.log('→ Résultat: isometric');
        return 'isometric';
    }
    if (exercise.weight_type === 'bodyweight') {
        console.log('→ Résultat: bodyweight');
        return 'bodyweight';
    }
    console.log('→ Résultat: weighted');
    return 'weighted';
}

// Configuration de l'UI selon le type d'exercice
async function configureUIForExerciseType(type, recommendations) {
    console.log('=== DEBUG configureUIForExerciseType ===');
    console.log('Type déterminé:', type);
    console.log('Exercice:', currentExercise?.name);
    console.log('exercise_type:', currentExercise?.exercise_type);
    console.log('weight_type:', currentExercise?.weight_type);
    // Récupérer les éléments DOM une seule fois
    const elements = {
        weightRow: document.querySelector('.input-row:has(#setWeight)'),
        repsRow: document.querySelector('.input-row:has(#setReps)'),
        weightHint: document.getElementById('weightHint'),
        repsHint: document.getElementById('repsHint'),
        setWeight: document.getElementById('setWeight'),
        setReps: document.getElementById('setReps'),
        repsIcon: document.querySelector('.input-row:has(#setReps) .input-icon'),
        repsUnit: document.querySelector('.input-row:has(#setReps) .unit')
    };

    switch (type) {
        case 'isometric':
            configureIsometric(elements, recommendations);
            break;
            
        case 'bodyweight':
            configureBodyweight(elements, recommendations);
            break;
            
        case 'weighted':
            await configureWeighted(elements, currentExercise, recommendations.weight_recommendation || 20);
            break;
    }
    // Créer bouton GO seulement quand nécessaire
    const executeBtn = document.getElementById('executeSetBtn');
    if (executeBtn) {
        updateExecuteButtonState('ready');
    }
    // Afficher le temps de repos si recommandé (commun à tous les types)
    updateRestRecommendation(recommendations);
    updateConfidence(recommendations);
}

// Configuration pour exercices isométriques
function configureIsometric(elements, recommendations) {
    console.log('=== DEBUG configureIsometric ===');
    console.log('currentExercise:', currentExercise?.name);
    console.log('exercise_type:', currentExercise?.exercise_type);
    
    // VÉRIFICATION STRICTE : Ne pas continuer si ce n'est PAS un isométrique
    if (!currentExercise || currentExercise.exercise_type !== 'isometric') {
        console.error('❌ configureIsometric appelé pour un exercice NON-isométrique !');
        console.error('Exercice:', currentExercise?.name, 'Type:', currentExercise?.exercise_type);
        return; // SORTIR IMMÉDIATEMENT
    }
    
    console.log('✅ Exercice isométrique confirmé, configuration du timer...');
    
    if (elements.weightRow) elements.weightRow.setAttribute('data-hidden', 'true');
    if (elements.repsRow) elements.repsRow.setAttribute('data-hidden', 'true');
    
    // Adapter l'emoji vert pour les isométriques (ne PAS masquer)
    const executeBtn = document.getElementById('executeSetBtn');
    if (executeBtn) {
        executeBtn.style.display = 'block';
        const emoji = executeBtn.querySelector('.go-emoji');
        if (emoji) emoji.textContent = '✅';  // Utiliser textContent au lieu de innerHTML
        executeBtn.setAttribute('data-isometric-mode', 'start');
        executeBtn.classList.remove('btn-danger');
        executeBtn.classList.add('btn-success');
        executeBtn.onclick = () => handleIsometricAction();
    }
        
    // Masquer aussi la section de feedback temporairement
    const feedbackSection = document.getElementById('setFeedback');
    if (feedbackSection) {
        feedbackSection.style.display = 'none';
    }
    
    const targetDuration = Math.max(15, recommendations.reps_recommendation || 30);
    
    // Supprimer timer existant si présent
    const existingTimer = document.getElementById('isometric-timer');
    if (existingTimer) existingTimer.remove();
        
    const timerHtml = `
        <div class="isometric-timer" id="isometric-timer">
            <svg class="timer-svg" viewBox="0 0 200 200">
                <circle class="timer-track" cx="100" cy="100" r="80"/>
                <circle class="timer-progress target" cx="100" cy="100" r="80" id="progress-target"/>
                <circle class="timer-progress overflow" cx="100" cy="100" r="80" id="progress-overflow"/>
            </svg>
            <div class="timer-center">
                <div id="timer-display">0s</div>
                <div class="timer-target">Objectif: ${targetDuration}s</div>
            </div>
        </div>`;
    
    document.querySelector('.input-section').insertAdjacentHTML('beforeend', timerHtml);
    setupIsometricTimer(targetDuration);
    updateExecuteButtonState('isometric-start');
    
    console.log(`✅ Timer isométrique configuré - Objectif: ${targetDuration}s`);
}

function setupIsometricTimer(targetDuration) {
    let currentTime = 0, timerInterval = null, targetReached = false;
    const display = document.getElementById('timer-display');
    const progressTarget = document.getElementById('progress-target');
    const progressOverflow = document.getElementById('progress-overflow');
    
    // Exposer les fonctions via l'objet global
    window.currentIsometricTimer = {
        targetDuration, 
        currentTime: () => currentTime,
        interval: null,
        
        start: () => {
            timerInterval = setInterval(() => {
                currentTime++;
                display.textContent = `${currentTime}s`;
                
                // Calcul progression visuelle (identique)
                if (currentTime <= targetDuration) {
                    const percent = (currentTime / targetDuration) * 100;
                    const dashLength = (percent / 100) * 503;
                    progressTarget.style.strokeDasharray = `${dashLength} 503`;
                    progressOverflow.style.strokeDasharray = '0 503';
                } else {
                    progressTarget.style.strokeDasharray = '503 503';
                    const overflowTime = currentTime - targetDuration;
                    const overflowPercent = (overflowTime / targetDuration) * 100;
                    const overflowDash = Math.min((overflowPercent / 100) * 503, 503);
                    progressOverflow.style.strokeDasharray = `${overflowDash} 503`;
                }
                
                // Notification objectif atteint
                if (currentTime === targetDuration && !targetReached) {
                    targetReached = true;
                    showToast(`🎯 Objectif ${targetDuration}s atteint !`, 'success');
                    if (window.workoutAudio) {
                        window.workoutAudio.playSound('achievement');
                    }
                }
            }, 1000);
            
            window.currentIsometricTimer.interval = timerInterval;
        },
        
        stop: () => {
            clearInterval(timerInterval);
            timerInterval = null;
            window.currentIsometricTimer.interval = null;
            
            // Enregistrer les données
            workoutState.pendingSetData = {
                duration_seconds: currentTime,
                reps: currentTime,
                weight: null
            };
            
            console.log(`Série isométrique terminée: ${currentTime}s (objectif: ${targetDuration}s)`);
        }
    };
    
    // Réinitialiser l'affichage
    display.textContent = '0s';
    progressTarget.style.strokeDasharray = '0 503';
    progressOverflow.style.strokeDasharray = '0 503';
}

function handleIsometricAction() {
    const executeBtn = document.getElementById('executeSetBtn');
    const mode = executeBtn.getAttribute('data-isometric-mode');
    
    if (mode === 'start') {
        // Démarrer le timer
        if (window.currentIsometricTimer && window.currentIsometricTimer.start) {
            window.currentIsometricTimer.start();
        }
        
        // Changer l'emoji en STOP
        executeBtn.innerHTML = '<span class="go-emoji">⏹️</span>';
        executeBtn.setAttribute('data-isometric-mode', 'stop');
        executeBtn.classList.remove('btn-success');
        executeBtn.classList.add('btn-danger');
        
        transitionTo(WorkoutStates.EXECUTING);
    } else {
        // Arrêter le timer
        if (window.currentIsometricTimer && window.currentIsometricTimer.stop) {
            window.currentIsometricTimer.stop();
        }
        
        // Masquer l'emoji et passer au feedback
        executeBtn.style.display = 'none';
        document.getElementById('isometric-timer').style.display = 'none';
        document.getElementById('setFeedback').style.display = 'block';
        
        transitionTo(WorkoutStates.FEEDBACK);
    }
}

function cleanupIsometricTimer() {
    // Arrêter le timer si actif
    if (window.currentIsometricTimer && window.currentIsometricTimer.interval) {
        clearInterval(window.currentIsometricTimer.interval);
        window.currentIsometricTimer.interval = null;
    }
    
    // Supprimer le DOM
    const timer = document.getElementById('isometric-timer');
    if (timer) timer.remove();
    
    // RESTAURER l'emoji vert CLASSIQUE (pas isométrique)
    const executeBtn = document.getElementById('executeSetBtn');
    if (executeBtn) {
        executeBtn.style.display = 'block';
        executeBtn.innerHTML = '<span class="go-emoji">✅</span>';
        
        // IMPORTANT: Supprimer tous les attributs isométriques
        executeBtn.removeAttribute('data-isometric-mode');
        executeBtn.removeAttribute('data-isometric-disabled');
        
        // Restaurer les classes CSS normales
        executeBtn.classList.remove('btn-danger');
        executeBtn.classList.add('btn-success');
        
        // RESTAURER la fonction normale executeSet (PAS handleIsometricAction)
        executeBtn.onclick = executeSet;
    }
    
    // Nettoyer référence globale
    window.currentIsometricTimer = null;
    updateExecuteButtonState('ready');

    console.log('Timer isométrique nettoyé - Bouton restauré pour exercices classiques');
}

// Configuration pour exercices bodyweight
function configureBodyweight(elements, recommendations) {
    // Masquer la ligne de poids
    if (elements.weightRow) {
        elements.weightRow.setAttribute('data-hidden', 'true');
    }
    
    // S'assurer que l'affichage des reps est normal
    if (elements.repsRow) {
        elements.repsRow.classList.remove('duration-display');
    }
    
    // Icône et unité normales
    if (elements.repsIcon) elements.repsIcon.textContent = '🔢';
    if (elements.repsUnit) elements.repsUnit.textContent = 'reps';
    
    // Mettre à jour les valeurs
    const reps = recommendations.reps_recommendation || 10;
    if (elements.setReps) elements.setReps.textContent = reps;
    if (elements.repsHint) elements.repsHint.textContent = `IA: ${reps}`;
}

// Configuration pour exercices avec poids
async function configureWeighted(elements, exercise, weightRec) {
    // Hide bodyweight controls
    if (elements.bodyweightControls) {
        elements.bodyweightControls.style.display = 'none';
    }
    
    // Show weighted controls
    if (elements.weightedControls) {
        elements.weightedControls.style.display = 'flex';
    }
    
    // Get available weights
    const response = await apiGet(`/api/users/${currentUser.id}/available-weights?exercise_id=${exercise.id}`);
    let availableWeights = response.available_weights || [];
    
    if (availableWeights.length === 0) {
        console.warn('Aucun poids disponible');
        return;
    }
    
    // Validation des poids pour dumbbells
    if (exercise?.equipment_required?.includes('dumbbells')) {
        // Calculer le maximum théorique possible
        const maxPossible = calculateMaxDumbbellWeight(currentUser.equipment_config);
        
        // Filtrer les poids impossibles
        const originalCount = availableWeights.length;
        availableWeights = availableWeights.filter(w => w <= maxPossible);
        
        if (originalCount !== availableWeights.length) {
            console.error('[Weights] Poids impossibles filtrés:', originalCount - availableWeights.length);
        }
        
        // Forcer uniquement les poids pairs
        availableWeights = availableWeights.filter(w => w % 2 === 0);
        
        console.log('[Weights] Dumbbells - poids valides:', availableWeights);
    }
    
    // Log des poids disponibles pour debug
    console.log('[Weights] Poids disponibles pour', exercise.name, ':', availableWeights);
    console.log('[Weights] Config équipement:', currentUser.equipment_config);
    
    // Find closest available weight
    let closestWeight;
    
    if (availableWeights.length > 0) {
        closestWeight = availableWeights.reduce((prev, curr) => {
            return Math.abs(curr - weightRec) < Math.abs(prev - weightRec) ? curr : prev;
        }, availableWeights[0]);
    } else {
        console.error('[Weights] Aucun poids disponible après filtrage!');
        closestWeight = 5; // Fallback minimal
    }
    
    // Stocker les poids disponibles dans sessionStorage
    sessionStorage.setItem('availableWeights', JSON.stringify(availableWeights));
    
    // Configure weight controls
    if (elements.setWeight) {
        elements.setWeight.textContent = closestWeight || weightRec;
        
        // Update plate helper avec délai pour s'assurer que currentExercise est défini
        if (currentUser?.show_plate_helper) {
            console.log('[PlateHelper] Scheduling update for weight:', closestWeight || weightRec);
            setTimeout(() => {
                updatePlateHelper(closestWeight || weightRec);
            }, 200);
        }
    }
    
    // Configure weight adjustment controls - CORRIGÉ
    if (elements.decreaseWeight && elements.increaseWeight) {
        elements.decreaseWeight.onclick = () => adjustWeightDown();
        elements.increaseWeight.onclick = () => adjustWeightUp();
    }
    
    // Log configuration for debugging
    console.log('[ConfigureWeighted] Complete:', {
        exercise: exercise.name,
        equipment: exercise.equipment_required,
        recommendedWeight: weightRec,
        selectedWeight: closestWeight,
        availableCount: availableWeights.length,
        availableWeights: availableWeights.slice(0, 10), // Premiers 10 pour debug
        isDumbbells: exercise.equipment_required?.includes('dumbbells')
    });
}

// Calculer le poids maximum théorique pour dumbbells
function calculateMaxDumbbellWeight(config) {
    let maxWeight = 0;
    
    // Barres (2 barres pour dumbbells)
    if (config.barbell_short_pair?.available && config.barbell_short_pair?.count >= 2) {
        const barWeight = config.barbell_short_pair.weight || 2.5;
        maxWeight += barWeight * 2;
        
        // Tous les disques disponibles sur 2 barres
        if (config.weight_plates?.weights) {
            for (const [weight, count] of Object.entries(config.weight_plates.weights)) {
                // Pour dumbbells, on ne peut pas mettre plus que count/2 disques par barre
                // (car il faut équiper 2 barres)
                const maxPerBar = Math.floor(count / 2);
                maxWeight += parseFloat(weight) * maxPerBar * 2;
            }
        }
    }
    
    // Dumbbells fixes (si disponibles)
    if (config.dumbbells?.available && config.dumbbells?.weights) {
        const maxFixed = Math.max(...config.dumbbells.weights) * 2;
        maxWeight = Math.max(maxWeight, maxFixed);
    }
    
    console.log('[Weights] Poids maximum théorique dumbbells:', maxWeight, 'kg');
    return maxWeight;
}

// Mise à jour des recommandations de repos
function updateRestRecommendation(recommendations) {
    const restHintEl = document.getElementById('restHint');
    if (restHintEl && recommendations.rest_seconds_recommendation) {
        restHintEl.textContent = `Repos: ${recommendations.rest_seconds_recommendation}s`;
    }
}

// Mise à jour de la confiance
function updateConfidence(recommendations) {
    const confidenceEl = document.getElementById('recConfidence');
    if (confidenceEl && recommendations.confidence) {
        confidenceEl.textContent = Math.round(recommendations.confidence * 100);
    }
}

// Valeurs par défaut en cas d'erreur
function applyDefaultValues(exercise) {
    const type = getExerciseType(exercise);
    const elements = {
        weightRow: document.querySelector('.input-row:has(#setWeight)'),
        setWeight: document.getElementById('setWeight'),
        setReps: document.getElementById('setReps')
    };
    
    switch (type) {
        case 'isometric':
            if (elements.setReps) elements.setReps.textContent = '30';
            if (elements.weightRow) elements.weightRow.setAttribute('data-hidden', 'true');
            break;
            
        case 'bodyweight':
            if (elements.setReps) elements.setReps.textContent = '10';
            if (elements.weightRow) elements.weightRow.setAttribute('data-hidden', 'true');
            break;
            
        default:
            if (elements.setWeight) elements.setWeight.textContent = '20';
            if (elements.setReps) elements.setReps.textContent = '10';
            break;
    }
}

function updateSetsHistory() {
    const container = document.getElementById('setsHistory');
    if (!container) return;
    
    const exerciseSets = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id === currentExercise.id
    );
    
    const isIsometric = currentExercise.exercise_type === 'isometric';
    const isBodyweight = currentExercise.weight_type === 'bodyweight';
    
    container.innerHTML = exerciseSets.map((set, index) => `
        <div class="set-history-item">
            <div class="set-number">${index + 1}</div>
            <div class="set-details">
                ${isIsometric ? `${set.duration_seconds || set.reps}s` : 
                  isBodyweight ? `${set.reps} reps` :
                  `${set.weight || 0}kg × ${set.reps} reps`}
            </div>
            <div class="set-feedback-summary">
                ${set.fatigue_level ? `Fatigue: ${set.fatigue_level}/5` : ''}
            </div>
        </div>
    `).join('');
    
    // Mettre à jour la progression dans la liste si on est en mode programme
    if (currentWorkoutSession.type === 'program') {
        loadProgramExercisesList();
    }
}

async function finishExercise() {
    // Sauvegarder l'état final si programme
    if (currentExercise && currentWorkoutSession.type === 'program') {
        await saveCurrentExerciseState();
    }
    
    // Arrêter le timer de série
    if (setTimer) {
        clearInterval(setTimer);
        setTimer = null;
    }
    
    if (currentWorkout.type === 'free') {
        document.getElementById('currentExercise').style.display = 'none';
        document.getElementById('exerciseSelection').style.display = 'block';
        currentExercise = null;
        currentSet = 1;
        
        // AJOUT : Réinitialiser proprement l'état
        transitionTo(WorkoutStates.IDLE);
        
    } else {
        // PROGRAMME: retourner à la liste
        document.getElementById('currentExercise').style.display = 'none';
        currentExercise = null;
        currentSet = 1;
        
        // Mettre à jour la progression
        updateProgramExerciseProgress();
        
        // Afficher la liste des exercices
        document.getElementById('programExercisesContainer').style.display = 'block';
        
        // Continuer avec la logique existante
        loadProgramExercisesList();
        
        // Trouver le prochain exercice non complété
        const remainingExercises = currentWorkoutSession.program.exercises.filter(ex => 
            !currentWorkoutSession.programExercises[ex.exercise_id].isCompleted
        );
        
        if (remainingExercises.length > 0) {
            const nextExercise = remainingExercises[0];
            showModal('Exercice terminé !', `
                <div style="text-align: center;">
                    <p style="font-size: 1.2rem; margin-bottom: 1rem;">
                        Excellent travail ! 💪
                    </p>
                    <p style="color: var(--text-muted); margin-bottom: 2rem;">
                        Il reste ${remainingExercises.length} exercice(s) à faire
                    </p>
                    <div style="display: flex; gap: 1rem; justify-content: center;">
                        <button class="btn btn-primary" onclick="selectProgramExercise(${nextExercise.exercise_id}); closeModal();">
                            Continuer
                        </button>
                        <button class="btn btn-secondary" onclick="closeModal(); showProgramExerciseList();">
                            Voir la liste
                        </button>
                    </div>
                </div>
            `);
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
        
        currentExercise = null;
        currentSet = 1;
        document.getElementById('currentExercise').style.display = 'none';
    }
}

async function loadNextProgramExercise() {
    try {
        const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
        
        if (!program || currentWorkoutSession.exerciseOrder > program.exercises.length) {
            showToast('Félicitations, vous avez terminé le programme !', 'success');
            endWorkout();
            return;
        }
        
        const nextExerciseData = program.exercises[currentWorkoutSession.exerciseOrder - 1];
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const nextExercise = exercises.find(ex => ex.id === nextExerciseData.exercise_id);
        
        if (nextExercise) {
            // Réinitialiser les états pour le nouvel exercice
            currentSet = 1;
            currentExercise = nextExercise;
            currentWorkoutSession.currentSetNumber = 1;
            currentWorkoutSession.totalSets = nextExercise.default_sets || 3;
            
            // Mettre à jour l'interface
            document.getElementById('exerciseName').textContent = nextExercise.name;
            document.getElementById('setProgress').textContent = 
                `Exercice ${currentWorkoutSession.exerciseOrder}/${program.exercises.length} • Série ${currentSet}`;
            
            updateSeriesDots();
            await updateSetRecommendations();
            
            // Démarrer le nouveau timer de série
            startSetTimer();
            transitionTo(WorkoutStates.READY);
        }
    } catch (error) {
        console.error('Erreur chargement exercice suivant:', error);
        showToast('Erreur lors du chargement du prochain exercice', 'error');
    }
}

function updateRestTimer(seconds) {
    // Remplacer tout le contenu par :
    const absSeconds = Math.abs(seconds);
    const mins = Math.floor(absSeconds / 60);
    const secs = absSeconds % 60;
    const sign = seconds < 0 ? '-' : '';
    document.getElementById('restTimer').textContent = 
        `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function skipRest() {
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }

    // Annuler les sons programmés
    if (window.workoutAudio) {
        window.workoutAudio.clearScheduledSounds();
    }
    
    // Annuler la notification programmée
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    
    // UTILISER LE TIMESTAMP RÉEL STOCKÉ
    if (workoutState.restStartTime) {
        const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
        currentWorkoutSession.totalRestTime += actualRestTime;
        console.log(`Repos ignoré après ${actualRestTime}s. Total: ${currentWorkoutSession.totalRestTime}s`);
        
        updateLastSetRestDuration(actualRestTime);
        workoutState.restStartTime = null; //
    }
    
    completeRest();
}

function endRest() {
    // Calculer et accumuler le temps de repos réel
    if (workoutState.restStartTime) {
        const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
        currentWorkoutSession.totalRestTime += actualRestTime;
        console.log(`Repos terminé (endRest) après ${actualRestTime}s. Total: ${currentWorkoutSession.totalRestTime}s`);
        
        // NOUVEAU : Sauvegarder la durée réelle en base
        updateLastSetRestDuration(actualRestTime);
        
        workoutState.restStartTime = null;
    }
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    document.getElementById('restPeriod').style.display = 'none';
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }

    // Annuler les sons programmés
    if (window.workoutAudio) {
        window.workoutAudio.clearScheduledSounds();
    }
    
    // Reprendre le timer de séance
    const pausedTime = sessionStorage.getItem('pausedWorkoutTime');
    if (pausedTime) {
        const [minutes, seconds] = pausedTime.split(':').map(Number);
        const elapsedSeconds = minutes * 60 + seconds;
        
        const startTime = new Date() - (elapsedSeconds * 1000);
        
        workoutTimer = setInterval(() => {
            const elapsed = new Date() - startTime;
            const mins = Math.floor(elapsed / 60000);
            const secs = Math.floor((elapsed % 60000) / 1000);
            
            document.getElementById('workoutTimer').textContent = 
                `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
    }
    
    // Vérifier si on doit passer à la série suivante
    // Masquer l'interface de repos
    document.getElementById('restPeriod').style.display = 'none';
    // Appeler la logique correcte de fin de repos
    completeRest();
}

function showExerciseCompletion() {
    // Arrêter tous les timers
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
    if (setTimer) {
        clearInterval(setTimer);
        setTimer = null;
    }

    cleanupIsometricTimer();

    // Réinitialiser l'interface
    document.getElementById('executeSetBtn').style.display = 'block';
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('restPeriod').style.display = 'none';
    
    // Afficher les options
    showModal('Exercice terminé', `
        <div style="text-align: center;">
            <p>Vous avez terminé ${currentSet} séries de ${currentExercise.name}</p>
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <button class="btn btn-secondary" onclick="handleExtraSet(); closeModal();">
                    Série supplémentaire
                </button>
                <button class="btn btn-primary" onclick="finishExercise(); closeModal();">
                    Exercice suivant
                </button>
            </div>
        </div>
    `);
}

// ===== GESTION DES TIMERS =====
function startWorkoutTimer() {
    if (workoutTimer) clearInterval(workoutTimer);
    
    const startTime = new Date();
    workoutTimer = setInterval(() => {
        const elapsed = new Date() - startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('workoutTimer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

function startSetTimer() {
    if (setTimer) clearInterval(setTimer);
    
    // Stocker le timestamp de début
    window.currentSetStartTime = Date.now();
    
    // Réinitialiser l'affichage à 00:00
    document.getElementById('setTimer').textContent = '00:00';
    
    const startTime = new Date();
    setTimer = setInterval(() => {
        const elapsed = new Date() - startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('setTimer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

// ===== CONTRÔLES AUDIO =====
function toggleWorkoutAudio() {
    if (window.workoutAudio) {
        const isEnabled = window.workoutAudio.toggle();
        showToast(isEnabled ? 'Sons activés' : 'Sons désactivés', 'info');
        return isEnabled;
    }
}

function setAudioVolume(volume) {
    if (window.workoutAudio) {
        window.workoutAudio.setVolume(volume);
    }
}

function testWorkoutSounds() {
    if (window.workoutAudio) {
        window.workoutAudio.testAllSounds();
        showToast('Test des sons en cours...', 'info');
    }
}

// ===== FIN DE SÉANCE =====
async function endWorkout() {
    if (!confirm('Êtes-vous sûr de vouloir terminer cette séance ?')) return;
    
    try {
        // Arrêter tous les timers
        if (workoutTimer) clearInterval(workoutTimer);
        if (setTimer) clearInterval(setTimer);
        if (restTimer) clearInterval(restTimer);
        
        // Annuler les notifications en attente
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            notificationTimeout = null;
        }
        
        // ✅ MÉTHODE ROBUSTE : Utiliser le timer d'affichage en priorité
        let totalDurationSeconds = 0;
        
        const workoutTimerElement = document.getElementById('workoutTimer');
        const workoutTimerDisplay = workoutTimerElement?.textContent || '00:00';
        if (workoutTimerDisplay && workoutTimerDisplay !== '00:00') {
            // Parser l'affichage du timer : "MM:SS"
            const [minutes, seconds] = workoutTimerDisplay.split(':').map(Number);
            totalDurationSeconds = (minutes * 60) + seconds;
            console.log(`Durée depuis workoutTimer: ${totalDurationSeconds}s (${workoutTimerDisplay})`);
        } else {
            // ✅ FALLBACK : Utiliser timestamps BDD
            const startTime = new Date(currentWorkout.started_at);
            const endTime = new Date();
            totalDurationSeconds = Math.round((endTime - startTime) / 1000);
            console.log(`Durée depuis timestamps: ${totalDurationSeconds}s`);
        }
        
        // ✅ DEBUG DÉCOMPOSITION COMPLÈTE
        const exerciseTime = currentWorkoutSession.totalSetTime || 0;
        const restTime = currentWorkoutSession.totalRestTime || 0;
        const transitionTime = Math.max(0, totalDurationSeconds - exerciseTime - restTime);
        
        console.log(`📊 DÉCOMPOSITION FINALE:`);
        console.log(`  Total: ${totalDurationSeconds}s`);
        console.log(`  Exercice: ${exerciseTime}s`);
        console.log(`  Repos: ${restTime}s`);
        console.log(`  Transitions: ${transitionTime}s`);
        
        // Enregistrer la séance comme terminée
        // === MODULE 4 : ENVOI STATS ML ===
        if (currentWorkoutSession.mlRestStats?.length > 0) {
            try {
                const mlFeedback = {
                    stats: currentWorkoutSession.mlRestStats,
                    summary: {
                        total_suggestions: currentWorkoutSession.mlRestStats.length,
                        accepted_count: currentWorkoutSession.mlRestStats.filter(s => s.accepted).length,
                        average_deviation: currentWorkoutSession.mlRestStats.reduce((sum, s) => 
                            sum + Math.abs(s.actual - s.suggested), 0) / currentWorkoutSession.mlRestStats.length
                    }
                };
                
                await apiPost(`/api/workouts/${currentWorkout.id}/ml-rest-feedback`, mlFeedback);
                console.log(`📊 MODULE 4 - Stats ML envoyées: ${currentWorkoutSession.mlRestStats.length} recommendations`);
            } catch (error) {
                console.error('Erreur envoi stats ML:', error);
                // Ne pas bloquer la fin de séance si l'envoi échoue
            }
        }
        // MODULE 0 : Identifier les exercices "zombies" (started but not completed/skipped)
        const zombieExercises = [];
        for (const [exerciseId, exerciseState] of Object.entries(currentWorkoutSession.programExercises)) {
            if (exerciseState.startTime && 
                !exerciseState.isCompleted && 
                !exerciseState.isSkipped &&
                exerciseState.completedSets < exerciseState.totalSets) {
                
                zombieExercises.push({
                    exercise_id: parseInt(exerciseId),
                    reason: 'implicit_change', // Changé via changeExercise() sans explicit skip
                    planned_sets: exerciseState.totalSets,
                    completed_sets: exerciseState.completedSets,
                    timestamp: exerciseState.endTime?.toISOString() || new Date().toISOString(),
                    exercise_order: exerciseState.index + 1,
                    exercise_name: getExerciseName(exerciseId)
                });
            }
        }

        // Combiner skips explicites et zombies
        const allSkippedExercises = [...currentWorkoutSession.skipped_exercises, ...zombieExercises];

        // Métadonnées de session
        const sessionMetadata = {
            total_planned_exercises: Object.keys(currentWorkoutSession.programExercises).length,
            total_completed_exercises: currentWorkoutSession.completedExercisesCount,
            total_skipped_exercises: allSkippedExercises.length,
            completion_rate: Math.round((currentWorkoutSession.completedExercisesCount / 
                                    Object.keys(currentWorkoutSession.programExercises).length) * 100),
            skip_rate: Math.round((allSkippedExercises.length / 
                                Object.keys(currentWorkoutSession.programExercises).length) * 100)
        };

        console.log(`📊 MODULE 0 - Session completed:`, {
            completed: currentWorkoutSession.completedExercisesCount,
            explicit_skips: currentWorkoutSession.skipped_exercises.length,
            zombie_exercises: zombieExercises.length,
            total_skipped: allSkippedExercises.length,
            completion_rate: sessionMetadata.completion_rate
        });

        await apiPut(`/api/workouts/${currentWorkout.id}/complete`, {
            total_duration: totalDurationSeconds,  // ✅ DURÉE RÉELLE
            total_rest_time: currentWorkoutSession.totalRestTime,
            // MODULE 0 : Nouvelles données
            skipped_exercises: allSkippedExercises,
            session_metadata: sessionMetadata
        });
        
        // Réinitialiser l'état
        clearWorkoutState();
        // Retirer la bannière de reprise de séance si elle existe
        const banner = document.querySelector('.workout-resume-banner');
        if (banner) banner.remove();
        
        // Retour au dashboard
        showView('dashboard');
        loadDashboard();
        showToast('Séance terminée ! Bravo ! 🎉', 'success');
        
    } catch (error) {
        console.error('Erreur fin de séance:', error);
        showToast('Erreur lors de la fin de séance', 'error');
    }
}



// ===== STATISTIQUES =====
async function loadStats() {
    if (!currentUser) return;
    
    try {
        const [stats, progress] = await Promise.all([
            apiGet(`/api/users/${currentUser.id}/stats`),
            apiGet(`/api/users/${currentUser.id}/progress`)
        ]);
        
        // Mettre à jour les résumés
        document.getElementById('totalWorkouts').textContent = stats.total_workouts;
        document.getElementById('totalVolume').textContent = `${stats.total_volume_kg}kg`;
        document.getElementById('lastWorkout').textContent = 
            stats.last_workout_date ? `Il y a ${Math.floor((new Date() - new Date(stats.last_workout_date)) / (1000 * 60 * 60 * 24))} jours` : '-';
        
        // Initialiser les graphiques
        if (typeof window.initStatsCharts === 'function') {
            await window.initStatsCharts(currentUser.id, currentUser);
        }
        
    } catch (error) {
        console.error('Erreur chargement stats:', error);
    }
}

//async function loadStats() {
//    if (!currentUser) return;
//    
//    try {
//        const [stats, progress] = await Promise.all([
//            apiGet(`/api/users/${currentUser.id}/stats`),
//            apiGet(`/api/users/${currentUser.id}/progress`)
//        ]);
//        
//        // Mettre à jour les résumés
//        document.getElementById('totalWorkouts').textContent = stats.total_workouts;
//        document.getElementById('totalVolume').textContent = `${stats.total_volume_kg}kg`;
//        document.getElementById('lastWorkout').textContent = 
//            stats.last_workout_date ? formatDate(new Date(stats.last_workout_date)) : 'Jamais';
//        
//        // Afficher les records
//        const recordsList = document.getElementById('recordsList');
//        if (progress.exercise_records && progress.exercise_records.length > 0) {
//            recordsList.innerHTML = progress.exercise_records.map(record => `
//                <div class="record-item">
//                    <div class="record-exercise">${record.name}</div>
//                    <div class="record-value">${record.max_weight}kg × ${record.max_reps} reps</div>
//                </div>
//            `).join('');
//        } else {
//            recordsList.innerHTML = '<p class="text-center">Aucun record pour le moment</p>';
//        }
//        
//    } catch (error) {
//        console.error('Erreur chargement stats:', error);
//        // Ajouter ces lignes :
//        document.getElementById('totalWorkouts').textContent = '0';
//        document.getElementById('totalVolume').textContent = '0kg';
//        document.getElementById('lastWorkout').textContent = 'Aucune';
//        document.getElementById('recordsList').innerHTML = '<p class="text-center">Aucun record pour le moment</p>';
//    }
//}

// ===== PROFIL =====
async function loadProfile() {
    console.log('loadProfile called, currentUser:', currentUser); // Debug

    if (!currentUser) {
        console.error('Pas de currentUser !'); // Debug
        return;
    }

    const profileInfo = document.getElementById('profileInfo');
    if (!profileInfo) {
        console.error('Element profileInfo non trouvé !'); // Debug
        return;
    }

    const age = new Date().getFullYear() - new Date(currentUser.birth_date).getFullYear();

    let profileHTML = `
        <div class="profile-item">
            <span class="profile-label">Nom</span>
            <span class="profile-value">${currentUser.name}</span>
        </div>
        <div class="profile-item">
            <span class="profile-label">Âge</span>
            <span class="profile-value">${age} ans</span>
        </div>
        <div class="profile-item">
            <span class="profile-label">Taille</span>
            <span class="profile-value">${currentUser.height} cm</span>
        </div>
        <div class="profile-item">
            <span class="profile-label">Poids</span>
            <span class="profile-value">${currentUser.bodyweight} kg</span>
        </div>
        <div class="profile-item">
            <span class="profile-label">Niveau</span>
            <span class="profile-value">${currentUser.experience_level}</span>
        </div>
    `;

    // Add the new weight preference section
    profileHTML += `
        <div class="profile-field">
            <span class="field-label">Préférence d'ajustement</span>
            <div class="toggle-container">
                <label class="toggle-switch">
                    <input type="checkbox" id="weightPreferenceToggle"
                           ${currentUser.prefer_weight_changes_between_sets ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
                <span id="weightPreferenceLabel">${currentUser.prefer_weight_changes_between_sets ? 'Poids variables' : 'Poids fixes'}</span>
            </div>
        </div>
    `;
    // Ajouter le toggle pour les sons
    profileHTML += `
        <div class="profile-field">
            <span class="field-label">Sons de notification</span>
            <div class="toggle-container">
                <label class="toggle-switch">
                    <input type="checkbox" id="soundNotificationsToggle"
                        ${currentUser.sound_notifications_enabled ? 'checked' : ''}
                        onchange="toggleSoundNotifications()">
                    <span class="toggle-slider"></span>
                </label>
                <span id="soundNotificationsLabel">${currentUser.sound_notifications_enabled ? 'Sons activés' : 'Sons désactivés'}</span>
                
            </div>
        </div>
    `;
    // Ajouter le toggle pour l'aide au montage
    profileHTML += `
        <div class="profile-field">
            <span class="field-label">Aide au montage</span>
            <div class="toggle-container">
                <label class="toggle-switch">
                    <input type="checkbox" id="plateHelperToggle"
                        ${currentUser.show_plate_helper ? 'checked' : ''}
                        onchange="togglePlateHelper()">
                    <span class="toggle-slider"></span>
                </label>
                <span id="plateHelperLabel">${currentUser.show_plate_helper ? 'Activé' : 'Désactivé'}</span>
            </div>
            <small class="field-description">Affiche la répartition des disques pendant les séances</small>
        </div>
    `;

    document.getElementById('profileInfo').innerHTML = profileHTML;

    // Add event listener for the toggle to update the label immediately
    const weightPreferenceToggle = document.getElementById('weightPreferenceToggle');
    if (weightPreferenceToggle) {
        weightPreferenceToggle.addEventListener('change', async (event) => {
            const label = document.getElementById('weightPreferenceLabel');
            if (label) {
                label.textContent = event.target.checked ? 'Poids variables' : 'Poids fixes';
            }
            // Appeler la fonction existante
            await toggleWeightPreference();
        });
    }
    // Initialiser l'état du système audio selon les préférences
    if (window.workoutAudio && currentUser) {
        window.workoutAudio.isEnabled = currentUser.sound_notifications_enabled ?? true;
    }
}

async function toggleWeightPreference() {
    const toggle = document.getElementById('weightPreferenceToggle');
    const newPreference = toggle.checked;
    
    try {
        // Utiliser apiPut au lieu de apiCall
        const response = await apiPut(`/api/users/${currentUser.id}/preferences`, {
            prefer_weight_changes_between_sets: newPreference
        });
        
        currentUser.prefer_weight_changes_between_sets = newPreference;
        document.getElementById('weightPreferenceLabel').textContent = 
            newPreference ? 'Poids variables' : 'Poids fixes';
        
        showToast('Préférence mise à jour', 'success');
    } catch (error) {
        toggle.checked = !newPreference; // Revert on error
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

async function toggleSoundNotifications() {
    const toggle = document.getElementById('soundNotificationsToggle');
    const newPreference = toggle.checked;
    
    try {
        // Mettre à jour dans la base de données
        const response = await apiPut(`/api/users/${currentUser.id}/preferences`, {
            sound_notifications_enabled: newPreference
        });
        
        // Mettre à jour l'objet utilisateur local
        currentUser.sound_notifications_enabled = newPreference;
        
        // Mettre à jour le label
        document.getElementById('soundNotificationsLabel').textContent = 
            newPreference ? 'Sons activés' : 'Sons désactivés';
        
        // Mettre à jour le système audio
        if (window.workoutAudio) {
            window.workoutAudio.isEnabled = newPreference;
        }
        
        showToast('Préférence mise à jour', 'success');
    } catch (error) {
        toggle.checked = !newPreference; // Revert on error
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

async function togglePlateHelper() {
    const toggle = document.getElementById('plateHelperToggle');
    const label = document.getElementById('plateHelperLabel');
    
    try {
        const response = await apiPut(`/api/users/${currentUser.id}/plate-helper`, {
            enabled: toggle.checked
        });
        
        currentUser.show_plate_helper = toggle.checked;
        label.textContent = toggle.checked ? 'Activé' : 'Désactivé';
        
        // Mise à jour immédiate si on est en séance
        if (currentExercise) {
            const weight = parseFloat(document.getElementById('setWeight')?.textContent) || 0;
            updatePlateHelper(weight);
        }
        
        console.log('Aide montage mise à jour:', toggle.checked);
    } catch (error) {
        console.error('Erreur toggle aide montage:', error);
        // Revenir à l'état précédent en cas d'erreur
        toggle.checked = !toggle.checked;
        showToast('Erreur lors de la sauvegarde', 'error');
    }
}

function editEquipment() {
    showModal('Modifier l\'équipement', `
        <p>Sélectionnez votre équipement disponible :</p>
        <div class="equipment-grid" id="modalEquipmentGrid">
            ${Object.entries(EQUIPMENT_CONFIG).map(([key, config]) => `
                <div class="equipment-card ${currentUser.equipment_config[key]?.available ? 'selected' : ''}" 
                     data-equipment="${key}" onclick="toggleModalEquipment(this)">
                    <div class="equipment-icon">${config.icon}</div>
                    <div class="equipment-name">${config.name}</div>
                </div>
            `).join('')}
        </div>
        <div style="margin-top: 1.5rem;">
            <button class="btn btn-primary" onclick="saveEquipmentChanges()">Sauvegarder</button>
            <button class="btn btn-secondary" onclick="closeModal()" style="margin-left: 0.5rem;">Annuler</button>
        </div>
    `);
}

function toggleModalEquipment(card) {
    card.classList.toggle('selected');
}

function estimateTrainingCapacity(config) {
    /**
     * Estime la capacité d'entraînement selon la configuration
     */
    let capacity = {
        exercises: 0,
        weight_range: { min: 0, max: 0 },
        versatility: 'basic'
    };
    
    // Calcul basé sur les disques
    if (config.weight_plates?.available) {
        const plates = config.weight_plates.weights || {};
        const totalDisques = Object.values(plates).reduce((sum, count) => sum + count, 0);
        
        if (totalDisques >= 15) {
            capacity.versatility = 'excellent';
            capacity.exercises += 50;
        } else if (totalDisques >= 10) {
            capacity.versatility = 'good';
            capacity.exercises += 30;
        } else {
            capacity.versatility = 'limited';
            capacity.exercises += 15;
        }
        
        // Estimation de la gamme de poids
        const maxWeight = Math.max(...Object.keys(plates).map(w => parseFloat(w))) * 4; // 4 disques max par côté
        capacity.weight_range.max = maxWeight;
    }
    
    // Ajustement selon le banc
    if (config.bench?.available) {
        const positions = config.bench.positions || {};
        if (positions.flat) capacity.exercises += 15;
        if (positions.incline_up) capacity.exercises += 8;
        if (positions.decline) capacity.exercises += 5;
    }
    
    // Ajustement selon les dumbbells/barres courtes
    if (config.dumbbells?.available || config.barbell_short_pair?.available) {
        capacity.exercises += 20;
    }
    
    return capacity;
}

function showConfigurationSummary() {
    /**
     * Affiche un résumé de la configuration actuelle
     */
    try {
        const config = collectEquipmentConfig();
        const capacity = estimateTrainingCapacity(config);
        
        const summaryHTML = `
            <div class="config-summary" style="background: var(--bg-card); padding: 1rem; border-radius: var(--radius); margin-top: 1rem;">
                <h4>📊 Résumé de votre configuration</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-top: 1rem;">
                    <div class="summary-item">
                        <div style="font-size: 1.5rem; font-weight: bold; color: var(--primary);">${capacity.exercises}+</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Exercices possibles</div>
                    </div>
                    <div class="summary-item">
                        <div style="font-size: 1.5rem; font-weight: bold; color: var(--success);">${capacity.weight_range.max}kg</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Poids maximum</div>
                    </div>
                    <div class="summary-item">
                        <div style="font-size: 1.5rem; font-weight: bold; color: var(--warning);">${capacity.versatility}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Polyvalence</div>
                    </div>
                </div>
            </div>
        `;
        
        const existingSummary = document.querySelector('.config-summary');
        if (existingSummary) {
            existingSummary.remove();
        }
        
        document.getElementById('detailedConfig').insertAdjacentHTML('beforeend', summaryHTML);
        
    } catch (error) {
        console.log('Configuration incomplète, résumé non disponible');
    }
}

async function saveEquipmentChanges() {
    try {
        const selectedCards = document.querySelectorAll('#modalEquipmentGrid .equipment-card.selected');
        const newEquipmentConfig = {};
        
        selectedCards.forEach(card => {
            const equipment = card.dataset.equipment;
            newEquipmentConfig[equipment] = { available: true };
            
            // Conserver les configurations existantes si elles existent
            if (currentUser.equipment_config[equipment]) {
                newEquipmentConfig[equipment] = currentUser.equipment_config[equipment];
            }
        });
        
        // Mettre à jour l'utilisateur
        await apiPut(`/api/users/${currentUser.id}`, {
            equipment_config: newEquipmentConfig
        });
        
        currentUser.equipment_config = newEquipmentConfig;
        closeModal();
        showToast('Équipement mis à jour avec succès', 'success');
        
    } catch (error) {
        console.error('Erreur mise à jour équipement:', error);
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

async function clearHistory() {
    if (!confirm('Êtes-vous sûr de vouloir vider votre historique ? Cette action est irréversible.')) return;
    
    try {
        await apiDelete(`/api/users/${currentUser.id}/history`);
        
        // Réinitialiser les variables de séance en cours
        currentWorkout = null;
        currentExercise = null;
        currentSet = 1;
        currentWorkoutSession = null;
        
        // Supprimer la bannière si elle existe
        const banner = document.querySelector('.workout-resume-banner');
        if (banner) {
            banner.remove();
        }
        
        showToast('Historique vidé avec succès', 'success');
        
        // Forcer le rechargement complet du dashboard
        await loadDashboard();
        
    } catch (error) {
        console.error('Erreur suppression historique:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
}

async function deleteProfile() {
    if (!confirm('Êtes-vous sûr de vouloir supprimer définitivement votre profil ? Cette action est irréversible.')) return;
    
    const confirmText = prompt('Tapez "SUPPRIMER" pour confirmer :');
    if (confirmText !== 'SUPPRIMER') return;
    
    try {
        await apiDelete(`/api/users/${currentUser.id}`);
        localStorage.removeItem('fitness_user_id');
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
    // Créer le toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Ajouter les styles
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
    
    // Couleur selon le type
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    toast.style.background = colors[type] || colors.info;
    
    document.body.appendChild(toast);
    
    // Supprimer après 3 secondes
    setTimeout(() => {
        toast.remove();
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

function setupEventListeners() {
    // Fermer le modal en cliquant à l'extérieur
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') {
            closeModal();
        }
    });
    
    // Filtre des exercices
    const muscleFilter = document.getElementById('muscleFilter');
    if (muscleFilter) {
        muscleFilter.addEventListener('change', filterExercises);
    }
}

function filterExercises() {
    const filter = document.getElementById('muscleFilter').value;
    const exercises = document.querySelectorAll('.exercise-item');
    
    exercises.forEach(exercise => {
        const text = exercise.textContent.toLowerCase();
        const exerciseId = parseInt(exercise.dataset.exerciseId);
        
        let visible = false;
        
        if (!filter) {
            visible = true;
        } else if (filter === 'favoris') {
            visible = userFavorites.includes(exerciseId);
        } else {
            visible = text.includes(filter.toLowerCase());
        }
        
        exercise.style.display = visible ? 'block' : 'none';
    });
}

// Fonction pour toggle un favori
async function toggleFavorite(exerciseId) {
    console.log('🔄 toggleFavorite appelé pour:', exerciseId);
    const starElement = document.querySelector(`[data-exercise-id="${exerciseId}"] .favorite-star`);
    if (!starElement) {
        console.error('❌ Étoile non trouvée pour exercice:', exerciseId);
        return;
    }
    
    // Prévenir les clics multiples
    if (starElement.classList.contains('updating')) return;
    starElement.classList.add('updating');
    
    try {
        const isFavorite = starElement.classList.contains('is-favorite');
        console.log('État actuel favori:', isFavorite);
        
        if (isFavorite) {
            // Retirer des favoris
            await apiDelete(`/api/users/${currentUser.id}/favorites/${exerciseId}`);
            starElement.classList.remove('is-favorite');
            userFavorites = userFavorites.filter(id => id !== exerciseId);
            currentUser.favorite_exercises = userFavorites;
            showToast('Retiré des favoris', 'info');
            
            // Masquer immédiatement si on est sur le filtre favoris
            const activeTab = document.querySelector('.muscle-tab.active');
            if (activeTab && activeTab.dataset.muscle === 'favoris') {
                const exerciseCard = document.querySelector(`[data-exercise-id="${exerciseId}"]`);
                if (exerciseCard) exerciseCard.style.display = 'none';
            }
            
        } else {
            // Vérifier la limite
            if (userFavorites.length >= 10) {
                showToast('Maximum 10 exercices favoris autorisés', 'warning');
                return;
            }
            
            // Ajouter aux favoris
            await apiPost(`/api/users/${currentUser.id}/favorites/${exerciseId}`);
            starElement.classList.add('is-favorite');
            userFavorites.push(exerciseId);
            currentUser.favorite_exercises = userFavorites;
            showToast(`Ajouté aux favoris (${userFavorites.length}/10)`, 'success');
        }
        
        // Mettre à jour le compteur et affichage
        updateFavoritesTabCount();
        console.log('✅ Favoris mis à jour:', userFavorites);
        
    } catch (error) {
        console.error('❌ Erreur toggle favori:', error);
        showToast('Erreur lors de la mise à jour', 'error');
    } finally {
        starElement.classList.remove('updating');
    }
}

function updateFavoritesTabCount() {
    const favoritesTab = document.querySelector('.muscle-tab[data-muscle="favoris"]');
    if (favoritesTab) {
        const countElement = favoritesTab.querySelector('.tab-count');
        if (countElement) {
            countElement.textContent = userFavorites.length;
        }
        
        // Afficher/masquer l'onglet
        if (userFavorites.length === 0) {
            favoritesTab.style.display = 'none';
            // Si on était sur favoris, basculer sur "tous"
            if (favoritesTab.classList.contains('active')) {
                const allTab = document.querySelector('.muscle-tab[data-muscle="all"]');
                if (allTab) {
                    allTab.click();
                }
            }
        } else {
            favoritesTab.style.display = 'flex';
        }
    } else {
        console.log('⚠️ Onglet favoris non trouvé, rechargement nécessaire');
        // Forcer rechargement des exercices si onglet pas trouvé
        if (userFavorites.length > 0) {
            loadAvailableExercises();
        }
    }
}

// Mettre à jour l'affichage d'une étoile
function updateFavoriteDisplay(exerciseId) {
    const exerciseCard = document.querySelector(`.free-exercise-card[data-exercise-id="${exerciseId}"]`);
    if (!exerciseCard) return;
    
    const star = exerciseCard.querySelector('.favorite-star');
    if (!star) return;
    
    if (userFavorites.includes(exerciseId)) {
        star.classList.add('is-favorite');
    } else {
        star.classList.remove('is-favorite');
    }
    
    // Mettre à jour le compteur de l'onglet favoris
    const favorisTab = document.querySelector('.muscle-tab[data-muscle="favoris"]');
    if (favorisTab) {
        const count = favorisTab.querySelector('.tab-count');
        if (count) {
            count.textContent = userFavorites.length;
        }
    }
}

function playRestSound(type) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    switch(type) {
        case 'start':
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
            for(let i = 0; i < 3; i++) {
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
}

// ===== GESTION DES ERREURS ET OFFLINE =====
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
    isOnline = true;
    showToast('Connexion rétablie', 'success');
});

window.addEventListener('offline', () => {
    isOnline = false;
    showToast('Mode hors ligne', 'warning');
});

function showExerciseSelection() {
    document.getElementById('exerciseSelection').style.display = 'block';
    document.getElementById('currentExercise').style.display = 'none';
    loadAvailableExercises();
}

// ===== API AVEC GESTION D'ERREUR AMÉLIORÉE =====
async function apiRequest(url, options = {}, retries = 3) {
    if (!isOnline && !url.includes('health')) {
        throw new Error('Aucune connexion internet');
    }
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            if (!response.ok) {
                // Pour les erreurs 5xx (serveur), retry automatique
                if (response.status >= 500 && attempt < retries) {
                    const delay = Math.pow(2, attempt) * 1000; // Backoff exponentiel
                    console.warn(`Erreur ${response.status}, retry ${attempt + 1}/${retries} dans ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    typeof errorData.detail === 'string' 
                        ? errorData.detail 
                        : JSON.stringify(errorData.detail) || `HTTP ${response.status}: ${response.statusText}`
                );
            }
            
            return await response.json();
        } catch (error) {
            // Si c'est la dernière tentative, propager l'erreur
            if (attempt === retries) {
                console.error('Erreur API finale:', error);
                
                if (error.message.includes('Failed to fetch')) {
                    throw new Error('Problème de connexion au serveur');
                }
                if (error.message.includes('404')) {
                    throw new Error('Ressource non trouvée');
                }
                if (error.message.includes('500') || error.message.includes('502')) {
                    throw new Error('Serveur temporairement indisponible');
                }
                
                throw error;
            }
            
            // Pour les erreurs réseau, retry aussi
            if (error.message.includes('Failed to fetch')) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`Erreur réseau, retry ${attempt + 1}/${retries} dans ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            throw error;
        }
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

async function loadProgramExercisesList() {
    if (!currentWorkoutSession.program) return;
    
    const container = document.getElementById('programExercisesContainer');
    if (!container) {
        console.warn('Container programExercisesContainer non trouvé');
        return;
    }
    
    try {
        // Récupérer les détails des exercices
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        
        // Calculer les stats
        const completedCount = Object.values(currentWorkoutSession.programExercises)
            .filter(ex => ex.isCompleted).length;
        const totalCount = currentWorkoutSession.program.exercises.length;
        const remainingTime = (totalCount - completedCount) * 8; // Estimation simple
        
        // Générer le HTML
        container.innerHTML = `
            <div class="program-header">
                <h3>Programme du jour</h3>
                <div class="program-summary">
                    <div class="progress-circle">${completedCount}/${totalCount}</div>
                    <span>${completedCount} exercice${completedCount > 1 ? 's' : ''} complété${completedCount > 1 ? 's' : ''} • ~${remainingTime} min restantes</span>
                </div>
            </div>
            
            <div class="exercises-list">
                ${currentWorkoutSession.program.exercises.map((exerciseData, index) => {
                    const exercise = exercises.find(ex => ex.id === exerciseData.exercise_id);
                    if (!exercise) return '';
                    
                    const exerciseState = currentWorkoutSession.programExercises[exerciseData.exercise_id];
                    const isCurrentExercise = currentExercise && currentExercise.id === exerciseData.exercise_id;
                    
                    // Classes et état
                    let cardClass = 'exercise-card';
                    let indexContent = index + 1;
                    let actionIcon = '→';
                    let statusBadge = '';

                    if (exerciseState.isCompleted) {
                        cardClass += ' completed';
                        indexContent = '✓';
                        actionIcon = '↻';
                        statusBadge = '<div class="status-badge">✓ Terminé</div>';
                    } else if (exerciseState.isSkipped) {
                        cardClass += ' skipped';
                        indexContent = '⏭';
                        actionIcon = '↺';
                        statusBadge = `<div class="status-badge skipped">Passé (${exerciseState.skipReason})</div>`;
                    } else if (isCurrentExercise) {
                        cardClass += ' current';
                    } else if (exerciseState.completedSets > 0) {
                        statusBadge = `<div class="status-badge partial">${exerciseState.completedSets}/${exerciseState.totalSets} séries</div>`;
                    }
                    
                    // Générer les dots de progression
                    let dotsHtml = '';
                    for (let i = 0; i < exerciseState.totalSets; i++) {
                        dotsHtml += `<div class="set-dot ${i < exerciseState.completedSets ? 'done' : ''}"></div>`;
                    }
                    
                    return `
                        <div class="${cardClass}" data-muscle="${exercise.muscle_groups[0].toLowerCase()}" onclick="handleExerciseCardSimpleClick(${exerciseData.exercise_id})">
                            ${statusBadge}
                            <div class="card-content">
                                <div class="exercise-index">${indexContent}</div>
                                <div class="exercise-info">
                                    <div class="exercise-name">${exercise.name}</div>
                                    ${exercise.mlReason ? `<span class="ml-badge" title="${exercise.mlReason}">
                                        <i class="fas fa-brain"></i> ${exercise.mlScore ? Math.round(exercise.mlScore * 100) + '%' : 'ML'}
                                    </span>` : ''}
                                    <div class="exercise-details">
                                        <span class="muscle-groups">${exercise.muscle_groups.join(' • ')}</span>
                                        <span class="sets-indicator">${exerciseData.sets || 3}×${exerciseData.target_reps || exercise.default_reps_min}-${exerciseData.target_reps || exercise.default_reps_max}</span>
                                    </div>
                                </div>
                                <div class="exercise-progress">
                                    <div class="sets-counter">${exerciseState.completedSets}/${exerciseState.totalSets}</div>
                                    <div class="sets-dots">${dotsHtml}</div>
                                </div>
                                    <div class="action-buttons">
                                        ${exerciseState.isCompleted ? 
                                            `<button class="action-btn" onclick="event.stopPropagation(); restartExercise(${exerciseData.exercise_id})" title="Refaire">↻</button>` :
                                        exerciseState.isSkipped ? 
                                            `<button class="action-btn" onclick="event.stopPropagation(); restartSkippedExercise(${exerciseData.exercise_id})" title="Reprendre">↺</button>` :
                                            `<button class="action-btn primary" onclick="event.stopPropagation(); selectProgramExercise(${exerciseData.exercise_id})" title="Commencer">${exerciseState.completedSets > 0 ? '▶' : '→'}</button>
                                            ${canSwapExercise(exerciseData.exercise_id) ? 
                                            `<button class="action-btn swap-btn" onclick="event.stopPropagation(); initiateSwap(${exerciseData.exercise_id})" title="Changer d'exercice" style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none;">⇄</button>` : ''}
                                            <button class="action-btn secondary" onclick="event.stopPropagation(); showSkipModal(${exerciseData.exercise_id})" title="Passer">⏭</button>`
                                        }
                                    </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
    } catch (error) {
        console.error('Erreur chargement liste exercices programme:', error);
    }
}

function handleExerciseCardSimpleClick(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    if (currentExercise && currentExercise.id === exerciseId) {
        // Déjà sur cet exercice
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

function handleExerciseAction(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    if (exerciseState.isCompleted) {
        // Refaire l'exercice
        if (confirm('Refaire cet exercice ?')) {
            restartExercise(exerciseId);
        }
    } else {
        // Commencer/continuer l'exercice
        selectProgramExercise(exerciseId);
    }
}

// Exposer les fonctions
window.handleExerciseCardSimpleClick = handleExerciseCardSimpleClick;
window.handleExerciseAction = handleExerciseAction;

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

async function selectProgramExercise(exerciseId, isInitialLoad = false) {
    if (!currentWorkoutSession.program) return;
    
    // Vérifier l'état actuel et demander confirmation si nécessaire
    if (!isInitialLoad && workoutState.current === WorkoutStates.EXECUTING) {
        if (!confirm('Une série est en cours. Voulez-vous vraiment changer d\'exercice ?')) {
            return;
        }
    }
    
    if (!isInitialLoad && restTimer) {
        if (!confirm('Vous êtes en période de repos. Voulez-vous vraiment changer d\'exercice ?')) {
            return;
        }
    }
    
    // Sauvegarder l'état de l'exercice actuel
    if (currentExercise && !isInitialLoad) {
        await saveCurrentExerciseState();
    }
    
    // Nettoyer l'état actuel
    cleanupCurrentState();
    
    try {
        // Récupérer les détails du nouvel exercice
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const newExercise = exercises.find(ex => ex.id === exerciseId);
        
        if (!newExercise) {
            showToast('Exercice non trouvé', 'error');
            return;
        }
        
        // S'assurer que le type est bien défini
        currentWorkoutSession.type = 'program';
        
        // Utiliser selectExercise qui existe déjà avec les bons paramètres
        const exerciseState = currentWorkoutSession.programExercises[exerciseId];
        exerciseState.startTime = exerciseState.startTime || new Date();
        
        // Utiliser l'objet complet avec tous les champs
        const exerciseObj = {
            ...newExercise,  // Copier TOUS les champs de newExercise
            default_sets: exerciseState.totalSets  // Surcharger uniquement le nombre de séries
        };
        
        // Mettre à jour le nombre de séries déjà complétées
        currentSet = exerciseState.completedSets + 1;
        currentWorkoutSession.currentSetNumber = currentSet;
        currentWorkoutSession.exerciseOrder = exerciseState.index + 1;

        // S'assurer que l'exerciseOrder est bien propagé
        if (!currentWorkoutSession.exerciseOrder) {
            currentWorkoutSession.exerciseOrder = 1;
        }
                
        // Utiliser la fonction selectExercise existante ET attendre qu'elle finisse
        await selectExercise(exerciseObj);
        
        // Mettre à jour la liste des exercices
        loadProgramExercisesList();
        
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
    
    // Vérifier si l'exercice est terminé
    if (completedSetsForThisExercise >= exerciseState.totalSets) {
        exerciseState.isCompleted = true;
        currentWorkoutSession.completedExercisesCount++;
    }
}

function cleanupCurrentState() {
    // Arrêter tous les timers
    if (setTimer) {
        clearInterval(setTimer);
        setTimer = null;
    }
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
    
    // Annuler les notifications en attente
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    
    // Cacher les interfaces de feedback/repos
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('restPeriod').style.display = 'none';
    
    // Réinitialiser l'état
    workoutState = {
        current: WorkoutStates.IDLE,
        exerciseStartTime: null,
        setStartTime: null,
        restStartTime: null,
        pendingSetData: null
    };
}

async function restartExercise(exerciseId) {
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    // Réinitialiser l'état de l'exercice
    exerciseState.completedSets = 0;
    exerciseState.isCompleted = false;
    exerciseState.startTime = new Date();
    exerciseState.endTime = null;
    
    // Supprimer les séries de cet exercice de l'historique
    currentWorkoutSession.completedSets = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id !== exerciseId
    );
    
    // Mettre à jour le compteur global
    currentWorkoutSession.completedExercisesCount = Object.values(currentWorkoutSession.programExercises)
        .filter(ex => ex.isCompleted).length;
    
    // Sélectionner l'exercice
    await selectProgramExercise(exerciseId);
}


// ===== FONCTIONS UTILITAIRES SÉANCES =====
async function loadAvailableExercises() {
    console.log('🔍 [DEBUG] loadAvailableExercises - currentUser:', currentUser?.id);
    console.log('🔍 [DEBUG] currentUser.favorite_exercises avant:', currentUser?.favorite_exercises);
    
    // CORRECTION CRITIQUE : Toujours recharger les favoris
    try {
        const favoritesResponse = await apiGet(`/api/users/${currentUser.id}/favorites`);
        currentUser.favorite_exercises = favoritesResponse.favorites || [];
        userFavorites = currentUser.favorite_exercises;
        console.log('✅ Favoris rechargés:', userFavorites);
    } catch (error) {
        console.error('❌ Erreur chargement favoris:', error);
        currentUser.favorite_exercises = [];
        userFavorites = [];
    }
    
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        
        // Grouper les exercices par muscle
        const exercisesByMuscle = {
            favoris: [],  // Nouveau groupe pour les favoris
            dos: [],
            pectoraux: [],
            jambes: [],
            epaules: [],
            bras: [],
            abdominaux: []
        };
        // Import des couleurs depuis le système centralisé  
        const chartColors = window.MuscleColors.getChartColors();
        backgroundColor: Object.values(chartColors)
        
        // Icônes pour chaque groupe
        const muscleIcons = {
            favoris: '⭐',  // Icône pour les favoris
            dos: '🏋🏻‍♂️',
            pectoraux: '🫁',
            jambes: '🦵',
            epaules: '🤷🏻',
            bras: '🦾',
            abdominaux: '🍫'
        };
        
        // Classer les exercices
        exercises.forEach(exercise => {
            // Ajouter aux favoris si applicable
            if (userFavorites.includes(exercise.id)) {
                exercisesByMuscle.favoris.push(exercise);
            }
            
            // Classement normal par muscle
            exercise.muscle_groups.forEach(muscle => {
                const muscleLower = muscle.toLowerCase();
                if (exercisesByMuscle[muscleLower]) {
                    exercisesByMuscle[muscleLower].push(exercise);
                }
            });
        });
        
        // Trier chaque groupe : d'abord par niveau, puis alphabétiquement
        Object.keys(exercisesByMuscle).forEach(muscle => {
            exercisesByMuscle[muscle].sort((a, b) => {
                // Ordre des niveaux : beginner < intermediate < advanced
                const levelOrder = { 'beginner': 1, 'intermediate': 2, 'advanced': 3 };
                const levelA = levelOrder[a.difficulty] || 2;
                const levelB = levelOrder[b.difficulty] || 2;
                
                if (levelA !== levelB) {
                    return levelA - levelB;
                }
                // Si même niveau, trier alphabétiquement
                return a.name.localeCompare(b.name);
            });
        });

        // Générer le HTML avec un nouveau design
        const muscleGroupsContainer = document.getElementById('muscleGroupsContainer');
        if (muscleGroupsContainer) {
            // Créer la barre de recherche et les onglets
            muscleGroupsContainer.innerHTML = `
                <!-- Barre de recherche et filtres -->
                <div class="exercise-filters">
                    <div class="search-container">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input type="text" id="exerciseSearch" placeholder="Rechercher un exercice..." 
                            oninput="searchExercises(this.value)">
                    </div>
                    
                    <!-- Onglets de filtrage par muscle -->
                    <div class="muscle-tabs">
                        <button class="muscle-tab active" data-muscle="all" onclick="filterByMuscleGroup('all')">
                            <span class="tab-icon">💪</span>
                            <span>Tous</span>
                        </button>
                        <button class="muscle-tab" data-muscle="favoris" onclick="filterByMuscleGroup('favoris')" 
                                style="${userFavorites.length === 0 ? 'display: none;' : ''}">
                            <span class="tab-icon">⭐</span>
                            <span>Favoris</span>
                            <span class="tab-count">${exercisesByMuscle.favoris.length}</span>
                        </button>
                        ${Object.entries(exercisesByMuscle)
                            .filter(([muscle, exercises]) => muscle !== 'favoris' && exercises.length > 0)
                            .map(([muscle, exercises]) => `
                                <button class="muscle-tab" data-muscle="${muscle}" onclick="filterByMuscleGroup('${muscle}')">
                                    <span class="tab-icon">${muscleIcons[muscle]}</span>
                                    <span>${muscle.charAt(0).toUpperCase() + muscle.slice(1)}</span>
                                    <span class="tab-count">${exercises.length}</span>
                                </button>
                            `).join('')}
                    </div>
                </div>
                
                <!-- Liste des exercices -->
                <div class="exercises-results" id="exercisesResults">
                    ${Object.entries(exercisesByMuscle)
                        .filter(([muscle, exercises]) => exercises.length > 0)
                        .map(([muscle, muscleExercises]) => `
                            <div class="muscle-group-section muscle-group-${muscle}" data-muscle="${muscle}">
                                <div class="muscle-group-header collapsible" onclick="toggleMuscleGroup('${muscle}')">
                                    <div class="header-left">
                                        <div class="muscle-group-icon">${muscleIcons[muscle]}</div>
                                        <h3>${muscle.charAt(0).toUpperCase() + muscle.slice(1)}</h3>
                                        <span class="exercise-count">${muscleExercises.length} exercices</span>
                                    </div>
                                    <svg class="collapse-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </div>
                                <div class="muscle-exercises-grid expanded">
                                    ${muscleExercises.map((exercise, index) => {
                                        // Échapper les caractères problématiques
                                        const safeExerciseData = {
                                            id: exercise.id,
                                            name: exercise.name,
                                            instructions: (exercise.instructions || '').replace(/'/g, "''").replace(/"/g, '\\"'),
                                            muscle_groups: exercise.muscle_groups,
                                            equipment_required: exercise.equipment_required || [],
                                            difficulty: exercise.difficulty,
                                            default_sets: exercise.default_sets || 3,
                                            default_reps_min: exercise.default_reps_min || 8,
                                            default_reps_max: exercise.default_reps_max || 12,
                                            base_rest_time_seconds: exercise.base_rest_time_seconds || 90
                                        };
                                        
                                        return `
                                            <div class="free-exercise-card" 
                                                data-exercise-name="${exercise.name.toLowerCase()}" 
                                                data-muscle="${muscle}" 
                                                data-difficulty="${exercise.difficulty}"
                                                data-exercise-id="${exercise.id}"
                                                onclick="selectExerciseById(${exercise.id})">
                                                <div class="favorite-star ${userFavorites.includes(exercise.id) ? 'is-favorite' : ''}" 
                                                     onclick="event.stopPropagation(); toggleFavorite(${exercise.id})">
                                                    <svg viewBox="0 0 24 24" stroke-width="2">
                                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                                    </svg>
                                                </div>
                                                <div class="exercise-card-header">
                                                    <h4>${exercise.name}</h4>
                                                    <span class="difficulty-badge difficulty-${exercise.difficulty}">
                                                        ${exercise.difficulty === 'beginner' ? 'Débutant' : 
                                                        exercise.difficulty === 'intermediate' ? 'Intermédiaire' : 'Avancé'}
                                                    </span>
                                                </div>
                                                <div class="free-exercise-meta">
                                                    ${exercise.equipment_required && exercise.equipment_required.length > 0 ? 
                                                        `<span>🏋️ ${exercise.equipment_required.join(', ')}</span>` : 
                                                        '<span>💪 Poids du corps</span>'}
                                                    <span>📊 ${exercise.default_sets}×${exercise.default_reps_min}-${exercise.default_reps_max}</span>
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `).join('')}
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Erreur chargement exercices:', error);
        showToast('Erreur chargement des exercices', 'error');
    }
}

// Fonction de recherche d'exercices
function searchExercises(searchTerm) {
    const normalizedSearch = searchTerm.toLowerCase().trim();
    const exerciseCards = document.querySelectorAll('.free-exercise-card');
    const muscleGroups = document.querySelectorAll('.muscle-group-section');
    
    exerciseCards.forEach(card => {
        const exerciseName = card.dataset.exerciseName;
        const isMatch = exerciseName.includes(normalizedSearch);
        card.style.display = isMatch ? 'block' : 'none';
    });
    
    // Cacher les groupes sans résultats
    muscleGroups.forEach(group => {
        const visibleCards = group.querySelectorAll('.free-exercise-card[style="display: block;"], .free-exercise-card:not([style])');
        group.style.display = visibleCards.length > 0 ? 'block' : 'none';
    });
    
    // Si recherche vide, tout afficher
    if (!normalizedSearch) {
        exerciseCards.forEach(card => card.style.display = 'block');
        muscleGroups.forEach(group => group.style.display = 'block');
    }
}

// Fonction de filtrage par muscle
function filterByMuscleGroup(selectedMuscle) {
    // Mettre à jour l'onglet actif
    document.querySelectorAll('.muscle-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const targetTab = document.querySelector(`.muscle-tab[data-muscle="${selectedMuscle}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // Afficher/masquer les sections
    const allSections = document.querySelectorAll('.muscle-group-section');
    const allCards = document.querySelectorAll('.free-exercise-card');
    
    if (selectedMuscle === 'all') {
        // Afficher tout
        allSections.forEach(section => section.style.display = 'block');
        allCards.forEach(card => card.style.display = 'block');
    } else if (selectedMuscle === 'favoris') {
        // Afficher seulement les favoris
        allSections.forEach(section => section.style.display = 'block');
        allCards.forEach(card => {
            const exerciseId = parseInt(card.dataset.exerciseId);
            const isFavorite = userFavorites.includes(exerciseId);
            card.style.display = isFavorite ? 'block' : 'none';
        });
        
        // Masquer les sections qui n'ont aucun favori visible
        allSections.forEach(section => {
            const visibleCards = section.querySelectorAll('.free-exercise-card[style*="block"], .free-exercise-card:not([style*="none"])');
            section.style.display = visibleCards.length > 0 ? 'block' : 'none';
        });
        
        // Afficher message si aucun favori
        if (userFavorites.length === 0) {
            showNoFavoritesMessage();
        }
    } else {
        // Filtrer par muscle spécifique
        allSections.forEach(section => {
            section.style.display = section.dataset.muscle === selectedMuscle ? 'block' : 'none';
        });
        allCards.forEach(card => card.style.display = 'block');
    }
}

function showNoFavoritesMessage() {
    const resultsContainer = document.getElementById('exercisesResults');
    if (resultsContainer && userFavorites.length === 0) {
        resultsContainer.innerHTML = `
            <div class="no-favorites-message">
                <div class="no-favorites-icon">⭐</div>
                <h3>Aucun exercice favori</h3>
                <p>Cliquez sur l'étoile d'un exercice pour l'ajouter à vos favoris</p>
            </div>
        `;
    }
}

// Ajouter après la fonction toggleMuscleGroup()
function enableHorizontalScroll() {
    const muscleTabsContainer = document.querySelector('.muscle-tabs');
    if (!muscleTabsContainer) return;
    
    let isDown = false;
    let startX;
    let scrollLeft;
    
    // Défilement avec clic maintenu
    muscleTabsContainer.addEventListener('mousedown', (e) => {
        // Ne pas interférer avec les clics sur les boutons
        if (e.target.classList.contains('muscle-tab')) return;
        
        isDown = true;
        muscleTabsContainer.style.cursor = 'grabbing';
        startX = e.pageX - muscleTabsContainer.offsetLeft;
        scrollLeft = muscleTabsContainer.scrollLeft;
    });
    
    muscleTabsContainer.addEventListener('mouseleave', () => {
        isDown = false;
        muscleTabsContainer.style.cursor = 'grab';
    });
    
    muscleTabsContainer.addEventListener('mouseup', () => {
        isDown = false;
        muscleTabsContainer.style.cursor = 'grab';
    });
    
    muscleTabsContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - muscleTabsContainer.offsetLeft;
        const walk = (x - startX) * 2;
        muscleTabsContainer.scrollLeft = scrollLeft - walk;
    });
    
    // Défilement horizontal avec Shift + molette
    muscleTabsContainer.addEventListener('wheel', (e) => {
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
            muscleTabsContainer.scrollLeft += e.deltaY || e.deltaX;
        }
    });
}

// Fonction pour sélectionner un exercice depuis une carte
function selectExerciseFromCard(element) {
    try {
        const exerciseData = JSON.parse(element.dataset.exercise);
        selectExercise(exerciseData);
    } catch (error) {
        console.error('Erreur parsing exercice:', error);
        showToast('Erreur lors de la sélection', 'error');
    }
}


// ===== GESTION AVANCÉE DU REPOS =====
function calculateAdaptiveRestTime(exercise, fatigue, effort, setNumber) {
    let baseRest = exercise.base_rest_time_seconds || 60;
    
    // Ajustement selon l'intensité de l'exercice
    baseRest *= (exercise.intensity_factor || 1.0);
    
    // Ajustement selon la fatigue (1=très frais, 5=très fatigué)
    const fatigueMultiplier = {
        1: 0.8,  // Frais = moins de repos
        2: 0.9,
        3: 1.0,  // Normal
        4: 1.2,
        5: 1.4   // Très fatigué = plus de repos
    }[fatigue] || 1.0;
    
    // Ajustement selon l'effort (1=très facile, 5=échec)
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

// ===== ANALYTICS ET INSIGHTS =====
function calculateSessionStats() {
    const stats = {
        totalSets: currentWorkoutSession.completedSets.length,
        totalVolume: 0,
        averageFatigue: 0,
        averageEffort: 0,
        exercisesCount: new Set(currentWorkoutSession.completedSets.map(s => s.exercise_id)).size
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
    }
    
    return stats;
}

function showSessionSummary() {
    const stats = calculateSessionStats();
    
    showModal('Résumé de la séance', `
        <div class="session-summary">
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
                <div class="stat-value">${stats.averageFatigue.toFixed(1)}/5</div>
                <div class="stat-label">Fatigue moyenne</div>
            </div>
            <div class="summary-stat">
                <div class="stat-value">${stats.averageEffort.toFixed(1)}/5</div>
                <div class="stat-label">Effort moyen</div>
            </div>
        </div>
        
        <div style="margin-top: 2rem; text-align: center;">
            <p>Excellent travail ! 💪</p>
            <button class="btn btn-primary" onclick="closeModal(); showView('dashboard');">
                Retour au dashboard
            </button>
        </div>
    `);
}

// ===== VIBRATIONS ET NOTIFICATIONS =====


function sendNotification(title, body, options = {}) {
    if ('Notification' in window && Notification.permission === 'granted') {
        return new Notification(title, {
            body: body,
            icon: '/manifest.json',
            badge: '/manifest.json',
            tag: 'fitness-workout',
            ...options
        });
    }
}

function vibratePattern(pattern) {
    if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
    }
}

// ===== SAUVEGARDE ET RÉCUPÉRATION D'ÉTAT =====
function saveWorkoutState() {
    const state = {
        workout: currentWorkoutSession.workout,
        currentExercise: currentWorkoutSession.currentExercise,
        currentSetNumber: currentWorkoutSession.currentSetNumber,
        exerciseOrder: currentWorkoutSession.exerciseOrder,
        globalSetCount: currentWorkoutSession.globalSetCount,
        sessionFatigue: currentWorkoutSession.sessionFatigue,
        completedSets: currentWorkoutSession.completedSets,
        timestamp: new Date().toISOString()
    };
    
    localStorage.setItem('fitness_workout_state', JSON.stringify(state));
}

function loadWorkoutState() {
    try {
        const savedState = localStorage.getItem('fitness_workout_state');
        if (savedState) {
            const state = JSON.parse(savedState);
            
            // Vérifier que l'état n'est pas trop ancien (max 24h)
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
    // Arrêter tous les timers actifs
    if (setTimer) {
        clearInterval(setTimer);
        setTimer = null;
    }
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
    if (workoutTimer) {
        clearInterval(workoutTimer);
        workoutTimer = null;
    }
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    
    // Réinitialiser toutes les variables
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
    
    // Réinitialiser complètement currentWorkoutSession
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
        mlSettings: {},
        mlHistory: {}  // S'assurer que c'est un objet vide
    };
    
    // Nettoyer aussi l'affichage de l'historique ML
    const mlHistoryTimeline = document.getElementById('mlHistoryTimeline');
    if (mlHistoryTimeline) mlHistoryTimeline.innerHTML = '';

    // Réinitialiser aussi les variables globales
    currentWorkout = null;
    currentExercise = null;
    currentSet = 1;
}

// ===== AMÉLIORATIONS DE L'INTERFACE =====
function updateExerciseProgress() {
    // Mettre à jour visuellement les éléments de l'interface
    const progressElement = document.querySelector('.workout-progress');
    if (progressElement) {
        const totalExercises = currentWorkoutSession.type === 'program' ? 
            getCurrentProgramExercisesCount() : '∞';
        
        progressElement.innerHTML = `
            <div>Exercice ${currentWorkoutSession.exerciseOrder}${totalExercises !== '∞' ? '/' + totalExercises : ''}</div>
            <div>Série ${currentWorkoutSession.currentSetNumber}</div>
            <div>${currentWorkoutSession.globalSetCount} séries totales</div>
        `;
    }
}

function getCurrentProgramExercisesCount() {
    // TODO: Récupérer le nombre d'exercices du programme actuel
    return 3; // Placeholder
}

// ===== GESTION D'ERREURS ET VALIDATION =====
function validateWorkoutState() {
    if (!currentWorkoutSession.workout) {
        showToast('Erreur: Aucune séance active', 'error');
        showView('dashboard');
        return false;
    }
    
    if (!currentUser) {
        showToast('Erreur: Utilisateur non connecté', 'error');
        showOnboarding();
        return false;
    }
    
    return true;
}

function handleWorkoutError(error, context) {
    console.error(`Erreur ${context}:`, error);
    
    const errorMessages = {
        'network': 'Problème de connexion. Vérifiez votre réseau.',
        'validation': 'Données invalides. Veuillez vérifier vos saisies.',
        'server': 'Erreur serveur. Réessayez dans quelques instants.',
        'permission': 'Permissions insuffisantes.',
        'not_found': 'Ressource non trouvée.'
    };
    
    const message = errorMessages[context] || 'Une erreur est survenue.';
    showToast(message, 'error');
    
    // Sauvegarder l'état en cas de problème
    saveWorkoutState();
}

// ===== INITIALISATION AU CHARGEMENT DE LA PAGE =====
document.addEventListener('DOMContentLoaded', () => {
    // Vérifier s'il y a un état de séance sauvegardé
    const savedState = loadWorkoutState();
    if (savedState && savedState.workout) {
        // Proposer de reprendre la séance
        setTimeout(() => {
            if (confirm('Une séance était en cours. Voulez-vous la reprendre ?')) {
                resumeWorkout(savedState.workout.id);
            } else {
                clearWorkoutState();
            }
        }, 1000);
    }
    
    // Demander les permissions
    setTimeout(() => {
        requestNotificationPermission();
    }, 2000);
});

// ===== GESTION DES POIDS SUGGÉRÉS =====
async function getSuggestedWeight(exerciseId, setNumber) {
    try {
        // Récupérer les poids disponibles
        const weightsData = await apiGet(`/api/users/${currentUser.id}/available-weights`);
        const availableWeights = weightsData.available_weights.sort((a, b) => a - b);
        
        // Récupérer l'historique de l'exercice
        const stats = await apiGet(`/api/users/${currentUser.id}/progress?days=30`);
        const exerciseRecord = stats.exercise_records.find(r => r.exercise_id === exerciseId);
        
        if (exerciseRecord && exerciseRecord.max_weight) {
            // Suggérer un poids basé sur le record précédent
            let suggestedWeight = exerciseRecord.max_weight;
            
            // Ajustement selon le numéro de série (fatigue progressive)
            if (setNumber > 1) {
                suggestedWeight *= (1 - (setNumber - 1) * 0.05); // -5% par série
            }
            
            // Trouver le poids disponible le plus proche
            return findClosestWeight(suggestedWeight, availableWeights);
        }
        
        // Pour un nouvel exercice, commencer avec un poids conservateur
        const bodyWeight = currentUser.weight;
        let baseWeight = bodyWeight * 0.3; // 30% du poids de corps
        
        return findClosestWeight(baseWeight, availableWeights);
        
    } catch (error) {
        console.error('Erreur calcul poids suggéré:', error);
        return null;
    }
}

function findClosestWeight(targetWeight, availableWeights) {
    if (!availableWeights || availableWeights.length === 0) return null;
    
    return availableWeights.reduce((closest, weight) => {
        return Math.abs(weight - targetWeight) < Math.abs(closest - targetWeight) ? weight : closest;
    });
}

// ===== AIDE AU MONTAGE DES BARRES (VERSION OPTIMISÉE) =====
async function updatePlateHelper(weight) {
    // Debug logging
    console.log('[PlateHelper] Update called:', {
        weight,
        hasExercise: !!currentExercise,
        showHelper: currentUser?.show_plate_helper
    });
    // Validation du poids pour dumbbells
    if (currentExercise?.equipment_required?.includes('dumbbells') && weight % 2 !== 0) {
        console.warn('[PlateHelper] Poids impair détecté pour dumbbells:', weight);
        weight = Math.round(weight / 2) * 2;
    }
    
    // Vérifications de base (sans currentExercise)
    if (!currentUser?.show_plate_helper || !weight || weight <= 0) {
        hidePlateHelper();
        return;
    }
    
    // Si pas d'exercice, attendre un peu et réessayer
    if (!currentExercise) {
        console.log('[PlateHelper] Waiting for exercise...');
        setTimeout(() => updatePlateHelper(weight), 200);
        return;
    }
    
    try {
        // Utiliser le poids depuis les recommandations ML si disponible
        const mlWeight = currentWorkoutSession?.lastRecommendations?.weight_recommendation;
        const weightToUse = mlWeight || weight;
        
        console.log('[PlateHelper] Poids ML:', mlWeight, 'Poids affiché:', weight);
        
        const layout = await apiGet(`/api/users/${currentUser.id}/plate-layout/${weightToUse}?exercise_id=${currentExercise.id}`);
        
        // Si le layout retourne un poids différent, c'est une erreur
        if (layout.feasible && layout.weight !== weightToUse) {
            console.error('[PlateHelper] Incohérence:', weightToUse, 'vs', layout.weight);
        }
        
        showPlateHelper(layout);
    } catch (error) {
        console.error('[PlateHelper] Error:', error);
        hidePlateHelper();
    }
}

function showPlateHelper(layout) {
    let container = document.getElementById('plateHelper');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'plateHelper';
        container.className = 'plate-helper-minimal';  // Classe modifiée
        
        const weightRow = document.querySelector('.input-row:has(#setWeight)');
        if (weightRow) {
            weightRow.insertAdjacentElement('afterend', container);
        }
    }
    
    if (!layout.feasible) {
        container.innerHTML = `<div class="helper-error">⚠️ ${layout.reason}</div>`;
        return;
    }
    
    container.innerHTML = createSimpleLayout(layout);
}

function createSimpleLayout(layout) {
    const icon = layout.type === 'barbell' ? '🏋️' : '💪';
    
    switch(layout.type) {
        case 'barbell':
            return createBarbellVisualization(layout);
            
        case 'dumbbells_fixed':
            const fixedMatch = layout.layout[0].match(/(\d+(?:\.\d+)?)kg × 2/);
            const perDumbbell = fixedMatch ? fixedMatch[1] : '?';
            return `
                <div class="helper-content">
                    <div class="helper-header">${icon} ${layout.weight}kg total</div>
                    <div class="helper-visual">
                        <div class="dumbbell-fixed">${perDumbbell}kg</div>
                    </div>
                    <div class="helper-detail">2 haltères fixes de ${perDumbbell}kg</div>
                </div>
            `;
            
        case 'dumbbells_adjustable':
            return createDumbbellVisualization(layout);
            
        default:
            return `<div class="helper-error">⚠️ ${layout.reason || 'Configuration non reconnue'}</div>`;
    }
}

function createDumbbellVisualization(layout) {
    const totalWeight = layout.weight;
    const weightPerDumbbell = totalWeight / 2;
    const barWeight = layout.bar_weight || 2.5;
    
    // Parser les disques depuis le layout
    let plates = [];
    if (layout.layout && layout.layout.length > 1) {
        for (let i = 1; i < layout.layout.length; i++) {
            const match = layout.layout[i].match(/(\d+(?:\.\d+)?)kg/);
            if (match) {
                plates.push(parseFloat(match[1]));
            }
        }
    }
    
    // Si pas de disques parsés, calculer depuis le poids
    if (plates.length === 0) {
        const platesWeight = weightPerDumbbell - barWeight;
        if (platesWeight > 0) {
            // Calculer les combinaisons possibles
            // TODO: Améliorer cette logique avec les vraies combinaisons du backend
            if (Math.abs(platesWeight - 17.5) < 0.1) {
                plates = [15, 2.5];
            } else if (Math.abs(platesWeight - 2.5) < 0.1) {
                plates = [1.25, 1.25];
            } else if (Math.abs(platesWeight - 7.5) < 0.1) {
                plates = [5, 2.5];
            }
        }
    }
    
    // Visualisation épurée
    return `
        <div class="helper-content-minimal">
            <div class="weight-per-dumbbell">${weightPerDumbbell}kg par haltère</div>
            
            <div class="bar-visualization">
                ${plates.map(weight => 
                    `<div class="plate-visual plate-${weight.toString().replace('.', '-')}" title="${weight}kg">
                        <span>${weight}</span>
                    </div>`
                ).join('')}
                <div class="bar-visual" title="Barre ${barWeight}kg">
                    <span>${barWeight}kg</span>
                </div>
                ${plates.slice().reverse().map(weight => 
                    `<div class="plate-visual plate-${weight.toString().replace('.', '-')}" title="${weight}kg">
                        <span>${weight}</span>
                    </div>`
                ).join('')}
            </div>
        </div>
    `;
}

function createBarbellVisualization(layout) {
    const plates = [];
    layout.layout.forEach(item => {
        const match = item.match(/(\d+(?:\.\d+)?)kg/);
        if (match) {
            plates.push(parseFloat(match[1]));
        }
    });
    
    return `
        <div class="helper-content">
            <div class="helper-header">🏋️ ${layout.weight}kg total</div>
            
            <div class="barbell-visual">
                <div class="visual-label">Par côté :</div>
                <div class="bar-assembly">
                    ${plates.map(weight => 
                        `<div class="plate-visual plate-${weight.toString().replace('.', '-')}" title="${weight}kg">
                            <span>${weight}</span>
                        </div>`
                    ).join('')}
                    <div class="bar-visual barbell" title="Barre">
                        <span>BARRE</span>
                    </div>
                    ${plates.slice().reverse().map(weight => 
                        `<div class="plate-visual plate-${weight.toString().replace('.', '-')}" title="${weight}kg">
                            <span>${weight}</span>
                        </div>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;
}

function hidePlateHelper() {
    const container = document.getElementById('plateHelper');
    if (container) {
        container.innerHTML = '';
    }
}

// ===== TIMER DE REPOS =====
function startRestPeriod(customTime = null, isMLRecommendation = false) {
    // Arrêter le timer de série avant de commencer le repos
    if (setTimer) {
        clearInterval(setTimer);
        setTimer = null;
    }
    
    // Le repos s'affiche maintenant DANS le feedback
    document.getElementById('setFeedback').style.display = 'block';
    document.getElementById('restPeriod').style.display = 'flex';
    
    // AJOUTER : Cacher spécifiquement les sections de feedback pendant le repos
    document.querySelectorAll('.feedback-section-modern').forEach(section => {
        section.style.display = 'none';
    });
    
    // Cacher les inputs pendant le repos
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        inputSection.style.display = 'none';
    }
    
    // Reset des sélections fatigue/effort
    document.querySelectorAll('.emoji-btn-modern.selected').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.getElementById('fatigueProgress')?.classList.remove('completed');
    document.getElementById('effortProgress')?.classList.remove('completed');
    currentWorkoutSession.currentSetFatigue = null;
    currentWorkoutSession.currentSetEffort = null;
    
    // Forcer la transition vers RESTING
    transitionTo(WorkoutStates.RESTING);
    
    // === MODULE 2: AFFICHAGE BADGE ML (CONSERVÉ) ===
    // Vérifier si on a des données ML du Module 1 pour l'affichage
    if (currentWorkoutSession.mlRestData?.seconds) {
        const mlSeconds = currentWorkoutSession.mlRestData.seconds;
        const mlReason = currentWorkoutSession.mlRestData.reason || '';
        const mlRange = currentWorkoutSession.mlRestData.range;
        
        console.log(`🧠 Données ML détectées: ${mlSeconds}s (raison: ${mlReason})`);
        
        // Remplacer complètement le HTML statique pour afficher le badge ML
        document.getElementById('restPeriod').innerHTML = `
            <div class="rest-content">
                <h3>🧘 Temps de repos <span class="ai-badge">🤖 IA</span></h3>
                <div class="ml-rest-suggestion">
                    ✨ IA suggère : ${mlSeconds}s ${mlReason ? `(${mlReason})` : ''}
                    ${mlRange ? `<div class="ml-range">Plage optimale: ${mlRange.min}-${mlRange.max}s</div>` : ''}
                </div>
                <div class="rest-timer" id="restTimer">01:30</div>
                <div class="rest-actions">
                    <button class="btn btn-secondary btn-sm" onclick="adjustRestTime(-30)">-30s</button>
                    <button class="btn btn-secondary btn-sm" onclick="adjustRestTime(30)">+30s</button>
                    <button class="btn btn-primary btn-sm" onclick="endRest()">Passer</button>
                </div>
            </div>
        `;
    }

    // === MODULE 3: TIMER ADAPTATIF ML AUTOMATIQUE ===
    // Feature flag pour désactiver rapidement en cas de problème
    const ML_REST_ENABLED = localStorage.getItem('mlRestFeatureFlag') !== 'false';
    
    // Calcul du temps avec priorité directe aux données ML
    let timeLeft = (ML_REST_ENABLED && currentWorkoutSession.mlRestData?.seconds) || 
                   customTime || 
                   currentExercise.base_rest_time_seconds || 
                   60;

    // Garde-fou de sécurité sur les valeurs
    timeLeft = Math.max(15, Math.min(300, timeLeft));
    
    const initialTime = timeLeft;
    
    // Logging pour traçabilité et debug
    const source = (ML_REST_ENABLED && currentWorkoutSession.mlRestData?.seconds) ? 
                   `ML(${currentWorkoutSession.mlRestData.seconds}s)` :
                   customTime ? `Personnalisé(${customTime}s)` : 
                   `Défaut(${currentExercise.base_rest_time_seconds || 60}s)`;
    
    console.log(`⏱️ MODULE 3 - Source timer: ${source} - Flag ML: ${ML_REST_ENABLED} - Final: ${timeLeft}s`);
    
    // Enregistrer le début du repos
    workoutState.restStartTime = Date.now();
    workoutState.plannedRestDuration = timeLeft;
    updateRestTimer(timeLeft);
    
    // Vibration si supportée
    if (navigator.vibrate) {
        navigator.vibrate(200);
    }
    
    // Notifications sonores programmées
    if (window.workoutAudio) {
        window.workoutAudio.scheduleRestNotifications(timeLeft);
    }
    
    // Programmer la notification
    if ('Notification' in window && Notification.permission === 'granted') {
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
        }
        
        notificationTimeout = setTimeout(() => {
            new Notification('Temps de repos terminé !', {
                body: 'Prêt pour la série suivante ?',
                icon: '/icon-192x192.png',
                vibrate: [200, 100, 200]
            });
        }, timeLeft * 1000);
    }
    
    // Timer principal
    restTimer = setInterval(() => {
        timeLeft--;
        updateRestTimer(timeLeft);
        
        if (timeLeft <= 0) {
            clearInterval(restTimer);
            restTimer = null;
            
            // Annuler la notification si elle n'a pas encore été déclenchée
            if (notificationTimeout) {
                clearTimeout(notificationTimeout);
                notificationTimeout = null;
            }
            
            // Calculer et enregistrer le temps de repos réel
            const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
            currentWorkoutSession.totalRestTime += actualRestTime;
            console.log(`⏱️ MODULE 3 - Repos terminé: ${actualRestTime}s réels vs ${initialTime}s planifiés`);
            
            // Auto-transition vers la série suivante si configuré
            if (currentWorkoutSession.autoAdvance) {
                setTimeout(() => {
                    if (currentWorkoutSession.state === WorkoutStates.RESTING) {
                        endRest();
                    }
                }, 1000);
            }
        }
    }, 1000);
}

// ===== DEMANDE DE PERMISSIONS =====
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            showToast('Notifications activées', 'success');
        }
    }
}

// ===== FONCTIONS MANQUANTES POUR L'INTERFACE DÉTAILLÉE =====
function setSessionFatigue(level) {
    currentWorkoutSession.sessionFatigue = level;
    
    // Masquer le panneau de fatigue après sélection
    const fatigueTracker = document.getElementById('fatigueTracker');
    if (fatigueTracker) {
        fatigueTracker.style.display = 'none';
    }
    
    // Retirer la classe active de tous les boutons
    document.querySelectorAll('.fatigue-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Ajouter la classe active au bouton sélectionné
    const selectedBtn = document.querySelector(`.fatigue-btn[data-level="${level}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
    
    showToast(`Fatigue initiale: ${level}/5`, 'info');
}

function adjustWeight(direction, availableWeights, exercise) {
    const currentWeight = parseFloat(document.getElementById('setWeight').textContent);
    
    // Filtrer les poids selon le type d'équipement
    let validWeights = availableWeights;
    if (exercise?.equipment_required?.includes('dumbbells')) {
        validWeights = availableWeights.filter(w => w % 2 === 0);
    }
    
    // Trouver l'index actuel
    const currentIndex = validWeights.findIndex(w => w === currentWeight);
    
    // Calculer le nouvel index
    const newIndex = currentIndex + direction;
    
    // Vérifier les limites
    if (newIndex >= 0 && newIndex < validWeights.length) {
        const newWeight = validWeights[newIndex];
        document.getElementById('setWeight').textContent = newWeight;
        
        // Mettre à jour l'aide au montage
        if (currentUser?.show_plate_helper) {
            updatePlateHelper(newWeight);
        }
        
        console.log('[AdjustWeight]', direction > 0 ? 'Increased' : 'Decreased', 'to', newWeight);
    } else {
        console.log('[AdjustWeight] Limit reached');
        showToast(direction > 0 ? 'Poids maximum atteint' : 'Poids minimum atteint', 'info');
    }
}

function adjustWeightUp() {
    if (!validateSessionState()) return;
    
    const currentWeight = parseFloat(document.getElementById('setWeight').textContent);
    let weights = JSON.parse(sessionStorage.getItem('availableWeights') || '[]');
    
    if (weights.length === 0) {
        showToast('Poids disponibles non chargés', 'warning');
        return;
    }
    
    // Filtrer pour les dumbbells si nécessaire
    if (currentExercise?.equipment_required?.includes('dumbbells')) {
        weights = weights.filter(w => w % 2 === 0);
        console.log('[AdjustWeight] Filtered to even weights:', weights);
    }
    
    // Trouver le prochain poids supérieur
    let nextIndex = weights.findIndex(w => w > currentWeight);
    
    if (nextIndex !== -1 && nextIndex < weights.length) {
        const newWeight = weights[nextIndex];
        document.getElementById('setWeight').textContent = newWeight;
        
        // Mettre à jour l'aide au montage
        if (currentUser?.show_plate_helper) {
            updatePlateHelper(newWeight);
        }
        
        console.log('[AdjustWeight] Increased to:', newWeight);
    } else {
        showToast('Poids maximum atteint', 'info');
    }
}

function adjustWeightDown() {
    if (!validateSessionState()) return;
    
    const currentWeight = parseFloat(document.getElementById('setWeight').textContent);
    let weights = JSON.parse(sessionStorage.getItem('availableWeights') || '[]');
    
    if (weights.length === 0) {
        showToast('Poids disponibles non chargés', 'warning');
        return;
    }
    
    // Filtrer pour les dumbbells si nécessaire
    if (currentExercise?.equipment_required?.includes('dumbbells')) {
        weights = weights.filter(w => w % 2 === 0);
        console.log('[AdjustWeight] Filtered to even weights:', weights);
    }
    
    // Trouver le poids inférieur le plus proche
    let prevWeight = null;
    for (let i = weights.length - 1; i >= 0; i--) {
        if (weights[i] < currentWeight) {
            prevWeight = weights[i];
            break;
        }
    }
    
    if (prevWeight !== null) {
        document.getElementById('setWeight').textContent = prevWeight;
        
        // Mettre à jour l'aide au montage
        if (currentUser?.show_plate_helper) {
            updatePlateHelper(prevWeight);
        }
        
        console.log('[AdjustWeight] Decreased to:', prevWeight);
    } else {
        showToast('Poids minimum atteint', 'info');
    }
}

function adjustReps(delta) {
    const repsElement = document.getElementById('setReps');
    const current = parseInt(repsElement.textContent);
    
    // Pour les exercices isométriques, ajuster par 5 secondes
    const isIsometric = currentExercise?.exercise_type === 'isometric';
    const increment = isIsometric ? delta * 5 : delta;
    
    repsElement.textContent = Math.max(1, current + increment);
}

function adjustDuration(delta) {
    const durationElement = document.getElementById('setDuration');
    const current = parseInt(durationElement.textContent);
    durationElement.textContent = Math.max(1, current + delta);
}

// ===== EXÉCUTION D'UNE SÉRIE =====
async function executeSet() {
    if (!validateSessionState()) return;
    
    // Calculer la durée réelle avec timestamps précis
    let setTime = 0;
    if (setTimer) {
        // Utiliser le timestamp de début stocké globalement
        const setStartTime = window.currentSetStartTime || Date.now();
        setTime = Math.round((Date.now() - setStartTime) / 1000);
        
        // Durée minimale de 10 secondes pour éviter les clics trop rapides
        setTime = Math.max(setTime, 10);
        
        currentWorkoutSession.totalSetTime += setTime;
        clearInterval(setTimer);
        setTimer = null;
    }
        
    // Sauvegarder les données de la série
    const isIsometric = currentExercise.exercise_type === 'isometric';
    const isBodyweight = currentExercise.weight_type === 'bodyweight';

    if (isIsometric) {
        workoutState.pendingSetData = {
            duration_seconds: parseInt(document.getElementById('setReps').textContent),
            reps: parseInt(document.getElementById('setReps').textContent),
            weight: null
        };
    } else if (isBodyweight) {
        workoutState.pendingSetData = {
            duration_seconds: setTime,  // durée réelle chronométrée
            reps: parseInt(document.getElementById('setReps').textContent),
            weight: null
        };
    } else {
        const weightValue = document.getElementById('setWeight').textContent;
        workoutState.pendingSetData = {
            duration_seconds: setTime,  // durée réelle chronométrée
            reps: parseInt(document.getElementById('setReps').textContent),
            weight: weightValue ? parseFloat(weightValue) : null
        };
    }
        
    // Transition vers FEEDBACK
    transitionTo(WorkoutStates.FEEDBACK);
}

function getSetTimerSeconds() {
    const timerText = document.getElementById('setTimer').textContent;
    const [minutes, seconds] = timerText.split(':').map(Number);
    return minutes * 60 + seconds;
}

function selectFatigue(button, value) {
    // Désélectionner tous les boutons de fatigue
    document.querySelectorAll('[data-fatigue]').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Sélectionner le bouton cliqué
    button.classList.add('selected');
    
    // Stocker la valeur
    currentWorkoutSession.currentSetFatigue = value;
    
    // Mettre à jour l'indicateur de progression SI IL EXISTE
    const progressIndicator = document.getElementById('fatigueProgress');
    if (progressIndicator) {
        progressIndicator.textContent = '✓';
        progressIndicator.classList.add('completed');
    }
    
    // Vérifier si on peut valider automatiquement
    checkAutoValidation();
}

function selectEffort(button, value) {
    // Désélectionner tous les boutons d'effort
    document.querySelectorAll('[data-effort]').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Sélectionner le bouton cliqué
    button.classList.add('selected');
    
    // Stocker la valeur
    currentWorkoutSession.currentSetEffort = value;
    
    // Mettre à jour l'indicateur de progression SI IL EXISTE
    const progressIndicator = document.getElementById('effortProgress');
    if (progressIndicator) {
        progressIndicator.textContent = '✓';
        progressIndicator.classList.add('completed');
    }
    
    // Vérifier si on peut valider automatiquement
    checkAutoValidation();
}

// Fonction pour la validation automatique
function checkAutoValidation() {
    if (currentWorkoutSession.currentSetFatigue && currentWorkoutSession.currentSetEffort) {
        setTimeout(() => {
            saveFeedbackAndRest();
        }, 300);
    }
}

async function saveFeedbackAndRest() {
    if (!workoutState.pendingSetData) {
        console.error('Pas de données de série en attente');
        return;
    }
    
    try {
        // Ajouter le feedback aux données
        const setData = {
            ...workoutState.pendingSetData,
            exercise_id: currentExercise.id,
            set_number: currentSet,
            fatigue_level: currentWorkoutSession.currentSetFatigue,
            effort_level: currentWorkoutSession.currentSetEffort,
            exercise_order_in_session: currentWorkoutSession.exerciseOrder,
            set_order_in_session: currentWorkoutSession.globalSetCount + 1,
            base_rest_time_seconds: currentExercise.base_rest_time_seconds || 90,
            // Ajouter les propriétés ML si elles existent
            ml_weight_suggestion: workoutState.currentRecommendation?.weight_recommendation,
            ml_reps_suggestion: workoutState.currentRecommendation?.reps_recommendation,
            ml_confidence: workoutState.currentRecommendation?.confidence,
            ml_adjustment_enabled: currentWorkoutSession.mlSettings?.[currentExercise.id]?.autoAdjust,
            suggested_rest_seconds: workoutState.currentRecommendation?.rest_seconds_recommendation
        };
                
        // Validation des données avant envoi
        if (!setData.exercise_id || !setData.set_number || !setData.fatigue_level || !setData.effort_level) {
            console.error('❌ Données de série incomplètes:', setData);
            showToast('Données incomplètes, impossible d\'enregistrer', 'error');
            return;
        }
        // Log pour debug
        console.log('📤 Envoi série:', setData);

        // Enregistrer la série
        const savedSet = await apiPost(`/api/workouts/${currentWorkout.id}/sets`, setData);
        
        // Ajouter aux séries complétées
        const setWithId = { ...setData, id: savedSet.id };
        currentWorkoutSession.completedSets.push(setWithId);
        currentWorkoutSession.globalSetCount++;
        
        // Mettre à jour le programme si c'est une séance programme
        if (currentWorkoutSession.type === 'program' && currentExercise) {
            const programExercise = currentWorkoutSession.programExercises[currentExercise.id];
            if (programExercise) {
                programExercise.completedSets++;
                if (programExercise.completedSets >= programExercise.totalSets) {
                    programExercise.isCompleted = true;
                    programExercise.endTime = new Date();
                    currentWorkoutSession.completedExercisesCount++;
                }
            }
        }
        
        // Mettre à jour l'historique visuel
        updateSetsHistory();
        
        // Enregistrer la décision ML
        if (workoutState.currentRecommendation && currentWorkoutSession.mlHistory?.[currentExercise.id]) {
            const weightFollowed = Math.abs(setData.weight - workoutState.currentRecommendation.weight_recommendation) < 0.5;
            const repsFollowed = Math.abs(setData.reps - workoutState.currentRecommendation.reps_recommendation) <= 1;
            const accepted = weightFollowed && repsFollowed;
            
            if (typeof recordMLDecision === 'function') {
                recordMLDecision(currentExercise.id, currentSet, accepted);
            }
        }
        
        // LOGIQUE DE REPOS UNIFIÉE POUR TOUS LES EXERCICES
        
        // Déterminer la durée de repos
        let restDuration = currentExercise.base_rest_time_seconds || 60; // Défaut depuis exercises.json
        let isMLRest = false;
        
        // Si l'IA est active ET a une recommandation de repos
        if (currentWorkoutSession.mlSettings?.[currentExercise.id]?.autoAdjust && 
            workoutState.currentRecommendation?.rest_seconds_recommendation) {
            restDuration = workoutState.currentRecommendation.rest_seconds_recommendation;
            isMLRest = true;
            console.log(`🤖 Repos IA : ${restDuration}s (base: ${currentExercise.base_rest_time_seconds}s)`);
            
            // === MODULE 1 : STOCKER LES DONNÉES ML POUR LE BADGE ===
            currentWorkoutSession.mlRestData = {
                seconds: workoutState.currentRecommendation.rest_seconds_recommendation,
                reason: workoutState.currentRecommendation.rest_reason || 
                       workoutState.currentRecommendation.reasoning || 
                       "Recommandation IA",
                range: workoutState.currentRecommendation.rest_range || null,
                confidence: workoutState.currentRecommendation.confidence || 0.8
            };
            console.log(`📊 MODULE 1 - Données ML stockées:`, currentWorkoutSession.mlRestData);
        }
        
        // Vérifier si c'est la dernière série
        const isLastSet = currentSet >= currentWorkoutSession.totalSets;
        
        if (isLastSet) {
            // Dernière série : pas de repos, passer à la fin
            transitionTo(WorkoutStates.COMPLETED);
            showSetCompletionOptions();
        } else {
            // Pas la dernière série : gérer le repos
            if (currentExercise.exercise_type === 'isometric') {
                // Pour les isométriques : pas d'écran de repos mais compter le temps
                currentWorkoutSession.totalRestTime += restDuration;
                
                // Afficher un message temporaire avec le temps de repos
                showToast(`⏱️ Repos ${isMLRest ? '🤖' : ''}: ${restDuration}s`, 'info');
                
                // Désactiver temporairement les boutons
                transitionTo(WorkoutStates.TRANSITIONING);
                
                // Timer pour la transition automatique
                setTimeout(() => {
                    currentSet++;
                    currentWorkoutSession.currentSetNumber = currentSet;
                    updateSeriesDots();
                    updateHeaderProgress();
                    
                    if (currentWorkoutSession.type === 'program') {
                        updateProgramExerciseProgress();
                        loadProgramExercisesList();
                    }
                    
                    updateSetRecommendations();
                    startSetTimer();
                    transitionTo(WorkoutStates.READY);
                }, restDuration * 1000);
                
            } else {
                // Pour les autres exercices : écran de repos classique
                transitionTo(WorkoutStates.RESTING);
                startRestPeriod(restDuration, isMLRest);
            }
        }
        
        // Réinitialiser les sélections
        resetFeedbackSelection();
        
    } catch (error) {
        console.error('Erreur enregistrement série:', error);
        showToast('Erreur lors de l\'enregistrement', 'error');
    }
}

// Fonction de réinitialisation des sélections
function resetFeedbackSelection() {
    // Supprimer toutes les sélections
    document.querySelectorAll('.emoji-btn-modern.selected').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Réinitialiser les indicateurs de progression
    document.getElementById('fatigueProgress')?.classList.remove('completed');
    document.getElementById('effortProgress')?.classList.remove('completed');
    
    // Réinitialiser les valeurs
    currentWorkoutSession.currentSetFatigue = null;
    currentWorkoutSession.currentSetEffort = null;
}

function showAutoValidation() {
    const indicator = document.createElement('div');
    indicator.className = 'auto-validation';
    indicator.textContent = 'Validation automatique...';
    document.querySelector('.set-feedback-modern').style.position = 'relative';
    document.querySelector('.set-feedback-modern').appendChild(indicator);
    
    setTimeout(() => {
        if (indicator.parentNode) {
            indicator.remove();
        }
    }, 1000);
}

// ===== VALIDATION DU FEEDBACK =====
function setFatigue(exerciseId, value) {
    // Stocker la fatigue pour cet exercice
    console.log(`Fatigue set to ${value} for exercise ${exerciseId}`);
}

function setEffort(setId, value) {
    // Stocker l'effort pour cette série
    console.log(`Effort set to ${value} for set ${setId}`);
}

function validateSessionState(skipExerciseCheck = false) {
    if (!currentWorkout) {
        showToast('Aucune séance active', 'error');
        return false;
    }
    // Pour certains flows (comme setupProgramWorkout), on n'a pas encore d'exercice
    if (!skipExerciseCheck && !currentExercise) {
        showToast('Pas d\'exercice sélectionné', 'error');
        return false;
    }
    return true;
}

// ===== FIN DE SÉRIE =====
function completeRest() {
    // Rétablir les sections de feedback pour la série suivante
    document.querySelectorAll('.feedback-section-modern').forEach(section => {
        section.style.display = 'block';
    });
    
    // Déclarer actualRestTime au début pour qu'elle soit accessible partout
    let actualRestTime = 0;
    
    // Calculer et accumuler le temps de repos réel
    if (workoutState.restStartTime) {
        actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
        currentWorkoutSession.totalRestTime += actualRestTime;
        
        // Enregistrer le temps de repos réel pour les futures recommandations ML
        currentWorkoutSession.lastActualRestDuration = actualRestTime;
        console.log(`Repos réel enregistré : ${actualRestTime}s`);
        
        // Mettre à jour la dernière série sauvegardée avec la durée réelle
        if (currentWorkoutSession.completedSets.length > 0) {
            const lastSetId = currentWorkoutSession.completedSets[currentWorkoutSession.completedSets.length - 1].id;
            if (lastSetId) {
                apiPut(`/api/sets/${lastSetId}/rest-duration`, {
                    actual_rest_duration_seconds: actualRestTime
                }).catch(error => console.error('Erreur mise à jour repos:', error));
            }
        }
        
        workoutState.restStartTime = null;
    }
    
    // === MODULE 4 : TRACKING ACCEPTATION ML ===
    if (currentWorkoutSession.mlRestData?.seconds && actualRestTime > 0) {
        const suggestedTime = currentWorkoutSession.mlRestData.seconds;
        const tolerance = 10; // 10 secondes de tolérance
        
        const wasAccepted = Math.abs(actualRestTime - suggestedTime) <= tolerance;
        const wasAdjusted = currentWorkoutSession.restAdjustments?.length > 0;
        
        // Stocker les stats ML
        if (!currentWorkoutSession.mlRestStats) {
            currentWorkoutSession.mlRestStats = [];
        }
        
        currentWorkoutSession.mlRestStats.push({
            suggested: suggestedTime,
            actual: actualRestTime,
            accepted: wasAccepted,
            adjusted: wasAdjusted,
            adjustments: currentWorkoutSession.restAdjustments || [],
            confidence: currentWorkoutSession.mlRestData.confidence,
            timestamp: Date.now()
        });
        
        console.log(`📊 MODULE 4 - ML Stats: Suggéré ${suggestedTime}s → Réel ${actualRestTime}s (${wasAccepted ? 'Accepté' : 'Modifié'})`);
        
        // Reset des ajustements pour le prochain repos
        currentWorkoutSession.restAdjustments = [];
    }
    
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
    
    // Masquer l'interface de repos
    document.getElementById('restPeriod').style.display = 'none';
    document.getElementById('setFeedback').style.display = 'none';
    
    // Transition vers COMPLETED après la dernière série
    // Gestion spéciale pour les séries supplémentaires
    if (currentWorkoutSession.isStartingExtraSet) {
        // Flag détecté : on démarre une série supplémentaire, pas d'incrémentation
        currentWorkoutSession.isStartingExtraSet = false; // Reset du flag
        console.log(`🔄 Préparation série supplémentaire ${currentSet}/${currentWorkoutSession.totalSets}`);
        
        // Préparer l'interface pour la série supplémentaire (sans currentSet++)
        updateSeriesDots();
        updateHeaderProgress();
        
        if (currentWorkoutSession.type === 'program') {
            updateProgramExerciseProgress();
            loadProgramExercisesList();
        }
        
        const inputSection = document.querySelector('.input-section');
        if (inputSection) {
            inputSection.style.display = 'block';
        }
        
        updateSetRecommendations();
        
        const weight = parseFloat(document.getElementById('setWeight')?.textContent) || 0;
        updatePlateHelper(weight);
        
        startSetTimer();
        transitionTo(WorkoutStates.READY);
        
    } else if (currentSet >= currentWorkoutSession.totalSets) {
        // Cas normal : fin d'exercice
        transitionTo(WorkoutStates.COMPLETED);
        showSetCompletionOptions();
    } else {
        // Cas normal : passage à la série suivante
        currentSet++;
        currentWorkoutSession.currentSetNumber = currentSet;
        updateSeriesDots();
        
        // Mettre à jour les compteurs d'en-tête
        updateHeaderProgress();
        
        // Mettre à jour la progression du programme si applicable
        if (currentWorkoutSession.type === 'program') {
            updateProgramExerciseProgress();
            // Forcer la mise à jour visuelle
            loadProgramExercisesList();
        }
        
        // Réafficher les inputs pour la nouvelle série
        const inputSection = document.querySelector('.input-section');
        if (inputSection) {
            inputSection.style.display = 'block';
        }
        
        // Mettre à jour les recommandations pour la nouvelle série
        updateSetRecommendations();
        
        // AJOUT : Mise à jour aide au montage pour la nouvelle série
        const weight = parseFloat(document.getElementById('setWeight')?.textContent) || 0;
        updatePlateHelper(weight);
        
        startSetTimer();
        transitionTo(WorkoutStates.READY);
    }
}

// ===== MISE À JOUR DURÉE DE REPOS =====
async function updateLastSetRestDuration(actualRestTime) {
    try {
        console.log(`Tentative mise à jour repos: ${actualRestTime}s`);
        console.log(`Sets complétés: ${currentWorkoutSession.completedSets.length}`);
        
        if (currentWorkoutSession.completedSets.length > 0) {
            const lastSet = currentWorkoutSession.completedSets[currentWorkoutSession.completedSets.length - 1];
            console.log(`Dernier set:`, lastSet);
            
            if (lastSet.id) {
                await apiPut(`/api/sets/${lastSet.id}/rest-duration`, {
                    actual_rest_duration_seconds: actualRestTime
                });
                
                // Mettre à jour localement aussi
                lastSet.actual_rest_duration_seconds = actualRestTime;
                
                console.log(`✅ Durée de repos mise à jour: ${actualRestTime}s pour la série ${lastSet.id}`);
            } else {
                console.error(`❌ Pas d'ID pour le dernier set:`, lastSet);
            }
        } else {
            console.error(`❌ Aucun set complété pour mise à jour repos`);
        }
    } catch (error) {
        console.error('Erreur mise à jour durée de repos:', error);
    }
}

function showSetCompletionOptions() {
    const modalContent = `
        <div style="text-align: center;">
            <p>${currentSet} séries de ${currentExercise.name} complétées</p>
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

function addExtraSet() {
    if (currentWorkoutSession.totalSets >= currentWorkoutSession.maxSets) {
        showToast('Nombre maximum de séries atteint', 'warning');
        return;
    }
    
    currentWorkoutSession.totalSets++;
    showToast(`Série supplémentaire ajoutée (${currentWorkoutSession.totalSets} au total)`, 'success');
    
    // Mettre à jour l'affichage
    document.getElementById('setProgress').textContent = `Série ${currentSet}/${currentWorkoutSession.totalSets}`;
    updateSetNavigationButtons();
}

// ===== GESTION DES SÉRIES SUPPLEMENTAIRES =====
function handleExtraSet() {
    // 1. Incrémenter le total comme l'ancienne version
    currentWorkoutSession.totalSets++;
    
    // 2. GARDER la logique de l'ancienne version pour currentSet
    currentSet = currentWorkoutSession.totalSets;
    
    // 3. Flag pour indiquer qu'on démarre une série supplémentaire (évite bug endRest)
    currentWorkoutSession.isStartingExtraSet = true;
    
    // 4. Mettre à jour l'interface EXACTEMENT comme l'ancienne version
    updateSeriesDots();
    document.getElementById('setProgress').textContent = `Série ${currentSet}`;
    
    // 5. Réinitialisations d'interface (preservation ancienne version)
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('executeSetBtn').style.display = 'block';
    
    // 6. Reset émojis avec gestion des deux sélecteurs (compatibilité)
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.querySelectorAll('.emoji-btn-modern').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // 7. Reset feedback selections
    resetFeedbackSelection();
    
    // 8. Mettre à jour les recommandations ML
    updateSetRecommendations();
    
    console.log(`🔄 Série supplémentaire ${currentSet}/${currentWorkoutSession.totalSets} - Démarrage repos`);
    
    // 9. === NOUVEAUTÉ : AJOUTER LE REPOS ===
    startRestPeriod();
    
    // Note: completeRest() détectera le flag isStartingExtraSet et ne fera PAS currentSet++
    // Il préparera directement l'interface pour la série supplémentaire
}

function previousSet() {
    if (currentSet <= 1) return;
    
    currentSet--;
    currentWorkoutSession.currentSetNumber = currentSet;
    updateSeriesDots();

    // Mettre à jour l'interface
    const setProgressEl = document.getElementById('setProgress');
    if (setProgressEl) {
        setProgressEl.textContent = `Série ${currentSet}/${currentWorkoutSession.totalSets}`;
    }
    
    // Recharger les données de la série précédente si elle existe
    const previousSetData = currentWorkoutSession.completedSets.find(
        s => s.exercise_id === currentExercise.id && s.set_number === currentSet
    );
    
    if (previousSetData) {
        document.getElementById('setWeight').textContent = previousSetData.weight || '';
        document.getElementById('setReps').textContent = previousSetData.reps || '';
    }
    
    // Masquer le feedback et réafficher le bouton GO
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('executeSetBtn').style.display = 'block';
    // Redémarrer le timer pour cette série
    startSetTimer();
}

function changeExercise() {
    // Ajouter une animation de sortie
    const exerciseCard = document.querySelector('.workout-card');
    if (exerciseCard) {
        exerciseCard.style.animation = 'slideOut 0.3s ease forwards';
    }
    
    // Vérifier l'état actuel
    if (workoutState.current === WorkoutStates.EXECUTING || 
        workoutState.current === WorkoutStates.FEEDBACK) {
        if (!confirm('Une série est en cours. Voulez-vous vraiment changer d\'exercice ?')) {
            if (exerciseCard) {
                exerciseCard.style.animation = 'slideIn 0.3s ease forwards';
            }
            return;
        }
    }
    
    // Nettoyer les timers
    if (restTimer) {
        clearInterval(restTimer);
        // Arrêter aussi le timer de série
        if (setTimer) {
            clearInterval(setTimer);
            setTimer = null;
        }
        restTimer = null;
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            notificationTimeout = null;
        }
    }
    
    // Réinitialiser l'état
    workoutState = {
        current: WorkoutStates.IDLE,
        exerciseStartTime: null,
        setStartTime: null,
        restStartTime: null,
        pendingSetData: null
    };
    
    finishExercise();
}

async function initiateSwap(exerciseId) {
    if (!canSwapExercise(exerciseId)) {
        showToast('Impossible de changer cet exercice maintenant', 'warning');
        return;
    }
    
    const swapContext = {
        originalExerciseId: exerciseId,
        originalExerciseState: {...currentWorkoutSession.programExercises[exerciseId]},
        currentSetNumber: currentSet,
        timestamp: new Date()
    };
    
    currentWorkoutSession.pendingSwap = swapContext;
    showSwapReasonModal(exerciseId);
}

async function executeSwapTransition(originalExerciseId, newExerciseId, reason) {
    const swapContext = currentWorkoutSession.pendingSwap;
    if (!swapContext || swapContext.originalExerciseId !== originalExerciseId) {
        showToast('Erreur : contexte de swap invalide', 'error');
        return;
    }
    
    try {
        // 1. Validation backend
        const canSwap = await apiGet(
            `/api/workouts/${currentWorkout.id}/exercises/${originalExerciseId}/can-swap?user_id=${currentUser.id}`
        );
        
        if (!canSwap.allowed) {
            showToast(`Swap refusé : ${canSwap.reason}`, 'error');
            return;
        }
        
        // 2. Tracking backend
        await apiPost(`/api/workouts/${currentWorkout.id}/track-swap`, {
            original_exercise_id: originalExerciseId,
            new_exercise_id: newExerciseId,
            reason: reason,
            sets_completed_before: swapContext.originalExerciseState.completedSets
        });
        
        // 3. Mise à jour état local SANS modifier changeExercise()
        updateLocalStateAfterSwap(originalExerciseId, newExerciseId, reason, swapContext);
        
        // 4. Si c'est l'exercice en cours, utiliser selectProgramExercise() existant
        if (currentExercise && currentExercise.id === originalExerciseId) {
            // Utiliser la fonction existante qui fonctionne déjà
            await selectProgramExercise(newExerciseId);
        }
        
        // 5. Mettre à jour affichage
        showProgramExerciseList();
        
        // 6. Nettoyer le contexte
        currentWorkoutSession.pendingSwap = null;
        
        showToast(`Exercice changé avec succès`, 'success');
        
    } catch (error) {
        console.error('Erreur executeSwapTransition:', error);
        showToast('Impossible de changer l\'exercice', 'error');
        currentWorkoutSession.pendingSwap = null;
    }
}

function updateLocalStateAfterSwap(originalExerciseId, newExerciseId, reason, swapContext) {
    // 1. Marquer l'original comme swappé
    currentWorkoutSession.programExercises[originalExerciseId].swapped = true;
    currentWorkoutSession.programExercises[originalExerciseId].swappedTo = newExerciseId;
    currentWorkoutSession.programExercises[originalExerciseId].swapReason = reason;
    
    // 2. Créer ou mettre à jour l'état pour le nouvel exercice
    currentWorkoutSession.programExercises[newExerciseId] = {
        ...swapContext.originalExerciseState,
        swapped: false,
        swappedFrom: originalExerciseId,
        swapReason: reason
    };
    
    // 3. Mettre à jour l'exercice dans le programme
    const exerciseIndex = currentWorkoutSession.program.exercises.findIndex(
        ex => ex.exercise_id === originalExerciseId
    );
    if (exerciseIndex !== -1) {
        currentWorkoutSession.program.exercises[exerciseIndex].exercise_id = newExerciseId;
        // Préserver les autres propriétés de l'exercice
    }
    
    // 4. Ajouter au tracking des swaps
    currentWorkoutSession.swaps.push({
        original_id: originalExerciseId,
        new_id: newExerciseId,
        reason: reason,
        timestamp: swapContext.timestamp,
        sets_before: swapContext.originalExerciseState.completedSets
    });
    
    // 5. Tracking modification globale
    currentWorkoutSession.modifications.push({
        type: 'swap',
        timestamp: swapContext.timestamp,
        original: originalExerciseId,
        replacement: newExerciseId,
        reason: reason,
        sets_completed_before: swapContext.originalExerciseState.completedSets
    });
}

// ===== MODULE 2 : FONCTIONS MODAL SWAP MANQUANTES =====

function showSwapReasonModal(exerciseId) {
    const exercise = getCurrentExerciseData(exerciseId);
    
    const modalContent = `
        <div class="swap-reason-container">
            <div class="exercise-context">
                <h4>Changer "${exercise.name}"</h4>
                <p>Pourquoi souhaitez-vous changer cet exercice ?</p>
            </div>
            
            <div class="reason-options">
                <button class="reason-btn pain" onclick="proceedToAlternatives(${exerciseId}, 'pain')">
                    <div class="reason-icon">🩹</div>
                    <div class="reason-content">
                        <span class="reason-title">Douleur/Inconfort</span>
                        <span class="reason-desc">Alternatives moins stressantes</span>
                    </div>
                </button>
                
                <button class="reason-btn equipment" onclick="proceedToAlternatives(${exerciseId}, 'equipment')">
                    <div class="reason-icon">🔧</div>
                    <div class="reason-content">
                        <span class="reason-title">Équipement pris</span>
                        <span class="reason-desc">Alternatives avec autre matériel</span>
                    </div>
                </button>
                
                <button class="reason-btn preference" onclick="proceedToAlternatives(${exerciseId}, 'preference')">
                    <div class="reason-icon">❤️</div>
                    <div class="reason-content">
                        <span class="reason-title">Préférence personnelle</span>
                        <span class="reason-desc">Autres exercices similaires</span>
                    </div>
                </button>
                
                <button class="reason-btn too_hard" onclick="proceedToAlternatives(${exerciseId}, 'too_hard')">
                    <div class="reason-icon">⬇️</div>
                    <div class="reason-content">
                        <span class="reason-title">Trop difficile</span>
                        <span class="reason-desc">Versions plus accessibles</span>
                    </div>
                </button>
            </div>
            
            <div class="modal-actions">
                <button class="btn-secondary" onclick="closeModal()">Annuler</button>
            </div>
        </div>
    `;
    
    showModal('Changer d\'exercice', modalContent);
}

async function proceedToAlternatives(exerciseId, reason) {
    closeModal();
    
    // ===== MAPPING RAISONS FRONTEND → API =====
    const reasonMap = {
        'pain': 'pain',
        'equipment': 'equipment',  
        'preference': 'preference',
        'too_hard': 'pain',         // Mapper vers pain
        'too_easy': 'preference',   // Mapper vers preference  
        'fatigue': 'pain'           // Mapper vers pain
    };
    
    const apiReason = reasonMap[reason] || 'preference';
    
    showModal('Recherche d\'alternatives', `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <p>Recherche des meilleures alternatives...</p>
        </div>
    `);
    
    try {
        const alternatives = await apiGet(
            `/api/exercises/${exerciseId}/alternatives?user_id=${currentUser.id}&reason=${apiReason}&workout_id=${currentWorkout.id}`
        );
        
        closeModal();
        showAlternativesModal(exerciseId, reason, alternatives);
        
    } catch (error) {
        closeModal();
        console.error('Erreur récupération alternatives:', error);
        showToast('Impossible de récupérer les alternatives', 'error');
    }
}

function showAlternativesModal(originalExerciseId, reason, alternatives) {
    const originalExercise = getCurrentExerciseData(originalExerciseId);
    
    const modalContent = `
        <div class="alternatives-container">
            <div class="alternatives-header">
                <h4>Alternatives à "${originalExercise.name}"</h4>
                <span class="reason-badge reason-${reason}">${getReasonLabel(reason)}</span>
            </div>
            
            ${alternatives.alternatives && alternatives.alternatives.length > 0 ? `
                <div class="alternatives-list">
                    ${alternatives.alternatives.map(alt => `
                        <div class="alternative-card" onclick="selectAlternative(${originalExerciseId}, ${alt.exercise_id}, '${reason}')">
                            <div class="alt-header">
                                <h5>${alt.name}</h5>
                                <div class="match-score">${Math.round((alt.score || 0) * 100)}%</div>
                            </div>
                            <div class="alt-details">
                                <p class="reason-match">${alt.reason_match || 'Exercice similaire'}</p>
                                <div class="alt-meta">
                                    <span class="muscle-groups">${(alt.muscle_groups || []).join(' • ')}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <div class="no-alternatives">
                    <p>Aucune alternative trouvée. Gardez l'exercice actuel.</p>
                </div>
            `}
            
            <div class="modal-actions">
                <button class="btn-secondary" onclick="closeModal()">Annuler</button>
            </div>
        </div>
    `;
    
    showModal('Choisir une alternative', modalContent);
}

async function selectAlternative(originalExerciseId, newExerciseId, reason) {
    closeModal();
    
    try {
        await executeSwapTransition(originalExerciseId, newExerciseId, reason);
    } catch (error) {
        console.error('Erreur lors du swap:', error);
        showToast('Impossible de changer l\'exercice', 'error');
    }
}

async function keepCurrentWithAdaptation(exerciseId, reason) {
    closeModal();
    
    // Appliquer une adaptation selon la raison
    if (reason === 'too_hard') {
        showToast('💡 Conseil : Réduisez le poids de 20% pour cet exercice', 'info');
    } else if (reason === 'pain') {
        showToast('💡 Conseil : Réduisez l\'amplitude ou le poids si nécessaire', 'warning');
    }
    
    // Tracker la décision de garder
    currentWorkoutSession.modifications.push({
        type: 'keep_with_adaptation',
        timestamp: new Date(),
        exercise_id: exerciseId,
        reason: reason,
        adaptation_applied: true
    });
}

function getReasonLabel(reason) {
    const labels = {
        'pain': 'Douleur',
        'equipment': 'Équipement',
        'preference': 'Préférence',
        'too_hard': 'Trop difficile'
    };
    return labels[reason] || reason;
}

async function executeSwap(originalExerciseId, newExerciseId, reason) {
    const originalState = currentWorkoutSession.programExercises[originalExerciseId];
    const setsCompleted = originalState.completedSets;
    
    try {
        // 1. Validation côté serveur
        const canSwap = await apiGet(
            `/api/workouts/${currentWorkout.id}/exercises/${originalExerciseId}/can-swap?user_id=${currentUser.id}`
        );
        
        if (!canSwap.allowed) {
            showToast(`Swap refusé : ${canSwap.reason}`, 'error');
            return;
        }
        
        // 2. Tracking backend
        await apiPost(`/api/workouts/${currentWorkout.id}/track-swap`, {
            original_exercise_id: originalExerciseId,
            new_exercise_id: newExerciseId,
            reason: reason,
            sets_completed_before: setsCompleted
        });
        
        // 3. Mettre à jour l'état local
        updateLocalStateAfterSwap(originalExerciseId, newExerciseId, reason, setsCompleted);
        
        // 4. Si c'est l'exercice en cours, le recharger
        if (currentExercise && currentExercise.id === originalExerciseId) {
            await changeExercise(newExerciseId, false, true); // isSwap = true
        }
        
        // 5. Rafraîchir la liste des exercices
        showProgramExerciseList();
        
        showToast(`Exercice changé avec succès`, 'success');
        
    } catch (error) {
        console.error('Erreur executeSwap:', error);
        showToast('Impossible de changer l\'exercice', 'error');
        throw error;
    }
}

function updateLocalStateAfterSwap(originalExerciseId, newExerciseId, reason, setsCompleted) {
    // 1. Marquer l'original comme swappé
    currentWorkoutSession.programExercises[originalExerciseId].swapped = true;
    currentWorkoutSession.programExercises[originalExerciseId].swappedTo = newExerciseId;
    currentWorkoutSession.programExercises[originalExerciseId].swapReason = reason;
    
    // 2. Créer l'état pour le nouvel exercice
    const originalState = currentWorkoutSession.programExercises[originalExerciseId];
    currentWorkoutSession.programExercises[newExerciseId] = {
        ...originalState,
        completedSets: setsCompleted, // Conserver les séries déjà faites
        swapped: false,
        swappedFrom: originalExerciseId,
        swapReason: reason
    };
    
    // 3. Mettre à jour l'exercice dans le programme
    const exerciseIndex = currentWorkoutSession.program.exercises.findIndex(
        ex => ex.exercise_id === originalExerciseId
    );
    if (exerciseIndex !== -1) {
        currentWorkoutSession.program.exercises[exerciseIndex].exercise_id = newExerciseId;
    }
    
    // 4. Ajouter au tracking des swaps
    currentWorkoutSession.swaps.push({
        original_id: originalExerciseId,
        new_id: newExerciseId,
        reason: reason,
        timestamp: new Date(),
        sets_before: setsCompleted
    });
    
    // 5. Tracking modification globale
    currentWorkoutSession.modifications.push({
        type: 'swap',
        timestamp: new Date(),
        original: originalExerciseId,
        replacement: newExerciseId,
        reason: reason,
        sets_completed_before: setsCompleted
    });
}

function adjustRestTime(deltaSeconds) {
    if (!restTimer) return; // Pas de repos en cours
    
    // Récupérer le temps actuel affiché
    const timerEl = document.getElementById('restTimer');
    const [mins, secs] = timerEl.textContent.replace('-', '').split(':').map(Number);
    let currentSeconds = mins * 60 + secs;
    
    // Ajuster le temps
    currentSeconds += deltaSeconds;
    currentSeconds = Math.max(0, Math.min(600, currentSeconds)); // Limites 0-10min
    
    // === MODULE 4 : TRACKING AJUSTEMENTS ===
    if (!currentWorkoutSession.restAdjustments) {
        currentWorkoutSession.restAdjustments = [];
    }
    currentWorkoutSession.restAdjustments.push({
        timestamp: Date.now(),
        delta: deltaSeconds,
        fromML: !!currentWorkoutSession.mlRestData?.seconds,
        originalML: currentWorkoutSession.mlRestData?.seconds,
        finalTime: currentSeconds
    });
    
    // Annuler l'ancienne notification
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    
    // Programmer la nouvelle notification avec le temps ajusté
    if ('Notification' in window && Notification.permission === 'granted') {
        notificationTimeout = setTimeout(() => {
            new Notification('Temps de repos terminé !', {
                body: 'Prêt pour la série suivante ?',
                icon: '/icon-192x192.png',
                vibrate: [200, 100, 200]
            });
        }, currentSeconds * 1000);
    }
    
    // Repartir du nouveau temps (ne PAS appeler startRestPeriod !)
    clearInterval(restTimer);
    
    // Redémarrer le timer avec le temps ajusté
    let timeLeft = currentSeconds;
    updateRestTimer(timeLeft);
    
    restTimer = setInterval(() => {
        timeLeft--;
        updateRestTimer(timeLeft);
        
        if (timeLeft <= 0) {
            clearInterval(restTimer);
            restTimer = null;
            
            if (notificationTimeout) {
                clearTimeout(notificationTimeout);
                notificationTimeout = null;
            }
            
            // Calculer et enregistrer le temps de repos réel
            const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
            currentWorkoutSession.totalRestTime += actualRestTime;
            console.log(`⏱️ Repos terminé après ajustement: ${actualRestTime}s réels`);
            
            if (currentWorkoutSession.autoAdvance) {
                setTimeout(() => {
                    if (currentWorkoutSession.state === WorkoutStates.RESTING) {
                        endRest();
                    }
                }, 1000);
            }
        }
    }, 1000);
    
    const sign = deltaSeconds > 0 ? '+' : '';
    console.log(`⏱️ MODULE 4 - Ajustement: ${sign}${deltaSeconds}s → ${currentSeconds}s total`);
    showToast(`${sign}${deltaSeconds} secondes`, 'info');
}

// Garder l'ancienne fonction pour compatibilité
function addRestTime(seconds) {
    adjustRestTime(seconds);
}


let isPaused = false;
let pausedTime = null;

function pauseWorkout() {
    const pauseBtn = event.target;
    
    if (!isPaused) {
        // Mettre en pause
        if (workoutTimer) {
            clearInterval(workoutTimer);
            workoutTimer = null;
        }
        if (setTimer) {
            clearInterval(setTimer);
            setTimer = null;
        }
        // Annuler les notifications en attente pendant la pause
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            notificationTimeout = null;
        }
        // Sauvegarder les deux temps actuels
        sessionStorage.setItem('pausedWorkoutTime', document.getElementById('workoutTimer').textContent);
        sessionStorage.setItem('pausedSetTime', document.getElementById('setTimer').textContent);
        
        // Changer le bouton
        pauseBtn.textContent = '▶️ Reprendre';
        pauseBtn.classList.remove('btn-warning');
        pauseBtn.classList.add('btn-success');
        
        isPaused = true;
        saveWorkoutState();
        showToast('Séance mise en pause', 'info');
        
    } else {
        // Reprendre
        
        // Reprendre le timer de séance
        const pausedWorkoutTime = sessionStorage.getItem('pausedWorkoutTime');
        if (pausedWorkoutTime) {
            const [minutes, seconds] = pausedWorkoutTime.split(':').map(Number);
            const elapsedSeconds = minutes * 60 + seconds;
            const workoutStartTime = new Date() - (elapsedSeconds * 1000);
            
            workoutTimer = setInterval(() => {
                const elapsed = new Date() - workoutStartTime;
                const mins = Math.floor(elapsed / 60000);
                const secs = Math.floor((elapsed % 60000) / 1000);
                
                document.getElementById('workoutTimer').textContent = 
                    `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }, 1000);
        }
        
        // Reprendre le timer de série SI on est en train de faire une série
        if (workoutState.current === WorkoutStates.READY || 
            workoutState.current === WorkoutStates.EXECUTING) {
            const pausedSetTime = sessionStorage.getItem('pausedSetTime');
            if (pausedSetTime) {
                const [minutes, seconds] = pausedSetTime.split(':').map(Number);
                const elapsedSeconds = minutes * 60 + seconds;
                const setStartTime = new Date() - (elapsedSeconds * 1000);
                
                setTimer = setInterval(() => {
                    const elapsed = new Date() - setStartTime;
                    const mins = Math.floor(elapsed / 60000);
                    const secs = Math.floor((elapsed % 60000) / 1000);
                    
                    document.getElementById('setTimer').textContent = 
                        `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                }, 1000);
            }
        }
        
        // Changer le bouton
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.classList.remove('btn-success');
        pauseBtn.classList.add('btn-warning');
        
        isPaused = false;
        showToast('Séance reprise', 'success');
    }
}

async function abandonWorkout() {
    if (!confirm('Êtes-vous sûr de vouloir abandonner cette séance ?')) return;
    
    // Sauvegarder l'ID avant de nettoyer
    const workoutId = currentWorkout?.id;
    
    // TOUJOURS nettoyer l'état local d'abord
    clearWorkoutState();
    localStorage.removeItem('fitness_workout_state');
    transitionTo(WorkoutStates.IDLE);
    
    // Retirer la bannière immédiatement
    const banner = document.querySelector('.workout-resume-banner');
    if (banner) banner.remove();
    
    // Tenter l'API en arrière-plan sans bloquer
    if (workoutId) {
        apiPut(`/api/workouts/${workoutId}/complete`, {
            total_duration: 0,
            total_rest_time: 0
        }).catch(error => {
            console.warn('API /complete échouée, mais séance nettoyée localement:', error);
        });
    }
    
    showView('dashboard');
    showToast('Séance abandonnée', 'info');
    
    // FORCER le rechargement du dashboard après un court délai
    setTimeout(() => loadDashboard(), 100);
}

function showProgramExerciseList() {
    if (currentWorkoutSession.type === 'program') {
        document.getElementById('currentExercise').style.display = 'none';
        document.getElementById('programExercisesContainer').style.display = 'block';
        loadProgramExercisesList();
        // Support des gestes mobiles
        addSwipeToExerciseCards();
    }
}

// ===== MODULE 2 : SYSTÈME DE SWAP - FONCTIONS UTILITAIRES =====

function canSwapExercise(exerciseId) {
    console.log(`🔍 canSwapExercise(${exerciseId})`);
    
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    if (!exerciseState) {
        console.log(`ERROR: Exercice ${exerciseId} non trouvé`);
        return false;
    }
    
    // Règle 1 : Pas si déjà complété
    if (exerciseState.isCompleted) {
        console.log(`ERROR: Exercice ${exerciseId} déjà complété`);
        return false;
    }
    
    // Règle 2 : Pas si déjà swappé
    if (exerciseState.swapped) {
        console.log(`ERROR: Exercice ${exerciseId} déjà swappé`);
        return false;
    }
    
    // Règle 3 : Pas si > 50% des séries faites
    if (exerciseState.completedSets > exerciseState.totalSets * 0.5) {
        console.log(`ERROR: Exercice ${exerciseId} trop avancé (${exerciseState.completedSets}/${exerciseState.totalSets})`);
        return false;
    }
    
    // Règle 4 : Pas pendant timer actif SEULEMENT pour l'exercice EN COURS
    if ((setTimer || restTimer) && currentExercise && currentExercise.id === exerciseId) {
        console.log(`ERROR: Exercice ${exerciseId} en cours avec timer actif`);
        return false;
    }
    
    // Règle 5 : Pas si exercice en cours et série commencée
    if (currentExercise && currentExercise.id === exerciseId && 
        workoutState.current === 'executing') {
        console.log(`ERROR: Exercice ${exerciseId} en cours d'exécution`);
        return false;
    }
    
    console.log(`✅ Exercice ${exerciseId} peut être swappé`);
    return true;
}


function getCurrentExerciseData(exerciseId) {
    if (!currentWorkoutSession.program || !currentWorkoutSession.program.exercises) {
        return null;
    }
    
    const exerciseData = currentWorkoutSession.program.exercises.find(ex => ex.exercise_id === exerciseId);
    if (!exerciseData) return null;
    
    const exerciseState = currentWorkoutSession.programExercises[exerciseId];
    
    return {
        exercise_id: exerciseId,
        name: exerciseData.name || `Exercice ${exerciseId}`,
        sets: exerciseData.sets || exerciseState?.totalSets || 3,
        state: exerciseState
    };
}

// ===== MODULE 2 : GESTES MOBILES =====

function initSwipeGestures() {
    // Initialiser sur toutes les exercise cards
    document.querySelectorAll('.exercise-card').forEach(card => {
        if (card.dataset.exerciseId) {
            addSwipeSupport(card, parseInt(card.dataset.exerciseId));
        }
    });
}

function addSwipeSupport(element, exerciseId) {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isSwipping = false;
    
    element.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        isSwipping = false;
    }, { passive: true });
    
    element.addEventListener('touchmove', (e) => {
        if (!startX) return;
        
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const diffX = currentX - startX;
        const diffY = currentY - startY;
        
        // Détecter swipe horizontal
        if (Math.abs(diffX) > 30 && Math.abs(diffY) < 50) {
            isSwipping = true;
            e.preventDefault();
            
            // Animation visuelle
            if (diffX > 0) {
                element.style.transform = `translateX(${Math.min(diffX * 0.5, 50)}px)`;
                element.style.borderLeft = '4px solid #10b981';
            } else {
                element.style.transform = `translateX(${Math.max(diffX * 0.5, -50)}px)`;
                element.style.borderRight = '4px solid #667eea';
            }
        }
    }, { passive: false });
    
    element.addEventListener('touchend', (e) => {
        if (!startX || !isSwipping) {
            startX = 0;
            return;
        }
        
        const endX = e.changedTouches[0].clientX;
        const diffX = endX - startX;
        const timeDiff = Date.now() - startTime;
        
        // Reset visual
        element.style.transform = '';
        element.style.borderLeft = '';
        element.style.borderRight = '';
        
        // Action selon direction et vitesse
        if (Math.abs(diffX) > 80 && timeDiff < 300) {
            // Vibration haptique si supportée
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
            
            if (diffX > 0) {
                // Swipe droite → Skip
                if (canSwapExercise(exerciseId)) {
                    showSkipModal(exerciseId);
                }
            } else {
                // Swipe gauche → Swap
                if (canSwapExercise(exerciseId)) {
                    initiateSwap(exerciseId);
                }
            }
        }
        
        startX = 0;
        isSwipping = false;
    }, { passive: true });
}

// Ajouter support swipe après chargement liste
function addSwipeToExerciseCards() {
    setTimeout(() => {
        initSwipeGestures();
    }, 100);
}

// ===== EXPOSITION GLOBALE =====
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

// Nouvelles fonctions pour l'interface de séance détaillée
window.setSessionFatigue = setSessionFatigue;
window.adjustReps = adjustReps;
window.executeSet = executeSet;
window.setFatigue = setFatigue;
window.setEffort = setEffort;
window.previousSet = previousSet;
window.changeExercise = changeExercise;
window.skipRest = skipRest;
window.addRestTime = addRestTime;
window.adjustRestTime = adjustRestTime;
window.endRest = endRest;
window.pauseWorkout = pauseWorkout;
window.abandonWorkout = abandonWorkout;
window.endWorkout = endWorkout;
window.addExtraSet = addExtraSet;
window.updateSetNavigationButtons = updateSetNavigationButtons;
window.selectFatigue = selectFatigue;
window.selectEffort = selectEffort;
window.toggleAIDetails = toggleAIDetails;
window.showAutoValidation = showAutoValidation;
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
window.abandonActiveWorkout = abandonActiveWorkout;
window.finishExercise = finishExercise;
window.updateLastSetRestDuration = updateLastSetRestDuration;

// ===== EXPORT DES FONCTIONS API MANQUANTES =====
window.apiGet = apiGet;
window.apiPost = apiPost;
window.apiPut = apiPut;
window.apiDelete = apiDelete;
window.generateMuscleDistribution = generateMuscleDistribution;
window.loadRecentWorkouts = loadRecentWorkouts;
window.enrichWorkoutsWithExercises = enrichWorkoutsWithExercises;
window.toggleMuscleTooltip = toggleMuscleTooltip;
window.confirmStartProgramWorkout = confirmStartProgramWorkout;

window.selectExerciseFromCard = selectExerciseFromCard;
window.selectExerciseById = selectExerciseById;
window.searchExercises = searchExercises;
window.enableHorizontalScroll = enableHorizontalScroll;
window.filterByMuscleGroup = filterByMuscleGroup;
window.toggleWeightPreference = toggleWeightPreference;
window.toggleSoundNotifications = toggleSoundNotifications;

window.setupProgramWorkoutWithSelection = setupProgramWorkoutWithSelection;
window.showSessionPreview = showSessionPreview;
window.regenerateSession = regenerateSession;
window.renderMLToggle = renderMLToggle;
window.toggleMLAdjustment = toggleMLAdjustment;

window.renderMLExplanation = renderMLExplanation;
window.addToMLHistory = addToMLHistory;
window.renderMLHistory = renderMLHistory;
window.toggleMLHistory = toggleMLHistory;
window.recordMLDecision = recordMLDecision;
window.updateMLHistoryDisplay = updateMLHistoryDisplay;
window.formatTimeAgo = formatTimeAgo;
window.getConfidenceIcon = getConfidenceIcon;

window.resetFeedbackSelection = resetFeedbackSelection;

window.currentWorkout = currentWorkout;
window.currentWorkoutSession = currentWorkoutSession;
window.workoutState = workoutState;
window.currentExercise = currentExercise;

window.updateSetRecommendations = updateSetRecommendations;
window.syncMLToggles = syncMLToggles;

// ===== EXPOSITION GLOBALE TOTALE =====
window.apiGet = apiGet;
window.apiPost = apiPost;  
window.apiPut = apiPut;
window.apiDelete = apiDelete;
window.loadStats = loadStats;
window.loadProfile = loadProfile;
window.currentUser = currentUser;
window.showView = showView;

window.filterExercises = filterExercises;
window.toggleFavorite = toggleFavorite;

window.updatePlateHelper = updatePlateHelper;
window.togglePlateHelper = togglePlateHelper;

window.skipExercise = skipExercise;
window.showSkipModal = showSkipModal;
window.restartSkippedExercise = restartSkippedExercise;
window.getExerciseName = getExerciseName;

// ===== MODULE 2 : EXPORTS SWAP SYSTEM =====
window.canSwapExercise = canSwapExercise;
window.initiateSwap = initiateSwap;
window.executeSwapTransition = executeSwapTransition;
window.getCurrentExerciseData = getCurrentExerciseData;

window.showSwapReasonModal = showSwapReasonModal;
window.proceedToAlternatives = proceedToAlternatives;
window.showAlternativesModal = showAlternativesModal;
window.selectAlternative = selectAlternative;
window.keepCurrentWithAdaptation = keepCurrentWithAdaptation;
window.getReasonLabel = getReasonLabel;

window.initSwipeGestures = initSwipeGestures;
window.addSwipeSupport = addSwipeSupport;
window.addSwipeToExerciseCards = addSwipeToExerciseCards;
