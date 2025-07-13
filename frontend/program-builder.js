// ===== NOUVEAU FICHIER: frontend/program-builder.js =====

class ProgramBuilder {
    constructor() {
        this.currentStep = 0;
        this.totalSteps = 0;
        this.userData = null;
        this.recommendations = null;
        this.selections = {
            focus_areas: [],
            periodization_preference: "linear",
            exercise_variety_preference: "balanced",
            session_intensity_preference: "moderate",
            recovery_priority: "balanced",
            equipment_priorities: [],
            time_constraints: {}
        };
        this.generatedProgram = null;
    }
    
    async initialize(userData) {
        //Initialiser le ProgramBuilder avec les données utilisateur de l'onboarding
        this.userData = userData;
        
        try {
            showToast('Analyse de votre profil...', 'info');
            
            // Préparer les données pour l'API
            const builderData = {
                duration_weeks: 8,
                goals: ["muscle", "strength"], // Default, sera affiné
                training_frequency: 4,
                experience_level: userData.experience_level,
                available_time_per_session: 60
            };
            
            // Appeler l'API pour obtenir recommandations personnalisées
            this.recommendations = await apiPost(
                `/api/users/${currentUser.id}/program-builder/start`, 
                builderData
            );
            
            this.totalSteps = this.recommendations.questionnaire_items.length + 2; // +2 pour preview et confirmation
            
            // Afficher l'interface ProgramBuilder
            this.render();
            
        } catch (error) {
            console.error('Erreur initialisation ProgramBuilder:', error);
            showToast('Erreur lors de l\'initialisation. Redirection...', 'error');
            setTimeout(() => showMainInterface(), 2000);
        }
    }
    
    render() {
        //Afficher l'interface ProgramBuilder
        // Cacher toutes les autres vues
        document.querySelectorAll('.view').forEach(el => {
            el.classList.remove('active');
        });
        
        // Créer l'interface si elle n'existe pas
        let builderContainer = document.getElementById('programBuilder');
        if (!builderContainer) {
            builderContainer = document.createElement('div');
            builderContainer.id = 'programBuilder';
            builderContainer.className = 'view';
            document.body.appendChild(builderContainer);
        }
        
        builderContainer.innerHTML = `
            <div class="program-builder-container">
                <div class="builder-header">
                    <h2>Création de votre programme personnalisé</h2>
                    <div class="progress-bar">
                        <div class="progress-fill" id="builderProgress"></div>
                    </div>
                    <p class="progress-text">Étape <span id="currentStepNum">1</span> sur <span id="totalStepsNum">${this.totalSteps}</span></p>
                </div>
                
                <div class="builder-content" id="builderContent">
                    <!-- Le contenu sera injecté ici -->
                </div>
                
                <div class="builder-navigation">
                    <button class="btn btn-secondary" id="builderPrevBtn" onclick="programBuilder.previousStep()" style="display: none;">
                        Précédent
                    </button>
                    <button class="btn btn-primary" id="builderNextBtn" onclick="programBuilder.nextStep()">
                        Continuer
                    </button>
                </div>
            </div>
        `;
        
        builderContainer.classList.add('active');
        
        // Afficher la première étape
        this.renderStep();
    }
    
    renderStep() {
        //Afficher l'étape actuelle
        const content = document.getElementById('builderContent');
        const currentStepNum = document.getElementById('currentStepNum');
        const prevBtn = document.getElementById('builderPrevBtn');
        const nextBtn = document.getElementById('builderNextBtn');
        
        currentStepNum.textContent = this.currentStep + 1;
        
        // Afficher/masquer boutons navigation
        prevBtn.style.display = this.currentStep > 0 ? 'block' : 'none';
        
        // Mise à jour barre de progression
        const progress = ((this.currentStep + 1) / this.totalSteps) * 100;
        document.getElementById('builderProgress').style.width = `${progress}%`;
        
        if (this.currentStep === 0) {
            // Étape d'introduction
            this.renderIntroStep(content);
        } else if (this.currentStep <= this.recommendations.questionnaire_items.length) {
            // Étapes de questionnaire
            this.renderQuestionStep(content, this.currentStep - 1);
        } else if (this.currentStep === this.recommendations.questionnaire_items.length + 1) {
            // Étape de génération et preview
            this.renderPreviewStep(content);
        } else {
            // Étape de confirmation finale
            this.renderConfirmationStep(content);
        }
    }
    
    renderIntroStep(content) {
        //Afficher l'étape d'introduction avec insights ML
        const insights = this.recommendations.user_insights;
        
        content.innerHTML = `
            <div class="intro-step">
                <div class="welcome-section">
                    <h3>🎯 Créons votre programme idéal</h3>
                    <p class="intro-text">
                        Basé sur votre profil, nous allons créer un programme personnalisé 
                        sur <strong>${this.recommendations.suggested_duration} semaines</strong> 
                        avec <strong>${this.recommendations.suggested_frequency} séances par semaine</strong>.
                    </p>
                </div>
                
                <div class="insights-section">
                    <h4>🧠 Recommandations personnalisées</h4>
                    <div class="insights-list">
                        ${insights.map(insight => `
                            <div class="insight-item">
                                <i class="fas fa-lightbulb"></i>
                                <span>${insight}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="confidence-section">
                    <div class="confidence-indicator">
                        <span>Niveau de confiance ML</span>
                        <div class="confidence-bar">
                            <div class="confidence-fill" style="width: ${this.recommendations.confidence_level * 100}%"></div>
                        </div>
                        <span class="confidence-percentage">${Math.round(this.recommendations.confidence_level * 100)}%</span>
                    </div>
                </div>
                
                <p class="intro-footer">
                    Nous allons vous poser quelques questions pour affiner votre programme. 
                    Cela prendra moins de 2 minutes.
                </p>
            </div>
        `;
    }
    
    renderQuestionStep(content, questionIndex) {
        //Afficher une question du questionnaire
        const question = this.recommendations.questionnaire_items[questionIndex];
        
        content.innerHTML = `
            <div class="question-step">
                <div class="question-header">
                    <h3>${question.question}</h3>
                    ${question.min_selections && question.max_selections ? 
                        `<p class="question-subtitle">Sélectionnez ${question.min_selections} à ${question.max_selections} option(s)</p>` 
                        : ''}
                </div>
                
                <div class="options-container">
                    ${question.options.map((option, index) => `
                        <div class="option-card ${option.recommended ? 'recommended' : ''}" 
                             data-value="${option.value}"
                             onclick="programBuilder.selectOption('${question.id}', '${option.value}', ${question.type === 'multiple_choice'})">
                            <div class="option-content">
                                <div class="option-label">${option.label}</div>
                                ${option.recommended ? '<div class="recommended-badge">Recommandé</div>' : ''}
                            </div>
                            <div class="option-checkbox">
                                <i class="fas ${question.type === 'multiple_choice' ? 'fa-square' : 'fa-circle'}"></i>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Restaurer les sélections précédentes
        this.restoreSelections(question.id);
    }
    
    async renderPreviewStep(content) {
        // Générer et afficher le preview du programme// 
        try {
            showToast('Génération de votre programme...', 'info');
            
            // Générer le programme via l'API
            this.generatedProgram = await apiPost(
                `/api/users/${currentUser.id}/program-builder/generate`,
                this.selections
            );
            
            content.innerHTML = `
                <div class="preview-step">
                    <div class="preview-header">
                        <h3>🎉 Votre programme est prêt !</h3>
                        <p class="program-name">${this.generatedProgram.name}</p>
                    </div>
                    
                    <div class="program-overview">
                        <div class="overview-stats">
                            <div class="stat-item">
                                <div class="stat-value">${this.generatedProgram.duration_weeks}</div>
                                <div class="stat-label">Semaines</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">${this.generatedProgram.sessions_per_week}</div>
                                <div class="stat-label">Séances/semaine</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">${this.generatedProgram.session_duration_minutes}min</div>
                                <div class="stat-label">Par séance</div>
                            </div>
                        </div>
                        
                        <div class="quality-score">
                            <h4>Score de qualité du programme</h4>
                            <div class="score-circle">
                                <div class="score-value">${Math.round(this.generatedProgram.base_quality_score)}/100</div>
                            </div>
                        </div>
                        
                        <div class="focus-areas">
                            <h4>Zones ciblées</h4>
                            <div class="focus-tags">
                                ${this.generatedProgram.focus_areas.map(area => `
                                    <span class="focus-tag">${this.getFocusAreaName(area)}</span>
                                `).join('')}
                            </div>
                        </div>
                        
                        <div class="weekly-preview">
                            <h4>Aperçu de la première semaine</h4>
                            <div class="week-sessions">
                                ${this.renderWeekPreview(this.generatedProgram.weekly_structure[0])}
                            </div>
                        </div>
                    </div>
                    
                    <div class="preview-actions">
                        <button class="btn btn-secondary" onclick="programBuilder.regenerateProgram()">
                            🔄 Régénérer
                        </button>
                        <button class="btn btn-success" onclick="programBuilder.confirmProgram()">
                            ✅ Confirmer ce programme
                        </button>
                    </div>
                </div>
            `;
            
        } catch (error) {
            console.error('Erreur génération programme:', error);
            content.innerHTML = `
                <div class="error-step">
                    <h3>❌ Erreur lors de la génération</h3>
                    <p>Une erreur est survenue. Voulez-vous réessayer ?</p>
                    <button class="btn btn-primary" onclick="programBuilder.renderPreviewStep(document.getElementById('builderContent'))">
                        Réessayer
                    </button>
                </div>
            `;
        }
    }
    
    renderConfirmationStep(content) {
        // Étape de confirmation finale// 
        content.innerHTML = `
            <div class="confirmation-step">
                <div class="success-animation">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h3>🎉 Programme créé avec succès !</h3>
                <p class="confirmation-text">
                    Votre programme personnalisé est maintenant actif. 
                    Vous pouvez commencer votre première séance quand vous voulez !
                </p>
                
                <div class="next-steps">
                    <h4>Prochaines étapes :</h4>
                    <ul>
                        <li>📱 Votre programme s'adaptera à vos performances</li>
                        <li>🧠 L'IA ajustera les poids et repos automatiquement</li>
                        <li>📊 Suivez votre progression semaine par semaine</li>
                    </ul>
                </div>
                
                <div class="final-actions">
                    <button class="btn btn-primary btn-large" onclick="programBuilder.goToDashboard()">
                        Commencer maintenant
                    </button>
                </div>
            </div>
        `;
        
        // Masquer le bouton "Continuer"
        document.getElementById('builderNextBtn').style.display = 'none';
    }
    
    // ===== MÉTHODES D'INTERACTION =====
    
    selectOption(questionId, value, isMultiple) {
        // Gérer la sélection d'options// 
        const optionCard = document.querySelector(`[data-value="${value}"]`);
        
        if (isMultiple) {
            // Sélection multiple
            if (questionId === 'focus_selection') {
                const isSelected = this.selections.focus_areas.includes(value);
                
                if (isSelected) {
                    // Désélectionner
                    this.selections.focus_areas = this.selections.focus_areas.filter(v => v !== value);
                    optionCard.classList.remove('selected');
                } else {
                    // Sélectionner (max 3)
                    if (this.selections.focus_areas.length < 3) {
                        this.selections.focus_areas.push(value);
                        optionCard.classList.add('selected');
                    } else {
                        showToast('Maximum 3 zones sélectionnables', 'warning');
                    }
                }
            }
        } else {
            // Sélection unique
            // Désélectionner toutes les autres options
            document.querySelectorAll('.option-card').forEach(card => {
                card.classList.remove('selected');
            });
            
            // Sélectionner l'option cliquée
            optionCard.classList.add('selected');
            this.selections[questionId] = value;
        }
        
        this.updateNextButton();
    }
    
    restoreSelections(questionId) {
        // Restaurer les sélections précédentes// 
        if (questionId === 'focus_selection') {
            this.selections.focus_areas.forEach(value => {
                const card = document.querySelector(`[data-value="${value}"]`);
                if (card) card.classList.add('selected');
            });
        } else if (this.selections[questionId]) {
            const card = document.querySelector(`[data-value="${this.selections[questionId]}"]`);
            if (card) card.classList.add('selected');
        }
        
        this.updateNextButton();
    }
    
    updateNextButton() {
        // Mettre à jour l'état du bouton Continuer// 
        const nextBtn = document.getElementById('builderNextBtn');
        const hasValidSelection = this.validateCurrentStep();
        
        nextBtn.disabled = !hasValidSelection;
        nextBtn.textContent = this.currentStep === this.totalSteps - 1 ? 'Terminer' : 'Continuer';
    }
    
    validateCurrentStep() {
        // Valider l'étape actuelle// 
        if (this.currentStep === 0) return true; // Intro
        
        if (this.currentStep <= this.recommendations.questionnaire_items.length) {
            const questionIndex = this.currentStep - 1;
            const question = this.recommendations.questionnaire_items[questionIndex];
            
            if (question.id === 'focus_selection') {
                return this.selections.focus_areas.length >= 1;
            } else {
                return this.selections[question.id] !== undefined;
            }
        }
        
        return true; // Preview et confirmation
    }
    
    // ===== NAVIGATION =====
    
    nextStep() {
        // Passer à l'étape suivante// 
        if (!this.validateCurrentStep()) {
            showToast('Veuillez faire une sélection', 'warning');
            return;
        }
        
        if (this.currentStep < this.totalSteps - 1) {
            this.currentStep++;
            this.renderStep();
        } else {
            this.complete();
        }
    }
    
    previousStep() {
        // Revenir à l'étape précédente// 
        if (this.currentStep > 0) {
            this.currentStep--;
            this.renderStep();
        }
    }
    
    async regenerateProgram() {
        // Régénérer le programme avec les mêmes sélections// 
        try {
            showToast('Régénération en cours...', 'info');
            this.generatedProgram = await apiPost(
                `/api/users/${currentUser.id}/program-builder/generate`,
                this.selections
            );
            this.renderStep(); // Re-render preview
            showToast('Nouveau programme généré !', 'success');
        } catch (error) {
            showToast('Erreur lors de la régénération', 'error');
        }
    }
    
    confirmProgram() {
        // Confirmer le programme et passer à l'étape finale// 
        this.currentStep++;
        this.renderStep();
    }
    
    complete() {
        // Terminer le ProgramBuilder// 
        this.goToDashboard();
    }
    
    goToDashboard() {
        // Retourner au dashboard principal// 
        showToast('Programme activé ! Prêt à commencer', 'success');
        showMainInterface();
    }
    
    // ===== MÉTHODES UTILITAIRES =====
    
    getFocusAreaName(area) {
        // Convertir les clés focus_areas en noms lisibles// 
        const names = {
            'upper_body': 'Haut du corps',
            'legs': 'Jambes',
            'core': 'Abdominaux',
            'back': 'Dos',
            'shoulders': 'Épaules',
            'arms': 'Bras'
        };
        return names[area] || area;
    }
    
    renderWeekPreview(weekData) {
        // Afficher un aperçu d'une semaine// 
        return weekData.sessions.map((session, index) => `
            <div class="session-preview">
                <div class="session-day">Jour ${index + 1}</div>
                <div class="session-focus">${this.getFocusAreaName(session.focus)}</div>
                <div class="session-exercises">${session.exercise_pool.length} exercices</div>
            </div>
        `).join('');
    }
}

// ===== INSTANCE GLOBALE =====
// ===== INSTANCE GLOBALE =====
let programBuilder = new ProgramBuilder();

// ===== ACCÈS AUX FONCTIONS GLOBALES =====
// Ces fonctions sont définies dans app.js, on les récupère depuis window
const showToast = window.showToast || function(msg, type) { console.log(msg); };
const apiPost = window.apiPost || function() { throw new Error('apiPost non disponible'); };
const currentUser = () => window.currentUser;
const showMainInterface = window.showMainInterface || function() { console.log('showMainInterface non disponible'); };
const showModal = window.showModal || function() { console.log('showModal non disponible'); };
const closeModal = window.closeModal || function() { console.log('closeModal non disponible'); };
