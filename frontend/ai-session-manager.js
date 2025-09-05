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
            manual_muscle_focus: [],  // Max 3 muscles
            randomness_seed: null
        };
        
        // État
        this.lastGenerated = null;
        this.pplRecommendation = null;
        this.isGenerating = false;
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
        
        // Render interface (SANS l'encart état musculaire)
        this.render();
        
        // Bind events
        this.bindEventListeners();
        
        return true;
    }
    
    async loadPPLRecommendation() {
        try {
            if (typeof window.apiGet !== 'function') {
                console.error('apiGet non disponible');
                this.setDefaultPPL();
                return;
            }
            
            const response = await window.apiGet(`/api/ai/ppl-recommendation/${window.currentUser.id}`);
            this.pplRecommendation = response;
            console.log('📊 Recommandation PPL:', response);
        } catch (error) {
            console.warn('Erreur chargement PPL:', error);
            this.setDefaultPPL();
        }
    }
    
    setDefaultPPL() {
        this.pplRecommendation = {
            category: 'push',
            confidence: 0.7,
            reasoning: 'Recommandation par défaut'
        };
    }
    
    render() {
        if (!this.container) return;
        
        // Interface SIMPLIFIÉE sans l'encart d'état musculaire
        this.container.innerHTML = `
            <div class="container">
                <div class="welcome-message" style="text-align: center; margin-bottom: 2rem;">
                    <h2 style="color: #667eea; font-size: 2rem;">
                        <i class="fas fa-robot"></i> Générateur de Séance IA
                    </h2>
                    <p style="color: #94a3b8;">Génération intelligente basée sur votre récupération</p>
                </div>
                
                <!-- Recommandation PPL directement visible -->
                <div class="section" style="background: #1e293b; padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem;">
                    <h3 style="color: #f1f5f9; margin-bottom: 1rem;">
                        <i class="fas fa-target"></i> Recommandation PPL
                    </h3>
                    <div id="pplRecommendationContainer">
                        ${this.renderPPLRecommendation()}
                    </div>
                </div>
                
                <!-- Paramètres -->
                <div class="section" style="background: #1e293b; padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem;">
                    <h3 style="color: #f1f5f9; margin-bottom: 1rem;">
                        <i class="fas fa-cogs"></i> Paramètres
                    </h3>
                    <div class="ai-params-grid">
                        ${this.renderParametersUI()}
                    </div>
                </div>
                
                <!-- Actions -->
                <div class="actions-container" style="display: flex; gap: 1rem; justify-content: center; margin: 2rem 0;">
                    <button id="generateSessionBtn" class="btn" 
                            style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 0.75rem 2rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer;">
                        <i class="fas fa-magic"></i> Générer Séance
                    </button>
                    <button id="regenerateSessionBtn" class="btn" disabled
                            style="background: #475569; color: white; padding: 0.75rem 2rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer;">
                        <i class="fas fa-redo"></i> Regénérer
                    </button>
                </div>
                
                <!-- Preview séance -->
                <div id="generatedSessionPreview" class="section" style="display: none; background: #1e293b; padding: 1.5rem; border-radius: 12px;">
                    <h3 style="color: #f1f5f9; margin-bottom: 1rem;">
                        <i class="fas fa-list"></i> Séance Générée
                    </h3>
                    <div id="exercisePreviewContainer"></div>
                    <button id="launchAISessionBtn" class="btn" 
                            style="width: 100%; margin-top: 1rem; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 0.75rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer;">
                        <i class="fas fa-play"></i> Lancer la Séance
                    </button>
                </div>
            </div>
        `;
    }
    
    renderPPLRecommendation() {
        if (!this.pplRecommendation) {
            return '<div class="loading-spinner"></div>';
        }
        
        const categories = {
            'push': { icon: '💪', label: 'Push (Pousser)' },
            'pull': { icon: '🎣', label: 'Pull (Tirer)' },
            'legs': { icon: '🦵', label: 'Legs (Jambes)' }
        };
        
        // Styles avec meilleur contraste
        return `
            <div class="ai-ppl-selector">
                <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                    ${Object.keys(categories).map(cat => {
                        const isRecommended = cat === this.pplRecommendation.category;
                        return `
                        <div class="ppl-card" 
                             style="flex: 1; padding: 1rem; cursor: pointer; 
                                    border: 2px solid ${isRecommended ? '#10b981' : '#334155'};
                                    background: ${isRecommended ? 'rgba(16, 185, 129, 0.1)' : 'rgba(51, 65, 85, 0.3)'};
                                    border-radius: 8px; text-align: center; transition: all 0.3s;"
                             onclick="window.aiSessionManager.selectPPL('${cat}')"
                             onmouseover="this.style.transform='translateY(-2px)'"
                             onmouseout="this.style.transform='translateY(0)'">
                            <div style="font-size: 2rem;">${categories[cat].icon}</div>
                            <div style="font-weight: 600; color: #f1f5f9;">${categories[cat].label}</div>
                            ${isRecommended ? 
                                `<div style="color: #10b981; margin-top: 0.5rem; font-weight: 600;">
                                    ${Math.round(this.pplRecommendation.confidence * 100)}%
                                </div>` : ''}
                        </div>
                    `}).join('')}
                </div>
                <div style="padding: 0.75rem; background: rgba(99, 102, 241, 0.1); border-radius: 6px; color: #e2e8f0; font-size: 0.9rem;">
                    <i class="fas fa-info-circle" style="color: #667eea;"></i> ${this.pplRecommendation.reasoning}
                </div>
            </div>
        `;
    }
    
    renderParametersUI() {
        // Interface améliorée avec meilleur contraste et limite de 3 muscles
        return `
            <div class="form-group" style="margin-bottom: 1.5rem;">
                <label style="color: #e2e8f0; font-weight: 600; display: block; margin-bottom: 0.5rem;">
                    Nombre d'exercices: <span id="exerciseCountDisplay" style="color: #667eea;">${this.params.target_exercise_count}</span>
                </label>
                <input type="range" class="range-input" min="3" max="8" value="${this.params.target_exercise_count}"
                       style="width: 100%; background: #334155; outline: none; height: 6px; border-radius: 3px;"
                       onchange="window.aiSessionManager.onParameterChange('target_exercise_count', this.value)">
            </div>
            
            <div class="form-group" style="margin-bottom: 1.5rem;">
                <label style="color: #e2e8f0; font-weight: 600; display: block; margin-bottom: 0.5rem;">
                    Exploration: <span id="explorationDisplay" style="color: #667eea;">${Math.round(this.params.exploration_factor * 100)}%</span>
                </label>
                <input type="range" class="range-input" min="0" max="100" value="${this.params.exploration_factor * 100}"
                       style="width: 100%; background: #334155; outline: none; height: 6px; border-radius: 3px;"
                       onchange="window.aiSessionManager.onParameterChange('exploration_factor', this.value/100)">
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #94a3b8; margin-top: 0.25rem;">
                    <span>Favoris</span>
                    <span>Nouveaux</span>
                </div>
            </div>
            
            <div class="form-group">
                <label style="color: #e2e8f0; font-weight: 600; display: block; margin-bottom: 0.5rem;">
                    Focus musculaire (optionnel - max 3)
                </label>
                <div id="muscleFocusContainer" style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                    ${['Pectoraux', 'Dos', 'Jambes', 'Épaules', 'Bras', 'Abdominaux'].map(muscle => {
                        const muscleKey = muscle.toLowerCase();
                        const isSelected = this.params.manual_muscle_focus.includes(muscleKey);
                        return `
                            <button class="muscle-chip" 
                                    data-muscle="${muscleKey}"
                                    style="padding: 0.5rem 1rem; border-radius: 20px; 
                                           background: ${isSelected ? '#667eea' : '#334155'};
                                           color: ${isSelected ? 'white' : '#94a3b8'};
                                           border: 1px solid ${isSelected ? '#667eea' : '#475569'};
                                           cursor: pointer; font-size: 0.9rem; transition: all 0.2s;"
                                    onclick="window.aiSessionManager.toggleMuscleFocus('${muscleKey}')">
                                ${muscle}
                            </button>
                        `;
                    }).join('')}
                </div>
                <small style="color: #64748b; font-size: 0.8rem; margin-top: 0.5rem; display: block;">
                    ${this.params.manual_muscle_focus.length}/3 muscles sélectionnés
                </small>
            </div>
        `;
    }
    
    toggleMuscleFocus(muscle) {
        const index = this.params.manual_muscle_focus.indexOf(muscle);
        
        if (index > -1) {
            // Retirer si déjà sélectionné
            this.params.manual_muscle_focus.splice(index, 1);
        } else {
            // Ajouter si pas encore sélectionné (MAX 3)
            if (this.params.manual_muscle_focus.length < 3) {
                this.params.manual_muscle_focus.push(muscle);
            } else {
                this.showMessage('Maximum 3 muscles peuvent être sélectionnés', 'warning');
                return;
            }
        }
        
        console.log('Focus muscles:', this.params.manual_muscle_focus);
        
        // Mettre à jour l'affichage
        this.render();
        this.bindEventListeners();
    }
    
    async generateSession() {
        if (this.isGenerating) return;
        
        if (typeof window.apiPost !== 'function') {
            console.error('apiPost non disponible');
            this.showMessage('Fonction API non disponible', 'error');
            return;
        }
        
        this.isGenerating = true;
        this.showGeneratingState();
        
        try {
            const generationParams = {
                ...this.params,
                randomness_seed: this.params.randomness_seed || Date.now()
            };
            
            console.log('🎲 Génération avec paramètres:', generationParams);
            
            const result = await window.apiPost('/api/ai/generate-exercises', {
                user_id: window.currentUser?.id || 1,
                params: generationParams
            });
            
            console.log('✅ Génération réussie:', result);
            
            this.lastGenerated = result;
            this.updateGeneratedSessionDisplay();
            
            this.showMessage(`Séance ${result.ppl_used.toUpperCase()} générée !`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur génération:', error);
            this.showMessage('Erreur lors de la génération', 'error');
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
            this.showMessage('Aucune séance générée', 'warning');
            return;
        }
        
        if (typeof window.apiPost !== 'function') {
            console.error('apiPost non disponible');
            return;
        }
        
        try {
            console.log('🚀 Lancement séance IA');
            
            // 1. Nettoyer état existant
            if (typeof window.clearWorkoutState === 'function') {
                window.clearWorkoutState();
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
            
            const response = await window.apiPost(`/api/users/${window.currentUser?.id || 1}/workouts`, workoutData);
            window.currentWorkout = response.workout;
            
            // 3. Stocker la queue d'exercices
            window.aiExerciseQueue = this.lastGenerated.exercises.map(ex => ex.exercise_id);
            window.aiExerciseIndex = 0;
            
            // 4. Aller à la vue workout
            if (typeof window.showView === 'function') {
                window.showView('workout');
            } else {
                console.error('showView non disponible');
                return;
            }
            
            // 5. Afficher la liste des exercices AI
            this.showAIExercisesList();
            
            // 6. Sélectionner le premier exercice
            setTimeout(async () => {
                await this.selectNextAIExercise();
                
                // 7. Démarrage auto countdown si mobile
                const isMobile = window.isMobile || /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);
                if (isMobile && typeof window.showCountdown === 'function') {
                    setTimeout(() => window.showCountdown(), 1000);
                }
            }, 500);
            
            this.showMessage('Séance lancée !', 'success');
            
        } catch (error) {
            console.error('❌ Erreur lancement:', error);
            this.showMessage('Erreur lors du lancement', 'error');
        }
    }
    
    showAIExercisesList() {
        const container = document.getElementById('sessionExercisesContainer') || 
                         document.getElementById('exercisesList');
        
        if (!container || !this.lastGenerated) return;
        
        container.innerHTML = `
            <div class="session-header" style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 1rem; border-radius: 8px 8px 0 0;">
                <h3 style="color: white; margin: 0;">🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}</h3>
                <div style="background: rgba(255,255,255,0.2); display: inline-block; padding: 0.25rem 0.75rem; border-radius: 20px; margin-top: 0.5rem;">
                    Score: ${Math.round(this.lastGenerated.quality_score)}%
                </div>
            </div>
            <div class="exercises-list" style="background: #1e293b; padding: 0.5rem; border-radius: 0 0 8px 8px;">
                ${this.lastGenerated.exercises.map((exercise, index) => `
                    <div class="exercise-card ${index === 0 ? 'active' : ''}" 
                         data-exercise-index="${index}"
                         data-exercise-id="${exercise.exercise_id}"
                         style="display: flex; align-items: center; padding: 1rem; margin: 0.5rem 0; 
                                background: ${index === 0 ? 'rgba(102, 126, 234, 0.1)' : '#0f172a'}; 
                                border-radius: 8px; border-left: 3px solid ${index === 0 ? '#667eea' : 'transparent'};">
                        <div style="width: 40px; height: 40px; background: #667eea; color: white; 
                                    border-radius: 50%; display: flex; align-items: center; 
                                    justify-content: center; font-weight: bold; margin-right: 1rem;">
                            ${exercise.order_in_session}
                        </div>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; color: #f1f5f9;">${exercise.name}</div>
                            <div style="color: #94a3b8; font-size: 0.9rem; margin-top: 0.25rem;">
                                ${exercise.muscle_groups.join(', ')}
                            </div>
                        </div>
                        <button onclick="window.aiSessionManager.swapExercise(${index})" 
                                style="padding: 0.5rem; background: #334155; color: #94a3b8; 
                                       border: none; border-radius: 6px; cursor: pointer;"
                                title="Changer">⇄</button>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    async selectNextAIExercise() {
        if (!window.aiExerciseQueue || window.aiExerciseIndex >= window.aiExerciseQueue.length) {
            this.showMessage('Séance terminée !', 'success');
            
            if (typeof window.completeWorkout === 'function') {
                window.completeWorkout();
            } else if (typeof window.endWorkout === 'function') {
                window.endWorkout();
            }
            return;
        }
        
        const exerciseId = window.aiExerciseQueue[window.aiExerciseIndex];
        
        if (typeof window.apiGet !== 'function') {
            console.error('apiGet non disponible');
            return;
        }
        
        try {
            const exercise = await window.apiGet(`/api/exercises/${exerciseId}`);
            
            if (typeof window.selectExercise === 'function') {
                await window.selectExercise(exercise);
            } else {
                console.error('selectExercise non disponible');
                return;
            }
            
            // Mettre à jour l'affichage
            document.querySelectorAll('.exercise-card').forEach(item => {
                item.classList.remove('active', 'current');
                item.style.background = '#0f172a';
                item.style.borderLeft = '3px solid transparent';
            });
            
            const currentItem = document.querySelector(`[data-exercise-index="${window.aiExerciseIndex}"]`);
            if (currentItem) {
                currentItem.classList.add('active', 'current');
                currentItem.style.background = 'rgba(102, 126, 234, 0.1)';
                currentItem.style.borderLeft = '3px solid #667eea';
            }
            
            window.aiExerciseIndex++;
            
        } catch (error) {
            console.error('Erreur sélection exercice:', error);
            window.aiExerciseIndex++;
            await this.selectNextAIExercise();
        }
    }
    
    async swapExercise(exerciseIndex) {
        this.showMessage('Swap exercice - À implémenter', 'info');
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
        
        if (paramName === 'exploration_factor') {
            const display = document.getElementById('explorationDisplay');
            if (display) display.textContent = `${Math.round(value * 100)}%`;
        } else if (paramName === 'target_exercise_count') {
            const display = document.getElementById('exerciseCountDisplay');
            if (display) display.textContent = value;
        }
    }
    
    bindEventListeners() {
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        const launchBtn = document.getElementById('launchAISessionBtn');
        
        if (generateBtn) {
            generateBtn.onclick = () => this.generateSession();
        }
        
        if (regenerateBtn) {
            regenerateBtn.onclick = () => this.regenerateSession();
        }
        
        if (launchBtn) {
            launchBtn.onclick = () => this.launchAISession();
        }
    }
    
    showGeneratingState() {
        const btn = document.getElementById('generateSessionBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...';
            btn.disabled = true;
            btn.style.opacity = '0.6';
        }
    }
    
    updateButtonStates() {
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Générer Séance';
            generateBtn.disabled = false;
            generateBtn.style.opacity = '1';
        }
        
        if (regenerateBtn) {
            regenerateBtn.disabled = !this.lastGenerated;
            regenerateBtn.style.opacity = this.lastGenerated ? '1' : '0.6';
        }
    }
    
    updateGeneratedSessionDisplay() {
        const container = document.getElementById('exercisePreviewContainer');
        const preview = document.getElementById('generatedSessionPreview');
        
        if (!container || !this.lastGenerated) return;
        
        container.innerHTML = `
            <div class="exercises-list">
                ${this.lastGenerated.exercises.map(exercise => `
                    <div style="display: flex; align-items: center; padding: 0.75rem; margin: 0.5rem 0; 
                                background: #0f172a; border-radius: 8px;">
                        <div style="width: 35px; height: 35px; background: #667eea; color: white; 
                                    border-radius: 50%; display: flex; align-items: center; 
                                    justify-content: center; font-weight: bold; margin-right: 1rem; font-size: 0.9rem;">
                            ${exercise.order_in_session}
                        </div>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; color: #f1f5f9;">${exercise.name}</div>
                            <div style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem;">
                                <span style="margin-right: 1rem;">${exercise.muscle_groups.join(', ')}</span>
                                <span style="color: #64748b;">${exercise.default_sets} séries • ${exercise.default_reps_min}-${exercise.default_reps_max} reps</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="display: flex; justify-content: space-around; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #334155;">
                <div style="text-align: center;">
                    <i class="fas fa-trophy" style="color: #667eea;"></i>
                    <span style="color: #e2e8f0; margin-left: 0.5rem;">Score: ${Math.round(this.lastGenerated.quality_score)}%</span>
                </div>
                <div style="text-align: center;">
                    <i class="fas fa-dumbbell" style="color: #667eea;"></i>
                    <span style="color: #e2e8f0; margin-left: 0.5rem;">${this.lastGenerated.exercises.length} exercices</span>
                </div>
                <div style="text-align: center;">
                    <i class="fas fa-clock" style="color: #667eea;"></i>
                    <span style="color: #e2e8f0; margin-left: 0.5rem;">~${this.lastGenerated.exercises.length * 10} min</span>
                </div>
            </div>
        `;
        
        if (preview) {
            preview.style.display = 'block';
        }
    }
    
    showMessage(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
            
            // Fallback simple
            const alertDiv = document.createElement('div');
            alertDiv.textContent = message;
            alertDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 1rem;
                background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
                color: white;
                border-radius: 8px;
                z-index: 9999;
                animation: slideIn 0.3s ease;
                font-weight: 500;
            `;
            
            document.body.appendChild(alertDiv);
            setTimeout(() => alertDiv.remove(), 3000);
        }
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