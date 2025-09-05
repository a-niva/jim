# backend/ai_exercise_generator.py

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, cast
from sqlalchemy.dialects.postgresql import JSONB
import random
import logging

# Imports de votre codebase existante
from backend.models import User, Exercise, Workout, WorkoutSet, Program
from backend.ml_engine import RecoveryTracker
from backend.equipment_service import EquipmentService

logger = logging.getLogger(__name__)

# Constantes PPL
PPL_CATEGORIES = {
    'push': {
        'name': 'Push',
        'muscles': ['pectoraux', 'epaules', 'bras'],
        'description': 'Exercices de poussée'
    },
    'pull': {
        'name': 'Pull', 
        'muscles': ['dos', 'bras'],
        'description': 'Exercices de traction'
    },
    'legs': {
        'name': 'Legs',
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
        Point d'entrée principal - Génère liste exercices optimisée
        """
        try:
            logger.info(f"🤖 Génération IA pour user {user_id} avec params: {params}")
            
            # 1. Analyse récupération musculaire
            muscle_readiness = self._get_all_muscle_readiness(user_id)
            logger.info(f"📊 Récupération musculaire: {muscle_readiness}")
            
            # 2. Recommandation PPL ou override
            ppl_recommendation = self._recommend_ppl(user_id, muscle_readiness)
            ppl_category = params.get('ppl_override') or ppl_recommendation['category']
            
            logger.info(f"🎯 PPL sélectionnée: {ppl_category} (override: {params.get('ppl_override')})")
            
            # 3. Filtrage exercices par PPL et équipement
            available_exercises = self._filter_exercises_by_ppl(user_id, ppl_category, params.get('manual_muscle_focus', []))
            
            if not available_exercises:
                logger.warning("⚠️ Aucun exercice disponible, génération fallback")
                return self._fallback_generation()
            
            # 4. Scoring et sélection
            exercise_list = self._score_and_select_exercises(
                user_id=user_id,
                exercises=available_exercises,
                exploration_factor=params.get('exploration_factor', 0.5),
                target_count=params.get('target_exercise_count', 5),
                seed=params.get('randomness_seed')
            )
            
            # 5. Calcul qualité session
            quality_score = self._calculate_session_quality(exercise_list, muscle_readiness, ppl_category)
            
            # 6. Format retour
            result = {
                'exercises': exercise_list,
                'ppl_used': ppl_category,
                'quality_score': quality_score,
                'ppl_recommendation': ppl_recommendation,
                'generation_metadata': {
                    'available_exercises_count': len(available_exercises),
                    'exploration_factor': params.get('exploration_factor', 0.5),
                    'generated_at': datetime.now(timezone.utc).isoformat()
                }
            }
            
            logger.info(f"✅ Génération réussie: {len(exercise_list)} exercices, score: {quality_score:.1f}%")
            return result
            
        except Exception as e:
            logger.error(f"❌ Erreur génération: {e}")
            return self._fallback_generation()
    
    def _get_all_muscle_readiness(self, user_id: int) -> Dict[str, float]:
        """Récupère état récupération tous les muscles"""
        try:
            user = self.db.query(User).filter(User.id == user_id).first()
            if not user:
                return self._default_readiness()
            
            muscle_groups = ['pectoraux', 'dos', 'jambes', 'epaules', 'bras', 'abdominaux']
            readiness = {}
            
            for muscle in muscle_groups:
                try:
                    # Utiliser la BONNE méthode get_muscle_readiness
                    readiness_score = self.recovery_tracker.get_muscle_readiness(muscle, user)
                    readiness[muscle] = float(readiness_score)
                except Exception as e:
                    logger.warning(f"Erreur récupération readiness {muscle}: {e}")
                    readiness[muscle] = 0.7  # Valeur par défaut
            
            return readiness
            
        except Exception as e:
            logger.warning(f"Erreur récupération readiness globale: {e}")
            return self._default_readiness()
    
    def _default_readiness(self) -> Dict[str, float]:
        """Valeurs par défaut de récupération"""
        return {
            'pectoraux': 0.7,
            'dos': 0.7, 
            'jambes': 0.7,
            'epaules': 0.7,
            'bras': 0.7,
            'abdominaux': 0.7
        }
    
    def _recommend_ppl(self, user_id: int, muscle_readiness: Dict[str, float]) -> Dict[str, Any]:
        """Recommande catégorie PPL optimale"""
        ppl_scores = self._get_ppl_readiness_scores(muscle_readiness)
        
        # Meilleure catégorie
        best_category = max(ppl_scores.keys(), key=lambda k: ppl_scores[k]['score'])
        
        # Historique pour éviter répétition
        recent_workouts = self.db.query(Workout).filter(
            Workout.user_id == user_id,
            Workout.completed_at.isnot(None),
            Workout.completed_at >= datetime.now(timezone.utc) - timedelta(days=7)
        ).order_by(Workout.completed_at.desc()).limit(3).all()
        
        recent_ppl = []
        for workout in recent_workouts:
            if workout.session_metadata and 'ppl_category' in workout.session_metadata:
                recent_ppl.append(workout.session_metadata['ppl_category'])
        
        # Si trop de répétition, prendre la 2ème meilleure
        if recent_ppl.count(best_category) >= 2 and len(ppl_scores) > 1:
            sorted_categories = sorted(ppl_scores.keys(), key=lambda k: ppl_scores[k]['score'], reverse=True)
            if len(sorted_categories) > 1:
                best_category = sorted_categories[1]
        
        return {
            'category': best_category,
            'confidence': ppl_scores[best_category]['score'] / 100,
            'reasoning': ppl_scores[best_category]['reasoning'],
            'muscle_readiness': muscle_readiness,
            'alternatives': {k: v for k, v in ppl_scores.items() if k != best_category}
        }
    
    def _get_ppl_readiness_scores(self, muscle_readiness: Dict[str, float]) -> Dict[str, Dict]:
        """Calcule scores pour chaque catégorie PPL"""
        scores = {}
        
        for ppl_key, ppl_data in PPL_CATEGORIES.items():
            relevant_muscles = ppl_data['muscles']
            muscle_scores = [muscle_readiness.get(m, 0.5) for m in relevant_muscles]
            
            if muscle_scores:
                avg_score = sum(muscle_scores) / len(muscle_scores) * 100
                min_muscle = min(relevant_muscles, key=lambda m: muscle_readiness.get(m, 0.5))
                max_muscle = max(relevant_muscles, key=lambda m: muscle_readiness.get(m, 0.5))
                
                scores[ppl_key] = {
                    'score': avg_score,
                    'reasoning': f"{max_muscle.capitalize()} récupération {muscle_readiness.get(max_muscle, 0.5)*100:.0f}%",
                    'muscles': relevant_muscles
                }
            else:
                scores[ppl_key] = {
                    'score': 70,
                    'reasoning': 'Récupération standard',
                    'muscles': relevant_muscles
                }
        
        return scores
    
    def _filter_exercises_by_ppl(self, user_id: int, ppl_category: str, focus_muscles: List[str] = None) -> List[Exercise]:
        """Filtre exercices par PPL et équipement disponible"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            return []
        
        available_equipment = []
        if user.equipment_config:
            # Extraire l'équipement disponible depuis equipment_config
            equipment_config = user.equipment_config
            if equipment_config.get('dumbbells', {}).get('available'):
                available_equipment.append('dumbbells')
            if equipment_config.get('barbell', {}).get('available'):
                available_equipment.append('barbell')
            if equipment_config.get('kettlebells', {}).get('available'):
                available_equipment.append('kettlebells')
            # Toujours ajouter bodyweight
            available_equipment.append('bodyweight')
        else:
            available_equipment = ['bodyweight']
        
        target_muscles = PPL_CATEGORIES[ppl_category]['muscles']
        
        # Requête de base
        query = self.db.query(Exercise)
        
        # Filtre par muscles PPL
        if focus_muscles:
            query = query.filter(
                Exercise.muscle_groups.overlap(cast(focus_muscles, JSONB))
            )
        else:
            query = query.filter(
                Exercise.muscle_groups.overlap(cast(target_muscles, JSONB))
            )
        
        exercises = query.all()
        
        # Filtre par équipement compatible
        compatible_exercises = []
        for ex in exercises:
            # Vérifier si au moins un équipement requis est disponible
            if ex.equipment_required:
                if any(eq in available_equipment for eq in ex.equipment_required):
                    compatible_exercises.append(ex)
            else:
                # Si pas d'équipement requis, c'est bodyweight
                compatible_exercises.append(ex)
        
        logger.info(f"📋 {len(compatible_exercises)} exercices compatibles pour {ppl_category}")
        return compatible_exercises
    
    def _score_and_select_exercises(self, user_id: int, exercises: List[Exercise], 
                                   exploration_factor: float, target_count: int, 
                                   seed: Optional[int] = None) -> List[Dict]:
        """Score et sélectionne les meilleurs exercices"""
        if seed:
            random.seed(seed)
        
        user = self.db.query(User).filter(User.id == user_id).first()
        user_favorites = self._get_user_favorites(user_id)
        
        # Scoring
        scored_exercises = []
        for ex in exercises:
            score = 50  # Base
            
            # Bonus favoris vs exploration
            if ex.id in user_favorites:
                score += (1 - exploration_factor) * 30
            else:
                score += exploration_factor * 20
            
            # Bonus difficulté appropriée
            user_level = user.experience_level if user else 'intermediate'
            if ex.difficulty == user_level:
                score += 15
            elif (ex.difficulty == 'beginner' and user_level in ['intermediate', 'advanced']) or \
                 (ex.difficulty == 'intermediate' and user_level == 'advanced'):
                score += 10
            
            # Variabilité
            score += random.uniform(-10, 10)
            
            scored_exercises.append({
                'exercise': ex,
                'score': score,
                'is_favorite': ex.id in user_favorites
            })
        
        # Trier et sélectionner
        scored_exercises.sort(key=lambda x: x['score'], reverse=True)
        selected = scored_exercises[:target_count]
        
        # Format retour
        exercise_list = []
        for i, item in enumerate(selected):
            ex = item['exercise']
            exercise_data = {
                'exercise_id': ex.id,
                'order_in_session': i + 1,
                'name': ex.name,
                'muscle_groups': ex.muscle_groups,
                'equipment_required': ex.equipment_required,
                'difficulty': ex.difficulty,
                'default_sets': ex.default_sets,
                'default_reps_min': ex.default_reps_min,
                'default_reps_max': ex.default_reps_max,
                'base_rest_time_seconds': ex.base_rest_time_seconds,
                'instructions': ex.instructions
            }
            exercise_list.append(exercise_data)
        
        return exercise_list
    
    def _calculate_session_quality(self, exercises: List[Dict], muscle_readiness: Dict[str, float], 
                                  ppl_category: str) -> float:
        """Calcule score de qualité de la session"""
        if not exercises:
            return 0.0
        
        base_score = 50.0
        
        # Bonus nombre d'exercices
        exercise_count = len(exercises)
        if 4 <= exercise_count <= 6:
            base_score += 20
        elif 3 <= exercise_count <= 7:
            base_score += 10
        
        # Bonus récupération musculaire
        ppl_muscles = PPL_CATEGORIES[ppl_category]['muscles']
        avg_readiness = sum(muscle_readiness.get(m, 0.5) for m in ppl_muscles) / len(ppl_muscles)
        base_score += avg_readiness * 20
        
        # Bonus diversité musculaire
        unique_muscles = set()
        for ex in exercises:
            unique_muscles.update(ex.get('muscle_groups', []))
        
        if len(unique_muscles) >= 3:
            base_score += 10
        
        return min(100, max(0, base_score))
    
    def _get_user_workout_count(self, user_id: int) -> int:
        """Compte nombre de séances utilisateur"""
        return self.db.query(Workout).filter(
            Workout.user_id == user_id,
            Workout.completed_at.isnot(None)
        ).count()
    
    def _get_user_favorites(self, user_id: int, limit: int = 10) -> List[int]:
        """Récupère exercices favoris de l'utilisateur"""
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        
        favorite_exercises = self.db.query(
            WorkoutSet.exercise_id,
            func.count(WorkoutSet.id).label('usage_count')
        ).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).filter(
            Workout.user_id == user_id,
            Workout.completed_at >= thirty_days_ago
        ).group_by(
            WorkoutSet.exercise_id
        ).order_by(
            func.count(WorkoutSet.id).desc()
        ).limit(limit).all()
        
        return [ex_id for ex_id, _ in favorite_exercises]
    
    def _fallback_generation(self) -> Dict[str, Any]:
        """Génération fallback si échec"""
        logger.warning("🚨 Utilisation génération fallback")
        
        # Récupérer de vrais exercices bodyweight
        basic_exercises = self.db.query(Exercise).filter(
            cast(Exercise.equipment_required, JSONB).contains(['bodyweight'])
        ).limit(3).all()
        
        fallback_exercises = []
        for idx, ex in enumerate(basic_exercises):
            fallback_exercises.append({
                'exercise_id': ex.id,
                'order_in_session': idx + 1,
                'name': ex.name,
                'muscle_groups': ex.muscle_groups,
                'equipment_required': ex.equipment_required,
                'difficulty': ex.difficulty,
                'default_sets': ex.default_sets,
                'default_reps_min': ex.default_reps_min,
                'default_reps_max': ex.default_reps_max,
                'base_rest_time_seconds': ex.base_rest_time_seconds,
                'instructions': ex.instructions
            })
        
        # Si vraiment aucun exercice en DB, fallback hardcodé
        if not fallback_exercises:
            fallback_exercises = [
                {
                    'exercise_id': 1,
                    'order_in_session': 1,
                    'name': 'Pompes',
                    'muscle_groups': ['pectoraux', 'bras'],
                    'equipment_required': ['bodyweight'],
                    'difficulty': 'beginner',
                    'default_sets': 3,
                    'default_reps_min': 8,
                    'default_reps_max': 15,
                    'base_rest_time_seconds': 60,
                    'instructions': 'Pompes classiques'
                },
                {
                    'exercise_id': 2,
                    'order_in_session': 2,
                    'name': 'Squats',
                    'muscle_groups': ['jambes'],
                    'equipment_required': ['bodyweight'],
                    'difficulty': 'beginner',
                    'default_sets': 3,
                    'default_reps_min': 10,
                    'default_reps_max': 20,
                    'base_rest_time_seconds': 60,
                    'instructions': 'Squats au poids du corps'
                },
                {
                    'exercise_id': 3,
                    'order_in_session': 3,
                    'name': 'Planche',
                    'muscle_groups': ['abdominaux'],
                    'equipment_required': ['bodyweight'],
                    'difficulty': 'beginner',
                    'default_sets': 3,
                    'default_reps_min': 30,
                    'default_reps_max': 60,
                    'base_rest_time_seconds': 45,
                    'instructions': 'Maintenir position planche'
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