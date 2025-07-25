class ProgramBuilder {
    constructor() {
        this.currentStep = 0;
        this.totalSteps = 0;
        this.userData = null;
        this.recommendations = null;
        this.selections = {
            training_frequency: 4,
            session_duration: 60,
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
        //  Initialiser le ProgramBuilder avec les données utilisateur de l'onboarding
        this.userData = userData;
        // Présélectionner les focus_areas depuis l'onboarding
        if (userData.focus_areas && userData.focus_areas.length > 0) {
            this.selections.focus_areas = [...userData.focus_areas];
            console.log('Focus areas pré-sélectionnées depuis onboarding:', this.selections.focus_areas);
        }
        try {
            // Vérifier que currentUser est disponible
            if (!window.currentUser || !window.currentUser.id) {
                console.error('currentUser non disponible dans ProgramBuilder');
                throw new Error('Utilisateur non connecté');
            }
            
            window.showToast('Analyse de votre profil...', 'info');
            
            //  Préparer les données pour l'API
            const builderData = {
                duration_weeks: 8,
                goals: ["muscle", "strength"], //  Default, sera affiné
                training_frequency: 4,
                experience_level: userData.experience_level,
                available_time_per_session: 60
            };
            
            //  Appeler l'API pour obtenir recommandations personnalisées
            this.recommendations = await window.apiPost(
                `/api/users/${window.currentUser.id}/program-builder/start`, 
                builderData
            );
            
            this.totalSteps = this.recommendations.questionnaire_items.length + 2; //  +2 pour preview et confirmation
            
            //  Afficher l'interface ProgramBuilder
            this.render();
            
        } catch (error) {
            console.error('Erreur initialisation ProgramBuilder:', error);
            window.showToast('Erreur lors de l\'initialisation. Redirection...', 'error');
            setTimeout(() => window.showMainInterface(), 2000);
        }
    }
    
    async render() {
        // Afficher l'interface ProgramBuilder
        //  Cacher toutes les autres vues
        document.querySelectorAll('.view').forEach(el => {
            el.classList.remove('active');
        });
        
        //  Créer l'interface si elle n'existe pas
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

        // forcer le scroll en haut
        window.scrollTo(0, 0);
        builderContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                
        //  Afficher la première étape
        this.renderStep();
    }
    

    renderStep() {
        const content = document.getElementById('builderContent');
        const currentStepNum = document.getElementById('currentStepNum');
        const prevBtn = document.getElementById('builderPrevBtn');
        const nextBtn = document.getElementById('builderNextBtn');
        
        currentStepNum.textContent = this.currentStep + 1;
        
        // Afficher/masquer bouton précédent
        prevBtn.style.display = this.currentStep > 0 ? 'block' : 'none';
        
        // ✅ CORRECTION : Logique de boutons simplifiée
        if (this.currentStep === this.totalSteps - 1) {
            // Dernière étape : un seul bouton "Activer le programme"
            nextBtn.textContent = "🚀 Activer le programme";
            nextBtn.className = "btn btn-primary btn-large";
            nextBtn.style.background = "linear-gradient(135deg, var(--success), var(--success-dark))";
        } else if (this.currentStep === this.totalSteps - 2) {
            // Avant-dernière étape (preview) : "Confirmer et continuer"
            nextBtn.textContent = "Confirmer et continuer";
            nextBtn.className = "btn btn-primary";
            nextBtn.style.background = "";
        } else {
            // Étapes normales : "Continuer"
            nextBtn.textContent = "Continuer";
            nextBtn.className = "btn btn-primary";
            nextBtn.style.background = "";
        }
        
        // Contenu selon l'étape
        if (this.currentStep === 0) {
            // Première étape : introduction
            this.renderIntroStep(content);
        } else if (this.currentStep === this.totalSteps - 1) {
            // Dernière étape : confirmation finale
            this.renderFinalConfirmation(content);
        } else if (this.currentStep === this.totalSteps - 2) {
            // Avant-dernière : preview du programme
            this.renderPreviewStep(content);
        } else {
            // Étapes de questions (1 à totalSteps-3)
            this.renderQuestionStep(content, this.currentStep - 1);
        }
    }

    /**
     * Rendu de la confirmation finale (remplace les boutons redondants)
     */
    renderFinalConfirmation(content) {
        content.innerHTML = `
            <div class="confirmation-step">
                <div class="success-icon">🎉</div>
                <h3>Programme prêt !</h3>
                <p class="confirmation-text">
                    Votre programme personnalisé <strong>"${this.generatedProgram?.name || 'Programme personnalisé'}"</strong> 
                    est configuré et prêt à être activé.
                </p>
                
                <div class="program-summary-final">
                    <div class="summary-item">
                        <strong>${this.selections.training_frequency || 3}</strong>
                        <span>séances/semaine</span>
                    </div>
                    <div class="summary-item">
                        <strong>${this.selections.session_duration || 60}</strong>
                        <span>minutes/séance</span>
                    </div>
                    <div class="summary-item">
                        <strong>${this.selections.focus_areas?.length || 0}</strong>
                        <span>zones ciblées</span>
                    </div>
                </div>
                
                <div class="next-steps">
                    <h4>Prochaines étapes :</h4>
                    <ul>
                        <li>✅ Accès immédiat au planning hebdomadaire</li>
                        <li>✅ Séances adaptées à votre progression</li>
                        <li>✅ Suivi intelligent de votre récupération</li>
                    </ul>
                </div>
            </div>
        `;
    }

    /**
     * Amélioration du preview (avant-dernière étape)
     */
    renderProgramPreview(content) {
        if (!this.generatedProgram) {
            content.innerHTML = `
                <div class="loading-step">
                    <div class="loading-spinner"></div>
                    <p>Génération de votre programme personnalisé...</p>
                </div>
            `;
            
            // Générer async sans bloquer l'UI
            this.generateProgramAsync(content);
            return;
        }
        
        // Programme déjà généré, afficher le contenu
        content.innerHTML = `
            <div class="preview-step">
                <h3>Aperçu de votre programme</h3>
                <p class="preview-subtitle">Vérifiez que tout correspond à vos attentes</p>
                
                <div class="program-overview">
                    <div class="overview-header">
                        <h4>${this.generatedProgram.name}</h4>
                        <div class="overview-stats">
                            <span class="stat">${this.generatedProgram.duration_weeks} semaines</span>
                            <span class="stat">${this.generatedProgram.sessions_per_week} séances/sem</span>
                            <span class="stat">${this.generatedProgram.session_duration_minutes}min/séance</span>
                        </div>
                    </div>
                    
                    <div class="focus-areas-preview">
                        <strong>Zones ciblées :</strong>
                        <div class="focus-tags">
                            ${this.generatedProgram.focus_areas.map(area => 
                                `<span class="focus-tag">${this.getFocusAreaName(area)}</span>`
                            ).join('')}
                        </div>
                    </div>
                    
                    <div class="week-preview">
                        <strong>Aperçu première semaine :</strong>
                        ${this.generatedProgram.weekly_structure?.[0] ? 
                            this.renderWeekPreview(this.generatedProgram.weekly_structure[0]) : 
                            '<p>Séances générées automatiquement</p>'
                        }
                    </div>
                </div>
                
                <div class="preview-actions">
                    <button class="btn btn-secondary" onclick="programBuilder.regenerateProgram()">
                        🔄 Régénérer
                    </button>
                </div>
            </div>
        `;
    }

    async generateProgramAsync(content) {
        try {
            window.showToast('Génération de votre programme...', 'info');
            
            this.generatedProgram = await window.apiPost(
                `/api/users/${window.currentUser.id}/program-builder/generate`,
                this.selections
            );
            
            // Re-render maintenant qu'on a le programme
            this.renderProgramPreview(content);
            
        } catch (error) {
            console.error('Erreur génération programme:', error);
            content.innerHTML = `
                <div class="error-step">
                    <h3>❌ Erreur lors de la génération</h3>
                    <p>Une erreur est survenue. Voulez-vous réessayer ?</p>
                    <button class="btn btn-primary" onclick="programBuilder.renderStep()">
                        Réessayer
                    </button>
                </div>
            `;
            window.showToast('Erreur lors de la génération du programme', 'error');
        }
    }

    renderIntroStep(content) {
        // Afficher l'étape d'introduction avec insights ML
        if (!this.recommendations) {
            content.innerHTML = `
                <div class="intro-step">
                    <div class="welcome-section">
                        <h3>🎯 Créons votre programme idéal</h3>
                        <p class="intro-text">
                            Préparation de votre programme personnalisé en cours...
                        </p>
                    </div>
                    <div class="error-message">
                        <p>Impossible de charger les recommandations. Le programme sera créé avec les paramètres par défaut.</p>
                    </div>
                </div>
            `;
            return;
        }
        
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
        // Afficher une question du questionnaire
        const question = this.recommendations.questionnaire_items[questionIndex];
        
        // Texte de présélection pour focus_selection
        let preselectText = '';
        if (question.id === 'focus_selection' && this.userData.focus_areas && this.userData.focus_areas.length > 0) {
            const preselectNames = this.userData.focus_areas.map(area => this.getFocusAreaName(area)).join(', ');
            preselectText = `<p class="preselection-hint">💡 Présélectionné depuis votre profil : ${preselectNames}</p>`;
        }
    
        content.innerHTML = `
            <div class="question-step">
                <div class="question-header">
                    <h3>${question.question}</h3>
                    ${question.min_selections && question.max_selections ?
                        `<p class="question-subtitle">Sélectionnez ${question.min_selections} à ${question.max_selections} option(s)</p>`
                        : ''}
                    ${preselectText}
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
    
        //  Restaurer les sélections précédentes
        this.restoreSelections(question.id);
    }
    
    async renderPreviewStep(content) {
        //  Générer et afficher le preview du programme//  
        try {
            window.showToast('Génération de votre programme...', 'info');
            
            //  Générer le programme via l'API
            this.generatedProgram = await window.apiPost(
                `/api/users/${window.currentUser.id}/program-builder/generate`,
                this.selections
            );

            if (this.updateScoreDisplay) {
                this.updateScoreDisplay(this.generatedProgram.base_quality_score || 0);
            }
            
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
        //  Étape de confirmation finale//  
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
        
        //  Masquer le bouton "Continuer"
        document.getElementById('builderNextBtn').style.display = 'none';
    }
    
    //  ===== MÉTHODES D'INTERACTION =====
    
    selectOption(questionId, value, isMultiple) {
        //  Gérer la sélection d'options//  
        const optionCard = document.querySelector(`[data-value="${value}"]`);
        
        if (isMultiple) {
            //  Sélection multiple
            if (questionId === 'focus_selection') {
                const isSelected = this.selections.focus_areas.includes(value);
                
                if (isSelected) {
                    //  Désélectionner
                    this.selections.focus_areas = this.selections.focus_areas.filter(v => v !== value);
                    optionCard.classList.remove('selected');
                } else {
                    //  Sélectionner (max 3)
                    if (this.selections.focus_areas.length < 3) {
                        this.selections.focus_areas.push(value);
                        optionCard.classList.add('selected');
                    } else {
                        window.showToast('Maximum 3 zones sélectionnables', 'warning');
                    }
                }
            }
        } else {
            //  Sélection unique
            //  Désélectionner toutes les autres options
            document.querySelectorAll('.option-card').forEach(card => {
                card.classList.remove('selected');
            });
            
            //  Sélectionner l'option cliquée
            optionCard.classList.add('selected');
            this.selections[questionId] = value;
        }
        
        this.updateNextButton();
    }
    
    restoreSelections(questionId) {
        //  Restaurer les sélections précédentes//  
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
        //  Mettre à jour l'état du bouton Continuer//  
        const nextBtn = document.getElementById('builderNextBtn');
        const hasValidSelection = this.validateCurrentStep();
        
        nextBtn.disabled = !hasValidSelection;
        nextBtn.textContent = this.currentStep === this.totalSteps - 1 ? 'Terminer' : 'Continuer';
    }
    
    validateCurrentStep() {
        //  Valider l'étape actuelle//  
        if (this.currentStep === 0) return true; //  Intro
        
        if (this.currentStep <= this.recommendations.questionnaire_items.length) {
            const questionIndex = this.currentStep - 1;
            const question = this.recommendations.questionnaire_items[questionIndex];
            
            if (question.id === 'focus_selection') {
                return this.selections.focus_areas.length >= 1;
            } else {
                return this.selections[question.id] !== undefined;
            }
        }
        
        return true; //  Preview et confirmation
    }
    
    //  ===== NAVIGATION =====
    
    async nextStep() {
        //  Passer à l'étape suivante//  
        if (!this.validateCurrentStep()) {
            window.showToast('Veuillez faire une sélection', 'warning');
            return;
        }
        
        if (this.currentStep < this.totalSteps - 1) {
            this.currentStep++;
            this.renderStep();
        } else {
            this.complete();
        }
    }
    
    async previousStep() {
        //  Revenir à l'étape précédente//  
        if (this.currentStep > 0) {
            this.currentStep--;
            this.renderStep();
        }
    }
    
    async regenerateProgram() {
        try {
            window.showToast('Régénération en cours...', 'info');
            this.generatedProgram = await window.apiPost(
                `/api/users/${window.currentUser.id}/program-builder/generate`,
                this.selections
            );
            this.renderStep(); // PAS await - va juste re-render avec le nouveau programme
            window.showToast('Nouveau programme généré !', 'success');
        } catch (error) {
            window.showToast('Erreur lors de la régénération', 'error');
        }
    }
    
    async confirmProgram() {
        //  Confirmer le programme et passer à l'étape finale//  
        this.currentStep++;
        this.renderStep();
    }
    
    async complete() {
        try {
            // Le programme est déjà généré et activé !
            // Pas besoin d'appel API supplémentaire
            
            window.showToast('Programme créé et activé avec succès !', 'success');
            
            // Forcer un rechargement complet pour s'assurer que tout est à jour
            setTimeout(() => {
                window.location.reload();
            }, 1500);
            
        } catch (error) {
            console.error('Erreur finalisation programme:', error);
            window.showToast('Erreur lors de la finalisation. Veuillez réessayer.', 'error');
        }
    }
    
    goToDashboard() {
        //  Retourner au dashboard principal//  
        window.showToast('Programme activé ! Prêt à commencer', 'success');
        window.showMainInterface();
    }
    
    //  ===== MÉTHODES UTILITAIRES =====
    
    getFocusAreaName(area) {
        //  Convertir les clés focus_areas en noms lisibles//  
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
        //  Afficher un aperçu d'une semaine//  
        return weekData.sessions.map((session, index) => `
            <div class="session-preview">
                <div class="session-day">Jour ${index + 1}</div>
                <div class="session-focus">${this.getFocusAreaName(session.focus)}</div>
                <div class="session-exercises">${session.exercise_pool.length} exercices</div>
            </div>
        `).join('');
    }
}

//  ===== INSTANCE GLOBALE =====
window.programBuilder = new ProgramBuilder();