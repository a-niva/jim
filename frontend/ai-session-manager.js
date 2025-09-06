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
            'push': { icon: '💪', label: 'Push' },
            'pull': { icon: '🎣', label: 'Pull' },
            'legs': { icon: '🦵', label: 'Legs' }
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

    // ============= AJOUT 1 : Drag & Drop =============
    initializeExerciseReorder() {
        const container = document.getElementById('exercisePreviewContainer');
        if (!container || !this.lastGenerated) return;
        
        // ❌ SUPPRIMER tout le code drag & drop complexe
        // ✅ Version simplifiée sans erreurs
        console.log('Drag & drop désactivé temporairement pour éviter erreurs DOM');
        
        // Alternative : boutons haut/bas pour réorganiser
        container.querySelectorAll('.exercise-preview-item').forEach((item, index) => {
            const actionsDiv = item.querySelector('.exercise-actions') || item;
            
            // Ajouter boutons simples de réorganisation
            const moveButtons = document.createElement('div');
            moveButtons.className = 'move-buttons';
            moveButtons.innerHTML = `
                <button onclick="window.aiSessionManager.moveExercise(${index}, -1)" 
                        class="btn-mini" title="Monter" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button onclick="window.aiSessionManager.moveExercise(${index}, 1)" 
                        class="btn-mini" title="Descendre" ${index === this.lastGenerated.exercises.length - 1 ? 'disabled' : ''}>↓</button>
            `;
            
            actionsDiv.appendChild(moveButtons);
        });
    }

    moveExercise(index, direction) {
        const exercises = this.lastGenerated.exercises;
        const newIndex = index + direction;
        
        if (newIndex < 0 || newIndex >= exercises.length) return;
        
        // Échanger les exercices
        [exercises[index], exercises[newIndex]] = [exercises[newIndex], exercises[index]];
        
        // Mettre à jour l'ordre
        exercises.forEach((ex, idx) => {
            ex.order_in_session = idx + 1;
        });
        
        // Regenerer l'affichage
        this.updateGeneratedSessionDisplay();
        this.showMessage('Ordre modifié', 'success');
    }
    
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.exercise-preview-item:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    updateOrderFromDOM() {
        const items = document.querySelectorAll('.exercise-preview-item');
        const newOrder = [];
        
        items.forEach((item, newIndex) => {
            const exerciseId = parseInt(item.dataset.exerciseId);
            const exercise = this.lastGenerated.exercises.find(ex => ex.exercise_id === exerciseId);
            if (exercise) {
                exercise.order_in_session = newIndex + 1;
                newOrder.push(exercise);
            }
        });
        
        this.lastGenerated.exercises = newOrder;
        this.updateQualityScore();
        this.updateOrderNumbers();
    }
    
    // ============= AJOUT 2 : Calcul du score local =============
    updateQualityScore() {
        if (!this.lastGenerated) return;
        
        const exercises = this.lastGenerated.exercises;
        let score = 50; // Base
        
        // Bonus pour diversité musculaire
        const uniqueMuscles = new Set();
        exercises.forEach(ex => {
            if (ex.muscle_groups) {
                ex.muscle_groups.forEach(muscle => uniqueMuscles.add(muscle));
            }
        });
        score += uniqueMuscles.size * 10;
        
        // Bonus pour nombre d'exercices optimal
        if (exercises.length >= 4 && exercises.length <= 6) {
            score += 20;
        } else if (exercises.length >= 3 && exercises.length <= 7) {
            score += 10;
        }
        
        // Pénalité pour muscles consécutifs identiques
        for (let i = 1; i < exercises.length; i++) {
            const currentMuscles = new Set(exercises[i].muscle_groups || []);
            const prevMuscles = new Set(exercises[i-1].muscle_groups || []);
            const overlap = [...currentMuscles].filter(m => prevMuscles.has(m));
            if (overlap.length > 0) {
                score -= 5;
            }
        }
        
        // Limiter entre 0 et 100
        this.lastGenerated.quality_score = Math.min(100, Math.max(0, score));
        
        // Mettre à jour l'affichage
        const scoreDisplay = document.querySelector('.quality-score-display');
        if (scoreDisplay) {
            scoreDisplay.textContent = `Score: ${Math.round(this.lastGenerated.quality_score)}%`;
        }
    }
    
    updateOrderNumbers() {
        const items = document.querySelectorAll('.exercise-preview-item');
        items.forEach((item, index) => {
            const numberEl = item.querySelector('.exercise-number');
            if (numberEl) {
                numberEl.textContent = index + 1;
            }
        });
    }

    async regenerateSession() {
        if (!this.lastGenerated) return;
        
        // Nouveau seed pour variabilité
        this.params.randomness_seed = Date.now();
        await this.generateSession();
    }
    
    
    // ============= AJOUT 3 : Lancement de séance avec auto-start =============
    async launchAISession() {
        if (!this.lastGenerated || !this.lastGenerated.exercises) {
            window.showToast('Aucune séance générée à lancer', 'warning');
            return;
        }
        
        try {
            console.log('🚀 Lancement séance IA avec auto-start');
            
            // 1. Nettoyer état existant (AVANT tout)
            if (typeof window.clearWorkoutState === 'function') {
                window.clearWorkoutState();
            }
            
            // 2. Créer workout backend (ATTENDRE obligatoirement)
            const workoutData = {
                type: 'free',
                ai_generated: true
            };
            
            const response = await window.apiPost(`/api/users/${window.currentUser?.id || 1}/workouts`, workoutData);
            
            // 3. CORRECTION : Validation + API retourne directement l'objet workout
            if (!response || !response.id) {
                throw new Error('Réponse API invalide pour création workout');
            }
            
            window.currentWorkout = response;  // PAS response.workout
            
            // 4. Configurer session avec workout assigné (CRITIQUE)
            window.currentWorkoutSession = {
                type: 'ai',
                workout: response,
                id: response.id,  // Ajout pour compatibilité avec selectExercise
                exercises: this.lastGenerated.exercises,
                currentIndex: 0,
                sessionExercises: {},
                completedExercisesCount: 0,
                
                // États standards pour compatibilité
                currentExercise: null,
                currentSetNumber: 1,
                exerciseOrder: 1,
                globalSetCount: 0,
                sessionFatigue: 3,
                completedSets: [],
                totalRestTime: 0,
                totalSetTime: 0,
                skipped_exercises: [],
                swaps: [],
                modifications: []
            };
            
            // 5. Initialiser sessionExercises (réutilise logique existante)
            this.lastGenerated.exercises.forEach((ex, idx) => {
                window.currentWorkoutSession.sessionExercises[ex.exercise_id] = {
                    index: idx,
                    name: ex.name,
                    isCompleted: false,
                    completedSets: 0,
                    totalSets: ex.default_sets || 3
                };
            });
            
            // 6. Navigation (après all assignments)
            window.showView('workout');
            
            // 7. Afficher panel AI
            this.showAISessionPanel();
            
            // 8. Vérification synchrone avant sélection exercice
            if (!window.currentWorkout || !window.currentWorkoutSession) {
                throw new Error('État session invalide avant sélection exercice');
            }

            // 9. Auto-sélection premier exercice 
            if (this.lastGenerated.exercises.length > 0) {
                const firstExerciseId = this.lastGenerated.exercises[0].exercise_id;
                await window.selectSessionExercise(firstExerciseId, true);
            }
            
            window.showToast(`Séance ${this.lastGenerated.ppl_used.toUpperCase()} lancée !`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur lancement séance IA:', error);
            window.showToast('Erreur lors du lancement', 'error');
        }
    }


    // ============= AJOUT 4 : Panel d'exercices AI dans la séance =============
    showAISessionPanel() {
        // Supprimer panel existant
        const existingPanel = document.getElementById('aiSessionPanel');
        if (existingPanel) {
            existingPanel.remove();
        }
        
        // Créer panel avec classes CSS appropriées
        const panelHTML = `
            <div id="aiSessionPanel" class="ai-session-panel expanded">
                <div class="ai-panel-header">
                    <h3>🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}</h3>
                    <span class="quality-score">Score: ${Math.round(this.lastGenerated.quality_score)}%</span>
                    <button class="panel-toggle" onclick="window.aiSessionManager.toggleAIPanel()" title="Réduire/Agrandir">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                        
                <div class="ai-panel-content">
                    ${this.lastGenerated.exercises.map((exercise, index) => {
                        const isActive = window.currentWorkoutSession?.currentIndex === index;
                        
                        return `
                            <div class="ai-exercise-item ${isActive ? 'active' : ''}">
                                <div class="exercise-info">
                                    <span class="exercise-number">${index + 1}</span>
                                    <div class="exercise-details">
                                        <div class="exercise-name">${exercise.name}</div>
                                        <div class="exercise-params">${exercise.muscle_groups.join(', ')} • ${exercise.default_sets} séries</div>
                                    </div>
                                </div>
                                
                                <div class="exercise-actions">
                                    <button onclick="window.aiSessionManager.goToExercise(${index})" 
                                            class="btn-action btn-go" title="Aller à">→</button>
                                    <button onclick="window.aiSessionManager.swapExercise(${index})" 
                                            class="btn-action btn-swap" title="Changer">⇄</button>
                                    <button onclick="window.aiSessionManager.skipExercise(${index})" 
                                            class="btn-action btn-skip" title="Passer">⏭</button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        
        // Ajouter au body avec bonnes classes
        document.body.insertAdjacentHTML('beforeend', panelHTML);
        
        // Animation d'apparition propre
        const panel = document.getElementById('aiSessionPanel');
        if (panel) {
            requestAnimationFrame(() => {
                panel.classList.add('visible');
                // Ajuster la position des boutons flottants après l'animation
                setTimeout(() => {
                    this.adjustFloatingButtonsPosition();
                }, 300);
            });
        }
    }

    toggleAIPanel() {
        const panel = document.getElementById('aiSessionPanel');
        const content = document.querySelector('.ai-panel-content');
        const toggleIcon = document.querySelector('.panel-toggle i');
        
        if (!panel || !content || !toggleIcon) return;
        
        const isExpanded = panel.classList.contains('expanded');
        
        if (isExpanded) {
            // Réduire : cacher le contenu
            panel.classList.remove('expanded');
            panel.classList.add('collapsed');
            content.style.display = 'none';
            toggleIcon.classList.remove('fa-chevron-down');
            toggleIcon.classList.add('fa-chevron-up');
        } else {
            // Agrandir : montrer le contenu
            panel.classList.remove('collapsed');
            panel.classList.add('expanded');
            content.style.display = 'block';
            toggleIcon.classList.remove('fa-chevron-up');
            toggleIcon.classList.add('fa-chevron-down');
        }
        
        // Réajuster la position des boutons flottants
        this.adjustFloatingButtonsPosition();
    }

    adjustFloatingButtonsPosition() {
        const panel = document.getElementById('aiSessionPanel');
        const floatingActions = document.getElementById('floatingWorkoutActions');
        
        if (!panel || !floatingActions) return;
        
        const isCollapsed = panel.classList.contains('collapsed');
        const panelHeader = document.querySelector('.ai-panel-header');
        
        if (panelHeader) {
            const headerHeight = panelHeader.offsetHeight;
            
            if (isCollapsed) {
                // Panel réduit : boutons juste au-dessus du header
                floatingActions.style.bottom = `calc(var(--bottom-nav-height, 70px) + ${headerHeight + 10}px)`;
            } else {
                // Panel étendu : boutons au-dessus du panel entier
                const panelHeight = panel.offsetHeight;
                floatingActions.style.bottom = `calc(var(--bottom-nav-height, 70px) + ${panelHeight + 10}px)`;
            }
        }
    }
    
    // ============= AJOUT 5 : Actions sur les exercices =============
    async goToExercise(index) {
        const exercise = this.lastGenerated.exercises[index];
        if (!exercise) return;
        
        window.currentWorkoutSession.currentIndex = index;
        const exerciseDetails = await window.apiGet(`/api/exercises/${exercise.exercise_id}`);
        await window.selectExercise(exerciseDetails);
        this.showAISessionPanel(); // Refresh
    }
    
    async swapExercise(index) {
        const exercise = this.lastGenerated.exercises[index];
        if (!exercise) return;
        
        // Appeler l'API pour obtenir des alternatives
        try {
            const alternatives = await window.apiPost('/api/exercises/alternatives', {
                exercise_id: exercise.exercise_id,
                muscle_groups: exercise.muscle_groups,
                equipment_required: exercise.equipment_required
            });
            
            // Afficher modal de sélection
            this.showSwapModal(index, alternatives);
        } catch (error) {
            console.error('Erreur récupération alternatives:', error);
            // Fallback : proposer des exercices du même groupe musculaire
            const alternatives = await window.apiGet(`/api/exercises?muscle_group=${exercise.muscle_groups[0]}`);
            this.showSwapModal(index, alternatives.slice(0, 5));
        }
    }
    
    skipExercise(index) {
        const exercise = this.lastGenerated.exercises[index];
        if (!exercise) return;
        
        // Marquer comme complété/sauté
        const state = window.currentWorkoutSession.sessionExercises[exercise.exercise_id];
        if (state) {
            state.isCompleted = true;
            state.skipped = true;
        }
        
        // Passer au suivant
        if (index < this.lastGenerated.exercises.length - 1) {
            this.goToExercise(index + 1);
        } else {
            this.showMessage('Séance terminée !', 'success');
            if (typeof window.endWorkout === 'function') {
                window.endWorkout();
            }
        }
    }
        
    showSwapModal(index, alternatives) {
        const currentExercise = this.lastGenerated.exercises[index];
        
        const modalContent = `
            <div class="alternatives-container">
                <div class="exercise-context">
                    <h4>Remplacer "${currentExercise.name}"</h4>
                    <p>Choisissez un exercice de remplacement :</p>
                </div>
                
                <div class="alternatives-list">
                    ${alternatives.map(alt => `
                        <button class="alternative-option" onclick="window.aiSessionManager.selectAlternative(${index}, ${alt.id})">
                            <div class="alternative-name">${alt.name}</div>
                            <div class="alternative-muscles">${(alt.muscle_groups || []).join(', ')}</div>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Utiliser le système modal existant
        window.showModal('Changer d\'exercice', modalContent);
    }
    
    async selectAlternative(index, newExerciseId) {
        // Fermer le modal proprement avec le système existant
        window.closeModal();
        
        try {
            console.log(`🔄 Remplacement exercice ${index} par ${newExerciseId}`);
            
            // Récupérer les détails du nouvel exercice
            const newExercise = await window.apiGet(`/api/exercises/${newExerciseId}`);
            
            // Sauvegarder l'ancien exercice pour l'historique
            const oldExercise = this.lastGenerated.exercises[index];
            
            // Remplacer dans la liste avec le format attendu
            this.lastGenerated.exercises[index] = {
                exercise_id: newExercise.id,
                name: newExercise.name,
                muscle_groups: newExercise.muscle_groups || [],
                equipment_required: newExercise.equipment_required || [],
                difficulty: newExercise.difficulty || 'intermediate',
                default_sets: newExercise.default_sets || 3,
                default_reps_min: newExercise.default_reps_min || 8,
                default_reps_max: newExercise.default_reps_max || 12,
                base_rest_time_seconds: newExercise.base_rest_time_seconds || 90,
                instructions: newExercise.instructions || '',
                order_in_session: index + 1,
                exercise_type: newExercise.exercise_type || 'strength',
                weight_type: newExercise.weight_type || 'fixed'
            };
            
            // Mettre à jour sessionExercises si nécessaire
            if (window.currentWorkoutSession && window.currentWorkoutSession.sessionExercises) {
                // Supprimer l'ancien exercice
                delete window.currentWorkoutSession.sessionExercises[oldExercise.exercise_id];
                
                // Ajouter le nouveau
                window.currentWorkoutSession.sessionExercises[newExercise.id] = {
                    index: index,
                    name: newExercise.name,
                    isCompleted: false,
                    completedSets: 0,
                    totalSets: newExercise.default_sets || 3,
                    isSwapped: true,
                    swappedFrom: oldExercise.name,
                    swappedAt: new Date().toISOString()
                };
                
                // Enregistrer le swap dans l'historique
                if (!window.currentWorkoutSession.swaps) {
                    window.currentWorkoutSession.swaps = [];
                }
                
                window.currentWorkoutSession.swaps.push({
                    original_id: oldExercise.exercise_id,
                    original_name: oldExercise.name,
                    new_id: newExercise.id,
                    new_name: newExercise.name,
                    reason: 'user_preference',
                    timestamp: new Date().toISOString(),
                    exercise_index: index
                });
            }
            
            // Rafraîchir le panel AI
            this.showAISessionPanel();
            
            // Si c'est l'exercice en cours, le sélectionner automatiquement
            if (window.currentWorkoutSession && window.currentWorkoutSession.currentIndex === index) {
                await this.goToExercise(index);
            }
            
            window.showToast(`Exercice remplacé : ${newExercise.name}`, 'success');
            
            console.log('✅ Remplacement exercice réussi');
            
        } catch (error) {
            console.error('❌ Erreur remplacement exercice:', error);
            window.showToast('Erreur lors du remplacement de l\'exercice', 'error');
        }
    }
        
    // Mise à jour de updateGeneratedSessionDisplay pour supporter le drag & drop
    updateGeneratedSessionDisplay() {
        const container = document.getElementById('exercisePreviewContainer');
        const preview = document.getElementById('generatedSessionPreview');
        
        if (!container || !this.lastGenerated) return;
        
        container.innerHTML = `
            <div class="quality-score-display" style="text-align: center; margin-bottom: 1rem; font-weight: bold; color: #667eea;">
                Score: ${Math.round(this.lastGenerated.quality_score)}%
            </div>
            <div class="exercises-list">
                ${this.lastGenerated.exercises.map(exercise => `
                    <div class="exercise-preview-item" 
                         data-exercise-id="${exercise.exercise_id}"
                         style="display: flex; align-items: center; padding: 0.75rem; margin: 0.5rem 0; 
                                background: #0f172a; border-radius: 8px; cursor: move;">
                        <div class="drag-handle" style="margin-right: 0.5rem; color: #667eea;">☰</div>
                        <div class="exercise-number" style="width: 35px; height: 35px; background: #667eea; color: white; 
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
        
        // Initialiser le drag & drop après mise à jour du DOM
        setTimeout(() => this.initializeExerciseReorder(), 100);
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