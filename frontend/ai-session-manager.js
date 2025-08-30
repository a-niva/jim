// frontend/ai-session-manager.js - NOUVEAU FICHIER

const PPL_CATEGORIES = {
    'push': {
        'name': 'Push (Pousser)',
        'muscles': ['pectoraux', 'epaules', 'bras'],
        'description': 'Exercices de poussée - pectoraux, épaules, triceps',
        'icon': '💪',
        'color': '#3b82f6'
    },
    'pull': {
        'name': 'Pull (Tirer)', 
        'muscles': ['dos', 'bras'],
        'description': 'Exercices de traction - dos, biceps',
        'icon': '🏋️',
        'color': '#10b981'
    },
    'legs': {
        'name': 'Legs (Jambes)',
        'muscles': ['jambes'],
        'description': 'Exercices jambes complètes',
        'icon': '🦵',
        'color': '#f59e0b'
    }
};

class AISessionManager {
    constructor(containerId = 'ai-session-container') {
        this.containerId = containerId;
        this.container = null;  // Sera défini dans initialize()
            
        // Paramètres génération avec valeurs par défaut intelligentes
        this.params = {
            ppl_override: null,           // null = auto-recommendation
            exploration_factor: 0.5,      // 50% équilibre favoris/nouveaux
            target_exercise_count: 5,     // Nombre optimal
            manual_muscle_focus: [],      // Aucun focus spécifique
            randomness_seed: null         // Généré automatiquement
        };
        
        // État interface
        this.lastGenerated = null;
        this.pplRecommendation = null;
        this.isGenerating = false;
        
        // Bind methods pour event listeners
        this.generateSession = this.generateSession.bind(this);
        this.regenerateSession = this.regenerateSession.bind(this);
        this.launchAISession = this.launchAISession.bind(this);
        this.onParameterChange = this.onParameterChange.bind(this);
    }
    
    async initialize() {
        /**
         * POINT D'ENTRÉE - Initialise l'interface IA
         * 
         * Réutilise votre fonction loadMuscleReadiness() existante
         * Appelle votre backend pour recommandation PPL
         */
        
        console.log('🤖 Initialisation AISessionManager');
                
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container ${this.containerId} introuvable`);
            return false;
        }
        console.log('📦 Container trouvé:', this.container);
        
        try {
            // Charger recommandation PPL depuis votre backend
            this.pplRecommendation = await window.apiGet(`/api/ai/ppl-recommendation/${window.currentUser.id}`);
            console.log('📊 Recommandation PPL chargée:', this.pplRecommendation);
            
            // Préselectionner PPL recommandée
            this.params.ppl_override = null; // Force auto pour afficher recommandation
            
        } catch (error) {
            console.error('Erreur chargement recommandation PPL:', error);
            this.pplRecommendation = { 
                category: 'push', 
                confidence: 0.5, 
                reasoning: 'Recommandation par défaut',
                muscle_readiness: {}
            };
        }
        
        // Rendre interface
        this.render();
        this.bindEventListeners();
        
        // Charger état musculaire (RÉUTILISE votre fonction existante)
        await this.loadMuscleReadinessForAI();
        
        return true;
    }
    
    async loadMuscleReadinessForAI() {
        /**
         * Réutilise votre loadMuscleReadiness() existante
         */
        
        try {
            // Utiliser votre fonction loadMuscleReadiness existante
            if (typeof window.loadMuscleReadiness === 'function') {
                // Créer container temporaire dans l'interface IA
                const aiMuscleContainer = document.getElementById('aiMuscleReadinessContainer');
                if (aiMuscleContainer) {
                    // Appeler votre fonction avec le container IA
                    const originalContainer = document.getElementById('muscleReadiness');
                    if (originalContainer) {
                        // Copier le contenu généré par votre fonction
                        await window.loadMuscleReadiness();
                        aiMuscleContainer.innerHTML = originalContainer.innerHTML;
                    }
                }
            }
        } catch (error) {
            console.error('Erreur chargement muscle readiness:', error);
            this.renderFallbackMuscleReadiness();
        }
    }
    
    render() {
        /**
         * Affiche l'interface principale de génération
         */
        if (!this.container) {
            console.error('❌ Container non défini dans render()');
            return;
        }
        
        console.log('🎨 Début render dans:', this.container);
        this.container.innerHTML = `
            <div class="ai-session-container">
                <div class="ai-session-header">
                    <h2><i class="fas fa-robot"></i> Générateur de Séance IA</h2>
                    <p class="subtitle">Génération intelligente basée sur votre récupération</p>
                </div>
                
                <!-- État musculaire -->
                <div class="section">
                    <h3><i class="fas fa-chart-bar"></i> État Musculaire Actuel</h3>
                    <div id="aiMuscleReadinessContainer" class="muscle-readiness-container">
                        <!-- Sera peuplé par loadMuscleReadinessForAI() -->
                    </div>
                </div>
                
                <!-- Recommandation PPL -->
                <div class="section">
                    <h3><i class="fas fa-target"></i> Recommandation PPL</h3>
                    <div id="pplRecommendationContainer">
                        ${this.renderPPLRecommendation()}
                    </div>
                </div>
                
                <!-- Paramètres génération -->
                <div class="section">
                    <h3><i class="fas fa-cogs"></i> Paramètres</h3>
                    <div class="ai-params-container">
                        ${this.renderParametersUI()}
                    </div>
                </div>
                
                <!-- Actions principales -->
                <div class="ai-actions">
                    <button id="generateSessionBtn" class="btn btn-primary" ${this.isGenerating ? 'disabled' : ''}>
                        <i class="fas fa-magic"></i> Générer Séance
                    </button>
                    <button id="regenerateSessionBtn" class="btn btn-secondary" ${!this.lastGenerated || this.isGenerating ? 'disabled' : ''}>
                        <i class="fas fa-redo"></i> Regénérer
                    </button>
                </div>
                
                <!-- Preview exercices générés -->
                <div id="generatedSessionPreview" class="section" style="display: ${this.lastGenerated ? 'block' : 'none'};">
                    <h3><i class="fas fa-list"></i> Séance Générée</h3>
                    <div id="exercisePreviewContainer">
                        ${this.lastGenerated ? this.renderExercisePreview() : ''}
                    </div>
                    
                    <div class="launch-actions">
                        <button id="launchAISessionBtn" class="btn btn-success">
                            <i class="fas fa-play"></i> Lancer Séance
                        </button>
                        <button id="editAISessionBtn" class="btn btn-secondary">
                            <i class="fas fa-edit"></i> Éditer
                        </button>
                    </div>
                </div>
            </div>
        `;
        console.log('✅ Render terminé');
    }
    
    renderPPLRecommendation() {
        /**
         * Affiche la recommandation PPL avec options override
         */
        
        if (!this.pplRecommendation) {
            return '<p>Chargement recommandation...</p>';
        }
        
        const rec = this.pplRecommendation;
        const categories = PPL_CATEGORIES;
        
        return `
            <div class="ppl-recommendation-card ${rec.confidence > 0.7 ? 'high-confidence' : ''}">
                <div class="ppl-main-recommendation">
                    <div class="ppl-category-display">
                        <span class="ppl-icon">${categories[rec.category]?.icon || '🎯'}</span>
                        <div class="ppl-info">
                            <h4>${categories[rec.category]?.name || rec.category.toUpperCase()}</h4>
                            <p class="ppl-reasoning">${rec.reasoning}</p>
                            <div class="ppl-confidence">
                                Confiance: <strong>${Math.round(rec.confidence * 100)}%</strong>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="ppl-override-options">
                    <h5>Ou forcer une catégorie :</h5>
                    <div class="ppl-alternatives">
                        ${Object.keys(categories).map(ppl => `
                            <button class="ppl-option ${this.params.ppl_override === ppl ? 'selected' : ''}" 
                                    data-ppl="${ppl}" 
                                    onclick="window.aiSessionManager.selectPPL('${ppl}')">
                                ${categories[ppl]?.icon || '🎯'} ${categories[ppl]?.name || ppl}
                                ${rec.alternatives && rec.alternatives[ppl] ? 
                                    `<br><small>${Math.round(rec.alternatives[ppl] * 100)}%</small>` : ''}
                            </button>
                        `).join('')}
                        <button class="ppl-option ${this.params.ppl_override === null ? 'selected' : ''}" 
                                data-ppl="auto"
                                onclick="window.aiSessionManager.selectPPL(null)">
                            🤖 Auto<br><small>Recommandé</small>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderParametersUI() {
        /**
         * Interface paramètres de génération
         */
        
        return `
            <div class="ai-params-grid">
                <!-- Nombre d'exercices -->
                <div class="param-control">
                    <label for="exerciseCountSlider">
                        <i class="fas fa-list"></i> Nombre d'exercices: 
                        <strong id="exerciseCountDisplay">${this.params.target_exercise_count}</strong>
                    </label>
                    <input type="range" 
                           id="exerciseCountSlider"
                           min="3" max="8" step="1" 
                           value="${this.params.target_exercise_count}"
                           onchange="window.aiSessionManager.onParameterChange('target_exercise_count', this.value)">
                    <div class="slider-labels">
                        <span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span>
                    </div>
                </div>
                
                <!-- Exploration vs Favoris -->
                <div class="param-control">
                    <label for="explorationSlider">
                        <i class="fas fa-compass"></i> Exploration: 
                        <strong id="explorationDisplay">${Math.round(this.params.exploration_factor * 100)}%</strong>
                    </label>
                    <input type="range" 
                           id="explorationSlider"
                           min="0" max="1" step="0.1" 
                           value="${this.params.exploration_factor}"
                           onchange="window.aiSessionManager.onParameterChange('exploration_factor', this.value)">
                    <div class="slider-labels">
                        <span>Favoris</span><span>Équilibré</span><span>Nouveaux</span>
                    </div>
                </div>
                
                <!-- Focus manuel groupes musculaires -->
                <div class="param-control full-width">
                    <label><i class="fas fa-bullseye"></i> Focus manuel (optionnel)</label>
                    <div class="muscle-focus-selector">
                        ${['pectoraux', 'dos', 'jambes', 'epaules', 'bras', 'abdominaux'].map(muscle => `
                            <button class="muscle-focus-btn ${this.params.manual_muscle_focus.includes(muscle) ? 'selected' : ''}"
                                    data-muscle="${muscle}"
                                    onclick="window.aiSessionManager.toggleMuscleFocus('${muscle}')">
                                ${muscle.charAt(0).toUpperCase() + muscle.slice(1)}
                            </button>
                        `).join('')}
                    </div>
                    <small class="param-help">Sélectionnez pour cibler des groupes musculaires spécifiques</small>
                </div>
            </div>
        `;
    }
    
    renderExercisePreview() {
        /**
         * Affiche preview des exercices générés
         */
        
        if (!this.lastGenerated || !this.lastGenerated.exercises) {
            return '<p>Aucune séance générée</p>';
        }
        
        const exercises = this.lastGenerated.exercises;
        const pplInfo = PPL_CATEGORIES[this.lastGenerated.ppl_used] || {};
        
        return `
            <div class="generated-session-summary">
                <div class="session-meta">
                    <span class="ppl-badge" style="background-color: ${pplInfo.color || '#3b82f6'};">
                        ${pplInfo.icon || '🎯'} ${this.lastGenerated.ppl_used.toUpperCase()}
                    </span>
                    <span class="quality-score">
                        Score: <strong>${Math.round(this.lastGenerated.quality_score)}%</strong>
                    </span>
                    <span class="exercise-count">
                        ${exercises.length} exercices
                    </span>
                </div>
                
                <div class="exercises-preview-list">
                    ${exercises.map((ex, index) => `
                        <div class="exercise-preview-item" data-exercise-index="${index}">
                            <div class="exercise-number">${index + 1}</div>
                            <div class="exercise-details">
                                <div class="exercise-name">${ex.name}</div>
                                <div class="exercise-params">
                                    ${ex.default_sets || 3} séries × ${ex.default_reps_min || 8}-${ex.default_reps_max || 12} reps
                                    ${ex.equipment_required && ex.equipment_required.length > 0 ? 
                                        `<span class="equipment-tag">${ex.equipment_required[0]}</span>` : ''}
                                </div>
                                <div class="exercise-muscles">
                                    ${(ex.muscle_groups || []).map(muscle => 
                                        `<span class="muscle-tag">${muscle}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            <div class="exercise-actions">
                                <button class="btn-small btn-secondary" 
                                        onclick="window.aiSessionManager.swapExercise(${index})">
                                    <i class="fas fa-exchange-alt"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    async generateSession() {
        /**
         * FONCTION CRITIQUE - Génère séance IA
         * 
         * Appelle votre endpoint backend /api/ai/generate-exercises
         */
        
        if (this.isGenerating) {
            console.log('Génération déjà en cours');
            return;
        }
        
        this.isGenerating = true;
        this.showGeneratingState();
        
        try {
            // Préparer paramètres avec seed aléatoire si pas spécifié
            const generationParams = {
                ...this.params,
                randomness_seed: this.params.randomness_seed || Date.now()
            };
            
            console.log('🎲 Génération avec paramètres:', generationParams);
            
            // Appel votre backend
            const result = await window.apiPost('/api/ai/generate-exercises', {
                user_id: window.currentUser.id,
                params: generationParams
            });
            
            console.log('✅ Génération réussie:', result);
            
            this.lastGenerated = result;
            
            // Mise à jour interface
            this.updateGeneratedSessionDisplay();
            window.showToast(`Séance ${result.ppl_used.toUpperCase()} générée ! Score: ${Math.round(result.quality_score)}%`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur génération IA:', error);
            window.showToast('Erreur lors de la génération', 'error');
            this.renderError(error);
            
        } finally {
            this.isGenerating = false;
            this.updateButtonStates();
        }
    }
    
    async regenerateSession() {
        /**
         * Regénère avec nouveau seed aléatoire
         */
        
        if (!this.lastGenerated) {
            await this.generateSession();
            return;
        }
        
        // Nouveau seed pour variabilité
        this.params.randomness_seed = Date.now();
        console.log('🔄 Regénération avec nouveau seed:', this.params.randomness_seed);
        
        await this.generateSession();
    }
    
    async launchAISession() {
        /**
         * FONCTION CRITIQUE - Lance séance avec exercices générés
         * 
         * Réutilise votre logique startProgramWorkout() existante
         */
        
        if (!this.lastGenerated || !this.lastGenerated.exercises) {
            window.showToast('Aucune séance générée à lancer', 'error');
            return;
        }
        
        try {
            console.log('🚀 Lancement séance IA:', this.lastGenerated);
            
            // Créer workout type 'ai' via votre endpoint existant
            const workoutData = {
                type: 'ai',
                ai_session_data: {
                    exercises: this.lastGenerated.exercises,
                    generation_params: this.params,
                    quality_score: this.lastGenerated.quality_score,
                    ppl_category: this.lastGenerated.ppl_used,
                    generated_at: new Date().toISOString()
                }
            };
            
            const response = await window.apiPost(`/api/users/${window.currentUser.id}/workouts`, workoutData);
            console.log('✅ Workout IA créé:', response.workout);
            
            // Initialiser session IA (similaire à votre logique programme)
            window.currentWorkout = response.workout;
            window.currentWorkoutSession = {
                type: 'ai',
                workout: response.workout,
                exercises: this.lastGenerated.exercises,  // Liste prédéfinie comme programme
                aiMetadata: {
                    pplCategory: this.lastGenerated.ppl_used,
                    generationParams: this.params,
                    qualityScore: this.lastGenerated.quality_score
                },
                // RÉUTILISE toutes les propriétés de votre currentWorkoutSession programme
                currentExercise: null,
                currentSetNumber: 1,
                exerciseOrder: 1,
                globalSetCount: 0,
                completedSets: [],
                skipped_exercises: [],
                swaps: [],
                modifications: [],
                totalRestTime: 0,
                totalSetTime: 0,
                startTime: new Date()
            };
            
            // Transition vers interface séance (RÉUTILISE votre showView)
            window.showView('workout');
            await this.setupAIWorkoutInterface();
            
            window.showToast('🤖 Séance IA démarrée !', 'success');
            
        } catch (error) {
            console.error('❌ Erreur lancement séance IA:', error);
            window.showToast('Erreur lors du lancement', 'error');
        }
    }
    
    async setupAIWorkoutInterface() {
        /**
         * Configure interface séance pour exercices IA
         * Réutilise votre logique setupProgramWorkout() existante
         */
        
        try {
            // Préparer exercices format programme (compatible avec votre interface)
            const programExercises = {};
            this.lastGenerated.exercises.forEach((exercise, index) => {
                programExercises[exercise.exercise_id] = {
                    ...exercise,
                    index: index + 1,
                    order: index + 1
                };
            });
            
            // Configurer currentWorkoutSession comme programme
            window.currentWorkoutSession.programExercises = programExercises;
            window.currentWorkoutSession.totalExercisesCount = this.lastGenerated.exercises.length;
            
            // Interface programme (RÉUTILISE votre logique existante)
            const exerciseSelection = document.getElementById('exerciseSelection');
            const programContainer = document.getElementById('programExercisesContainer');
            
            if (exerciseSelection) exerciseSelection.style.display = 'none';
            if (programContainer) programContainer.style.display = 'block';
            
            // Afficher liste exercices IA (adaptation de votre renderProgramExercises)
            this.renderAIProgramExercisesList();
            
            // Sélectionner premier exercice automatiquement
            const firstExercise = this.lastGenerated.exercises[0];
            if (firstExercise && window.selectExercise) {
                // Adapter format pour votre fonction selectExercise
                const exerciseForSelection = {
                    id: firstExercise.exercise_id,
                    name: firstExercise.name,
                    muscle_groups: firstExercise.muscle_groups,
                    equipment_required: firstExercise.equipment_required,
                    default_sets: firstExercise.default_sets,
                    default_reps_min: firstExercise.default_reps_min,
                    default_reps_max: firstExercise.default_reps_max,
                    instructions: firstExercise.instructions
                };
                
                await window.selectExercise(exerciseForSelection);
                console.log('🎯 Premier exercice IA sélectionné:', exerciseForSelection.name);
            }
            
        } catch (error) {
            console.error('❌ Erreur setup interface IA:', error);
            window.showToast('Erreur configuration séance', 'error');
        }
    }
    
    renderAIProgramExercisesList() {
        /**
         * Affiche liste exercices IA dans l'interface programme
         * Adaptation de votre renderProgramExercises() existante
         */
        
        const container = document.getElementById('programExercisesContainer');
        if (!container || !this.lastGenerated) return;
        
        const exercises = this.lastGenerated.exercises;
        
        container.innerHTML = `
            <div class="program-exercises-header">
                <h3>🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}</h3>
                <p>Score qualité: <strong>${Math.round(this.lastGenerated.quality_score)}%</strong></p>
            </div>
            <div class="program-exercises-list">
                ${exercises.map((exercise, index) => `
                    <div class="program-exercise-card ${index === 0 ? 'active' : ''}" 
                         data-exercise-id="${exercise.exercise_id}"
                         onclick="window.selectExercise({
                             id: ${exercise.exercise_id},
                             name: '${exercise.name}',
                             muscle_groups: ${JSON.stringify(exercise.muscle_groups)},
                             default_sets: ${exercise.default_sets}
                         })">
                        <div class="exercise-number">${index + 1}</div>
                        <div class="exercise-info">
                            <div class="exercise-name">${exercise.name}</div>
                            <div class="exercise-params">
                                ${exercise.default_sets} × ${exercise.default_reps_min}-${exercise.default_reps_max}
                            </div>
                        </div>
                        <div class="exercise-status">
                            <i class="fas fa-chevron-right"></i>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    // ===== EVENT HANDLERS =====
    
    onParameterChange(paramName, value) {
        /**
         * Gestionnaire changement paramètres
         */
        
        // Conversion types
        if (paramName === 'target_exercise_count') {
            this.params[paramName] = parseInt(value);
            document.getElementById('exerciseCountDisplay').textContent = value;
        } else if (paramName === 'exploration_factor') {
            this.params[paramName] = parseFloat(value);
            document.getElementById('explorationDisplay').textContent = Math.round(value * 100) + '%';
        }
        
        console.log(`📊 Paramètre ${paramName} mis à jour:`, this.params[paramName]);
        
        // Invalider génération précédente si changement significatif
        if (this.lastGenerated && (paramName === 'target_exercise_count' || paramName === 'exploration_factor')) {
            this.markGenerationOutdated();
        }
    }
    
    selectPPL(ppl) {
        /**
         * Sélectionne catégorie PPL (auto ou override)
         */
        
        this.params.ppl_override = ppl; // null pour auto
        
        // Mettre à jour affichage sélection
        document.querySelectorAll('.ppl-option').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        const selectedBtn = document.querySelector(`[data-ppl="${ppl || 'auto'}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
        }
        
        console.log('🎯 PPL sélectionnée:', ppl || 'auto');
        
        // Invalider génération précédente
        if (this.lastGenerated) {
            this.markGenerationOutdated();
        }
    }
    
    toggleMuscleFocus(muscle) {
        /**
         * Toggle focus manuel muscle
         */
        
        const index = this.params.manual_muscle_focus.indexOf(muscle);
        
        if (index > -1) {
            // Retirer du focus
            this.params.manual_muscle_focus.splice(index, 1);
        } else {
            // Ajouter au focus
            this.params.manual_muscle_focus.push(muscle);
        }
        
        // Mettre à jour affichage
        const btn = document.querySelector(`[data-muscle="${muscle}"]`);
        if (btn) {
            btn.classList.toggle('selected', this.params.manual_muscle_focus.includes(muscle));
        }
        
        console.log('🎯 Focus muscles:', this.params.manual_muscle_focus);
        
        // Invalider génération précédente
        if (this.lastGenerated) {
            this.markGenerationOutdated();
        }
    }
    
    bindEventListeners() {
        /**
         * Bind événements interface
         */
        
        // Boutons principaux
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        const launchBtn = document.getElementById('launchAISessionBtn');
        
        if (generateBtn) {
            generateBtn.addEventListener('click', this.generateSession);
        }
        
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', this.regenerateSession);
        }
        
        if (launchBtn) {
            launchBtn.addEventListener('click', this.launchAISession);
        }
        
        console.log('🔗 Event listeners AI bindés');
    }
    
    // ===== MÉTHODES UTILITAIRES =====
    
    showGeneratingState() {
        /**
         * Affiche état génération en cours
         */
        
        const generateBtn = document.getElementById('generateSessionBtn');
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...';
            generateBtn.disabled = true;
        }
        
        // Masquer preview précédente
        const preview = document.getElementById('generatedSessionPreview');
        if (preview) {
            preview.style.display = 'none';
        }
    }
    
    updateGeneratedSessionDisplay() {
        /**
         * Met à jour affichage après génération réussie
         */
        
        const previewContainer = document.getElementById('exercisePreviewContainer');
        const previewSection = document.getElementById('generatedSessionPreview');
        
        if (previewContainer && this.lastGenerated) {
            previewContainer.innerHTML = this.renderExercisePreview();
        }
        
        if (previewSection) {
            previewSection.style.display = 'block';
        }
        
        this.updateButtonStates();
    }
    
    updateButtonStates() {
        /**
         * Met à jour état des boutons
         */
        
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Générer Séance';
            generateBtn.disabled = false;
        }
        
        if (regenerateBtn) {
            regenerateBtn.disabled = !this.lastGenerated;
        }
    }
    
    markGenerationOutdated() {
        /**
         * Marque génération comme obsolète après changement paramètres
         */
        
        const preview = document.getElementById('generatedSessionPreview');
        if (preview && this.lastGenerated) {
            preview.classList.add('outdated');
            
            // Ajouter message obsolète
            let outdatedMsg = preview.querySelector('.outdated-message');
            if (!outdatedMsg) {
                outdatedMsg = document.createElement('div');
                outdatedMsg.className = 'outdated-message';
                outdatedMsg.innerHTML = '⚠️ Paramètres modifiés - Regénérez pour actualiser';
                preview.insertBefore(outdatedMsg, preview.firstChild);
            }
        }
    }
    
    renderError(error) {
        /**
         * Affiche erreur génération
         */
        
        const previewContainer = document.getElementById('exercisePreviewContainer');
        if (previewContainer) {
            previewContainer.innerHTML = `
                <div class="error-state">
                    <div class="error-icon"><i class="fas fa-exclamation-triangle"></i></div>
                    <h4>Erreur de génération</h4>
                    <p>Impossible de générer la séance avec ces paramètres.</p>
                    <button class="btn btn-primary" onclick="window.aiSessionManager.generateSession()">
                        Réessayer
                    </button>
                </div>
            `;
        }
    }
    
    renderFallbackMuscleReadiness() {
        /**
         * Affichage fallback si muscle readiness indisponible
         */
        
        const container = document.getElementById('aiMuscleReadinessContainer');
        if (container) {
            container.innerHTML = `
                <div class="muscle-readiness-fallback">
                    <p><i class="fas fa-info-circle"></i> État musculaire indisponible</p>
                    <small>La génération utilisera des valeurs par défaut</small>
                </div>
            `;
        }
    }



    async launchAISession() {
        /**
         * Lance séance IA en utilisant l'interface classique
         * 
         * Utilise même workflow que startProgramWorkout() mais avec exercices IA
         */
        
        if (!this.lastGenerated || !this.lastGenerated.exercises) {
            window.showToast('Aucune séance générée à lancer', 'warning');
            return;
        }
        
        try {
            console.log('🚀 Lancement séance IA avec', this.lastGenerated.exercises.length, 'exercices');
            
            // 1. Nettoyer état workout existant (comme startProgramWorkout)
            window.clearWorkoutState();
            
            // 2. Créer workout backend avec type 'ai'
            const workoutData = {
                type: 'ai',
                ai_session_data: {
                    exercises: this.lastGenerated.exercises,
                    generation_params: this.params,
                    ppl_used: this.lastGenerated.ppl_used,
                    quality_score: this.lastGenerated.quality_score
                }
            };
            
            const response = await window.apiPost(`/api/users/${window.currentUser.id}/workouts`, workoutData);
            window.currentWorkout = response.workout;
            
            // 3. Préparer currentWorkoutSession (format program-like)
            window.currentWorkoutSession = {
                type: 'ai',
                workout: response.workout,
                exercises: this.lastGenerated.exercises,
                aiParameters: this.params,
                pplUsed: this.lastGenerated.ppl_used,
                qualityScore: this.lastGenerated.quality_score,
                
                // États séance standards (RÉUTILISE EXISTANT)
                currentExercise: null,
                currentSetNumber: 1,
                exerciseOrder: 1,
                globalSetCount: 0,
                sessionFatigue: 3,
                completedSets: [],
                totalRestTime: 0,
                totalSetTime: 0,
                startTime: new Date(),
                
                // Support swap/skip comme programme
                skipped_exercises: [],
                swaps: [],
                modifications: [],
                pendingSwap: null,
                
                // Métadonnées IA
                session_metadata: {
                    source: 'ai_generation',
                    generation_timestamp: this.lastGenerated.generation_metadata?.generated_at,
                    ppl_recommendation: this.lastGenerated.ppl_recommendation
                }
            };
            
            // 4. Préparer structure exercices format programme
            window.currentWorkoutSession.programExercises = {};
            this.lastGenerated.exercises.forEach((exercise, index) => {
                window.currentWorkoutSession.programExercises[exercise.exercise_id] = {
                    ...exercise,
                    index: index,
                    status: 'planned'
                };
            });
            
            // 5. Transition vers interface séance (RÉUTILISE WORKFLOW PROGRAMME)
            window.showView('workout');
            await this.setupAIWorkoutInterface();
            
            window.showToast(`Séance ${this.lastGenerated.ppl_used.toUpperCase()} lancée !`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur lancement séance IA:', error);
            window.showToast('Erreur lors du lancement de la séance', 'error');
        }
    }
    
    async setupAIWorkoutInterface() {
        /**
         * Configure interface séance pour exercices IA
         * 
         * Réutilise setupProgramWorkout() existant mais adapte pour IA
         */
        
        try {
            // Cacher sélection d'exercice (pas besoin en mode IA)
            const exerciseSelection = document.getElementById('exerciseSelection');
            if (exerciseSelection) {
                exerciseSelection.style.display = 'none';
            }
            
            // Afficher container exercices programme (réutilise existant)
            const programContainer = document.getElementById('programExercisesContainer');
            if (programContainer) {
                programContainer.style.display = 'block';
                
                // Générer HTML exercices (format compatible programme)
                const exercisesHTML = this.lastGenerated.exercises.map((exercise, index) => {
                    const isActive = index === 0; // Premier exercice actif
                    
                    return `
                        <div class="program-exercise-item ${isActive ? 'active current-exercise' : ''}" 
                             data-exercise-id="${exercise.exercise_id}"
                             data-exercise-index="${index}"
                             onclick="selectExerciseFromProgram(${exercise.exercise_id}, ${index})">
                            
                            <div class="exercise-order">${exercise.order_in_session}</div>
                            
                            <div class="exercise-info">
                                <div class="exercise-name">${exercise.name}</div>
                                <div class="exercise-params">
                                    ${exercise.default_sets}×${exercise.default_reps_min}-${exercise.default_reps_max}
                                    ${exercise.equipment_required ? 
                                        ` • ${exercise.equipment_required[0]}` : ''}
                                </div>
                                <div class="exercise-muscles">
                                    ${exercise.muscle_groups.map(muscle => 
                                        `<span class="muscle-tag">${muscle}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            
                            <div class="exercise-status">
                                ${exercise.is_favorite ? '⭐' : ''}
                                <span class="exercise-score">Score: ${exercise.selection_score || 'N/A'}</span>
                            </div>
                            
                            <div class="exercise-actions">
                                <button class="btn-small btn-secondary" 
                                        onclick="event.stopPropagation(); initiateSwap(${exercise.exercise_id}, ${index})">
                                    <i class="fas fa-exchange-alt"></i>
                                </button>
                                <button class="btn-small btn-warning"
                                        onclick="event.stopPropagation(); skipExerciseFromProgram(${index})">
                                    <i class="fas fa-forward"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
                
                programContainer.innerHTML = exercisesHTML;
            }
            
            // Auto-sélectionner premier exercice (comme programme)
            if (this.lastGenerated.exercises.length > 0) {
                const firstExercise = this.lastGenerated.exercises[0];
                await window.selectExerciseFromProgram(firstExercise.exercise_id, 0);
            }
            
            // Afficher métadonnées séance IA
            this.displayAISessionMetadata();
            
        } catch (error) {
            console.error('❌ Erreur setup interface IA:', error);
        }
    }
    
    displayAISessionMetadata() {
        /**
         * Affiche informations contextuelles séance IA
         */
        
        const workoutHeader = document.getElementById('workoutHeader');
        if (workoutHeader && this.lastGenerated) {
            // Ajouter badge IA et info PPL
            let metadataHTML = `
                <div class="ai-session-badge">
                    <span class="ai-badge">🤖 IA</span>
                    <span class="ppl-badge">${this.lastGenerated.ppl_used.toUpperCase()}</span>
                    <span class="quality-score">Score: ${Math.round(this.lastGenerated.quality_score)}%</span>
                </div>
            `;
            
            if (this.lastGenerated.ppl_recommendation?.reasoning) {
                metadataHTML += `
                    <div class="ai-reasoning">
                        <small><i class="fas fa-info-circle"></i> ${this.lastGenerated.ppl_recommendation.reasoning}</small>
                    </div>
                `;
            }
            
            // Injecter avant le contenu existant
            workoutHeader.insertAdjacentHTML('afterbegin', metadataHTML);
        }
    }

}



// Exposer la classe globalement
window.AISessionManager = AISessionManager;