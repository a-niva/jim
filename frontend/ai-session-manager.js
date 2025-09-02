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
        if (!this.pplRecommendation) return '<div class="ai-session-error-state">Chargement recommandation...</div>';
        
        const confidence = this.pplRecommendation.confidence || 0.5;
        const category = this.pplRecommendation.category || 'push';
        const reasoning = this.pplRecommendation.reasoning || 'Recommandation basée sur votre récupération';
        
        const pplIcons = {
            push: 'fas fa-hand-paper',
            pull: 'fas fa-hand-rock', 
            legs: 'fas fa-running'
        };
        
        const pplLabels = {
            push: 'PUSH (Poussée)',
            pull: 'PULL (Traction)',
            legs: 'LEGS (Jambes)'
        };
        
        return `
            <div class="ai-session-ppl-recommendation-card ${confidence > 0.7 ? 'ai-session-high-confidence' : ''}">
                <div class="ai-session-ppl-main-recommendation">
                    <div class="ai-session-ppl-category-display">
                        <div class="ai-session-ppl-icon">
                            <i class="${pplIcons[category]}"></i>
                        </div>
                        <div class="ai-session-ppl-info">
                            <h4>${pplLabels[category]}</h4>
                            <p class="ai-session-ppl-reasoning">${reasoning}</p>
                            <div class="ai-session-ppl-confidence">
                                Confiance: ${Math.round(confidence * 100)}%
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="ai-session-ppl-override-section">
                    <h5>Ou choisir manuellement :</h5>
                    <div class="ai-session-ppl-alternatives">
                        <div class="ai-session-ppl-option ${this.params.ppl_override === null ? 'ai-session-selected' : ''}" 
                            onclick="window.aiSessionManager.setPPLOverride(null)">
                            <i class="fas fa-magic"></i><br>Auto
                        </div>
                        <div class="ai-session-ppl-option ${this.params.ppl_override === 'push' ? 'ai-session-selected' : ''}" 
                            onclick="window.aiSessionManager.setPPLOverride('push')">
                            <i class="fas fa-hand-paper"></i><br>Push
                        </div>
                        <div class="ai-session-ppl-option ${this.params.ppl_override === 'pull' ? 'ai-session-selected' : ''}" 
                            onclick="window.aiSessionManager.setPPLOverride('pull')">
                            <i class="fas fa-hand-rock"></i><br>Pull
                        </div>
                        <div class="ai-session-ppl-option ${this.params.ppl_override === 'legs' ? 'ai-session-selected' : ''}" 
                            onclick="window.aiSessionManager.setPPLOverride('legs')">
                            <i class="fas fa-running"></i><br>Legs
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    setPPLOverride(value) {
        this.params.ppl_override = value;
        this.markGenerationOutdated();
        
        // Re-render PPL section
        const container = document.getElementById('pplRecommendationContainer');
        if (container) {
            container.innerHTML = this.renderPPLRecommendation();
        }
    }

    renderParametersUI() {
        const explorationValue = Math.round(this.params.exploration_factor * 100);
        const exerciseCount = this.params.target_exercise_count;
        
        return `
            <div class="ai-session-param-control">
                <label for="explorationSlider">
                    <i class="fas fa-balance-scale"></i>
                    Équilibre Favoris/Nouveaux: <span class="ai-session-range-value">${explorationValue}%</span>
                </label>
                <input type="range" 
                    id="explorationSlider" 
                    min="0" max="100" 
                    value="${explorationValue}"
                    oninput="window.aiSessionManager.updateExplorationFactor(this.value)">
                <div class="ai-session-slider-labels">
                    <span>Favoris</span>
                    <span>Équilibre</span>
                    <span>Nouveaux</span>
                </div>
                <div class="ai-session-param-help">
                    0% privilégie vos exercices favoris, 100% explore de nouveaux exercices
                </div>
            </div>
            
            <div class="ai-session-param-control">
                <label for="exerciseCountSlider">
                    <i class="fas fa-list-ol"></i>
                    Nombre d'exercices: <span class="ai-session-range-value">${exerciseCount}</span>
                </label>
                <input type="range" 
                    id="exerciseCountSlider" 
                    min="3" max="8" 
                    value="${exerciseCount}"
                    oninput="window.aiSessionManager.updateExerciseCount(this.value)">
                <div class="ai-session-slider-labels">
                    <span>3 (Court)</span>
                    <span>5 (Optimal)</span>
                    <span>8 (Long)</span>
                </div>
                <div class="ai-session-param-help">
                    Plus d'exercices = séance plus longue mais plus complète
                </div>
            </div>
            
            <div class="ai-session-param-control">
                <label><i class="fas fa-crosshairs"></i> Focus muscles (optionnel) :</label>
                <div class="ai-session-muscle-focus-selector">
                    ${this.renderMuscleFocusOptions()}
                </div>
                <div class="ai-session-param-help">
                    Sélectionnez des groupes musculaires à privilégier dans la génération
                </div>
            </div>
        `;
    }
    

    updateExplorationFactor(value) {
        this.params.exploration_factor = parseInt(value) / 100;
        this.markGenerationOutdated();
        
        // Mettre à jour affichage valeur
        const valueDisplay = document.querySelector('#explorationSlider + .ai-session-slider-labels + .ai-session-param-help').previousElementSibling.querySelector('.ai-session-range-value');
        if (valueDisplay) valueDisplay.textContent = `${value}%`;
    }

    updateExerciseCount(value) {
        this.params.target_exercise_count = parseInt(value);
        this.markGenerationOutdated();
        
        // Mettre à jour affichage valeur
        const valueDisplay = document.querySelector('#exerciseCountSlider').previousElementSibling.querySelector('.ai-session-range-value');
        if (valueDisplay) valueDisplay.textContent = value;
    }

    toggleMuscleFocus(muscle) {
        const index = this.params.manual_muscle_focus.indexOf(muscle);
        if (index > -1) {
            this.params.manual_muscle_focus.splice(index, 1);
        } else {
            this.params.manual_muscle_focus.push(muscle);
        }
        
        this.markGenerationOutdated();
        
        // Re-render muscle focus section
        const container = document.querySelector('.ai-session-muscle-focus-selector');
        if (container) {
            container.innerHTML = this.renderMuscleFocusOptions();
        }
    }

    // ===== CORRECTIONS JAVASCRIPT POUR CORRESPONDRE AUX NOUVEAUX STYLES =====

    /**
     * CORRIGER renderExercisePreview() pour utiliser les nouvelles classes et couleurs
     * 
     * LOCALISATION: Dans ai-session-manager.js, méthode renderExercisePreview()
     * ACTION: Remplacer complètement cette méthode
     */

    renderExercisePreview() {
        if (!this.lastGenerated || !this.lastGenerated.exercises) return '';
        
        const qualityScore = Math.round(this.lastGenerated.quality_score || 75);
        const pplUsed = this.lastGenerated.ppl_used || 'push';
        
        // Déterminer classe score selon valeur
        let scoreClass = 'average';
        if (qualityScore >= 85) scoreClass = 'excellent';
        else if (qualityScore >= 70) scoreClass = 'good';
        
        return `
            <div class="ai-session-generated-summary">
                <div class="ai-session-meta">
                    <div class="ai-session-exercise-count">
                        <i class="fas fa-list"></i> ${this.lastGenerated.exercises.length} exercices
                    </div>
                    <div class="ai-session-ppl-badge" data-ppl="${pplUsed}">
                        <i class="fas fa-dumbbell"></i>
                        ${pplUsed.toUpperCase()}
                    </div>
                    <div class="ai-session-quality-score" data-score="${scoreClass}">
                        <i class="fas fa-star"></i> ${qualityScore}%
                    </div>
                </div>
            </div>
            
            <div id="aiExercisesList" class="ai-session-exercises-preview-list">
                ${this.lastGenerated.exercises.map((ex, index) => this.renderSingleExercise(ex, index)).join('')}
            </div>
            
            <div class="ai-session-launch-actions">
                <button id="launchAISessionBtn" class="ai-session-btn ai-session-btn-success">
                    <i class="fas fa-rocket"></i> Lancer Séance
                </button>
                <p class="ai-session-launch-note">
                    <i class="fas fa-info-circle"></i> 
                    Interface de séance classique avec tous vos outils habituels
                </p>
            </div>
        `;
    }

    /**
     * NOUVELLE MÉTHODE pour rendre un exercice individuel
     * 
     * LOCALISATION: Dans ai-session-manager.js, ajouter cette nouvelle méthode
     * ACTION: Ajouter cette méthode dans la classe AISessionManager
     */

    renderSingleExercise(ex, index) {
        return `
            <div class="ai-session-exercise-preview-item" data-exercise-index="${index}">
                <span class="ai-session-exercise-drag-handle" title="Glisser pour réordonner">
                    <i class="fas fa-grip-vertical"></i>
                </span>
                
                <div class="ai-session-exercise-number">${index + 1}</div>
                
                <div class="ai-session-exercise-details">
                    <div class="ai-session-exercise-name">${ex.exercise_name || ex.name}</div>
                    <div class="ai-session-exercise-params">
                        <i class="fas fa-dumbbell"></i>
                        ${ex.sets || 3} × ${ex.reps_min || 8}-${ex.reps_max || 12}
                        <i class="fas fa-clock"></i>
                        ${Math.round((ex.rest_seconds || 90) / 60)}min repos
                    </div>
                    <div class="ai-session-exercise-muscles">
                        ${(ex.muscle_groups || []).map(muscle => 
                            `<span class="ai-session-muscle-tag"><i class="fas fa-bullseye"></i> ${muscle}</span>`
                        ).join('')}
                        ${ex.equipment_required && ex.equipment_required.length > 0 ? 
                            `<span class="ai-session-equipment-tag"><i class="fas fa-tools"></i> ${ex.equipment_required[0]}</span>` : ''}
                    </div>
                </div>
                
                <div class="ai-session-exercise-actions">
                    <button class="ai-session-btn-small ai-session-btn-secondary" 
                            onclick="window.aiSessionManager.swapExercise(${index})"
                            title="Remplacer cet exercice">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * CORRIGER animateScoreChange() pour les nouvelles classes
     * 
     * LOCALISATION: Dans ai-session-manager.js, méthode animateScoreChange()
     * ACTION: Remplacer cette méthode
     */

    animateScoreChange(newScore) {
        const scoreElement = document.querySelector('#generatedSessionPreview .ai-session-quality-score');
        if (!scoreElement) return;
        
        // Déterminer nouvelle classe selon score
        let scoreClass = 'average';
        if (newScore >= 85) scoreClass = 'excellent';
        else if (newScore >= 70) scoreClass = 'good';
        
        // Appliquer nouvelle classe avec animation
        scoreElement.setAttribute('data-score', scoreClass);
        scoreElement.innerHTML = `<i class="fas fa-star"></i> ${newScore}%`;
        
        // Animation scale
        scoreElement.style.transform = 'scale(1.15)';
        scoreElement.style.transition = 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
        
        setTimeout(() => {
            scoreElement.style.transform = 'scale(1)';
        }, 400);
        
        // Animation flash couleur
        const originalBg = scoreElement.style.background;
        if (scoreClass === 'excellent') {
            scoreElement.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            scoreElement.style.boxShadow = '0 8px 32px rgba(16, 185, 129, 0.6)';
        } else if (scoreClass === 'good') {
            scoreElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            scoreElement.style.boxShadow = '0 8px 32px rgba(245, 158, 11, 0.6)';
        } else {
            scoreElement.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
            scoreElement.style.boxShadow = '0 8px 32px rgba(239, 68, 68, 0.6)';
        }
        
        setTimeout(() => {
            scoreElement.style.background = originalBg;
        }, 1000);
    }

    /**
     * CORRIGER updateGeneratedSessionDisplay() pour reload complet
     * 
     * LOCALISATION: Dans ai-session-manager.js, méthode updateGeneratedSessionDisplay()
     * ACTION: Améliorer cette méthode
     */


    updateGeneratedSessionDisplay() {
        console.log('🎨 [DEBUG] updateGeneratedSessionDisplay appelé');
        
        const previewContainer = document.getElementById('exercisePreviewContainer');
        const previewSection = document.getElementById('generatedSessionPreview');
        
        console.log('🔍 [DEBUG] Containers trouvés:', {
            previewContainer: !!previewContainer,
            previewSection: !!previewSection,
            hasGenerated: !!this.lastGenerated
        });
        
        if (previewContainer && this.lastGenerated) {
            // Supprimer messages obsolètes
            const obsoleteMessages = previewSection?.querySelectorAll('.ai-session-outdated-message');
            obsoleteMessages?.forEach(msg => msg.remove());
            
            // Générer HTML
            const html = this.renderExercisePreview();
            console.log('📄 [DEBUG] HTML généré, longueur:', html.length);
            previewContainer.innerHTML = html;
            
            // Initialiser fonctionnalités avec délais
            setTimeout(() => {
                console.log('🔧 [DEBUG] Initialisation drag & drop');
                this.initializeExercisesDragDrop();
            }, 100);
            
            setTimeout(() => {
                console.log('🔗 [DEBUG] Binding bouton launch');
                this.bindLaunchButton();
            }, 150);
            
            setTimeout(() => {
                console.log('📊 [DEBUG] Calcul scoring initial');
                this.updateAISessionScoring(this.lastGenerated.exercises);
            }, 200);
            
            // Animation apparition
            setTimeout(() => {
                const items = document.querySelectorAll('.ai-session-exercise-preview-item');
                console.log('✨ [DEBUG] Animation de', items.length, 'items');
                items.forEach((item, index) => {
                    item.style.opacity = '0';
                    item.style.transform = 'translateY(20px)';
                    setTimeout(() => {
                        item.style.transition = 'all 0.4s ease';
                        item.style.opacity = '1';
                        item.style.transform = 'translateY(0)';
                    }, index * 100);
                });
            }, 250);
        }
        
        if (previewSection) {
            previewSection.style.display = 'block';
            console.log('👁️ [DEBUG] Section preview affichée');
        }

        this.updateButtonStates();
        
        // Après génération réussie, collapse les sections
        if (this.lastGenerated) {
            setTimeout(() => {
                this.makeCollapsible();
                // Auto-collapse après génération
                document.querySelectorAll('.collapsible-section').forEach(section => {
                    section.classList.add('collapsed');
                });
                document.querySelectorAll('.collapse-toggle').forEach(toggle => {
                    toggle.classList.add('collapsed');
                });
                document.querySelectorAll('.ai-session-section').forEach(section => {
                    if (section.querySelector('.collapsible-section')) {
                        section.classList.add('post-generation');
                    }
                });
            }, 500);
        }
        console.log('✅ [DEBUG] updateGeneratedSessionDisplay terminé');
    }

    /**
     * NOUVELLE MÉTHODE pour ajouter effets hover aux exercices
     * 
     * LOCALISATION: Dans ai-session-manager.js, ajouter cette nouvelle méthode
     * ACTION: Ajouter cette méthode dans la classe AISessionManager
     */

    addExerciseHoverEffects() {
        const items = document.querySelectorAll('.ai-session-exercise-preview-item');
        
        items.forEach((item, index) => {
            // Effet parallax léger sur hover
            item.addEventListener('mouseenter', (e) => {
                const handle = item.querySelector('.ai-session-exercise-drag-handle');
                const number = item.querySelector('.ai-session-exercise-number');
                
                if (handle) handle.style.transform = 'translateX(-3px) scale(1.1)';
                if (number) number.style.transform = 'scale(1.1) rotate(-5deg)';
            });
            
            item.addEventListener('mouseleave', (e) => {
                const handle = item.querySelector('.ai-session-exercise-drag-handle');
                const number = item.querySelector('.ai-session-exercise-number');
                
                if (handle) handle.style.transform = 'translateX(0) scale(1)';
                if (number) number.style.transform = 'scale(1) rotate(0deg)';
            });
        });
    }

    /**
     * CORRIGER showGeneratingState() pour meilleur feedback
     * 
     * LOCALISATION: Dans ai-session-manager.js, méthode showGeneratingState()
     * ACTION: Améliorer cette méthode
     */

    showGeneratingState() {
        const generateBtn = document.getElementById('generateSessionBtn');
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération en cours...';
            generateBtn.disabled = true;
            generateBtn.style.background = 'linear-gradient(135deg, #6b7280, #4b5563)';
            generateBtn.style.transform = 'scale(0.98)';
            generateBtn.style.cursor = 'not-allowed';
        }
        
        // Animation de la section preview pendant génération
        const preview = document.getElementById('generatedSessionPreview');
        if (preview) {
            preview.style.opacity = '0.6';
            preview.style.transform = 'scale(0.98)';
            preview.style.filter = 'blur(2px)';
            preview.style.transition = 'all 0.3s ease';
        }
    }

    /**
     * CORRIGER updateButtonStates() pour reset visual
     * 
     * LOCALISATION: Dans ai-session-manager.js, méthode updateButtonStates()
     * ACTION: Améliorer cette méthode
     */

    updateButtonStates() {
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Générer Séance';
            generateBtn.disabled = false;
            generateBtn.style.background = '';
            generateBtn.style.transform = '';
            generateBtn.style.cursor = '';
        }
        
        if (regenerateBtn) {
            regenerateBtn.disabled = !this.lastGenerated;
            if (this.lastGenerated) {
                regenerateBtn.style.opacity = '1';
                regenerateBtn.style.cursor = 'pointer';
            } else {
                regenerateBtn.style.opacity = '0.5';
                regenerateBtn.style.cursor = 'not-allowed';
            }
        }
        
        // Reset preview visual
        const preview = document.getElementById('generatedSessionPreview');
        if (preview) {
            preview.style.opacity = '1';
            preview.style.transform = 'scale(1)';
            preview.style.filter = 'none';
        }
    }

    /**
     * CORRIGER markGenerationOutdated() pour nouvelle classe
     * 
     * LOCALISATION: Dans ai-session-manager.js, méthode markGenerationOutdated()
     * ACTION: Corriger cette méthode
     */

    markGenerationOutdated() {
        if (this.lastGenerated) {
            const preview = document.getElementById('generatedSessionPreview');
            if (preview && !preview.querySelector('.ai-session-outdated-message')) {
                const message = document.createElement('div');
                message.className = 'ai-session-outdated-message';
                message.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i> 
                    Paramètres modifiés - Cliquez sur "Regénérer" pour appliquer
                `;
                preview.insertBefore(message, preview.firstChild);
                
                // Animation apparition
                message.style.opacity = '0';
                message.style.transform = 'translateY(-10px)';
                message.style.transition = 'all 0.3s ease';
                
                setTimeout(() => {
                    message.style.opacity = '1';
                    message.style.transform = 'translateY(0)';
                }, 100);
            }
        }
    }

    celebrateGeneration() {
        // Animation confetti légère
        const container = this.container;
        if (!container) return;
        
        // Créer quelques particules de célébration
        for (let i = 0; i < 6; i++) {
            const particle = document.createElement('div');
            particle.innerHTML = ['🎉', '✨', '⭐', '🚀', '💪', '🔥'][i];
            particle.style.position = 'fixed';
            particle.style.fontSize = '1.5rem';
            particle.style.pointerEvents = 'none';
            particle.style.zIndex = '9999';
            particle.style.left = Math.random() * window.innerWidth + 'px';
            particle.style.top = '50%';
            particle.style.opacity = '0';
            particle.style.transition = 'all 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            
            document.body.appendChild(particle);
            
            // Animation
            setTimeout(() => {
                particle.style.opacity = '1';
                particle.style.transform = `translateY(-100px) rotate(${Math.random() * 360}deg) scale(1.2)`;
            }, i * 100);
            
            // Cleanup
            setTimeout(() => {
                particle.style.opacity = '0';
                particle.style.transform += ' translateY(-50px)';
                setTimeout(() => particle.remove(), 500);
            }, 1000 + i * 100);
        }
        
        // Animation bounce du bouton launch (utilise l'animation CSS)
        setTimeout(() => {
            const launchBtn = document.getElementById('launchAISessionBtn');
            if (launchBtn) {
                launchBtn.style.animation = 'bounce 0.8s ease-in-out';
                setTimeout(() => {
                    launchBtn.style.animation = '';
                }, 800);
            }
        }, 1500);
    }

    renderMuscleFocusOptions() {
        const muscles = [
            'pectoraux', 'dos', 'épaules', 'bras', 'jambes', 'abdominaux'
        ];
        
        return muscles.map(muscle => `
            <div class="ai-session-muscle-focus-btn ${this.params.manual_muscle_focus.includes(muscle) ? 'ai-session-selected' : ''}"
                onclick="window.aiSessionManager.toggleMuscleFocus('${muscle}')">
                ${muscle}
            </div>
        `).join('');
    }


    renderExercisePreview() {
        if (!this.lastGenerated || !this.lastGenerated.exercises) return '';
        
        const qualityScore = Math.round(this.lastGenerated.quality_score || 75);
        const pplUsed = this.lastGenerated.ppl_used || 'push';
        
        // Déterminer classe score selon valeur
        let scoreClass = 'average';
        if (qualityScore >= 85) scoreClass = 'excellent';
        else if (qualityScore >= 70) scoreClass = 'good';
        
        return `
            <div class="ai-session-generated-summary">
                <div class="ai-session-meta">
                    <div class="ai-session-exercise-count">
                        <i class="fas fa-list"></i> ${this.lastGenerated.exercises.length} exercices
                    </div>
                    <div class="ai-session-ppl-badge" data-ppl="${pplUsed}">
                        <i class="fas fa-dumbbell"></i>
                        ${pplUsed.toUpperCase()}
                    </div>
                    <div class="ai-session-quality-score" data-score="${scoreClass}">
                        <i class="fas fa-star"></i> ${qualityScore}%
                    </div>
                </div>
            </div>
            
            <div id="aiExercisesList" class="ai-session-exercises-preview-list">
                ${this.lastGenerated.exercises.map((ex, index) => this.renderSingleExercise(ex, index)).join('')}
            </div>
            
            <div class="ai-session-launch-actions">
                <button id="launchAISessionBtn" class="ai-session-btn ai-session-btn-success">
                    <i class="fas fa-rocket"></i> Lancer Séance
                </button>
                <p class="ai-session-launch-note">
                    <i class="fas fa-info-circle"></i> 
                    Interface de séance classique avec tous vos outils habituels
                </p>
            </div>
        `;
    }


    renderSingleExercise(ex, index) {
        return `
            <div class="ai-session-exercise-preview-item" data-exercise-index="${index}">
                <span class="ai-session-exercise-drag-handle" title="Glisser pour réordonner">
                    <i class="fas fa-grip-vertical"></i>
                </span>
                
                <div class="ai-session-exercise-number">${index + 1}</div>
                
                <div class="ai-session-exercise-details">
                    <div class="ai-session-exercise-name">${ex.exercise_name || ex.name}</div>
                    <div class="ai-session-exercise-params">
                        <i class="fas fa-dumbbell"></i>
                        ${ex.sets || 3} × ${ex.reps_min || 8}-${ex.reps_max || 12}
                        <i class="fas fa-clock"></i>
                        ${Math.round((ex.rest_seconds || 90) / 60)}min repos
                    </div>
                    <div class="ai-session-exercise-muscles">
                        ${(ex.muscle_groups || []).map(muscle => 
                            `<span class="ai-session-muscle-tag"><i class="fas fa-bullseye"></i> ${muscle}</span>`
                        ).join('')}
                        ${ex.equipment_required && ex.equipment_required.length > 0 ? 
                            `<span class="ai-session-equipment-tag"><i class="fas fa-tools"></i> ${ex.equipment_required[0]}</span>` : ''}
                    </div>
                </div>
                
                <div class="ai-session-exercise-actions">
                    <button class="ai-session-btn-small ai-session-btn-secondary" 
                            onclick="window.aiSessionManager.swapExercise(${index})"
                            title="Remplacer cet exercice">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
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
        if (!this.lastGenerated || !this.lastGenerated.exercises) {
            window.showToast('Aucune séance générée à lancer', 'warning');
            return;
        }
        
        try {
            console.log('🚀 Lancement séance IA avec', this.lastGenerated.exercises.length, 'exercices');
            
            // 1. Nettoyer l'état existant
            window.clearWorkoutState();
            
            // 2. Créer workout type 'free'
            const workoutData = {
                type: 'free',  // IMPORTANT : type 'free'
                ai_generated: true  // Flag pour identifier séances AI
            };
            
            const response = await window.apiPost(`/api/users/${window.currentUser.id}/workouts`, workoutData);
            window.currentWorkout = response.workout;
            window.currentWorkoutSession.workout = response.workout;
            
            // 3. Initialiser currentWorkoutSession pour séance AI
            window.currentWorkoutSession = {
                type: 'ai',  // Type custom pour tracking
                workout: response.workout,
                exercises: this.lastGenerated.exercises,
                
                // États standards
                currentExercise: null,
                currentSetNumber: 1,
                exerciseOrder: 1,
                globalSetCount: 0,
                sessionFatigue: 3,
                completedSets: [],
                totalRestTime: 0,
                totalSetTime: 0,
                startTime: new Date(),
                
                // Structures pour interface séance
                sessionExercises: {},
                completedExercisesCount: 0,
                totalExercisesCount: this.lastGenerated.exercises.length,
                
                // Support swap/skip
                skipped_exercises: [],
                swaps: [],
                modifications: [],
                pendingSwap: null,
                
                // Métadonnées AI
                aiMetadata: {
                    pplUsed: this.lastGenerated.ppl_used,
                    qualityScore: this.lastGenerated.quality_score,
                    generationParams: this.params,
                    generatedAt: new Date().toISOString()
                },
                
                // Session metadata pour backend
                session_metadata: {
                    source: 'ai_generation',
                    ppl_category: this.lastGenerated.ppl_used,
                    generation_quality: this.lastGenerated.quality_score
                }
            };
            

            // 4. Préparer sessionExercises (CORRIGER le nom de propriété)
            window.currentWorkoutSession.sessionExercises = {}; // Pas sessionDataExercises !

            this.lastGenerated.exercises.forEach((exercise, index) => {
                window.currentWorkoutSession.sessionExercises[exercise.exercise_id] = {
                    ...exercise,
                    id: exercise.exercise_id,
                    index: index + 1,
                    totalSets: exercise.default_sets || 3,
                    completedSets: 0,
                    isCompleted: false,
                    status: 'planned'
                };
            });
            
            // 5. Masquer interface AI et afficher interface workout
            const aiView = document.getElementById('ai-session');
            if (aiView) {
                aiView.classList.remove('active');
                aiView.style.display = 'none';
            }
            
            // 6. Afficher directement la vue workout
            // showView gère automatiquement le masquage des autres vues et l'affichage de workout
            // Transition plus fluide
            document.getElementById('ai-session').style.display = 'none';
            await window.showView('workout');
            await this.setupAIWorkoutInterface();
            
            window.showToast(`🤖 Séance ${this.lastGenerated.ppl_used.toUpperCase()} démarrée !`, 'success');
            
        } catch (error) {
            console.error('❌ Erreur lancement séance IA:', error);
            window.showToast('Erreur lors du lancement de la séance', 'error');
        }
    }

    async setupAIWorkoutInterface() {
        try {
            console.log('🔧 Configuration interface séance IA complète');
            
            // 1. CONFIGURATION ÉLÉMENTS INTERFACE (identique setupSessionWorkout)
            const exerciseSelection = document.getElementById('exerciseSelection');
            const currentExercise = document.getElementById('currentExercise');
            const sessionContainer = document.getElementById('sessionExercisesContainer');
            const workoutHeader = document.getElementById('workoutHeader');
            const fatigueTracker = document.getElementById('fatigueTracker');
            const workoutTitle = document.getElementById('workoutTitle');
            
            if (exerciseSelection) exerciseSelection.style.display = 'none';
            if (currentExercise) currentExercise.style.display = 'block';
            if (sessionContainer) sessionContainer.style.display = 'block';
            if (workoutHeader) workoutHeader.style.display = 'block';
            if (fatigueTracker) fatigueTracker.style.display = 'block';
            
            // Titre
            if (workoutTitle) {
                workoutTitle.textContent = `🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}`;
            }
            
            // 2. STRUCTURE DONNÉES 
            window.currentWorkoutSession.sessionDataExercises = {};
            window.currentWorkoutSession.totalExercisesCount = this.lastGenerated.exercises.length;
            
            this.lastGenerated.exercises.forEach((exercise, index) => {
                window.currentWorkoutSession.sessionDataExercises[exercise.exercise_id] = {
                    ...exercise,
                    id: exercise.exercise_id,
                    index: index + 1,
                    order: index + 1,
                    totalSets: exercise.default_sets || 3,
                    completedSets: 0,
                    isCompleted: false,
                    status: 'planned',
                    startTime: null,
                    endTime: null
                };
            });
            
            // 3. HTML EXERCICES AVEC BOUTONS
            const exercisesHTML = this.lastGenerated.exercises.map((exercise, index) => {
                const isActive = index === 0;
                return `
                    <div class="session-ai-exercise-item ${isActive ? 'session-ai-active session-ai-current' : ''}" 
                        data-exercise-id="${exercise.exercise_id}"
                        data-exercise-index="${index}"
                        onclick="selectExerciseFromAISession(${exercise.exercise_id}, ${index})">
                        
                        <div class="session-ai-order">${exercise.order_in_session}</div>
                        
                        <div class="session-ai-info">
                            <div class="session-ai-name">${exercise.name}</div>
                            <div class="session-ai-params">
                                ${exercise.default_sets}×${exercise.default_reps_min}-${exercise.default_reps_max}
                                ${exercise.equipment_required ? ` • ${exercise.equipment_required[0]}` : ''}
                            </div>
                            <div class="session-ai-muscles">
                                ${exercise.muscle_groups.map(m => `<span class="session-ai-muscle-tag">${m}</span>`).join('')}
                            </div>
                        </div>
                        
                        <div class="session-ai-status">
                            <div class="session-ai-progress">
                                <span class="session-ai-sets-counter">0/${exercise.default_sets}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
            // 4. INJECTION HTML
            sessionContainer.innerHTML = `
                <div class="session-ai-header">
                    <h3>🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}</h3>
                    <p>Score qualité: <strong>${Math.round(this.lastGenerated.quality_score)}%</strong></p>
                </div>
                <div class="session-ai-exercises-list">
                    ${exercisesHTML}
                </div>
            `;
            
            // 5. ÉLÉMENTS SPÉCIALISÉS AI
            await this.setupAIStatusElements();
            
            // 6. SÉLECTION AUTO PREMIER EXERCICE
            if (this.lastGenerated.exercises.length > 0) {
                const firstExercise = this.lastGenerated.exercises[0];
                console.log('🎯 Sélection automatique:', firstExercise.name);
                await window.selectExerciseFromAISession(firstExercise.exercise_id, 0);
            }
            
            console.log('✅ Interface séance IA configurée complètement');
            
        } catch (error) {
            console.error('❌ Erreur setup interface IA:', error);
            window.showToast('Erreur configuration interface', 'error');
        }
    }

    async setupAIStatusElements() {
        // AI STATUS LINE
        const workoutContainer = document.querySelector('#workout .container');
        if (workoutContainer && !document.getElementById('sessionAiStatusLine')) {
            const aiStatusHTML = `
                <div class="session-ai-status-line" id="sessionAiStatusLine" onclick="window.aiSessionManager.toggleAIDetails()">
                    <div class="session-ai-toggle-container">
                        <div class="session-ai-status-text">
                            <i class="fas fa-brain"></i>
                            <span id="sessionAiStatus">IA : Actif</span>
                        </div>
                        <button class="session-ai-expand-btn" type="button">
                            <i class="fas fa-chevron-down"></i>
                        </button>
                    </div>
                </div>
                
                <div class="session-ai-details-panel" id="sessionAiDetailsPanel" style="display: none;">
                    <div class="session-ai-detail-grid">
                        <div class="session-ai-detail-item">
                            <span class="session-ai-detail-label">Catégorie PPL</span>
                            <span class="session-ai-detail-value">${this.lastGenerated.ppl_used.toUpperCase()}</span>
                        </div>
                        <div class="session-ai-detail-item">
                            <span class="session-ai-detail-label">Score qualité</span>
                            <span class="session-ai-detail-value">${Math.round(this.lastGenerated.quality_score)}%</span>
                        </div>
                        <div class="session-ai-detail-item">
                            <span class="session-ai-detail-label">Exercices</span>
                            <span class="session-ai-detail-value">${this.lastGenerated.exercises.length}</span>
                        </div>
                        <div class="session-ai-detail-item">
                            <span class="session-ai-detail-label">Exploration</span>
                            <span class="session-ai-detail-value">${Math.round(this.params.exploration_factor * 100)}%</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Insérer après fatigueTracker
            const fatigueTracker = document.getElementById('fatigueTracker');
            if (fatigueTracker) {
                fatigueTracker.insertAdjacentHTML('afterend', aiStatusHTML);
            }
        }
        
        // MOTION NOTIFICATION ZONE
        const motionZone = document.getElementById('motionNotificationZone');
        if (motionZone) {
            motionZone.style.display = 'block';
        }
    }

    toggleAIDetails() {
        const panel = document.getElementById('sessionAiDetailsPanel');
        const expandBtn = document.querySelector('.session-ai-expand-btn i');
        
        if (panel) {
            const isVisible = panel.style.display === 'block';
            panel.style.display = isVisible ? 'none' : 'block';
            
            if (expandBtn) {
                expandBtn.className = isVisible ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
            }
        }
    }

    displayAISessionMetadata() {
        const workoutHeader = document.getElementById('workoutHeader');
        if (workoutHeader) {
            const metadataHTML = `
                <div class="ai-session-metadata">
                    <span class="ai-badge">🤖 IA</span>
                    <span class="ppl-badge">${this.lastGenerated.ppl_used.toUpperCase()}</span>
                    <span class="quality-badge">Score: ${Math.round(this.lastGenerated.quality_score)}%</span>
                </div>
            `;
            workoutHeader.insertAdjacentHTML('afterbegin', metadataHTML);
        }
    }
      
    renderAIsessionExercisesList() {
        /**
         * Affiche liste exercices IA dans l'interface
         */
        
        const container = document.getElementById('sessionExercisesContainer');
        if (!container || !this.lastGenerated) return;
        
        const exercises = this.lastGenerated.exercises;
        
        container.innerHTML = `
            <div class="session-exercises-header">
                <h3>🤖 Séance IA - ${this.lastGenerated.ppl_used.toUpperCase()}</h3>
                <p>Score qualité: <strong>${Math.round(this.lastGenerated.quality_score)}%</strong></p>
            </div>
            <div class="session-exercises-list">
                ${exercises.map((exercise, index) => `
                    <div class="session-exercise-card ${index === 0 ? 'active' : ''}" 
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
        const generateBtn = document.getElementById('generateSessionBtn');
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération en cours...';
            generateBtn.disabled = true;
            generateBtn.style.background = 'linear-gradient(135deg, #6b7280, #4b5563)';
            generateBtn.style.transform = 'scale(0.98)';
            generateBtn.style.cursor = 'not-allowed';
        }
        
        // Animation de la section preview pendant génération
        const preview = document.getElementById('generatedSessionPreview');
        if (preview) {
            preview.style.opacity = '0.6';
            preview.style.transform = 'scale(0.98)';
            preview.style.filter = 'blur(2px)';
            preview.style.transition = 'all 0.3s ease';
        }
    }

    updateGeneratedSessionDisplay() {
        const previewContainer = document.getElementById('exercisePreviewContainer');
        const previewSection = document.getElementById('generatedSessionPreview');
        
        if (previewContainer && this.lastGenerated) {
            // Supprimer anciens messages obsolètes
            const obsoleteMessages = previewSection?.querySelectorAll('.ai-session-outdated-message');
            obsoleteMessages?.forEach(msg => msg.remove());
            
            // Mettre à jour contenu HTML
            previewContainer.innerHTML = this.renderExercisePreview();
            
            // Initialiser fonctionnalités après un délai
            setTimeout(() => {
                this.initializeExercisesDragDrop();
                this.bindLaunchButton();
                this.addExerciseHoverEffects();
            }, 150);
            
            // Animation apparition des exercices
            setTimeout(() => {
                const items = document.querySelectorAll('.ai-session-exercise-preview-item');
                items.forEach((item, index) => {
                    item.style.opacity = '0';
                    item.style.transform = 'translateY(20px)';
                    item.style.transition = 'all 0.4s ease';
                    
                    setTimeout(() => {
                        item.style.opacity = '1';
                        item.style.transform = 'translateY(0)';
                    }, index * 100);
                });
            }, 200);
            
            // Calculer et afficher score initial avec animation
            setTimeout(() => {
                this.updateAISessionScoring(this.lastGenerated.exercises);
            }, 300);
        }
        
        if (previewSection) {
            previewSection.style.display = 'block';
        }
        
        this.updateButtonStates();
    }
    

    addExerciseHoverEffects() {
        const items = document.querySelectorAll('.ai-session-exercise-preview-item');
        
        items.forEach((item, index) => {
            // Effet parallax léger sur hover
            item.addEventListener('mouseenter', (e) => {
                const handle = item.querySelector('.ai-session-exercise-drag-handle');
                const number = item.querySelector('.ai-session-exercise-number');
                
                if (handle) handle.style.transform = 'translateX(-3px) scale(1.1)';
                if (number) number.style.transform = 'scale(1.1) rotate(-5deg)';
            });
            
            item.addEventListener('mouseleave', (e) => {
                const handle = item.querySelector('.ai-session-exercise-drag-handle');
                const number = item.querySelector('.ai-session-exercise-number');
                
                if (handle) handle.style.transform = 'translateX(0) scale(1)';
                if (number) number.style.transform = 'scale(1) rotate(0deg)';
            });
        });
    }


    bindLaunchButton() {
        console.log('🔗 [DEBUG] bindLaunchButton appelé');
        
        const launchBtn = document.getElementById('launchAISessionBtn');
        console.log('🔍 [DEBUG] Bouton trouvé:', launchBtn);
        
        if (launchBtn) {
            // Supprimer anciens listeners
            launchBtn.removeEventListener('click', this.launchAISession);
            
            // Ajouter nouveau listener avec bind correct
            const boundLaunch = this.launchAISession.bind(this);
            launchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🖱️ [DEBUG] Bouton cliqué');
                boundLaunch();
            });
            
            console.log('✅ [DEBUG] Event listener bindé');
        } else {
            console.error('❌ [DEBUG] Bouton launchAISessionBtn non trouvé');
        }
    }
        
    updateButtonStates() {
        const generateBtn = document.getElementById('generateSessionBtn');
        const regenerateBtn = document.getElementById('regenerateSessionBtn');
        
        if (generateBtn) {
            generateBtn.innerHTML = '<i class="fas fa-magic"></i> Générer Séance';
            generateBtn.disabled = false;
            generateBtn.style.background = '';
            generateBtn.style.transform = '';
            generateBtn.style.cursor = '';
        }
        
        if (regenerateBtn) {
            regenerateBtn.disabled = !this.lastGenerated;
            if (this.lastGenerated) {
                regenerateBtn.style.opacity = '1';
                regenerateBtn.style.cursor = 'pointer';
            } else {
                regenerateBtn.style.opacity = '0.5';
                regenerateBtn.style.cursor = 'not-allowed';
            }
        }
        
        // Reset preview visual
        const preview = document.getElementById('generatedSessionPreview');
        if (preview) {
            preview.style.opacity = '1';
            preview.style.transform = 'scale(1)';
            preview.style.filter = 'none';
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
    
    // ===== SCORING TEMPS RÉEL =====
        
    async updateAISessionScoring(exercises) {
        console.log('📊 [DEBUG] Calcul scoring avec', exercises.length, 'exercices');
        
        // IMPORTANT : Cette méthode évalue la QUALITÉ de l'ordre des exercices
        // Elle ne les réordonne PAS, juste calcule un score 0-100
        
        if (!exercises || exercises.length === 0) {
            console.log('⚠️ [DEBUG] Pas d\'exercices pour scoring');
            return;
        }
        
        let newScore = 75;
        
        try {
            // Backend fait calcul sophistiqué avec exercise_type, intensity_factor 
            const response = await window.apiPost('/api/ai/optimize-session', {
                user_id: window.currentUser.id,
                exercises: exercises
            });
            
            newScore = Math.round(response.quality_score || 75); // ← Maintenant cohérent
            console.log('✅ [DEBUG] Score API:', newScore);
            
        } catch (apiError) {
            console.warn('⚠️ [DEBUG] API scoring échouée, calcul local');
            newScore = this.calculateLocalQualityScore(exercises); // ← Maintenant cohérent aussi
        }
        
        // Suite inchangée...
        if (this.lastGenerated) {
            this.lastGenerated.quality_score = newScore;
        }
        
        this.animateScoreChange(newScore);
        console.log('🎯 [DEBUG] Score final:', newScore);
        return newScore;
    }
    
    calculateLocalQualityScore(exercises) {
        /**
         * Calcul local cohérent avec algorithme backend
         * Basé sur principes réels d'entraînement
         */
        
        if (!exercises || exercises.length === 0) return 50;
        
        let score = 100; // Commencer parfait, soustraire pénalités
        let totalPenalty = 0;
        let maxPossiblePenalty = 0;
        
        for (let i = 0; i < exercises.length - 1; i++) {
            const current = exercises[i];
            const next = exercises[i + 1];
            
            // PÉNALITÉ 1: Isolation avant composé
            const penalty1 = this.penaltyIsolationBeforeCompound(current, next);
            totalPenalty += penalty1;
            maxPossiblePenalty += 30;
            
            // PÉNALITÉ 2: Même muscle consécutif  
            const penalty2 = this.penaltySameMuscleConsecutive(current, next);
            totalPenalty += penalty2;
            maxPossiblePenalty += 25;
            
            // PÉNALITÉ 3: Repos incohérent
            const penalty3 = this.penaltyRestTransition(current, next);
            totalPenalty += penalty3;
            maxPossiblePenalty += 15;
        }
        
        // Score final normalisé
        if (maxPossiblePenalty === 0) return 100;
        
        const finalScore = 100 * (1 - totalPenalty / maxPossiblePenalty);
        return Math.max(40, Math.min(95, Math.round(finalScore)));
    }

    penaltyIsolationBeforeCompound(current, next) {
        // Approximation : isolation = 1 groupe musculaire, composé = 2+
        const currentCompound = (current.muscle_groups || []).length >= 2;
        const nextCompound = (next.muscle_groups || []).length >= 2;
        
        if (!currentCompound && nextCompound) {
            return 30; // Violation majeure
        }
        return 0;
    }

    penaltySameMuscleConsecutive(current, next) {
        const musclesCurrent = new Set(current.muscle_groups || []);
        const musclesNext = new Set(next.muscle_groups || []);
        
        const intersection = [...musclesCurrent].filter(m => musclesNext.has(m));
        
        if (intersection.length >= 2) return 25; // Conflit majeur
        if (intersection.length === 1) return 10; // Conflit mineur
        return 0;
    }

    penaltyRestTransition(current, next) {
        const currentRest = current.base_rest_time_seconds || 90;
        const nextRest = next.base_rest_time_seconds || 90;
        
        // Pénalité si repos long → repos court (mauvaise progression)
        if (currentRest >= 120 && nextRest <= 60) {
            return 15;
        }
        return 0;
    }
    

    animateScoreChange(newScore) {
        const scoreElement = document.querySelector('#generatedSessionPreview .ai-session-quality-score');
        if (!scoreElement) return;
        
        // Déterminer nouvelle classe selon score
        let scoreClass = 'average';
        if (newScore >= 85) scoreClass = 'excellent';
        else if (newScore >= 70) scoreClass = 'good';
        
        // Appliquer nouvelle classe avec animation
        scoreElement.setAttribute('data-score', scoreClass);
        scoreElement.innerHTML = `<i class="fas fa-star"></i> ${newScore}%`;
        
        // Animation scale
        scoreElement.style.transform = 'scale(1.15)';
        scoreElement.style.transition = 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
        
        setTimeout(() => {
            scoreElement.style.transform = 'scale(1)';
        }, 400);
        
        // Animation flash couleur
        const originalBg = scoreElement.style.background;
        if (scoreClass === 'excellent') {
            scoreElement.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            scoreElement.style.boxShadow = '0 8px 32px rgba(16, 185, 129, 0.6)';
        } else if (scoreClass === 'good') {
            scoreElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            scoreElement.style.boxShadow = '0 8px 32px rgba(245, 158, 11, 0.6)';
        } else {
            scoreElement.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
            scoreElement.style.boxShadow = '0 8px 32px rgba(239, 68, 68, 0.6)';
        }
        
        setTimeout(() => {
            scoreElement.style.background = originalBg;
        }, 1000);
    }
    
    // ===== SWAP D'EXERCICES ADAPTÉ DE PLANNING.JS =====
    
    async swapExercise(exerciseIndex) {
        if (!this.lastGenerated || !this.lastGenerated.exercises) return;
        
        const exercise = this.lastGenerated.exercises[exerciseIndex];
        if (!exercise) return;
        
        try {
            // UTILISER L'ENDPOINT EXISTANT (même que app.js)
            const response = await window.apiGet(
                `/api/exercises/${exercise.exercise_id}/alternatives?user_id=${window.currentUser.id}&reason=user_preference`
            );
            
            if (response && response.alternatives) {
                this.showSwapModal(exerciseIndex, exercise, response.alternatives);
            } else {
                window.showToast('Aucune alternative trouvée', 'warning');
            }
            
        } catch (error) {
            console.error('Erreur récupération alternatives:', error);
            window.showToast('Erreur lors de la recherche d\'alternatives', 'error');
        }
    }

    showSwapModal(exerciseIndex, currentExercise, alternatives) {
        const modalContent = `
            <div class="swap-modal-ai">
                <div class="current-exercise">
                    <h4>Exercice actuel</h4>
                    <div class="exercise-card current">
                        <span>${currentExercise.name}</span>
                        <div class="muscles">${currentExercise.muscle_groups?.join(', ') || ''}</div>
                    </div>
                </div>
                
                <div class="alternatives-section">
                    <h4>Alternatives suggérées (${alternatives.length})</h4>
                    <div class="alternatives-list">
                        ${alternatives.map((alt, index) => `
                            <div class="exercise-card alternative" 
                                onclick="window.aiSessionManager.executeSwap(${exerciseIndex}, ${alt.exercise_id})">
                                <div class="exercise-info">
                                    <span class="name">${alt.name}</span>
                                    <div class="muscles">${alt.muscle_groups?.join(', ') || ''}</div>
                                    <div class="score">Score: ${Math.round((alt.score || 0.7) * 100)}%</div>
                                </div>
                                <div class="swap-reason">${alt.reason_match || 'Alternative recommandée'}</div>
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
    }

    executeSwap(exerciseIndex, newExerciseId) {
        // Remplacer dans la liste générée
        const oldExercise = this.lastGenerated.exercises[exerciseIndex];
        
        // Récupérer les données du nouvel exercice
        window.apiGet(`/api/exercises/${newExerciseId}?user_id=${window.currentUser.id}`)
            .then(newExercise => {
                // Adapter le format pour correspondre aux exercices AI
                this.lastGenerated.exercises[exerciseIndex] = {
                    exercise_id: newExercise.id,
                    name: newExercise.name,
                    muscle_groups: newExercise.muscle_groups,
                    equipment_required: newExercise.equipment_required,
                    difficulty: newExercise.difficulty,
                    default_sets: newExercise.default_sets || oldExercise.default_sets,
                    default_reps_min: newExercise.default_reps_min || oldExercise.default_reps_min,
                    default_reps_max: newExercise.default_reps_max || oldExercise.default_reps_max,
                    base_rest_time_seconds: newExercise.base_rest_time_seconds || oldExercise.base_rest_time_seconds,
                    exercise_type: newExercise.exercise_type || 'strength',
                    order_in_session: exerciseIndex + 1,
                    instructions: newExercise.instructions || ''
                };
                
                // Mettre à jour l'affichage
                this.updateGeneratedSessionDisplay();
                window.closeModal();
                window.showToast(`${oldExercise.name} → ${newExercise.name}`, 'success');
            })
            .catch(error => {
                console.error('Erreur lors du swap:', error);
                window.showToast('Erreur lors du remplacement', 'error');
            });
    }
    
    // ===== DRAG & DROP ADAPTÉ DE PLANNING.JS =====
        
    initializeExercisesDragDrop() {
        console.log('🔄 [DEBUG] Initialisation drag & drop');
        
        const container = document.getElementById('aiExercisesList');
        if (!container) {
            console.error('❌ [DEBUG] Container aiExercisesList non trouvé');
            return;
        }
        
        if (!window.Sortable) {
            console.error('❌ [DEBUG] Sortable.js non disponible');
            return;
        }
        
        // Détruire instance existante
        if (this.sortableInstance) {
            this.sortableInstance.destroy();
            console.log('🗑️ [DEBUG] Ancienne instance Sortable détruite');
        }
        
        // Créer nouvelle instance
        this.sortableInstance = new Sortable(container, {
            animation: 150,
            handle: '.ai-session-exercise-drag-handle',
            ghostClass: 'ai-session-exercise-ghost',
            chosenClass: 'ai-session-exercise-chosen',
            
            onEnd: async (evt) => {
                console.log('📦 [DEBUG] Drag terminé:', evt.oldIndex, '→', evt.newIndex);
                
                if (evt.oldIndex === evt.newIndex) {
                    console.log('ℹ️ [DEBUG] Même position, rien à faire');
                    return;
                }
                
                try {
                    // 1. RÉORGANISER le tableau exercises
                    const [moved] = this.lastGenerated.exercises.splice(evt.oldIndex, 1);
                    this.lastGenerated.exercises.splice(evt.newIndex, 0, moved);
                    console.log('✅ [DEBUG] Tableau exercises réorganisé');
                    
                    // 2. METTRE À JOUR LES NUMÉROS dans le DOM
                    this.updateExerciseNumbers();
                    
                    // 3. RECALCULER ET ANIMER LE SCORE
                    await this.updateAISessionScoring(this.lastGenerated.exercises);
                    
                    console.log('🎯 [DEBUG] Réorganisation terminée');
                    
                } catch (error) {
                    console.error('❌ [DEBUG] Erreur pendant drag & drop:', error);
                }
            }
        });
        
        console.log('✅ [DEBUG] Sortable initialisé');
    }

        
    updateExerciseNumbers() {
        console.log('🔢 [DEBUG] Mise à jour numéros exercices');
        
        const exerciseItems = document.querySelectorAll('.ai-session-exercise-preview-item');
        
        exerciseItems.forEach((item, index) => {
            const numberElement = item.querySelector('.ai-session-exercise-number');
            if (numberElement) {
                numberElement.textContent = index + 1;
            }
            
            // Mettre à jour aussi l'attribut data
            item.setAttribute('data-exercise-index', index);
        });
        
        console.log('✅ [DEBUG] Numéros mis à jour');
    }

    makeCollapsible() {
        const pplContainer = document.getElementById('pplRecommendationContainer').parentElement;
        const paramsContainer = document.querySelector('.ai-session-params-container').parentElement;
        
        [pplContainer, paramsContainer].forEach(section => {
            if (!section.querySelector('.section-header')) {
                const h3 = section.querySelector('h3');
                if (h3) {
                    const header = document.createElement('div');
                    header.className = 'section-header';
                    header.innerHTML = `
                        ${h3.outerHTML}
                        <button class="collapse-toggle">
                            <i class="fas fa-chevron-down"></i>
                        </button>
                    `;
                    
                    const content = section.querySelector('#pplRecommendationContainer, .ai-session-params-container');
                    content.className += ' collapsible-section';
                    
                    h3.replaceWith(header);
                    
                    header.addEventListener('click', () => {
                        content.classList.toggle('collapsed');
                        header.querySelector('.collapse-toggle').classList.toggle('collapsed');
                        section.classList.toggle('post-generation');
                    });
                }
            }
        });
    }


}

// Exposer la classe globalement
window.AISessionManager = AISessionManager;