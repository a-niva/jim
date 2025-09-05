// frontend/ai-session-manager.js

class AISessionManager {
    constructor(containerId = 'ai-session') {
        this.containerId = containerId;
        this.container = null;
        
        // Paramètres de génération
        this.params = {
            ppl_override: null,
            exploration_factor: 0.5,
            target_exercise_count: 5,
            manual_muscle_focus: [],
            randomness_seed: null
        };
        
        // État
        this.lastGenerated = null;
        this.pplRecommendation = null;
        this.isGenerating = false;
        
        // Bind methods
        this.generateSession = this.generateSession.bind(this);
        this.regenerateSession = this.regenerateSession.bind(this);
        this.launchAISession = this.launchAISession.bind(this);
    }
    
    async initialize() {
        console.log('🤖 Initialisation AISessionManager');
        
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container ${this.containerId} introuvable`);
            return false;
        }
        
        // Charger recommandation PPL
        await this.loadPPLRecommendation();
        
        // Render interface
        this.render();
        
        // Bind events
        this.bindEventListeners();
        
        // Charger état musculaire
        await this.loadMuscleReadinessForAI();
        
        // Injecter CSS une seule fois
        this.injectStyles();
        
        return true;
    }
    
    async loadPPLRecommendation() {
        try {
            const response = await window.apiGet(`/api/ai/ppl-recommendation/${window.currentUser.id}`);
            this.pplRecommendation = response;
            console.log('📊 Recommandation PPL:', response);
        } catch (error) {
            console.warn('Erreur chargement PPL:', error);
            this.pplRecommendation = {
                category: 'push',
                confidence: 0.7,
                reasoning: 'Recommandation par défaut'
            };
        }
    }
    
    async loadMuscleReadinessForAI() {
        // Réutilise votre fonction existante avec vérification
        if (typeof window.loadMuscleReadiness === 'function') {
            await window.loadMuscleReadiness();
        } else {
            console.warn('Fonction loadMuscleReadiness non disponible');
        }
    }
    
    render() {
        if (!this.container) return;
        
        this.container.innerHTML = `
            <div class="ai-session-container">
                <div class="ai-header">
                    <h2><i class="fas fa-robot"></i> Générateur de Séance IA</h2>
                    <p class="subtitle">Génération intelligente basée sur votre récupération</p>
                </div>
                
                <!-- État musculaire -->
                <div class="section">
                    <h3><i class="fas fa-chart-bar"></i> État Musculaire</h3>
                    <div id="aiMuscleReadinessContainer" class="muscle-readiness-container">
                        <!-- Peuplé par loadMuscleReadiness() -->
                    </div>
                </div>
                
                <!-- Recommandation PPL -->
                <div class="section">
                    <h3><i class="fas fa-target"></i> Recommandation PPL</h3>
                    <div id="pplRecommendationContainer">
                        ${this.renderPPLRecommendation()}
                    </div>
                </div>
                
                <!-- Paramètres -->
                <div class="section">
                    <h3><i class="fas fa-cogs"></i> Paramètres</h3>
                    <div class="ai-params-container">
                        ${this.renderParametersUI()}
                    </div>
                </div>
                
                <!-- Actions -->
                <div class="ai-actions">
                    <button id="generateSessionBtn" class="btn btn-primary">
                        <i class="fas fa-magic"></i> Générer Séance
                    </button>
                    <button id="regenerateSessionBtn" class="btn btn-secondary" disabled>
                        <i class="fas fa-redo"></i> Regénérer
                    </button>
                </div>
                
                <!-- Preview séance -->
                <div id="generatedSessionPreview" class="section" style="display: none;">
                    <h3><i class="fas fa-list"></i> Séance Générée</h3>
                    <div id="exercisePreviewContainer"></div>
                    <button id="launchAISessionBtn" class="btn btn-success">
                        <i class="fas fa-play"></i> Lancer la Séance
                    </button>
                </div>
            </div>
        `;
    }
    
    renderPPLRecommendation() {
        if (!this.pplRecommendation) {
            return '<div class="loading">Chargement...</div>';
        }
        
        const categories = {
            'push': { icon: '💪', label: 'Push (Pousser)' },
            'pull': { icon: '🎣', label: 'Pull (Tirer)' },
            'legs': { icon: '🦵', label: 'Legs (Jambes)' }
        };
        
        return `
            <div class="ppl-recommendation">
                <div class="ppl-cards">
                    ${Object.keys(categories).map(cat => `
                        <div class="ppl-card ${cat === this.pplRecommendation.category ? 'recommended' : ''}"
                             onclick="window.aiSessionManager.selectPPL('${cat}')">
                            <div class="ppl-icon">${categories[cat].icon}</div>
                            <div class="ppl-label">${categories[cat].label}</div>
                            ${cat === this.pplRecommendation.category ? 
                                `<div class="confidence">${Math.round(this.pplRecommendation.confidence * 100)}%</div>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="ppl-reasoning">
                    <i class="fas fa-info-circle"></i> ${this.pplRecommendation.reasoning}
                </div>
            </div>
        `;
    }
    
    renderParametersUI() {
        return `
            <div class="param-group">
                <label>Nombre d'exercices: <span id="exerciseCountDisplay">${this.params.target_exercise_count}</span></label>
                <input type="range" min="3" max="8" value="${this.params.target_exercise_count}"
                       onchange="window.aiSessionManager.onParameterChange('target_exercise_count', this.value)">
            </div>
            
            <div class="param-group">
                <label>Exploration: <span id="explorationDisplay">${Math.round(this.params.exploration_factor * 100)}%</span></label>
                <input type="range" min="0" max="100" value="${this.params.exploration_factor * 100}"
                       onchange="window.aiSessionManager.onParameterChange('exploration_factor', this.value/100)">
                <div class="param-help">
                    <span>Favoris</span>
                    <span>Nouveaux</span>
                </div>
            </div>
            
            <div class="param-group">
                <label>Focus musculaire (optionnel)</label>
                <select multiple id="muscleFocusSelect" onchange="window.aiSessionManager.onManualMuscleFocus()">
                    <option value="">Aucun focus spécifique</option>
                    <option value="pectoraux">Pectoraux</option>
                    <option value="dos">Dos</option>
                    <option value="jambes">Jambes</option>
                    <option value="epaules">Épaules</option>
                    <option value="bras">Bras</option>
                    <option value="abdominaux">Abdominaux</option>
                </select>
            </div>
        `;
    }
    
    async generateSession() {
        if (this.isGenerating) return;
        
        this.isGenerating = true;
        this.showGeneratingState();
        
        try {
            const generationParams = {
                ...this.params,
                randomness_seed: this.params.randomness_seed || Date.now()
            };
            
            console.log('🎲 Génération avec paramètres:', generationParams);
            
            const result = await window.apiPost('/api/ai/generate-exercises', {
                user_id: window.currentUser.id,
                params: generationParams
            });
            
            console.log('✅ Génération réussie:', result);
            
            this.lastGenerated = result;
            this.updateGeneratedSessionDisplay();
            
            window.showToast(`Séance ${result.ppl_used.toUpperCase()} générée !`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur génération:', error);
            window.showToast('Erreur lors de la génération', 'error');
        } finally {
            this.isGenerating = false;
            this.updateButtonStates();
        }
    }
    
    async regenerateSession() {
        if (!this.lastGenerated) return;
        
        // Nouveau seed pour variabilité
        this.params.randomness_seed = Date.now();
        await this.generateSession();
    }
    
    async launchAISession() {
        if (!this.lastGenerated || !this.lastGenerated.exercises) {
            window.showToast('Aucune séance générée', 'warning');
            return;
        }
        
        try {
            console.log('🚀 Lancement séance IA');
            
            // 1. Nettoyer état existant (avec vérification)
            if (typeof window.clearWorkoutState === 'function') {
                window.clearWorkoutState();
            } else {
                console.warn('clearWorkoutState non disponible');
            }
            
            // 2. Créer workout
            const workoutData = {
                type: 'free',
                session_metadata: {
                    ai_generated: true,
                    ppl_category: this.lastGenerated.ppl_used,
                    quality_score: this.lastGenerated.quality_score,
                    generation_params: this.params
                }
            };
            
            const response = await window.apiPost(`/api/users/${window.currentUser.id}/workouts`, workoutData);
            window.currentWorkout = response.workout;
            
            // 3. Stocker la queue d'exercices
            window.aiExerciseQueue = this.lastGenerated.exercises.map(ex => ex.exercise_id);
            window.aiExerciseIndex = 0;
            
            // 4. Aller à la vue workout (avec vérification)
            if (typeof window.showView === 'function') {
                window.showView('workout');
            } else {
                console.error('showView non disponible');
                return;
            }
            
            // 5. Afficher la liste des exercices AI
            this.showAIExercisesList();
            
            // 6. Sélectionner le premier exercice après stabilisation
            setTimeout(async () => {
                await this.selectNextAIExercise();
                
                // 7. Démarrage auto countdown si mobile (avec vérifications)
                const isMobile = window.isMobile || /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
                if (isMobile && typeof window.showCountdown === 'function') {
                    setTimeout(() => window.showCountdown(), 1000);
                }
            }, 500);
            
            window.showToast('Séance lancée !', 'success');
            
        } catch (error) {
            console.error('❌ Erreur lancement:', error);
            window.showToast('Erreur lors du lancement', 'error');
        }
    }
    
    showAIExercisesList() {
        // Afficher la liste des exercices dans l'interface de séance
        const container = document.getElementById('sessionExercisesContainer');
        if (!container || !this.lastGenerated) return;
        
        container.innerHTML = `
            <div class="ai-exercises-header">
                <h3>🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}</h3>
                <div class="session-score">Score: ${Math.round(this.lastGenerated.quality_score)}%</div>
            </div>
            <div class="ai-exercises-list">
                ${this.lastGenerated.exercises.map((exercise, index) => `
                    <div class="ai-exercise-item ${index === 0 ? 'active' : ''}" 
                         data-exercise-index="${index}"
                         data-exercise-id="${exercise.exercise_id}">
                        <div class="exercise-number">${exercise.order_in_session}</div>
                        <div class="exercise-info">
                            <div class="exercise-name">${exercise.name}</div>
                            <div class="exercise-muscles">${exercise.muscle_groups.join(', ')}</div>
                        </div>
                        <div class="exercise-actions">
                            <button onclick="window.aiSessionManager.swapExercise(${index})" 
                                    class="btn-swap" title="Changer">⇄</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    async selectNextAIExercise() {
        if (!window.aiExerciseQueue || window.aiExerciseIndex >= window.aiExerciseQueue.length) {
            window.showToast('Séance terminée !', 'success');
            
            // Terminer la séance (avec vérification)
            if (typeof window.completeWorkout === 'function') {
                window.completeWorkout();
            } else if (typeof window.endWorkout === 'function') {
                window.endWorkout();
            }
            return;
        }
        
        const exerciseId = window.aiExerciseQueue[window.aiExerciseIndex];
        
        try {
            // Récupérer les détails de l'exercice
            const exercise = await window.apiGet(`/api/exercises/${exerciseId}`);
            
            // Sélectionner avec la fonction existante (avec vérification)
            if (typeof window.selectExercise === 'function') {
                await window.selectExercise(exercise);
            } else {
                console.error('selectExercise non disponible');
                return;
            }
            
            // Mettre à jour l'affichage
            document.querySelectorAll('.ai-exercise-item').forEach(item => {
                item.classList.remove('active', 'current');
            });
            
            const currentItem = document.querySelector(`[data-exercise-index="${window.aiExerciseIndex}"]`);
            if (currentItem) {
                currentItem.classList.add('active', 'current');
            }
            
            window.aiExerciseIndex++;
            
        } catch (error) {
            console.error('Erreur sélection exercice:', error);
            // Passer au suivant en cas d'erreur
            window.aiExerciseIndex++;
            await this.selectNextAIExercise();
        }
    }
    
    async swapExercise(exerciseIndex) {
        // Fonctionnalité de swap - à implémenter selon vos besoins
        window.showToast('Swap exercice - À implémenter', 'info');
    }
    
    // === Event Handlers ===
    
    selectPPL(ppl) {
        this.params.ppl_override = (ppl === this.pplRecommendation.category) ? null : ppl;
        console.log('PPL sélectionnée:', ppl);
        this.render();
        this.bindEventListeners();
    }
    
    onParameterChange(paramName, value) {
        this.params[paramName] = paramName === 'target_exercise_count' ? parseInt(value) : value;
        
        // Mettre à jour l'affichage
        if (paramName === 'exploration_factor') {
            const display = document.getElementById('explorationDisplay');
            if (display) display.textContent = `${Math.round(value * 100)}%`;
        } else if (paramName === 'target_exercise_count') {
            const display = document.getElementById('exerciseCountDisplay');
            if (display) display.textContent = value;
        }
    }
    
    onManualMuscleFocus() {
        const select = document.getElementById('muscleFocusSelect');
        if (!select) return;
        
        const selected = Array.from(select.selectedOptions).map(opt => opt.value).filter(v => v);
        this.params.manual_muscle_focus = selected;
        console.log('Focus muscles:', selected);
    }
    
    bindEventListeners() {
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        const launchBtn = document.getElementById('launchAISessionBtn');
        
        if (generateBtn) {
            generateBtn.onclick = this.generateSession;
        }
        
        if (regenerateBtn) {
            regenerateBtn.onclick = this.regenerateSession;
        }
        
        if (launchBtn) {
            launchBtn.onclick = this.launchAISession;
        }
    }
    
    showGeneratingState() {
        const btn = document.getElementById('generateSessionBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...';
            btn.disabled = true;
        }
    }
    
    updateButtonStates() {
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
    
    updateGeneratedSessionDisplay() {
        const container = document.getElementById('exercisePreviewContainer');
        const preview = document.getElementById('generatedSessionPreview');
        
        if (!container || !this.lastGenerated) return;
        
        container.innerHTML = `
            <div class="exercise-preview-list">
                ${this.lastGenerated.exercises.map(exercise => `
                    <div class="exercise-preview-item">
                        <div class="preview-number">${exercise.order_in_session}</div>
                        <div class="preview-content">
                            <div class="preview-name">${exercise.name}</div>
                            <div class="preview-details">
                                <span>${exercise.muscle_groups.join(', ')}</span>
                                <span>${exercise.default_sets} séries</span>
                                <span>${exercise.default_reps_min}-${exercise.default_reps_max} reps</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="session-metadata">
                <div class="metadata-item">
                    <i class="fas fa-trophy"></i> Score: ${Math.round(this.lastGenerated.quality_score)}%
                </div>
                <div class="metadata-item">
                    <i class="fas fa-dumbbell"></i> ${this.lastGenerated.exercises.length} exercices
                </div>
                <div class="metadata-item">
                    <i class="fas fa-clock"></i> ~${this.lastGenerated.exercises.length * 10} minutes
                </div>
            </div>
        `;
        
        if (preview) {
            preview.style.display = 'block';
        }
    }
    
    injectStyles() {
        // Vérifier si les styles sont déjà injectés
        if (document.getElementById('ai-session-styles')) {
            return;
        }
        
        const style = document.createElement('style');
        style.id = 'ai-session-styles';
        style.textContent = `
            .ai-session-container {
                padding: 1rem;
                max-width: 800px;
                margin: 0 auto;
            }
            
            .ai-header {
                text-align: center;
                margin-bottom: 2rem;
            }
            
            .ai-header h2 {
                color: #667eea;
                margin-bottom: 0.5rem;
            }
            
            .subtitle {
                color: #718096;
                font-size: 0.9rem;
            }
            
            .section {
                background: white;
                border-radius: 12px;
                padding: 1.5rem;
                margin-bottom: 1.5rem;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            
            .section h3 {
                margin-bottom: 1rem;
                color: #2d3748;
            }
            
            .ppl-cards {
                display: flex;
                gap: 1rem;
                margin-bottom: 1rem;
            }
            
            .ppl-card {
                flex: 1;
                padding: 1rem;
                border: 2px solid #e2e8f0;
                border-radius: 8px;
                text-align: center;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .ppl-card:hover {
                border-color: #667eea;
                transform: translateY(-2px);
            }
            
            .ppl-card.recommended {
                border-color: #48bb78;
                background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%);
            }
            
            .ppl-icon {
                font-size: 2rem;
                margin-bottom: 0.5rem;
            }
            
            .confidence {
                color: #48bb78;
                font-weight: bold;
                margin-top: 0.5rem;
            }
            
            .ppl-reasoning {
                padding: 0.75rem;
                background: #f7fafc;
                border-radius: 6px;
                color: #4a5568;
                font-size: 0.9rem;
            }
            
            .ai-params-container {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
            }
            
            .param-group {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            
            .param-group label {
                font-weight: 600;
                color: #4a5568;
            }
            
            .param-group input[type="range"] {
                width: 100%;
            }
            
            .param-help {
                display: flex;
                justify-content: space-between;
                font-size: 0.8rem;
                color: #a0aec0;
            }
            
            .ai-actions {
                display: flex;
                gap: 1rem;
                justify-content: center;
                margin: 2rem 0;
            }
            
            .btn {
                padding: 0.75rem 2rem;
                border-radius: 8px;
                border: none;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: white;
            }
            
            .btn-primary:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }
            
            .btn-secondary {
                background: #718096;
                color: white;
            }
            
            .btn-success {
                background: linear-gradient(135deg, #48bb78, #38a169);
                color: white;
                width: 100%;
                margin-top: 1rem;
            }
            
            .btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .exercise-preview-list {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }
            
            .exercise-preview-item {
                display: flex;
                align-items: center;
                padding: 0.75rem;
                background: #f7fafc;
                border-radius: 8px;
                transition: all 0.2s ease;
            }
            
            .exercise-preview-item:hover {
                background: #edf2f7;
                transform: translateX(5px);
            }
            
            .preview-number {
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #667eea;
                color: white;
                border-radius: 50%;
                font-weight: bold;
                margin-right: 1rem;
            }
            
            .preview-content {
                flex: 1;
            }
            
            .preview-name {
                font-weight: 600;
                margin-bottom: 0.25rem;
            }
            
            .preview-details {
                font-size: 0.85rem;
                color: #718096;
                display: flex;
                gap: 1rem;
            }
            
            .session-metadata {
                display: flex;
                justify-content: space-around;
                margin-top: 1.5rem;
                padding-top: 1.5rem;
                border-top: 1px solid #e2e8f0;
            }
            
            .metadata-item {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                color: #4a5568;
                font-size: 0.9rem;
            }
            
            .ai-exercises-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem;
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: white;
                border-radius: 8px 8px 0 0;
            }
            
            .session-score {
                background: rgba(255,255,255,0.2);
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
                font-size: 0.9rem;
            }
            
            .ai-exercises-list {
                display: flex;
                flex-direction: column;
                background: white;
                border-radius: 0 0 8px 8px;
                padding: 0.5rem;
            }
            
            .ai-exercise-item {
                display: flex;
                align-items: center;
                padding: 1rem;
                border-radius: 8px;
                transition: all 0.2s ease;
                cursor: pointer;
            }
            
            .ai-exercise-item:hover {
                background: #f7fafc;
            }
            
            .ai-exercise-item.active {
                background: linear-gradient(135deg, #f0f4ff, #e6edff);
                border-left: 3px solid #667eea;
            }
            
            .ai-exercise-item.current {
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.02); }
            }
            
            .exercise-actions {
                display: flex;
                gap: 0.5rem;
            }
            
            .btn-swap {
                padding: 0.5rem;
                background: #718096;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .btn-swap:hover {
                background: #4a5568;
                transform: rotate(180deg);
            }
        `;
        
        document.head.appendChild(style);
    }
}

// === OVERRIDES GLOBAUX ===

// Override pour navigation automatique entre exercices AI
if (window.completeExercise) {
    const originalComplete = window.completeExercise;
    window.completeExercise = async function() {
        await originalComplete.apply(this, arguments);
        
        // Si séance AI, passer au suivant automatiquement
        if (window.aiExerciseQueue && window.aiExerciseIndex < window.aiExerciseQueue.length) {
            await window.aiSessionManager?.selectNextAIExercise();
        }
    };
}

// Override pour skip exercice
if (window.skipExercise) {
    const originalSkip = window.skipExercise;
    window.skipExercise = async function(exerciseId, reason) {
        await originalSkip.apply(this, arguments);
        
        // Si séance AI, passer au suivant
        if (window.aiExerciseQueue) {
            await window.aiSessionManager?.selectNextAIExercise();
        }
    };
}

// Exposer globalement
window.AISessionManager = AISessionManager;