# backend/ai_exercise_generator.py - NOUVEAU FICHIER

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, cast
from sqlalchemy.dialects.postgresql import JSONB
import random
import logging

# Imports de votre codebase existante
from backend.models import User, Exercise, Workout, WorkoutSet
from backend.ml_engine import RecoveryTracker
from backend.equipment_service import EquipmentService
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger(__name__)

# Constantes PPL (évite import manquant)
PPL_CATEGORIES = {
    'push': {
        'name': 'Push (Pousser)',
        'muscles': ['pectoraux', 'epaules', 'bras'],
        'description': 'Exercices de poussée'
    },
    'pull': {
        'name': 'Pull (Tirer)', 
        'muscles': ['dos', 'bras'],
        'description': 'Exercices de traction'
    },
    'legs': {
        'name': 'Legs (Jambes)',
        'muscles': ['jambes'],
        'description': 'Exercices jambes'
    }
}

class AIExerciseGenerator:
    def __init__(self, db: Session):
        self.db = db
        self.recovery_tracker = RecoveryTracker(db)
        self.equipment_service = EquipmentService()
    
    def generate_exercise_list(self, user_id: int, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        POINT D'ENTRÉE PRINCIPAL - Génère liste exercices optimisée
        
        Args:
            user_id: ID utilisateur
            params: Paramètres génération (voir structure ci-dessous)
            
        Returns: {
            'exercises': [...],           # Liste exercices avec métadonnées
            'ppl_used': 'push',          # Catégorie PPL finale
            'quality_score': 85.7,      # Score session calculé
            'ppl_recommendation': {...}, # Détails recommandation
            'generation_metadata': {...} # Infos debug/analytics
        }
        """
        
        try:
            logger.info(f"🤖 Génération IA pour user {user_id} avec params: {params}")
            
            # 1. ANALYSE RÉCUPÉRATION MUSCULAIRE
            muscle_readiness = self._get_all_muscle_readiness(user_id)
            logger.info(f"📊 Récupération musculaire: {muscle_readiness}")
            
            # 2. RECOMMANDATION PPL
            ppl_recommendation = self._recommend_ppl(user_id, muscle_readiness)
            target_ppl = params.get('ppl_override') or ppl_recommendation['category']
            logger.info(f"🎯 PPL sélectionnée: {target_ppl} (recommandée: {ppl_recommendation['category']})")
            
            # 3. FILTRAGE EXERCICES PAR CONTRAINTES
            available_exercises = self._filter_exercises_by_constraints(
                user_id, target_ppl, params.get('manual_muscle_focus', [])
            )
            
            if len(available_exercises) < 3:
                logger.warning("Pas assez d'exercices disponibles, assouplissement contraintes")
                available_exercises = self._fallback_exercise_selection(user_id)
            
            # 4. SÉLECTION AVEC SCORING
            selected_exercises = self._select_exercises_with_scoring(
                available_exercises,
                user_id,
                params.get('exploration_factor', 0.5),
                params.get('target_exercise_count', 5),
                params.get('randomness_seed')
            )
            
            # 5. OPTIMISATION ORDRE (Réutilise SessionQualityEngine si disponible)
            try:
                # Tenter d'utiliser optimisateur existant
                from backend.session_quality_engine import SessionQualityEngine
                optimized_exercises = SessionQualityEngine.optimize_exercise_order(selected_exercises)
            except (ImportError, AttributeError):
                # Fallback simple si optimisateur non disponible
                optimized_exercises = self._simple_optimize_order(selected_exercises)
            
            # 6. CALCUL SCORE QUALITÉ
            quality_score = self._calculate_session_quality(optimized_exercises, user_id)
            
            # 7. SAUVEGARDE HISTORIQUE
            self._save_generation_to_history(user_id, params, optimized_exercises, quality_score)
            
            return {
                'exercises': optimized_exercises,
                'ppl_used': target_ppl,
                'quality_score': quality_score,
                'ppl_recommendation': ppl_recommendation,
                'generation_metadata': {
                    'generated_at': datetime.now(timezone.utc).isoformat(),
                    'total_exercises': len(optimized_exercises),
                    'equipment_used': list(set().union(*[ex.get('equipment_required', []) for ex in optimized_exercises])),
                    'muscle_distribution': self._analyze_muscle_distribution(optimized_exercises)
                }
            }
            
        except Exception as e:
            logger.error(f"Erreur génération IA user {user_id}: {str(e)}")
            return self._generate_fallback_session(user_id, params)
    
    def _get_all_muscle_readiness(self, user_id: int) -> Dict[str, float]:
        """Récupère récupération pour tous groupes musculaires"""
        
        # Valeurs par défaut
        default_readiness = {
            "pectoraux": 0.75, "dos": 0.75, "jambes": 0.80,
            "epaules": 0.70, "bras": 0.75, "abdominaux": 0.85
        }
        
        try:
            user = self.db.query(User).filter(User.id == user_id).first()
            if not user or not self.recovery_tracker:
                return default_readiness
            
            muscle_groups = ["pectoraux", "dos", "jambes", "epaules", "bras", "abdominaux"]
            readiness = {}
            
            for muscle in muscle_groups:
                try:
                    readiness[muscle] = self.recovery_tracker.get_muscle_readiness(muscle, user)
                except Exception as e:
                    logger.warning(f"Erreur récupération {muscle}: {e}")
                    readiness[muscle] = default_readiness.get(muscle, 0.75)
            
            return readiness
            
        except Exception as e:
            logger.error(f"Erreur récupération musculaire user {user_id}: {e}")
            return default_readiness
    
    def _recommend_ppl(self, user_id: int, muscle_readiness: Dict[str, float]) -> Dict[str, Any]:
        """Recommande catégorie PPL basée sur récupération + historique"""
        
        # Calculer scores PPL moyens
        ppl_readiness = {
            'push': (muscle_readiness.get('pectoraux', 0.5) + 
                    muscle_readiness.get('epaules', 0.5) + 
                    muscle_readiness.get('bras', 0.5)) / 3,
            'pull': (muscle_readiness.get('dos', 0.5) + 
                    muscle_readiness.get('bras', 0.5)) / 2,
            'legs': muscle_readiness.get('jambes', 0.5)
        }
        
        # Analyser historique récent (7 derniers jours)
        recent_ppl_usage = self._get_recent_ppl_usage(user_id)
        
        # Ajuster scores selon historique
        for ppl, days_since in recent_ppl_usage.items():
            if days_since < 1:  # Moins de 24h
                ppl_readiness[ppl] *= 0.7  # Pénalité récupération
            elif days_since > 3:  # Plus de 3 jours
                ppl_readiness[ppl] *= 1.2  # Bonus muscle reposé
        
        # Sélectionner meilleur score
        best_ppl = max(ppl_readiness, key=ppl_readiness.get)
        confidence = min(1.0, ppl_readiness[best_ppl])
        
        return {
            'category': best_ppl,
            'confidence': confidence,
            'reasoning': self._explain_ppl_choice(best_ppl, ppl_readiness, recent_ppl_usage),
            'alternatives': {k: v for k, v in ppl_readiness.items() if k != best_ppl}
        }
    
    def _filter_exercises_by_constraints(
        self, user_id: int, target_ppl: str, focus_muscles: List[str]
    ) -> List[Exercise]:
        """Filtre exercices par PPL + équipement + focus manuel"""
        
        # Récupérer utilisateur et équipement
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return []
        
        available_equipment = self.equipment_service.get_available_equipment_types(user.equipment_config)
        
        # Query de base par PPL
        query = self.db.query(Exercise).filter(
            cast(Exercise.ppl, JSONB).contains([target_ppl])
        )
        
        # Filtre focus manuel si spécifié
        if focus_muscles:
            query = query.filter(
                or_(*[cast(Exercise.muscle_groups, JSONB).contains([muscle]) for muscle in focus_muscles])
            )
        
        exercises = query.all()
        
        # Filtrage équipement (réutilise fonction existante)
        compatible_exercises = []
        for ex in exercises:
            if self.equipment_service.can_perform_exercise(ex, list(available_equipment)):
                compatible_exercises.append(ex)
        
        logger.info(f"📋 {len(compatible_exercises)} exercices compatibles pour {target_ppl}")
        return compatible_exercises
    
    def _select_exercises_with_scoring(
        self, exercises: List[Exercise], user_id: int, 
        exploration_factor: float, target_count: int, randomness_seed: Optional[int]
    ) -> List[Dict[str, Any]]:
        """Sélectionne exercices avec scoring exploration vs favoris"""
        
        if randomness_seed:
            random.seed(randomness_seed)
        
        # Récupérer favoris utilisateur
        user = self.db.query(User).filter(User.id == user_id).first()
        user_favorites = user.favorite_exercises if user else []
        
        # Score chaque exercice
        scored_exercises = []
        for ex in exercises:
            score = 50  # Score de base
            
            # Bonus/malus selon exploration vs favoris
            if ex.id in user_favorites:
                score += (1 - exploration_factor) * 30  # Plus on favorise familier, plus de bonus
            else:
                score += exploration_factor * 20         # Plus on explore, plus bonus nouveaux
            
            # Bonus difficulté appropriée
            user_level = user.experience_level if user else 'intermediate'
            if ex.difficulty == user_level:
                score += 15
            elif (ex.difficulty == 'beginner' and user_level in ['intermediate', 'advanced']) or \
                 (ex.difficulty == 'intermediate' and user_level == 'advanced'):
                score += 10  # Difficultés acceptables
            
            # Ajout variabilité aléatoire (±10 points)
            score += random.uniform(-10, 10)
            
            scored_exercises.append({
                'exercise': ex,
                'score': score,
                'is_favorite': ex.id in user_favorites,
                'difficulty_match': ex.difficulty == user_level
            })
        
        # Trier par score et prendre les meilleurs
        scored_exercises.sort(key=lambda x: x['score'], reverse=True)
        
        # Sélectionner top exercices
        selected = scored_exercises[:target_count]
        
        # Format retour compatible interface séance
        exercise_list = []
        for i, item in enumerate(selected):
            ex = item['exercise']
            exercise_data = {
                'exercise_id': ex.id,
                'name': ex.name,
                'muscle_groups': ex.muscle_groups,
                'equipment_required': ex.equipment_required,
                'difficulty': ex.difficulty,
                'default_sets': ex.default_sets,
                'default_reps_min': ex.default_reps_min,
                'default_reps_max': ex.default_reps_max,
                'base_rest_time_seconds': ex.base_rest_time_seconds,
                'instructions': ex.instructions,
                'order_in_session': i + 1,
                'is_favorite': item['is_favorite'],
                'selection_score': round(item['score'], 1)
            }
            exercise_list.append(exercise_data)
        
        # S'assurer d'avoir au moins 3 exercices
        if len(exercise_list) < 3:
            logger.warning(f"⚠️ Seulement {len(exercise_list)} exercices, ajout fallback")
            # Ajouter exercices bodyweight universels
            fallback_exercises = self.db.query(Exercise).filter(
                cast(Exercise.equipment_required, JSONB).contains(['bodyweight'])
            ).limit(3 - len(exercise_list)).all()
            
            for fb_ex in fallback_exercises:
                exercise_list.append({
                    'exercise_id': fb_ex.id,
                    'name': fb_ex.name,
                    'muscle_groups': fb_ex.muscle_groups,
                    'equipment_required': fb_ex.equipment_required,
                    'difficulty': fb_ex.difficulty,
                    'default_sets': 3,
                    'default_reps_min': 8,
                    'default_reps_max': 12,
                    'base_rest_time_seconds': 60,
                    'instructions': fb_ex.instructions,
                    'order_in_session': len(exercise_list) + 1,
                    'is_favorite': False,
                    'selection_score': 50.0
                })
        
        return exercise_list
    
    def _simple_optimize_order(self, exercises: List[Dict]) -> List[Dict]:
        """Optimisation ordre simple si SessionQualityEngine indisponible"""
        
        # Règles simples :
        # 1. Exercices composés (compound) en premier
        # 2. Groupes musculaires volumineux avant petits
        # 3. Abdos en fin si présents
        
        def get_priority(ex):
            priority = 50
            
            # Exercices composés prioritaires
            if ex.get('exercise_type') == 'compound':
                priority += 20
            
            # Gros muscles en premier
            if 'pectoraux' in ex.get('muscle_groups', []):
                priority += 15
            elif 'dos' in ex.get('muscle_groups', []):
                priority += 14
            elif 'jambes' in ex.get('muscle_groups', []):
                priority += 13
            elif 'epaules' in ex.get('muscle_groups', []):
                priority += 10
            elif 'bras' in ex.get('muscle_groups', []):
                priority += 8
            
            # Abdos en fin
            if 'abdominaux' in ex.get('muscle_groups', []):
                priority -= 10
            
            return priority
        
        # Trier et réassigner order_in_session
        sorted_exercises = sorted(exercises, key=get_priority, reverse=True)
        for i, ex in enumerate(sorted_exercises):
            ex['order_in_session'] = i + 1
        
        return sorted_exercises
    
    def _calculate_session_quality(self, exercises: List[Dict], user_id: int) -> float:
        """Calcul score qualité session (version simplifiée)"""
        
        base_score = 75.0
        
        # Bonus/pénalités basiques
        if len(exercises) < 3:
            base_score -= 15
        elif len(exercises) > 7:
            base_score -= 10
        
        # Diversité musculaire
        muscle_groups = set()
        for ex in exercises:
            muscle_groups.update(ex.get('muscle_groups', []))
        
        if len(muscle_groups) >= 3:
            base_score += 15  # Bonne diversité
        elif len(muscle_groups) == 1:
            base_score -= 10  # Trop focalisé
        
        # Bonus favoris (engagement)
        user = self.db.query(User).filter(User.id == user_id).first()
        if user and user.favorite_exercises:
            favorite_count = sum(1 for ex in exercises if ex.get('exercise_id') in user.favorite_exercises)
            base_score += favorite_count * 3
        
        return max(0, min(100, base_score))
    
    def _get_recent_ppl_usage(self, user_id: int) -> Dict[str, int]:
        """Analyse utilisation PPL récente (7 derniers jours)"""
        
        try:
            # Récupérer workouts récents
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=7)
            recent_workouts = self.db.query(Workout).filter(
                Workout.user_id == user_id,
                Workout.started_at >= cutoff_date,
                Workout.status.in_(['completed', 'active'])
            ).all()
            
            ppl_usage = {'push': 7, 'pull': 7, 'legs': 7}  # Jours depuis dernière utilisation
            
            for workout in recent_workouts:
                # Analyser exercices de ce workout
                workout_sets = self.db.query(WorkoutSet).filter(
                    WorkoutSet.workout_id == workout.id
                ).all()
                
                workout_ppls = set()
                for ws in workout_sets:
                    exercise = self.db.query(Exercise).filter(Exercise.id == ws.exercise_id).first()
                    if exercise and hasattr(exercise, 'ppl'):
                        workout_ppls.update(exercise.ppl)
                
                # Mettre à jour dernière utilisation
                workout_days_ago = (datetime.now(timezone.utc) - workout.started_at.replace(tzinfo=timezone.utc)).days
                for ppl in workout_ppls:
                    if ppl in ppl_usage:
                        ppl_usage[ppl] = min(ppl_usage[ppl], workout_days_ago)
            
            return ppl_usage
            
        except Exception as e:
            logger.warning(f"Erreur analyse PPL récente: {e}")
            return {'push': 3, 'pull': 2, 'legs': 4}  # Valeurs par défaut
    
    def _explain_ppl_choice(self, chosen_ppl: str, scores: Dict, usage: Dict) -> str:
        """Génère explication recommandation PPL"""
        
        reasons = []
        score = scores[chosen_ppl]
        days_since = usage.get(chosen_ppl, 7)
        
        if score > 0.85:
            reasons.append(f"Muscles {chosen_ppl.upper()} excellente récupération ({score*100:.0f}%)")
        elif score > 0.7:
            reasons.append(f"Muscles {chosen_ppl.upper()} bien récupérés ({score*100:.0f}%)")
        
        if days_since > 2:
            reasons.append(f"Pas travaillé depuis {days_since} jour{'s' if days_since > 1 else ''}")
        
        return " • ".join(reasons) if reasons else f"Meilleure option disponible"

    def _save_generation_to_history(self, user_id: int, params: Dict, exercises: List, quality_score: float):
        """Sauvegarde génération dans Program.ai_generation_history"""
        
        try:
            active_program = self.db.query(Program).filter(
                Program.user_id == user_id,
                Program.is_active == True
            ).first()
            
            if active_program:
                if not active_program.ai_generation_history:
                    active_program.ai_generation_history = []
                
                # Ajouter nouvelle génération
                generation_entry = {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "parameters": params,
                    "exercises_generated": [ex.get('exercise_id') for ex in exercises],
                    "quality_score": quality_score,
                    "user_launched": False  # Sera mis à True si user lance la séance
                }
                
                active_program.ai_generation_history.append(generation_entry)
                
                # Garder seulement les 10 dernières générations
                if len(active_program.ai_generation_history) > 10:
                    active_program.ai_generation_history = active_program.ai_generation_history[-10:]
                
                # IMPORTANT : Flag SQLAlchemy que JSON a changé
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(active_program, "ai_generation_history")
                
                self.db.commit()
                logger.info("✅ Génération sauvée dans historique")
        
        except Exception as e:
            logger.warning(f"Erreur sauvegarde historique: {e}")

    def _generate_fallback_session(self, user_id: int, params: Dict[str, Any]) -> Dict[str, Any]:
        """Génération fallback en cas d'erreur"""
        
        logger.warning(f"🆘 Génération fallback pour user {user_id}")
        
        # Exercices basiques universels bodyweight
        fallback_exercises = [
            {
                'exercise_id': -1,  # ID négatif pour fallback
                'name': 'Pompes',
                'muscle_groups': ['pectoraux', 'bras'],
                'equipment_required': ['bodyweight'],
                'difficulty': 'beginner',
                'default_sets': 3,
                'default_reps_min': 8,
                'default_reps_max': 15,
                'instructions': 'Pompes classiques au sol',
                'order_in_session': 1,
                'is_fallback': True
            },
            {
                'exercise_id': -2,
                'name': 'Planche',
                'muscle_groups': ['abdominaux'],
                'equipment_required': ['bodyweight'],
                'difficulty': 'beginner',
                'default_sets': 3,
                'default_reps_min': 30,
                'default_reps_max': 60,
                'instructions': 'Maintenir position planche',
                'order_in_session': 2,
                'is_fallback': True
            },
            {
                'exercise_id': -3,
                'name': 'Squats',
                'muscle_groups': ['jambes'],
                'equipment_required': ['bodyweight'],
                'difficulty': 'beginner',
                'default_sets': 3,
                'default_reps_min': 10,
                'default_reps_max': 20,
                'instructions': 'Squats au poids du corps',
                'order_in_session': 3,
                'is_fallback': True
            }
        ]
        
        return {
            'exercises': fallback_exercises,
            'ppl_used': 'push',
            'quality_score': 60.0,
            'ppl_recommendation': {
                'category': 'push',
                'confidence': 0.5,
                'reasoning': 'Sélection fallback - exercices basiques',
                'alternatives': {}
            },
            'generation_metadata': {
                'fallback': True,
                'generated_at': datetime.now(timezone.utc).isoformat()
            }
        }
    
    def _fallback_exercise_selection(self, user_id: int) -> List[Exercise]:
        """Sélection fallback si contraintes trop strictes"""
        
        # Récupérer exercices bodyweight universels
        fallback_query = self.db.query(Exercise).filter(
            cast(Exercise.equipment_required, JSONB).contains(['bodyweight'])
        ).limit(10)
        
        return fallback_query.all()
    
    def _analyze_muscle_distribution(self, exercises: List[Dict]) -> Dict[str, int]:
        """Analyse distribution musculaire pour métadonnées"""
        
        muscle_count = {}
        for ex in exercises:
            for muscle in ex.get('muscle_groups', []):
                muscle_count[muscle] = muscle_count.get(muscle, 0) + 1
        
        return muscle_count