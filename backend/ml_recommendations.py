# ===== backend/ml_recommendations.py - MOTEUR ML RECOMMANDATIONS =====
from backend.models import User, Exercise, WorkoutSet, SetHistory, Workout, UserAdaptationCoefficients, PerformanceStates
import math
import json
from collections import defaultdict
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

    def _calculate_performance_score(self, set_record, exercise_id: int = None) -> float:
        """Version corrigée qui utilise calculate_exercise_volume"""
        
        if exercise_id is None and hasattr(set_record, 'exercise_id'):
            exercise_id = set_record.exercise_id
        
        exercise = self.db.query(Exercise).filter(Exercise.id == exercise_id).first()
        if not exercise:
            return 1  # Fallback
        
        # Récupérer l'utilisateur
        if hasattr(set_record, 'workout_id'):
            workout = self.db.query(Workout).filter(Workout.id == set_record.workout_id).first()
            if workout:
                user = self.db.query(User).filter(User.id == workout.user_id).first()
            else:
                return 1
        else:
            return 1
        
        if not user:
            return 1
        
        # === UTILISER LA FONCTION CORRIGÉE ===
        return self.calculate_exercise_volume(
            weight=getattr(set_record, 'weight', None),
            reps=getattr(set_record, 'reps', 1),
            exercise=exercise,
            user=user,
            effort_level=getattr(set_record, 'effort_level', None)
        )
    
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
        Génère des recommandations de poids/reps/repos pour la prochaine série
        Utilise maintenant la préférence utilisateur pour la stratégie
        """
        # Assurer que exercise_order et set_order_global ne sont jamais None
        exercise_order = exercise_order or 1
        set_order_global = set_order_global or 1
        
        try:
            # 1. Récupérer l'historique et l'état de performance
            historical_data = self._get_historical_context(
                user, exercise, set_number, exercise_order
            )
            
            # 2. Calculer l'état de performance (nouveau modèle)
            performance_state = self._calculate_performance_state(
                user, exercise, historical_data, current_fatigue
            )
            if exercise.weight_type == "bodyweight":
                performance_state['baseline_weight'] = None
            
            # 3. Récupérer ou créer les coefficients personnalisés
            coefficients = self._get_or_create_coefficients(user, exercise)
            
            # 4. Appliquer la stratégie selon la préférence utilisateur
            if user.prefer_weight_changes_between_sets:
                recommendations = self._apply_variable_weight_strategy(
                    performance_state, exercise, set_number, 
                    current_fatigue, current_effort, coefficients
                )
            else:
                recommendations = self._apply_fixed_weight_strategy(
                    performance_state, exercise, set_number, 
                    current_fatigue, current_effort, coefficients, historical_data
                )
            
            # 5. Calculer le temps de repos optimal
            rest_recommendation = self._calculate_optimal_rest(
                exercise, current_fatigue, current_effort, 
                set_number, coefficients, last_rest_duration
            )
            
            # 6. Valider avec les poids disponibles
            if available_weights and recommendations['weight']:
                recommendations['weight'] = self._find_closest_available_weight(
                    recommendations['weight'], available_weights
                )
            
            # 7. Calculer la confiance
            confidence = self._calculate_confidence(historical_data, current_fatigue, current_effort)
            
            # 8. Générer le raisonnement
            reasoning = self._generate_reasoning(
                performance_state['fatigue_adjustment'], 
                current_effort, rest_recommendation['adjustment'],
                current_fatigue, current_effort, set_number
            )
            
            return {
                "weight_recommendation": round(recommendations['weight'], 1) if recommendations['weight'] is not None else None,
                "reps_recommendation": max(1, recommendations['reps']),
                "rest_seconds_recommendation": rest_recommendation['seconds'],
                "rest_range": rest_recommendation['range'],
                "confidence": confidence,
                "reasoning": reasoning,
                "weight_change": recommendations.get('weight_change', 'same'),
                "reps_change": recommendations.get('reps_change', 'same'),
                "baseline_weight": performance_state['baseline_weight'],
                "baseline_reps": performance_state['baseline_reps'],
                "adaptation_strategy": "variable_weight" if user.prefer_weight_changes_between_sets else "fixed_weight",
                "exercise_type": exercise.weight_type  # NOUVEAU
            }
            
        except Exception as e:
            logger.error(f"Erreur recommandations pour user {user.id}, exercise {exercise.id}: {e}")
            # Fallback sur les valeurs par défaut
            return {
                "weight_recommendation": None,
                "reps_recommendation": exercise.default_reps_min,
                "rest_seconds_recommendation": exercise.base_rest_time_seconds,
                "rest_range": {"min": 30, "max": 120},
                "confidence": 0.0,
                "reasoning": "Données insuffisantes pour une recommandation",
                "weight_change": "same",
                "reps_change": "same",
                "baseline_weight": None,
                "baseline_reps": exercise.default_reps_min,
                "adaptation_strategy": "variable_weight" if user.prefer_weight_changes_between_sets else "fixed_weight"
            }

    def _get_historical_context(
        self, 
        user: User, 
        exercise: Exercise, 
        set_number: int,
        exercise_order: int
    ) -> List[Dict]:
        """Récupère l'historique pertinent pour cet exercice dans des contextes similaires"""
        
        # Construction de la requête de base
        query = self.db.query(SetHistory).filter(
            and_(
                SetHistory.user_id == user.id,
                SetHistory.exercise_id == exercise.id,
                SetHistory.set_number_in_exercise == set_number
            )
        )
        
        # Ajouter le filtre de position seulement si exercise_order est défini
        if exercise_order is not None:
            query = query.filter(
                SetHistory.exercise_order_in_session.between(
                    max(1, exercise_order - 1), 
                    exercise_order + 1
                )
            )
        
        # Récupérer les 30 dernières séries
        similar_sets = query.order_by(desc(SetHistory.date_performed)).limit(30).all()
        
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
    
    def _calculate_performance_state(
        self, 
        user: User, 
        exercise: Exercise, 
        historical_data: List[Dict],
        current_fatigue: int
    ) -> Dict[str, any]:
        """Calcule l'état de performance avec le modèle Fitness-Fatigue simplifié"""
        
        # Récupérer ou créer l'état de performance
        perf_state = self.db.query(PerformanceStates).filter(
            PerformanceStates.user_id == user.id,
            PerformanceStates.exercise_id == exercise.id
        ).first()
        
        if not perf_state:
            perf_state = PerformanceStates(
                user_id=user.id,
                exercise_id=exercise.id,
                base_potential=0.0,
                acute_fatigue=0.0
            )
            self.db.add(perf_state)
            self.db.commit()
        
        # Si pas d'historique, utiliser les valeurs par défaut
        if not historical_data:
            baseline_weight = self._estimate_initial_weight(user, exercise)
            baseline_reps = exercise.default_reps_min
            perf_state.base_potential = baseline_weight
        else:
            # Calculer le potentiel de base (moyenne mobile exponentielle)
            recent_performances = []
            for h in historical_data[:5]:  # 5 dernières performances
                if h["success"]:
                    # Calculer un score de performance (poids × reps)
                    perf_score = h["weight"] * (1 + h["reps"] / 30)  # Formule d'Epley
                    recent_performances.append(perf_score)
            
            if recent_performances:
                # Mise à jour avec moyenne mobile (α = 0.1)
                new_performance = statistics.mean(recent_performances)
                if perf_state.base_potential > 0:
                    perf_state.base_potential = 0.9 * perf_state.base_potential + 0.1 * new_performance
                else:
                    perf_state.base_potential = new_performance
                
                # Extraire poids et reps de base depuis le potentiel
                baseline_weight = perf_state.base_potential / 1.3  # Approximation inverse d'Epley
                baseline_reps = int(statistics.median([h["reps"] for h in historical_data[:5] if h["success"]]))
            else:
                baseline_weight = self._estimate_initial_weight(user, exercise)
                baseline_reps = exercise.default_reps_min
        
        # Calculer la fatigue aiguë
        now = datetime.utcnow()
        if perf_state.last_session_timestamp:
            hours_since = (now - perf_state.last_session_timestamp).total_seconds() / 3600
            # Décroissance exponentielle de la fatigue
            perf_state.acute_fatigue *= math.exp(-hours_since / 24)  # Constante de temps = 24h
        
        # Ajouter la fatigue de la séance actuelle
        fatigue_factor = (current_fatigue - 1) / 4  # Normaliser 1-5 vers 0-1
        perf_state.acute_fatigue = min(1.0, perf_state.acute_fatigue + fatigue_factor * 0.2)
        
        # Sauvegarder l'état
        perf_state.last_session_timestamp = now
        self.db.commit()
        # Détecter et stocker les patterns de progression
        patterns = self._detect_progression_patterns(user.id, exercise.id)
        perf_state.progression_pattern = patterns
        self.db.commit()
        
        # Calculer l'ajustement de fatigue
        fatigue_adjustment = 1.0 - perf_state.acute_fatigue * 0.3  # Max 30% de réduction
        
        return {
            "baseline_weight": baseline_weight,
            "baseline_reps": baseline_reps,
            "base_potential": perf_state.base_potential,
            "acute_fatigue": perf_state.acute_fatigue,
            "fatigue_adjustment": fatigue_adjustment
        }

    def _apply_variable_weight_strategy(
        self,
        performance_state: Dict,
        exercise: Exercise,
        set_number: int,
        current_fatigue: int,
        current_effort: int,
        coefficients: UserAdaptationCoefficients
    ) -> Dict[str, any]:
        """Stratégie avec poids variable : ajuste poids, reps et repos"""
        
        baseline_weight = performance_state['baseline_weight']
        baseline_reps = performance_state['baseline_reps']
        fatigue_adjustment = performance_state['fatigue_adjustment']
        
        # Ajustements basés sur la fatigue et l'effort
        effort_factor = {
            1: 1.1,   # Très facile
            2: 1.05,  # Facile
            3: 1.0,   # Modéré
            4: 0.95,  # Difficile
            5: 0.85   # Échec
        }.get(current_effort, 1.0)
        
        # Ajustement progressif selon le numéro de série
        set_factor = 1.0 - (set_number - 1) * 0.05 * coefficients.fatigue_sensitivity
        
        # Calculer les recommandations
        if exercise.weight_type == "bodyweight":
            recommended_weight = None
        else:
            recommended_weight = baseline_weight * fatigue_adjustment * effort_factor * set_factor
        
        # Maintenir les reps proches de la cible
        reps_adjustment = 1.0 + (1.0 - fatigue_adjustment * effort_factor) * 0.2
        recommended_reps = int(baseline_reps * reps_adjustment)
        
        # Déterminer les changements
        weight_change = self._determine_change(recommended_weight, baseline_weight, 0.05)
        reps_change = self._determine_change(recommended_reps, baseline_reps, 0.1)
        
        return {
            'weight': recommended_weight,
            'reps': recommended_reps,
            'weight_change': weight_change,
            'reps_change': reps_change
        }

    def _apply_fixed_weight_strategy(
        self,
        performance_state: Dict,
        exercise: Exercise,
        set_number: int,
        current_fatigue: int,
        current_effort: int,
        coefficients: UserAdaptationCoefficients,
        historical_data: List[Dict]
    ) -> Dict[str, any]:
        """Stratégie avec poids fixe : ajuste uniquement reps et repos"""
        
        baseline_weight = performance_state['baseline_weight']
        baseline_reps = performance_state['baseline_reps']
        
        # Le poids reste constant sur toutes les séries
        recommended_weight = baseline_weight
        
        # Calculer les RIR (Reps In Reserve) pour maintenir la qualité
        total_fatigue = performance_state['acute_fatigue'] + (current_fatigue - 3) * 0.1
        
        # Plus de fatigue = plus de RIR pour maintenir la qualité
        rir_target = min(3, int(total_fatigue * 3))  # 0-3 RIR
        
        # Ajuster les reps en fonction
        if set_number == 1:
            # Première série : viser proche du max avec RIR
            recommended_reps = baseline_reps - rir_target
        else:
            # Séries suivantes : ajuster selon l'effort précédent
            if current_effort >= 4:  # Série précédente difficile
                recommended_reps = int(baseline_reps * 0.85)
            else:
                recommended_reps = baseline_reps - rir_target
        
        # S'assurer que les reps restent raisonnables
        recommended_reps = max(exercise.default_reps_min - 2, 
                            min(exercise.default_reps_max + 2, recommended_reps))
        
        return {
            'weight': recommended_weight,
            'reps': recommended_reps,
            'weight_change': 'same',
            'reps_change': self._determine_change(recommended_reps, baseline_reps, 0.1)
        }

    def _calculate_optimal_rest(
        self,
        exercise: Exercise,
        current_fatigue: int,
        current_effort: int,
        set_number: int,
        coefficients: UserAdaptationCoefficients,
        last_rest_duration: Optional[int] = None
    ) -> Dict[str, any]:
        """Calcule le temps de repos optimal avec modèle de récupération exponentielle"""
        
        base_rest = exercise.base_rest_time_seconds or 60
        
        # Facteur d'intensité de l'exercice
        intensity_factor = exercise.intensity_factor or 1.0
        
        # Ajustement selon la fatigue
        fatigue_multiplier = {
            1: 0.8,
            2: 0.9,
            3: 1.0,
            4: 1.2,
            5: 1.4
        }[current_fatigue]
        
        # Ajustement selon l'effort
        effort_multiplier = {
            1: 0.8,
            2: 0.9,
            3: 1.0,
            4: 1.3,
            5: 1.5
        }[current_effort]
        
        # Ajustement selon le numéro de série
        set_multiplier = 1.0 + (set_number - 1) * 0.1
        
        # Appliquer le taux de récupération personnalisé
        recovery_factor = 1.0 / coefficients.recovery_rate
        
        # Calculer le repos optimal
        optimal_rest = base_rest * intensity_factor * fatigue_multiplier * effort_multiplier * set_multiplier * recovery_factor
        
        # Limites raisonnables
        min_rest = 30
        max_rest = 300
        optimal_rest = max(min_rest, min(max_rest, int(optimal_rest)))
        
        # Si l'utilisateur a des poids fixes, potentiellement plus de repos
        if not coefficients.user.prefer_weight_changes_between_sets and current_effort >= 4:
            optimal_rest = int(optimal_rest * 1.2)
        
        return {
            'seconds': optimal_rest,
            'range': {
                'min': max(min_rest, int(optimal_rest * 0.8)),
                'max': min(max_rest, int(optimal_rest * 1.2))
            },
            'adjustment': optimal_rest / base_rest
        }

    def _get_or_create_coefficients(self, user: User, exercise: Exercise) -> UserAdaptationCoefficients:
        """Récupère ou crée les coefficients personnalisés"""
        
        coefficients = self.db.query(UserAdaptationCoefficients).filter(
            UserAdaptationCoefficients.user_id == user.id,
            UserAdaptationCoefficients.exercise_id == exercise.id
        ).first()
        
        if not coefficients:
            coefficients = UserAdaptationCoefficients(
                user_id=user.id,
                exercise_id=exercise.id,
                recovery_rate=1.0,
                fatigue_sensitivity=1.0,
                volume_response=1.0,
                typical_progression_increment=2.5
            )
            self.db.add(coefficients)
            self.db.commit()
        
        # Ajouter la relation user pour accéder à prefer_weight_changes_between_sets
        coefficients.user = user
        
        return coefficients

    def _update_user_coefficients(
        self,
        user_id: int,
        exercise_id: int,
        performance_data: Dict
    ) -> None:
        """Met à jour les coefficients basés sur la performance observée"""
        
        coefficients = self.db.query(UserAdaptationCoefficients).filter(
            UserAdaptationCoefficients.user_id == user_id,
            UserAdaptationCoefficients.exercise_id == exercise_id
        ).first()
        
        if not coefficients:
            return
        
        # Analyser la récupération
        if performance_data.get('rest_before_seconds') and performance_data.get('previous_performance'):
            expected_recovery = 1 - math.exp(-performance_data['rest_before_seconds'] / 60)
            actual_recovery = performance_data['actual_performance'] / performance_data['previous_performance']
            
            if actual_recovery > expected_recovery * 1.1:
                # Récupère mieux que prévu
                coefficients.recovery_rate = min(1.5, coefficients.recovery_rate * 1.02)
            elif actual_recovery < expected_recovery * 0.9:
                # Récupère moins bien que prévu
                coefficients.recovery_rate = max(0.5, coefficients.recovery_rate * 0.98)
        
        # Analyser la sensibilité à la fatigue
        if performance_data.get('set_number') > 3:
            fatigue_impact = 1.0 - performance_data['actual_performance'] / performance_data['baseline_performance']
            expected_impact = (performance_data['set_number'] - 1) * 0.05
            
            if fatigue_impact < expected_impact * 0.8:
                # Résiste mieux à la fatigue
                coefficients.fatigue_sensitivity = max(0.5, coefficients.fatigue_sensitivity * 0.98)
            elif fatigue_impact > expected_impact * 1.2:
                # Plus sensible à la fatigue
                coefficients.fatigue_sensitivity = min(1.5, coefficients.fatigue_sensitivity * 1.02)
        
        self.db.commit()

    def _detect_progression_patterns(
        self,
        user_id: int,
        exercise_id: int
    ) -> Dict[str, any]:
        """Détecte les patterns de progression de l'utilisateur"""
        
        # Récupérer l'historique sur 3 mois
        three_months_ago = datetime.utcnow() - timedelta(days=90)
        history = self.db.query(SetHistory).filter(
            SetHistory.user_id == user_id,
            SetHistory.exercise_id == exercise_id,
            SetHistory.date_performed >= three_months_ago
        ).order_by(SetHistory.date_performed).all()
        
        if len(history) < 10:
            return {
                "typical_increment": 2.5,
                "sessions_before_progression": 3,
                "pattern_type": "default"
            }
        
        # Analyser les augmentations de poids
        weight_increases = []
        sessions_between_increases = []
        last_increase_session = 0
        current_weight = history[0].weight
        
        for i, record in enumerate(history):
            if record.weight > current_weight:
                increase = record.weight - current_weight
                weight_increases.append(increase)
                
                if last_increase_session > 0:
                    sessions_between_increases.append(i - last_increase_session)
                
                last_increase_session = i
                current_weight = record.weight
        
        # Calculer les patterns
        if weight_increases:
            typical_increment = statistics.median(weight_increases)
            # Arrondir aux incréments standards (2.5, 5, 10)
            if typical_increment <= 3.75:
                typical_increment = 2.5
            elif typical_increment <= 7.5:
                typical_increment = 5.0
            else:
                typical_increment = 10.0
        else:
            typical_increment = 2.5
        
        sessions_before_progression = int(statistics.mean(sessions_between_increases)) if sessions_between_increases else 3
        
        # Détecter le type de pattern
        if len(set(weight_increases)) == 1:
            pattern_type = "linear"
        elif all(inc >= prev for inc, prev in zip(weight_increases[1:], weight_increases)):
            pattern_type = "accelerating"
        else:
            pattern_type = "variable"
        
        return {
            "typical_increment": typical_increment,
            "sessions_before_progression": sessions_before_progression,
            "pattern_type": pattern_type,
            "total_increases": len(weight_increases),
            "average_increase": statistics.mean(weight_increases) if weight_increases else 0
        }

    def _determine_change(
        self, 
        recommended: float, 
        baseline: float, 
        threshold: float
    ) -> str:
        """Détermine si c'est une augmentation, diminution ou maintien"""
        
        # AVANT : if baseline == 0:
        # APRÈS : Vérifier aussi None
        if baseline is None or baseline == 0:
            return "same"
        
        change_ratio = abs(recommended - baseline) / baseline
        
        if change_ratio < threshold:
            return "same"
        elif recommended > baseline:
            return "increase"
        else:
            return "decrease"

    def _estimate_initial_weight(self, user: User, exercise: Exercise) -> float:
        """Estime un poids initial basé sur les profils de l'exercice"""
        
        # Pour exercices bodyweight purs
        if exercise.weight_type == "bodyweight":
            return None
        
        # Si pas de données de poids de base (anciens exercices)
        if not exercise.base_weights_kg:
            # Garder l'ancien système comme fallback
            bodyweight = user.weight
            
            level_multipliers = {
                "beginner": 0.3,
                "intermediate": 0.5,
                "advanced": 0.7
            }
            
            exercise_factors = {
                "curl": 0.15,
                "lateral": 0.1,
                "triceps": 0.2,
                "chest": 0.4,
                "press": 0.4,
                "row": 0.3,
                "squat": 0.8,
                "deadlift": 0.9
            }
            
            exercise_factor = 0.3
            exercise_name_lower = exercise.name.lower()
            
            for keyword, factor in exercise_factors.items():
                if keyword in exercise_name_lower:
                    exercise_factor = factor
                    break
            
            base_multiplier = level_multipliers.get(user.experience_level, 0.3)
            estimated_weight = bodyweight * base_multiplier * exercise_factor
            
            return max(5.0, estimated_weight)
        
        # Nouveau système avec base_weights_kg
        level_data = exercise.base_weights_kg.get(user.experience_level)
        if not level_data:
            # Fallback sur intermediate si niveau non trouvé
            level_data = exercise.base_weights_kg.get("intermediate", {
                "base": 20,
                "per_kg_bodyweight": 0.3
            })
        
        base = level_data.get("base", 20)
        per_kg = level_data.get("per_kg_bodyweight", 0)
        
        # Calcul du poids estimé
        estimated_weight = base + (per_kg * user.weight)
        
        # Limites de sécurité
        return max(5.0, min(200.0, estimated_weight))

    def _legacy_estimate_weight(self, user: User, exercise: Exercise) -> float:
        """Ancien système pour compatibilité"""
        # [Garder l'ancien code ici pour les exercices non migrés]
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
        
    def calculate_exercise_volume(
        self,
        weight: Optional[float],
        reps: int,
        exercise: Exercise,
        user: User,
        effort_level: Optional[int] = None
    ) -> float:
        """Calcule des points d'effort normalisés - VERSION CORRIGÉE"""
        
        # === 1. VOLUME DE BASE ===
        if exercise.exercise_type == "isometric":
            # Calibrage : 1 seconde isométrique = 12 points d'effort
            base_volume = reps * 12
            
        elif exercise.weight_type == "bodyweight":
            percentage_data = exercise.bodyweight_percentage or {"intermediate": 65}
            percentage = percentage_data.get(user.experience_level, 65)
            equivalent_weight = user.weight * (percentage / 100)
            base_volume = equivalent_weight * reps
            
        elif exercise.weight_type == "hybrid":
            if weight and weight > 0:
                base_volume = weight * reps
            else:
                percentage_data = exercise.bodyweight_percentage or {"intermediate": 65}
                percentage = percentage_data.get(user.experience_level, 65)
                equivalent_weight = user.weight * (percentage / 100)
                base_volume = equivalent_weight * reps
                
        else:  # external
            base_volume = (weight or 0) * reps
        
        # === 2. INTENSITY_FACTOR PARTOUT ===
        intensity_adjusted = base_volume * (exercise.intensity_factor or 1.0)
        
        # === 3. EFFORT UTILISATEUR (optionnel) ===
        if effort_level:
            effort_multipliers = {1: 0.7, 2: 0.85, 3: 1.0, 4: 1.15, 5: 1.3}
            final_volume = intensity_adjusted * effort_multipliers.get(effort_level, 1.0)
        else:
            final_volume = intensity_adjusted
        
        return round(final_volume, 1)
    
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
        """Génère une explication textuelle de la recommandation incluant le repos"""
        
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
            reasons.append("Repos recommandé plus court")
        elif rest_adj > 1.2:
            reasons.append("Repos prolongé recommandé")
        
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
        
        # AVANT : if baseline == 0:
        # APRÈS : Vérifier aussi None
        if baseline is None or baseline == 0:
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
            # Mettre à jour les coefficients d'adaptation
            performance_metrics = {
                'rest_before_seconds': set_data.get('rest_before_seconds'),
                'actual_performance': set_data['weight'] * (1 + set_data['actual_reps'] / 30),
                'baseline_performance': self._calculate_performance_score(history_record),
                'set_number': set_data['set_number'],
                'previous_performance': None  # À calculer depuis l'historique récent
            }

            # Récupérer la performance précédente si elle existe
            previous_set = self.db.query(SetHistory).filter(
                SetHistory.user_id == user_id,
                SetHistory.exercise_id == exercise_id,
                SetHistory.date_performed < history_record.date_performed
            ).order_by(SetHistory.date_performed.desc()).first()

            if previous_set:
                performance_metrics['previous_performance'] = self._calculate_performance_score(previous_set)

            self._update_user_coefficients(user_id, exercise_id, performance_metrics)
            
            logger.info(f"Performance enregistrée: user {user_id}, exercise {exercise_id}")
            
        except Exception as e:
            logger.error(f"Erreur enregistrement performance: {e}")
            self.db.rollback()