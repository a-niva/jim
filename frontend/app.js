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
const totalSteps = 4;

// Configuration équipement disponible
const EQUIPMENT_CONFIG = {
    dumbbells: { name: 'Haltères', icon: '🏋️', hasWeights: true },
    barbell: { name: 'Barre olympique', icon: '🥉', hasWeights: true },
    resistance_bands: { name: 'Élastiques', icon: '🎗️', hasTensions: true },
    kettlebells: { name: 'Kettlebells', icon: '⚫', hasWeights: true },
    pull_up_bar: { name: 'Barre de traction', icon: '🎯', bodyweightBased: true },
    dip_bar: { name: 'Barre de dips', icon: '💪', bodyweightBased: true },
    bench_flat: { name: 'Banc plat', icon: '🛏️', supportEquipment: true },
    bench_incline: { name: 'Banc inclinable', icon: '📐', supportEquipment: true },
    bench_decline: { name: 'Banc déclinable', icon: '📉', supportEquipment: true },
    cable_machine: { name: 'Machine à poulies', icon: '🏗️', hasMachineWeights: true },
    leg_press: { name: 'Presse à cuisses', icon: '🦵', hasMachineWeights: true },
    lat_pulldown: { name: 'Tirage vertical', icon: '⬇️', hasMachineWeights: true },
    chest_press: { name: 'Développé machine', icon: '💻', hasMachineWeights: true }
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
            console.log('Utilisateur non trouvé, démarrage onboarding');
            localStorage.removeItem('fitness_user_id');
            showOnboarding();
        }
    } else {
        showOnboarding();
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
        
        switch (equipment) {
            case 'dumbbells':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids disponibles (kg) - séparés par des virgules</label>
                        <input type="text" id="dumbbells_weights" placeholder="5, 10, 15, 20, 25, 30" value="5, 10, 15, 20, 25, 30">
                    </div>
                `;
                break;
                
            case 'barbell':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids de la barre (kg)</label>
                        <input type="number" id="barbell_weight" value="20" min="5" max="50">
                    </div>
                    <div class="form-group">
                        <label>Disques disponibles (kg) - séparés par des virgules</label>
                        <input type="text" id="plates_weights" placeholder="1.25, 2.5, 5, 10, 20" value="1.25, 2.5, 5, 10, 20">
                    </div>
                `;
                break;
                
            case 'resistance_bands':
                detailHTML += `
                    <div class="form-group">
                        <label>Tensions disponibles (kg équivalent) - séparés par des virgules</label>
                        <input type="text" id="bands_tensions" placeholder="5, 10, 15, 20, 25" value="5, 10, 15, 20, 25">
                    </div>
                    <div class="form-group">
                        <label>Possibilité de combiner les élastiques</label>
                        <label class="checkbox-option">
                            <input type="checkbox" id="bands_combinable" checked>
                            <span>Oui, je peux utiliser plusieurs élastiques ensemble</span>
                        </label>
                    </div>
                `;
                break;
                
            case 'kettlebells':
                detailHTML += `
                    <div class="form-group">
                        <label>Poids disponibles (kg) - séparés par des virgules</label>
                        <input type="text" id="kettlebells_weights" placeholder="8, 12, 16, 20, 24" value="8, 12, 16, 20, 24">
                    </div>
                `;
                break;
                
            case 'pull_up_bar':
            case 'dip_bar':
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
                
            case 'cable_machine':
            case 'leg_press':
            case 'lat_pulldown':
            case 'chest_press':
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
        
        // Ajouter les event listeners pour les équipements avec lest
        if (equipment === 'pull_up_bar' || equipment === 'dip_bar') {
            const checkbox = document.getElementById(`${equipment}_weighted`);
            const weightsContainer = document.getElementById(`${equipment}_weights_container`);
            
            checkbox.addEventListener('change', () => {
                weightsContainer.style.display = checkbox.checked ? 'block' : 'none';
            });
        }
    });
}

async function completeOnboarding() {
    if (!validateCurrentStep()) return;
    
    try {
        showToast('Création de votre profil...', 'info');
        
        // Collecter les données du formulaire
        const userData = {
            name: document.getElementById('userName').value.trim(),
            birth_date: document.getElementById('birthDate').value,
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
        config[equipment] = { available: true };
        
        // Ajouter les détails spécifiques
        switch (equipment) {
            case 'dumbbells':
                const dumbbellWeights = document.getElementById('dumbbells_weights');
                if (dumbbellWeights) {
                    config[equipment].weights = dumbbellWeights.value
                        .split(',')
                        .map(w => parseFloat(w.trim()))
                        .filter(w => !isNaN(w));
                }
                break;
                
            case 'barbell':
                const barbellWeight = document.getElementById('barbell_weight');
                const platesWeights = document.getElementById('plates_weights');
                if (barbellWeight) {
                    config[equipment].weight = parseFloat(barbellWeight.value);
                }
                if (platesWeights) {
                    config.plates = {
                        available: true,
                        weights: platesWeights.value
                            .split(',')
                            .map(w => parseFloat(w.trim()))
                            .filter(w => !isNaN(w))
                    };
                }
                break;
                
            case 'resistance_bands':
                const bandsTensions = document.getElementById('bands_tensions');
                const bandsCombinable = document.getElementById('bands_combinable');
                if (bandsTensions) {
                    config[equipment].tensions = bandsTensions.value
                        .split(',')
                        .map(t => parseFloat(t.trim()))
                        .filter(t => !isNaN(t));
                }
                if (bandsCombinable) {
                    config[equipment].combinable = bandsCombinable.checked;
                }
                break;
                
            case 'kettlebells':
                const kettlebellWeights = document.getElementById('kettlebells_weights');
                if (kettlebellWeights) {
                    config[equipment].weights = kettlebellWeights.value
                        .split(',')
                        .map(w => parseFloat(w.trim()))
                        .filter(w => !isNaN(w));
                }
                break;
                
            case 'pull_up_bar':
            case 'dip_bar':
                const weightedCheckbox = document.getElementById(`${equipment}_weighted`);
                const weightsInput = document.getElementById(`${equipment}_weights`);
                if (weightedCheckbox) {
                    config[equipment].can_add_weight = weightedCheckbox.checked;
                    if (weightedCheckbox.checked && weightsInput) {
                        config[equipment].additional_weights = weightsInput.value
                            .split(',')
                            .map(w => parseFloat(w.trim()))
                            .filter(w => !isNaN(w));
                    }
                }
                break;
                
            case 'cable_machine':
            case 'leg_press':
            case 'lat_pulldown':
            case 'chest_press':
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
    const elapsed = Math.floor((new Date() - startedAt) / 60000); // minutes
    
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

async function loadAvailableExercises() {
    try {
        const exercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
        const container = document.getElementById('exerciseList');
        
        container.innerHTML = exercises.map(exercise => `
            <div class="exercise-item" onclick="selectExercise({id: ${exercise.id}, name: '${exercise.name}'})">
                <h4>${exercise.name}</h4>
                <p>${exercise.muscle_groups.join(', ')} • ${exercise.difficulty}</p>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Erreur chargement exercices:', error);
    }
}

function selectExercise(exercise) {
    currentExercise = exercise;
    currentSet = 1;
    
    document.getElementById('exerciseSelection').style.display = 'none';
    document.getElementById('currentExercise').style.display = 'block';
    
    document.getElementById('exerciseName').textContent = exercise.name;
    document.getElementById('exerciseInstructions').textContent = 
        'Effectuez vos séries et renseignez le nombre de répétitions et le poids utilisé.';
    
    loadSets();
}

function loadSets() {
    const container = document.getElementById('setsList');
    container.innerHTML = '';
    
    // Afficher les séries déjà effectuées + la prochaine
    for (let i = 1; i <= currentSet; i++) {
        const setItem = document.createElement('div');
        setItem.className = 'set-item';
        setItem.innerHTML = `
            <div class="set-number">${i}</div>
            <div class="set-inputs">
                <input type="number" placeholder="Reps" id="reps_${i}" min="1" max="50">
                <input type="number" placeholder="Poids (kg)" id="weight_${i}" min="0" step="0.5">
            </div>
            <button class="btn btn-success btn-sm" onclick="completeSet(${i})">✓</button>
        `;
        container.appendChild(setItem);
    }
}

async function completeSet(setNumber) {
    const reps = document.getElementById(`reps_${setNumber}`).value;
    const weight = document.getElementById(`weight_${setNumber}`).value;
    
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
            rest_seconds: 60
        };
        
        await apiPost(`/api/workouts/${currentWorkout.id}/sets`, setData);
        
        // Désactiver les inputs de cette série
        document.getElementById(`reps_${setNumber}`).disabled = true;
        document.getElementById(`weight_${setNumber}`).disabled = true;
        
        showToast(`Série ${setNumber} enregistrée !`, 'success');
        
        // Démarrer la période de repos
        startRestPeriod();
        
    } catch (error) {
        console.error('Erreur enregistrement série:', error);
        showToast('Erreur lors de l\'enregistrement', 'error');
    }
}

function addSet() {
    currentSet++;
    loadSets();
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

function startRestPeriod() {
    document.getElementById('restPeriod').style.display = 'flex';
    
    let timeLeft = 60; // 60 secondes
    updateRestTimer(timeLeft);
    
    restTimer = setInterval(() => {
        timeLeft--;
        updateRestTimer(timeLeft);
        
        if (timeLeft <= 0) {
            clearInterval(restTimer);
            endRest();
        }
    }, 1000);
}

function updateRestTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('restTimer').textContent = 
        `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function skipRest() {
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
    endRest();
}

function endRest() {
    document.getElementById('restPeriod').style.display = 'none';
    if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
    }
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
    }
}

// ===== PROFIL =====
async function loadProfile() {
    if (!currentUser) return;
    
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
        showOnboarding();
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
            throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
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

// ===== EXPOSITION GLOBALE =====
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
window.adjustWeight = adjustWeight;
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

function filterExercises() {
    const filter = document.getElementById('muscleFilter').value;
    const exercises = document.querySelectorAll('.exercise-item');
    
    exercises.forEach(exercise => {
        const text = exercise.textContent.toLowerCase();
        const visible = !filter || text.includes(filter.toLowerCase());
        exercise.style.display = visible ? 'block' : 'none';
    });
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
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showToast('Notifications activées', 'success');
            }
        });
    }
}

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

// ===== AMÉLIORATIONS DE L'INTERFACE DE SÉRIE =====
async function loadSets() {
    const container = document.getElementById('setsList');
    container.innerHTML = '';
    
    // Afficher les séries déjà effectuées + la prochaine
    for (let i = 1; i <= currentSet; i++) {
        const setItem = document.createElement('div');
        setItem.className = 'set-item';
        
        // Obtenir le poids suggéré pour cette série
        const suggestedWeight = await getSuggestedWeight(currentExercise.id, i);
        
        setItem.innerHTML = `
            <div class="set-number">${i}</div>
            <div class="set-inputs">
                <input type="number" placeholder="Reps" id="reps_${i}" min="1" max="50">
                <input type="number" placeholder="Poids (kg)" id="weight_${i}" min="0" step="0.5" 
                       ${suggestedWeight ? `value="${suggestedWeight}"` : ''}>
                ${suggestedWeight ? `<small style="color: var(--text-muted);">Suggéré: ${suggestedWeight}kg</small>` : ''}
            </div>
            <button class="btn btn-success btn-sm" onclick="completeSet(${i})">✓</button>
        `;
        container.appendChild(setItem);
    }
}

// ===== AMÉLIORATION DU TIMER DE REPOS =====
function startRestPeriod(customTime = null) {
    document.getElementById('restPeriod').style.display = 'flex';
    
    // Utiliser le temps de repos de l'exercice ou par défaut 60s
    let timeLeft = customTime || 60;
    updateRestTimer(timeLeft);
    
    // Vibration si supportée
    if (navigator.vibrate) {
        navigator.vibrate(200);
    }
    
    // Notification de fin si supportée
    if ('Notification' in window && Notification.permission === 'granted') {
        setTimeout(() => {
            if (timeLeft <= 0) {
                new Notification('Temps de repos terminé !', {
                    body: 'Prêt pour la série suivante ?',
                    icon: '/manifest.json'
                });
            }
        }, timeLeft * 1000);
    }
    
    restTimer = setInterval(() => {
        timeLeft--;
        updateRestTimer(timeLeft);
        
        if (timeLeft <= 0) {
            clearInterval(restTimer);
            endRest();
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