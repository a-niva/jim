# ===== backend/ml_recommendations.py - MOTEUR ML RECOMMANDATIONS =====
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, desc
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import statistics
import logging

from backend.models import User, Exercise, WorkoutSet, SetHistory, Workout

logger = logging.getLogger(__name__)


class FitnessRecommendationEngine:
    """
    Moteur ML simplifié pour recommander ajustements de poids/reps
    Basé sur fatigue, effort, disponibilité équipement et historique
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_set_recommendations(
        self, 
        user: User, 
        exercise: Exercise,
        set_number: int,
        current_fatigue: int,  # 1-5
        current_effort: int,   # 1-5 (effort de la série précédente)
        last_rest_duration: Optional[int] = None,  # en secondes
        exercise_order: int = 1,
        set_order_global: int = 1,
        available_weights: List[float] = None
    ) -> Dict[str, any]:
        """
        Génère des recommandations de poids/reps pour la prochaine série
        
        Returns:
        {
            "weight_recommendation": float,
            "reps_recommendation": int, 
            "confidence": float,
            "reasoning": str,
            "weight_change": str,  # "increase", "decrease", "same"
            "reps_change": str     # "increase", "decrease", "same"
        }
        """
        
        try:
            # 1. Récupérer l'historique pertinent
            historical_data = self._get_historical_context(
                user, exercise, set_number, exercise_order
            )
            
            # 2. Calculer la baseline (performance "normale" attendue)
            baseline_weight, baseline_reps = self._calculate_baseline(
                user, exercise, historical_data
            )
            
            # 3. Ajustements basés sur la fatigue actuelle
            fatigue_adjustment = self._calculate_fatigue_adjustment(
                current_fatigue, exercise_order, set_order_global
            )
            
            # 4. Ajustements basés sur l'effort de la série précédente
            effort_adjustment = self._calculate_effort_adjustment(
                current_effort, set_number
            )
            
            # 5. Ajustements basés sur le repos précédent
            rest_adjustment = self._calculate_rest_adjustment(
                last_rest_duration, exercise.base_rest_time_seconds
            )
            
            # 6. Appliquer les ajustements
            recommended_weight = baseline_weight * fatigue_adjustment * effort_adjustment * rest_adjustment
            recommended_reps = int(baseline_reps * (2 - fatigue_adjustment) * (2 - effort_adjustment))
            
            # 7. Valider avec les poids disponibles
            if available_weights:
                recommended_weight = self._find_closest_available_weight(
                    recommended_weight, available_weights
                )
            
            # 8. Calculer la confiance et le raisonnement
            confidence = self._calculate_confidence(historical_data, current_fatigue, current_effort)
            reasoning = self._generate_reasoning(
                fatigue_adjustment, effort_adjustment, rest_adjustment, 
                current_fatigue, current_effort, set_number
            )
            
            # 9. Déterminer les changements par rapport à la baseline
            weight_change = self._determine_change(recommended_weight, baseline_weight, 0.05)
            reps_change = self._determine_change(recommended_reps, baseline_reps, 0.1)
            
            return {
                "weight_recommendation": round(recommended_weight, 1),
                "reps_recommendation": max(1, recommended_reps),
                "confidence": confidence,
                "reasoning": reasoning,
                "weight_change": weight_change,
                "reps_change": reps_change,
                "baseline_weight": baseline_weight,
                "baseline_reps": baseline_reps
            }
            
        except Exception as e:
            logger.error(f"Erreur recommandations pour user {user.id}, exercise {exercise.id}: {e}")
            # Fallback sur les valeurs par défaut
            return {
                "weight_recommendation": None,
                "reps_recommendation": exercise.default_reps_min,
                "confidence": 0.0,
                "reasoning": "Données insuffisantes pour une recommandation",
                "weight_change": "same",
                "reps_change": "same",
                "baseline_weight": None,
                "baseline_reps": exercise.default_reps_min
            }
    
    def _get_historical_context(
        self, 
        user: User, 
        exercise: Exercise, 
        set_number: int,
        exercise_order: int
    ) -> List[Dict]:
        """Récupère l'historique pertinent pour cet exercice dans des contextes similaires"""
        
        # Récupérer les 30 dernières séries de cet exercice dans des conditions similaires
        similar_sets = self.db.query(SetHistory).filter(
            and_(
                SetHistory.user_id == user.id,
                SetHistory.exercise_id == exercise.id,
                SetHistory.set_number_in_exercise == set_number,
                # Position similaire dans la séance (±1)
                SetHistory.exercise_order_in_session.between(
                    max(1, exercise_order - 1), 
                    exercise_order + 1
                )
            )
        ).order_by(desc(SetHistory.date_performed)).limit(30).all()
        
        return [
            {
                "weight": s.weight,
                "reps": s.actual_reps,
                "fatigue": s.fatigue_level,
                "effort": s.effort_level,
                "success": s.success,
                "rest_before": s.rest_before_seconds,
                "date": s.date_performed
            } for s in similar_sets
        ]
    
    def _calculate_baseline(
        self, 
        user: User, 
        exercise: Exercise, 
        historical_data: List[Dict]
    ) -> Tuple[float, int]:
        """Calcule la performance baseline basée sur l'historique récent"""
        
        if not historical_data:
            # Pas d'historique : utiliser les valeurs par défaut de l'exercice
            return self._estimate_initial_weight(user, exercise), exercise.default_reps_min
        
        # Filtrer les séries réussies des 14 derniers jours pour plus de pertinence
        recent_cutoff = datetime.utcnow() - timedelta(days=14)
        recent_successful = [
            h for h in historical_data 
            if h["success"] and h["date"] > recent_cutoff
        ]
        
        if not recent_successful:
            # Utiliser tout l'historique si pas assez de données récentes
            recent_successful = [h for h in historical_data if h["success"]]
        
        if recent_successful:
            # Moyenne pondérée (plus récent = plus important)
            weights = []
            reps = []
            
            for i, h in enumerate(recent_successful):
                # Pondération décroissante pour les données plus anciennes
                weight_factor = 1.0 / (1 + i * 0.1)
                weights.extend([h["weight"]] * int(weight_factor * 10))
                reps.extend([h["reps"]] * int(weight_factor * 10))
            
            baseline_weight = statistics.median(weights)
            baseline_reps = int(statistics.median(reps))
            
            return baseline_weight, baseline_reps
        
        # Fallback
        return self._estimate_initial_weight(user, exercise), exercise.default_reps_min
    
    def _estimate_initial_weight(self, user: User, exercise: Exercise) -> float:
        """Estime un poids initial pour un nouvel exercice"""
        # Estimations basées sur le poids de corps et le niveau
        bodyweight = user.weight
        
        level_multipliers = {
            "beginner": 0.3,
            "intermediate": 0.5,
            "advanced": 0.7
        }
        
        # Facteurs selon le type d'exercice (basé sur les noms communs)
        exercise_factors = {
            "curl": 0.15,      # Exercices d'isolation des bras
            "lateral": 0.1,    # Élévations latérales
            "triceps": 0.2,    # Extensions triceps
            "chest": 0.4,      # Exercices pectoraux
            "press": 0.4,      # Développés
            "row": 0.3,        # Rowing
            "squat": 0.8,      # Squats
            "deadlift": 0.9    # Soulevés de terre
        }
        
        # Chercher un facteur applicable
        exercise_factor = 0.3  # défaut
        exercise_name_lower = exercise.name.lower()
        
        for keyword, factor in exercise_factors.items():
            if keyword in exercise_name_lower:
                exercise_factor = factor
                break
        
        base_multiplier = level_multipliers.get(user.experience_level, 0.3)
        estimated_weight = bodyweight * base_multiplier * exercise_factor
        
        return max(5.0, estimated_weight)  # Minimum 5kg
    
    def _calculate_fatigue_adjustment(
        self, 
        current_fatigue: int, 
        exercise_order: int,
        set_order_global: int
    ) -> float:
        """Calcule l'ajustement basé sur la fatigue"""
        
        # Fatigue de base (1=très frais, 5=très fatigué)
        base_adjustment = {
            1: 1.05,  # Très frais : peut pousser un peu plus
            2: 1.0,   # Frais : performance normale
            3: 0.95,  # Moyennement fatigué : léger ajustement
            4: 0.9,   # Fatigué : réduction modérée
            5: 0.8    # Très fatigué : réduction importante
        }.get(current_fatigue, 1.0)
        
        # Ajustement selon position dans la séance
        fatigue_progression = 1.0 - (exercise_order - 1) * 0.03  # -3% par exercice
        session_fatigue = 1.0 - (set_order_global - 1) * 0.01   # -1% par série globale
        
        return base_adjustment * fatigue_progression * session_fatigue
    
    def _calculate_effort_adjustment(
        self, 
        previous_effort: int, 
        set_number: int
    ) -> float:
        """Calcule l'ajustement basé sur l'effort de la série précédente"""
        
        if set_number == 1:
            return 1.0  # Première série : pas d'ajustement
        
        # previous_effort : 1=très facile, 5=échec total
        effort_adjustments = {
            1: 1.1,   # Très facile : augmenter
            2: 1.05,  # Facile : augmenter légèrement  
            3: 1.0,   # Modéré : maintenir
            4: 0.95,  # Difficile : réduire légèrement
            5: 0.85   # Échec : réduire significativement
        }
        
        return effort_adjustments.get(previous_effort, 1.0)
    
    def _calculate_rest_adjustment(
        self, 
        actual_rest: Optional[int], 
        recommended_rest: int
    ) -> float:
        """Calcule l'ajustement basé sur le temps de repos effectif"""
        
        if actual_rest is None:
            return 1.0
        
        # Ratio du repos effectif vs recommandé
        rest_ratio = actual_rest / recommended_rest
        
        if rest_ratio < 0.5:
            return 0.9   # Repos très court : réduire un peu
        elif rest_ratio < 0.8:
            return 0.95  # Repos court : réduire légèrement
        elif rest_ratio > 2.0:
            return 1.05  # Repos très long : peut pousser un peu plus
        elif rest_ratio > 1.5:
            return 1.02  # Repos long : légère augmentation
        else:
            return 1.0   # Repos normal
    
    def _find_closest_available_weight(
        self, 
        target_weight: float, 
        available_weights: List[float]
    ) -> float:
        """Trouve le poids disponible le plus proche du poids cible"""
        
        if not available_weights:
            return target_weight
        
        return min(available_weights, key=lambda x: abs(x - target_weight))
    
    def _calculate_confidence(
        self, 
        historical_data: List[Dict], 
        current_fatigue: int,
        current_effort: int
    ) -> float:
        """Calcule le niveau de confiance de la recommandation"""
        
        base_confidence = 0.5
        
        # Plus d'historique = plus de confiance
        if len(historical_data) >= 10:
            base_confidence += 0.3
        elif len(historical_data) >= 5:
            base_confidence += 0.2
        elif len(historical_data) >= 2:
            base_confidence += 0.1
        
        # Fatigue/effort dans des niveaux "normaux" = plus de confiance
        if 2 <= current_fatigue <= 3:
            base_confidence += 0.1
        if 2 <= current_effort <= 4:
            base_confidence += 0.1
        
        return min(1.0, base_confidence)
    
    def _generate_reasoning(
        self, 
        fatigue_adj: float, 
        effort_adj: float, 
        rest_adj: float,
        fatigue: int, 
        effort: int, 
        set_number: int
    ) -> str:
        """Génère une explication textuelle de la recommandation"""
        
        reasons = []
        
        if fatigue_adj < 0.95:
            reasons.append(f"Fatigue élevée (niveau {fatigue})")
        elif fatigue_adj > 1.02:
            reasons.append(f"Bon niveau d'énergie (niveau {fatigue})")
        
        if set_number > 1:
            if effort_adj < 0.95:
                reasons.append(f"Série précédente difficile (effort {effort})")
            elif effort_adj > 1.05:
                reasons.append(f"Série précédente facile (effort {effort})")
        
        if rest_adj < 0.98:
            reasons.append("Repos insuffisant")
        elif rest_adj > 1.02:
            reasons.append("Repos prolongé")
        
        if not reasons:
            return "Conditions normales"
        
        return " • ".join(reasons)
    
    def _determine_change(
        self, 
        recommended: float, 
        baseline: float, 
        threshold: float
    ) -> str:
        """Détermine si c'est une augmentation, diminution ou maintien"""
        
        if baseline == 0:
            return "same"
        
        change_ratio = abs(recommended - baseline) / baseline
        
        if change_ratio < threshold:
            return "same"
        elif recommended > baseline:
            return "increase"
        else:
            return "decrease"
    
    def record_set_performance(
        self,
        user_id: int,
        exercise_id: int,
        set_data: Dict
    ):
        """Enregistre la performance d'une série pour l'apprentissage futur"""
        
        try:
            history_record = SetHistory(
                user_id=user_id,
                exercise_id=exercise_id,
                weight=set_data["weight"],
                reps=set_data["actual_reps"],
                fatigue_level=set_data["fatigue_level"],
                effort_level=set_data["effort_level"],
                exercise_order_in_session=set_data["exercise_order"],
                set_order_in_session=set_data["set_order_global"],
                set_number_in_exercise=set_data["set_number"],
                rest_before_seconds=set_data.get("rest_before_seconds"),
                session_fatigue_start=set_data.get("session_fatigue_start"),
                success=set_data["actual_reps"] >= set_data.get("target_reps", 1),
                actual_reps=set_data["actual_reps"]
            )
            
            self.db.add(history_record)
            self.db.commit()
            
            logger.info(f"Performance enregistrée: user {user_id}, exercise {exercise_id}")
            
        except Exception as e:
            logger.error(f"Erreur enregistrement performance: {e}")
            self.db.rollback()