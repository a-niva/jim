// ===== FITNESS COACH - APPLICATION PRINCIPALE =====

// Import du système de couleurs musculaires
import { getMuscleColor, getChartColors, getMuscleClass, applyMuscleStyle } from './muscle-colors.js';

// ===== ÉTAT GLOBAL =====
let setTimer = null; 
let currentUser = null;
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
    totalRestTime: 0,       // Nouveau: temps total de repos
    totalSetTime: 0         // Nouveau: temps total des séries
};

// Référence au système audio global
const workoutAudio = window.workoutAudio;

// ===== MACHINE D'ÉTAT SÉANCE =====
const WorkoutStates = {
    IDLE: 'idle',
    READY: 'ready',          // Prêt pour une série
    EXECUTING: 'executing',   // Série en cours
    FEEDBACK: 'feedback',     // En attente du feedback
    RESTING: 'resting',       // Période de repos
    COMPLETED: 'completed'    // Exercice/séance terminé
};

let workoutState = {
    current: WorkoutStates.IDLE,
    exerciseStartTime: null,
    setStartTime: null,
    restStartTime: null,
    pendingSetData: null
};

function transitionTo(newState) {
    console.log(`Transition: ${workoutState.current} → ${newState}`);
    workoutState.current = newState;
    updateUIForState(newState);
}

function updateUIForState(state) {
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
            // Pour exercices isométriques, ne pas afficher executeSetBtn
            if (currentExercise && currentExercise.exercise_type === 'isometric') {
                document.getElementById('executeSetBtn').style.display = 'none';
            } else {
                document.getElementById('executeSetBtn').style.display = 'block';
            }
            document.getElementById('setFeedback').style.display = 'none';
            document.getElementById('restPeriod').style.display = 'none';
            if (inputSection) inputSection.style.display = 'block';
            break;
            
        case WorkoutStates.EXECUTING:
            document.getElementById('executeSetBtn').style.display = 'block';
            if (inputSection) inputSection.style.display = 'block';
            break;
            
        case WorkoutStates.FEEDBACK:
            document.getElementById('setFeedback').style.display = 'block';
            document.getElementById('executeSetBtn').style.display = 'none';
            if (inputSection) inputSection.style.display = 'block';
            break;
            
        case WorkoutStates.RESTING:
            document.getElementById('restPeriod').style.display = 'flex';
            document.getElementById('setFeedback').style.display = 'none';
            if (inputSection) inputSection.style.display = 'none';
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
    // Vérifier qu'on a un utilisateur pour les vues qui en ont besoin
    if (!currentUser && ['dashboard', 'stats', 'profile'].includes(viewName)) {
        console.error('Pas d\'utilisateur chargé, retour à l\'accueil');
        showHomePage();
        return;
    }
    // Masquer toutes les vues
    document.querySelectorAll('.view, .onboarding').forEach(el => {
        el.classList.remove('active');
    });
    
    // Mettre à jour la navigation
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
    });
    
    // Afficher la vue demandée
    const view = document.getElementById(viewName);
    if (view) {
        view.classList.add('active');
    }
    
    // Marquer l'item de navigation actif
    const navItem = document.querySelector(`[onclick="showView('${viewName}')"]`);
    if (navItem) {
        navItem.classList.add('active');
    }
    
    // Charger le contenu spécifique à la vue
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
    // Masquer tout
    document.getElementById('onboarding').classList.remove('active');
    document.getElementById('progressContainer').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'none';
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
    if (!currentUser) return;
    
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
        document.getElementById('totalVolume').textContent = `${stats.total_volume_kg}kg`;
        document.getElementById('lastWorkout').textContent = 
            stats.last_workout_date ? new Date(stats.last_workout_date).toLocaleDateString() : '-';
        
        // AJOUT MANQUANT 1: Charger l'état musculaire
        await loadMuscleReadiness();
        
        // AJOUT MANQUANT 2: Charger les séances récentes
        if (stats.recent_workouts) {
            loadRecentWorkouts(stats.recent_workouts);
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
    `;
    
    const startedAt = new Date(workout.started_at);
    const elapsed = startedAt && !isNaN(startedAt) ? Math.floor((new Date() - startedAt) / 60000) : 0;
        
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
        currentWorkout = await apiGet(`/api/workouts/${workoutId}`);
        showView('workout');
        
        // Déterminer le type de séance et configurer l'interface
        if (currentWorkout.type === 'free') {
            setupFreeWorkout();
        } else {
            // Pour une séance programme, récupérer le programme
            const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
            setupProgramWorkout(program);
        }
        
        showToast('Séance reprise', 'success');
        
    } catch (error) {
        console.error('Erreur reprise séance:', error);
        showToast('Erreur lors de la reprise de séance', 'error');
    }
}

async function abandonActiveWorkout(workoutId) {
    if (confirm('Êtes-vous sûr de vouloir abandonner cette séance ?')) {
        try {
            // Terminer la séance côté serveur avec la bonne API
            await apiPut(`/api/workouts/${workoutId}/complete`, {
                total_duration: 0,
                total_rest_time: 0
            });
            
            // Nettoyer l'état local
            localStorage.removeItem('fitness_workout_state');
            clearWorkoutState();
            
            // Retirer la bannière
            const banner = document.querySelector('.workout-resume-banner');
            if (banner) banner.remove();
            
            showToast('Séance abandonnée', 'info');
            
        } catch (error) {
            console.error('Erreur abandon séance:', error);
            // En cas d'erreur API, au moins nettoyer localement
            localStorage.removeItem('fitness_workout_state');
            clearWorkoutState();
            const banner = document.querySelector('.workout-resume-banner');
            if (banner) banner.remove();
            showToast('Séance abandonnée (hors ligne)', 'info');
        }
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
    
    if (!workouts || workouts.length === 0) {
        container.innerHTML = `
            <div class="empty-workouts">
                <p>Aucune séance récente</p>
                <small>Commencez votre première séance !</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = workouts.slice(0, 3).map(workout => {
        const date = new Date(workout.started_at || workout.completed_at);
        const duration = workout.total_duration_minutes || 0;
        const restTime = workout.total_rest_time || 0;
        const activeTime = Math.max(0, duration - restTime);
        const restRatio = duration > 0 ? (restTime / duration * 100).toFixed(0) : 0;
        
        // Calculer le temps écoulé en tenant compte du fuseau horaire local
        const now = new Date();
        const workoutDate = new Date(workout.started_at || workout.completed_at);

        // S'assurer que les dates sont comparées dans le même timezone
        const nowLocal = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
        const workoutLocal = new Date(workoutDate.getTime() - (workoutDate.getTimezoneOffset() * 60000));

        const diffMs = nowLocal - workoutLocal;
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
        
        // Récupérer les muscles travaillés depuis les exercices
        const musclesWorked = workout.exercises ? 
            [...new Set(workout.exercises.flatMap(ex => ex.muscle_groups || []))] : [];
        
        // Créer les badges de muscles avec emojis
        const muscleEmojis = {
            'Pectoraux': '🫁',
            'Dos': '🏋🏻‍♂️', 
            'Jambes': '🦵',
            'Épaules': '🤷',
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
        
        return `
            <div class="workout-card ${duration === 0 ? 'incomplete' : ''}">
                <div class="workout-header-row">
                    <div class="workout-title">
                        <strong>${workout.type === 'program' ? '📋 Programme' : '🕊️ Séance libre'}</strong>
                        <span class="time-ago">${timeAgo}</span>
                    </div>
                    ${duration > 0 ? `
                        <div class="workout-duration">
                            <span class="duration-value">${duration}</span>
                            <span class="duration-unit">min</span>
                        </div>
                    ` : `
                        <div class="workout-incomplete">
                            <span class="incomplete-badge">⚠️ Incomplète</span>
                        </div>
                    `}
                    <div class="workout-status-emojis">
                        ${workout.type === 'free' ? '🕊️' : '📋'}
                        ${workout.type === 'program' && isWorkoutComplete(workout) ? '👑' : ''}
                    </div>
                </div>
                
                ${musclesWorked.length > 0 ? `
                    <div class="muscle-badges-row">
                        ${muscleBadges}
                        ${additionalMuscles}
                    </div>
                ` : ''}
                                
                ${duration > 0 ? `
                    <div class="workout-progress-bar">
                        <div class="progress-segment active" style="width: ${100 - restRatio}%"></div>
                        <div class="progress-segment rest" style="width: ${restRatio}%"></div>
                    </div>
                    <div class="progress-legend">
                        <span class="legend-item active">${activeTime}min actif</span>
                        <span class="legend-item rest">${restTime}min repos</span>
                    </div>
                ` : ''}
                
                ${musclesWorked.length > 0 ? `
                    <div class="muscle-distribution">
                        <div class="distribution-label">Répartition musculaire</div>
                        <div class="distribution-bar">
                            ${generateMuscleDistribution(workout)}
                        </div>
                    </div>
                ` : ''}
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
        
        const workoutData = { type: 'free' };
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        
        currentWorkout = response.workout;
        // AJOUT : Initialiser le type de session
        currentWorkoutSession.type = 'free';
        
        showView('workout');
        setupFreeWorkout();
        
    } catch (error) {
        console.error('Erreur démarrage séance libre:', error);
        showToast('Erreur lors du démarrage de la séance', 'error');
    }
}

async function startProgramWorkout() {
    try {
        // Récupérer le programme actif
        const activeProgram = await apiGet(`/api/users/${currentUser.id}/programs/active`);
        
        if (!activeProgram) {
            showToast('Aucun programme actif', 'error');
            return;
        }
        
        // Initialiser la session
        currentWorkoutSession = {
            type: 'program',
            program: activeProgram,
            exerciseOrder: 0,
            globalSetCount: 0,
            completedSets: [],
            sessionFatigue: 3,
            currentSetFatigue: null,
            currentSetEffort: null,
            totalWorkoutTime: 0,
            totalRestTime: 0,
            totalSetTime: 0
        };
        
        // Afficher le modal de confirmation
        showProgramStartModal(activeProgram);
        
    } catch (error) {
        console.error('Erreur chargement programme:', error);
        showToast('Erreur lors du chargement du programme', 'error');
    }
}

function showProgramStartModal(program) {
    if (!program) {
        console.error('Programme invalide pour le modal');
        return;
    }
    
    // Calculer la durée estimée et le nombre d'exercices
    const exerciseCount = program.exercises.length;
    const estimatedDuration = program.session_duration_minutes || 45;
    
    // Créer le contenu du modal
    const modalContent = `
        <div class="program-start-info">
            <h3>${program.name}</h3>
            <div class="program-details">
                <p><strong>Exercices :</strong> ${exerciseCount}</p>
                <p><strong>Durée estimée :</strong> ${estimatedDuration} min</p>
                <p><strong>Focus :</strong> ${program.focus_areas.join(', ')}</p>
            </div>
            <div class="exercise-list" style="margin-top: 1rem; max-height: 200px; overflow-y: auto;">
                <h4>Programme du jour :</h4>
                <ul style="list-style: none; padding: 0;">
                    ${program.exercises.map((ex, index) => `
                        <li style="padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                            ${index + 1}. ${ex.exercise_name} - ${ex.sets || 3} séries
                        </li>
                    `).join('')}
                </ul>
            </div>
            <div style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: center;">
                <button onclick="confirmStartProgramWorkout()" class="btn btn-primary">
                    🚀 Commencer
                </button>
                <button onclick="closeModal()" class="btn btn-secondary">
                    Annuler
                </button>
            </div>
        </div>
    `;
    
    // Utiliser votre système de modal existant
    showModal('Démarrer la séance programme', modalContent);
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
    document.getElementById('workoutTitle').textContent = '🕊️ Séance libre';
    document.getElementById('exerciseSelection').style.display = 'block';
    document.getElementById('currentExercise').style.display = 'none';
    
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
    
    document.getElementById('workoutTitle').textContent = 'Séance programme';
    document.getElementById('exerciseSelection').style.display = 'none';
    
    // Stocker le programme dans la session
    currentWorkoutSession.program = program;
    currentWorkoutSession.programExercises = {};
    currentWorkoutSession.completedExercisesCount = 0;
    currentWorkoutSession.type = 'program'; // Important pour les vérifications
    currentWorkoutSession.exerciseOrder = 0; // Initialisé à 0, sera incrémenté à 1 lors de la sélection
    
    // Initialiser l'état de chaque exercice
    program.exercises.forEach((exerciseData, index) => {
        currentWorkoutSession.programExercises[exerciseData.exercise_id] = {
            ...exerciseData,
            completedSets: 0,
            totalSets: exerciseData.sets || 3,
            isCompleted: false,
            isSkipped: false,
            index: index,
            startTime: null,
            endTime: null
        };
    });
    
    // Afficher la liste des exercices
    document.getElementById('programExercisesContainer').style.display = 'block';
    loadProgramExercisesList();
    
    // Prendre le premier exercice non complété
    const firstExercise = program.exercises[0];
    if (firstExercise) {
        // Attendre que la sélection soit terminée avant de continuer
        await selectProgramExercise(firstExercise.exercise_id, true);
    }
    
    startWorkoutTimer();
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
    document.getElementById('exerciseName').textContent = exercise.name;
    document.getElementById('exerciseInstructions').textContent = exercise.instructions || 'Effectuez cet exercice avec une forme correcte';
    
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

    try {
        // Obtenir les recommandations ML
        const recommendations = await apiPost(`/api/workouts/${currentWorkout.id}/recommendations`, {
            exercise_id: currentExercise.id,
            set_number: currentSet,
            current_fatigue: currentWorkoutSession.sessionFatigue,
            previous_effort: currentSet > 1 ? currentWorkoutSession.currentSetEffort : null,
            exercise_order: currentWorkoutSession.exerciseOrder,
            set_order_global: currentWorkoutSession.globalSetCount + 1
        });

        // Stocker les recommandations pour executeSet
        workoutState.currentRecommendation = recommendations;

        // Déterminer le type d'exercice
        const exerciseType = getExerciseType(currentExercise);
        
        // Appliquer la configuration UI selon le type
        await configureUIForExerciseType(exerciseType, recommendations);

    } catch (error) {
        console.error('Erreur recommandations ML:', error);
        // Valeurs par défaut en cas d'erreur
        applyDefaultValues(currentExercise);
    }
}

// Fonction helper pour déterminer le type d'exercice
function getExerciseType(exercise) {
    if (exercise.exercise_type === 'isometric') return 'isometric';
    if (exercise.weight_type === 'bodyweight') return 'bodyweight';
    return 'weighted';
}

// Configuration de l'UI selon le type d'exercice
async function configureUIForExerciseType(type, recommendations) {
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
            await configureWeighted(elements, recommendations);
            break;
    }

    // Afficher le temps de repos si recommandé (commun à tous les types)
    updateRestRecommendation(recommendations);
    updateConfidence(recommendations);
}

// Configuration pour exercices isométriques
function configureIsometric(elements, recommendations) {
    if (elements.weightRow) elements.weightRow.setAttribute('data-hidden', 'true');
    if (elements.repsRow) elements.repsRow.setAttribute('data-hidden', 'true');
    
    // Masquer le bouton d'exécution classique
    document.getElementById('executeSetBtn').style.display = 'none';
    
    const targetDuration = Math.max(15, recommendations.reps_recommendation || 30);
    const timerHtml = `
        <div class="isometric-timer" id="isometric-timer">
            <svg class="timer-svg" viewBox="0 0 200 200">
                <circle class="timer-track" cx="100" cy="100" r="80"/>
                <circle class="timer-progress target" cx="100" cy="100" r="80" id="progress-target"/>
                <circle class="timer-progress overflow" cx="100" cy="100" r="80" id="progress-overflow"/>
            </svg>
            <div class="timer-center">
                <div id="timer-display">0s</div>
                <div style="font-size:0.8rem;color:var(--text-muted)">Objectif: ${targetDuration}s</div>
            </div>
            <div class="timer-controls">
                <button class="btn btn-success btn-lg" id="start-timer">🚀 Commencer la série</button>
                <button class="btn btn-danger btn-lg" id="stop-timer" style="display:none">✋ Terminer la série</button>
            </div>
        </div>`;
    
    document.querySelector('.input-section').insertAdjacentHTML('beforeend', timerHtml);
    setupIsometricTimer(targetDuration);
}

function setupIsometricTimer(targetDuration) {
    let currentTime = 0, timerInterval = null, targetReached = false;
    const display = document.getElementById('timer-display');
    const progressTarget = document.getElementById('progress-target');
    const progressOverflow = document.getElementById('progress-overflow');
    const startBtn = document.getElementById('start-timer');
    const stopBtn = document.getElementById('stop-timer');
    
    startBtn.onclick = () => {
        timerInterval = setInterval(() => {
            currentTime++;
            display.textContent = `${currentTime}s`;
            
            if (currentTime <= targetDuration) {
                const percent = (currentTime / targetDuration) * 100;
                progressTarget.style.strokeDasharray = `${percent * 5.03} 500`;
                progressOverflow.style.strokeDasharray = '0 500';
            } else {
                progressTarget.style.strokeDasharray = '503 500';
                const overPercent = ((currentTime - targetDuration) / targetDuration) * 100;
                progressOverflow.style.strokeDasharray = `${Math.min(overPercent * 5.03, 503)} 500`;
            }
            
            if (currentTime === targetDuration && !targetReached) {
                targetReached = true;
                showToast(`🎯 Objectif ${targetDuration}s atteint !`, 'success');
                if (window.workoutAudio) window.workoutAudio.playSound('achievement');
            }
        }, 1000);
        
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        transitionTo(WorkoutStates.EXECUTING);
    };
    
    stopBtn.onclick = () => {
        clearInterval(timerInterval);
        
        // Enregistrer directement les données
        workoutState.pendingSetData = {
            duration_seconds: currentTime,
            reps: currentTime,
            weight: null
        };
        
        // Masquer le timer et passer au feedback
        document.getElementById('isometric-timer').style.display = 'none';
        document.getElementById('setFeedback').style.display = 'block';
        transitionTo(WorkoutStates.FEEDBACK);
    };
}

function cleanupIsometricTimer() {
    const timer = document.getElementById('isometric-timer');
    if (timer) timer.remove();
    
    // Reset feedback selection
    resetFeedbackSelection();
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
async function configureWeighted(elements, recommendations) {
    // Afficher la ligne de poids
    if (elements.weightRow) {
        elements.weightRow.removeAttribute('data-hidden');
    }
    
    // S'assurer que l'affichage est normal
    if (elements.repsRow) {
        elements.repsRow.classList.remove('duration-display');
    }
    
    // Icônes et unités normales
    if (elements.repsIcon) elements.repsIcon.textContent = '🔢';
    if (elements.repsUnit) elements.repsUnit.textContent = 'reps';
    
    // Obtenir les poids disponibles
    const weightsData = await apiGet(`/api/users/${currentUser.id}/available-weights`);
    const availableWeights = weightsData.available_weights.sort((a, b) => a - b);
    sessionStorage.setItem('availableWeights', JSON.stringify(availableWeights));
    
    // Gérer les recommandations de poids
    const weightRec = recommendations.weight_recommendation || 20;
    const closestWeight = findClosestWeight(weightRec, availableWeights);
    
    // Mettre à jour les valeurs de poids
    if (elements.setWeight) elements.setWeight.textContent = closestWeight || weightRec;
    if (elements.weightHint) {
        elements.weightHint.textContent = `IA: ${weightRec}kg`;
        // Indicateur visuel si le poids disponible est différent
        elements.weightHint.style.color = Math.abs(closestWeight - weightRec) > 0.1 
            ? 'var(--warning)' 
            : 'var(--primary)';
    }
    
    // Mettre à jour les reps
    const reps = recommendations.reps_recommendation || 10;
    if (elements.setReps) elements.setReps.textContent = reps;
    if (elements.repsHint) elements.repsHint.textContent = `IA: ${reps}`;
    
    // Gérer le mode poids fixe
    if (recommendations.adaptation_strategy === 'fixed_weight') {
        if (elements.weightHint) elements.weightHint.style.opacity = '0.5';
        if (elements.setWeight) elements.setWeight.classList.add('fixed-weight');
    } else {
        if (elements.weightHint) elements.weightHint.style.opacity = '1';
        if (elements.setWeight) elements.setWeight.classList.remove('fixed-weight');
    }
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

async function completeSet(setNumber) {
    const reps = document.getElementById('setReps').value;
    const weight = document.getElementById('setWeight').value;
    
    if (!reps) {
        showToast('Veuillez indiquer le nombre de répétitions', 'error');
        return;
    }
    
    try {
        const setData = {
            exercise_id: currentExercise.id,
            set_number: setNumber,
            reps: parseInt(reps),
            weight: (currentExercise.weight_type === 'bodyweight') ? null : (weight ? parseFloat(weight) : null),
            reps: parseInt(reps),
            weight: weight ? parseFloat(weight) : null,
            base_rest_time_seconds: currentExercise.base_rest_time_seconds || 90,
            fatigue_level: currentWorkoutSession.sessionFatigue,
            exercise_order_in_session: currentWorkoutSession.exerciseOrder,
            set_order_in_session: currentWorkoutSession.globalSetCount + 1
        };
        
        await apiPost(`/api/workouts/${currentWorkout.id}/sets`, setData);
        
        currentWorkoutSession.completedSets.push(setData);
        currentWorkoutSession.globalSetCount++;
        
        // Mettre à jour l'historique visuel
        updateSetsHistory();
        
        showToast(`Série ${setNumber} enregistrée !`, 'success');
        
        // Démarrer la période de repos
        startRestPeriod(currentExercise.base_rest_time_seconds);
        
    } catch (error) {
        console.error('Erreur enregistrement série:', error);
        showToast('Erreur lors de l\'enregistrement', 'error');
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

function updateSetsHistoryWithDuration(lastSet) {
    const container = document.getElementById('setsHistory');
    if (!container) return;
    
    const exerciseSets = currentWorkoutSession.completedSets.filter(
        s => s.exercise_id === currentExercise.id
    );
    
    container.innerHTML = exerciseSets.map((set, index) => {
        const duration = set.duration_seconds ? 
            `${Math.floor(set.duration_seconds / 60)}:${(set.duration_seconds % 60).toString().padStart(2, '0')}` : 
            '--:--';
            
        return `
            <div class="set-done">
                ${set.weight}kg × ${set.reps} • ${duration} • 💪${set.effort_level}/5
            </div>
        `;
    }).join('');
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

function resetFeedbackSelection() {
    // Désélectionner tous les boutons
    document.querySelectorAll('.emoji-btn.selected').forEach(btn => {
        btn.classList.remove('selected');
        btn.style.backgroundColor = '';
    });
}

function skipRest() {
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }

    // Annuler les sons programmés
    if (window.workoutAudio) {
        workoutAudio.clearScheduledSounds();
    }
    
    // Annuler la notification programmée
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    // Calculer et accumuler le temps de repos réel
    if (workoutState.restStartTime) {
        const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
        currentWorkoutSession.totalRestTime += actualRestTime;
        console.log(`Repos ignoré après ${actualRestTime}s. Total: ${currentWorkoutSession.totalRestTime}s`);
        workoutState.restStartTime = null;
    }
    completeRest();
}

function endRest() {
    // Calculer et accumuler le temps de repos réel
    if (workoutState.restStartTime) {
        const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
        currentWorkoutSession.totalRestTime += actualRestTime;
        console.log(`Repos terminé (endRest) après ${actualRestTime}s. Total: ${currentWorkoutSession.totalRestTime}s`);
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
        workoutAudio.clearScheduledSounds();
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
        const isEnabled = workoutAudio.toggle();
        showToast(isEnabled ? 'Sons activés' : 'Sons désactivés', 'info');
        return isEnabled;
    }
}

function setAudioVolume(volume) {
    if (window.workoutAudio) {
        workoutAudio.setVolume(volume);
    }
}

function testWorkoutSounds() {
    if (window.workoutAudio) {
        workoutAudio.testAllSounds();
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
        
        // Calculer le temps total
        const totalDuration = currentWorkoutSession.totalSetTime + currentWorkoutSession.totalRestTime;
        
        // Enregistrer la séance comme terminée
        await apiPut(`/api/workouts/${currentWorkout.id}/complete`, {
            total_duration: totalDuration,
            total_rest_time: currentWorkoutSession.totalRestTime
        });
        
        // Réinitialiser l'état
        clearWorkoutState();
        
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
            stats.last_workout_date ? new Date(stats.last_workout_date).toLocaleDateString() : '-';
        
        // NOUVEAU: Initialiser les graphiques
        if (typeof initStatsCharts === 'function') {
            await initStatsCharts(currentUser.id, currentUser);
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
            <span class="profile-value">${currentUser.weight} kg</span>
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
        workoutAudio.isEnabled = currentUser.sound_notifications_enabled ?? true;
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
            workoutAudio.isEnabled = newPreference;
        }
        
        showToast('Préférence mise à jour', 'success');
    } catch (error) {
        toggle.checked = !newPreference; // Revert on error
        showToast('Erreur lors de la mise à jour', 'error');
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
        const visible = !filter || text.includes(filter.toLowerCase());
        exercise.style.display = visible ? 'block' : 'none';
    });
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
                    
                    if (exerciseState.isCompleted) {
                        cardClass += ' completed';
                        indexContent = '✓';
                        actionIcon = '↻';
                    } else if (isCurrentExercise) {
                        cardClass += ' current';
                    }
                    
                    // Générer les dots de progression
                    let dotsHtml = '';
                    for (let i = 0; i < exerciseState.totalSets; i++) {
                        dotsHtml += `<div class="set-dot ${i < exerciseState.completedSets ? 'done' : ''}"></div>`;
                    }
                    
                    return `
                        <div class="${cardClass}" data-muscle="${exercise.muscle_groups[0].toLowerCase()}" onclick="handleExerciseCardSimpleClick(${exerciseData.exercise_id})">
                            ${exerciseState.isCompleted ? '<div class="status-badge">✓ Terminé</div>' : ''}
                            <div class="card-content">
                                <div class="exercise-index">${indexContent}</div>
                                <div class="exercise-info">
                                    <div class="exercise-name">${exercise.name}</div>
                                    <div class="exercise-details">
                                        <span class="muscle-groups">${exercise.muscle_groups.join(' • ')}</span>
                                        <span class="sets-indicator">${exerciseData.sets || 3}×${exerciseData.target_reps || exercise.default_reps_min}-${exerciseData.target_reps || exercise.default_reps_max}</span>
                                    </div>
                                </div>
                                <div class="exercise-progress">
                                    <div class="sets-counter">${exerciseState.completedSets}/${exerciseState.totalSets}</div>
                                    <div class="sets-dots">${dotsHtml}</div>
                                </div>
                                <button class="action-btn" onclick="event.stopPropagation(); handleExerciseAction(${exerciseData.exercise_id})">${actionIcon}</button>
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
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        
        // Grouper les exercices par muscle
        const exercisesByMuscle = {
            dos: [],
            pectoraux: [],
            jambes: [],
            epaules: [],
            bras: [],
            abdominaux: []
        };
        // Import des couleurs depuis le système centralisé
        const chartColors = getChartColors();
        backgroundColor: Object.values(chartColors)
        
        // Icônes pour chaque groupe
        const muscleIcons = {
            dos: '🏋🏻‍♂️',
            pectoraux: '🫁',
            jambes: '🦵',
            epaules: '🤷🏻',
            bras: '🦾',
            abdominaux: '🍫'
        };
        
        // Classer les exercices
        exercises.forEach(exercise => {
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
                        ${Object.entries(exercisesByMuscle)
                            .filter(([muscle, exercises]) => exercises.length > 0)
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
function filterByMuscleGroup(muscle) {
    // Mettre à jour l'onglet actif
    document.querySelectorAll('.muscle-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.muscle === muscle);
    });
    
    // Filtrer les sections
    const muscleGroups = document.querySelectorAll('.muscle-group-section');
    muscleGroups.forEach(group => {
        if (muscle === 'all') {
            group.style.display = 'block';
        } else {
            group.style.display = group.dataset.muscle === muscle ? 'block' : 'none';
        }
    });
    
    // Réinitialiser la recherche
    const searchInput = document.getElementById('exerciseSearch');
    if (searchInput) searchInput.value = '';
}

// Fonction pour replier/déplier un groupe musculaire
function toggleMuscleGroup(muscle) {
    const section = document.querySelector(`.muscle-group-${muscle}`);
    const grid = section.querySelector('.muscle-exercises-grid');
    const icon = section.querySelector('.collapse-icon');
    
    grid.classList.toggle('expanded');
    icon.classList.toggle('rotated');
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
        // AJOUT : Nettoyer aussi les données programme
        program: null,
        programExercises: {},
        completedExercisesCount: 0
    };
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


// ===== TIMER DE REPOS =====
function startRestPeriod(customTime = null) {
    // Afficher la période de repos
    document.getElementById('restPeriod').style.display = 'flex';
    
    // Cacher le feedback maintenant qu'on est en repos
    document.getElementById('setFeedback').style.display = 'none';
    
    // Cacher aussi les inputs pendant le repos
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        inputSection.style.display = 'none';
    }
    
    // Modifier le contenu pour inclure le feedback
    const restContent = document.querySelector('.rest-content');

    // Utiliser le temps de repos de l'exercice ou par défaut 60s
    let timeLeft = customTime || 60;
    const initialTime = timeLeft;
    // Enregistrer le début du repos pour calcul ultérieur
    workoutState.restStartTime = Date.now();
    workoutState.plannedRestDuration = timeLeft;
    updateRestTimer(timeLeft);
    
    // Vibration si supportée
    if (navigator.vibrate) {
        navigator.vibrate(200);
    }
    
    // ✅ NOUVEAU : Notifications sonores programmées
    if (window.workoutAudio) {
        workoutAudio.scheduleRestNotifications(timeLeft);
    }
    
    // ❌ SUPPRIMER l'ancien setTimeout de notification
    // ✅ NOUVEAU : Programmer la notification mais stocker le timeout pour pouvoir l'annuler
    if ('Notification' in window && Notification.permission === 'granted') {
        // Annuler toute notification précédente
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
        }
        
        notificationTimeout = setTimeout(() => {
            new Notification('Temps de repos terminé !', {
                body: 'Prêt pour la série suivante ?',
                icon: '/manifest.json'
            });
            notificationTimeout = null; // Nettoyer la référence
        }, timeLeft * 1000);
    }
    
    restTimer = setInterval(() => {
        timeLeft--;
        updateRestTimer(timeLeft);
        
        // Mise à jour de la barre de progression
        const progressFill = document.getElementById('restProgressFill');
        if (progressFill) {
            const progress = ((initialTime - timeLeft) / initialTime) * 100;
            progressFill.style.width = `${progress}%`;
        }
        
        if (timeLeft <= 0) {
            clearInterval(restTimer);
            restTimer = null;
            
            // ✅ Annuler la notification programmée car le timer naturel s'est terminé
            if (notificationTimeout) {
                clearTimeout(notificationTimeout);
                notificationTimeout = null;
            }
            
            // Auto-terminer le repos
            endRest();
            
            // ❌ SUPPRIMER cette deuxième notification (doublonnée)
            // La notification a déjà été envoyée par le setTimeout ci-dessus
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
function setSessionFatigue(value) {
    currentWorkoutSession.sessionFatigue = value;
}

function adjustWeightUp() {
    if (!validateSessionState()) return; // AJOUT
    
    const currentWeight = parseFloat(document.getElementById('setWeight').textContent);
    const weights = JSON.parse(sessionStorage.getItem('availableWeights') || '[]');
    
    if (weights.length === 0) {
        showToast('Poids disponibles non chargés', 'warning');
        return;
    }
    
    // Trouver l'index exact ou le prochain poids supérieur
    let nextIndex = weights.findIndex(w => w > currentWeight);
    
    if (nextIndex !== -1 && nextIndex < weights.length) {
        document.getElementById('setWeight').textContent = weights[nextIndex];
    } else {
        showToast('Poids maximum atteint', 'info');
    }
}

function adjustWeightDown() {
    const currentWeight = parseFloat(document.getElementById('setWeight').textContent);
    const weights = JSON.parse(sessionStorage.getItem('availableWeights') || '[]');
    
    if (weights.length === 0) {
        showToast('Poids disponibles non chargés', 'warning');
        return;
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
    
    // Arrêter le timer de série et enregistrer sa durée
    if (setTimer) {
        const setTime = getSetTimerSeconds();
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
            reps: parseInt(document.getElementById('setReps').textContent),
            weight: null
        };
    } else {
        const weightValue = document.getElementById('setWeight').textContent;
        workoutState.pendingSetData = {
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
    document.querySelectorAll('.emoji-btn[data-fatigue]').forEach(btn => {
        btn.classList.remove('selected');
        btn.style.backgroundColor = '';
    });
    
    // Sélectionner le bouton cliqué
    button.classList.add('selected');
    currentWorkoutSession.currentSetFatigue = value;
    
    // Coloration selon le niveau
    const colors = ['#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444'];
    button.style.backgroundColor = colors[value - 1];
    
    // Si les deux feedbacks sont donnés, lancer automatiquement la validation
    if (document.querySelector('.emoji-btn[data-effort].selected')) {
        validateAndStartRest();
    }
}

function selectEffort(button, value) {
    // Désélectionner tous les boutons d'effort
    document.querySelectorAll('.emoji-btn[data-effort]').forEach(btn => {
        btn.classList.remove('selected');
        btn.style.backgroundColor = '';
    });
    
    // Sélectionner le bouton cliqué
    button.classList.add('selected');
    currentWorkoutSession.currentSetEffort = value;
    
    // Coloration selon l'intensité
    const colors = ['#3b82f6', '#06b6d4', '#10b981', '#f97316', '#dc2626'];
    button.style.backgroundColor = colors[value - 1];
    
    // Si les deux feedbacks sont donnés, lancer automatiquement la validation
    if (document.querySelector('.emoji-btn[data-fatigue].selected')) {
        validateAndStartRest();
    }
}

// ===== VALIDATION DU FEEDBACK =====
async function validateAndStartRest() {
    const fatigue = document.querySelector('.emoji-btn[data-fatigue].selected')?.dataset.fatigue;
    const effort = document.querySelector('.emoji-btn[data-effort].selected')?.dataset.effort;
    
    if (!fatigue || !effort) {
        showToast('Veuillez indiquer fatigue et effort', 'warning');
        return;
    }
    
    // Compléter les données de la série
    const setData = {
        ...workoutState.pendingSetData,
        exercise_id: currentExercise.id,
        set_number: currentSet,
        fatigue_level: parseInt(fatigue),
        effort_level: parseInt(effort)
    };
    
    // Enregistrer la série
    await apiPost(`/api/workouts/${currentWorkout.id}/sets`, setData);
    currentWorkoutSession.completedSets.push(setData);
    currentWorkoutSession.globalSetCount++;
    
    // Mettre à jour l'historique
    updateSetsHistory();

    // Pour les exercices isométriques, pas de repos automatique
    if (currentExercise.exercise_type === 'isometric') {
        // Masquer le feedback et nettoyer le timer
        document.getElementById('setFeedback').style.display = 'none';
        cleanupIsometricTimer();
        
        // Vérifier si fin d'exercice ou série suivante
        if (currentSet >= currentWorkoutSession.totalSets) {
            transitionTo(WorkoutStates.COMPLETED);
            showSetCompletionOptions();
        } else {
            // Série suivante directement
            currentSet++;
            currentWorkoutSession.currentSetNumber = currentSet;
            updateSeriesDots();
            updateHeaderProgress();
            
            if (currentWorkoutSession.type === 'program') {
                updateProgramExerciseProgress();
                loadProgramExercisesList();
            }
            
            // Reconfigurer pour la série suivante
            const inputSection = document.querySelector('.input-section');
            if (inputSection) inputSection.style.display = 'block';
            
            updateSetRecommendations();
            startSetTimer();
            transitionTo(WorkoutStates.READY);
        }
    } else {
        // Workflow classique pour autres exercices
        transitionTo(WorkoutStates.RESTING);
        startRestPeriod(currentExercise.base_rest_time_seconds || 60);
    }

    resetFeedbackSelection();
}

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

async function validateSet() {
    const fatigue = document.querySelector('.emoji-btn[data-fatigue].selected')?.dataset.fatigue;
    const effort = document.querySelector('.emoji-btn[data-effort].selected')?.dataset.effort;
    
    if (!fatigue || !effort) {
        showToast('Veuillez indiquer fatigue et effort', 'warning');
        return;
    }
    
    // Déterminer si c'est un exercice isométrique
    const isIsometric = currentExercise.exercise_type === 'isometric';
    
    // Construire les données de la série selon le type d'exercice
    let setData;
    
    if (isIsometric) {
        // Pour les exercices isométriques
        setData = {
            exercise_id: currentExercise.id,
            set_number: currentSet,
            reps: workoutState.pendingSetData.reps, // La durée est stockée dans reps pour compatibilité
            weight: null, // Pas de poids pour les isométriques
            duration_seconds: workoutState.pendingSetData.duration_seconds || workoutState.pendingSetData.reps,
            fatigue_level: parseInt(fatigue),
            effort_level: parseInt(effort),
            base_rest_time_seconds: currentExercise.base_rest_time_seconds || 60,
            exercise_order_in_session: currentWorkoutSession.exerciseOrder,
            set_order_in_session: currentWorkoutSession.globalSetCount + 1,
            // Recommandations ML
            ml_weight_suggestion: null,
            ml_reps_suggestion: workoutState.currentRecommendation?.reps_recommendation,
            ml_confidence: workoutState.currentRecommendation?.confidence,
            user_followed_ml_weight: null,
            user_followed_ml_reps: workoutState.pendingSetData.reps === workoutState.currentRecommendation?.reps_recommendation
        };
    } else {
        // Pour les exercices standard (bodyweight ou external)
        setData = {
            exercise_id: currentExercise.id,
            set_number: currentSet,
            reps: workoutState.pendingSetData.reps,
            weight: workoutState.pendingSetData.weight,
            duration_seconds: null,
            fatigue_level: parseInt(fatigue),
            effort_level: parseInt(effort),
            base_rest_time_seconds: currentExercise.base_rest_time_seconds || 90,
            exercise_order_in_session: currentWorkoutSession.exerciseOrder,
            set_order_in_session: currentWorkoutSession.globalSetCount + 1,
            // Recommandations ML
            ml_weight_suggestion: workoutState.currentRecommendation?.weight_recommendation,
            ml_reps_suggestion: workoutState.currentRecommendation?.reps_recommendation,
            ml_confidence: workoutState.currentRecommendation?.confidence,
            user_followed_ml_weight: Math.abs((workoutState.pendingSetData.weight || 0) - (workoutState.currentRecommendation?.weight_recommendation || 0)) < 0.5,
            user_followed_ml_reps: workoutState.pendingSetData.reps === workoutState.currentRecommendation?.reps_recommendation
        };
    }
    
    // Ajouter les données communes depuis pendingSetData si elles existent
    if (workoutState.pendingSetData) {
        // Ces champs sont déjà ajoutés ci-dessus, mais on peut ajouter d'autres si nécessaire
    }
    
    try {
        // Enregistrer la série
        await apiPost(`/api/workouts/${currentWorkout.id}/sets`, setData);
        
        // Ajouter aux séries complétées
        currentWorkoutSession.completedSets.push(setData);
        currentWorkoutSession.globalSetCount++;
        
        // Sauvegarder les niveaux de fatigue/effort pour la prochaine recommandation
        currentWorkoutSession.currentSetFatigue = parseInt(fatigue);
        currentWorkoutSession.currentSetEffort = parseInt(effort);
        workoutState.lastEffort = parseInt(effort);
        
        // Mettre à jour l'historique visuel
        updateSetsHistory();
        
        // Transition vers RESTING
        transitionTo(WorkoutStates.RESTING);
        
        // Calculer le temps de repos optimal
        const restTime = workoutState.currentRecommendation?.rest_seconds_recommendation || 
                        currentExercise.base_rest_time_seconds || 
                        (isIsometric ? 60 : 90);
        
        // Démarrer le repos
        startRestPeriod(restTime);
        
        // Réinitialiser la sélection de feedback
        resetFeedbackSelection();
        
    } catch (error) {
        console.error('Erreur enregistrement série:', error);
        showToast('Erreur lors de l\'enregistrement', 'error');
    }
}

// ===== FIN DE SÉRIE =====
function completeRest() {
    // CORRECTION: Calculer et accumuler le temps de repos réel
    if (workoutState.restStartTime) {
        const actualRestTime = Math.round((Date.now() - workoutState.restStartTime) / 1000);
        currentWorkoutSession.totalRestTime += actualRestTime;
        console.log(`Repos terminé après ${actualRestTime}s. Total: ${currentWorkoutSession.totalRestTime}s`);
        workoutState.restStartTime = null;
    }
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
    
    // Transition vers COMPLETED après la dernière série
    if (currentSet >= currentWorkoutSession.totalSets) {
        transitionTo(WorkoutStates.COMPLETED);
        showSetCompletionOptions();
    } else {
        // Passage à la série suivante
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
        
        startSetTimer();
        transitionTo(WorkoutStates.READY);
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
    currentWorkoutSession.totalSets++;
    currentSet = currentWorkoutSession.totalSets;
    
    // Mettre à jour l'interface
    updateSeriesDots();
    document.getElementById('setProgress').textContent = `Série ${currentSet}`;
    
    // Réinitialiser pour la nouvelle série
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('executeSetBtn').style.display = 'block';
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Démarrer le timer de la nouvelle série
    startSetTimer();
    transitionTo(WorkoutStates.READY);
    resetFeedbackSelection();
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

function addRestTime(seconds) {
    if (!restTimer) return;
    
    // Récupérer le temps actuel
    const timerEl = document.getElementById('restTimer');
    const [mins, secs] = timerEl.textContent.replace('-', '').split(':').map(Number);
    let currentSeconds = mins * 60 + secs;
    
    // Ajouter du temps
    currentSeconds += seconds;
    
    // Annuler l'ancienne notification avant de redémarrer
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }
    
    // Redémarrer le timer avec le nouveau temps
    clearInterval(restTimer);
    startRestPeriod(currentSeconds);
    showToast('+30 secondes ajoutées', 'info');
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
    
    try {
        if (currentWorkout) {
            await apiPut(`/api/workouts/${currentWorkout.id}/complete`);
        }
        
        // AJOUT : Nettoyer complètement l'état
        clearWorkoutState();
        localStorage.removeItem('fitness_workout_state');
        
        // AJOUT : Forcer la transition vers IDLE
        transitionTo(WorkoutStates.IDLE);
        
        showView('dashboard');
        showToast('Séance abandonnée', 'info');
    } catch (error) {
        console.error('Erreur abandon séance:', error);
        // AJOUT : Même en cas d'erreur, nettoyer l'état local
        clearWorkoutState();
        localStorage.removeItem('fitness_workout_state');
        transitionTo(WorkoutStates.IDLE);
        showView('dashboard');
    }
}

function showProgramExerciseList() {
    if (currentWorkoutSession.type === 'program') {
        document.getElementById('currentExercise').style.display = 'none';
        document.getElementById('programExercisesContainer').style.display = 'block';
        loadProgramExercisesList();
    }
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
window.validateSet = validateSet;
window.previousSet = previousSet;
window.changeExercise = changeExercise;
window.skipRest = skipRest;
window.addRestTime = addRestTime;
window.endRest = endRest;
window.pauseWorkout = pauseWorkout;
window.abandonWorkout = abandonWorkout;
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
window.selectProgramExercise = selectProgramExercise;
window.restartExercise = restartExercise;
window.handleExerciseCardClick = handleExerciseCardClick;
window.showProgramExerciseList = showProgramExerciseList;
window.updateHeaderProgress = updateHeaderProgress;
window.updateProgramExerciseProgress = updateProgramExerciseProgress;
window.abandonActiveWorkout = abandonActiveWorkout;
window.finishExercise = finishExercise;

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
window.toggleMuscleGroup = toggleMuscleGroup;
window.toggleWeightPreference = toggleWeightPreference;
window.toggleSoundNotifications = toggleSoundNotifications;
