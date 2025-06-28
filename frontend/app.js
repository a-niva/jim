// ===== FITNESS COACH - APPLICATION PRINCIPALE =====
// Version refactorisée simplifiée

// ===== ÉTAT GLOBAL =====
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
    type: 'free'
};
const totalSteps = 4;

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
            showHomePage(); // MODIFICATION ICI
        }
    } else {
        showHomePage(); // MODIFICATION ICI
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
}

async function loadExistingProfiles() {
    const container = document.getElementById('existingProfiles');
    container.innerHTML = '';
    
    // Récupérer les profils depuis localStorage
    const savedProfiles = JSON.parse(localStorage.getItem('fitness_profiles') || '[]');
    
    if (savedProfiles.length === 0) {
        return; // Pas de profils existants
    }
    
    // Ajouter le séparateur
    const divider = document.createElement('div');
    divider.className = 'profiles-divider';
    divider.textContent = 'ou continuez avec';
    container.appendChild(divider);
    
    // Charger les infos de chaque profil
    for (const profileId of savedProfiles) {
        try {
            const user = await apiGet(`/api/users/${profileId}`);
            const stats = await apiGet(`/api/users/${profileId}/stats`);
            
            const profileBtn = document.createElement('button');
            profileBtn.className = 'profile-btn';
            profileBtn.onclick = () => loadProfile(user);
            
            const age = new Date().getFullYear() - new Date(user.birth_date).getFullYear();
            
            profileBtn.innerHTML = `
                <div class="profile-avatar">${user.name[0].toUpperCase()}</div>
                <div class="profile-info">
                    <div class="profile-name">${user.name}</div>
                    <div class="profile-details">
                        <div class="profile-stats">
                            <span class="profile-stat">🎂 ${age} ans</span>
                            <span class="profile-stat">💪 ${stats.total_workouts} séances</span>
                            <span class="profile-stat">📊 ${user.experience_level}</span>
                        </div>
                    </div>
                </div>
            `;
            
            container.appendChild(profileBtn);
            
        } catch (error) {
            // Profil n'existe plus, le retirer de la liste
            const index = savedProfiles.indexOf(profileId);
            if (index > -1) {
                savedProfiles.splice(index, 1);
                localStorage.setItem('fitness_profiles', JSON.stringify(savedProfiles));
            }
        }
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
            equipment_config: collectEquipmentConfig()
        };
        
        // Créer l'utilisateur
        currentUser = await apiPost('/api/users', userData);
        localStorage.setItem('fitness_user_id', currentUser.id);
        
        // Créer le programme si des zones sont sélectionnées
        const focusAreas = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
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
    
    // Vérifier s'il y a une séance active
    try {
        const activeWorkout = await apiGet(`/api/users/${currentUser.id}/workouts/active`);
        if (activeWorkout) {
            showWorkoutResumeBanner(activeWorkout);
        }
    } catch (error) {
        // Pas de séance active, c'est normal
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
    
    // Charger l'état musculaire et l'historique
    try {
        const [stats, availableWeights] = await Promise.all([
            apiGet(`/api/users/${currentUser.id}/stats`),
            apiGet(`/api/users/${currentUser.id}/available-weights`)
        ]);
        
        loadMuscleReadiness();
        loadRecentWorkouts(stats.recent_workouts);
        
    } catch (error) {
        console.error('Erreur chargement dashboard:', error);
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
    `;
    
    const startedAt = new Date(workout.started_at);
    const elapsed = startedAt && !isNaN(startedAt) ? Math.floor((new Date() - startedAt) / 60000) : 0;
    
    banner.innerHTML = `
        <h3>⏱️ Séance en cours</h3>
        <p>Démarrée il y a ${elapsed} minutes</p>
        <button class="btn" style="background: white; color: var(--warning); margin-top: 0.5rem;" 
                onclick="resumeWorkout(${workout.id})">
            Reprendre la séance
        </button>
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

function loadMuscleReadiness() {
    // Simulation simple de l'état musculaire basé sur les nouvelles zones
    const muscles = [
        { name: 'Dos', status: 'ready', lastTrained: null },
        { name: 'Pectoraux', status: 'recovering', lastTrained: '2 jours' },
        { name: 'Bras', status: 'ready', lastTrained: null },
        { name: 'Épaules', status: 'fatigued', lastTrained: '1 jour' },
        { name: 'Jambes', status: 'ready', lastTrained: null },
        { name: 'Abdominaux', status: 'recovering', lastTrained: '1 jour' }
    ];
    
    const container = document.getElementById('muscleReadiness');
    container.innerHTML = muscles.map(muscle => {
        const statusText = {
            ready: 'Prêt à l\'entraînement',
            recovering: 'En récupération',
            fatigued: 'Fatigué'
        }[muscle.status];
        
        return `
            <div class="muscle-item ${muscle.status}">
                <div class="muscle-info">
                    <h4>${muscle.name}</h4>
                    <p>${statusText}${muscle.lastTrained ? ` • Dernier entraînement : ${muscle.lastTrained}` : ''}</p>
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
        
        return `
            <div class="workout-item">
                <div class="workout-header">
                    <strong>${workout.type === 'program' ? 'Programme' : 'Libre'}</strong>
                    <div class="workout-date">${formatDate(date)}</div>
                </div>
                <div class="workout-duration">${duration} minutes</div>
            </div>
        `;
    }).join('');
}

// ===== SÉANCES =====
async function startFreeWorkout() {
    try {
        const workoutData = { type: 'free' };
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        
        currentWorkout = response.workout;
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
        const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
        
        if (!program) {
            showToast('Aucun programme actif trouvé', 'error');
            return;
        }
        
        const workoutData = { type: 'program', program_id: program.id };
        const response = await apiPost(`/api/users/${currentUser.id}/workouts`, workoutData);
        
        currentWorkout = response.workout;
        showView('workout');
        setupProgramWorkout(program);
        
    } catch (error) {
        console.error('Erreur démarrage séance programme:', error);
        showToast('Aucun programme disponible. Créez-en un dans les paramètres.', 'info');
    }
}

function setupFreeWorkout() {
    document.getElementById('workoutTitle').textContent = 'Séance libre';
    document.getElementById('exerciseSelection').style.display = 'block';
    document.getElementById('currentExercise').style.display = 'none';
    
    loadAvailableExercises();
    startWorkoutTimer();
}

function setupProgramWorkout(program) {
    document.getElementById('workoutTitle').textContent = 'Séance programme';
    document.getElementById('exerciseSelection').style.display = 'none';
    
    // Pour la démo, prendre le premier exercice du programme
    if (program.exercises && program.exercises.length > 0) {
        const firstExercise = program.exercises[0];
        selectExercise({ id: firstExercise.exercise_id, name: firstExercise.exercise_name });
    }
    
    startWorkoutTimer();
}

async function selectExercise(exercise) {
    currentExercise = exercise;
    currentSet = 1;
    currentWorkoutSession.currentExercise = exercise;
    currentWorkoutSession.currentSetNumber = 1;
    currentWorkoutSession.totalSets = exercise.default_sets || 3;
    currentWorkoutSession.maxSets = 6; // Maximum absolu
    
    // Définir le nombre de séries
    currentWorkoutSession.totalSets = exercise.default_sets || 3;
    
    document.getElementById('exerciseSelection').style.display = 'none';
    document.getElementById('currentExercise').style.display = 'block';
    
    document.getElementById('exerciseName').textContent = exercise.name;

    // AJOUTER ICI : Initialiser les dots
    updateSeriesDots();
    
    // Obtenir les recommandations ML
    await updateSetRecommendations();
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
        
        // Obtenir les poids disponibles
        const weightsData = await apiGet(`/api/users/${currentUser.id}/available-weights`);
        const availableWeights = weightsData.available_weights.sort((a, b) => a - b);
        
        // Stocker les poids disponibles pour navigation
        sessionStorage.setItem('availableWeights', JSON.stringify(availableWeights));
        
        // Gérer le cas où pas de recommandation (première série)
        if (!recommendations.weight_recommendation) {
            recommendations.weight_recommendation = 20; // Poids par défaut sécurisé
            recommendations.reasoning = 'Première série - commencez prudemment';
        }
        
        // Trouver le poids disponible le plus proche
        const closestWeight = findClosestWeight(recommendations.weight_recommendation, availableWeights);
        
        // Mettre à jour les hints IA
        document.getElementById('weightHint').textContent = 
            `IA: ${recommendations.weight_recommendation}kg`;
        document.getElementById('repsHint').textContent = 
            `IA: ${recommendations.reps_recommendation || 10}`;
        
        // Pré-remplir avec les valeurs recommandées (ou les plus proches disponibles)
        document.getElementById('setWeight').textContent = closestWeight || recommendations.weight_recommendation;
        document.getElementById('setReps').textContent = recommendations.reps_recommendation || 10;
        
        // Si les hints sont différents des valeurs affichées, les mettre en évidence
        if (Math.abs(closestWeight - recommendations.weight_recommendation) > 0.1) {
            document.getElementById('weightHint').style.color = 'var(--warning)';
        } else {
            document.getElementById('weightHint').style.color = 'var(--primary)';
        }
        
        // Mettre à jour la confiance
        if (recommendations.confidence) {
            const confidenceEl = document.getElementById('recConfidence');
            if (confidenceEl) {
                confidenceEl.textContent = Math.round(recommendations.confidence * 100);
            }
        }
        
    } catch (error) {
        console.error('Erreur recommandations ML:', error);
        // Valeurs par défaut en cas d'erreur
        document.getElementById('setWeight').textContent = '20';
        document.getElementById('setReps').textContent = '10';
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
    
    container.innerHTML = exerciseSets.map((set, index) => `
        <div class="set-history-item">
            <div class="set-number">${index + 1}</div>
            <div class="set-details">${set.weight}kg × ${set.reps} reps</div>
            <div class="set-feedback-summary">
                ${set.fatigue_level ? `Fatigue: ${set.fatigue_level}/5` : ''}
            </div>
        </div>
    `).join('');
}


function finishExercise() {
    document.getElementById('currentExercise').style.display = 'none';
    
    if (currentWorkout.type === 'free') {
        document.getElementById('exerciseSelection').style.display = 'block';
    } else {
        // Programme: passer à l'exercice suivant ou terminer
        showToast('Exercice terminé ! Prêt pour le suivant ?', 'success');
    }
    
    currentExercise = null;
    currentSet = 1;
}

function updateRestTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('restTimer').textContent = 
        `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function skipRest() {
    if (confirm('Voulez-vous vraiment ignorer le temps de repos ?')) {
        if (restTimer) {
            clearInterval(restTimer);
            restTimer = null;
        }
        endRest();
    }
}

function endRest() {
    document.getElementById('restPeriod').style.display = 'none';
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
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
    if (currentSet < currentWorkoutSession.totalSets) {
        window.nextSet(); // Utiliser window.nextSet pour éviter l'erreur de référence
    } else {
        showExerciseCompletion();
    }
}

function showExerciseCompletion() {
    // Réinitialiser l'interface
    document.getElementById('executeSetBtn').style.display = 'block';
    document.getElementById('setFeedback').style.display = 'none';
    
    // Afficher les options
    showModal('Exercice terminé', `
        <div style="text-align: center;">
            <p>Vous avez terminé ${currentSet} séries de ${currentExercise.name}</p>
            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <button class="btn btn-secondary" onclick="addExtraSet(); closeModal();">
                    Série supplémentaire
                </button>
                <button class="btn btn-primary" onclick="finishExercise(); closeModal();">
                    Exercice suivant
                </button>
            </div>
        </div>
    `);
}

function startWorkoutTimer() {
    const startTime = new Date();
    
    workoutTimer = setInterval(() => {
        const elapsed = new Date() - startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        document.getElementById('workoutTimer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

async function endWorkout() {
    if (!confirm('Êtes-vous sûr de vouloir terminer cette séance ?')) return;
    
    try {
        await apiPut(`/api/workouts/${currentWorkout.id}/complete`);
        
        if (workoutTimer) {
            clearInterval(workoutTimer);
            workoutTimer = null;
        }
        
        showToast('Séance terminée ! Bravo ! 🎉', 'success');
        showView('dashboard');
        loadDashboard();
        
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
            stats.last_workout_date ? formatDate(new Date(stats.last_workout_date)) : 'Jamais';
        
        // Afficher les records
        const recordsList = document.getElementById('recordsList');
        if (progress.exercise_records && progress.exercise_records.length > 0) {
            recordsList.innerHTML = progress.exercise_records.map(record => `
                <div class="record-item">
                    <div class="record-exercise">${record.name}</div>
                    <div class="record-value">${record.max_weight}kg × ${record.max_reps} reps</div>
                </div>
            `).join('');
        } else {
            recordsList.innerHTML = '<p class="text-center">Aucun record pour le moment</p>';
        }
        
    } catch (error) {
        console.error('Erreur chargement stats:', error);
        // Ajouter ces lignes :
        document.getElementById('totalWorkouts').textContent = '0';
        document.getElementById('totalVolume').textContent = '0kg';
        document.getElementById('lastWorkout').textContent = 'Aucune';
        document.getElementById('recordsList').innerHTML = '<p class="text-center">Aucun record pour le moment</p>';
    }
}

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
    
    document.getElementById('profileInfo').innerHTML = `
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
        showToast('Historique vidé avec succès', 'success');
        loadDashboard();
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
                typeof errorData.detail === 'string' 
                    ? errorData.detail 
                    : JSON.stringify(errorData.detail) || `HTTP ${response.status}: ${response.statusText}`
            );
        }
        
        return await response.json();
    } catch (error) {
        console.error('Erreur API:', error);
        
        // Messages d'erreur plus explicites
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

async function loadProgramExercise() {
    try {
        // Récupérer le programme actif
        const program = await apiGet(`/api/users/${currentUser.id}/programs/active`);
        
        if (!program || !program.exercises || program.exercises.length === 0) {
            showToast('Aucun programme trouvé', 'error');
            showExerciseSelection();
            return;
        }
        
        // Prendre le premier exercice du programme pour cette séance
        // TODO: Améliorer la logique pour gérer les différentes séances
        const exerciseData = program.exercises[0];
        
        // Récupérer les détails de l'exercice
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const exercise = exercises.find(ex => ex.id === exerciseData.exercise_id);
        
        if (exercise) {
            selectExercise(exercise);
        } else {
            showToast('Exercice du programme non trouvé', 'error');
            showExerciseSelection();
        }
        
    } catch (error) {
        console.error('Erreur chargement exercice programme:', error);
        showExerciseSelection();
    }
}


// ===== FONCTIONS UTILITAIRES SÉANCES =====
async function loadAvailableExercises() {
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const container = document.getElementById('exerciseList');
        
        container.innerHTML = exercises.map(exercise => `
            <div class="exercise-item" onclick="selectExercise({id: ${exercise.id}, name: '${exercise.name}', instructions: '${exercise.instructions}', base_rest_time_seconds: ${exercise.base_rest_time_seconds || 60}, default_reps_min: ${exercise.default_reps_min}, intensity_factor: ${exercise.intensity_factor || 1.0}})">
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
    localStorage.removeItem('fitness_workout_state');
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


// ===== AMÉLIORATION DU TIMER DE REPOS =====
function startRestPeriod(customTime = null) {
    // Afficher la période de repos AVEC le feedback visible
    document.getElementById('restPeriod').style.display = 'flex';
    
    // Modifier le contenu pour inclure le feedback
    const restContent = document.querySelector('.rest-content');
    if (restContent && document.getElementById('setFeedback').style.display === 'block') {
        // Cloner la zone de feedback dans le modal de repos
        const feedbackClone = document.getElementById('setFeedback').cloneNode(true);
        feedbackClone.style.display = 'block';
        
        // Insérer avant les actions de repos
        const restActions = restContent.querySelector('.rest-actions');
        restContent.insertBefore(feedbackClone, restActions);
    }
    
    // Utiliser le temps de repos de l'exercice ou par défaut 60s
    let timeLeft = customTime || 60;
    const initialTime = timeLeft; // AJOUT : Déclarer initialTime
    updateRestTimer(timeLeft);
    
    // Vibration si supportée
    if (navigator.vibrate) {
        navigator.vibrate(200);
    }
    
    // Notification de fin si supportée
    if ('Notification' in window && Notification.permission === 'granted') {
        setTimeout(() => {
            new Notification('Temps de repos terminé !', {
                body: 'Prêt pour la série suivante ?',
                icon: '/manifest.json'
            });
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
            
            // Auto-terminer le repos
            endRest();
            
            // Notification
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Temps de repos terminé !', {
                    body: 'Prêt pour la prochaine série ?',
                    icon: '/manifest.json'
                });
            }
            
            // Vibration
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
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
    repsElement.textContent = Math.max(1, current + delta);
}

function executeSet() {
    if (!validateSessionState()) return;
    // Arrêter le timer global de la séance
    if (workoutTimer) {
        clearInterval(workoutTimer);
        // Sauvegarder le temps écoulé
        const timerEl = document.getElementById('workoutTimer');
        sessionStorage.setItem('pausedWorkoutTime', timerEl.textContent);
    }
    
    // Sauvegarder les valeurs actuelles de poids/reps
    const reps = parseInt(document.getElementById('setReps').textContent);
    const weight = parseFloat(document.getElementById('setWeight').textContent);
    sessionStorage.setItem('pendingSetData', JSON.stringify({ reps, weight }));
    
    // Calculer un temps de repos par défaut basé sur l'exercice
    const baseRestTime = currentExercise.base_rest_time_seconds || 90;
    
    // Démarrer immédiatement le repos
    startRestPeriod(baseRestTime);
    
    // Masquer le bouton GO et afficher le feedback
    document.getElementById('executeSetBtn').style.display = 'none';
    document.getElementById('setFeedback').style.display = 'block';
    
    // Mettre à jour le texte du bouton
    updateValidateButton();
}

function updateValidateButton() {
    const btn = document.getElementById('validateSetBtn');
    if (!btn) return;
    
    // Si c'est la dernière série prévue
    if (currentSet >= currentWorkoutSession.totalSets) {
        // Remplacer par deux boutons
        const container = btn.parentElement;
        container.innerHTML = `
            <div style="display: flex; gap: 0.5rem;">
                <button class="validate-button" style="flex: 1;" onclick="addExtraSet(); validateSet();">
                    Série supplémentaire
                </button>
                <button class="validate-button" style="flex: 1; background: var(--success);" onclick="validateSet();">
                    Exercice suivant →
                </button>
            </div>
        `;
    } else {
        btn.textContent = 'Série suivante →';
    }
}

function selectFatigue(button, value) {
    // Désélectionner tous les boutons emojis de fatigue
    document.querySelectorAll('.emoji-btn[data-fatigue]').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Sélectionner le bouton cliqué
    button.classList.add('selected');
    
    // Stocker la valeur
    currentWorkoutSession.currentSetFatigue = value;
    
    // Coloration selon le niveau (vert → rouge)
    const colors = ['#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444'];
    button.style.backgroundColor = colors[value - 1];
}

function selectEffort(button, value) {
    // Désélectionner tous les boutons emojis d'effort
    document.querySelectorAll('.emoji-btn[data-effort]').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Sélectionner le bouton cliqué
    button.classList.add('selected');
    
    // Stocker la valeur
    currentWorkoutSession.currentSetEffort = value;
    
    // Coloration selon l'intensité (bleu → rouge)
    const colors = ['#3b82f6', '#06b6d4', '#10b981', '#f97316', '#dc2626'];
    button.style.backgroundColor = colors[value - 1];
}

function setFatigue(exerciseId, value) {
    // Stocker la fatigue pour cet exercice
    console.log(`Fatigue set to ${value} for exercise ${exerciseId}`);
}

function setEffort(setId, value) {
    // Stocker l'effort pour cette série
    console.log(`Effort set to ${value} for set ${setId}`);
}

function validateSessionState() {
    if (!currentWorkout || !currentExercise) {
        console.error('État de session invalide');
        showToast('Erreur de session, retour au dashboard', 'error');
        showView('dashboard');
        return false;
    }
    return true;
}

async function validateSet() {
    if (!validateSessionState()) return;
    const fatigue = document.querySelector('.emoji-btn[data-fatigue].selected')?.dataset.fatigue;
    const effort = document.querySelector('.emoji-btn[data-effort].selected')?.dataset.effort;
    
    if (!fatigue || !effort) {
        showToast('Veuillez indiquer votre fatigue et effort', 'warning');
        return;
    }
    
    // Récupérer les données sauvegardées
    const pendingData = JSON.parse(sessionStorage.getItem('pendingSetData') || '{}');
    
    try {
        const setData = {
            exercise_id: currentExercise.id,
            set_number: currentSet,
            reps: pendingData.reps,
            weight: pendingData.weight,
            base_rest_time_seconds: currentExercise.base_rest_time_seconds || 90,
            fatigue_level: parseInt(fatigue),
            effort_level: parseInt(effort),
            exercise_order_in_session: currentWorkoutSession.exerciseOrder,
            set_order_in_session: currentWorkoutSession.globalSetCount + 1
        };
        
        await apiPost(`/api/workouts/${currentWorkout.id}/sets`, setData);
        
        currentWorkoutSession.completedSets.push(setData);
        currentWorkoutSession.globalSetCount++;
        
        // Mettre à jour l'historique
        updateSetsHistory();
        
        // Si on était dans la dernière série, terminer l'exercice
        if (currentSet >= currentWorkoutSession.totalSets) {
            finishExercise();
        } else {
            // Sinon, passer à la série suivante
            nextSet();
        }
        
    } catch (error) {
        console.error('Erreur enregistrement série:', error);
        showToast('Erreur lors de l\'enregistrement', 'error');
    }
}

function nextSet() {
    // Si on est sur la dernière série prévue
    if (currentSet === currentWorkoutSession.totalSets) {
        if (confirm('Terminer cet exercice ?')) {
            finishExercise();
            return;
        }
    }
    
    // Si on dépasse le maximum absolu
    if (currentSet >= currentWorkoutSession.maxSets) {
        showToast('Nombre maximum de séries atteint', 'info');
        finishExercise();
        return;
    }
    
    currentSet++;
    currentWorkoutSession.currentSetNumber = currentSet;
    updateSeriesDots();
    
    // Mettre à jour l'interface
    // Utiliser les éléments qui existent réellement
    const setProgressEl = document.getElementById('setProgress');
    if (setProgressEl) {
        setProgressEl.textContent = `Série ${currentSet}/${currentWorkoutSession.totalSets}`;
    }

    // Réinitialiser les inputs (corriger les IDs)
    document.getElementById('setWeight').textContent = '';
    document.getElementById('setReps').textContent = '';

    // Réinitialiser l'interface
    document.getElementById('executeSetBtn').style.display = 'block';
    document.getElementById('setFeedback').style.display = 'none';

    // Désélectionner les emojis
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Réinitialiser les inputs
    document.getElementById('setWeight').value = '';
    document.getElementById('setReps').value = '';
    // Réafficher la zone d'input et masquer le feedback
    document.getElementById('inputZone').style.display = 'grid';
    document.getElementById('executeSetBtn').style.display = 'flex';
    document.getElementById('setFeedback').style.display = 'none';

    // Masquer le feedback et réafficher les inputs
    document.getElementById('setFeedback').style.display = 'none';
    document.getElementById('executeSetBtn').style.display = 'block';
    
    // Mettre à jour les boutons
    updateSetNavigationButtons();
    
    // Charger les nouvelles recommandations ML
    updateSetRecommendations();
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
}

function changeExercise() {
    finishExercise();
}

function addRestTime(seconds) {
    // Ajouter du temps au repos en cours
    console.log(`Adding ${seconds} seconds to rest`);
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
        
        // Sauvegarder le temps actuel
        pausedTime = document.getElementById('workoutTimer').textContent;
        
        // Changer le bouton
        pauseBtn.textContent = '▶️ Reprendre';
        pauseBtn.classList.remove('btn-warning');
        pauseBtn.classList.add('btn-success');
        
        isPaused = true;
        saveWorkoutState();
        showToast('Séance mise en pause', 'info');
        
    } else {
        // Reprendre
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
        
        // Changer le bouton
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.classList.remove('btn-success');
        pauseBtn.classList.add('btn-warning');
        
        isPaused = false;
        showToast('Séance reprise', 'success');
    }
}

function abandonWorkout() {
    if (confirm('Êtes-vous sûr d\'abandonner cette séance ?')) {
        endWorkout();
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
window.nextSet = nextSet;
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