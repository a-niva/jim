# ===== backend/ml_recommendations.py - MOTEUR ML RECOMMANDATIONS =====
from backend.models import User, Exercise, WorkoutSet, SetHistory, Workout, UserAdaptationCoefficients, PerformanceStates
import math
import json
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, desc
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta, timezone
import statistics
import logging

from backend.models import User, Exercise, WorkoutSet, SetHistory, Workout


logger = logging.getLogger(__name__)

def safe_timedelta_hours(dt_aware, dt_maybe_naive):
    """Calcule la différence en heures en gérant les timezones"""
    # Gérer tous les cas de timezone
    if dt_aware.tzinfo is None:
        dt_aware = dt_aware.replace(tzinfo=timezone.utc)
    if dt_maybe_naive.tzinfo is None:
        dt_maybe_naive = dt_maybe_naive.replace(tzinfo=timezone.utc)
    
    # S'assurer que les deux sont dans la même timezone
    if dt_aware.tzinfo != dt_maybe_naive.tzinfo:
        dt_maybe_naive = dt_maybe_naive.astimezone(dt_aware.tzinfo)
    
    return (dt_aware - dt_maybe_naive).total_seconds() / 3600

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
        available_weights: List[float] = None,
        workout_id: Optional[int] = None 
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
                    current_fatigue, current_effort, coefficients, user,
                    workout_id=workout_id,
                    available_weights=available_weights
                )
            else:
                recommendations = self._apply_fixed_weight_strategy(
                    performance_state, exercise, set_number, 
                    current_fatigue, current_effort, coefficients, historical_data, user
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

            # 7. Calculer les confiances spécifiques
            weight_confidence = self._calculate_confidence(
                historical_data, current_fatigue, current_effort, 'weight'
            )
            reps_confidence = self._calculate_confidence(
                historical_data, current_fatigue, current_effort, 'reps'
            )
            rest_confidence = self._calculate_confidence(
                historical_data, current_fatigue, current_effort, 'rest'
            )

            # Dans le return final, ajouter :
            return {
                "weight_recommendation": round(recommendations['weight'], 1) if recommendations['weight'] is not None else None,
                "reps_recommendation": max(1, recommendations['reps']),
                "rest_seconds_recommendation": rest_recommendation['seconds'],
                "rest_range": rest_recommendation['range'],
                "confidence": weight_confidence,  # Pour rétrocompatibilité
                "weight_confidence": weight_confidence,
                "reps_confidence": reps_confidence,
                "rest_confidence": rest_confidence,
                "confidence_details": {
                    "sample_size": len(historical_data),
                    "data_recency_days": min(
                        safe_timedelta_hours(datetime.now(timezone.utc), h['completed_at']) / 24
                        for h in historical_data[:5] if 'completed_at' in h
                    ) if historical_data and any('completed_at' in h for h in historical_data[:5]) else None
                }
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
                    # Calculer un score de performance selon le type d'exercice
                    if exercise.exercise_type == "isometric":
                        # Pour isométriques : durée directe
                        perf_score = h["reps"]  # reps = durée en secondes
                    elif h["weight"] and h["weight"] > 0:
                        # Pour exercices avec poids : formule d'Epley
                        perf_score = h["weight"] * (1 + h["reps"] / 30)
                    else:
                        # Pour bodyweight : reps directes
                        perf_score = h["reps"]
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
                # Calculer baseline_reps avec progression pour isométriques
                recent_reps = [h["reps"] for h in historical_data[:5] if h["success"]]
                if recent_reps:
                    median_reps = int(statistics.median(recent_reps))
                    
                    if exercise.exercise_type == "isometric":
                        # Pour isométriques : progression graduelle +5s si performance constante
                        avg_reps = statistics.mean(recent_reps)
                        if avg_reps > median_reps * 1.1:  # Dépassement constant de 10%
                            baseline_reps = min(median_reps + 5, exercise.default_reps_max or 120)
                        elif avg_reps < median_reps * 0.8:  # Sous-performance
                            baseline_reps = max(median_reps - 5, exercise.default_reps_min or 15)
                        else:
                            baseline_reps = median_reps
                    else:
                        baseline_reps = median_reps
                else:
                    baseline_reps = exercise.default_reps_min
            else:
                baseline_weight = self._estimate_initial_weight(user, exercise)
                # Pour les isométriques sans historique, commencer par une valeur légèrement progressive
                if exercise.exercise_type == "isometric":
                    # Vérifier s'il y a un historique même limité pour cet exercice
                    any_history = self.db.query(SetHistory).filter(
                        SetHistory.user_id == user.id,
                        SetHistory.exercise_id == exercise.id
                    ).order_by(SetHistory.date_performed.desc()).limit(3).all()
                    
                    if any_history:
                        last_durations = [s.actual_reps for s in any_history if s.actual_reps > 0]
                        if last_durations:
                            avg_last = statistics.mean(last_durations)
                            baseline_reps = min(int(avg_last * 1.05), exercise.default_reps_max or 120)  # +5% progression
                        else:
                            baseline_reps = exercise.default_reps_min or 30
                    else:
                        baseline_reps = exercise.default_reps_min or 30
                else:
                    baseline_reps = exercise.default_reps_min
        
        # Calculer la fatigue aiguë
        now = datetime.now(timezone.utc)
        if perf_state.last_session_timestamp:
            hours_since = safe_timedelta_hours(datetime.now(timezone.utc), perf_state.last_session_timestamp)
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
        
        # PROTECTION ANTI-CRASH - Garantir des valeurs valides
        if baseline_weight is None or baseline_weight <= 0:
            baseline_weight = 20.0
        if baseline_reps is None or baseline_reps <= 0:
            baseline_reps = 8
            
        logger.info(f"Performance state: weight={baseline_weight}, reps={baseline_reps}")
        
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
        coefficients: UserAdaptationCoefficients,
        user: User,
        workout_id: Optional[int] = None,
        available_weights: Optional[List[float]] = None
    ) -> Dict[str, any]:
        """
        Stratégie avec ajustements variables : poids, reps ET repos adaptatifs
        
        Args:
            performance_state: État de performance baseline
            exercise: Exercice concerné
            set_number: Numéro de la série (1, 2, 3...)
            current_fatigue: Fatigue ressentie (1-5)
            current_effort: Effort fourni série précédente (1-5)
            coefficients: Coefficients d'adaptation utilisateur
            user: Utilisateur
            workout_id: ID de la séance courante (pour récupérer historique)
            available_weights: Poids disponibles pour ajustement
        
        Returns:
            Dict avec weight, reps, rest_seconds et métadonnées
        """
        
        # ===== EXTRACTION DES DONNÉES DE BASE =====
        baseline_weight = performance_state.get('baseline_weight', 0)
        baseline_reps = performance_state.get('baseline_reps', 10)
        fatigue_adjustment = performance_state.get('fatigue_adjustment', 1.0)
        
        # ===== RÉCUPÉRATION ROBUSTE DE L'HISTORIQUE =====
        session_context = self._get_session_context(None, exercise.id, set_number)  # Temporairement None
        
        # ===== CALCULS DES FACTEURS D'AJUSTEMENT =====
        
        # 1. Facteur d'effort de base
        effort_factor = self._calculate_base_effort_factor(current_effort)
        
        # 2. Facteur de repos (nouveau - prend en compte repos effectif vs recommandé)
        rest_factor = self._calculate_rest_impact_factor(session_context)
        
        # 3. Facteur de performance croisée (effort vs reps réelles)
        performance_factor = self._calculate_performance_consistency_factor(
            session_context, baseline_reps, current_effort
        )
        
        # 4. Facteur de progression dans la série
        set_progression_factor = self._calculate_set_progression_factor(
            set_number, coefficients.fatigue_sensitivity
        )
        
        # 5. Facteur de fatigue cumulée intra-séance
        session_fatigue_factor = self._calculate_session_fatigue_factor(
            session_context, set_number
        )
        
        # ===== CALCULS DES RECOMMANDATIONS =====
        
        # POIDS
        weight_recommendation = self._calculate_weight_recommendation(
            baseline_weight, fatigue_adjustment, effort_factor, 
            rest_factor, performance_factor, set_progression_factor,
            session_fatigue_factor, exercise, available_weights, user
        )
        
        # RÉPÉTITIONS  
        reps_recommendation = self._calculate_reps_recommendation(
            baseline_reps, fatigue_adjustment, effort_factor,
            performance_factor, session_fatigue_factor, exercise
        )
        
        # TEMPS DE REPOS
        rest_recommendation = self._calculate_adaptive_rest_recommendation(
            exercise, current_fatigue, current_effort, set_number,
            session_context, coefficients
        )
        
        # ===== DÉTECTION DES CHANGEMENTS =====
        weight_change = self._determine_change(weight_recommendation, baseline_weight, 0.05)
        reps_change = self._determine_change(reps_recommendation, baseline_reps, 0.1)
        
        # ===== VALIDATION ET CONTRAINTES =====
        weight_recommendation, reps_recommendation, rest_recommendation = self._apply_safety_constraints(
            weight_recommendation, reps_recommendation, rest_recommendation,
            exercise, session_context
        )
        
        # ===== CALCUL DE CONFIANCE =====
        confidence = self._calculate_adaptive_confidence(
            session_context, performance_factor, rest_factor
        )
        
        # ===== GÉNÉRATION DU RAISONNEMENT =====
        reasoning = self._generate_adaptive_reasoning(
            effort_factor, rest_factor, performance_factor, 
            weight_change, reps_change, session_context
        )
        
        return {
            'weight': weight_recommendation,
            'reps': reps_recommendation,
            'rest_seconds': rest_recommendation.get('seconds'),
            'rest_range': rest_recommendation.get('range'),
            'weight_change': weight_change,
            'reps_change': reps_change,
            'confidence': confidence,
            'reasoning': reasoning,
            'factors': {
                'effort': effort_factor,
                'rest_impact': rest_factor,
                'performance_consistency': performance_factor,
                'session_fatigue': session_fatigue_factor
            }
        }

    def _get_session_context(self, workout_id: Optional[int], exercise_id: int, set_number: int) -> Dict:
        """Récupère le contexte de la séance de manière optimisée"""
        
        context = {
            'previous_sets_this_exercise': [],
            'previous_sets_this_session': [],
            'last_rest_actual': None,
            'last_rest_recommended': None,
            'session_length': 0
        }
        
        if not workout_id:
            return context
        
        try:
            from sqlalchemy import desc, and_
            
            # Requête optimisée : récupérer toutes les données nécessaires en une fois
            previous_sets = self.db.query(WorkoutSet).filter(
                and_(
                    WorkoutSet.workout_id == workout_id,
                    WorkoutSet.completed_at.isnot(None)
                )
            ).order_by(desc(WorkoutSet.completed_at)).limit(10).all()
            
            # Séparer les sets par exercice et session
            for workout_set in previous_sets:
                if workout_set.exercise_id == exercise_id:
                    context['previous_sets_this_exercise'].append(workout_set)
                context['previous_sets_this_session'].append(workout_set)
            
            # Récupérer les données de repos de la dernière série
            if context['previous_sets_this_session']:
                last_set = context['previous_sets_this_session'][0]
                context['last_rest_actual'] = last_set.actual_rest_duration_seconds
                context['last_rest_recommended'] = last_set.base_rest_time_seconds or last_set.suggested_rest_seconds
            
            context['session_length'] = len(context['previous_sets_this_session'])
            
        except Exception as e:
            # Log l'erreur mais continue avec un contexte vide
            import logging
            logging.warning(f"Erreur récupération contexte séance: {e}")
        
        return context

    def _calculate_base_effort_factor(self, current_effort: int) -> float:
        """Calcule le facteur d'effort de base avec progression non-linéaire"""
        
        effort_factors = {
            1: 1.15,  # Très facile : augmentation plus agressive
            2: 1.08,  # Facile : augmentation modérée  
            3: 1.0,   # Modéré : maintenir
            4: 0.92,  # Difficile : réduction modérée
            5: 0.80   # Échec : réduction importante
        }
        
        return effort_factors.get(current_effort, 1.0)

    def _calculate_rest_impact_factor(self, session_context: Dict) -> float:
        """Calcule l'impact du repos effectif vs recommandé"""
        
        actual_rest = session_context.get('last_rest_actual')
        recommended_rest = session_context.get('last_rest_recommended')
        
        if not actual_rest or not recommended_rest or recommended_rest <= 0:
            return 1.0
        
        rest_ratio = actual_rest / recommended_rest
        
        # Fonction non-linéaire pour l'impact du repos
        if rest_ratio < 0.3:
            return 0.85  # Repos très insuffisant : forte réduction
        elif rest_ratio < 0.6:
            return 0.92  # Repos insuffisant : réduction modérée
        elif rest_ratio < 0.8:
            return 0.96  # Repos un peu court : légère réduction
        elif rest_ratio <= 1.3:
            return 1.0   # Repos dans la plage normale
        elif rest_ratio <= 1.8:
            return 1.03  # Repos long : légère augmentation possible
        else:
            return 1.05  # Repos très long : récupération excellente

    def _calculate_performance_consistency_factor(
        self, session_context: Dict, baseline_reps: int, current_effort: int
    ) -> float:
        """Cross-référence effort ressenti vs performance reps réelle"""
        
        previous_sets = session_context.get('previous_sets_this_exercise', [])
        
        if not previous_sets or len(previous_sets) < 1:
            return 1.0
        
        last_set = previous_sets[0]
        last_reps = last_set.reps
        
        # Calculer l'écart de performance
        if baseline_reps > 0:
            performance_ratio = last_reps / baseline_reps
        else:
            return 1.0
        
        # Détecter les incohérences effort/performance
        if current_effort <= 2 and performance_ratio < 0.85:
            # Effort "facile" mais reps dégradées = fatigue cachée
            return 0.90
        elif current_effort <= 2 and performance_ratio < 0.70:
            # Effort "facile" mais reps très dégradées = problème majeur
            return 0.80
        elif current_effort >= 4 and performance_ratio > 1.15:
            # Effort "difficile" mais reps excellentes = sous-estimation
            return 1.10
        else:
            # Cohérence effort/performance
            return 1.0

    def _calculate_set_progression_factor(self, set_number: int, fatigue_sensitivity: float) -> float:
        """Facteur de progression dans la série avec fatigue accumulated"""
        
        # Réduction progressive selon le numéro de série
        base_reduction = (set_number - 1) * 0.04 * fatigue_sensitivity
        
        # Plateau après la 4ème série (éviter sur-réduction)
        if set_number > 4:
            base_reduction = 4 * 0.04 * fatigue_sensitivity + (set_number - 4) * 0.02 * fatigue_sensitivity
        
        return max(0.7, 1.0 - base_reduction)  # Plancher à 70%

    def _calculate_session_fatigue_factor(self, session_context: Dict, set_number: int) -> float:
        """Calcule la fatigue cumulée de la séance"""
        
        session_length = session_context.get('session_length', 0)
        
        if session_length == 0:
            return 1.0
        
        # Facteur basé sur le nombre total de séries dans la séance
        fatigue_factor = 1.0 - (session_length * 0.01)  # -1% par série globale
        
        # Bonus si récupération entre exercices (changement d'exercice)
        previous_sets = session_context.get('previous_sets_this_session', [])
        if previous_sets and len(previous_sets) > 0:
            last_exercise_id = previous_sets[0].exercise_id
            current_exercise_id = previous_sets[0].exercise_id  # Sera différent si changement
            
            # Si changement d'exercice récent, moins de fatigue cumulée
            if session_length >= 3:
                exercises_in_last_3 = set([s.exercise_id for s in previous_sets[:3]])
                if len(exercises_in_last_3) > 1:
                    fatigue_factor += 0.05  # Bonus variété
        
        return max(0.8, fatigue_factor)  # Plancher à 80%

    def _calculate_weight_recommendation(
        self, baseline_weight: float, fatigue_adj: float, effort_factor: float,
        rest_factor: float, performance_factor: float, set_factor: float,
        session_factor: float, exercise: Exercise, available_weights: Optional[List[float]]
    ) -> Optional[float]:
        """Calcule la recommandation de poids avec tous les facteurs"""
        
        if exercise.weight_type == "bodyweight":
            return None
        
        # PROTECTION ANTI-CRASH - Fallback immédiat
        if baseline_weight is None or baseline_weight <= 0:
            baseline_weight = 20.0
            logger.warning(f"Baseline weight null/invalid, using fallback: {baseline_weight}")
            
            
        # Multiplication de tous les facteurs
        recommended_weight = (
            baseline_weight * 
            fatigue_adj * 
            effort_factor * 
            rest_factor * 
            performance_factor * 
            set_factor * 
            session_factor
        )
        
        # Ajustement aux poids disponibles
        if available_weights:
            recommended_weight = self._find_closest_available_weight(
                recommended_weight, available_weights
            )
        
        # Contraintes de sécurité
        max_increase = baseline_weight * 1.2  # Max +20% par série
        min_weight = baseline_weight * 0.7    # Min -30% par série
        
        return max(min_weight, min(max_increase, recommended_weight))

    def _calculate_reps_recommendation(
        self, baseline_reps: int, fatigue_adj: float, effort_factor: float,
        performance_factor: float, session_factor: float, exercise: Exercise
    ) -> int:
        """Calcule la recommandation de répétitions adaptive"""
        
        # Facteur combiné pour les reps (moins sensible que le poids)
        reps_factor = (
            (fatigue_adj + 2) / 3 *  # Moins d'impact fatigue sur reps
            (effort_factor + 1) / 2 *  # Moins d'impact effort sur reps  
            performance_factor *
            session_factor
        )
        
        recommended_reps = int(baseline_reps * reps_factor)
        
        # Contraintes de l'exercice
        min_reps = getattr(exercise, 'default_reps_min', 5)
        max_reps = getattr(exercise, 'default_reps_max', 20)
        
        return max(min_reps, min(max_reps, recommended_reps))

    def _calculate_adaptive_rest_recommendation(
        self, exercise: Exercise, current_fatigue: int, current_effort: int,
        set_number: int, session_context: Dict, coefficients: UserAdaptationCoefficients
    ) -> Dict[str, any]:
        """Calcule le temps de repos adaptatif basé sur la performance"""
        
        # Appel à la fonction existante comme base
        base_rest = self._calculate_optimal_rest(
            exercise, current_fatigue, current_effort, set_number, coefficients
        )
        
        # Ajustements basés sur le contexte de session
        rest_seconds = base_rest.get('seconds', 90)
        
        # Ajustement si repos précédent trop court et performance dégradée
        if session_context.get('last_rest_actual', 0) < session_context.get('last_rest_recommended', 90) * 0.7:
            if current_effort >= 4:  # Et si dernière série était difficile
                rest_seconds = int(rest_seconds * 1.3)  # +30% de repos
        
        # Ajustement selon le nombre de séries dans la session
        session_length = session_context.get('session_length', 0)
        if session_length > 8:  # Séance longue
            rest_seconds = int(rest_seconds * 1.1)  # +10% repos
        
        return {
            'seconds': rest_seconds,
            'range': {
                'min': max(30, int(rest_seconds * 0.8)),
                'max': min(300, int(rest_seconds * 1.3))
            }
        }

    def _apply_safety_constraints(
        self, weight: Optional[float], reps: int, rest: Dict,
        exercise: Exercise, session_context: Dict
    ) -> tuple:
        """Applique les contraintes de sécurité et cohérence"""
        
        # Contrainte de cohérence poids/reps (éviter poids trop lourd + reps trop élevées)
        if weight and reps:
            previous_sets = session_context.get('previous_sets_this_exercise', [])
            if previous_sets:
                last_set = previous_sets[0]
                last_volume = (last_set.weight or 0) * last_set.reps
                new_volume = weight * reps
                
                # Si augmentation de volume > 25%, privilégier l'un ou l'autre
                if new_volume > last_volume * 1.25:
                    if weight > (last_set.weight or 0) * 1.1:
                        # Si poids augmente beaucoup, réduire reps
                        reps = max(last_set.reps - 1, reps - 2)
                    elif reps > last_set.reps * 1.1:
                        # Si reps augmentent beaucoup, réduire poids
                        weight = min(weight, (last_set.weight or weight) * 1.05)
        
        # Contrainte repos minimum selon effort
        if rest and session_context.get('previous_sets_this_session'):
            last_effort = getattr(session_context['previous_sets_this_session'][0], 'effort_level', 3)
            if last_effort >= 4:
                rest['seconds'] = max(rest['seconds'], 60)  # Minimum 1 minute si effort élevé
        
        return weight, reps, rest

    def _calculate_adaptive_confidence(
        self, session_context: Dict, performance_factor: float, rest_factor: float
    ) -> float:
        """Calcule la confiance avec facteurs adaptatifs"""
        
        base_confidence = 0.6
        
        # Bonus selon quantité de données
        sets_count = len(session_context.get('previous_sets_this_exercise', []))
        confidence_bonus = min(0.3, sets_count * 0.08)  # +8% par série, max +30%
        
        # Bonus cohérence performance/effort
        if abs(performance_factor - 1.0) < 0.1:  # Performance cohérente
            confidence_bonus += 0.1
        
        # Malus si repos très atypique
        if abs(rest_factor - 1.0) > 0.15:  # Repos très différent de normal
            confidence_bonus -= 0.1
        
        return min(0.95, max(0.3, base_confidence + confidence_bonus))

    def _generate_adaptive_reasoning(
        self, effort_factor: float, rest_factor: float, performance_factor: float,
        weight_change: str, reps_change: str, session_context: Dict
    ) -> str:
        """Génère un raisonnement explicatif adaptatif"""
        
        reasons = []
        
        # Raison principale basée sur l'effort
        if effort_factor > 1.05:
            reasons.append("Performance excellente")
        elif effort_factor < 0.95:
            reasons.append("Effort élevé détecté")
        
        # Impact du repos
        if rest_factor < 0.95:
            reasons.append("Repos insuffisant compensé")
        elif rest_factor > 1.03:
            reasons.append("Excellente récupération")
        
        # Cohérence performance
        if performance_factor < 0.95:
            reasons.append("Ajustement sécuritaire")
        elif performance_factor > 1.05:
            reasons.append("Potentiel sous-exploité")
        
        # Information sur les changements
        change_info = []
        if weight_change != "same":
            direction = "↗️" if "increase" in weight_change else "↘️"
            change_info.append(f"Poids {direction}")
        if reps_change != "same":
            direction = "↗️" if "increase" in reps_change else "↘️"
            change_info.append(f"Reps {direction}")
        
        # Assemblage final
        if reasons and change_info:
            return f"{' • '.join(reasons)} → {' + '.join(change_info)}"
        elif reasons:
            return ' • '.join(reasons)
        else:
            return "Progression normale"

    def _apply_fixed_weight_strategy(
        self,
        performance_state: Dict,
        exercise: Exercise,
        set_number: int,
        current_fatigue: int,
        current_effort: int,
        coefficients: UserAdaptationCoefficients,
        historical_data: List[Dict],
        user: User
    ) -> Dict[str, any]:
        """Stratégie avec poids fixe : ajuste uniquement reps et repos"""
        
        baseline_weight = performance_state['baseline_weight']
        baseline_reps = performance_state['baseline_reps']
        if baseline_weight is None or baseline_weight <= 0:
            baseline_weight = 20.0
        if baseline_reps is None or baseline_reps <= 0:
            baseline_reps = 8
        # Le poids reste constant sur toutes les séries
        if exercise.weight_type == "bodyweight":
            recommended_weight = None
        elif baseline_weight is None or baseline_weight <= 0:
            # Fallback si pas de baseline  
            recommended_weight = self._estimate_initial_weight(user, exercise)
        else:
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
        if exercise.exercise_type == 'isometric':
            min_duration = exercise.default_reps_min or 15
            max_duration = exercise.default_reps_max or 120
            recommended_reps = max(min_duration, min(max_duration, recommended_reps))
        else:
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
        three_months_ago = datetime.now(timezone.utc) - timedelta(days=90)
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
        
        if recommended is None and baseline is None:
            return "same"
        elif recommended is None or baseline is None or baseline == 0:
            return "same"
        
        change_ratio = abs(recommended - baseline) / baseline
        
        if change_ratio < threshold:
            return "same"
        elif recommended > baseline:
            return "increase"
        else:
            return "decrease"

    def _estimate_initial_weight(self, user: User, exercise: Exercise) -> Optional[float]:
        """Estime un poids initial basé sur les profils de l'exercice"""
        
        # Pour exercices bodyweight purs
        if exercise.weight_type == "bodyweight":
            return None
        
        # AJOUT : Pour exercices hybrid sans base_weights_kg (comme Tractions)
        if exercise.weight_type == "hybrid" and not exercise.base_weights_kg:
            return None  # Seront gérés comme bodyweight pur
        
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
        
        # === 1. VALIDATION DES ENTRÉES ===
        if not exercise or not user:
            logger.warning("Exercise ou User manquant dans calculate_exercise_volume")
            return 0.0
        
        if reps <= 0:
            logger.warning(f"Reps invalides: {reps}")
            return 0.0
        
        # === 2. CALCUL DU VOLUME DE BASE ===
        try:
            if exercise.exercise_type == "isometric":
                # Calibrage : 1 seconde isométrique = 20 points d'effort
                base_volume = reps * 20
                
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
                # CORRECTION CRITIQUE : gérer le cas où weight est None
                if weight is None or weight <= 0:
                    logger.warning(f"Poids invalide ({weight}) pour exercice externe {exercise.name}")
                    # Utiliser un poids estimé au lieu de retourner None
                    weight = self._estimate_weight(user, exercise)
                    if weight is None:
                        weight = 20.0  # Fallback absolu
                base_volume = weight * reps
        
            # === 3. INTENSITY_FACTOR PARTOUT ===
            intensity_factor = exercise.intensity_factor or 1.0
            intensity_adjusted = base_volume * intensity_factor
            
            # === 4. EFFORT UTILISATEUR (optionnel) ===
            if effort_level:
                effort_multipliers = {1: 0.7, 2: 0.85, 3: 1.0, 4: 1.15, 5: 1.3}
                final_volume = intensity_adjusted * effort_multipliers.get(effort_level, 1.0)
            else:
                final_volume = intensity_adjusted
            
            # === 5. VALIDATION DU RÉSULTAT ===
            if final_volume is None or final_volume < 0:
                logger.error(f"Volume calculé invalide: {final_volume}")
                return 0.0
            
            return round(final_volume, 1)
            
        except Exception as e:
            logger.error(f"Erreur dans calculate_exercise_volume: {e}")
            return 0.0
    
    def _estimate_weight(self, user: User, exercise: Exercise) -> float:
        """Méthode manquante pour estimer un poids"""
        if hasattr(self, '_estimate_initial_weight'):
            return self._estimate_initial_weight(user, exercise) or 20.0
        return 20.0  # Fallback simple

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
        current_effort: int,
        metric_type: str = 'weight'  # 'weight', 'reps', or 'rest'
    ) -> float:
        """
        Calcule le niveau de confiance basé sur :
        1. Consistance des performances (via coefficient de variation)
        2. Quantité de données (rendements décroissants)
        3. Fraîcheur des données
        """
        
        n = len(historical_data)
        if n < 2:
            return 0.3  # Confiance minimale sans données suffisantes
        
        # 1. SCORE DE QUANTITÉ (logarithmique, sature vers n=20)
        # Basé sur la théorie de l'information : log2(n+1) / log2(21) 
        quantity_score = min(1.0, math.log2(n + 1) / math.log2(21))
        
        # 2. SCORE DE CONSISTANCE (via coefficient de variation)
        consistency_score = 0.5  # Valeur par défaut
        
        if metric_type == 'weight' and n >= 3:
            weights = [h['weight'] for h in historical_data[:10] if h.get('weight')]
            if weights and len(weights) >= 3:
                mean_weight = statistics.mean(weights)
                if mean_weight > 0:
                    std_dev = statistics.stdev(weights)
                    cv = std_dev / mean_weight
                    # CV < 0.1 = très consistant, CV > 0.3 = très variable
                    # Transformation linéaire inverse
                    consistency_score = max(0, min(1, 1 - (cv - 0.1) / 0.2))
        
        elif metric_type == 'reps' and n >= 3:
            reps = [h['reps'] for h in historical_data[:10] if h.get('reps')]
            if reps and len(reps) >= 3:
                mean_reps = statistics.mean(reps)
                if mean_reps > 0:
                    std_dev = statistics.stdev(reps)
                    cv = std_dev / mean_reps
                    # Reps généralement plus variables que le poids
                    consistency_score = max(0, min(1, 1 - (cv - 0.15) / 0.25))
        
        elif metric_type == 'rest' and n >= 3:
            # Pour le repos, on regarde la corrélation avec fatigue/effort
            rest_consistency = self._calculate_rest_consistency(historical_data)
            consistency_score = rest_consistency
        
        # 3. SCORE DE FRAÎCHEUR
        # Données > 30 jours perdent progressivement leur pertinence
        now = datetime.now(timezone.utc)
        recency_weights = []
        
        for h in historical_data[:10]:  # Max 10 dernières
            if 'completed_at' in h and h['completed_at']:
                days_ago = safe_timedelta_hours(now, h['completed_at']) / 24
                # Décroissance linéaire : 100% à 0 jours, 50% à 30 jours, 0% à 60 jours
                weight = max(0, 1 - days_ago / 60)
                recency_weights.append(weight)
        
        recency_score = statistics.mean(recency_weights) if recency_weights else 0.5
        
        # CALCUL FINAL (moyennes pondérées justifiées)
        # Quantité : 30% (important mais pas critique)
        # Consistance : 50% (facteur le plus important)
        # Fraîcheur : 20% (modérément important)
        final_confidence = (
            0.3 * quantity_score +
            0.5 * consistency_score +
            0.2 * recency_score
        )
        
        # Ajustement pour fatigue/effort extrêmes (pénalité)
        if current_fatigue >= 4 or current_effort >= 5:
            final_confidence *= 0.9  # Réduction de 10% en conditions extrêmes
        
        return round(max(0.2, min(0.95, final_confidence)), 2)

    def _calculate_rest_consistency(self, historical_data: List[Dict]) -> float:
        """
        Calcule la consistance des temps de repos en fonction de fatigue/effort
        Retourne un score entre 0 et 1
        """
        rest_data = []
        for h in historical_data[:10]:
            if all(k in h for k in ['rest_duration', 'fatigue_level', 'effort_level']):
                rest_data.append({
                    'rest': h['rest_duration'],
                    'fatigue': h['fatigue_level'],
                    'effort': h['effort_level']
                })
        
        if len(rest_data) < 3:
            return 0.5
        
        # Calculer la variance des repos pour des niveaux similaires de fatigue/effort
        grouped_variance = []
        for target_fatigue in range(1, 6):
            similar = [d['rest'] for d in rest_data 
                    if abs(d['fatigue'] - target_fatigue) <= 1]
            if len(similar) >= 2:
                mean_rest = statistics.mean(similar)
                if mean_rest > 0:
                    cv = statistics.stdev(similar) / mean_rest
                    grouped_variance.append(cv)
        
        if grouped_variance:
            avg_cv = statistics.mean(grouped_variance)
            # CV < 0.2 = consistant, CV > 0.5 = inconsistant
            return max(0, min(1, 1 - (avg_cv - 0.2) / 0.3))
        
        return 0.5
        
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
        
        # PROTECTION CONTRE None
        if recommended is None and baseline is None:
            return "same"
        elif recommended is None or baseline is None:
            return "same"
        elif baseline == 0:
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