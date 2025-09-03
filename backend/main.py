# ===== backend/main.py - VERSION REFACTORISÉE =====
import traceback
from fastapi import FastAPI, HTTPException, Depends, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func, or_, desc, cast, text, distinct
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone, date
from contextlib import asynccontextmanager
import json
import os
import logging
from backend.ml_recommendations import FitnessRecommendationEngine
from backend.ml_engine import FitnessMLEngine, RecoveryTracker, VolumeOptimizer, ProgressionAnalyzer
from backend.constants import normalize_muscle_group, exercise_matches_focus_area
from backend.database import engine, get_db, SessionLocal
from backend.models import Base, User, Exercise, Workout, WorkoutSet, SetHistory, UserCommitment, AdaptiveTargets, UserAdaptationCoefficients, PerformanceStates, ExerciseCompletionStats, SwapLog
from backend.schemas import (
    UserCreate, UserResponse, WorkoutResponse, WorkoutCreate, 
    SetCreate, ExerciseResponse, UserPreferenceUpdate
)

from backend.equipment_service import EquipmentService
from sqlalchemy import extract, and_
import calendar
from collections import defaultdict
from backend.ai_exercise_generator import AIExerciseGenerator
from backend.schemas import GenerateExercisesRequest
import random

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Créer les tables
Base.metadata.create_all(bind=engine)

def safe_timedelta_hours(dt_aware, dt_maybe_naive):
    """Calcule la différence en heures en gérant les timezones"""
    if dt_maybe_naive.tzinfo is None:
        dt_maybe_naive = dt_maybe_naive.replace(tzinfo=timezone.utc)
    return (dt_aware - dt_maybe_naive).total_seconds() / 3600

def safe_datetime_subtract(dt1, dt2):
    """Soustraction sécurisée entre deux datetimes avec gestion timezone"""
    # S'assurer que les deux dates ont une timezone
    if dt1.tzinfo is None:
        dt1 = dt1.replace(tzinfo=timezone.utc)
    if dt2.tzinfo is None:
        dt2 = dt2.replace(tzinfo=timezone.utc)
    
    # S'assurer qu'elles sont dans la même timezone
    if dt1.tzinfo != dt2.tzinfo:
        dt2 = dt2.astimezone(dt1.tzinfo)
    
    return dt1 - dt2

def update_exercise_stats_for_user(db: Session, user_id: int, exercise_id: int = None):
    """Met à jour les stats d'exercices - Alternative légère à la vue matérialisée"""
    try:
        # Si exercise_id spécifié, ne mettre à jour que celui-ci
        exercise_filter = []
        if exercise_id:
            exercise_filter.append(WorkoutSet.exercise_id == exercise_id)
        
        # Requête optimisée pour récupérer toutes les stats d'un coup
        stats_query = db.query(
            Workout.user_id,
            WorkoutSet.exercise_id,
            func.count(distinct(WorkoutSet.workout_id)).label('total_sessions'),
            func.count(WorkoutSet.id).label('total_sets'),
            func.max(Workout.started_at).label('last_performed'),
            func.avg(WorkoutSet.weight).label('avg_weight_all_time'),
            func.max(WorkoutSet.weight).label('max_weight_all_time'),
            func.avg(WorkoutSet.fatigue_level).label('avg_fatigue_level')
        ).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).filter(
            Workout.user_id == user_id,
            Workout.status == 'completed',
            *exercise_filter
        ).group_by(
            Workout.user_id,
            WorkoutSet.exercise_id
        )
        
        # Récupérer aussi les stats sur 7 et 30 jours
        now = datetime.now(timezone.utc)
        seven_days_ago = now - timedelta(days=7)
        thirty_days_ago = now - timedelta(days=30)
        
        for stat_row in stats_query.all():
            # Stats 7 jours
            stats_7d = db.query(
                func.count(distinct(WorkoutSet.workout_id)).label('sessions'),
                func.count(WorkoutSet.id).label('sets')
            ).join(
                Workout, WorkoutSet.workout_id == Workout.id
            ).filter(
                Workout.user_id == user_id,
                WorkoutSet.exercise_id == stat_row.exercise_id,
                Workout.started_at >= seven_days_ago,
                Workout.status == 'completed'
            ).first()
            
            # Stats 30 jours
            stats_30d = db.query(
                func.count(distinct(WorkoutSet.workout_id)).label('sessions'),
                func.avg(WorkoutSet.weight).label('avg_weight')
            ).join(
                Workout, WorkoutSet.workout_id == Workout.id
            ).filter(
                Workout.user_id == user_id,
                WorkoutSet.exercise_id == stat_row.exercise_id,
                Workout.started_at >= thirty_days_ago,
                Workout.status == 'completed'
            ).first()
            
            # Mettre à jour ou créer l'entrée
            existing_stat = db.query(ExerciseCompletionStats).filter(
                ExerciseCompletionStats.user_id == user_id,
                ExerciseCompletionStats.exercise_id == stat_row.exercise_id
            ).first()
            
            if existing_stat:
                # Mettre à jour
                existing_stat.total_sessions = stat_row.total_sessions
                existing_stat.total_sets = stat_row.total_sets
                existing_stat.last_performed = stat_row.last_performed
                existing_stat.avg_weight_all_time = stat_row.avg_weight_all_time
                existing_stat.max_weight_all_time = stat_row.max_weight_all_time
                existing_stat.avg_fatigue_level = stat_row.avg_fatigue_level
                existing_stat.sessions_last_7d = stats_7d.sessions if stats_7d else 0
                existing_stat.sets_last_7d = stats_7d.sets if stats_7d else 0
                existing_stat.sessions_last_30d = stats_30d.sessions if stats_30d else 0
                existing_stat.avg_weight_last_30d = stats_30d.avg_weight if stats_30d else None
                existing_stat.last_updated = now
            else:
                # Créer nouvelle entrée
                new_stat = ExerciseCompletionStats(
                    user_id=user_id,
                    exercise_id=stat_row.exercise_id,
                    total_sessions=stat_row.total_sessions,
                    total_sets=stat_row.total_sets,
                    last_performed=stat_row.last_performed,
                    avg_weight_all_time=stat_row.avg_weight_all_time,
                    max_weight_all_time=stat_row.max_weight_all_time,
                    avg_fatigue_level=stat_row.avg_fatigue_level,
                    sessions_last_7d=stats_7d.sessions if stats_7d else 0,
                    sets_last_7d=stats_7d.sets if stats_7d else 0,
                    sessions_last_30d=stats_30d.sessions if stats_30d else 0,
                    avg_weight_last_30d=stats_30d.avg_weight if stats_30d else None,
                    last_updated=now
                )
                db.add(new_stat)
        
        db.commit()
        logger.info(f"Stats mises à jour pour user {user_id}")
        
    except Exception as e:
        logger.error(f"Erreur mise à jour stats: {e}")
        db.rollback()

def analyze_skip_patterns_realtime(user_id: int, current_skips: List[Dict], db: Session):
    """Analyse immédiate des patterns de skip pour ajustements ML"""
    from collections import defaultdict
    
    # Récupérer les 10 dernières séances
    recent_workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == 'completed',
        Workout.skipped_exercises.isnot(None)
    ).order_by(desc(Workout.completed_at)).limit(10).all()
    
    # Compter les skips par exercice
    skip_counts = defaultdict(int)
    skip_reasons = defaultdict(list)
    
    for workout in recent_workouts:
        for skip in (workout.skipped_exercises or []):
            exercise_id = skip['exercise_id']
            skip_counts[exercise_id] += 1
            skip_reasons[exercise_id].append(skip['reason'])
    
    # Ajouter les skips actuels
    for skip in current_skips:
        exercise_id = skip['exercise_id']
        skip_counts[exercise_id] += 1
        skip_reasons[exercise_id].append(skip['reason'])
    
    # Détecter les patterns critiques (3+ skips)
    critical_exercises = [
        exercise_id for exercise_id, count in skip_counts.items() 
        if count >= 3
    ]
    
    if critical_exercises:
        logger.info(f"User {user_id}: Critical skip pattern detected for exercises {critical_exercises}")


def score_exercise_alternative(
    source_exercise: Exercise, 
    candidate: Exercise, 
    user_equipment: List[str],
    recent_exercise_ids: List[int]
) -> float:
    """
    Score simple d'une alternative (0-1)
    3 critères : muscle_match + equipment_match + freshness
    """
    score = 0.0
    
    # 1. Correspondance musculaire (0-0.6)
    if source_exercise.muscle_groups and candidate.muscle_groups:
        source_muscles = set(source_exercise.muscle_groups)
        candidate_muscles = set(candidate.muscle_groups)
        overlap = len(source_muscles & candidate_muscles)
        total = len(source_muscles | candidate_muscles)
        muscle_score = overlap / total if total > 0 else 0
        score += muscle_score * 0.6
    
    # 2. Accessibilité équipement (0-0.3)
    if not candidate.equipment_required:
        equipment_score = 1.0  # Bodyweight = parfait
    else:
        available = set(user_equipment)
        required = set(candidate.equipment_required)
        if required.issubset(available):
            equipment_score = 1.0
        elif len(required & available) > 0:
            equipment_score = 0.5  # Partiellement disponible
        else:
            equipment_score = 0.0
    score += equipment_score * 0.3
    
    # 3. Fraîcheur (0-0.1)
    freshness_score = 0.1 if candidate.id not in recent_exercise_ids else 0.0
    score += freshness_score
    
    return min(1.0, score)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Charger les exercices si nécessaire
    db = SessionLocal()
    try:
        if db.query(Exercise).count() == 0:
            await load_exercises(db)
    finally:
        db.close()
    yield

async def load_exercises(db: Session):
    """Charge les exercices depuis exercises.json"""
    exercises_path = os.path.join(os.path.dirname(__file__), "..", "exercises.json")
    
    try:
        if os.path.exists(exercises_path):
            with open(exercises_path, "r", encoding="utf-8") as f:
                exercises_data = json.load(f)
                
            for exercise_data in exercises_data:
                # Vérifier si l'exercice existe déjà
                existing = db.query(Exercise).filter(
                    Exercise.name == exercise_data["name"]
                ).first()
                
                if not existing:
                    exercise = Exercise(**exercise_data)
                    db.add(exercise)
                else:
                    # Mettre à jour avec les nouveaux champs
                    for key, value in exercise_data.items():
                        setattr(existing, key, value)
            
            db.commit()
            logger.info(f"Chargé/mis à jour {len(exercises_data)} exercices")
        else:
            logger.warning(f"Fichier exercises.json non trouvé à {exercises_path}")
            
    except Exception as e:
        logger.error(f"Erreur lors du chargement des exercices: {e}")
        db.rollback()

app = FastAPI(title="Fitness Coach API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== ENDPOINTS UTILISATEUR =====

@app.post("/api/users", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    """Créer un nouveau profil utilisateur"""
    try:
        logger.info(f"📝 Tentative création user: {user.name}")
        logger.info(f"🔍 User data: {user.dict()}")
        
        # Créer un dict User
        user_dict = user.dict()
        # Retirer les champs qui n'appartiennent pas au modèle User
        for field in ['focus_areas', 'sessions_per_week', 'session_duration']:
            user_dict.pop(field, None)
        
        # Créer l'utilisateur avec uniquement les champs du modèle User
        db_user = User(**user_dict)
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        
        logger.info(f"✅ User créé avec ID: {db_user.id}")
        
        return db_user
        
    except Exception as e:
        logger.error(f"❌ Erreur création user: {e}")
        logger.error(traceback.format_exc())
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/users", response_model=List[UserResponse])
def get_all_users(db: Session = Depends(get_db)):
    """Récupérer tous les profils utilisateurs"""
    users = db.query(User).all()
    logger.info(f"Récupération de {len(users)} utilisateurs")  # Ajouter cette ligne
    return users

@app.get("/api/users/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """Récupérer un profil utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    return user

@app.put("/api/users/{user_id}")
def update_user(user_id: int, user_data: Dict[str, Any], db: Session = Depends(get_db)):
    """Mettre à jour le profil utilisateur (incluant équipement)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    for key, value in user_data.items():
        if hasattr(user, key):
            setattr(user, key, value)
    
    db.commit()
    db.refresh(user)
    return user

@app.put("/api/users/{user_id}/preferences")
def update_user_preferences(
    user_id: int,
    preferences: UserPreferenceUpdate,
    db: Session = Depends(get_db)
):
    """Met à jour les préférences utilisateur (incluant la stratégie de poids)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Mettre à jour uniquement les préférences spécifiées
    if preferences.prefer_weight_changes_between_sets is not None:
        user.prefer_weight_changes_between_sets = preferences.prefer_weight_changes_between_sets
    
    if preferences.sound_notifications_enabled is not None:
        user.sound_notifications_enabled = preferences.sound_notifications_enabled

    if preferences.motion_detection_enabled is not None:
        user.motion_detection_enabled = preferences.motion_detection_enabled

    if preferences.motion_calibration_data is not None:
        user.motion_calibration_data = preferences.motion_calibration_data
        logger.info(f"Motion calibration data mise à jour pour user {user_id}: {preferences.motion_calibration_data}")
        
    db.commit()
    db.refresh(user)
    
    logger.info(f"Préférences mises à jour pour user {user_id}: poids variables = {user.prefer_weight_changes_between_sets}, sons = {user.sound_notifications_enabled}, motion = {user.motion_detection_enabled}")
    
    return {
        "message": "Préférences mises à jour avec succès",
        "prefer_weight_changes_between_sets": user.prefer_weight_changes_between_sets,
        "sound_notifications_enabled": user.sound_notifications_enabled,
        "motion_detection_enabled": user.motion_detection_enabled  # AJOUTER CETTE LIGNE
    }

@app.put("/api/users/{user_id}/voice-counting")
def toggle_voice_counting(
    user_id: int, 
    enabled: bool = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    """Toggle comptage vocal pour un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.voice_counting_enabled = enabled
    db.commit()
    db.refresh(user)
    
    logger.info(f"Comptage vocal {'activé' if enabled else 'désactivé'} pour user {user_id}")
    return {"enabled": enabled}

@app.get("/api/users/{user_id}/progression-analysis/{exercise_id}")
def get_progression_analysis(
    user_id: int,
    exercise_id: int,
    db: Session = Depends(get_db)
):
    """Analyse détaillée de la progression pour un exercice"""
    
    # Vérifier que l'utilisateur et l'exercice existent
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercice non trouvé")
    
    # Récupérer les coefficients personnalisés
    coefficients = db.query(UserAdaptationCoefficients).filter(
        UserAdaptationCoefficients.user_id == user_id,
        UserAdaptationCoefficients.exercise_id == exercise_id
    ).first()
    
    # Récupérer l'état de performance
    perf_state = db.query(PerformanceStates).filter(
        PerformanceStates.user_id == user_id,
        PerformanceStates.exercise_id == exercise_id
    ).first()
    
    # Utiliser le moteur ML pour détecter les patterns
    ml_engine = FitnessRecommendationEngine(db)
    patterns = ml_engine._detect_progression_patterns(user_id, exercise_id)
    
    # Générer des suggestions
    suggestions = []
    
    if patterns["pattern_type"] == "linear":
        suggestions.append(f"Progression régulière détectée. Continuez avec des augmentations de {patterns['typical_increment']}kg")
    elif patterns["pattern_type"] == "accelerating":
        suggestions.append("Progression accélérée détectée. Attention à ne pas brûler les étapes")
    else:
        suggestions.append("Progression variable détectée. Considérez une approche plus structurée")
    
    if coefficients and coefficients.recovery_rate < 0.8:
        suggestions.append("Votre récupération semble lente. Envisagez des temps de repos plus longs")
    elif coefficients and coefficients.recovery_rate > 1.2:
        suggestions.append("Excellente récupération ! Vous pouvez réduire les temps de repos")
    
    if perf_state and perf_state.acute_fatigue > 0.7:
        suggestions.append("Fatigue élevée détectée. Considérez une semaine de décharge")
    
    return {
        "exercise_name": exercise.name,
        "coefficients": {
            "recovery_rate": coefficients.recovery_rate if coefficients else 1.0,
            "fatigue_sensitivity": coefficients.fatigue_sensitivity if coefficients else 1.0,
            "volume_response": coefficients.volume_response if coefficients else 1.0
        },
        "performance_state": {
            "base_potential": perf_state.base_potential if perf_state else 0,
            "acute_fatigue": perf_state.acute_fatigue if perf_state else 0,
            "last_session": perf_state.last_session_timestamp.isoformat() if perf_state and perf_state.last_session_timestamp else None
        },
        "progression_patterns": patterns,
        "suggestions": suggestions
    }

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    """Supprimer un profil utilisateur et toutes ses données"""
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Supprimer dans l'ordre pour respecter les contraintes de clés étrangères
    db.query(SetHistory).filter(SetHistory.user_id == user_id).delete(synchronize_session=False)
    db.query(UserCommitment).filter(UserCommitment.user_id == user_id).delete(synchronize_session=False)
    db.query(AdaptiveTargets).filter(AdaptiveTargets.user_id == user_id).delete(synchronize_session=False)
    db.query(SwapLog).filter(SwapLog.user_id == user_id).delete(synchronize_session=False)

    # Les workouts ont cascade configuré, donc seront supprimés automatiquement
    db.query(ExerciseCompletionStats).filter(ExerciseCompletionStats.user_id == user_id).delete(synchronize_session=False)
    db.query(UserAdaptationCoefficients).filter(UserAdaptationCoefficients.user_id == user_id).delete(synchronize_session=False)
    db.query(PerformanceStates).filter(PerformanceStates.user_id == user_id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"message": "Profil supprimé avec succès"}

@app.delete("/api/workouts/{workout_id}")
def delete_workout(workout_id: int, db: Session = Depends(get_db)):
    """Supprime une séance et toutes ses séries associées"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    # Supprimer toutes les séries associées d'abord
    db.query(WorkoutSet).filter(WorkoutSet.workout_id == workout_id).delete()
    
    # Puis supprimer la séance
    db.delete(workout)
    db.commit()
    
    return {"message": "Workout deleted successfully"}

@app.get("/api/users/{user_id}/favorites")
def get_user_favorites(user_id: int, db: Session = Depends(get_db)):
    """Récupérer les exercices favoris d'un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # CORRECTION : S'assurer que favorite_exercises n'est jamais None
    favorites = user.favorite_exercises if user.favorite_exercises is not None else []
    return {"favorites": favorites}

@app.post("/api/users/{user_id}/favorites/{exercise_id}")
def add_favorite(user_id: int, exercise_id: int, db: Session = Depends(get_db)):
    """Ajouter un exercice aux favoris"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # CORRECTION : Initialiser la liste si None
    if user.favorite_exercises is None:
        user.favorite_exercises = []
    
    # CORRECTION : Vérifier si déjà présent
    if exercise_id not in user.favorite_exercises:
        if len(user.favorite_exercises) >= 10:
            raise HTTPException(status_code=400, detail="Maximum 10 favoris autorisés")
        
        user.favorite_exercises.append(exercise_id)
        # CORRECTION CRITIQUE : Marquer comme modifié pour SQLAlchemy
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(user, 'favorite_exercises')
        db.commit()
    
    return {"status": "success", "favorites": user.favorite_exercises}

@app.delete("/api/users/{user_id}/favorites/{exercise_id}")
def remove_favorite(user_id: int, exercise_id: int, db: Session = Depends(get_db)):
    """Retirer un exercice des favoris"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # CORRECTION : S'assurer que la liste existe
    if user.favorite_exercises is None:
        user.favorite_exercises = []
    
    # CORRECTION : Retirer si présent
    if exercise_id in user.favorite_exercises:
        user.favorite_exercises.remove(exercise_id)
        # CORRECTION CRITIQUE : Marquer comme modifié
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(user, 'favorite_exercises')
        db.commit()
    
    return {"status": "success", "favorites": user.favorite_exercises}

@app.delete("/api/users/{user_id}/history")
def clear_user_history(user_id: int, db: Session = Depends(get_db)):
    """Vider l'historique des séances d'un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Supprimer d'abord les sets, puis les workouts (contrainte clé étrangère)
    workout_ids = db.query(Workout.id).filter(Workout.user_id == user_id).all()
    workout_ids = [w.id for w in workout_ids]
    
    if workout_ids:
        db.query(WorkoutSet).filter(WorkoutSet.workout_id.in_(workout_ids)).delete(synchronize_session=False)
        db.query(Workout).filter(Workout.user_id == user_id).delete(synchronize_session=False)
    
    db.commit()
    return {"message": "Historique vidé avec succès"}

# ===== ENDPOINTS EXERCICES =====

@app.get("/api/exercises", response_model=List[ExerciseResponse])
def get_exercises(
    user_id: Optional[int] = None,
    muscle_group: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Récupérer les exercices disponibles, filtrés par équipement utilisateur"""
    query = db.query(Exercise)
        
    if muscle_group:
        query = query.filter(
            cast(Exercise.muscle_groups, JSONB).contains([muscle_group])
        )
    
    exercises = query.all()
    
    # AJOUT TEMPORAIRE - Log pour debug
    if exercises:
        first_exercise = exercises[0]
        logger.info(f"Premier exercice: {first_exercise.name}")
        logger.info(f"weight_type: {getattr(first_exercise, 'weight_type', 'NON DÉFINI')}")
        logger.info(f"bodyweight_percentage: {getattr(first_exercise, 'bodyweight_percentage', 'NON DÉFINI')}")
    
    # Filtrer par équipement disponible si user_id fourni
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.equipment_config:
            available_equipment = get_available_equipment(user.equipment_config)
            exercises = [ex for ex in exercises if can_perform_exercise(ex, available_equipment)]
    
    return exercises

@app.get("/api/exercises/{exercise_id}", response_model=ExerciseResponse)
def get_exercise(exercise_id: int, db: Session = Depends(get_db)):
    """Récupérer un exercice spécifique par son ID"""
    exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercice non trouvé")
    return exercise

def get_available_equipment(equipment_config: Dict[str, Any]) -> List[str]:
    """Utiliser EquipmentService pour cohérence"""
    available_types = EquipmentService.get_available_equipment_types(equipment_config)
    return list(available_types)

def can_perform_exercise(exercise: Exercise, available_equipment: List[str]) -> bool:
    """Vérifier si un exercice peut être effectué avec l'équipement disponible"""
    if not exercise.equipment_required:
        return True
    
    # Convertir la liste en set pour performance
    available_set = set(available_equipment)
    
    # Vérifier qu'au moins un équipement requis est disponible
    for eq in exercise.equipment_required:
        if eq in available_set:
            return True
            
        # Mapping spécial banc
        if eq.startswith('bench_') and 'bench_flat' in available_set:
            return True
    
    return False

# ===== ENDPOINTS PROG/SESSIONS =====
def calculate_session_quality_score(exercise_pool, user_id, db):
    """Calcule le score de qualité d'une session côté serveur"""
    # Version simplifiée pour le backend
    # Le calcul complet est fait côté frontend via SessionQualityEngine
    
    base_score = 75.0
    
    # Bonus/pénalités basiques
    if len(exercise_pool) < 3:
        base_score -= 10  # Trop peu d'exercices
    elif len(exercise_pool) > 8:
        base_score -= 5   # Trop d'exercices
    
    # Vérifier la diversité musculaire
    muscle_groups = set()
    for ex in exercise_pool:
        if "muscle_groups" in ex:
            muscle_groups.update(ex["muscle_groups"])
    
    if len(muscle_groups) >= 3:
        base_score += 10  # Bonne diversité
    elif len(muscle_groups) == 1:
        base_score -= 10  # Trop focalisé
    
    return max(0, min(100, base_score))

def calculate_exercise_swap_impact(current_ex, new_ex, db):
    """Calcule l'impact d'un swap d'exercice sur le score"""
    impact = 0
    
    # Bonus si équipement plus accessible
    if "bodyweight" in new_ex.equipment_required:
        impact += 3
    
    # Bonus/malus selon groupes musculaires
    common_muscles = set(current_ex.muscle_groups) & set(new_ex.muscle_groups)
    if len(common_muscles) >= len(current_ex.muscle_groups) * 0.7:
        impact += 2  # Bon remplacement
    else:
        impact -= 5  # Mauvais remplacement
    
    return impact

def calculate_session_duration(exercises_data, target_duration_minutes):
    """
    Calcule la durée réelle d'une session et ajuste les paramètres pour respecter la durée cible.
    
    Paramètres:
    - exercises_data: liste des exercices avec leurs données DB
    - target_duration_minutes: durée cible en minutes (30, 45, 60, etc.)
    
    Retourne:
    - exercise_pool optimisé avec sets/reps ajustés
    - durée estimée réelle
    """
    
    def estimate_exercise_duration(exercise_db, sets, reps_avg):
        """Estime la durée d'un exercice complet"""
        # Temps d'effort par rep (variable selon type d'exercice)
        effort_per_rep = 3  # secondes de base
        if exercise_db.exercise_type == "compound":
            effort_per_rep = 4  # Exercices composés plus longs
        elif exercise_db.exercise_type == "isolation":
            effort_per_rep = 2.5  # Exercices d'isolation plus rapides
            
        # Temps de repos ajusté par intensity_factor
        rest_time = exercise_db.base_rest_time_seconds * (exercise_db.intensity_factor or 1.0)
        
        # Temps total pour cet exercice
        effort_total = sets * reps_avg * effort_per_rep
        rest_total = (sets - 1) * rest_time  # Pas de repos après la dernière série
        setup_time = 60  # 1 minute pour setup/changement d'équipement
        
        return effort_total + rest_total + setup_time
    
    # Calcul initial avec paramètres par défaut
    total_duration_seconds = 0
    exercise_durations = []
    
    for ex in exercises_data:
        sets = ex.default_sets
        reps_avg = (ex.default_reps_min + ex.default_reps_max) / 2
        duration = estimate_exercise_duration(ex, sets, reps_avg)
        
        exercise_durations.append({
            "exercise": ex,
            "sets": sets,
            "reps_avg": reps_avg,
            "duration_seconds": duration
        })
        total_duration_seconds += duration
    
    # Ajouter temps de transition entre exercices (1 min par transition)
    if len(exercises_data) > 1:
        total_duration_seconds += (len(exercises_data) - 1) * 60
    
    # Ajouter échauffement/récupération (5 minutes)
    total_duration_seconds += 300
    
    estimated_minutes = total_duration_seconds / 60
    target_seconds = target_duration_minutes * 60
    
    # Si la durée dépasse la cible, ajuster intelligemment
    if estimated_minutes > target_duration_minutes * 1.1:  # Marge de 10%
        
        # Stratégies d'ajustement par ordre de priorité :
        
        # 1. Réduire le nombre d'exercices en premier
        ratio_over = estimated_minutes / target_duration_minutes
        if ratio_over > 1.5:  # Plus de 50% au-dessus
            # Enlever des exercices (garder les plus prioritaires)
            max_exercises = max(2, int(len(exercises_data) / ratio_over))
            exercises_data = exercises_data[:max_exercises]
            
        # 2. Réduire les séries des exercices d'isolation
        elif ratio_over > 1.2:  # 20-50% au-dessus
            for ex_data in exercise_durations:
                if ex_data["exercise"].exercise_type == "isolation":
                    ex_data["sets"] = max(2, ex_data["sets"] - 1)
                    
        # 3. Réduire légèrement les reps
        elif ratio_over > 1.1:  # 10-20% au-dessus
            for ex_data in exercise_durations:
                if ex_data["reps_avg"] > 10:
                    ex_data["reps_avg"] = max(8, ex_data["reps_avg"] - 2)
    
    # Recalculer après ajustements
    adjusted_exercise_pool = []
    total_adjusted_duration = 0
    
    for ex_data in exercise_durations[:len(exercises_data)]:  # Limiter si on a retiré des exercices
        ex = ex_data["exercise"]
        sets = ex_data["sets"]
        reps_avg = int(ex_data["reps_avg"])
        
        # Recalculer durée ajustée
        duration = estimate_exercise_duration(ex, sets, reps_avg)
        total_adjusted_duration += duration
        
        # Créer entry pour exercise_pool
        adjusted_exercise_pool.append({
            "exercise_id": ex.id,
            "exercise_name": ex.name,
            "sets": sets,
            "reps_min": max(6, reps_avg - 2),
            "reps_max": reps_avg + 2,
            "priority": 3,  # Priorité neutre par défaut
            "estimated_duration_minutes": duration / 60,
            "constraints": {
                "min_recovery_hours": 48,
                "max_frequency_per_week": 2,
                "required_equipment": ex.equipment_required or []
            },
            "muscle_groups": ex.muscle_groups
        })
    
    # Durée finale ajustée
    final_duration_minutes = (total_adjusted_duration + 300) / 60  # +5min échauffement
    
    return {
        "exercise_pool": adjusted_exercise_pool,
        "estimated_duration_minutes": final_duration_minutes,
        "target_duration_minutes": target_duration_minutes,
        "duration_accuracy": abs(final_duration_minutes - target_duration_minutes) <= target_duration_minutes * 0.15,  # Marge 15%
        "adjustments_made": estimated_minutes > target_duration_minutes * 1.1
    }

# ===== ENDPOINTS SÉANCES =====

@app.post("/api/users/{user_id}/workouts")
def start_workout(user_id: int, workout: WorkoutCreate, db: Session = Depends(get_db)):
    """Démarrer une nouvelle séance (free ou AI)"""
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Vérifier s'il y a une séance active
    active_workout = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "active"
    ).first()
    
    if active_workout:
        return {"message": "Séance active existante", "workout": active_workout}
    
    # NOUVEAU : Gérer flag AI pour workouts type 'free'
    metadata = {}
    if workout.type == 'free' and hasattr(workout, 'ai_generated') and workout.ai_generated:
        logger.info(f"Création workout type 'free' généré par AI pour user {user_id}")
        metadata['ai_generated'] = True
    
    db_workout = Workout(
        user_id=user_id,
        type=workout.type,  # Sera 'free' pour les séances AI
        status="active",
        started_at=datetime.now(timezone.utc),
        metadata=metadata  # Stocker le flag AI
    )
    
    db.add(db_workout)
    db.commit()
    db.refresh(db_workout)
    
    return {"message": "Séance créée", "workout": db_workout}


@app.put("/api/workouts/{workout_id}/ai-metadata")
def save_ai_workout_metadata(
    workout_id: int,
    metadata: dict,
    db: Session = Depends(get_db)
):
    """Sauvegarde métadonnées spécifiques séances IA"""
    
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout non trouvé")
    
    if workout.type != 'ai':
        raise HTTPException(status_code=400, detail="Métadonnées IA uniquement pour workout type 'ai'")
    
    try:
        # Stocker dans le champ approprié de votre modèle Workout
        # Adapter selon structure de votre table Workout
        
        if hasattr(workout, 'ai_metadata'):
            workout.ai_metadata = metadata
        elif hasattr(workout, 'metadata'):
            if not workout.metadata:
                workout.metadata = {}
            workout.metadata['ai_session'] = metadata
        else:
            # Si pas de champ métadonnées, logger seulement
            logger.info(f"Métadonnées IA workout {workout_id}: {metadata}")
        
        db.commit()
        
        return {
            "message": "Métadonnées IA sauvées",
            "workout_id": workout_id,
            "metadata": metadata
        }
        
    except Exception as e:
        logger.error(f"Erreur sauvegarde métadonnées IA: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@app.get("/api/users/{user_id}/workouts/active")
def get_active_workout(user_id: int, db: Session = Depends(get_db)):
    """Récupérer la séance active"""
    workout = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "active"
    ).first()
    
    return workout

@app.get("/api/users/{user_id}/workouts/resumable")
def get_resumable_workout(user_id: int, db: Session = Depends(get_db)):
    """Récupérer la séance reprenables = active OU abandoned avec contenu"""
    # Chercher séances active ou abandonnées récentes (moins de 24h)
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
    
    workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        or_(Workout.status == "active", Workout.status == "abandoned"),
        Workout.started_at >= cutoff_time
    ).order_by(Workout.started_at.desc()).all()
    
    # Vérifier chaque séance pour s'assurer qu'elle a du contenu
    for workout in workouts:
        total_reps = db.query(func.sum(WorkoutSet.reps)).filter(
            WorkoutSet.workout_id == workout.id
        ).scalar() or 0
        
        if total_reps > 0:
            return workout
    
    # Aucune séance reprenables trouvée
    return None

@app.post("/api/workouts/{workout_id}/sets")
def add_set(workout_id: int, set_data: SetCreate, db: Session = Depends(get_db)):
    """Ajouter une série à la séance avec enregistrement ML"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    ml_engine = FitnessRecommendationEngine(db)
    
    db_set = WorkoutSet(
        workout_id=workout_id,
        exercise_id=set_data.exercise_id,
        set_number=set_data.set_number,
        reps=set_data.reps,
        weight=set_data.weight,
        duration_seconds=set_data.duration_seconds,
        base_rest_time_seconds=set_data.base_rest_time_seconds,
        target_reps=set_data.target_reps,
        target_weight=set_data.target_weight,
        fatigue_level=set_data.fatigue_level,
        effort_level=set_data.effort_level,
        ml_weight_suggestion=set_data.ml_weight_suggestion,
        ml_reps_suggestion=set_data.ml_reps_suggestion,
        ml_confidence=set_data.ml_confidence,
        user_followed_ml_weight=set_data.user_followed_ml_weight,
        user_followed_ml_reps=set_data.user_followed_ml_reps,
        exercise_order_in_session=set_data.exercise_order_in_session,
        set_order_in_session=set_data.set_order_in_session,
        ml_adjustment_enabled=set_data.ml_adjustment_enabled,
        voice_data=set_data.voice_data.dict() if set_data.voice_data else None
    )
    
    db.add(db_set)
    db.commit()
    db.refresh(db_set)
    
    # Enregistrer pour l'apprentissage ML
    if set_data.fatigue_level and set_data.effort_level:
        performance_data = {
            "weight": set_data.weight or 0,
            "actual_reps": set_data.reps,
            "target_reps": set_data.target_reps or set_data.reps,
            "fatigue_level": set_data.fatigue_level,
            "effort_level": set_data.effort_level,
            "exercise_order": set_data.exercise_order_in_session or 1,
            "set_order_global": set_data.set_order_in_session or 1,
            "set_number": set_data.set_number,
            "rest_before_seconds": set_data.base_rest_time_seconds,
            "session_fatigue_start": workout.overall_fatigue_start
        }
        
        ml_engine.record_set_performance(
            workout.user_id, 
            set_data.exercise_id, 
            performance_data
        )
    
    # Retourner l'objet avec tous les champs sérialisés
    return {
        "id": db_set.id,
        "workout_id": db_set.workout_id,
        "exercise_id": db_set.exercise_id,
        "set_number": db_set.set_number,
        "reps": db_set.reps,
        "weight": db_set.weight,
        "duration_seconds": db_set.duration_seconds,
        "base_rest_time_seconds": db_set.base_rest_time_seconds,
        "actual_rest_duration_seconds": db_set.actual_rest_duration_seconds,
        "fatigue_level": db_set.fatigue_level,
        "effort_level": db_set.effort_level,
        "completed_at": db_set.completed_at.isoformat() if db_set.completed_at else None
    }

@app.get("/api/workouts/{workout_id}/sets")
def get_workout_sets(workout_id: int, db: Session = Depends(get_db)):
    """Récupérer toutes les séries d'une séance"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    sets = db.query(WorkoutSet).filter(
        WorkoutSet.workout_id == workout_id
    ).order_by(WorkoutSet.id).all()
    
    return sets

@app.get("/api/workouts/{workout_id}", response_model=WorkoutResponse)
def get_workout(workout_id: int, db: Session = Depends(get_db)):
    """Récupérer les détails d'une séance spécifique"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    return workout

@app.post("/api/workouts/{workout_id}/recommendations")
def get_set_recommendations(
    workout_id: int, 
    request: Dict[str, Any], 
    db: Session = Depends(get_db)
):
    """Obtenir des recommandations ML pour la prochaine série avec historique séance"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    user = workout.user
    exercise = db.query(Exercise).filter(Exercise.id == request["exercise_id"]).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercice non trouvé")
    available_weights = EquipmentService.get_available_weights(db, user.id, exercise)
    
    # Importer et utiliser le moteur ML
    from backend.ml_recommendations import FitnessRecommendationEngine
    ml_engine = FitnessRecommendationEngine(db)
    
    # Extraire toutes les données de la requête
    session_history = request.get('session_history', [])
    completed_sets_count = request.get('completed_sets_this_exercise', 0)
    set_number = request.get("set_number", 1)
    current_fatigue = request.get("current_fatigue", 3)
    current_effort = request.get("current_effort", 3)  # Effort de la dernière série
    last_rest_duration = request.get("last_rest_duration", None)
    exercise_order = request.get("exercise_order", 1)
    set_order_global = request.get("set_order_global", 1)
    # Récupérer les données vocales de la dernière série
    last_set_voice_data = None
    if workout_id and set_number > 1:
        last_set = db.query(WorkoutSet).filter(
            WorkoutSet.workout_id == workout_id,
            WorkoutSet.exercise_id == exercise.id,
            WorkoutSet.set_number == set_number - 1
        ).first()
        if last_set and last_set.voice_data:
            last_set_voice_data = last_set.voice_data
            logger.info(f"[ML] Données vocales trouvées pour série précédente: tempo={last_set_voice_data.get('tempo_avg')}ms")

    # Transmettre les données vocales au moteur ML
    if last_set_voice_data:
        request['last_set_voice_data'] = last_set_voice_data
    # Appel au moteur ML avec les bonnes variables
    base_recommendations = ml_engine.get_set_recommendations(
        user=user,
        exercise=exercise,
        set_number=set_number,
        current_fatigue=current_fatigue,
        current_effort=current_effort,
        last_rest_duration=last_rest_duration,
        exercise_order=exercise_order,
        set_order_global=set_order_global,
        available_weights=available_weights,
        workout_id=workout_id,
        last_set_voice_data=last_set_voice_data  # AJOUT
    )
        
    if base_recommendations.get('weight_recommendation') is None or base_recommendations.get('weight_recommendation') == 0:
        logger.warning(f"Recommandation poids invalide pour exercise {exercise.id}, calcul fallback")
        
        if exercise.weight_type == "bodyweight":
            base_recommendations['weight_recommendation'] = None  # Normal pour bodyweight
        elif exercise.weight_type == "hybrid" and exercise.base_weights_kg:
            # Calcul spécifique hybrid
            level = user.experience_level
            if level in exercise.base_weights_kg:
                base = exercise.base_weights_kg[level].get('base', 30)
                per_kg = exercise.base_weights_kg[level].get('per_kg_bodyweight', 0.5)
                base_recommendations['weight_recommendation'] = float(base + (per_kg * user.weight))
            else:
                base_recommendations['weight_recommendation'] = 40.0  # Fallback général
        else:
            # Exercices externes standards
            from backend.ml_engine import FitnessMLEngine
            ml_fallback = FitnessMLEngine(db)
            base_recommendations['weight_recommendation'] = ml_fallback.calculate_starting_weight(user, exercise)

    # AJUSTEMENTS basés sur l'historique de la séance en cours
    if session_history and len(session_history) > 0:
        last_set = session_history[-1]
        last_effort = last_set.get('effort_level', 3)
        last_weight = last_set.get('weight', base_recommendations.get('weight_recommendation', 20))
        recommended_weight = base_recommendations.get('weight_recommendation', 20)
        
        # NOUVEAU : Calculer l'écart performance vs recommandation
        if last_weight and recommended_weight and recommended_weight > 0:
            performance_ratio = last_weight / recommended_weight
            
            # Ajustement AGRESSIF basé sur l'écart réel
            weight_adjustment = 1.0
            reason_parts = []
            
            if last_effort <= 2 and performance_ratio > 1.1:  # Facile ET plus de poids
                # L'utilisateur fait plus avec facilité → gros bond
                weight_adjustment = min(1.25, performance_ratio * 0.95)  # Max +25%
                reason_parts.append(f"Série {len(session_history)} facile avec {last_weight}kg (>{recommended_weight:.1f}kg)")
                
            elif last_effort <= 2:  # Juste facile
                weight_adjustment = 1.08
                reason_parts.append(f"Série {len(session_history)} facile (effort {last_effort})")
                
            elif last_effort >= 4:  # Difficile ou échec
                weight_adjustment = 0.93
                reason_parts.append(f"Série {len(session_history)} difficile (effort {last_effort})")
            
            # Appliquer les ajustements si significatifs
            if abs(weight_adjustment - 1.0) > 0.02:
                adjusted_weight = recommended_weight * weight_adjustment
                
                # Arrondir au poids disponible le plus proche
                if available_weights:
                    adjusted_weight = min(available_weights, key=lambda x: abs(x - adjusted_weight))
                else:
                    adjusted_weight = round(adjusted_weight * 2) / 2
                
                # Validation finale pour dumbbells
                if exercise.equipment_required and 'dumbbells' in exercise.equipment_required:
                    if adjusted_weight % 2 != 0:
                        adjusted_weight = int(round(adjusted_weight / 2)) * 2

                base_recommendations['weight_recommendation'] = adjusted_weight
                base_recommendations['reasoning'] = " + ".join(reason_parts) + f" → {recommended_weight:.1f}kg → {adjusted_weight:.1f}kg"
                base_recommendations['weight_change'] = "increase" if adjusted_weight > recommended_weight else "decrease"

        
        # Ajustement des répétitions selon la progression
        if len(session_history) >= 2:
            # Si les 2 dernières séries étaient faciles, augmenter les reps
            recent_efforts = [s.get('effort_level', 3) for s in session_history[-2:]]
            if all(effort <= 2 for effort in recent_efforts):
                original_reps = base_recommendations.get('reps_recommendation', 10)
                base_recommendations['reps_recommendation'] = min(15, original_reps + 1)
                if base_recommendations.get('reasoning'):
                    base_recommendations['reasoning'] += " + reps +1"
                else:
                    base_recommendations['reasoning'] = "Séries récentes faciles → reps +1"
    
    # BOOST DE CONFIANCE selon l'historique de cette séance
    base_confidence = base_recommendations.get('confidence', 0.5)
    
    if completed_sets_count > 0:
        # +6% de confiance par série complétée, max +24% (4 séries)
        confidence_boost = min(0.24, completed_sets_count * 0.06)
        
        # Bonus supplémentaire si cohérence dans les efforts
        if len(session_history) >= 2:
            efforts = [s.get('effort_level', 3) for s in session_history]
            effort_variance = max(efforts) - min(efforts)
            if effort_variance <= 1:  # Efforts cohérents
                confidence_boost += 0.1
        
        # Malus si efforts très variables (prédictions difficiles)
        elif len(session_history) >= 3:
            efforts = [s.get('effort_level', 3) for s in session_history]
            effort_variance = max(efforts) - min(efforts)
            if effort_variance >= 3:  # Très variable
                confidence_boost -= 0.05
        
        final_confidence = min(0.95, max(0.3, base_confidence + confidence_boost))
        base_recommendations['confidence'] = round(final_confidence, 2)
    
    # NOUVEAU: Ajuster le temps de repos selon l'historique
    if session_history and len(session_history) > 0:
        last_rest = session_history[-1].get('actual_rest_duration', None)
        base_rest = base_recommendations.get('rest_seconds_recommendation', 90)
        
        if last_rest:
            # Si le repos précédent était très court et la série difficile
            if last_rest < base_rest * 0.7 and session_history[-1].get('effort_level', 3) >= 4:
                base_recommendations['rest_seconds_recommendation'] = min(120, int(base_rest * 1.2))
                if base_recommendations.get('reasoning'):
                    base_recommendations['reasoning'] += " + repos +20%"
            
            # Si repos très long mais série facile, raccourcir
            elif last_rest > base_rest * 1.5 and session_history[-1].get('effort_level', 3) <= 2:
                base_recommendations['rest_seconds_recommendation'] = max(45, int(base_rest * 0.85))
                if base_recommendations.get('reasoning'):
                    base_recommendations['reasoning'] += " + repos -15%"

    # Ajouter la raison du temps de repos
    rest_reason = "Récupération normale"
    if current_fatigue >= 4:
        rest_reason = "Fatigue élevée"
    elif current_effort >= 4:
        rest_reason = "Effort intense"
    elif set_number > 3:
        rest_reason = "Séries avancées"
    
    base_recommendations['rest_reason'] = rest_reason
    
    # LOGGING pour debug et amélioration continue
    logger.info(f"Recommandations pour user {user.id}, exercise {exercise.id}, set {set_number}:")
    logger.info(f"  Base: {base_recommendations.get('baseline_weight')}kg x {base_recommendations.get('reps_recommendation')} reps")
    logger.info(f"  Repos: {base_recommendations.get('rest_seconds_recommendation')}s ({rest_reason})")
    logger.info(f"  Confiance: {base_recommendations.get('confidence', 0):.2f}")
    logger.info(f"  Historique séance: {len(session_history)} séries")
    if base_recommendations.get('reasoning'):
        logger.info(f"  Raison: {base_recommendations['reasoning']}")
    
    return base_recommendations

@app.put("/api/users/{user_id}/voice-counting")
def toggle_voice_counting(
    user_id: int, 
    enabled: bool = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    """Toggle comptage vocal pour un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.voice_counting_enabled = enabled
    db.commit()
    
    logger.info(f"[Voice] Comptage vocal {'activé' if enabled else 'désactivé'} pour user {user_id}")
    
    return {"enabled": enabled}

@app.get("/api/exercises/{exercise_id}/alternatives")
async def get_exercise_alternatives(
    exercise_id: int,
    user_id: int = Query(...),
    reason: str = Query("preference", regex="^(pain|equipment|preference)$"),
    workout_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Récupère alternatives intelligentes pour un exercice
    Optimisé : 1 seule requête DB principale + scoring en mémoire
    """
    logger.info(f"🔄 Alternatives pour exercice {exercise_id}, user {user_id}")
    
    # 1. Validation en une requête
    base_query = db.query(Exercise, User).filter(
        Exercise.id == exercise_id,
        User.id == user_id
    ).first()
    
    if not base_query:
        raise HTTPException(status_code=404, detail="Exercise or user not found")
    
    source_exercise, user = base_query
    
    # 2. Récupérer exercices récents (7 derniers jours) en 1 requête
    recent_cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    recent_exercise_ids = db.query(WorkoutSet.exercise_id).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= recent_cutoff
    ).distinct().all()
    recent_exercise_ids = [ex_id[0] for ex_id in recent_exercise_ids]
    
    # 3. Récupérer candidats en 1 requête optimisée
    primary_muscle = source_exercise.muscle_groups[0] if source_exercise.muscle_groups else None
    
    if not primary_muscle:
        return {"alternatives": [], "keep_current": {"advice": "Exercice sans groupe musculaire défini"}}
    
    # Query principale pour candidats
    candidates_query = db.query(Exercise).filter(
        Exercise.id != exercise_id,
        cast(Exercise.muscle_groups, JSONB).contains([primary_muscle])
    )
    
    # Ajustement selon raison
    if reason == "pain":
        # Pour douleur : éviter même pattern ou chercher variations plus douces
        candidates_query = candidates_query.filter(Exercise.difficulty.in_(['beginner', 'intermediate']))
    
    candidates = candidates_query.all()
    
    # 4. Scoring en mémoire (rapide)
    user_equipment = EquipmentService.get_available_equipment_types(user.equipment_config)
    
    scored_candidates = []
    for candidate in candidates:
        score = score_exercise_alternative(source_exercise, candidate, user_equipment, recent_exercise_ids)
        if score > 0.3:  # Seuil minimum
            scored_candidates.append({
                'exercise': candidate,
                'score': score
            })
    
    # 5. Trier et limiter
    scored_candidates.sort(key=lambda x: x['score'], reverse=True)
    top_alternatives = scored_candidates[:4]  # Top 4 pour UI
    
    # 6. Format de réponse simple
    alternatives = []
    for item in top_alternatives:
        ex = item['exercise']
        # Calculer le score impact vs exercice original
        source_score = score_exercise_alternative(source_exercise, source_exercise, user_equipment, recent_exercise_ids)
        score_impact = round((item['score'] - source_score) * 100)  # Différence en points de pourcentage
        
        alternatives.append({
            'exercise_id': ex.id,
            'name': ex.name,
            'muscle_groups': ex.muscle_groups,
            'equipment_required': ex.equipment_required or [],
            'difficulty': ex.difficulty,
            'score': round(item['score'], 2),
            'score_impact': score_impact,
            'reason_match': get_reason_explanation(reason, ex.difficulty, source_exercise.difficulty)
        })
    
    # 7. Conseil pour garder exercice actuel
    keep_advice = {
        'pain': "Réduire poids de 30% ou amplitude de mouvement",
        'equipment': "Vérifier équipement alternatif disponible",
        'preference': "Ajuster technique ou tempo pour varier"
    }
    
    return {
        "alternatives": alternatives,
        "keep_current": {"advice": keep_advice.get(reason, "Maintenir exercice actuel")},
        "source_exercise": source_exercise.name,
        "reason": reason
    }

def get_reason_explanation(reason: str, alt_difficulty: str, source_difficulty: str) -> str:
    """Explication simple selon raison et difficulté"""
    if reason == "pain":
        return "Mouvement potentiellement moins stressant"
    elif reason == "equipment":
        return "Utilise équipement alternatif"
    elif alt_difficulty != source_difficulty:
        return f"Niveau {alt_difficulty} vs {source_difficulty}"
    else:
        return "Alternative équivalente"

@app.post("/api/workouts/{workout_id}/track-swap")
async def track_exercise_swap(
    workout_id: int,
    swap_data: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db)
):
    """
    Track un swap - Version simple mais complète
    Body: {original_exercise_id, new_exercise_id, reason, sets_completed_before}
    """
    logger.info(f"📝 Track swap: {swap_data}")
    
    # Validation rapide
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    try:
        # 1. Créer SwapLog
        swap_log = SwapLog(
            user_id=workout.user_id,
            workout_id=workout_id,
            original_exercise_id=swap_data['original_exercise_id'],
            new_exercise_id=swap_data['new_exercise_id'],
            reason=swap_data['reason'],
            sets_completed_before=swap_data.get('sets_completed_before', 0)
        )
        db.add(swap_log)
        
        # 2. Ajouter à workout.modifications
        if not workout.modifications:
            workout.modifications = []
        
        modification = {
            'type': 'swap',
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'from_id': swap_data['original_exercise_id'],
            'to_id': swap_data['new_exercise_id'],
            'reason': swap_data['reason']
        }
        workout.modifications.append(modification)
        flag_modified(workout, 'modifications')
        
        db.commit()
        
        return {"status": "success", "swap_id": swap_log.id}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur track swap: {e}")
        raise HTTPException(status_code=500, detail="Error tracking swap")
    
@app.get("/api/workouts/{workout_id}/exercises/{exercise_id}/can-swap")
async def check_swap_eligibility(
    workout_id: int,
    exercise_id: int,
    user_id: int = Query(...),
    db: Session = Depends(get_db)
):
    """Validation rapide si swap possible - Règles métier de base"""
    
    # 1. Vérifier workout actif
    workout = db.query(Workout).filter(
        Workout.id == workout_id,
        Workout.user_id == user_id,
        Workout.status == 'active'
    ).first()
    
    if not workout:
        return {"allowed": False, "reason": "Séance inactive ou non trouvée"}
    
    # 2. Compter sets complétés
    completed_sets = db.query(WorkoutSet).filter(
        WorkoutSet.workout_id == workout_id,
        WorkoutSet.exercise_id == exercise_id
    ).count()
    
    # Règle simple : pas plus de 50% de l'exercice fait
    if completed_sets > 2:  # Assumant 3-4 sets standard
        return {
            "allowed": False, 
            "reason": f"Exercice trop avancé ({completed_sets} sets complétées)"
        }
    
    # 3. Vérifier pas déjà swappé
    existing_swap = db.query(SwapLog).filter(
        SwapLog.workout_id == workout_id,
        SwapLog.original_exercise_id == exercise_id
    ).first()
    
    if existing_swap:
        return {"allowed": False, "reason": "Exercice déjà modifié"}
    
    # 4. Limite globale de swaps par séance
    total_swaps = db.query(SwapLog).filter(SwapLog.workout_id == workout_id).count()
    if total_swaps >= 2:  # Max 2 swaps par séance
        return {"allowed": False, "reason": "Limite de modifications atteinte (2 max)"}
    
    return {"allowed": True, "reason": "Swap autorisé"}

@app.post("/api/workouts/{workout_id}/ml-rest-feedback")
def record_ml_rest_feedback(
    workout_id: int,
    feedback_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Enregistrer le feedback utilisateur sur les recommandations ML de repos"""
    
    # Vérifier que la séance existe
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    # Initialiser metadata comme dictionnaire Python si None
    if workout.metadata is None:
        workout.metadata = {}
    
    # Convertir en dictionnaire si ce n'est pas déjà le cas
    metadata_dict = dict(workout.metadata) if workout.metadata else {}
    
    # Ajouter le feedback
    if 'ml_rest_feedback' not in metadata_dict:
        metadata_dict['ml_rest_feedback'] = []
    
    metadata_dict['ml_rest_feedback'].append({
        'timestamp': datetime.now().isoformat(),
        'stats': feedback_data.get('stats', []),
        'summary': feedback_data.get('summary', {}),
        'total_suggestions': len(feedback_data.get('stats', [])),
        'accepted_count': len([s for s in feedback_data.get('stats', []) if s.get('accepted', False)])
    })
    
    # Réassigner la metadata complète
    workout.metadata = metadata_dict
    
    # Marquer comme modifié pour SQLAlchemy
    flag_modified(workout, "metadata")
    db.commit()
    
    return {"message": "Feedback recorded", "suggestions_count": len(feedback_data.get('stats', []))}

@app.put("/api/workouts/{workout_id}/fatigue")
def update_workout_fatigue(
    workout_id: int, 
    fatigue_data: Dict[str, int], 
    db: Session = Depends(get_db)
):
    """Mettre à jour le niveau de fatigue global de la séance"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    if "overall_fatigue_start" in fatigue_data:
        workout.overall_fatigue_start = fatigue_data["overall_fatigue_start"]
    
    if "overall_fatigue_end" in fatigue_data:
        workout.overall_fatigue_end = fatigue_data["overall_fatigue_end"]
    
    db.commit()
    return {"message": "Fatigue mise à jour", "workout": workout}

@app.put("/api/workouts/{workout_id}/complete")
def complete_workout(workout_id: int, data: Dict[str, Any] = {}, db: Session = Depends(get_db)):
    """Terminer une séance"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    workout.status = "completed"
    workout.completed_at = datetime.now(timezone.utc)
    db.commit()  # Forcer le commit immédiatement
    db.refresh(workout)  # Rafraîchir l'objet

    # CORRECTION : Gestion robuste des erreurs lors de la mise à jour des stats
    try:
        exercise_ids = db.query(distinct(WorkoutSet.exercise_id)).filter(
            WorkoutSet.workout_id == workout_id
        ).all()
        for (exercise_id,) in exercise_ids:
            try:
                update_exercise_stats_for_user(db, workout.user_id, exercise_id)
            except Exception as stats_error:
                logger.warning(f"Erreur mise à jour stats pour exercise {exercise_id}: {stats_error}")
                # Continuer même si une stat échoue
                continue
    except Exception as global_error:
        logger.error(f"Erreur lors de la mise à jour des stats workout {workout_id}: {global_error}")
        # Ne pas faire crasher l'endpoint, juste logger l'erreur
    
    # Continuer avec le reste de la logique...
    if "total_duration" in data:
        workout.total_duration_minutes = max(1, round(data["total_duration"] / 60))
    elif workout.started_at:
        started_at = workout.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        
        duration = workout.completed_at - started_at
        workout.total_duration_minutes = int(duration.total_seconds() / 60)
    
    if "total_rest_time" in data:
        workout.total_rest_time_seconds = data["total_rest_time"]

    # MODULE 0 : Traitement des exercices skippés
    skipped_exercises = data.get('skipped_exercises', [])
    session_metadata = data.get('session_metadata', {})

    if skipped_exercises:
        workout.skipped_exercises = skipped_exercises
        logger.info(f"Workout {workout_id}: {len(skipped_exercises)} exercises skipped")
        
        # Analyse temps réel des patterns de skip  
        try:
            analyze_skip_patterns_realtime(workout.user_id, skipped_exercises, db)
        except Exception as e:
            logger.warning(f"Skip pattern analysis failed: {e}")

    if session_metadata:
        workout.session_metadata = session_metadata

    db.commit()
    return {"message": "Séance terminée", "workout": workout}

@app.delete("/api/workouts/{workout_id}/abandon")
def abandon_workout_smart(workout_id: int, db: Session = Depends(get_db)):
    """Abandonner intelligemment : supprimer si vide, marquer si contenu"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    # Calculer le total des reps effectuées
    total_reps = db.query(func.sum(WorkoutSet.reps)).filter(
        WorkoutSet.workout_id == workout_id
    ).scalar() or 0
    
    if total_reps == 0:
        # Supprimer complètement la séance vide
        db.query(WorkoutSet).filter(WorkoutSet.workout_id == workout_id).delete(synchronize_session=False)
        db.query(Workout).filter(Workout.id == workout_id).delete(synchronize_session=False)
        db.commit()
        return {"action": "deleted", "reason": "empty_session", "total_reps": 0}
    else:
        # Marquer comme abandonnée pour recovery future
        workout.status = "abandoned"
        workout.completed_at = datetime.now(timezone.utc)
        db.commit()
        return {"action": "abandoned", "reason": "has_content", "total_reps": total_reps}

@app.put("/api/sets/{set_id}/rest-duration")
def update_set_rest_duration(set_id: int, data: Dict[str, int], db: Session = Depends(get_db)):
    """Mettre à jour la durée de repos réelle d'une série"""
    workout_set = db.query(WorkoutSet).filter(WorkoutSet.id == set_id).first()
    if not workout_set:
        raise HTTPException(status_code=404, detail="Série non trouvée")
    
    workout_set.actual_rest_duration_seconds = data.get("actual_rest_duration_seconds")
    db.commit()
    return {"message": "Durée de repos mise à jour"}

# ===== ENDPOINTS STATISTIQUES =====
@app.get("/api/users/{user_id}/stats")
def get_user_stats(user_id: int, db: Session = Depends(get_db)):
    """Récupère les statistiques générales d'un utilisateur - VERSION OPTIMISÉE"""
    from sqlalchemy import func
    from sqlalchemy.orm import joinedload
    
    # Vérifier que l'utilisateur existe
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # 1. Stats globales en une seule requête
    stats = db.query(
        func.count(Workout.id).label('total_workouts'),
        func.sum(WorkoutSet.weight * WorkoutSet.reps).label('total_volume')
    ).select_from(Workout).join(WorkoutSet).filter(
        Workout.user_id == user_id,
        Workout.status == "completed"
    ).first()
    
    total_workouts = stats.total_workouts or 0
    total_volume = float(stats.total_volume or 0)
    
    # 2. Récupérer les workouts récents avec tous leurs sets et exercices en UNE SEULE requête
    recent_workouts = db.query(Workout).options(
        joinedload(Workout.sets).joinedload(WorkoutSet.exercise)
    ).filter(
        Workout.user_id == user_id,
        Workout.status == "completed"
    ).order_by(Workout.completed_at.desc()).limit(3).all()
    
    # 3. Transformer les données (pas de requêtes supplémentaires !)
    recent_workouts_with_stats = []
    for workout in recent_workouts:
        # Les sets sont déjà chargés grâce à joinedload
        sets = workout.sets
        
        # Calculs en mémoire (rapide)
        total_sets = len(sets)
        total_volume_workout = sum((s.weight or 0) * (s.reps or 0) for s in sets)
        
        # Exercices uniques
        unique_exercises = set()
        muscle_distribution = {}
        
        for workout_set in sets:
            # L'exercice est déjà chargé grâce à joinedload
            exercise = workout_set.exercise
            unique_exercises.add(exercise.id)
            
            if exercise.muscle_groups:
                muscle_count = len(exercise.muscle_groups)
                for muscle in exercise.muscle_groups:
                    if muscle not in muscle_distribution:
                        muscle_distribution[muscle] = 0
                    muscle_distribution[muscle] += 1 / muscle_count
        
        # Convertir en pourcentages
        if muscle_distribution:
            total_muscle_work = sum(muscle_distribution.values())
            muscle_distribution = {
                muscle: round((count / total_muscle_work) * 100)
                for muscle, count in muscle_distribution.items()
            }
        
        # Calculer les temps
        total_exercise_time = sum(s.duration_seconds or 0 for s in sets)
        total_rest_time = workout.total_rest_time_seconds or 0
        total_duration_seconds = (workout.total_duration_minutes or 0) * 60
        total_transition_time = max(0, total_duration_seconds - total_exercise_time - total_rest_time)
        
        workout_dict = {
            "id": workout.id,
            "user_id": workout.user_id,
            "type": workout.type,
            "status": workout.status,
            "started_at": workout.started_at.isoformat() if workout.started_at else None,
            "completed_at": workout.completed_at.isoformat() if workout.completed_at else None,
            "total_duration_minutes": workout.total_duration_minutes,
            "total_rest_time_seconds": total_rest_time,
            "total_exercise_time_seconds": total_exercise_time,
            "total_transition_time_seconds": total_transition_time,
            "total_sets": total_sets,
            "total_volume": total_volume_workout,
            "total_exercises": len(unique_exercises),
            "muscle_distribution": muscle_distribution
        }
        recent_workouts_with_stats.append(workout_dict)
    
    # Date du dernier workout (on l'a déjà dans recent_workouts)
    last_workout_date = recent_workouts[0].completed_at.isoformat() if recent_workouts else None
    
    return {
        "total_workouts": total_workouts,
        "total_volume_kg": round(total_volume, 1),
        "last_workout_date": last_workout_date,
        "recent_workouts": recent_workouts_with_stats,
        "average_workout_duration": round(
            sum(w["total_duration_minutes"] for w in recent_workouts_with_stats) / len(recent_workouts_with_stats)
        ) if recent_workouts_with_stats else 0
    }

@app.get("/api/users/{user_id}/progress")
def get_progress_data(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Récupérer les données de progression"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Récupérer l'utilisateur une fois
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    ml_engine = FitnessRecommendationEngine(db)
    
    # Volume par jour - récupérer les données brutes
    workout_sets = db.query(
        func.date(Workout.completed_at).label('date'),
        WorkoutSet,
        Exercise
    ).join(
        WorkoutSet, Workout.id == WorkoutSet.workout_id
    ).join(
        Exercise, WorkoutSet.exercise_id == Exercise.id
    ).filter(
        Workout.user_id == user_id,
        Workout.completed_at >= cutoff_date
    ).all()
    
    # Calculer le volume par date
    volume_by_date = defaultdict(float)
    for date, workout_set, exercise in workout_sets:
        volume = ml_engine.calculate_exercise_volume(
            workout_set.weight, workout_set.reps, exercise, user
        )
        volume_by_date[date] += volume
    
    daily_volume = [
        {"date": str(date), "volume": float(volume)} 
        for date, volume in sorted(volume_by_date.items())
    ]
    
    # Progression par exercice (records) - gérer les bodyweight
    exercise_data = db.query(
        Exercise,
        func.max(WorkoutSet.weight).label('max_weight'),
        func.max(WorkoutSet.reps).label('max_reps')
    ).join(
        WorkoutSet, Exercise.id == WorkoutSet.exercise_id
    ).join(
        Workout, WorkoutSet.workout_id == Workout.id
    ).filter(
        Workout.user_id == user_id,
        Workout.completed_at >= cutoff_date
    ).group_by(Exercise.id).all()
    
    exercise_records = []
    for exercise, max_weight, max_reps in exercise_data:
        record = {
            "name": exercise.name,
            "max_reps": max_reps or 0
        }
        
        # Gérer le poids selon le type d'exercice
        if exercise.weight_type == "bodyweight":
            # Pour bodyweight, calculer le poids équivalent
            percentage = exercise.bodyweight_percentage.get(user.experience_level, 65)
            equivalent_weight = user.weight * (percentage / 100)
            record["max_weight"] = float(equivalent_weight)
            record["is_bodyweight"] = True
        else:
            record["max_weight"] = float(max_weight or 0)
            record["is_bodyweight"] = False
            
        exercise_records.append(record)
    
    return {
        "daily_volume": daily_volume,
        "exercise_records": exercise_records
    }

@app.get("/api/users/{user_id}/stats/progression/{exercise_id}")
def get_exercise_progression(
    user_id: int,
    exercise_id: int,
    months: int = 6,
    db: Session = Depends(get_db)
):
    """Progression adaptée selon le type d'exercice"""
    try:
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=months * 30)
        
        # Récupérer l'exercice pour connaître son type
        exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
        if not exercise:
            raise HTTPException(status_code=404, detail="Exercice non trouvé")
        
        # Utiliser WorkoutSet au lieu de SetHistory si SetHistory n'existe pas
        sets = db.query(WorkoutSet).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).filter(
            Workout.user_id == user_id,
            WorkoutSet.exercise_id == exercise_id,
            WorkoutSet.completed_at >= cutoff_date
        ).order_by(WorkoutSet.completed_at).all()
        
        if not sets:
            return {
                "data": [], 
                "trend": None, 
                "exercise_type": exercise.exercise_type, 
                "weight_type": exercise.weight_type,
                "metric_name": "none"
            }
        
        progression_data = []
        
        # Adapter le calcul selon le type d'exercice
        if exercise.exercise_type == 'isometric':
            # Pour les isométriques : progression de durée
            for s in sets:
                # Utiliser duration_seconds si disponible, sinon reps
                duration = s.duration_seconds if hasattr(s, 'duration_seconds') and s.duration_seconds else (s.reps or 0)
                if duration > 0:  # Ignorer les valeurs nulles
                    progression_data.append({
                        "date": s.completed_at.isoformat(),
                        "value": duration,
                        "unit": "seconds",
                        "fatigue": s.fatigue_level or 3,
                        "effort": s.effort_level or 3
                    })
            metric_name = "duration"
            
        elif exercise.weight_type == 'bodyweight':
            # Pour bodyweight : progression du nombre de reps
            for s in sets:
                if s.reps and s.reps > 0:  # Ignorer les valeurs nulles
                    progression_data.append({
                        "date": s.completed_at.isoformat(),
                        "value": s.reps,
                        "unit": "reps",
                        "fatigue": s.fatigue_level or 3,
                        "effort": s.effort_level or 3
                    })
            metric_name = "reps"
            
        else:
            # Pour les exercices avec poids : 1RM classique
            for s in sets:
                if s.weight and s.reps and s.weight > 0 and s.reps > 0:
                    one_rm = s.weight * (1 + s.reps / 30)
                    progression_data.append({
                        "date": s.completed_at.isoformat(),
                        "value": round(one_rm, 1),
                        "unit": "kg",
                        "weight": s.weight,
                        "reps": s.reps,
                        "fatigue": s.fatigue_level or 3
                    })
            metric_name = "1rm"
        
        # Calculer la tendance seulement s'il y a des données
        trend = None
        if len(progression_data) >= 2:
            values = [p["value"] for p in progression_data]
            trend = calculate_trend(values)
            if trend:
                trend["metric_name"] = metric_name
        
        return {
            "data": progression_data,
            "trend": trend,
            "exercise_type": exercise.exercise_type,
            "weight_type": exercise.weight_type,
            "metric_name": metric_name
        }
        
    except Exception as e:
        # Logger l'erreur pour debug
        print(f"Erreur dans get_exercise_progression: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

def calculate_trend(values):
    """Calcule la tendance linéaire d'une série de valeurs"""
    if len(values) < 2:
        return None
        
    x_values = list(range(len(values)))
    n = len(x_values)
    
    sum_x = sum(x_values)
    sum_y = sum(values)
    sum_xy = sum(x * y for x, y in zip(x_values, values))
    sum_x2 = sum(x * x for x in x_values)
    
    # Éviter la division par zéro
    denominator = n * sum_x2 - sum_x * sum_x
    if denominator == 0:
        return None
    
    slope = (n * sum_xy - sum_x * sum_y) / denominator
    intercept = (sum_y - slope * sum_x) / n
    
    # Calculer le pourcentage de progression
    if values[0] != 0:
        progression_percent = ((values[-1] - values[0]) / values[0]) * 100
    else:
        progression_percent = 0
    
    return {
        "slope": slope,
        "intercept": intercept,
        "progression_percent": round(progression_percent, 1),
        "average_value": sum(values) / len(values)
    }



@app.get("/api/users/{user_id}/stats/personal-records")
def get_personal_records(user_id: int, db: Session = Depends(get_db)):
    """Graphique 4: Records personnels avec contexte"""
    # Sous-requête pour trouver le max weight par exercice
    subquery = db.query(
        SetHistory.exercise_id,
        func.max(SetHistory.weight).label('max_weight')
    ).filter(
        SetHistory.user_id == user_id
    ).group_by(SetHistory.exercise_id).subquery()
    
    # Jointure pour obtenir les détails complets
    records = db.query(
        SetHistory,
        Exercise.name,
        Exercise.muscle_groups,
        Exercise.muscles
    ).join(
        Exercise, SetHistory.exercise_id == Exercise.id
    ).join(
        subquery,
        and_(
            SetHistory.exercise_id == subquery.c.exercise_id,
            SetHistory.weight == subquery.c.max_weight
        )
    ).filter(
        SetHistory.user_id == user_id
    ).all()
    
    result = []
    for record, ex_name, muscle_groups, muscles in records:
        result.append({
            "exercise": ex_name,
            "exerciseId": record.exercise_id,
            "muscleGroups": muscle_groups,
            "muscles": muscles if muscles else [],
            "weight": record.weight,
            "reps": record.actual_reps,
            "date": record.date_performed.isoformat(),
            "fatigue": record.fatigue_level,
            "effort": record.effort_level,
            "daysAgo": int(safe_timedelta_hours(datetime.now(timezone.utc), record.date_performed) / 24)
        })
    
    return sorted(result, key=lambda x: x["weight"], reverse=True)


@app.get("/api/users/{user_id}/stats/attendance-calendar")
def get_attendance_calendar(user_id: int, months: int = 6, db: Session = Depends(get_db)):
    """Graphique 5: Calendrier d'assiduité avec séances manquées - VERSION OPTIMISÉE"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=months * 30)
    
    # OPTIMISATION : Query unique avec jointures pour réduire les requêtes DB
    # Récupérer workouts avec sets et exercises en une seule query
    workouts_with_sets = db.query(
        Workout.id,
        Workout.started_at,
        Workout.total_duration_minutes,
        func.count(WorkoutSet.id).label('total_sets'),
        func.sum(WorkoutSet.weight * WorkoutSet.reps).label('total_volume_simple')
    ).outerjoin(
        WorkoutSet, Workout.id == WorkoutSet.workout_id
    ).filter(
        Workout.user_id == user_id,
        Workout.started_at >= cutoff_date,
        Workout.status == 'completed'  # Seulement les séances terminées
    ).group_by(
        Workout.id, Workout.started_at, Workout.total_duration_minutes
    ).all()
    
    # Récupérer l'engagement utilisateur
    commitment = db.query(UserCommitment).filter(
        UserCommitment.user_id == user_id
    ).first()
    
    target_per_week = commitment.sessions_per_week if commitment else 3
    
    # OPTIMISATION : Calcul simplifié du volume sans ML pour performance
    calendar_data = defaultdict(lambda: {"workouts": 0, "volume": 0, "duration": 0})
    
    for workout_data in workouts_with_sets:
        date_key = workout_data.started_at.date().isoformat()
        calendar_data[date_key]["workouts"] += 1
        
        if workout_data.total_duration_minutes:
            calendar_data[date_key]["duration"] += workout_data.total_duration_minutes
        
        # Volume simplifié (poids × reps) au lieu du calcul ML complexe
        if workout_data.total_volume_simple:
            calendar_data[date_key]["volume"] += float(workout_data.total_volume_simple)
    
    # Identifier les semaines avec séances manquées - INCHANGÉ
    weeks_analysis = []
    current_date = datetime.now(timezone.utc).date()
    
    for week_offset in range(months * 4):
        week_start = current_date - timedelta(days=current_date.weekday() + week_offset * 7)
        week_end = week_start + timedelta(days=6)
        
        # Ne pas compter les semaines avant la création du profil
        user = db.query(User).filter(User.id == user_id).first()
        if user and week_end < user.created_at.date():
            continue
        
        if week_start < cutoff_date.date():
            break
        
        week_workouts = sum(
            1 for date, data in calendar_data.items()
            if week_start <= datetime.fromisoformat(date).date() <= week_end
        )
        
        weeks_analysis.append({
            "weekStart": week_start.isoformat(),
            "workouts": week_workouts,
            "target": target_per_week,
            "missed": max(0, target_per_week - week_workouts) if week_end <= current_date else 0
        })
    
    return {
        "calendar": dict(calendar_data),
        "weeksAnalysis": weeks_analysis,
        "targetPerWeek": target_per_week
    }


# ===== ENDPOINTS PLANNING HEBDOMADAIRE =====
def calculate_optimal_session_spacing(sessions_per_week: int, muscle_groups_per_session: dict) -> list:
    """Calcule l'espacement optimal des séances selon la récupération musculaire"""
    
    # Définir les patterns d'espacement selon fréquence
    spacing_patterns = {
        2: [0, 3],           # Lundi, Jeudi
        3: [0, 2, 4],        # Lundi, Mercredi, Vendredi  
        4: [0, 1, 3, 4],     # Lundi, Mardi, Jeudi, Vendredi
        5: [0, 1, 2, 4, 5],  # Lundi-Mercredi, Vendredi-Samedi
        6: [0, 1, 2, 3, 4, 5] # Tous les jours sauf dimanche
    }
    
    base_pattern = spacing_patterns.get(sessions_per_week, spacing_patterns[3])
    
    # Optimiser selon les groupes musculaires (éviter même muscle 2 jours consécutifs)
    optimized_pattern = []
    for i, day_offset in enumerate(base_pattern):
        # Vérifier conflicts musculaires avec jour précédent
        if i > 0:
            prev_muscles = muscle_groups_per_session.get(i-1, [])
            curr_muscles = muscle_groups_per_session.get(i, [])
            overlap = set(prev_muscles) & set(curr_muscles)
            
            # Si overlap important, décaler d'un jour si possible
            if len(overlap) >= 2 and day_offset < 6:
                day_offset = min(6, day_offset + 1)
        
        optimized_pattern.append(day_offset)
    
    return optimized_pattern

def adapt_session_exercises(exercises: list, user_id: int, session_date: date, db: Session) -> list:
    """Adapte les exercices selon l'historique récent de l'utilisateur"""
    
    # Récupérer les dernières séances (7 derniers jours)
    recent_cutoff = session_date - timedelta(days=7)
    recent_workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.started_at >= recent_cutoff,
        Workout.completed_at.isnot(None)
    ).all()
    
    # Analyser les exercices récents
    recent_exercise_ids = set()
    for workout in recent_workouts:
        if hasattr(workout, 'exercises') and workout.exercises:
            for ex in workout.exercises:
                recent_exercise_ids.add(ex.get('exercise_id'))
    
    adapted_exercises = []
    
    for ex in exercises:
        ex_id = ex.get("exercise_id")
        
        # Si exercice fait récemment, essayer de trouver une alternative
        if ex_id in recent_exercise_ids:
            # UTILISER votre endpoint d'alternatives existant
            try:
                # Récupérer alternatives via la base de données (pas d'API call interne)
                source_exercise = db.query(Exercise).filter(Exercise.id == ex_id).first()
                if source_exercise and source_exercise.muscle_groups:
                    main_muscle = source_exercise.muscle_groups[0]
                    
                    # Chercher alternatives même muscle, non récentes
                    alternatives = db.query(Exercise).filter(
                        Exercise.id != ex_id,
                        cast(Exercise.muscle_groups, JSONB).contains([main_muscle])
                    ).limit(5).all()
                    
                    # Prendre la première alternative non récente
                    for alt in alternatives:
                        if alt.id not in recent_exercise_ids:
                            # Adapter l'exercice avec l'alternative
                            adapted_ex = ex.copy()
                            adapted_ex.update({
                                "exercise_id": alt.id,
                                "exercise_name": alt.name,
                                "muscle_groups": alt.muscle_groups,
                                "adaptation_reason": "Éviter répétition récente"
                            })
                            adapted_exercises.append(adapted_ex)
                            break
                    else:
                        # Aucune alternative trouvée, garder l'original
                        adapted_exercises.append(ex)
                else:
                    adapted_exercises.append(ex)
            except Exception as e:
                logger.warning(f"Erreur alternatives pour exercice {ex_id}: {e}")
                adapted_exercises.append(ex)
        
        # Garder l'exercice original
        adapted_exercises.append(ex)
    
    return adapted_exercises

# PAS BESOIN DE CES FONCTIONS - UTILISER LES EXISTANTES

def extract_primary_muscles(exercises: list) -> list:
    """Extrait les groupes musculaires principaux d'une séance"""
    
    muscle_counts = {}
    
    for ex in exercises:
        muscles = ex.get("muscle_groups", [])
        for muscle in muscles:
            muscle_counts[muscle] = muscle_counts.get(muscle, 0) + 1
    
    # Retourner les muscles les plus représentés
    sorted_muscles = sorted(muscle_counts.items(), key=lambda x: x[1], reverse=True)
    primary_muscles = [muscle for muscle, count in sorted_muscles[:3]]  # Top 3
    
    return primary_muscles


# ===== FONCTIONS HELPER PLANNING =====

def calculate_recovery_warnings(data, muscle_recovery_status=None, session_date=None):
    """
    Calcule les warnings de récupération - Version flexible
    
    Usage 1 (original): calculate_recovery_warnings(day_sessions, muscle_recovery_status, session_date)
    Usage 2 (schedule): calculate_recovery_warnings(muscle_recovery_dict)
    """
    warnings = []
    
    # NOUVEAU USAGE : Dictionnaire muscle -> [dates] depuis schedule
    if muscle_recovery_status is None and session_date is None:
        # data est un dict {"muscle": [date1, date2, ...]}
        muscle_dates = data
        
        for muscle, dates in muscle_dates.items():
            if len(dates) < 2:
                continue  # Pas assez de données pour analyser
                
            # Trier les dates
            sorted_dates = sorted(dates)
            
            # Vérifier l'espacement entre séances consécutives
            for i in range(1, len(sorted_dates)):
                prev_date = sorted_dates[i-1]
                curr_date = sorted_dates[i]
                days_between = (curr_date - prev_date).days
                
                if days_between < 2:  # Moins de 48h
                    hours_between = days_between * 24
                    if hours_between < 48:
                        needed_hours = 48 - hours_between
                        warnings.append(
                            f"{muscle.capitalize()}: seulement {hours_between}h de récupération "
                            f"(recommandé: 48h, manque {needed_hours}h)"
                        )
        
        return warnings
    
    # USAGE ORIGINAL : Analyse d'une journée spécifique
    day_sessions = data  # Premier paramètre est day_sessions
    
    for session in day_sessions:
        if hasattr(session, 'primary_muscles') and session.primary_muscles:
            for muscle in session.primary_muscles:
                if muscle in muscle_recovery_status:
                    recovery_info = muscle_recovery_status[muscle]
                    if recovery_info.get("recovery_level", 1.0) < 0.7:  # <70% récupéré
                        recovery_level = recovery_info.get("recovery_level", 0.5)
                        hours_needed = int((0.7 - recovery_level) * 48)
                        warnings.append(
                            f"{muscle.capitalize()}: {hours_needed}h de récupération recommandées"
                        )
    
    return warnings

@app.get("/api/users/{user_id}/stats/volume-burndown/{period}")
def get_volume_summary(user_id: int, period: str, db: Session = Depends(get_db)):
    """Volume basé sur workouts réels, pas planning"""
    
    days = {"week": 7, "month": 30, "quarter": 90, "year": 365}.get(period, 7)
    start_date = datetime.now() - timedelta(days=days)
    
    # Volume réel des workouts
    workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.created_at >= start_date,
        Workout.status == 'completed'
    ).all()
    
    daily_volumes = defaultdict(int)
    for workout in workouts:
        date = workout.created_at.date()
        daily_volumes[date] += len(workout.sets)
    
    # Format réponse
    cumulative = 0
    daily_data = []
    for date in sorted(daily_volumes.keys()):
        cumulative += daily_volumes[date]
        daily_data.append({
            "date": date.isoformat(),
            "volume": daily_volumes[date],
            "cumulative": cumulative
        })
    
    return {
        "dailyVolumes": daily_data,
        "totalVolume": cumulative,
        "avgDaily": cumulative / days if days > 0 else 0
    }

@app.get("/api/users/{user_id}/stats/muscle-sunburst")
def get_muscle_sunburst(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Graphique 9: Sunburst double couronne muscle_groups/muscles"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Récupérer tous les sets avec exercices
    sets = db.query(
        WorkoutSet,
        Exercise.muscle_groups,
        Exercise.muscles
    ).join(
        Exercise, WorkoutSet.exercise_id == Exercise.id
    ).join(
        Workout, WorkoutSet.workout_id == Workout.id
    ).filter(
        Workout.user_id == user_id,
        Workout.started_at >= cutoff_date
    ).all()
    
    # Organiser les données hiérarchiquement
    muscle_data = defaultdict(lambda: {"volume": 0, "muscles": defaultdict(float)})
    
    for workout_set, muscle_groups, muscles in sets:
            volume = (workout_set.weight or 0) * workout_set.reps
            
            # Distribuer le volume entre les groupes musculaires
            if muscle_groups:
                volume_per_group = volume / len(muscle_groups)
                
                for group in muscle_groups:
                    muscle_data[group]["volume"] += volume_per_group
                    
                    # Si des muscles spécifiques sont définis dans l'exercice
                    if muscles and len(muscles) > 0:
                        # Distribuer le volume aux muscles spécifiques de l'exercice
                        volume_per_muscle = volume_per_group / len(muscles)
                        for muscle in muscles:
                            muscle_data[group]["muscles"][muscle] += volume_per_muscle
                    else:
                        # Si pas de muscles spécifiques, utiliser ceux par défaut du groupe
                        default_muscles = get_muscles_for_group(group)
                        if default_muscles:
                            volume_per_muscle = volume_per_group / len(default_muscles)
                            for muscle in default_muscles:
                                muscle_data[group]["muscles"][muscle] += volume_per_muscle
    
    # Formatter pour le sunburst
    children = []
    for group, data in muscle_data.items():
        group_children = []
        
        # Si des muscles spécifiques sont définis
        if data["muscles"]:
            for muscle, volume in data["muscles"].items():
                if volume > 0:
                    group_children.append({
                        "name": muscle,
                        "value": round(volume)
                    })
        
        # Si pas de muscles spécifiques, utiliser le volume du groupe directement
        if not group_children and data["volume"] > 0:
            # Ne pas créer d'enfant, mettre le volume directement sur le groupe
            children.append({
                "name": group,
                "value": round(data["volume"])
            })
        elif group_children:
            # Il y a des muscles spécifiques, créer la hiérarchie
            children.append({
                "name": group,
                "children": group_children
            })

    result = {
        "name": "Total",
        "children": children
    }

    return result


@app.get("/api/users/{user_id}/stats/recovery-gantt")
def get_recovery_gantt(user_id: int, db: Session = Depends(get_db)):
    """Graphique 10: Gantt de récupération musculaire"""
    # Récupérer la dernière séance pour chaque groupe musculaire
    subquery = db.query(
        Exercise.muscle_groups,
        func.max(Workout.started_at).label('last_workout')
    ).select_from(WorkoutSet).join(
        Exercise, WorkoutSet.exercise_id == Exercise.id
    ).join(
        Workout, WorkoutSet.workout_id == Workout.id
    ).filter(
        Workout.user_id == user_id
    ).group_by(Exercise.muscle_groups).subquery()
    
    # Pour gérer les arrays JSON dans muscle_groups
    muscle_recovery = {}
    now = datetime.now(timezone.utc)
    
    # Récupérer tous les groupes musculaires possibles
    all_muscle_groups = ["dos", "pectoraux", "jambes", "epaules", "bras", "abdominaux"]
    
    for muscle_group in all_muscle_groups:
        # Trouver la dernière séance qui a travaillé ce muscle
        last_workout = db.query(func.max(Workout.started_at)).select_from(
            WorkoutSet
        ).join(
            Exercise, WorkoutSet.exercise_id == Exercise.id
        ).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).filter(
            Workout.user_id == user_id,
            cast(Exercise.muscle_groups, JSONB).contains([muscle_group])
        ).scalar()
        
        if last_workout:
            hours_since = safe_timedelta_hours(now, last_workout)
            recovery_percent = min(100, (hours_since / 72) * 100)
            
            muscle_recovery[muscle_group] = {
                "lastWorkout": last_workout.isoformat(),
                "hoursSince": round(hours_since, 1),
                "recoveryPercent": round(recovery_percent, 0),
                "optimalRest": 72,  # heures
                "status": "recovered" if recovery_percent >= 90 else "recovering" if recovery_percent >= 50 else "fatigued"
            }
        else:
            # Pas d'historique
            muscle_recovery[muscle_group] = {
                "lastWorkout": None,
                "hoursSince": None,
                "recoveryPercent": 100,
                "optimalRest": 72,
                "status": "fresh"
            }
    
    return muscle_recovery

@app.get("/api/users/{user_id}/stats/muscle-volume")
def get_muscle_volume_chart(
    user_id: int, 
    days: int = Query(30, description="Période en jours (7, 30, 90)"),
    db: Session = Depends(get_db)
):
    """Nouvel endpoint : évolution volume par muscle avec sommes glissantes"""
    from datetime import datetime, timezone, timedelta
    
    if days not in [7, 30, 90]:
        raise HTTPException(status_code=400, detail="Période doit être 7, 30 ou 90 jours")
    
    try:
        # Date limite
        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=days)
        
        # Récupérer séries avec volume - requête corrigée
        sets_data = db.query(
            func.date(Workout.started_at).label('workout_date'),
            WorkoutSet.weight,
            WorkoutSet.reps,
            Exercise.muscle_groups
        ).select_from(WorkoutSet).join(
            Exercise, WorkoutSet.exercise_id == Exercise.id
        ).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).filter(
            Workout.user_id == user_id,
            Workout.status == "completed",
            Workout.started_at  >= start_date
        ).all()
        
        if not sets_data:
            return {
                "labels": [],
                "datasets": [],
                "period_days": days
            }
        
        # Muscles standard
        muscles = ["dos", "pectoraux", "jambes", "epaules", "bras", "abdominaux"]
        
        # Grouper par date et muscle
        daily_volumes = {}
        for muscle in muscles:
            daily_volumes[muscle] = {}
        
        for row in sets_data:
            date_str = row.workout_date.isoformat()
            volume = (row.weight or 0) * (row.reps or 0)
            
            # Gestion sécurisée de muscle_groups (peut être JSON ou liste)
            try:
                if isinstance(row.muscle_groups, str):
                    import json
                    muscles_worked = json.loads(row.muscle_groups)
                elif isinstance(row.muscle_groups, list):
                    muscles_worked = row.muscle_groups
                else:
                    muscles_worked = []
            except:
                muscles_worked = []
            
            # Distribuer volume
            if muscles_worked:
                volume_per_muscle = volume / len(muscles_worked)
                for muscle in muscles_worked:
                    muscle_key = muscle.lower()
                    if muscle_key in daily_volumes:
                        if date_str not in daily_volumes[muscle_key]:
                            daily_volumes[muscle_key][date_str] = 0
                        daily_volumes[muscle_key][date_str] += volume_per_muscle
        
        # Créer série temporelle COMPLÈTE sur toute la période
        from datetime import date as date_class
        current_date = start_date.date()
        end_date_only = end_date.date()
        all_dates = []

        while current_date <= end_date_only:
            all_dates.append(current_date.isoformat())
            current_date += timedelta(days=1)

        print(f"📊 Série temporelle générée: {len(all_dates)} jours de {all_dates[0]} à {all_dates[-1]}")
        
        if not all_dates:
            return {
                "labels": [],
                "datasets": [],
                "period_days": days
            }
        
        # Datasets pour chart
        datasets = []
        for muscle in muscles:
            # Sommes glissantes
            rolling_sums = []
            for i, date_str in enumerate(all_dates):
                # Fenêtre glissante : prendre les N derniers jours jusqu'à cette date
                window_start = max(0, i - days + 1)
                window_dates = all_dates[window_start:i + 1]
                window_sum = sum(daily_volumes[muscle].get(d, 0) for d in window_dates)
                rolling_sums.append(round(window_sum))
            
            datasets.append({
                "label": muscle.capitalize(),
                "data": rolling_sums
            })
        
        # Labels lisibles - afficher 1 date sur N pour éviter surcharge
        if len(all_dates) <= 7:
            step = 1  # Afficher toutes les dates pour 7 jours
        elif len(all_dates) <= 30:
            step = 3  # Afficher 1 date sur 3 pour 30 jours
        else:
            step = 7  # Afficher 1 date sur 7 pour 90 jours

        labels = [all_dates[i] if i % step == 0 else "" for i in range(len(all_dates))]
        
        return {
            "labels": labels,
            "datasets": datasets,
            "period_days": days
        }
        
    except Exception as e:
        logger.error(f"Erreur muscle volume chart user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur calcul: {str(e)}")
    
@app.get("/api/users/{user_id}/stats/muscle-balance")
def get_muscle_balance(user_id: int, db: Session = Depends(get_db)):
    """Graphique 11: Spider chart équilibre musculaire"""
    # Récupérer les targets adaptatifs
    targets = db.query(AdaptiveTargets).filter(
        AdaptiveTargets.user_id == user_id
    ).all()
    
    # Si pas de targets, calculer les volumes actuels depuis les séances
    if not targets:
        # Calculer le volume par muscle sur les 30 derniers jours
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=30)
        
        muscle_volumes = defaultdict(float)
        
        # Récupérer tous les sets
        sets = db.query(
            WorkoutSet,
            Exercise.muscle_groups
        ).join(
            Exercise, WorkoutSet.exercise_id == Exercise.id
        ).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).filter(
            Workout.user_id == user_id,
            Workout.started_at >= cutoff_date,
            Workout.status == "completed"
        ).all()
        
        # Calculer le volume par muscle
        for workout_set, muscle_groups in sets:
            volume = (workout_set.weight or 0) * workout_set.reps
            if muscle_groups:
                volume_per_group = volume / len(muscle_groups)
                for muscle in muscle_groups:
                    muscle_volumes[muscle] += volume_per_group
        
        # Créer une réponse avec les vrais volumes
        muscles = ["dos", "pectoraux", "jambes", "epaules", "bras", "abdominaux"]
        current_volumes = [muscle_volumes.get(m, 0) for m in muscles]
        
        # Calculer un target "équilibré" basé sur la moyenne
        total_volume = sum(current_volumes)
        avg_volume = total_volume / 6 if total_volume > 0 else 5000
        target_volumes = [avg_volume] * 6
        
        # Calculer les ratios
        ratios = []
        for current, target in zip(current_volumes, target_volumes):
            if target > 0:
                ratios.append(round((current / target) * 100, 1))
            else:
                ratios.append(0)
        
        return {
            "muscles": muscles,
            "targetVolumes": target_volumes,
            "currentVolumes": current_volumes,
            "ratios": ratios,
            "recoveryDebts": [0] * 6
        }


@app.get("/api/users/{user_id}/stats/ml-confidence")
def get_ml_confidence_evolution(user_id: int, days: int = 60, db: Session = Depends(get_db)):
    """Graphique 14: Evolution de la confiance ML"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    sets = db.query(WorkoutSet).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= cutoff_date,
        WorkoutSet.ml_confidence.isnot(None)
    ).order_by(WorkoutSet.completed_at).all()
    
    if not sets:
        return {"data": [], "averageConfidence": 0, "trend": "stable"}
    
    confidence_data = []
    for s in sets:
        confidence_data.append({
            "date": s.completed_at.isoformat(),
            "confidence": s.ml_confidence,
            "followedWeight": s.user_followed_ml_weight,
            "followedReps": s.user_followed_ml_reps,
            "success": s.reps >= (s.target_reps or s.reps)
        })
    
    # Calculer la tendance
    recent_avg = sum(d["confidence"] for d in confidence_data[-10:]) / min(10, len(confidence_data))
    older_avg = sum(d["confidence"] for d in confidence_data[:10]) / min(10, len(confidence_data))
    
    if recent_avg > older_avg * 1.1:
        trend = "improving"
    elif recent_avg < older_avg * 0.9:
        trend = "declining"
    else:
        trend = "stable"
    
    return {
        "data": confidence_data,
        "averageConfidence": sum(d["confidence"] for d in confidence_data) / len(confidence_data),
        "followRate": sum(1 for d in confidence_data if d["followedWeight"] and d["followedReps"]) / len(confidence_data),
        "trend": trend
    }


@app.get("/api/users/{user_id}/stats/ml-adjustments-flow")
def get_ml_adjustments_flow(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Graphique 15: Sankey des ajustements ML"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    sets = db.query(WorkoutSet).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= cutoff_date,
        WorkoutSet.ml_weight_suggestion.isnot(None)
    ).all()
    
    if not sets:
        return {"nodes": [], "links": []}
    
    # Analyser les flux
    flows = {
        "suggested_accepted": 0,
        "suggested_modified_up": 0,
        "suggested_modified_down": 0,
        "accepted_success": 0,
        "accepted_failure": 0,
        "modified_success": 0,
        "modified_failure": 0
    }
    
    for s in sets:
        if s.user_followed_ml_weight:
            flows["suggested_accepted"] += 1
            if s.reps >= (s.target_reps or s.reps):
                flows["accepted_success"] += 1
            else:
                flows["accepted_failure"] += 1
        else:
            if s.weight > s.ml_weight_suggestion:
                flows["suggested_modified_up"] += 1
            else:
                flows["suggested_modified_down"] += 1
            
            if s.reps >= (s.target_reps or s.reps):
                flows["modified_success"] += 1
            else:
                flows["modified_failure"] += 1
    
    # Formatter pour Sankey
    nodes = [
        {"name": "Suggestions ML"},
        {"name": "Acceptées"},
        {"name": "Modifiées +"},
        {"name": "Modifiées -"},
        {"name": "Succès"},
        {"name": "Échec"}
    ]
    
    links = []
    if flows["suggested_accepted"] > 0:
        links.append({"source": 0, "target": 1, "value": flows["suggested_accepted"]})
    if flows["suggested_modified_up"] > 0:
        links.append({"source": 0, "target": 2, "value": flows["suggested_modified_up"]})
    if flows["suggested_modified_down"] > 0:
        links.append({"source": 0, "target": 3, "value": flows["suggested_modified_down"]})
    if flows["accepted_success"] > 0:
        links.append({"source": 1, "target": 4, "value": flows["accepted_success"]})
    if flows["accepted_failure"] > 0:
        links.append({"source": 1, "target": 5, "value": flows["accepted_failure"]})
    if flows["modified_success"] > 0:
        links.append({"source": 2, "target": 4, "value": flows["modified_success"] // 2})
        links.append({"source": 3, "target": 4, "value": flows["modified_success"] // 2})
    if flows["modified_failure"] > 0:
        links.append({"source": 2, "target": 5, "value": flows["modified_failure"] // 2})
        links.append({"source": 3, "target": 5, "value": flows["modified_failure"] // 2})
    
    return {"nodes": nodes, "links": links}


@app.get("/api/users/{user_id}/stats/time-distribution")
def get_time_distribution(user_id: int, sessions: int = 10, db: Session = Depends(get_db)):
    """Graphique 18: Distribution du temps par séance"""
    workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "completed",
        Workout.total_duration_minutes.isnot(None)
    ).order_by(Workout.completed_at.desc()).limit(sessions).all()
    
    if not workouts:
        return {"sessions": []}
    
    session_data = []
    for workout in workouts:
        sets = db.query(WorkoutSet).filter(
            WorkoutSet.workout_id == workout.id
        ).all()
        
        # Calculer les temps
        total_exercise_time = sum(s.duration_seconds or 0 for s in sets)
        total_rest_time = sum(s.actual_rest_duration_seconds or s.base_rest_time_seconds or 0 for s in sets)
        total_duration_seconds = workout.total_duration_minutes * 60
        transition_time = max(0, total_duration_seconds - total_exercise_time - total_rest_time)
        
        session_data.append({
            "date": workout.started_at.isoformat(),
            "totalMinutes": workout.total_duration_minutes,
            "exerciseTime": round(total_exercise_time / 60, 1),
            "restTime": round(total_rest_time / 60, 1),
            "transitionTime": round(transition_time / 60, 1),
            "setsCount": len(sets)
        })
    
    return {"sessions": session_data}

@app.get("/api/users/{user_id}/stats/workout-intensity-recovery")
def get_workout_intensity_recovery(user_id: int, sessions: int = 50, db: Session = Depends(get_db)):
    """Version corrigée - TOUT EN SECONDES"""
    
    # Requête SQL - tout en secondes
    query = """
    WITH session_stats AS (
        SELECT 
            w.id,
            w.completed_at,
            -- Durée totale en secondes
            COALESCE(w.total_duration_minutes * 60, 0) as total_duration_seconds,
            -- Repos total en secondes
            COALESCE(w.total_rest_time_seconds, 0) as stored_rest_seconds,
            -- Calculer les temps réels à partir des sets
            SUM(COALESCE(ws.duration_seconds, 0)) as exercise_seconds,
            SUM(COALESCE(ws.actual_rest_duration_seconds, ws.base_rest_time_seconds, 0)) as calculated_rest_seconds,
            -- Volume total
            SUM(
                CASE 
                    WHEN e.exercise_type = 'isometric' THEN 
                        COALESCE(ws.reps, 0) * 20 * COALESCE(e.intensity_factor, 1.0)
                    WHEN e.weight_type = 'bodyweight' THEN 
                        :user_weight * 0.65 * COALESCE(ws.reps, 0) * COALESCE(e.intensity_factor, 1.0)
                    ELSE 
                        COALESCE(ws.weight, 0) * COALESCE(ws.reps, 0) * COALESCE(e.intensity_factor, 1.0)
                END
            ) as total_volume
        FROM workouts w
        JOIN workout_sets ws ON w.id = ws.workout_id
        JOIN exercises e ON ws.exercise_id = e.id
        WHERE w.user_id = :user_id 
            AND w.status = 'completed'
            AND w.total_duration_minutes IS NOT NULL
        GROUP BY w.id, w.completed_at, w.total_duration_minutes, w.total_rest_time_seconds
        ORDER BY w.completed_at DESC
        LIMIT :limit_sessions
    )
    SELECT 
        *,
        -- Durée effective en secondes (priorité aux données calculées si plus fiables)
        CASE 
            WHEN total_duration_seconds > 0 THEN total_duration_seconds
            ELSE GREATEST(60, exercise_seconds + calculated_rest_seconds)
        END as effective_duration_seconds,
        -- Repos effectif en secondes
        CASE 
            WHEN stored_rest_seconds > 0 THEN stored_rest_seconds
            ELSE calculated_rest_seconds
        END as effective_rest_seconds,
        EXTRACT(DAYS FROM (NOW() - completed_at)) as days_ago
    FROM session_stats
    WHERE total_volume > 0
    """
    
    # Récupérer le poids utilisateur
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Exécuter la requête
    result = db.execute(text(query), {
        "user_id": user_id, 
        "user_weight": user.weight,
        "limit_sessions": sessions
    }).fetchall()
    
    if not result:
        return {"sessions": []}
    
    # Calculs TOUT EN SECONDES
    sessions_data = []
    charges = []
    ratios = []
    
    for row in result:
        duration_sec = row.effective_duration_seconds
        rest_sec = row.effective_rest_seconds
        volume = row.total_volume
        
        # Charge = points de volume par SECONDE
        charge = round(volume / max(1, duration_sec), 4)
        
        # Ratio = secondes de repos par point de volume
        ratio = round(rest_sec / max(1, volume), 6)
        
        charges.append(charge)
        ratios.append(ratio)
        
        sessions_data.append({
            "date": row.completed_at.isoformat(),
            "charge": charge,  # points/seconde
            "ratio": ratio,    # secondes_repos/point
            "total_volume": round(volume, 1),
            "total_duration_minutes": round(duration_sec / 60, 1),  # Juste pour affichage
            "total_rest_minutes": round(rest_sec / 60, 1),          # Juste pour affichage
            "days_ago": int(row.days_ago),
            # Debug en secondes
            "debug_seconds": {
                "duration_sec": duration_sec,
                "rest_sec": rest_sec,
                "exercise_sec": row.exercise_seconds,
                "original_duration_sec": row.total_duration_seconds
            }
        })
    
    # Médianes
    median_charge = sorted(charges)[len(charges) // 2] if charges else 0
    median_ratio = sorted(ratios)[len(ratios) // 2] if ratios else 0
    
    return {
        "sessions": sessions_data,
        "medians": {
            "charge": round(median_charge, 4),
            "ratio": round(median_ratio, 6)
        }
    }

# ===== ENDPOINTS ML ANALYTICS =====

@app.get("/api/users/{user_id}/stats/ml-insights")
def get_ml_insights_overview(user_id: int, days: int = 90, db: Session = Depends(get_db)):
    """Dashboard principal ML Analytics"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

    def normalize_datetime_for_comparison(dt):
        """Normalise les datetime pour comparaison en ajoutant UTC si nécessaire"""
        if dt and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    
    cutoff_date_naive = cutoff_date.replace(tzinfo=None) if cutoff_date.tzinfo else cutoff_date

    # Récupérer toutes les séries avec données potentielles
    all_sets = db.query(WorkoutSet).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= cutoff_date_naive
    ).order_by(WorkoutSet.completed_at).all()
    
    if not all_sets:
        return {"error": "Aucune donnée disponible"}
    
    # Analyser les données ML disponibles
    sets_with_ml = [s for s in all_sets if s.ml_confidence is not None]
    sets_with_fatigue = [s for s in all_sets if s.fatigue_level is not None]
    sets_with_effort = [s for s in all_sets if s.effort_level is not None]
    sets_with_ml_suggestions = [s for s in all_sets if s.ml_weight_suggestion is not None or s.ml_reps_suggestion is not None]
    
    total_sessions = len(set(s.workout_id for s in all_sets))
    ml_active_sessions = len(set(s.workout_id for s in sets_with_ml))
    
    # Calcul de métriques d'engagement
    avg_fatigue = sum(s.fatigue_level for s in sets_with_fatigue) / len(sets_with_fatigue) if sets_with_fatigue else 0
    avg_effort = sum(s.effort_level for s in sets_with_effort) / len(sets_with_effort) if sets_with_effort else 0
    
    # Analyse du suivi des recommandations
    follow_rate_weight = 0
    follow_rate_reps = 0
    
    if sets_with_ml_suggestions:
        followed_weight = sum(1 for s in sets_with_ml_suggestions if s.user_followed_ml_weight)
        followed_reps = sum(1 for s in sets_with_ml_suggestions if s.user_followed_ml_reps)
        follow_rate_weight = followed_weight / len(sets_with_ml_suggestions)
        follow_rate_reps = followed_reps / len(sets_with_ml_suggestions)
    
    # Tendance de confiance
    confidence_trend = "stable"
    if len(sets_with_ml) >= 10:
        recent_confidence = sum(s.ml_confidence for s in sets_with_ml[-5:]) / 5
        older_confidence = sum(s.ml_confidence for s in sets_with_ml[:5]) / 5
        
        if recent_confidence > older_confidence * 1.1:
            confidence_trend = "improving"
        elif recent_confidence < older_confidence * 0.9:
            confidence_trend = "declining"
    
    cutoff_7_days_naive = (datetime.now(timezone.utc) - timedelta(days=7)).replace(tzinfo=None)

    return {
        "overview": {
            "total_sets": len(all_sets),
            "total_sessions": total_sessions,
            "ml_active_sessions": ml_active_sessions,
            "ml_adoption_rate": ml_active_sessions / total_sessions if total_sessions > 0 else 0,
            "data_quality_score": len(sets_with_fatigue) / len(all_sets) if all_sets else 0,
            "avg_fatigue": round(avg_fatigue, 1),
            "avg_effort": round(avg_effort, 1)
        },
        "ml_performance": {
            "sets_with_recommendations": len(sets_with_ml_suggestions),
            "follow_rate_weight": round(follow_rate_weight, 2),
            "follow_rate_reps": round(follow_rate_reps, 2),
            "avg_confidence": round(sum(s.ml_confidence for s in sets_with_ml) / len(sets_with_ml), 2) if sets_with_ml else 0,
            "confidence_trend": confidence_trend
        },
        "recent_activity": {
            "last_7_days": len([s for s in all_sets if s.completed_at >= cutoff_7_days_naive]),
            "ml_active_last_7": len([s for s in sets_with_ml if s.completed_at >= cutoff_7_days_naive])
        }
    }


@app.get("/api/users/{user_id}/stats/ml-progression")
def get_ml_progression_analysis(user_id: int, days: int = 60, db: Session = Depends(get_db)):
    """Analyse de progression avec/sans ML"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Récupérer les exercices avec suffisamment de données
    sets_query = db.query(WorkoutSet).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= cutoff_date,
        WorkoutSet.weight.isnot(None),
        WorkoutSet.reps.isnot(None)
    ).order_by(WorkoutSet.completed_at)
    
    all_sets = sets_query.all()
    
    if len(all_sets) < 10:
        return {"error": "Données insuffisantes pour l'analyse"}
    
    # Grouper par exercice
    exercises_data = {}
    for s in all_sets:
        if s.exercise_id not in exercises_data:
            exercises_data[s.exercise_id] = {
                "with_ml": [],
                "without_ml": [],
                "exercise_name": None
            }
        
        # Calculer le volume (poids * reps)
        volume = (s.weight or 0) * s.reps
        set_data = {
            "date": s.completed_at,
            "volume": volume,
            "weight": s.weight,
            "reps": s.reps,
            "confidence": s.ml_confidence or 0
        }
        
        if s.ml_confidence is not None and s.ml_confidence > 0.3:
            exercises_data[s.exercise_id]["with_ml"].append(set_data)
        else:
            exercises_data[s.exercise_id]["without_ml"].append(set_data)
    
    # Analyser la progression pour chaque exercice
    progression_analysis = []
    
    for exercise_id, data in exercises_data.items():
        if len(data["with_ml"]) >= 3 and len(data["without_ml"]) >= 3:
            # Calculer les tendances
            ml_volumes = [d["volume"] for d in data["with_ml"]]
            no_ml_volumes = [d["volume"] for d in data["without_ml"]]
            
            ml_avg = sum(ml_volumes) / len(ml_volumes)
            no_ml_avg = sum(no_ml_volumes) / len(no_ml_volumes)
            
            # Récupérer le nom de l'exercice
            exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
            
            progression_analysis.append({
                "exercise_id": exercise_id,
                "exercise_name": exercise.name if exercise else f"Exercice {exercise_id}",
                "ml_sessions": len(data["with_ml"]),
                "traditional_sessions": len(data["without_ml"]),
                "ml_avg_volume": round(ml_avg, 1),
                "traditional_avg_volume": round(no_ml_avg, 1),
                "improvement_ratio": round(ml_avg / no_ml_avg, 2) if no_ml_avg > 0 else 1,
                "confidence_evolution": data["with_ml"][-5:] if len(data["with_ml"]) >= 5 else data["with_ml"]
            })
    
    # Trier par amélioration
    progression_analysis.sort(key=lambda x: x["improvement_ratio"], reverse=True)
    
    return {
        "exercises": progression_analysis[:10],  # Top 10
        "summary": {
            "total_analyzed": len(progression_analysis),
            "avg_improvement": round(sum(e["improvement_ratio"] for e in progression_analysis) / len(progression_analysis), 2) if progression_analysis else 1,
            "best_exercise": progression_analysis[0] if progression_analysis else None
        }
    }


@app.get("/api/users/{user_id}/stats/ml-recommendations-accuracy")
def get_ml_recommendations_accuracy(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Analyse de précision des recommandations ML"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    sets = db.query(WorkoutSet).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= cutoff_date,
        WorkoutSet.ml_weight_suggestion.isnot(None),
        WorkoutSet.weight.isnot(None)
    ).order_by(WorkoutSet.completed_at).all()
    
    if not sets:
        return {"error": "Aucune recommandation ML trouvée"}
    
    accuracy_data = []
    weight_diffs = []
    reps_diffs = []
    
    for s in sets:
        weight_diff = 0
        reps_diff = 0
        
        if s.ml_weight_suggestion and s.weight:
            weight_diff = abs(s.weight - s.ml_weight_suggestion)
            weight_diffs.append(weight_diff)
        
        if s.ml_reps_suggestion and s.reps:
            reps_diff = abs(s.reps - s.ml_reps_suggestion)
            reps_diffs.append(reps_diff)
        
        accuracy_data.append({
            "date": s.completed_at.isoformat(),
            "weight_suggested": s.ml_weight_suggestion,
            "weight_actual": s.weight,
            "weight_diff": round(weight_diff, 1),
            "reps_suggested": s.ml_reps_suggestion,
            "reps_actual": s.reps,
            "reps_diff": reps_diff,
            "confidence": s.ml_confidence or 0,
            "followed_weight": s.user_followed_ml_weight,
            "followed_reps": s.user_followed_ml_reps
        })
    
    # Calculer les métriques de précision
    avg_weight_diff = sum(weight_diffs) / len(weight_diffs) if weight_diffs else 0
    avg_reps_diff = sum(reps_diffs) / len(reps_diffs) if reps_diffs else 0
    
    # Précision (pourcentage de recommandations "proches")
    weight_precision = len([d for d in weight_diffs if d <= 2.5]) / len(weight_diffs) if weight_diffs else 0
    reps_precision = len([d for d in reps_diffs if d <= 1]) / len(reps_diffs) if reps_diffs else 0
    
    return {
        "accuracy_timeline": accuracy_data,
        "metrics": {
            "total_recommendations": len(accuracy_data),
            "avg_weight_deviation": round(avg_weight_diff, 1),
            "avg_reps_deviation": round(avg_reps_diff, 1),
            "weight_precision_rate": round(weight_precision, 2),
            "reps_precision_rate": round(reps_precision, 2),
            "overall_follow_rate": round(len([d for d in accuracy_data if d["followed_weight"]]) / len(accuracy_data), 2) if accuracy_data else 0
        }
    }


@app.get("/api/users/{user_id}/stats/ml-exercise-patterns")
def get_ml_exercise_patterns(user_id: int, days: int = 60, db: Session = Depends(get_db)):
    """Patterns d'utilisation ML par exercice"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Requête optimisée avec jointures
    sets = db.query(WorkoutSet, Exercise.name).join(Workout).join(Exercise).filter(
        Workout.user_id == user_id,
        WorkoutSet.completed_at >= cutoff_date
    ).all()
    
    if not sets:
        return {"error": "Aucune donnée disponible"}
    
    # Grouper par exercice
    exercise_patterns = {}
    
    for workout_set, exercise_name in sets:
        if exercise_name not in exercise_patterns:
            exercise_patterns[exercise_name] = {
                "total_sets": 0,
                "ml_sets": 0,
                "avg_confidence": 0,
                "confidence_values": [],
                "follow_rate": 0,
                "followed_count": 0,
                "last_used": None,
                "volume_progression": []
            }
        
        pattern = exercise_patterns[exercise_name]
        pattern["total_sets"] += 1
        pattern["last_used"] = max(pattern["last_used"] or workout_set.completed_at, workout_set.completed_at)
        
        if workout_set.ml_confidence is not None:
            pattern["ml_sets"] += 1
            pattern["confidence_values"].append(workout_set.ml_confidence)
        
        if workout_set.user_followed_ml_weight or workout_set.user_followed_ml_reps:
            pattern["followed_count"] += 1
        
        # Calculer le volume pour la progression
        if workout_set.weight and workout_set.reps:
            volume = workout_set.weight * workout_set.reps
            pattern["volume_progression"].append({
                "date": workout_set.completed_at.isoformat(),
                "volume": volume,
                "has_ml": workout_set.ml_confidence is not None
            })
    
    # Finaliser les calculs
    for exercise_name, pattern in exercise_patterns.items():
        if pattern["confidence_values"]:
            pattern["avg_confidence"] = sum(pattern["confidence_values"]) / len(pattern["confidence_values"])
        
        if pattern["ml_sets"] > 0:
            pattern["follow_rate"] = pattern["followed_count"] / pattern["ml_sets"]
        
        pattern["ml_adoption_rate"] = pattern["ml_sets"] / pattern["total_sets"]
        
        # Nettoyer pour la sérialisation
        del pattern["confidence_values"]
        pattern["last_used"] = pattern["last_used"].isoformat() if pattern["last_used"] else None
    
    # Trier par utilisation ML
    sorted_patterns = sorted(
        [(name, data) for name, data in exercise_patterns.items()],
        key=lambda x: x[1]["ml_adoption_rate"],
        reverse=True
    )
    
    return {
        "exercise_patterns": dict(sorted_patterns[:15]),  # Top 15
        "summary": {
            "total_exercises": len(exercise_patterns),
            "avg_ml_adoption": round(sum(p["ml_adoption_rate"] for p in exercise_patterns.values()) / len(exercise_patterns), 2),
            "most_ml_friendly": sorted_patterns[0][0] if sorted_patterns else None,
            "total_ml_sets": sum(p["ml_sets"] for p in exercise_patterns.values())
        }
    }


# ===== / ENDPOINTS ML ANALYTICS (fin) =====

# Helper function à ajouter
def get_muscles_for_group(muscle_group: str) -> List[str]:
    """Retourne les muscles spécifiques d'un groupe musculaire"""
    mapping = {
        "dos": ["trapezes", "grand-dorsal", "lombaires"],
        "pectoraux": ["pectoraux-superieurs", "pectoraux-inferieurs"],
        "jambes": ["quadriceps", "ischio-jambiers", "fessiers", "mollets"],
        "epaules": ["deltoides-anterieurs", "deltoides-lateraux", "deltoides-posterieurs"],
        "bras": ["biceps", "triceps"],
        "abdominaux": ["abdominaux", "obliques"]
    }
    return mapping.get(muscle_group, []) 

# ===== CALCULS POIDS DISPONIBLES =====

@app.get("/api/users/{user_id}/available-weights")
def get_available_weights(user_id: int, exercise_id: int = Query(None), db: Session = Depends(get_db)):
    """Utilise le service d'équipement unifié avec support exercice spécifique"""
    from backend.equipment_service import EquipmentService
    
    try:
        exercise = None
        if exercise_id:
            exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
        
        weights = EquipmentService.get_available_weights(db, user_id, exercise)
        return {"available_weights": weights}
    except Exception as e:
        logger.error(f"Erreur calcul poids user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Erreur calcul des poids")

@app.get("/api/users/{user_id}/plate-layout/{weight}")
def get_plate_layout(user_id: int, weight: float, exercise_id: int = Query(None), db: Session = Depends(get_db)):
    """Version corrigée avec validation équipement et compatibilité nouveaux équipements"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.equipment_config:
        raise HTTPException(status_code=400, detail="Configuration manquante")
   
    # 1. Déterminer équipement depuis l'exercice
    exercise_equipment = ['barbell']  # fallback par défaut
    exercise = None
    
    if exercise_id:
        exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
        if exercise and exercise.equipment_required:
            exercise_equipment = exercise.equipment_required

    # 2. VALIDATION CRITIQUE : Équipements compatibles avec layout de disques
    PLATE_COMPATIBLE_EQUIPMENT = [
        'barbell', 'barbell_athletic', 'barbell_ez', 
        'dumbbells', 'barbell_short_pair'
    ]
    
    has_plate_equipment = any(eq in PLATE_COMPATIBLE_EQUIPMENT for eq in exercise_equipment)
    
    if not has_plate_equipment:
        return {
            'feasible': False,
            'reason': f'Cet exercice utilise {", ".join(exercise_equipment)} qui ne nécessite pas de layout de disques',
            'type': 'no_plates_needed',
            'equipment_type': exercise_equipment[0] if exercise_equipment else 'unknown'
        }

    # 3. Validation poids pair pour dumbbells (APRÈS avoir déterminé l'équipement)
    if 'dumbbells' in exercise_equipment and weight % 2 != 0:
        return {
            'feasible': False,
            'reason': f'Poids impair ({weight}kg) impossible avec des haltères. Utilisez {int(weight/2)*2}kg ou {int(weight/2)*2+2}kg.',
            'type': 'odd_weight_error',
            'suggested_weights': [int(weight/2)*2, int(weight/2)*2+2]
        }
    
    try:
        # 4. Vérifier d'abord si ce poids est réalisable
        available_weights = EquipmentService.get_available_weights(db, user_id, exercise)
       
        if weight not in available_weights:
            # Retourner une erreur claire avec suggestions
            if available_weights:
                closest = min(available_weights, key=lambda x: abs(x - weight))
                nearby_weights = sorted([w for w in available_weights if abs(w - weight) < 10])
            else:
                closest = weight
                nearby_weights = []
            
            return {
                'feasible': False,
                'reason': f'{weight}kg non réalisable avec votre équipement',
                'closest_weight': closest,
                'suggested_weights': nearby_weights[:5],  # Limiter à 5 suggestions
                'type': 'weight_unavailable'
            }
       
        # 5. Calculer le layout effectif
        layout = EquipmentService.get_plate_layout(user_id, weight, exercise_equipment, user.equipment_config)
        return layout
   
    except Exception as e:
        logger.error(f"Erreur layout user {user_id}, exercice {exercise_id}, poids {weight}, equipment {exercise_equipment}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur calcul layout: {str(e)}")

# Dans backend/main.py - AJOUTER après vos endpoints existants

# ===== ENDPOINTS IA GÉNÉRATION EXERCICES =====

@app.post("/api/ai/generate-exercises")
def generate_ai_exercises(request: GenerateExercisesRequest, db: Session = Depends(get_db)):
    """Génère une séance d'exercices basée sur l'IA avec scoring ML intégré"""
    
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Extraire les paramètres - CORRECTIF : accès direct aux attributs Pydantic
    generation_params = request.params if request.params else AIGenerationParams()
    
    # Accès direct aux attributs (pas de .get())
    ppl_override = generation_params.ppl_override
    exploration_factor = generation_params.exploration_factor
    target_exercise_count = generation_params.target_exercise_count
    manual_muscle_focus = generation_params.manual_muscle_focus
    randomness_seed = generation_params.randomness_seed
    
    # Si seed fourni, initialiser random
    if randomness_seed:
        random.seed(randomness_seed)
    
    # Obtenir la recommandation PPL
    ppl_recommendation_response = get_ppl_recommendation(user.id, db)
    ppl_recommendation = ppl_recommendation_response.get("recommendation", {})
    recovery_score = ppl_recommendation.get("recovery_score", 0.5)
    
    # Déterminer le PPL à utiliser
    if ppl_override and ppl_override.lower() != "auto":
        ppl_used = ppl_override.lower()
    else:
        ppl_used = ppl_recommendation.get("category", "push")
    
    # Filtrer les exercices par PPL et équipement disponible
    user_equipment = get_user_equipment(db, user.id)
    
    query = db.query(Exercise).filter(
        Exercise.ppl.contains([ppl_used])
    )
    
    # Filtre équipement
    if user_equipment:
        equipment_conditions = []
        for eq in user_equipment:
            equipment_conditions.append(Exercise.equipment_required.contains([eq]))
        query = query.filter(or_(*equipment_conditions))
    
    # Filtre muscles si spécifié
    if manual_muscle_focus:
        muscle_conditions = []
        for muscle in manual_muscle_focus:
            muscle_conditions.append(Exercise.muscle_groups.contains([muscle]))
        query = query.filter(or_(*muscle_conditions))
    
    available_exercises = query.all()
    
    if len(available_exercises) < target_exercise_count:
        # Fallback : élargir les critères
        available_exercises = db.query(Exercise).filter(
            Exercise.ppl.contains([ppl_used])
        ).limit(target_exercise_count * 2).all()
    
    # Séparer exercices connus et nouveaux
    exercise_history = db.query(WorkoutSet.exercise_id, func.count(WorkoutSet.id).label('count'))\
        .join(Workout).filter(Workout.user_id == user.id)\
        .group_by(WorkoutSet.exercise_id).all()
    
    known_exercise_ids = {eh.exercise_id for eh in exercise_history}
    
    known_exercises = [ex for ex in available_exercises if ex.id in known_exercise_ids]
    new_exercises = [ex for ex in available_exercises if ex.id not in known_exercise_ids]
    
    # Sélection avec exploration
    selected_exercises = []
    
    # Nombre d'exercices connus vs nouveaux basé sur exploration_factor
    n_known = int(target_exercise_count * (1 - exploration_factor))
    n_new = target_exercise_count - n_known
    
    # Sélectionner exercices connus (favoris)
    if known_exercises:
        weights = [next((eh.count for eh in exercise_history if eh.exercise_id == ex.id), 1) 
                  for ex in known_exercises]
        selected_known = random.choices(known_exercises, weights=weights, 
                                      k=min(n_known, len(known_exercises)))
        selected_exercises.extend(selected_known)
    
    # Compléter avec nouveaux exercices
    if new_exercises:
        n_to_select = target_exercise_count - len(selected_exercises)
        selected_new = random.sample(new_exercises, 
                                   k=min(n_to_select, len(new_exercises)))
        selected_exercises.extend(selected_new)
    
    # Si pas assez d'exercices, compléter avec n'importe quoi
    if len(selected_exercises) < target_exercise_count:
        remaining = target_exercise_count - len(selected_exercises)
        fallback_exercises = random.sample(available_exercises, 
                                         k=min(remaining, len(available_exercises)))
        selected_exercises.extend(fallback_exercises)
    
    # Ordonner les exercices intelligemment
    # 1. Composés d'abord
    # 2. Isolation ensuite
    # 3. Mélanger pour éviter fatigue excessive d'un groupe
    compound_exercises = [ex for ex in selected_exercises if ex.is_compound]
    isolation_exercises = [ex for ex in selected_exercises if not ex.is_compound]
    
    ordered_exercises = []
    if compound_exercises:
        ordered_exercises.extend(compound_exercises[:2])  # Max 2 composés au début
    
    # Alterner les groupes musculaires restants
    remaining = compound_exercises[2:] + isolation_exercises
    random.shuffle(remaining)
    ordered_exercises.extend(remaining)
    
    # Construire la réponse avec métadonnées
    selected_exercises_with_metadata = []
    for idx, exercise in enumerate(ordered_exercises):
        selected_exercises_with_metadata.append({
            "exercise_id": exercise.id,
            "name": exercise.name,
            "muscle_groups": exercise.muscle_groups,
            "equipment_required": exercise.equipment_required,
            "difficulty": exercise.difficulty,
            "order_in_session": idx + 1,
            "default_sets": exercise.default_sets,
            "default_reps_min": exercise.default_reps_min,
            "default_reps_max": exercise.default_reps_max,
            "default_weight": exercise.default_weight,
            "base_rest_time_seconds": exercise.base_rest_time_seconds,
            "instructions": exercise.instructions,
            "exercise_type": exercise.exercise_type,
            "weight_type": exercise.weight_type,
            "is_compound": exercise.is_compound,
            "popularity_score": exercise.popularity_score or 0
        })
    
    # NOUVEAU : Calculer le score de qualité avec capacité ML
    from backend.ml_recommendations import FitnessRecommendationEngine
    ml_engine = FitnessRecommendationEngine(db)
    
    # Vérifier combien d'exercices ont un historique ML
    ml_capability_score = 0
    for exercise_data in selected_exercises_with_metadata:
        exercise = next((ex for ex in selected_exercises if ex.id == exercise_data['exercise_id']), None)
        if exercise:
            historical_data = ml_engine._get_historical_context(user, exercise, 1, 1)
            if historical_data and len(historical_data) > 0:
                ml_capability_score += 1
    
    # Calcul du score final
    base_score = 60
    recovery_bonus = recovery_score * 20  # Max 20 points pour récupération parfaite
    ml_bonus = (ml_capability_score / len(selected_exercises_with_metadata)) * 20  # Max 20 points si tous ont ML
    
    # Bonus diversité musculaire
    unique_muscle_groups = set()
    for ex in selected_exercises_with_metadata:
        unique_muscle_groups.update(ex['muscle_groups'])
    diversity_bonus = min(len(unique_muscle_groups) * 2, 10)  # Max 10 points
    
    quality_score = min(100, base_score + recovery_bonus + ml_bonus + diversity_bonus)
    
    return {
        "exercises": selected_exercises_with_metadata,
        "quality_score": round(quality_score),
        "ppl_used": ppl_used,
        "ppl_recommendation": ppl_recommendation_response,
        "generation_metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "parameters_used": generation_params,
            "recovery_score": recovery_score,
            "ml_exercises_count": ml_capability_score,
            "muscle_groups_targeted": list(unique_muscle_groups)
        }
    }
    
@app.post("/api/ai/optimize-session")
def optimize_ai_session(request_data: dict, db: Session = Depends(get_db)):
    """Optimise l'ordre d'une séance générée - Algorithme hybride efficient"""
    
    exercises = request_data.get('exercises', [])
    user_id = request_data.get('user_id', 1)
    mode = request_data.get('mode', 'optimize')

    if len(exercises) <= 1:
        return {
            "optimized_exercises": exercises, 
            "optimization_score": 100.0,
            "improvements": ["Séance trop courte pour optimiser"]
        }
    
    try:
        # STRATÉGIE HYBRIDE pour éviter explosion combinatoire
        if len(exercises) <= 4:
            # Permutations complètes (4! = 24, acceptable)
            optimized = optimize_by_permutations(exercises)
        else:
            # Algorithme génétique simple (efficace pour 5-8 exercices)
            optimized = optimize_by_genetic_algorithm(exercises)
        
        # Score de qualité normalisé
        quality_score = calculate_order_quality_score(optimized)
        improvements = analyze_improvements(exercises, optimized)
        
        logger.info(f"🔄 Response envoyée: optimization_score={round(quality_score, 1)}, quality_score={round(quality_score, 1)}")
        
        if mode == 'evaluate':
            # MODE ÉVALUATION : Score l'ordre DONNÉ sans l'optimiser
            current_score = calculate_order_quality_score(exercises)
            improvements = analyze_improvements_detailed(exercises, exercises, current_score)
            final_exercises = exercises  # Garde l'ordre original
            
        else:
            # MODE OPTIMISATION : Trouve le meilleur ordre possible
            if len(exercises) <= 4:
                optimized = optimize_by_permutations(exercises)
            else:
                optimized = optimize_by_genetic_algorithm(exercises)
            
            current_score = calculate_order_quality_score(optimized)
            improvements = analyze_improvements_detailed(exercises, optimized, current_score)
            final_exercises = optimized
        
        logger.info(f"🔄 Mode {mode}: Score={current_score:.1f}")
        
        return {
            "optimized_exercises": final_exercises,
            "optimization_score": round(current_score, 1),
            "quality_score": round(current_score, 1),
            "improvements": improvements,
            "method_used": f"{mode}_mode",
            "mode_used": mode,
            "score_breakdown": {
                "total": round(current_score, 1),
                "details": "Voir logs pour détail des métriques"
            }
        }
        
    except Exception as e:
        logger.error(f"Erreur {mode}: {e}")
        return {
            "optimized_exercises": exercises,
            "optimization_score": 50.0,
            "quality_score": 50.0,
            "improvements": ["Erreur calcul, ordre conservé"],
            "mode_used": mode if 'mode' in locals() else 'unknown'
        }

def analyze_improvements_detailed(original, optimized, score):
    """Analyse détaillée des améliorations possibles"""
    
    improvements = []
    
    if score >= 90:
        improvements.append("Excellent ordre d'entraînement")
    elif score >= 75:
        improvements.append("Bon ordre, quelques optimisations possibles")
    elif score >= 60:
        improvements.append("Ordre perfectible, réorganisation recommandée")
    else:
        improvements.append("Ordre sous-optimal, réorganisation nécessaire")
    
    # Conseils spécifiques selon le score
    if score < 80:
        improvements.append("💡 Placez les exercices composés en début de séance")
        
    if score < 70:
        improvements.append("💡 Évitez les exercices intenses en fin de séance")
    
    return improvements

def calculate_order_quality_score(exercises):
    """
    Score 0-100 basé sur plusieurs critères d'entraînement réels
    Utilise intensity_factor, exercise_type, difficulty des données JSON
    """
    
    if len(exercises) <= 1:
        logger.info("🎯 Score=100 (1 seul exercice)")
        return 100.0
    
    # Calculer chaque métrique
    scores = {
        'exercise_order': calculate_exercise_order_score(exercises),      # 30%
        'intensity_flow': calculate_intensity_flow_score(exercises),      # 25% 
        'fatigue_management': calculate_fatigue_score(exercises),         # 20%
        'muscle_rotation': calculate_muscle_rotation_score(exercises),    # 15%
        'difficulty_progression': calculate_difficulty_score(exercises)   # 10%
    }
    
    # Pondération des métriques
    weights = {
        'exercise_order': 0.30, 
        'intensity_flow': 0.25, 
        'fatigue_management': 0.20,
        'muscle_rotation': 0.15, 
        'difficulty_progression': 0.10
    }
    
    # Score final pondéré
    total_score = sum(score * weights[metric] for metric, score in scores.items())
    final_score = round(min(100.0, max(0.0, total_score)), 1)
    
    # DEBUG : Afficher le détail de chaque métrique
    exercise_names = [ex.get('name', f'Ex{i}') for i, ex in enumerate(exercises)]
    logger.info(f"🔍 ANALYSE SÉANCE : {' → '.join(exercise_names)}")
    logger.info(f"  📊 Ordre exercices: {scores['exercise_order']:.1f}/100 (poids: {weights['exercise_order']:.0%})")
    logger.info(f"  ⚡ Flux intensité: {scores['intensity_flow']:.1f}/100 (poids: {weights['intensity_flow']:.0%})")  
    logger.info(f"  😴 Gestion fatigue: {scores['fatigue_management']:.1f}/100 (poids: {weights['fatigue_management']:.0%})")
    logger.info(f"  🔄 Rotation muscles: {scores['muscle_rotation']:.1f}/100 (poids: {weights['muscle_rotation']:.0%})")
    logger.info(f"  📈 Progression difficulté: {scores['difficulty_progression']:.1f}/100 (poids: {weights['difficulty_progression']:.0%})")
    logger.info(f"🎯 SCORE FINAL: {final_score}")
    
    return final_score

def calculate_exercise_order_score(exercises):
    """30% du score - Récompense l'ordre composé → isolation"""
    
    score = 100.0
    compound_positions = []
    isolation_positions = []
    
    for i, ex in enumerate(exercises):
        ex_type = ex.get('exercise_type', 'compound')  # Défaut compound si manquant
        if ex_type == 'compound':
            compound_positions.append(i)
        elif ex_type == 'isolation':
            isolation_positions.append(i)
    
    # Pénalité si isolation avant composé
    violations = 0
    for comp_pos in compound_positions:
        for iso_pos in isolation_positions:
            if iso_pos < comp_pos:
                violations += 1
                score -= 15  # Pénalité par violation
    
    if violations > 0:
        logger.info(f"    ❌ Ordre: {violations} isolation(s) avant composé(s) (-{violations*15})")
    else:
        logger.info(f"    ✅ Ordre: Composés avant isolations")
    
    return max(0.0, score)

def calculate_intensity_flow_score(exercises):
    """25% du score - Récompense intensité décroissante ou stable"""
    
    if len(exercises) <= 1:
        return 100.0
    
    score = 100.0
    intensity_violations = 0
    
    for i in range(len(exercises) - 1):
        current_intensity = exercises[i].get('intensity_factor', 0.8)
        next_intensity = exercises[i + 1].get('intensity_factor', 0.8)
        
        if next_intensity <= current_intensity:
            # Bonus léger pour flux décroissant
            score += 2
        else:
            # Pénalité pour intensité croissante (plus difficile quand fatigué)
            intensity_jump = (next_intensity - current_intensity) * 100
            penalty = intensity_jump * 8
            score -= penalty
            intensity_violations += 1
            
            current_name = exercises[i].get('name', 'Ex')
            next_name = exercises[i + 1].get('name', 'Ex')
            logger.info(f"    ❌ Intensité croissante: {current_name}({current_intensity}) → {next_name}({next_intensity}) (-{penalty:.1f})")
    
    if intensity_violations == 0:
        logger.info(f"    ✅ Intensité: Flux décroissant/stable")
    
    return max(0.0, min(120.0, score))  # Permet bonus jusqu'à 120

def calculate_fatigue_score(exercises):
    """20% du score - Simule fatigue cumulative"""
    
    score = 100.0
    fatigue_level = 0.0
    
    for i, ex in enumerate(exercises):
        intensity = ex.get('intensity_factor', 0.8)
        is_compound = ex.get('exercise_type') == 'compound'
        
        # La fatigue augmente selon intensité et type
        fatigue_increase = intensity * (1.5 if is_compound else 1.0)
        fatigue_level += fatigue_increase
        
        # Pénalité si exercices intenses quand déjà fatigué
        if fatigue_level > 3.0 and intensity > 1.0:
            penalty = (fatigue_level - 3.0) * 6
            score -= penalty
            
            ex_name = ex.get('name', 'Ex')
            logger.info(f"    ❌ Fatigue: {ex_name} trop intense en position {i+1} (fatigue: {fatigue_level:.1f}) (-{penalty:.1f})")
    
    return max(0.0, score)

def calculate_muscle_rotation_score(exercises):
    """15% du score - Récompense alternance musculaire intelligente"""
    
    score = 100.0
    
    for i in range(len(exercises) - 1):
        current_muscles = set(exercises[i].get('muscle_groups', []))
        next_muscles = set(exercises[i + 1].get('muscle_groups', []))
        
        overlap = current_muscles.intersection(next_muscles)
        
        if overlap:
            # Pénalité modulée selon le type d'exercice
            current_type = exercises[i].get('exercise_type', 'compound')
            next_type = exercises[i + 1].get('exercise_type', 'compound')
            
            current_name = exercises[i].get('name', 'Ex')
            next_name = exercises[i + 1].get('name', 'Ex')
            
            if current_type == 'compound' and next_type == 'isolation':
                penalty = 5  # Acceptable (finir un muscle)
                logger.info(f"    ⚠️  Muscles: {current_name} → {next_name} (finition acceptable) (-{penalty})")
            elif current_type == 'isolation' and next_type == 'isolation':
                penalty = 15  # Mauvais (sur-fatigue)
                logger.info(f"    ❌ Muscles: {current_name} → {next_name} (isolations répétées) (-{penalty})")
            else:
                penalty = 10  # Neutre
                logger.info(f"    ❌ Muscles: {current_name} → {next_name} (chevauchement) (-{penalty})")
            
            score -= penalty
    
    return max(0.0, score)

def calculate_difficulty_score(exercises):
    """10% du score - Récompense progression logique de difficulté"""
    
    difficulty_values = {'beginner': 1, 'intermediate': 2, 'advanced': 3}
    score = 100.0
    
    for i in range(len(exercises) - 1):
        current_diff = difficulty_values.get(exercises[i].get('difficulty', 'intermediate'), 2)
        next_diff = difficulty_values.get(exercises[i + 1].get('difficulty', 'intermediate'), 2)
        
        # Pénalité si difficulté augmente drastiquement
        if next_diff > current_diff + 1:
            penalty = 12
            score -= penalty
            
            current_name = exercises[i].get('name', 'Ex')
            next_name = exercises[i + 1].get('name', 'Ex')
            logger.info(f"    ❌ Difficulté: {current_name} → {next_name} (saut de difficulté) (-{penalty})")
    
    return max(0.0, score)

def optimize_by_permutations(exercises):
    """Optimisation par permutations complètes (≤4 exercices)"""
    from itertools import permutations
    
    best_order = exercises
    best_score = calculate_order_quality_score(exercises)
    
    for perm in permutations(exercises):
        score = calculate_order_quality_score(list(perm))
        if score > best_score:
            best_score = score
            best_order = list(perm)
    
    return best_order

def optimize_by_genetic_algorithm(exercises):
    """Algorithme génétique simple pour 5-8 exercices"""
    import random
    
    population_size = 20
    generations = 50
    
    # Population initiale
    population = []
    for _ in range(population_size):
        individual = exercises.copy()
        random.shuffle(individual)
        population.append(individual)
    
    for generation in range(generations):
        # Évaluer fitness
        fitness_scores = [(individual, calculate_order_quality_score(individual)) 
                         for individual in population]
        fitness_scores.sort(key=lambda x: x[1], reverse=True)
        
        # Garder les 50% meilleurs
        survivors = [individual for individual, score in fitness_scores[:population_size//2]]
        
        # Générer nouvelles solutions par croisement
        new_population = survivors.copy()
        while len(new_population) < population_size:
            parent1 = random.choice(survivors)
            parent2 = random.choice(survivors)
            child = crossover_sequences(parent1, parent2)
            new_population.append(child)
        
        population = new_population
    
    # Retourner le meilleur
    final_scores = [(individual, calculate_order_quality_score(individual)) 
                   for individual in population]
    return max(final_scores, key=lambda x: x[1])[0]

def crossover_sequences(parent1, parent2):
    """Croisement intelligent pour séquences d'exercices"""
    import random
    
    # Order Crossover (OX) - préserve positions relatives
    size = len(parent1)
    start, end = sorted(random.sample(range(size), 2))
    
    child = [None] * size
    child[start:end] = parent1[start:end]
    
    # Remplir le reste avec l'ordre de parent2
    parent2_filtered = [ex for ex in parent2 if ex not in child]
    child_idx = 0
    for i, ex in enumerate(parent2_filtered):
        while child[child_idx] is not None:
            child_idx += 1
        child[child_idx] = ex
    
    return child

def penalty_same_muscle_consecutive(current, next_ex):
    """Pénalité overlap musculaire consécutif"""
    muscles_current = set(current.get('muscle_groups', []))
    muscles_next = set(next_ex.get('muscle_groups', []))
    
    overlap = len(muscles_current.intersection(muscles_next))
    
    if overlap >= 2:
        return 25  # Conflit majeur
    elif overlap == 1:
        return 10  # Conflit mineur acceptable
    return 0

def analyze_improvements(original, optimized):
    """Analyse des améliorations apportées"""
    improvements = []
    
    # Vérifier si compound en premier
    if (optimized[0].get('exercise_type') == 'compound' and 
        original[0].get('exercise_type') != 'compound'):
        improvements.append("Exercice composé placé en premier")
    
    # Compter violations évitées
    original_score = calculate_order_quality_score(original)
    optimized_score = calculate_order_quality_score(optimized)
    
    if optimized_score > original_score + 5:
        improvements.append(f"Score amélioré de {optimized_score - original_score:.1f} points")
    
    if not improvements:
        improvements.append("Ordre déjà optimal")
    
    return improvements

@app.get("/api/ai/ppl-recommendation/{user_id}")
def get_ppl_recommendation(user_id: int, db: Session = Depends(get_db)):
    """
    Endpoint recommandation PPL basée récupération + historique
    
    Returns: {
        'category': 'push',
        'confidence': 0.85,
        'reasoning': 'Pectoraux excellente récupération (95%)',
        'alternatives': {'pull': 0.70, 'legs': 0.80},
        'muscle_readiness': {...}
    }
    """
    
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
        
        # Génération recommandation
        generator = AIExerciseGenerator(db)
        muscle_readiness = generator._get_all_muscle_readiness(user_id)
        ppl_recommendation = generator._recommend_ppl(user_id, muscle_readiness)
        
        return {
            **ppl_recommendation,
            'muscle_readiness': muscle_readiness
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur recommandation PPL: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")
    

@app.put("/api/users/{user_id}/plate-helper")  
def toggle_plate_helper(user_id: int, enabled: bool = Body(..., embed=True), db: Session = Depends(get_db)):
    """Toggle aide montage"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.show_plate_helper = enabled
    db.commit()
    return {"enabled": enabled}

@app.put("/api/users/{user_id}/weight-display-preference")  
def set_weight_display_preference(user_id: int, mode: str = Body(..., embed=True), db: Session = Depends(get_db)):
    """Définir le mode d'affichage préféré : 'total' ou 'charge'"""
    if mode not in ['total', 'charge']:
        raise HTTPException(status_code=400, detail="Mode doit être 'total' ou 'charge'")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.preferred_weight_display_mode = mode
    db.commit()
    return {"mode": mode}

# ===== FICHIERS STATIQUES =====

# Servir les fichiers frontend
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")

@app.get("/{filename:path}")
async def serve_spa(filename: str):
    file_path = os.path.join(frontend_path, filename)
    
    if filename.endswith('.js') and os.path.exists(file_path):
        return FileResponse(file_path, media_type='application/javascript')
    
    if os.path.exists(file_path) and not os.path.isdir(file_path):
        return FileResponse(file_path)
    
    return FileResponse(os.path.join(frontend_path, "index.html"))

# ===== FORCEUR DE MISE A JOUR DES STATS =====

@app.post("/api/users/{user_id}/refresh-stats")
def refresh_user_stats(user_id: int, db: Session = Depends(get_db)):
    """Force la mise à jour des statistiques d'exercices pour un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    try:
        # Mettre à jour toutes les stats
        update_exercise_stats_for_user(db, user_id)
        
        # Retourner le nombre d'entrées mises à jour
        count = db.query(ExerciseCompletionStats).filter(
            ExerciseCompletionStats.user_id == user_id
        ).count()
        
        return {
            "message": "Statistiques mises à jour",
            "exercises_updated": count,
            "last_updated": datetime.now(timezone.utc)
        }
    except Exception as e:
        logger.error(f"Erreur refresh stats: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour")



@app.post("/api/ml/feedback")
def record_ml_feedback(
    feedback_data: dict,
    db: Session = Depends(get_db)
):
    """Enregistrer le feedback sur les recommandations ML"""
    try:
        # Validation plus robuste avec valeurs par défaut
        exercise_id = feedback_data.get('exercise_id')
        recommendation = feedback_data.get('recommendation', {})
        accepted = feedback_data.get('accepted', True)
        
        # Validation minimale
        if not exercise_id:
            logger.warning(f"ML feedback sans exercise_id: {feedback_data}")
            return {"status": "warning", "message": "exercise_id manquant mais feedback accepté"}
        
        # Logs pour amélioration future du modèle
        logger.info(f"ML feedback reçu:")
        logger.info(f"  Exercise: {exercise_id}")
        logger.info(f"  Recommandation suivie: {accepted}")
        logger.info(f"  Données: {recommendation}")
        
        return {"status": "success", "message": "Feedback ML enregistré"}
        
    except Exception as e:
        logger.error(f"Erreur enregistrement ML feedback: {e}")
        logger.error(f"Données reçues: {feedback_data}")
        # Ne pas faire échouer, juste logger
        return {"status": "error", "message": "Erreur mais pas bloquant"}
