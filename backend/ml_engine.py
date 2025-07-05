# ===== backend/ml_engine.py =====
import logging
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, timezone
from backend.models import User, Exercise, Workout, WorkoutSet, AdaptiveTargets, UserCommitment
import itertools

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class FitnessMLEngine:
    """
    Moteur d'apprentissage automatique pour:
    - Calcul intelligent des poids
    - Prédiction de performance
    - Ajustement dynamique des programmes
    - Prévention des blessures
    """
    
    def __init__(self, db: Session):
        self.db = db
        
        # Coefficients pour les calculs
        self.FATIGUE_WEIGHTS = {
            1: 1.0,    # Pas fatigué
            2: 0.95,   # Légèrement fatigué
            3: 0.90,   # Modérément fatigué
            4: 0.85,   # Très fatigué
            5: 0.80    # Épuisé
        }
         
        self.EXPERIENCE_MULTIPLIERS = {
            "débutant": 0.7,
            "intermédiaire": 0.85,
            "avancé": 1.0,
            "élite": 1.1,
            "extrême": 1.2
        }
        
        self.GOAL_ADJUSTMENTS = {
            "force": {"sets": 0.8, "reps": 0.7, "weight": 1.2},
            "hypertrophie": {"sets": 1.0, "reps": 1.0, "weight": 1.0},
            "endurance": {"sets": 1.2, "reps": 1.3, "weight": 0.8},
            "perte_de_poids": {"sets": 1.1, "reps": 1.2, "weight": 0.85},
            "cardio": {"sets": 1.3, "reps": 1.4, "weight": 0.7},
            "flexibility": {"sets": 0.9, "reps": 1.5, "weight": 0.6}
        }

        # Facteurs d'ajustement des répétitions selon la fatigue
        self.REPS_FATIGUE_ADJUSTMENTS = {
            1: 1.0,    # Pas fatigué - maintenir les reps
            2: 1.0,    # Légèrement fatigué - maintenir
            3: 0.95,   # Modérément fatigué - réduire légèrement
            4: 0.85,   # Très fatigué - réduire significativement
            5: 0.75    # Épuisé - réduire fortement
        }
    
    def get_user_available_equipment(self, user: User) -> List[str]:
        if not user.equipment_config:
            return []

        config = user.equipment_config
        available_equipment = []

        # Poids du corps toujours disponible  
        available_equipment.append("poids_du_corps")

        # Barres
        for barre_type, barre_config in config.get("barres", {}).items():
            if barre_config.get("available", False):
                if barre_type in ["olympique", "courte"]:
                    available_equipment.append("barre_olympique")
                elif barre_type == "ez":
                    available_equipment.append("barre_ez")

        # Haltères fixes
        if config.get("dumbbells", {}).get("available", False):
            available_equipment.append("dumbbells")

        # Équivalence : 2 barres courtes + disques = dumbbells
        barres_courtes = config.get("barres", {}).get("courte", {})
        has_disques = config.get("disques", {}).get("available", False)
        if (barres_courtes.get("available", False) and 
            barres_courtes.get("count", 0) >= 2 and 
            has_disques and 
            "dumbbells" not in available_equipment):
            available_equipment.append("dumbbells")

        # Banc
        if config.get("banc", {}).get("available", False):
            available_equipment.append("banc_plat")

        # Autres équipements
        if config.get("autres", {}).get("barre_traction", {}).get("available", False):
            available_equipment.append("barre_traction")

        return available_equipment
    
    def _mean(self, values):
        """Calcule la moyenne d'une liste de valeurs"""
        return sum(values) / len(values) if values else 0

    def _linear_regression_slope(self, x_values, y_values):
        """Calcule la pente d'une régression linéaire simple"""
        if len(x_values) != len(y_values) or len(x_values) < 2:
            return 0
        
        n = len(x_values)
        sum_x = sum(x_values)
        sum_y = sum(y_values)
        sum_xy = sum(x * y for x, y in zip(x_values, y_values))
        sum_x2 = sum(x * x for x in x_values)
        
        # Formule: slope = (n*sum_xy - sum_x*sum_y) / (n*sum_x2 - sum_x^2)
        denominator = n * sum_x2 - sum_x * sum_x
        if denominator == 0:
            return 0
        
        return (n * sum_xy - sum_x * sum_y) / denominator

    def calculate_starting_weight(self, user: User, exercise: Exercise) -> float:
        """
        Calcule le poids de départ pour un exercice basé sur:
        - Le niveau d'expérience de l'utilisateur
        - Le type d'exercice
        - Les objectifs
        - L'historique (si disponible)
        """
        
        # Récupérer l'historique de cet exercice
        history = self.db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user.id,
            WorkoutSet.exercise_id == exercise.id
        ).order_by(WorkoutSet.completed_at.desc()).limit(10).all()
        
        if history:
            # Utiliser la moyenne pondérée des dernières performances
            weights = []
            for i, set_record in enumerate(history):
                # Poids plus récents ont plus d'importance
                weight_factor = 1.0 - (i * 0.05)
                weights.append(set_record.weight * weight_factor)
            
            base_weight = self._mean(weights)
            
            # Ajuster selon la fatigue moyenne récente
            avg_fatigue = self._mean([s.fatigue_level for s in history[:3]])
            fatigue_adjustment = self.FATIGUE_WEIGHTS.get(int(avg_fatigue), 0.9)
            
            return round(base_weight * fatigue_adjustment, 2.5)
        
        else:
            # Estimation initiale basée sur le niveau et le type d'exercice
            return self._estimate_initial_weight(user, exercise)

    def _estimate_initial_weight(self, user: User, exercise: Exercise) -> float:
        """
        Estime le poids initial pour un nouvel exercice
        """
        available_weights = []
        # Poids de base selon le type d'exercice et le poids corporel
        body_weight = self._get_user_weight(user)
        
        # Mapping approximatif exercice -> pourcentage du poids corporel
        exercise_ratios = {
            "Développé couché": 0.6,
            "Squat": 0.8,
            "Soulevé de terre": 1.0,
            "Développé militaire": 0.4,
            "Curl biceps": 0.15,
            "Extension triceps": 0.12,
            "Rowing": 0.5,
            "Leg press": 1.5,
            "Curl poignet": 0.1,
        }
        
        # Chercher le ratio le plus proche
        ratio = 0.3  # Défaut
        for key, value in exercise_ratios.items():
            if key.lower() in exercise.name_fr.lower():
                ratio = value
                break
        
        # Calcul du poids de base
        base_weight = body_weight * ratio
        # Vérifier le poids minimum de la barre pour les exercices avec barbell
        if any('barbell' in eq for eq in exercise.equipment):
            min_bar_weight = 20  # Barre olympique par défaut
            if user.equipment_config and user.equipment_config.get('barres'):
                if user.equipment_config['barres'].get('courte', {}).get('available'):
                    min_bar_weight = 2.5
                elif user.equipment_config['barres'].get('ez', {}).get('available'):
                    min_bar_weight = 10
            
            # S'assurer que le poids suggéré n'est pas inférieur au poids de la barre
            if base_weight < min_bar_weight:
                base_weight = min_bar_weight
        
        # Ajuster selon l'expérience
        experience_mult = self.EXPERIENCE_MULTIPLIERS.get(user.experience_level, 0.85)
        
        # Ajuster selon les objectifs
        goal_mult = 1.0
        if user.goals:
            for goal in user.goals:
                if goal in self.GOAL_ADJUSTMENTS:
                    goal_mult *= self.GOAL_ADJUSTMENTS[goal]["weight"]
            goal_mult = goal_mult ** (1/len(user.goals))  # Moyenne géométrique
        
        # Si dumbbells, ajuster au poids disponible le plus proche
        if "dumbbells" in exercise.equipment and user.equipment_config:
            target_weight = base_weight * experience_mult * goal_mult / 2
            available_weights = []
            
            # Ajouter les haltères fixes si disponibles
            dumbbell_config = user.equipment_config.get("dumbbells", {})
            if dumbbell_config.get("available", False) and dumbbell_config.get("weights"):
                available_weights.extend(dumbbell_config["weights"])
            
            # Ajouter AUSSI l'équivalence barres courtes + disques
            barres_courtes = user.equipment_config.get("barres", {}).get("courte", {})
            disques_config = user.equipment_config.get("disques", {})
            if (barres_courtes.get("available", False) and 
                barres_courtes.get("count", 0) >= 2 and 
                disques_config.get("available", False)):
                
                # Calculer avec barre courte + disques disponibles
                barre_weight = barres_courtes.get("weight", 2.5)
                available_plates = []
                for weight_str, count in disques_config.get("weights", {}).items():
                    weight = float(weight_str)
                    # On peut utiliser jusqu'à la moitié des disques (pour faire une paire)
                    available_plates.extend([weight] * (count // 2))
                
                # Ajouter la barre seule
                available_weights.append(barre_weight)
                
                # Ajouter toutes les combinaisons possibles
                if available_plates:
                    plate_combinations = set()
                    for i in range(1, min(len(available_plates) + 1, 5)):  # Limiter la complexité
                        for combo in itertools.combinations(available_plates, i):
                            plate_combinations.add(barre_weight + sum(combo))
                    available_weights.extend(list(plate_combinations))
            
            # Trouver le poids le plus proche parmi TOUTES les options
            if available_weights:
                available_weights = sorted(set(available_weights))  # Unique et trié
                closest_weight = min(available_weights, key=lambda x: abs(x - target_weight))
                return closest_weight * 2  # Paire
            
            # Sinon, utiliser équivalence barres courtes + disques
            barres_courtes = user.equipment_config.get("barres", {}).get("courte", {})
            disques_config = user.equipment_config.get("disques", {})
            if (barres_courtes.get("available", False) and 
                barres_courtes.get("count", 0) >= 2 and 
                disques_config.get("available", False)):
                
                # Calculer avec barre courte + disques disponibles
                barre_weight = barres_courtes.get("weight", 2.5)
                available_plates = []
                for weight_str, count in disques_config.get("weights", {}).items():
                    weight = float(weight_str)
                    # On peut utiliser jusqu'à la moitié des disques (pour faire une paire)
                    available_plates.extend([weight] * (count // 2))
                
                if available_plates:
                    # Trouver la combinaison optimale pour se rapprocher de target_weight - barre_weight
                    target_plate_weight = max(0, target_weight - barre_weight)
                    closest_plate = min(available_plates, key=lambda x: abs(x - target_plate_weight))
                    return (barre_weight + closest_plate) * 2  # Paire
            
            # Trouver le poids le plus proche SI disponible
            if available_weights:  # Maintenant safe !
                closest_weight = min(available_weights, key=lambda x: abs(x - target_weight))
                return closest_weight * 2  # Multiplié par 2 pour la paire
        
        # Arrondir à 2.5kg près
        return round(base_weight * experience_mult * goal_mult / 2.5) * 2.5
    
    def _get_user_weight(self, user: User) -> float:
        """Retourne le poids réel de l'utilisateur"""
        return user.weight
        
    def predict_next_session_performance(
        self, 
        user: User, 
        exercise: Exercise,
        target_sets: int,
        target_reps: int
    ) -> Dict:
        """
        Prédit la performance pour la prochaine session
        """
        recent_sets = self.db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user.id,
            WorkoutSet.exercise_id == exercise.id
        ).order_by(WorkoutSet.completed_at.desc()).limit(20).all()
        
        if not recent_sets:
            # Première fois, utiliser les valeurs par défaut
            weight = self.calculate_starting_weight(user, exercise)
            return {
                "predicted_weight": weight,
                "predicted_reps": target_reps,
                "confidence": 0.5,
                "recommendation": "Première séance avec cet exercice. Commencez prudemment."
            }
        
        # Analyser la progression
        weights = [s.weight for s in recent_sets]
        reps = [s.reps for s in recent_sets]
        fatigue_levels = [s.fatigue_level for s in recent_sets]
        
        # Calcul de la tendance (régression linéaire simple)
        if len(weights) >= 3:
            x_values = list(range(len(weights)))
            weight_trend = self._linear_regression_slope(x_values, weights)
            reps_trend = self._linear_regression_slope(x_values, reps)
            
            # Prédiction
            next_weight = weights[0] + weight_trend
            
            # Ajustement selon la fatigue moyenne récente
            recent_fatigue = self._mean(fatigue_levels[:5])
            fatigue_factor = self.FATIGUE_WEIGHTS.get(int(recent_fatigue), 0.9)
            
            # Ajustement selon la réussite des dernières séances
            success_rate = sum(1 for s in recent_sets[:5] if s.reps >= s.target_reps) / min(5, len(recent_sets))
            
            if success_rate >= 0.8:
                # Augmenter le poids
                next_weight *= 1.025
                recommendation = "Performance excellente! Augmentation du poids recommandée."
            elif success_rate < 0.5:
                # Diminuer le poids
                next_weight *= 0.975
                recommendation = "Difficulté détectée. Réduction du poids recommandée."
            else:
                recommendation = "Maintenir le poids actuel et viser l'amélioration technique."
            
            # Arrondir au poids disponible le plus proche
            if "dumbbells" in exercise.equipment and user.equipment_config:
                target_per_dumbbell = next_weight / 2
                available = []
                
                # Ajouter haltères fixes
                dumbbell_config = user.equipment_config.get("dumbbells", {})
                if dumbbell_config.get("available", False) and dumbbell_config.get("weights"):
                    available.extend(dumbbell_config["weights"])
                
                # Ajouter barres courtes + disques
                barres_courtes = user.equipment_config.get("barres", {}).get("courte", {})
                disques_config = user.equipment_config.get("disques", {})
                if (barres_courtes.get("available", False) and 
                    barres_courtes.get("count", 0) >= 2 and 
                    disques_config.get("available", False)):
                    
                    barre_weight = barres_courtes.get("weight", 2.5)
                    available.append(barre_weight)
                    
                    # Ajouter quelques combinaisons courantes
                    for weight_str, count in disques_config.get("weights", {}).items():
                        if count >= 2:  # Paire nécessaire
                            plate_weight = float(weight_str)
                            available.append(barre_weight + plate_weight)
                            available.append(barre_weight + plate_weight * 2)
                
                if available:
                    available = sorted(set(available))
                    closest = min(available, key=lambda x: abs(x - target_per_dumbbell))
                    next_weight = closest * 2
                else:
                    # Arrondir à 2.5kg près
                    next_weight = round(next_weight / 2.5) * 2.5
            
            return {
                "predicted_weight": max(0, next_weight),
                "predicted_reps": int(target_reps * fatigue_factor),
                "confidence": min(0.9, 0.5 + len(recent_sets) * 0.02),
                "recommendation": recommendation,
                "fatigue_warning": "Attention: fatigue élevée détectée" if recent_fatigue > 3.5 else None
            }
        
        else:
            # Pas assez de données pour une tendance
            last_weight = weights[0]
            return {
                "predicted_weight": last_weight,
                "predicted_reps": target_reps,
                "confidence": 0.6,
                "recommendation": "Continuez avec le poids actuel pour établir une base."
            }
    
    def adjust_workout_in_progress(
        self,
        user: User,
        current_set: WorkoutSet,
        remaining_sets: int
    ) -> Dict:
        """
        Ajuste la séance en cours selon la performance actuelle
        """
        # Analyser la performance de la série actuelle
        if current_set.target_reps > 0:
            performance_ratio = current_set.reps / current_set.target_reps
        else:
            performance_ratio = 0
        
        recommendations = []
        adjustments = {}

        # Calculer l'ajustement des répétitions
        recent_sets = self.db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user.id,
            WorkoutSet.exercise_id == current_set.exercise_id
        ).order_by(WorkoutSet.completed_at.desc()).limit(5).all()

        rep_suggestion = self.calculate_optimal_rep_range(
            user=user,
            exercise=self.db.query(Exercise).filter(
                Exercise.id == current_set.exercise_id
            ).first(),
            current_fatigue=round(current_set.fatigue_level / 2),  # Convertir échelle 1-10 vers 1-5
            recent_performance=recent_sets,
            remaining_sets=remaining_sets
        )

        adjustments["suggested_reps"] = rep_suggestion["optimal_reps"]
        adjustments["rep_range"] = {
            "min": rep_suggestion["min_reps"],
            "max": rep_suggestion["max_reps"]
        }
        adjustments["rep_confidence"] = rep_suggestion["confidence"]

        # Ajouter une recommandation si les reps suggérées diffèrent significativement
        if current_set.target_reps > 0:
            rep_diff_ratio = rep_suggestion["optimal_reps"] / current_set.target_reps
            if rep_diff_ratio < 0.8:
                recommendations.append(f"Réduire à {rep_suggestion['optimal_reps']} reps pour maintenir la qualité")
            elif rep_diff_ratio > 1.2:
                recommendations.append(f"Augmenter à {rep_suggestion['optimal_reps']} reps si possible")
        
        if performance_ratio < 0.7:
            # Performance très en dessous
            adjustments["weight_multiplier"] = 0.9
            adjustments["rest_time_bonus"] = 30
            recommendations.append("Réduire le poids de 10% pour les prochaines séries")
            
        elif performance_ratio < 0.85:
            # Performance légèrement en dessous
            adjustments["weight_multiplier"] = 0.95
            adjustments["rest_time_bonus"] = 15
            recommendations.append("Légère réduction du poids recommandée")
            
        elif performance_ratio > 1.2:
            # Performance très au-dessus
            adjustments["weight_multiplier"] = 1.05
            recommendations.append("Excellente forme! Augmentation du poids possible")
            
        # Ajustement selon la fatigue
        if current_set.fatigue_level >= 4:
            adjustments["rest_time_bonus"] = adjustments.get("rest_time_bonus", 0) + 30
            recommendations.append("Fatigue élevée: repos supplémentaire recommandé")
            
            if remaining_sets > 2:
                adjustments["skip_sets"] = 1
                recommendations.append("Envisager de réduire le nombre de séries")
        
        # Prévention des blessures
        if current_set.perceived_exertion >= 9:
            adjustments["stop_workout"] = True
            recommendations.append("⚠️ Effort maximal atteint. Arrêt recommandé pour éviter les blessures.")
        
        return {
            "adjustments": adjustments,
            "recommendations": recommendations
        }
    
    def calculate_optimal_rep_range(
        self,
        user: User,
        exercise: Exercise,
        current_fatigue: float,
        recent_performance: List[WorkoutSet],
        remaining_sets: int
    ) -> Dict:
        """
        Calcule la fourchette de répétitions optimale selon:
        - Les objectifs de l'utilisateur
        - Le niveau de fatigue actuel
        - L'historique récent de performance
        - Le nombre de séries restantes
        """
        # Récupérer les reps de base depuis l'exercice
        base_reps = 10  # Valeur par défaut
        if exercise.sets_reps:
            for config in exercise.sets_reps:
                if config.get("level") == user.experience_level:
                    base_reps = config.get("reps", 10)
                    break
        
        # Ajuster selon les objectifs
        goal_multiplier = 1.0
        if user.goals:
            for goal in user.goals:
                if goal in self.GOAL_ADJUSTMENTS:
                    goal_multiplier *= self.GOAL_ADJUSTMENTS[goal]["reps"]
            goal_multiplier = goal_multiplier ** (1/len(user.goals))
        
        # Ajuster selon la fatigue
        fatigue_multiplier = self.REPS_FATIGUE_ADJUSTMENTS.get(
            int(current_fatigue), 0.9
        )
        
        # Analyser la tendance de performance
        if recent_performance and len(recent_performance) >= 2:
            # Calculer le ratio de réussite moyen
            success_ratios = []
            for perf in recent_performance[-3:]:
                if perf.target_reps > 0:
                    ratio = perf.reps / perf.target_reps
                    success_ratios.append(ratio)
            
            if success_ratios:
                avg_success = sum(success_ratios) / len(success_ratios)
                
                # Ajuster selon la performance
                if avg_success > 1.15:  # Dépassement constant
                    performance_adjustment = 1.1
                elif avg_success < 0.85:  # Sous-performance
                    performance_adjustment = 0.9
                else:
                    performance_adjustment = 1.0
            else:
                performance_adjustment = 1.0
        else:
            performance_adjustment = 1.0
        
        # Calculer les reps optimales
        optimal_reps = int(base_reps * goal_multiplier * fatigue_multiplier * performance_adjustment)
        
        # Définir la fourchette (±10-20%)
        min_reps = max(1, int(optimal_reps * 0.8))
        max_reps = int(optimal_reps * 1.2)
        
        # Ajustement spécial pour les dernières séries
        if remaining_sets <= 1 and current_fatigue >= 4:
            # Permettre de réduire plus sur la dernière série si très fatigué
            min_reps = max(1, int(min_reps * 0.8))
        
        return {
            "optimal_reps": optimal_reps,
            "min_reps": min_reps,
            "max_reps": max_reps,
            "confidence": 0.8 if len(recent_performance) >= 3 else 0.5,
            "adjustment_reason": self._get_adjustment_reason(
                goal_multiplier, fatigue_multiplier, performance_adjustment
            )
        }

    def _get_adjustment_reason(self, goal_mult, fatigue_mult, perf_mult):
        """Explique la raison de l'ajustement des reps"""
        reasons = []
        
        if goal_mult < 0.9:
            reasons.append("Objectif force: moins de reps")
        elif goal_mult > 1.1:
            reasons.append("Objectif endurance: plus de reps")
            
        if fatigue_mult < 0.9:
            reasons.append("Fatigue élevée détectée")
            
        if perf_mult > 1.05:
            reasons.append("Performance excellente récente")
        elif perf_mult < 0.95:
            reasons.append("Ajustement pour maintenir la qualité")
        
        return " - ".join(reasons) if reasons else "Répétitions standards"
        
    def generate_adaptive_program(
            self,
            user: User,
            duration_weeks: int = 4,
            frequency: int = 3
        ) -> List[Dict]:
            """
            Génère un programme adaptatif basé sur:
            - Les objectifs de l'utilisateur
            - Son équipement disponible
            - Son historique de performance
            - Les principes de périodisation
            """
            program = []
        
            # Vérifier que l'utilisateur a des objectifs
            if not user.goals:
                user.goals = ["hypertrophie"]  # Objectif par défaut

            # Valider la configuration d'équipement
            if not user.equipment_config or not isinstance(user.equipment_config, dict):
                logger.error(f"Configuration d'équipement invalide pour l'utilisateur {user.id}")
                return []

            # Vérifier qu'au moins un équipement est disponible
            has_equipment = False
            for category, items in user.equipment_config.items():
                if isinstance(items, dict) and items.get("available", False):
                    has_equipment = True
                    break

            if not has_equipment:
                logger.error(f"Aucun équipement disponible pour l'utilisateur {user.id}")
                return []
            
            # Récupérer les exercices disponibles selon l'équipement
            available_equipment = []
            config = user.equipment_config
            
            # Barres
            for barre_type, barre_config in config.get("barres", {}).items():
                if barre_config.get("available", False):
                    if barre_type in ["olympique", "courte"]:
                        available_equipment.append("barre_olympique")
                    elif barre_type == "ez":
                        available_equipment.append("barre_ez")

            # Haltères fixes
            if config.get("dumbbells", {}).get("available", False):
                available_equipment.append("dumbbells")

            # Équivalence : 2 barres courtes + disques = dumbbells
            # IMPORTANT : Vérifier cette équivalence APRÈS avoir vérifié les haltères fixes
            barres_courtes = config.get("barres", {}).get("courte", {})
            has_disques = config.get("disques", {}).get("available", False)
            if (barres_courtes.get("available", False) and 
                barres_courtes.get("count", 0) >= 2 and 
                has_disques and 
                "dumbbells" not in available_equipment):  # Éviter les doublons
                available_equipment.append("dumbbells")
                logger.info("✅ Équivalence appliquée: 2 barres courtes + disques = dumbbells")
                
            # Poids du corps toujours disponible
            available_equipment.append("poids_du_corps")
            
            # Banc
            if config.get("banc", {}).get("available", False):
                available_equipment.append("banc_plat")
                if config["banc"].get("inclinable_haut", False):
                    available_equipment.append("banc_inclinable")
                if config["banc"].get("inclinable_bas", False):
                    available_equipment.append("banc_declinable")

            # Élastiques
            if config.get("elastiques", {}).get("available", False):
                available_equipment.append("elastiques")

            # Autres équipements
            autres = config.get("autres", {})
            if autres.get("kettlebell", {}).get("available", False):
                available_equipment.append("kettlebell")
            if autres.get("barre_traction", {}).get("available", False):
                available_equipment.append("barre_traction")  # Mapping correct
            # Ajouter après les autres mappings d'équipement
            # Machines (non disponibles dans la config actuelle)
            machine_equipment = ["poulies", "machine_convergente", "machine_pectoraux", 
                                "machine_developpe", "machine_epaules", "machine_oiseau",
                                "machine_shrug", "dip_bars"]
            # Ces équipements ne sont pas dans la config utilisateur, donc toujours False

            logger.info(f"=== DIAGNOSTIC ÉQUIPEMENT ===")
            logger.info(f"Config utilisateur brute: {user.equipment_config}")
            logger.info(f"Équipement mappé disponible: {available_equipment}")
            all_exercises = self.db.query(Exercise).all()
            
            # Debug détaillé des premiers exercices
            logger.info(f"=== DIAGNOSTIC DÉTAILLÉ ÉQUIPEMENT ===")
            for i, exercise in enumerate(all_exercises[:10]):
                logger.info(f"Exercice {i+1}: {exercise.name_fr}")
                logger.info(f"  Équipement requis: {exercise.equipment}")
                if exercise.equipment:
                    matches = [eq for eq in exercise.equipment if eq in available_equipment]
                    logger.info(f"  Équipements correspondants: {matches}")
                    logger.info(f"  Compatible: {len(matches) > 0}")

            # Récupérer TOUS les exercices et filtrer manuellement
            logger.info(f"Nombre total d'exercices dans la DB: {len(all_exercises)}")

            # Filtrer les exercices
            available_exercises = []
            for exercise in all_exercises:
                exercise_equipment = exercise.equipment or []
                
                # Un exercice est disponible si on a AU MOINS UN des équipements requis
                if not exercise_equipment or any(eq in available_equipment for eq in exercise_equipment):
                    available_exercises.append(exercise)
                else:
                    # Log seulement quelques exemples pour debug
                    if len(available_exercises) < 5 and exercise.body_part in ["Pectoraux", "Dos"]:
                        missing = [eq for eq in exercise_equipment if eq not in available_equipment]
                        logger.debug(f"Exercice exclu: {exercise.name_fr} - manque: {missing}")

            # Résumé du filtrage
            logger.info(f"=== RÉSULTAT FILTRAGE ===")
            logger.info(f"Exercices disponibles après filtrage: {len(available_exercises)}")
            if len(available_exercises) < 10:
                logger.warning(f"Peu d'exercices trouvés ({len(available_exercises)})")
                for i, ex in enumerate(available_exercises[:5]):
                    logger.info(f"  Exercice {i+1}: {ex.name_fr}")
                    
            # Vérifier qu'on a assez d'exercices
            if len(available_exercises) < 5:
                logger.error(f"Impossible de générer un programme avec seulement {len(available_exercises)} exercices")
                return []
            
            # Grouper par partie du corps
            logger.info(f"DEBUG: Groupage de {len(available_exercises)} exercices")
            body_parts = {}
            from backend.constants import normalize_muscle_group
            for ex in available_exercises:
                # Utiliser le premier muscle group comme catégorie principale
                primary_muscle = ex.muscle_groups[0] if ex.muscle_groups else "general"
                normalized_muscle = normalize_muscle_group(primary_muscle)
                if normalized_muscle not in body_parts:
                    body_parts[normalized_muscle] = []
                body_parts[normalized_muscle].append(ex)

            # AJOUTER CE LOG
            logger.error(f"DEBUG: Body parts trouvés: {list(body_parts.keys())}")
            for bp, exs in body_parts.items():
                logger.error(f"  - {bp}: {len(exs)} exercices")

            # Create rotation based on requested frequency
            if frequency == 3:
                split = ["Pectoraux/Triceps", "Dos/Biceps", "Jambes"]
            elif frequency == 4:
                split = ["Pectoraux/Triceps", "Dos/Biceps", "Jambes", "Épaules/Abdos"]
            elif frequency == 5:
                split = ["Pectoraux", "Dos", "Jambes", "Épaules", "Bras"]
            else:
                split = ["Haut du corps", "Bas du corps", "Full body"]
            
            # Générer les séances pour chaque semaine
            for week in range(duration_weeks):
                exercise_rotation_offset = week % 2
                week_intensity = 0.85 + (week * 0.05)
                
                if week == duration_weeks - 1:
                    week_intensity = 0.7  # Semaine de deload
                
                week_program = []
                
                for day_num, muscle_group in enumerate(split):
                    workout = {
                        "week": week + 1,
                        "day": day_num + 1,
                        "muscle_group": muscle_group,
                        "exercises": []
                    }
                    
                    # Sélectionner les exercices pour ce jour
                    selected_exercises = self._select_exercises_for_day(
                        body_parts, 
                        muscle_group, 
                        user.experience_level,
                        exercise_rotation_offset
                    )
                                        
                    for exercise in selected_exercises:
                        logger.info(f"Tentative d'ajout de l'exercice: {exercise.name_fr} (ID: {exercise.id})")
                        try:
                            # Obtenir les recommandations pour cet exercice
                            sets_reps = self.get_sets_reps_for_level(
                                exercise, 
                                user.experience_level,
                                user.goals
                            )
                            
                            # Prédire le poids
                            prediction = self.predict_next_session_performance(
                                user, 
                                exercise,
                                sets_reps["sets"],
                                sets_reps["reps"]
                            )
                            
                            workout["exercises"].append({
                                "exercise_id": exercise.id,
                                "exercise_name": exercise.name_fr,
                                "sets": int(sets_reps["sets"] * week_intensity),
                                "target_reps": sets_reps["reps"],
                                "predicted_weight": prediction["predicted_weight"],
                                "rest_time": 90 if user.goals and "force" in user.goals else 60
                            })
                        except Exception as e:
                            # CHANGEZ print par logger.error pour voir dans les logs serveur
                            logger.error(f"ERREUR CRITIQUE avec l'exercice {exercise.name_fr}: {str(e)}")
                            logger.error(f"Traceback complet:", exc_info=True)
                            continue
                    
                    week_program.append(workout)
                
                program.extend(week_program)
            
            return program
    
    def generate_adaptive_workout(self, user: User, time_available: int = 60) -> Dict[str, Any]:
        """
        Génère une séance adaptative intelligente basée sur l'état actuel de l'utilisateur
        """
        logger.info(f"=== GÉNÉRATION SÉANCE ADAPTATIVE USER {user.id} ===")
        logger.info(f"Temps disponible: {time_available} minutes")
        logger.info(f"Équipement: {user.equipment_config}")
        
        try:
            # 1. Analyser l'état de récupération
            recovery_tracker = RecoveryTracker(self.db)
            volume_optimizer = VolumeOptimizer(self.db)
            session_builder = SessionBuilder(self.db)
            
            # 2. Déterminer quels muscles entraîner
            muscle_readiness = {}
            all_muscles = ["Pectoraux", "Dos", "Deltoïdes", "Jambes", "Bras", "Abdominaux"]
            
            for muscle in all_muscles:
                readiness = recovery_tracker.get_muscle_readiness(muscle, user)
                muscle_readiness[muscle] = readiness
                logger.info(f"Readiness {muscle}: {readiness:.2f}")
            
            # 3. Sélectionner les muscles prioritaires
            volume_deficits = volume_optimizer.get_volume_deficit(user)
            
            # Combiner readiness et deficits pour prioriser
            muscle_priorities = {}
            for muscle in all_muscles:
                readiness = muscle_readiness.get(muscle, 0.5)
                deficit = volume_deficits.get(muscle, 0.0)
                
                # Muscle prêt + en retard = priorité élevée
                priority = readiness + (deficit * 2)  # Deficit compte double
                muscle_priorities[muscle] = priority
            
            # Trier par priorité et prendre les 2-3 meilleurs
            sorted_muscles = sorted(muscle_priorities.items(), key=lambda x: x[1], reverse=True)
            
            if time_available <= 30:
                target_muscles = [sorted_muscles[0][0]]  # 1 muscle seulement
            elif time_available <= 45:
                target_muscles = [m[0] for m in sorted_muscles[:2]]  # 2 muscles
            else:
                target_muscles = [m[0] for m in sorted_muscles[:3]]  # 3 muscles max
            
            logger.info(f"Muscles sélectionnés: {target_muscles}")
            
            # 4. Construire la séance
            session_exercises = session_builder.build_session(
                muscles=target_muscles,
                time_budget=time_available,
                user=user,
                constraints={}
            )
            
            if not session_exercises:
                logger.error("❌ Aucun exercice généré par le SessionBuilder")
                raise ValueError("Impossible de générer des exercices pour cette configuration")
            
            # 5. Estimer la durée totale
            estimated_duration = self._estimate_session_duration(session_exercises, time_available)
            
            # 6. Préparer la réponse
            result = {
                "muscles": target_muscles,
                "exercises": session_exercises,
                "estimated_duration": estimated_duration,
                "readiness_scores": muscle_readiness,
                "session_metadata": {
                    "muscle_priorities": dict(sorted_muscles[:5]),
                    "volume_deficits": volume_deficits,
                    "generation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
            
            logger.info(f"✅ Séance générée: {len(session_exercises)} exercices, {estimated_duration}min")
            return result
            
        except Exception as e:
            logger.error(f"❌ Erreur génération séance adaptative: {str(e)}", exc_info=True)
            # Fallback simple
            return self._generate_fallback_workout(user, time_available)
    
    def _estimate_session_duration(self, exercises: List[Dict], max_time: int) -> int:
        """Estime la durée réelle de la séance"""
        total_duration = 0
        
        for exercise in exercises:
            # Temps par série (effort + repos)
            sets = exercise.get('sets', 3)
            rest_time = exercise.get('rest_time', 90)
            effort_time = 30  # Estimation du temps d'effort par série
            
            exercise_duration = sets * (effort_time + rest_time)
            total_duration += exercise_duration
        
        # Ajouter temps de transition entre exercices
        transition_time = (len(exercises) - 1) * 60  # 1 min entre exercices
        total_duration += transition_time
        
        # Convertir en minutes et limiter au temps disponible
        estimated_minutes = min(total_duration // 60, max_time)
        
        return max(15, estimated_minutes)  # Minimum 15 minutes
    
    def _generate_fallback_workout(self, user: User, time_available: int) -> Dict[str, Any]:
        """Génère une séance de secours simple en cas d'erreur"""
        logger.warning("🚨 Génération séance de secours")
        
        fallback_exercises = []
        
        # Récupérer DIRECTEMENT les exercices sans passer par SessionBuilder
        available_equipment = self.get_user_available_equipment(user)
        
        # Sélectionner des exercices de base pour chaque muscle principal
        muscles_cibles = ["Pectoraux", "Dos", "Jambes"]
        
        for muscle in muscles_cibles:
            exercises = self.db.query(Exercise).filter(
                Exercise.body_part == muscle
            ).all()
            
            # Filtrer par équipement disponible SANS SessionBuilder
            for ex in exercises:
                if not ex.equipment or any(eq in available_equipment for eq in ex.equipment):
                    fallback_exercises.append({
                        "exercise_id": ex.id,
                        "exercise_name": ex.name_fr,
                        "body_part": ex.body_part,
                        "sets": 3,
                        "target_reps": "8-12",
                        "suggested_weight": 20.0,
                        "rest_time": 90,
                        "order_index": len(fallback_exercises) + 1
                    })
                    break  # Un exercice par muscle
            
            if len(fallback_exercises) >= 3:
                break
        
        # Si toujours rien, alors seulement là on met le poids du corps
        if not fallback_exercises:
            fallback_exercises = [{
                "exercise_id": 1,
                "exercise_name": "Exercice au poids du corps",
                "body_part": "Général",
                "sets": 3,
                "target_reps": "10-15",
                "suggested_weight": None,
                "rest_time": 60,
                "order_index": 1
            }]
        
        return {
            "muscles": list(set(ex["body_part"] for ex in fallback_exercises)),
            "exercises": fallback_exercises,
            "estimated_duration": min(time_available, 30),
            "readiness_scores": {m: 0.5 for m in muscles_cibles},
            "session_metadata": {
                "fallback": True,
                "reason": "Erreur de génération normale - Mode dégradé"
            }
        }

    def _select_exercises_for_day(
        self,
        body_parts: Dict,
        muscle_group: str,
        experience_level: str,
        exercise_rotation_offset: int = 0
    ) -> List[Exercise]:
        """
        Sélectionne les exercices pour une journée
        """
        logger.error(f"DEBUG _select_exercises_for_day:")
        logger.error(f"  - muscle_group demandé: '{muscle_group}'")
        logger.error(f"  - body_parts disponibles: {list(body_parts.keys())}")
        
        selected = []
        
        # Mapping des groupes musculaires
        muscle_mapping = {
            "Pectoraux/Triceps": ["pectoraux", "bras"],
            "Dos/Biceps": ["dos", "bras"],
            "Jambes": ["jambes"],
            "Épaules/Abdos": ["epaules", "abdominaux"],
            "Haut du corps": ["pectoraux", "dos", "epaules"],
            "Bas du corps": ["jambes"],
            "Full body": ["pectoraux", "dos", "jambes", "epaules"],
            "Bras": ["bras"],
        }
        
        target_parts = muscle_mapping.get(muscle_group, [muscle_group])
        logger.error(f"  - target_parts après mapping: {target_parts}")
        
        # Nombre d'exercices selon le niveau
        exercise_counts = {
            "débutant": 3,
            "intermédiaire": 4,
            "avancé": 5,
            "élite": 6,
            "extrême": 7
        }
        
        max_exercises = exercise_counts.get(experience_level, 4)
        exercises_per_part = max(2, max_exercises // len(target_parts))
        
        # Pour chaque partie musculaire
        for i, part in enumerate(target_parts):
            logger.error(f"  - Recherche de '{part}' dans body_parts...")
            
            if part in body_parts:
                part_exercises = body_parts[part]
                logger.error(f"    ✓ Trouvé {len(part_exercises)} exercices")
                
                # Appliquer la rotation
                if exercise_rotation_offset > 0 and len(part_exercises) > 3:
                    part_exercises = part_exercises[exercise_rotation_offset:] + part_exercises[:exercise_rotation_offset]
                
                # Séparer par niveau
                compound = [ex for ex in part_exercises if ex.level in ["basique", "avancé"]]
                isolation = [ex for ex in part_exercises if ex.level in ["isolation", "finition"]]
                
                # Sélection selon le type de muscle
                if part in ["Pectoraux", "Dos", "Jambes"]:
                    # Gros muscles : privilégier les composés
                    if compound:
                        selected.extend(compound[:min(2, exercises_per_part)])
                    if isolation and len(selected) < max_exercises:
                        remaining = max_exercises - len(selected)
                        selected.extend(isolation[:min(remaining, exercises_per_part-1)])
                else:
                    # Petits muscles : mélanger
                    mixed = compound + isolation
                    count = min(exercises_per_part, len(mixed))
                    if i == 0:  # Premier muscle = plus d'exercices
                        count = min(count + 1, len(mixed))
                    selected.extend(mixed[:count])
                
                if len(selected) >= max_exercises:
                    break
            else:
                logger.error(f"    ✗ '{part}' NON TROUVÉ dans {list(body_parts.keys())}")
        
        # Assurer un minimum de 3 exercices
        if len(selected) < 3:
            all_available = []
            for exercises_list in body_parts.values():
                all_available.extend(exercises_list)
            remaining = [ex for ex in all_available if ex not in selected]
            selected.extend(remaining[:3 - len(selected)])
        
        logger.error(f"  - Retour de {len(selected)} exercices sélectionnés")
        return selected[:max_exercises]
   
    def get_sets_reps_for_level(self, exercise: Exercise, level: str, goals: List[str]) -> Dict:
        """
        Obtient les sets/reps recommandés
        """
        # Vérifier que sets_reps existe
        if not exercise.sets_reps:
            return {"sets": 3, "reps": 10}  # Valeurs par défaut
        
        # Trouver la configuration pour ce niveau
        sets_reps_config = None
        for config in exercise.sets_reps:
            if config["level"] == level:
                sets_reps_config = config
                break
        
        if not sets_reps_config:
            # Utiliser le niveau intermédiaire par défaut
            for config in exercise.sets_reps:
                if config["level"] == "intermédiaire":
                    sets_reps_config = config
                    break
        
        if not sets_reps_config:
            # Valeurs par défaut
            return {"sets": 3, "reps": 10}
        
        # Ajuster selon les objectifs
        sets = sets_reps_config["sets"]
        reps = sets_reps_config["reps"]
        
        if goals:
            for goal in goals:
                if goal in self.GOAL_ADJUSTMENTS:
                  sets = int(sets * self.GOAL_ADJUSTMENTS[goal]["sets"])
                  reps = int(reps * self.GOAL_ADJUSTMENTS[goal]["reps"])
        
        return {"sets": sets, "reps": reps}
    
    def analyze_injury_risk(self, user: User) -> Dict:
        """
        Analyse le risque de blessure basé sur:
        - Les patterns de fatigue
        - L'augmentation rapide des charges
        - Les zones de douleur signalées
        """
        # Récupérer l'historique récent
        recent_workouts = self.db.query(Workout).filter(
            Workout.user_id == user.id,
            Workout.created_at >= datetime.now(timezone.utc) - timedelta(days=14)
        ).all()
        
        risk_factors = []
        risk_level = "low"
        
        # Analyser la fréquence d'entraînement
        workout_days = len(set(w.created_at.date() for w in recent_workouts))
        if workout_days > 10:
            risk_factors.append("Fréquence d'entraînement très élevée")
            risk_level = "medium"
        
        # Analyser les niveaux de fatigue
        all_sets = []
        for workout in recent_workouts:
            all_sets.extend(workout.sets)
        
        if all_sets:
            avg_fatigue = self._mean([s.fatigue_level for s in all_sets if s.fatigue_level])
            if avg_fatigue > 3.5:
                risk_factors.append("Niveau de fatigue chronique élevé")
                risk_level = "high" if risk_level == "medium" else "medium"
            
            # Analyser l'augmentation des charges
            by_exercise = {}
            for s in all_sets:
                if s.exercise_id not in by_exercise:
                    by_exercise[s.exercise_id] = []
                by_exercise[s.exercise_id].append((s.completed_at, s.weight))
            
            for exercise_id, history in by_exercise.items():
                if len(history) >= 3:
                    history.sort(key=lambda x: x[0])
                    weights = [h[1] for h in history]
                    
                    # Calculer l'augmentation sur les 3 dernières séances
                    if weights[-1] > weights[-3] * 1.15:
                        risk_factors.append(f"Augmentation rapide de charge détectée")
                        risk_level = "high"
        
        recommendations = []
        if risk_level == "high":
            recommendations = [
                "⚠️ Risque élevé détecté",
                "Réduire l'intensité pendant 3-5 jours",
                "Privilégier la récupération active",
                "Consulter un professionnel si douleur"
            ]
        elif risk_level == "medium":
            recommendations = [
                "Surveillance recommandée",
                "Intégrer plus de jours de repos",
                "Focus sur la technique"
            ]
        else:
            recommendations = [
                "✅ Risque faible",
                "Continuer la progression actuelle",
                "Maintenir une bonne récupération"
            ]
        
        return {
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "recommendations": recommendations,
            "recovery_days_recommended": 2 if risk_level == "high" else 1
        }
    
    def calculate_weight_for_exercise(self, user: User, exercise: Exercise, reps: int) -> float:
        """Calcule le poids suggéré avec gestion d'erreur robuste"""
        try:
            if not user or not exercise:
                logger.warning("Paramètres invalides pour calculate_weight_for_exercise")
                return self._get_default_weight_for_exercise(exercise)
            
            prediction = self.predict_next_session_performance(user, exercise, 3, reps)
            weight = prediction.get("predicted_weight", 0)
            
            # Validation du poids
            if 0 < weight <= 500:
                return weight
            else:
                logger.info(f"Poids hors limites ({weight}kg) pour {exercise.name_fr}, utilisation du poids de départ")
                return self.calculate_starting_weight(user, exercise)
                
        except Exception as e:
            logger.error(f"Erreur calculate_weight pour {exercise.name_fr}: {str(e)}", exc_info=True)
            # Fallback simple basé sur le type d'exercice
            return self._get_default_weight_for_exercise(exercise)

    def _get_default_weight_for_exercise(self, exercise: Exercise) -> float:
        """Retourne un poids par défaut sécurisé selon le type d'exercice"""
        defaults = {
            "Pectoraux": 40.0,
            "Dos": 50.0,
            "Jambes": 60.0,
            "Deltoïdes": 20.0,
            "Bras": 15.0,
            "Abdominaux": 0.0
        }
        return defaults.get(exercise.body_part, 20.0)

# ========== NOUVEAUX MODULES PHASE 2.2 ==========

class RecoveryTracker:
    """Module 1 : Gestion de la récupération"""
    def __init__(self, db: Session):
        self.db = db
    
    def get_muscle_readiness(self, muscle: str, user: User) -> float:
        """Score 0-1 basé sur fatigue, dernière séance, sommeil"""
        from backend.models import AdaptiveTargets
        
        # Récupérer la target adaptive pour ce muscle
        target = self.db.query(AdaptiveTargets).filter(
            AdaptiveTargets.user_id == user.id,
            AdaptiveTargets.muscle_group == muscle
        ).first()
        
        if not target or not target.last_trained:
            return 1.0  # Muscle frais
        
        hours_since = (datetime.now(timezone.utc) - target.last_trained).total_seconds() / 3600
        
        # Récupération basée sur le temps (48-72h optimal)
        if hours_since < 24:
            recovery = 0.3
        elif hours_since < 48:
            recovery = 0.7
        elif hours_since < 72:
            recovery = 0.9
        else:
            recovery = 1.0
        
        # Ajuster selon la dette de récupération
        if target.recovery_debt > 0:
            recovery *= (1 - min(0.5, target.recovery_debt / 10))
        
        return max(0.2, recovery)  # Minimum 20%

class VolumeOptimizer:
    """Module 2 : Optimisation du volume"""
    def __init__(self, db: Session):
        self.db = db
    
    def calculate_optimal_volume(self, user: User, muscle: str) -> int:
        """Calcul du volume optimal basé sur historique et objectifs"""
        from backend.models import UserCommitment
        
        # Récupérer l'engagement utilisateur
        commitment = self.db.query(UserCommitment).filter(
            UserCommitment.user_id == user.id
        ).first()
        
        # Volume de base selon objectif principal
        primary_goal = user.goals[0] if user.goals else "hypertrophie"
        base_volumes = {
            "force": 10,
            "hypertrophie": 16,
            "endurance": 20,
            "perte_de_poids": 14,
            "cardio": 12,
            "flexibility": 8
        }
        base_volume = base_volumes.get(primary_goal, 16)
        
        # Ajuster selon l'expérience
        exp_multipliers = {
            "débutant": 0.7,
            "intermédiaire": 1.0,
            "avancé": 1.2,
            "élite": 1.4,
            "extrême": 1.5
        }
        exp_mult = exp_multipliers.get(user.experience_level, 1.0)
        
        # Ajuster selon le focus musculaire
        if commitment and muscle in commitment.focus_muscles:
            focus_level = commitment.focus_muscles[muscle]
            if focus_level == "always":
                exp_mult *= 1.5
            elif focus_level == "priority":
                exp_mult *= 1.3
            elif focus_level == "never":
                exp_mult *= 0.3  # Minimum vital pour éviter les blessures
        
            realistic_volumes = {
                "force": 4000,      # Moins de volume, charges lourdes
                "hypertrophie": 6000,   # Volume modéré-élevé
                "endurance": 8000,   # Volume élevé, charges légères
                "général": 5000      # Équilibré
            }

            base_volume = realistic_volumes.get(primary_goal, 5000)
            result = int(base_volume * exp_mult)
            # S'assurer qu'on ne retourne jamais None ou 0
            return max(1000, result) if result else 5000
    
    def get_volume_deficit(self, user: User) -> Dict[str, float]:
        """Retourne les muscles en retard sur leur volume cible"""
        from backend.models import AdaptiveTargets
        
        targets = self.db.query(AdaptiveTargets).filter(
            AdaptiveTargets.user_id == user.id
        ).all()
        
        deficits = {}
        for target in targets:
            if target.target_volume and target.target_volume > 0:  # Vérifier None d'abord
                deficit = (target.target_volume - target.current_volume) / target.target_volume
                if deficit > 0.2:  # Plus de 20% de retard
                    deficits[target.muscle_group] = deficit
        
        return dict(sorted(deficits.items(), key=lambda x: x[1], reverse=True))

class SessionBuilder:
    """Module 3 : Construction de séance pure"""
    def __init__(self, db: Session):
        self.db = db
        self.ml_engine = FitnessMLEngine(db)  # Réutiliser l'existant

    def get_user_available_equipment(self, user: User) -> List[str]:
        """Délègue à ml_engine pour obtenir l'équipement disponible"""
        return self.ml_engine.get_user_available_equipment(user)

    def build_session(self, muscles: List[str], time_budget: int, 
                    user: User, constraints: Dict = None) -> List[Dict]:
        """Construction d'une séance optimisée avec limitation intelligente"""

        # AJOUTER au début (après les logs existants) :
        # Adapter le nombre d'exercices au temps disponible
        if time_budget <= 30:
            max_total_exercises = 3
            max_per_muscle = 2
        elif time_budget <= 45:
            max_total_exercises = 4
            max_per_muscle = 2
        elif time_budget <= 60:
            max_total_exercises = 5
            max_per_muscle = 2
        else:
            max_total_exercises = 8
            max_per_muscle = 3

        logger.info(f"Time budget: {time_budget}min -> Max {max_total_exercises} exercises total, {max_per_muscle} per muscle")

        # Ajouter des logs de débogage (GARDER votre code existant)
        logger.info(f"Building session for muscles: {muscles}")
        logger.info(f"User equipment: {user.equipment_config}")
        
        # Récupérer tous les exercices disponibles (GARDER votre code)
        all_exercises = self.db.query(Exercise).all()
        logger.info(f"Total exercises in DB: {len(all_exercises)}")
        
        # Filtrer par muscle (GARDER votre code)
        muscle_exercises = [e for e in all_exercises if e.body_part in muscles]
        logger.info(f"Exercises for selected muscles: {len(muscle_exercises)}")

        session = []
        time_used = 0
        constraints = constraints or {}
        
        # MODIFIER cette ligne pour limiter les muscles traités :
        for muscle in muscles:
            # Vérifier si on a déjà atteint le max d'exercices
            if len(session) >= max_total_exercises:
                logger.info(f"Max exercises ({max_total_exercises}) atteint, arrêt de l'ajout")
                break
                
            # Récupérer exercices disponibles (GARDER votre code existant)
            exercises = self.db.query(Exercise).filter(
                Exercise.body_part == muscle
            ).all()
            
            # Filtrer par équipement disponible (GARDER votre code)
            # Filtrer par équipement disponible
            available_exercises = []
            for ex in exercises:
                is_compatible = self._check_equipment_availability(ex, user)
                if ex.equipment and "dumbbells" in ex.equipment:
                    logger.info(f"🏋️ {ex.name_fr}: dumbbells requis, compatible={is_compatible}")
                
                # AJOUTER CES LIGNES
                if is_compatible:
                    available_exercises.append(ex)
            
            if not available_exercises:
                continue
            
            # MODIFIER cette ligne pour utiliser la limite calculée :
            selected_exercises = self._select_best_exercises(
                available_exercises, user, muscle, max_exercises=max_per_muscle
            )
            
            for selected in selected_exercises:
                # Vérifier si on a déjà atteint le max total
                if len(session) >= max_total_exercises:
                    logger.info(f"Max total exercises ({max_total_exercises}) atteint")
                    break
                    
                # GARDER TOUT votre code existant pour sets/reps/poids/temps :
                sets = 3 if user.experience_level in ["débutant", "intermédiaire"] else 4
                
                # Adapter les reps selon l'objectif
                if "force" in user.goals:
                    reps = 5
                elif "endurance" in user.goals:
                    reps = 15
                else:
                    reps = 10
                
                # Temps de repos selon objectif
                if "force" in user.goals:
                    rest = 180
                elif "endurance" in user.goals:
                    rest = 60
                else:
                    rest = 120
                
                # Calculer le poids suggéré via ML existant avec gestion d'erreur
                try:
                    weight = self.ml_engine.calculate_weight_for_exercise(user, selected, reps)
                except Exception as e:
                    logger.error(f"Erreur calcul poids pour {selected.name_fr}: {e}")
                    weight = 20.0  # Poids par défaut sécurisé
                
                exercise_time = sets * (30 + rest)  # 30s par série + repos
                
                if time_used + exercise_time <= time_budget * 60:  # Convertir minutes en secondes
                    session.append({
                        "exercise_id": selected.id,
                        "exercise_name": selected.name_fr,
                        "body_part": selected.body_part,
                        "sets": int(sets),
                        "target_reps": int(reps),
                        "suggested_weight": float(weight),
                        "rest_time": int(rest)
                    })
                    time_used += exercise_time
        
        # GARDER TOUT votre code de logs et fallbacks existant :
        logger.info(f"Session construite: {len(session)} exercices")
        for ex in session:
            logger.info(f"  - {ex['exercise_name']} ({ex['body_part']})")

        # Si moins de 2 exercices (au lieu de 3), essayer d'en ajouter plus
        min_exercises = 2 if time_budget <= 30 else 3
        if len(session) < min_exercises:
            logger.warning(f"Seulement {len(session)} exercices trouvés, recherche supplémentaire...")
            # GARDER votre logique de recherche supplémentaire
            all_exercises = self.db.query(Exercise).filter(Exercise.body_part.in_(muscles)).all()
            available_all = [ex for ex in all_exercises if self._check_equipment_availability(ex, user)]
            
            # Limiter l'ajout selon le budget temps
            for ex in available_all[:max_total_exercises]:
                if len(session) >= max_total_exercises:
                    break
                if ex.id not in [s["exercise_id"] for s in session]:
                    session.append({
                        "exercise_id": ex.id,
                        "exercise_name": ex.name_fr,
                        "body_part": ex.body_part,
                        "sets": 3,
                        "target_reps": 10,
                        "suggested_weight": 20.0,
                        "rest_time": 90
                    })
                    if len(session) >= min_exercises:
                        break
            
            logger.info(f"Après recherche supplémentaire: {len(session)} exercices")

        # GARDER votre fallback ultime :
        if not session and muscles:
            # Fallback : prendre n'importe quel exercice COMPATIBLE
            all_muscle_exercises = self.db.query(Exercise).filter(
                Exercise.body_part.in_(muscles)
            ).all()
            
            # Filtrer par équipement disponible
            for fallback_exercise in all_muscle_exercises:
                # Vérifier directement l'équipement sans passer par la méthode
                available_equipment = self.get_user_available_equipment(user)
                exercise_equipment = fallback_exercise.equipment or []
                if not exercise_equipment or any(eq in available_equipment for eq in exercise_equipment):
                    # Utiliser cet exercice compatible
                    break
            
            if fallback_exercise:
                try:
                    fallback_weight = self.ml_engine.calculate_weight_for_exercise(user, fallback_exercise, 10)
                except Exception as e:
                    logger.error(f"Erreur calcul poids fallback pour {fallback_exercise.name_fr}: {e}")
                    fallback_weight = 20.0
                
                session.append({
                    "exercise_id": fallback_exercise.id,
                    "exercise_name": fallback_exercise.name_fr,
                    "body_part": fallback_exercise.body_part,
                    "sets": 3,
                    "target_reps": 10,
                    "rest_time": 90,
                    "suggested_weight": float(fallback_weight)
                })
                
        return session 
    
    def _check_equipment_availability(self, exercise: Exercise, user: User) -> bool:
        """Vérifie si l'équipement nécessaire est disponible"""
        if not exercise.equipment:
            return True
        
        available_equipment = self.ml_engine.get_user_available_equipment(user)
        exercise_equipment = exercise.equipment or []
        
        return any(eq in available_equipment for eq in exercise_equipment)
    


    def _select_best_exercises(self, exercises: List[Exercise], 
                                user: User, target_parts: List[str], 
                                max_exercises: Optional[int] = None, exercise_rotation_offset: int = 0) -> List[Exercise]:
        """Sélectionne les meilleurs exercices selon plusieurs critères et répartit sur gros/petits groupes
        :param max_exercises: nombre max d'exos à retourner ; si None, déterminé par niveau d'expérience
        """

        # --- 0. Déterminer max_exercises par niveau si pas forcé
        if max_exercises is None:
            lvl_map_count = {
                'débutant': 2,
                'intermédiaire': 3,
                'avancé': 4,
                'élite': 5,
                'extrême': 5
            }
            max_exercises = lvl_map_count.get(user.experience_level, 2)

        # --- 1. Filtrer par équipement disponible
        suitable = exercises
        if hasattr(user, 'available_equipment'):
            avail = set(user.available_equipment or [])
            filt = [ex for ex in suitable if any(eq in avail for eq in ex.equipment)]
            suitable = filt or suitable

        # --- 2. Filtrer par niveau d'expérience
        suitable = [ex for ex in suitable if self._is_suitable_level(ex.level, user.experience_level)]
        if not suitable:
            suitable = exercises

        # --- 3. Historique récent (14 jours) pour fréquence + performance
        cutoff = datetime.now(timezone.utc) - timedelta(days=14)
        recent = (self.db.query(WorkoutSet)
                    .join(Workout)
                    .filter(Workout.user_id == user.id,
                            Workout.completed_at >= cutoff,
                            WorkoutSet.exercise_id.in_([ex.id for ex in suitable]))
                    .all())
        freq, perf = {}, {}
        for rec in recent:
            freq[rec.exercise_id] = freq.get(rec.exercise_id, 0) + 1
            if rec.target_reps:
                perf.setdefault(rec.exercise_id, []).append(rec.reps / rec.target_reps)

        # --- 4. Scoring (identique à l'original)
        def score_ex(ex: Exercise) -> float:
            s = 0
            f = freq.get(ex.id, 0)
            s += 30 if f == 0 else (20 if f <= 2 else (10 if f <= 5 else 0))
            if ex.id in perf:
                avg = sum(perf[ex.id]) / len(perf[ex.id])
                s += 15 if avg >= 1.0 else (10 if avg >= 0.9 else 0)
            else:
                s += 5
            primary_goal = user.goals[0] if user.goals else "hypertrophie"
            if ex.exercise_type == "compound":
                s += 20 if primary_goal in ["force", "hypertrophie"] else 10
            diff_map = {"beginner":1, "intermediate":3, "advanced":5}
            lvl_map = {"débutant":1, "intermédiaire":2, "avancé":3, "élite":4, "extrême":5}
            comp = diff_map.get(ex.difficulty, 3)
            lvl_num = lvl_map.get(user.experience_level, 2)
            s += 10 if abs(comp - lvl_num) <= 1 else (-20 if comp > lvl_num + 2 else 0)
            # pénalité blessures
            if hasattr(user, 'injuries') and ex.risky_for and any(i in ex.risky_for for i in user.injuries):
                s -= 30
            return s

        scored = sorted(suitable, key=lambda e: score_ex(e), reverse=True)

        # --- 5. Répartition primaire/secondaire + rotation
        selected = []
        remaining = max_exercises
        primary_groups = [p for p in target_parts if p in ["Pectoraux", "Dos", "Jambes"]]
        secondary_groups = [p for p in target_parts if p not in ["Pectoraux", "Dos", "Jambes"]]

        def pick_from_group(parts, per_group):
            nonlocal remaining
            for part in parts:
                if remaining <= 0:
                    return
                exos = [ex for ex in scored if part in ex.target_muscles]
                if exercise_rotation_offset and len(exos) > 3:
                    exos = exos[exercise_rotation_offset:] + exos[:exercise_rotation_offset]
                exos = sorted(exos, key=lambda e: score_ex(e), reverse=True)
                for ex in exos[:per_group]:
                    if remaining <= 0:
                        break
                    selected.append(ex)
                    remaining -= 1

        total_parts = len(primary_groups) + len(secondary_groups)
        if primary_groups:
            per_primary = max(1, remaining // total_parts)
            per_secondary = max(1, (remaining - len(primary_groups)*per_primary) // max(1, len(secondary_groups)))
        else:
            per_primary = 0
            per_secondary = max(1, remaining // max(1, total_parts))

        pick_from_group(primary_groups, per_primary)
        pick_from_group(secondary_groups, per_secondary)

        # --- 6. Fallback global jusqu'à un minimum de 3 ou max_exercises
        min_required = min(3, max_exercises)
        if len(selected) < min_required and remaining > 0:
            all_available = [ex for ex in scored if ex not in selected]
            for ex in all_available:
                if remaining <= 0 or len(selected) >= max_exercises:
                    break
                selected.append(ex)
                remaining -= 1

        logger.info(f"Sélection {target_parts}: {[ex.name_fr for ex in selected]}")
        return selected[:max_exercises]

    
    def _is_suitable_level(self, exercise_level: str, user_level: str) -> bool:
        """Vérifie si l'exercice convient au niveau de l'utilisateur"""
        level_hierarchy = {
            "débutant": 1,
            "intermédiaire": 2,
            "avancé": 3,
            "élite": 4,
            "extrême": 5
        }
        
        ex_level = level_hierarchy.get(exercise_level, 2)
        user_level_num = level_hierarchy.get(user_level, 2)
        
        # Accepter jusqu'à 1 niveau au-dessus
        return ex_level <= user_level_num + 1

class ProgressionAnalyzer:
    """Module 4 : Analyse de trajectoire"""
    def __init__(self, db: Session):
        self.db = db
    
    def get_trajectory_status(self, user: User) -> Dict:
        """Analyse complète de la progression vers les objectifs"""
        from backend.models import UserCommitment, AdaptiveTargets
        
        commitment = self.db.query(UserCommitment).filter(
            UserCommitment.user_id == user.id
        ).first()
        
        if not commitment:
            return {
                "status": "no_commitment",
                "on_track": False,
                "sessions_this_week": 0,
                "sessions_target": 0,
                "volume_adherence": 0.0,
                "consistency_score": 0.0,
                "muscle_balance": {},
                "insights": ["Définissez vos objectifs pour commencer le suivi"]
            }
        
        # Calculer les métriques sur 7 jours glissants
        sessions_last_7d = self.db.query(Workout).filter(
            Workout.user_id == user.id,
            Workout.created_at > datetime.now(timezone.utc) - timedelta(days=7),
            Workout.status == "completed"
        ).count()
        
        # Volume par muscle
        volume_by_muscle = self._calculate_volume_by_muscle(user, days=7)
        
        # Score de consistance (30 jours)
        consistency = self._calculate_consistency_score(user, days=30)
        
        # Adhérence au volume
        volume_adherence = self._calculate_volume_adherence(user)
        
        # Analyse de l'équilibre musculaire
        muscle_balance = self._analyze_muscle_balance(volume_by_muscle)
        
        # Insights personnalisés
        insights = self._generate_insights(
            user, volume_by_muscle, sessions_last_7d, commitment, consistency
        )
        
        return {
            "on_track": sessions_last_7d >= commitment.sessions_per_week * 0.7,
            "sessions_this_week": sessions_last_7d,
            "sessions_target": commitment.sessions_per_week,
            "volume_adherence": volume_adherence,
            "consistency_score": consistency,
            "muscle_balance": muscle_balance,
            "insights": insights
        }
    
    def _calculate_volume_by_muscle(self, user: User, days: int) -> Dict[str, int]:
        """Calcule le volume total par muscle sur X jours"""
        from sqlalchemy import and_
        
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        # Requête pour obtenir le volume
        results = self.db.query(
            Exercise.body_part,
            func.sum(WorkoutSet.reps * WorkoutSet.weight).label('volume')
        ).join(
            WorkoutSet, WorkoutSet.exercise_id == Exercise.id
        ).join(
            Workout, Workout.id == WorkoutSet.workout_id
        ).filter(
            and_(
                Workout.user_id == user.id,
                Workout.created_at > cutoff_date,
                Workout.status == "completed"
            )
        ).group_by(Exercise.body_part).all()
        
        return {muscle: int(volume or 0) for muscle, volume in results}
    
    def _calculate_consistency_score(self, user: User, days: int) -> float:
        """Score de régularité sur X jours"""
        from backend.models import UserCommitment
        
        commitment = self.db.query(UserCommitment).filter(
            UserCommitment.user_id == user.id
        ).first()
        
        if not commitment:
            return 0.5
        
        # Compter les séances complétées
        workouts_count = self.db.query(Workout).filter(
            Workout.user_id == user.id,
            Workout.created_at > datetime.now(timezone.utc) - timedelta(days=days),
            Workout.status == "completed"
        ).count()
        
        # Calculer l'attendu
        expected = (days / 7) * commitment.sessions_per_week
        
        return min(1.0, workouts_count / expected) if expected > 0 else 0
    
    def _calculate_volume_adherence(self, user: User) -> float:
        """Calcule l'adhérence au volume cible"""
        from backend.models import AdaptiveTargets
        
        targets = self.db.query(AdaptiveTargets).filter(
            AdaptiveTargets.user_id == user.id
        ).all()
        
        if not targets:
            return 1.0
        
        adherences = []
        for target in targets:
            if target.target_volume and target.target_volume > 0:  # Vérifier None d'abord
                adherence = min(1.0, target.current_volume / target.target_volume)
                adherences.append(adherence)
        
        return sum(adherences) / len(adherences) if adherences else 0.5  # 50% par défaut
    
    def _analyze_muscle_balance(self, volume_by_muscle: Dict[str, int]) -> Dict[str, float]:
        """Analyse l'équilibre entre les groupes musculaires"""
        if not volume_by_muscle:
            return {}
        
        total_volume = sum(volume_by_muscle.values())
        if total_volume == 0:
            return {}
        
        # Calculer les pourcentages
        balance = {}
        for muscle, volume in volume_by_muscle.items():
            balance[muscle] = round(volume / total_volume * 100, 1)
        
        return balance
    
    def _generate_insights(self, user: User, volume_by_muscle: Dict, 
                          sessions_count: int, commitment: Any, 
                          consistency: float) -> List[str]:
        """Génère des insights personnalisés"""
        insights = []
        
        # Insight sur la régularité
        if sessions_count == 0:
            insights.append("💪 C'est le moment de reprendre ! Une petite séance aujourd'hui ?")
        elif sessions_count < commitment.sessions_per_week * 0.7:
            insights.append(f"⚠️ {sessions_count}/{commitment.sessions_per_week} séances cette semaine. Essayons d'en faire une de plus !")
        elif sessions_count >= commitment.sessions_per_week:
            insights.append(f"🔥 Objectif atteint : {sessions_count} séances ! Excellent travail !")
        
        # Insight sur la consistance
        if consistency > 0.8:
            insights.append("🎯 Régularité exemplaire sur 30 jours !")
        elif consistency < 0.5:
            insights.append("📈 La régularité est la clé : essayons de maintenir le rythme")
        
        # Insight sur l'équilibre musculaire
        if volume_by_muscle:
            max_muscle = max(volume_by_muscle.items(), key=lambda x: x[1])
            min_muscle = min(volume_by_muscle.items(), key=lambda x: x[1])
            
            if max_muscle[1] > min_muscle[1] * 3:
                insights.append(f"⚖️ {min_muscle[0].capitalize()} négligé : seulement {min_muscle[1]} séries cette semaine")
        
        # Insight sur les muscles prioritaires
        if commitment.focus_muscles:
            for muscle, priority in commitment.focus_muscles.items():
                if priority == "priority" and muscle in volume_by_muscle:
                    if volume_by_muscle[muscle] < 10:
                        insights.append(f"🎯 {muscle.capitalize()} est prioritaire mais peu travaillé cette semaine")
        
        return insights[:3]  # Max 3 insights

    def get_exercise_staleness(self, user_id: int, exercise_id: int) -> float:
        """Retourne 0.0 (très récent) à 1.0 (pas fait depuis longtemps)"""
        latest_set = self.db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user_id,
            WorkoutSet.exercise_id == exercise_id,
            Workout.status == "completed"
        ).order_by(Workout.completed_at.desc()).first()
        
        if not latest_set:
            return 1.0  # Jamais fait = maximum staleness
        
        # Correction timezone : gérer les datetime avec et sans timezone
        completed_at = latest_set.workout.completed_at
        now = datetime.now(timezone.utc)
        
        # Si completed_at n'a pas de timezone, lui ajouter UTC
        if completed_at.tzinfo is None:
            completed_at = completed_at.replace(tzinfo=timezone.utc)
        
        days_since = (now - completed_at).days
        staleness = min(1.0, days_since / 7.0)
        return staleness

# ========== ADAPTATEUR TEMPS RÉEL ==========

class RealTimeAdapter:
    """Gestion de l'adaptation en temps réel"""
    def __init__(self, db: Session):
        self.db = db
        self.recovery_tracker = RecoveryTracker(db)
        self.volume_optimizer = VolumeOptimizer(db)
        self.progression_analyzer = ProgressionAnalyzer(db)
    
    def handle_session_completed(self, workout: Workout):
        """Appelé après chaque séance pour adapter les targets"""
        from backend.models import AdaptiveTargets
        
        # Mettre à jour les volumes réalisés
        self._update_current_volumes(workout)
        
        # Détecter les patterns de fatigue
        if self._detect_overtraining(workout.user):
            self._force_deload_period(workout.user)
        
        # Ajuster les targets adaptatifs
        self._recalibrate_targets(workout.user)
    
    def handle_session_skipped(self, user: User, reason: str = None):
        """Gestion intelligente des séances ratées"""
        from backend.models import UserCommitment, AdaptiveTargets
        
        # Pas de culpabilisation, juste adaptation
        commitment = self.db.query(UserCommitment).filter(
            UserCommitment.user_id == user.id
        ).first()
        
        if commitment:
            # Réduire temporairement les attentes
            targets = self.db.query(AdaptiveTargets).filter(
                AdaptiveTargets.user_id == user.id
            ).all()
            
            for target in targets:
                target.target_volume *= 0.9  # Réduire de 10%
            
            self.db.commit()
    
    def get_smart_reminder(self, user: User) -> str:
        """Génère un rappel contextuel intelligent"""
        from backend.models import UserCommitment
        
        # Analyser le contexte
        trajectory = self.progression_analyzer.get_trajectory_status(user)
        
        if trajectory["sessions_this_week"] == 0:
            return "💪 Pas grave pour les séances ratées. 30 min aujourd'hui ?"
        elif trajectory["sessions_this_week"] >= 5:
            return "🔥 5 séances d'affilée ! Repos mérité ou on continue ?"
        elif trajectory["consistency_score"] > 0.8:
            return "🎯 Tu es sur une excellente lancée ! Prêt pour la suite ?"
        else:
            return "💪 C'est le moment parfait pour une séance !"
    
    def _update_current_volumes(self, workout: Workout):
        """Met à jour les volumes réalisés dans les targets adaptatifs"""
        from backend.models import AdaptiveTargets
        
        # Calculer le volume par muscle pour cette séance
        volume_by_muscle = {}
        for set_item in workout.sets:
            exercise = self.db.query(Exercise).filter(
                Exercise.id == set_item.exercise_id
            ).first()
            
            if exercise:
                muscle = exercise.body_part
                volume = set_item.reps * set_item.weight
                
                if muscle in volume_by_muscle:
                    volume_by_muscle[muscle] += volume
                else:
                    volume_by_muscle[muscle] = volume
        
        # Mettre à jour les targets
        for muscle, volume in volume_by_muscle.items():
            target = self.db.query(AdaptiveTargets).filter(
                AdaptiveTargets.user_id == workout.user_id,
                AdaptiveTargets.muscle_group == muscle
            ).first()
            
            if target:
                # Recalculer sur fenêtre de 7 jours
                target.current_volume = self._calculate_7day_volume(workout.user_id, muscle)
                target.last_trained = workout.completed_at or datetime.now(timezone.utc)
                
                # Mettre à jour la dette de récupération
                avg_fatigue = sum(s.fatigue_level for s in workout.sets) / len(workout.sets)
                target.recovery_debt = max(0, target.recovery_debt + (avg_fatigue - 2.5) * 0.5)
        
        self.db.commit()
    
    def _calculate_7day_volume(self, user_id: int, muscle: str) -> float:
        """Calcule le volume sur 7 jours glissants"""
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        
        result = self.db.query(func.sum(WorkoutSet.reps * WorkoutSet.weight)).join(
            Workout
        ).join(
            Exercise
        ).filter(
            Workout.user_id == user_id,
            Exercise.body_part == muscle,
            Workout.created_at > cutoff,
            Workout.status == "completed"
        ).scalar()
        
        return float(result or 0)
    
    def _detect_overtraining(self, user: User) -> bool:
        """Détecte les signes de surentraînement"""
        # Moyenne de fatigue sur 7 jours
        avg_fatigue = self.db.query(func.avg(WorkoutSet.fatigue_level)).join(
            Workout
        ).filter(
            Workout.user_id == user.id,
            Workout.created_at > datetime.now(timezone.utc) - timedelta(days=7)
        ).scalar()
        
        return avg_fatigue and avg_fatigue > 4.0
    
    def _force_deload_period(self, user: User):
        """Force une période de décharge"""
        from backend.models import AdaptiveTargets
        
        targets = self.db.query(AdaptiveTargets).filter(
            AdaptiveTargets.user_id == user.id
        ).all()
        
        for target in targets:
            target.target_volume *= 0.6  # Réduire de 40%
            target.recovery_debt = 0  # Reset la dette
        
        self.db.commit()
    
    def _recalibrate_targets(self, user: User):
        """Recalibre les objectifs adaptatifs"""
        from backend.models import AdaptiveTargets
        
        targets = self.db.query(AdaptiveTargets).filter(
            AdaptiveTargets.user_id == user.id
        ).all()
        
        for target in targets:
            # Si le volume actuel dépasse la cible, augmenter la cible
            if target.current_volume > target.target_volume * 1.1:
                target.target_volume = target.current_volume
                target.adaptation_rate = min(1.5, target.adaptation_rate * 1.1)
            # Si très en dessous, ajuster la cible
            elif target.current_volume < target.target_volume * 0.5:
                target.target_volume *= 0.85
                target.adaptation_rate = max(0.5, target.adaptation_rate * 0.9)
        
        self.db.commit()


    def analyze_program_performance(self, user_id: int, program_id: int) -> dict:
        """Analyse les performances sur un programme"""
        # Récupérer les 2 dernières semaines de données
        two_weeks_ago = datetime.now(timezone.utc) - timedelta(days=14)
        
        recent_workouts = self.db.query(Workout).filter(
            Workout.user_id == user_id,
            Workout.created_at >= two_weeks_ago,
            Workout.status == "completed"
        ).all()
        
        if len(recent_workouts) < 3:
            return {
                "status": "insufficient_data",
                "message": "Pas assez de séances pour analyser"
            }
        
        # Analyser la progression par muscle
        muscle_progress = {}
        for workout in recent_workouts:
            sets = self.db.query(WorkoutSet).filter(
                WorkoutSet.workout_id == workout.id
            ).all()
            
            for set in sets:
                exercise = self.db.query(Exercise).filter(
                    Exercise.id == set.exercise_id
                ).first()
                
                muscle = exercise.body_part
                if muscle not in muscle_progress:
                    muscle_progress[muscle] = {
                        "weights": [],
                        "reps": [],
                        "fatigue": []
                    }
                
                muscle_progress[muscle]["weights"].append(set.weight)
                muscle_progress[muscle]["reps"].append(set.reps)
                muscle_progress[muscle]["fatigue"].append(set.fatigue_level)
        
        # Calculer les tendances
        analysis = {
            "status": "ready",
            "muscles": {}
        }
        
        for muscle, data in muscle_progress.items():
            if len(data["weights"]) > 0:
                avg_weight_progress = (
                    sum(data["weights"][-3:]) / 3 - 
                    sum(data["weights"][:3]) / min(3, len(data["weights"]))
                ) / (sum(data["weights"][:3]) / min(3, len(data["weights"])) + 0.1)
                
                avg_fatigue = sum(data["fatigue"]) / len(data["fatigue"])
                
                analysis["muscles"][muscle] = {
                    "weight_progress": avg_weight_progress * 100,  # en %
                    "average_fatigue": avg_fatigue,
                    "total_volume": sum(w * r for w, r in zip(data["weights"], data["reps"]))
                }
        
        return analysis

    def suggest_program_adjustments(self, user_id: int, program_id: int) -> dict:
        """Suggère des ajustements basés sur l'analyse"""
        analysis = self.analyze_program_performance(user_id, program_id)
        
        if analysis["status"] != "ready":
            return analysis
        
        suggestions = {
            "global_recommendations": [],
            "muscle_specific": {},
            "exercises_to_change": []
        }
        
        # Analyser chaque muscle
        for muscle, stats in analysis["muscles"].items():
            muscle_suggestions = []
            
            # Si progression forte et fatigue modérée → augmenter volume
            if stats["weight_progress"] > 5 and stats["average_fatigue"] < 7:
                muscle_suggestions.append({
                    "type": "increase_volume",
                    "reason": "Progression excellente, fatigue modérée",
                    "action": "Ajouter 1 série ou augmenter les charges de 2.5kg"
                })
            
            # Si stagnation → varier exercices
            elif -2 <= stats["weight_progress"] <= 2:
                muscle_suggestions.append({
                    "type": "change_exercises",
                    "reason": "Stagnation détectée",
                    "action": "Remplacer un exercice par une variante"
                })
                
                # CORRECTION ICI : Supprimer le join avec ProgramExercise
                # Récupérer les exercices actuels pour ce muscle
                current_exercises = self.db.query(Exercise).filter(
                    Exercise.body_part == muscle
                ).limit(3).all()
                
                # Récupérer des alternatives
                alternatives = self.db.query(Exercise).filter(
                    Exercise.body_part == muscle,
                    ~Exercise.id.in_([e.id for e in current_exercises])
                ).limit(3).all()
                
                if alternatives:
                    suggestions["exercises_to_change"].append({
                        "muscle": muscle,
                        "current": [e.name_fr for e in current_exercises[:1]],
                        "alternatives": [e.name_fr for e in alternatives]
                    })
            
            # Si fatigue excessive → réduire volume
            elif stats["average_fatigue"] > 8:
                muscle_suggestions.append({
                    "type": "reduce_volume",
                    "reason": "Fatigue excessive détectée",
                    "action": "Réduire d'1 série ou baisser les charges de 10%"
                })
            
            if muscle_suggestions:
                suggestions["muscle_specific"][muscle] = muscle_suggestions
        
        # Recommandations globales
        avg_fatigue_global = sum(
            s["average_fatigue"] for s in analysis["muscles"].values()
        ) / len(analysis["muscles"])
        
        if avg_fatigue_global > 7.5:
            suggestions["global_recommendations"].append({
                "type": "deload_week",
                "reason": "Fatigue générale élevée",
                "action": "Semaine de décharge recommandée (réduire volume de 40%)"
            })
        
        return suggestions