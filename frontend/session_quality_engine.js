class SessionQualityEngine {
    /**
     * Calcule le score de qualité d'une session (0-100 points)
     * @param {Array} exercises - Format réel: [{exercise_id, exercise_name, sets, reps_min, reps_max, predicted_weight}]
     * @param {Object} userContext - {user_id, program_id}
     * @returns {Object} Score total + breakdown + suggestions + confidence
     */
    static async calculateScore(exercises, userContext) {
        if (!exercises || exercises.length === 0) {
            return this.getEmptyScore();
        }

        try {
            // Récupérer les données nécessaires via APIs existantes
            const [exerciseDetails, recentWorkouts, userProfile] = await Promise.all([
                this.getExerciseDetails(exercises),
                this.getRecentWorkouts(userContext.user_id),
                this.getUserProfile(userContext.user_id)
            ]);

            // 1. Score Rotation Musculaire (25 pts) - utilise body_part réel
            const muscleRotationScore = this.scoreMuscleRotation(exerciseDetails);
            
            // 2. Score Récupération (25 pts) - calcul basé sur historique réel
            const recoveryScore = this.scoreRecovery(exerciseDetails, recentWorkouts);
            
            // 3. Score Progression (25 pts) - analyse trends réelles
            const progressionScore = this.scoreProgression(exerciseDetails, recentWorkouts);
            
            // 4. Score Adhérence (25 pts) - basé sur profil utilisateur réel
            const adherenceScore = this.scoreAdherence(exercises, userProfile);
            
            const total = Math.round(muscleRotationScore + recoveryScore + progressionScore + adherenceScore);
            
            return {
                total: Math.min(100, Math.max(0, total)),
                breakdown: {
                    muscleRotationScore: Math.round(muscleRotationScore),
                    recoveryScore: Math.round(recoveryScore), 
                    progressionScore: Math.round(progressionScore),
                    adherenceScore: Math.round(adherenceScore)
                },
                suggestions: this.generateSuggestions(exercises, {
                    muscleRotation: muscleRotationScore,
                    recovery: recoveryScore,
                    progression: progressionScore,
                    adherence: adherenceScore
                }),
                confidence: this.calculateConfidence(exerciseDetails, recentWorkouts),
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('❌ Erreur calcul scoring:', error);
            return this.getFallbackScore();
        }
    }

    /**
     * Récupère les détails des exercices via l'API existante
     */
    static async getExerciseDetails(exercises) {
        try {
            // Vérifier que apiGet et currentUser sont disponibles
            if (typeof apiGet === 'undefined' || typeof currentUser === 'undefined') {
                console.warn('apiGet ou currentUser non disponible, utilisation fallback');
                return exercises.map(ex => ({
                    ...ex,
                    body_part: 'unknown',
                    muscle_groups: ['unknown'],
                    difficulty: 'intermediate',
                    exercise_type: 'compound'
                }));
            }
            
            const allExercises = await apiGet(`/api/exercises?user_id=${currentUser.id}`);
            
            return exercises.map(ex => {
                const detail = allExercises.find(e => e.id === ex.exercise_id);
                return {
                    ...ex,
                    body_part: detail?.body_part || 'unknown',
                    muscle_groups: detail?.muscle_groups || [detail?.body_part || 'unknown'],
                    difficulty: detail?.difficulty || 'intermediate',
                    exercise_type: detail?.exercise_type || 'compound'
                };
            });
        } catch (error) {
            console.warn('Impossible de récupérer détails exercices:', error);
            return exercises.map(ex => ({
                ...ex,
                body_part: 'unknown',
                muscle_groups: ['unknown'],
                difficulty: 'intermediate',
                exercise_type: 'compound'
            }));
        }
    }

    /**
     * Récupère l'historique récent via l'API existante
     */
    static async getRecentWorkouts(userId, days = 14) {
        try {
            // Vérifier que apiGet est disponible
            if (typeof apiGet === 'undefined') {
                console.warn('apiGet non disponible, retour array vide');
                return [];
            }
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            
            const workouts = await apiGet(`/api/users/${userId}/workouts?limit=20`);
            
            return workouts.filter(w => 
                w.status === 'completed' && 
                new Date(w.completed_at) >= cutoffDate
            );
        } catch (error) {
            console.warn('Impossible de récupérer historique:', error);
            return [];
        }
    }
    /**
     * Récupère le profil utilisateur via l'API existante
     */
    static async getUserProfile(userId) {
        try {
            // Vérifier que apiGet est disponible
            if (typeof apiGet === 'undefined') {
                console.warn('apiGet non disponible, utilisation currentUser');
                return (typeof currentUser !== 'undefined' ? currentUser : {});
            }
            
            return await apiGet(`/api/users/${userId}`);
        } catch (error) {
            console.warn('Impossible de récupérer profil:', error);
            return (typeof currentUser !== 'undefined' ? currentUser : {});
        }
    }

    /**
     * Score rotation musculaire - utilise body_part réel
     */
    static scoreMuscleRotation(exerciseDetails) {
        const muscleGroups = {};
        let totalExercises = exerciseDetails.length;
        
        // Compter par body_part (structure réelle)
        exerciseDetails.forEach(ex => {
            const muscle = ex.body_part || 'unknown';
            muscleGroups[muscle] = (muscleGroups[muscle] || 0) + 1;
        });
        
        let score = 25; // Base optimiste
        const muscleCount = Object.keys(muscleGroups).length;
        const maxCount = Math.max(...Object.values(muscleGroups));
        
        // Pénalités sur-sollicitation
        if (maxCount / totalExercises > 0.7) {
            score -= 12; // Trop concentré sur un muscle
        } else if (maxCount / totalExercises > 0.5) {
            score -= 6;
        }
        
        // Bonus diversité
        if (muscleCount >= 3 && totalExercises >= 4) {
            score += 3; // Bonne diversité
        }
        
        // Pénalité si aucun exercice composé
        const hasCompound = exerciseDetails.some(ex => ex.exercise_type === 'compound');
        if (!hasCompound && totalExercises > 2) {
            score -= 4; // Manque exercices composés
        }
        
        return Math.max(0, score);
    }

    /**
     * Score récupération - analyse basée sur historique réel
     */
    static scoreRecovery(exerciseDetails, recentWorkouts) {
        if (recentWorkouts.length === 0) {
            return 20; // Score neutre si pas d'historique
        }

        let score = 25;
        const now = Date.now();
        
        exerciseDetails.forEach(ex => {
            const muscle = ex.body_part;
            
            // Trouver dernière séance avec ce muscle
            const lastWorkoutWithMuscle = recentWorkouts.find(w => 
                w.sets?.some(set => {
                    // Chercher dans les sets s'il y a cet exercice ou muscle similaire
                    return set.exercise_id === ex.exercise_id;
                })
            );
            
            if (lastWorkoutWithMuscle) {
                const hoursSince = (now - new Date(lastWorkoutWithMuscle.completed_at)) / (1000 * 60 * 60);
                
                // Pénalités récupération insuffisante
                if (hoursSince < 24) {
                    score -= 8; // Très récent
                } else if (hoursSince < 48) {
                    score -= 4; // Encore frais
                } else if (hoursSince > 168) { // 7 jours
                    score -= 2; // Peut-être trop long
                }
            }
        });
        
        return Math.max(0, score);
    }

    /**
     * Score progression - analyse trends réelles
     */
    static scoreProgression(exerciseDetails, recentWorkouts) {
        if (recentWorkouts.length < 2) {
            return 20; // Score neutre si pas assez d'historique
        }

        let score = 25;
        
        exerciseDetails.forEach(ex => {
            if (!ex.predicted_weight) return;
            
            // Analyser progression récente pour cet exercice
            const recentSetsForExercise = [];
            
            recentWorkouts.forEach(workout => {
                const setsForExercise = workout.sets?.filter(set => 
                    set.exercise_id === ex.exercise_id && set.weight
                ) || [];
                recentSetsForExercise.push(...setsForExercise);
            });
            
            if (recentSetsForExercise.length >= 2) {
                // Trier par date
                recentSetsForExercise.sort((a, b) => 
                    new Date(a.completed_at) - new Date(b.completed_at)
                );
                
                const latestWeight = recentSetsForExercise[recentSetsForExercise.length - 1].weight;
                const weightIncrease = (ex.predicted_weight - latestWeight) / latestWeight;
                
                // Pénalités progression irréaliste
                if (weightIncrease > 0.15) { // >15% d'augmentation
                    score -= 8; // Trop agressif
                } else if (weightIncrease > 0.1) { // >10%
                    score -= 4;
                } else if (weightIncrease < -0.05) { // Régression
                    score -= 3;
                }
            }
        });
        
        return Math.max(0, score);
    }

    /**
     * Score adhérence - basé sur profil utilisateur réel
     */
    static scoreAdherence(exercises, userProfile) {
        let score = 25;
        
        // Durée estimée basée sur sets réels
        const estimatedDuration = exercises.reduce((total, ex) => {
            const sets = ex.sets || 3;
            const restTime = ex.rest_time || 90; // secondes
            return total + (sets * 2.5) + (sets * restTime / 60); // minutes
        }, 0);
        
        // Pénalités durée
        if (estimatedDuration > 90) {
            score -= 10; // Trop long
        } else if (estimatedDuration > 75) {
            score -= 6;
        } else if (estimatedDuration > 60) {
            score -= 3;
        }
        
        // Bonus exercices favoris (utilise structure réelle)
        if (userProfile.favorite_exercises) {
            const favoriteCount = exercises.filter(ex => 
                userProfile.favorite_exercises.includes(ex.exercise_id)
            ).length;
            score += favoriteCount * 2; // +2 par favori
        }
        
        // Bonus équipement disponible
        if (userProfile.equipment_config) {
            // Logic basée sur equipment_config réel si nécessaire
            score += 1; // Bonus léger si équipement configuré
        }
        
        return Math.max(0, Math.min(25, score));
    }

    /**
     * Calcule la confiance de la prédiction
     */
    static calculateConfidence(exerciseDetails, recentWorkouts) {
        let confidence = 0.6; // Base
        
        // Plus d'historique = plus de confiance
        if (recentWorkouts.length > 10) {
            confidence += 0.2;
        } else if (recentWorkouts.length > 5) {
            confidence += 0.1;
        }
        
        // Exercices connus = plus de confiance
        const knownExercises = exerciseDetails.filter(ex => ex.body_part !== 'unknown').length;
        confidence += (knownExercises / exerciseDetails.length) * 0.2;
        
        return Math.min(0.95, confidence);
    }

    /**
     * Génère un ordre optimal des exercices
     */
    static async generateOptimalOrder(exercises, userContext) {
        if (!exercises || exercises.length === 0) return exercises;
        
        try {
            const exerciseDetails = await this.getExerciseDetails(exercises);
            const recentWorkouts = await this.getRecentWorkouts(userContext.user_id, 7);
            
            // Scorer chaque exercice pour l'ordre optimal
            const scoredExercises = exerciseDetails.map(ex => {
                let priorityScore = 0;
                
                // Exercices composés en premier
                if (ex.exercise_type === 'compound') {
                    priorityScore += 10;
                }
                
                // Muscles frais en premier
                const hoursSinceLastUse = this.getHoursSinceLastUse(ex, recentWorkouts);
                if (hoursSinceLastUse > 72) {
                    priorityScore += 8;
                } else if (hoursSinceLastUse > 48) {
                    priorityScore += 5;
                }
                
                // Exercices difficiles en premier
                if (ex.difficulty === 'advanced') {
                    priorityScore += 6;
                } else if (ex.difficulty === 'intermediate') {
                    priorityScore += 3;
                }
                
                return {
                    ...ex,
                    priorityScore,
                    optimalPosition: priorityScore
                };
            });
            
            // Trier par score de priorité
            return scoredExercises.sort((a, b) => b.priorityScore - a.priorityScore);
            
        } catch (error) {
            console.warn('Ordre optimal impossible à calculer:', error);
            return exercises; // Retourner ordre original
        }
    }

    /**
     * Calcule heures depuis dernière utilisation d'un exercice
     */
    static getHoursSinceLastUse(exercise, recentWorkouts) {
        const now = Date.now();
        
        for (const workout of recentWorkouts) {
            const hasExercise = workout.sets?.some(set => set.exercise_id === exercise.exercise_id);
            if (hasExercise) {
                return (now - new Date(workout.completed_at)) / (1000 * 60 * 60);
            }
        }
        
        return 168; // 7 jours par défaut si jamais fait
    }

    /**
     * Génère suggestions d'amélioration
     */
    static generateSuggestions(exercises, scores) {
        const suggestions = [];
        
        if (scores.muscleRotation < 18) {
            suggestions.push("🔄 Diversifiez les groupes musculaires pour éviter la surcharge");
        }
        
        if (scores.recovery < 18) {
            suggestions.push("⏰ Certains muscles manquent de récupération, reportez à demain");
        }
        
        if (scores.progression < 18) {
            suggestions.push("📈 Progression trop agressive, réduisez légèrement les charges");
        }
        
        if (scores.adherence < 18) {
            suggestions.push("⚡ Séance trop longue, considérez retirer 1-2 exercices");
        }
        
        // Suggestions positives
        if (scores.muscleRotation >= 22 && scores.recovery >= 22) {
            suggestions.push("✅ Excellente répartition musculaire et récupération");
        }
        
        if (suggestions.length === 0) {
            suggestions.push("🎯 Session bien équilibrée, prêt à démarrer !");
        }
        
        return suggestions.slice(0, 3); // Max 3 suggestions
    }

    /**
     * Recalcule score après réorganisation
     */
    static async recalculateAfterReorder(newOrder, userContext) {
        const newScore = await this.calculateScore(newOrder, userContext);
        
        // Ajouter bonus d'ordre si exercices composés en premier
        let orderBonus = 0;
        for (let i = 0; i < Math.min(3, newOrder.length); i++) {
            if (newOrder[i].exercise_type === 'compound') {
                orderBonus += 2;
            }
        }
        
        return {
            ...newScore,
            total: Math.min(100, newScore.total + orderBonus),
            orderBonus,
            reorderImprovement: true
        };
    }

    // Scores par défaut
    static getEmptyScore() {
        return {
            total: 0,
            breakdown: { muscleRotationScore: 0, recoveryScore: 0, progressionScore: 0, adherenceScore: 0 },
            suggestions: ["Aucun exercice sélectionné"],
            confidence: 0.0
        };
    }

    static getFallbackScore() {
        return {
            total: 65,
            breakdown: { muscleRotationScore: 16, recoveryScore: 17, progressionScore: 16, adherenceScore: 16 },
            suggestions: ["Score calculé en mode simplifié"],
            confidence: 0.4
        };
    }
}

// Fonctions helper pour l'interface - utilisent variables CSS existantes
function renderScoreBreakdown(breakdown) {
    return `
        <div class="score-breakdown-grid">
            <div class="score-item" data-tooltip="Évite la sur-sollicitation musculaire">
                <span class="score-label">🔄 Rotation</span>
                <span class="score-value">${breakdown.muscleRotationScore}/25</span>
            </div>
            <div class="score-item" data-tooltip="Respect des fenêtres de récupération">
                <span class="score-label">⏰ Récupération</span>
                <span class="score-value">${breakdown.recoveryScore}/25</span>
            </div>
            <div class="score-item" data-tooltip="Progression logique des charges">
                <span class="score-label">📈 Progression</span>
                <span class="score-value">${breakdown.progressionScore}/25</span>
            </div>
            <div class="score-item" data-tooltip="Probabilité de complétion">
                <span class="score-label">🎯 Adhérence</span>
                <span class="score-value">${breakdown.adherenceScore}/25</span>
            </div>
        </div>
    `;
}

function getScoreColor(score) {
    if (score >= 85) return 'var(--success)';
    if (score >= 70) return 'var(--warning)';
    if (score >= 50) return 'var(--danger)';
    return 'var(--text-muted)';
}

function getScoreGradient(score) {
    if (score >= 85) return 'linear-gradient(90deg, var(--success), #16a34a)';
    if (score >= 70) return 'linear-gradient(90deg, var(--warning), #eab308)';
    if (score >= 50) return 'linear-gradient(90deg, var(--danger), #dc2626)';
    return 'linear-gradient(90deg, var(--text-muted), var(--secondary))';
}



// Export de la classe principale
window.SessionQualityEngine = SessionQualityEngine;

// Export des fonctions helper nécessaires dans app.js
window.renderScoreBreakdown = renderScoreBreakdown;
window.getScoreColor = getScoreColor;
window.getScoreGradient = getScoreGradient;

// Fonction helper pour récupérer le contexte utilisateur
function getUserContext(userId) {
    return {
        user_id: userId,
        // program_id supprimé
        current_workout: currentWorkout,
        session_type: currentWorkoutSession?.type || 'free'
    };
}

// Export global
window.getUserContext = getUserContext;

// Vérification que les exports sont bien disponibles
console.log('✅ SessionQualityEngine chargé et exporté globalement')
