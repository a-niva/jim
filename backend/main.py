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
from backend.models import Base, User, Exercise, Program, Workout, WorkoutSet, SetHistory, UserCommitment, AdaptiveTargets, UserAdaptationCoefficients, PerformanceStates, ExerciseCompletionStats, SwapLog, ComprehensiveProgram
from backend.schemas import (
    UserCreate, UserResponse, WorkoutResponse, ProgramCreate, WorkoutCreate, 
    SetCreate, ExerciseResponse, UserPreferenceUpdate,
    ProgramBuilderStart, ProgramBuilderSelections, ComprehensiveProgramCreate, 
    ComprehensiveProgramResponse, ProgramBuilderRecommendations, WeeklySessionPreview
)

from backend.equipment_service import EquipmentService
from sqlalchemy import extract, and_
import calendar
from collections import defaultdict


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
        #TODO:Déclencher ajustement automatique du programme via ML Engine

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
        
        # Créer un dict User sans les champs programme
        user_dict = user.dict()
        # Retirer les champs qui n'appartiennent pas au modèle User
        for field in ['focus_areas', 'sessions_per_week', 'session_duration', 'program_name']:
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

    # Les workouts/programs ont cascade configuré, donc seront supprimés automatiquement
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

# ===== ENDPOINTS PROGRAMMES =====

@app.post("/api/users/{user_id}/programs")
def create_program(user_id: int, program: ProgramCreate, db: Session = Depends(get_db)):
    """Créer un nouveau programme d'entraînement"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Désactiver les anciens programmes
    db.query(Program).filter(Program.user_id == user_id).update({"is_active": False})
    
    # Utiliser generate_comprehensive_program directement
    db_program = generate_comprehensive_program(
        user_id,
        ProgramBuilderSelections(
            training_frequency=program.sessions_per_week,
            session_duration=program.session_duration_minutes,
            focus_areas=program.focus_areas,
            periodization_preference="linear",
            exercise_variety_preference="balanced"
        ),
        db
    )
    
    db.add(db_program)
    db.commit()
    db.refresh(db_program)
    return db_program

@app.get("/api/users/{user_id}/program-status")
def get_program_status(user_id: int, db: Session = Depends(get_db)):
    """Obtenir le statut actuel du programme de l'utilisateur - VERSION SCHEDULE"""
    
    # Récupérer le programme actif
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        return None
    
    # NOUVEAU : Calculer depuis schedule si disponible
    if program.schedule:
        total_sessions = len(program.schedule)
        completed_sessions = len([
            s for s in program.schedule.values() 
            if s.get("status") == "completed"
        ])
        in_progress_sessions = len([
            s for s in program.schedule.values() 
            if s.get("status") == "in_progress"
        ])
        
        completion_rate = (completed_sessions / total_sessions * 100) if total_sessions > 0 else 0
        
        # Calculer semaine actuelle depuis le schedule
        today = datetime.now(timezone.utc).date().isoformat()
        current_week = 1
        for date_str in sorted(program.schedule.keys()):
            if date_str <= today:
                # Estimer la semaine en fonction de la date
                session_date = datetime.fromisoformat(date_str).date()
                if program.started_at:
                    start_date = program.started_at.date() if program.started_at.tzinfo else program.started_at.replace(tzinfo=timezone.utc).date()
                    days_diff = (session_date - start_date).days
                    current_week = max(1, days_diff // 7 + 1)
        
        return {
            "total_sessions": total_sessions,
            "completed_sessions": completed_sessions,
            "in_progress_sessions": in_progress_sessions,
            "completion_rate": completion_rate,
            "current_week": current_week,
            "program_name": program.name,
            "duration_weeks": program.duration_weeks,
            "using_schedule": True
        }
    
    # FALLBACK : Ancienne logique si pas de schedule
    try:
        now_utc = datetime.now(timezone.utc)
        weeks_elapsed = safe_datetime_subtract(now_utc, program.created_at).days // 7
        
        # Utiliser weekly_structure au lieu de program.exercises
        if program.weekly_structure:
            total_weeks = len(program.weekly_structure) if isinstance(program.weekly_structure, list) else 4
        else:
            total_weeks = 4
        current_week = min(weeks_elapsed + 1, total_weeks)
        
    except Exception as e:
        logger.warning(f"Erreur calcul semaines programme {program.id}: {e}")
        weeks_elapsed = 0
        current_week = 1
        total_weeks = 4
    
    # Calculer les séances depuis les workouts réels
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=now.weekday())
    week_workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.program_id == program.id,
        Workout.started_at >= week_start,
        Workout.status.in_(["completed", "active"])
    ).count()
    
    return {
        "total_sessions": program.sessions_per_week * (program.duration_weeks or 4),
        "completed_sessions": week_workouts,
        "completion_rate": 0,  # Difficile à calculer sans schedule
        "current_week": current_week,
        "program_name": program.name,
        "duration_weeks": total_weeks,
        "using_schedule": False
    }


@app.get("/api/users/{user_id}/programs/active")
def get_active_program(user_id: int, db: Session = Depends(get_db)):
    """Récupérer le programme actif d'un utilisateur (format ComprehensiveProgram) - VERSION CORRIGÉE"""
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        return None
    
    # CORRECTION: Gestion sécurisée de started_at et calculs timezone
    try:
        # Mettre à jour l'état de progression si le programme est déjà démarré
        if program.started_at:
            # S'assurer que les datetimes ont les bonnes timezones
            now_utc = datetime.now(timezone.utc)
            
            # Gérer le cas où started_at n'a pas de timezone
            if program.started_at.tzinfo is None:
                program_started = program.started_at.replace(tzinfo=timezone.utc)
            else:
                program_started = program.started_at
                
            weeks_elapsed = (now_utc - program_started).days // 7
            program.current_week = min(weeks_elapsed + 1, program.duration_weeks or 8)
            
            # Calculer estimated_completion si pas déjà fait
            if not program.estimated_completion:
                program.estimated_completion = program_started + timedelta(weeks=program.duration_weeks or 8)
                
            db.commit()
            
    except Exception as e:
        # En cas d'erreur dans les calculs de dates, on continue avec des valeurs par défaut
        logger.warning(f"Erreur calcul dates programme {program.id}: {e}")
        if not program.current_week:
            program.current_week = 1
        if not program.duration_weeks:
            program.duration_weeks = 8
    
    # Enrichir avec la session actuelle pour l'interface - VERSION SÉCURISÉE
    current_session_exercises = []
    
    try:
        if (hasattr(program, 'weekly_structure') and 
            program.weekly_structure and 
            len(program.weekly_structure) >= (program.current_week or 1)):
            
            current_week_data = program.weekly_structure[(program.current_week or 1) - 1]
            
            if (current_week_data and 
                "sessions" in current_week_data and 
                len(current_week_data["sessions"]) > 0):
                
                current_session_index = ((program.current_session_in_week or 1) - 1) % len(current_week_data["sessions"])
                current_session = current_week_data["sessions"][current_session_index]
                
                # Convertir exercise_pool pour compatibilité avec l'interface existante
                if "exercise_pool" in current_session:
                    for pool_exercise in current_session["exercise_pool"]:
                        try:
                            exercise_db = db.query(Exercise).filter(Exercise.id == pool_exercise["exercise_id"]).first()
                            if exercise_db:
                                current_session_exercises.append({
                                    "exercise_id": pool_exercise["exercise_id"],
                                    "exercise_name": exercise_db.name,
                                    "sets": pool_exercise.get("sets", 3),
                                    "reps_min": pool_exercise.get("reps_min", 8),
                                    "reps_max": pool_exercise.get("reps_max", 12),
                                    "muscle_groups": pool_exercise.get("muscle_groups", exercise_db.muscle_groups),
                                    "estimated_duration": pool_exercise.get("estimated_duration_minutes", 15)
                                })
                        except Exception as ex_error:
                            logger.warning(f"Erreur traitement exercice {pool_exercise.get('exercise_id', 'unknown')}: {ex_error}")
                            continue
                            
    except Exception as e:
        logger.warning(f"Erreur enrichissement session programme {program.id}: {e}")
        # Fallback: utiliser l'ancien format exercises si disponible
        # Toujours extraire de weekly_structure
        current_session_exercises = []
        if program.weekly_structure and len(program.weekly_structure) > 0:
            try:
                week_idx = (program.current_week - 1) % len(program.weekly_structure)
                week_data = program.weekly_structure[week_idx]
                
                if "sessions" in week_data and len(week_data["sessions"]) > 0:
                    session_idx = (program.current_session_in_week - 1) % len(week_data["sessions"])
                    session = week_data["sessions"][session_idx]
                    
                    if "exercise_pool" in session:
                        for ex in session["exercise_pool"]:
                            current_session_exercises.append({
                                "exercise_id": ex["exercise_id"],
                                "exercise_name": ex.get("exercise_name", ""),
                                "sets": ex.get("sets", 3),
                                "reps_min": ex.get("reps_min", 8),
                                "reps_max": ex.get("reps_max", 12),
                                "muscle_groups": ex.get("muscle_groups", [])
                            })
            except Exception as e:
                logger.error(f"Erreur extraction exercices v2.0: {e}")
    
    # Enrichir avec la liste des exercices pour l'interface - même format que l'ancien système
    enriched_program = {
        "id": program.id,
        "name": program.name or f"Programme {program.user_id}",
        "duration_weeks": program.duration_weeks or 8,
        "sessions_per_week": program.sessions_per_week or 3,
        "session_duration_minutes": program.session_duration_minutes or 60,
        "focus_areas": program.focus_areas or ["upper_body", "legs"],
        "exercises": current_session_exercises,  # Pour compatibilité interface
        "current_week": program.current_week or 1,
        "current_session_in_week": program.current_session_in_week or 1,
        "is_active": program.is_active,
        "created_at": program.created_at,
        "format_version": getattr(program, 'format_version', '1.0'),
        # Champs optionnels pour éviter les erreurs
        "started_at": program.started_at,
        "estimated_completion": getattr(program, 'estimated_completion', None),
        "weekly_structure": getattr(program, 'weekly_structure', []),
        "progression_rules": getattr(program, 'progression_rules', {}),
        "base_quality_score": getattr(program, 'base_quality_score', 75.0),
        # NOUVEAU : Ajouter le schedule
        "schedule": getattr(program, 'schedule', {}),
        "schedule_metadata": getattr(program, 'schedule_metadata', {})
    }
    
    return enriched_program

@app.post("/api/programs/{program_id}/generate-schedule")
def generate_program_schedule(
    program_id: int,
    options: dict = {},
    db: Session = Depends(get_db)
):
    """Générer ou régénérer le schedule d'un programme"""
    
    # Récupérer le programme
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    try:
        # Options pour la génération
        force_regenerate = options.get("force_regenerate", False)
        
        # Si un schedule existe déjà et qu'on ne force pas, retourner erreur
        if program.schedule and not force_regenerate:
            raise HTTPException(
                status_code=400, 
                detail="Le schedule existe déjà. Utilisez force_regenerate=true pour régénérer"
            )
        
        # Si on régénère, sauvegarder l'ancien schedule
        if force_regenerate and program.schedule:
            if not program.schedule_metadata:
                program.schedule_metadata = {}
            program.schedule_metadata["previous_schedule"] = program.schedule
            program.schedule_metadata["regenerated_at"] = datetime.now(timezone.utc).isoformat()
        
        # Générer le nouveau schedule
        populate_program_planning_intelligent(db, program)
        
        # Rafraîchir pour récupérer les modifications
        db.refresh(program)
        
        return {
            "message": "Schedule généré avec succès",
            "program_id": program.id,
            "sessions_count": len(program.schedule),
            "duration_weeks": program.duration_weeks,
            "schedule_metadata": program.schedule_metadata
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur génération schedule pour programme {program_id}: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la génération du schedule")

@app.get("/api/programs/{program_id}/schedule")
def get_program_schedule(
    program_id: int,
    week_start: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Récupérer le schedule d'un programme pour une semaine donnée"""
    
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    if not program.schedule:
        raise HTTPException(status_code=404, detail="Aucun schedule généré pour ce programme")
    
    # Si week_start est fourni, filtrer pour cette semaine
    if week_start:
        try:
            start_date = datetime.fromisoformat(week_start).date()
            end_date = start_date + timedelta(days=6)
            
            week_schedule = {
                date_str: session_data 
                for date_str, session_data in program.schedule.items()
                if start_date <= datetime.fromisoformat(date_str).date() <= end_date
            }
        except ValueError:
            raise HTTPException(status_code=400, detail="Format de date invalide. Utilisez YYYY-MM-DD")
    else:
        # Retourner tout le schedule
        week_schedule = program.schedule
    
    # Analyser la récupération musculaire pour la semaine
    muscle_recovery = {}
    if week_schedule:
        for date_str, session in sorted(week_schedule.items()):
            session_date = datetime.fromisoformat(date_str).date()
            muscles = session.get("primary_muscles", [])
            
            for muscle in muscles:
                if muscle not in muscle_recovery:
                    muscle_recovery[muscle] = []
                muscle_recovery[muscle].append(session_date)
    
    # Calculer les warnings de récupération
    recovery_warnings = calculate_recovery_warnings(muscle_recovery)
    
    return {
        "program_id": program_id,
        "week_start": week_start,
        "schedule": week_schedule,
        "total_sessions": len(week_schedule),
        "muscle_recovery_status": recovery_warnings,
        "schedule_metadata": program.schedule_metadata
    }

@app.put("/api/programs/{program_id}/schedule/{date}")
def update_program_schedule(
    program_id: int,
    date: str,
    update_data: dict,
    db: Session = Depends(get_db)
):
    """Mettre à jour une séance dans le schedule (déplacer, modifier status, etc.)"""
    
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    if not program.schedule:
        program.schedule = {}
    
    # Valider la date
    try:
        session_date = datetime.fromisoformat(date).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Format de date invalide")
    
    # Si c'est un déplacement
    if "move_from" in update_data:
        old_date = update_data["move_from"]
        
        # Vérifier que l'ancienne date existe
        if old_date not in program.schedule:
            raise HTTPException(status_code=404, detail="Session source non trouvée")
        
        # Valider le déplacement
        target_date = session_date

        # Validation complète du déplacement de session
        validation_result = _validate_session_move_schedule(
            program, old_date, date, db
        )
        
        if not validation_result["allowed"]:
            raise HTTPException(
                status_code=400, 
                detail=validation_result["reason"]
            )
        
        # Enregistrer les warnings même si autorisé
        if validation_result.get("warnings"):
            logger.info(f"Warnings déplacement {old_date} → {date}: {validation_result['warnings']}")
        
        # Effectuer le déplacement
        session_data = program.schedule.pop(old_date)
        session_data["moved_from"] = old_date
        session_data["moved_at"] = datetime.now(timezone.utc).isoformat()
        
        # Ajouter l'historique de modification
        if "modifications" not in session_data:
            session_data["modifications"] = []
        session_data["modifications"].append({
            "type": "moved",
            "from": old_date,
            "to": date,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        program.schedule[date] = session_data
        
    # Si c'est une mise à jour de status
    elif "status" in update_data:
        if date not in program.schedule:
            raise HTTPException(status_code=404, detail="Session non trouvée")
        
        old_status = program.schedule[date].get("status", "planned")
        new_status = update_data["status"]
        
        if new_status not in ["planned", "in_progress", "completed", "skipped", "cancelled"]:
            raise HTTPException(status_code=400, detail="Status invalide")
        
        program.schedule[date]["status"] = new_status
        
        # Timestamps selon le status
        if new_status == "in_progress":
            program.schedule[date]["started_at"] = datetime.now(timezone.utc).isoformat()
        elif new_status == "completed":
            program.schedule[date]["completed_at"] = datetime.now(timezone.utc).isoformat()
            if "actual_score" in update_data:
                program.schedule[date]["actual_score"] = update_data["actual_score"]
        
        # Historique
        if "modifications" not in program.schedule[date]:
            program.schedule[date]["modifications"] = []
        program.schedule[date]["modifications"].append({
            "type": "status_change",
            "from": old_status,
            "to": new_status,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    # Si c'est une modification d'exercices
    elif "exercises" in update_data:
        if date not in program.schedule:
            raise HTTPException(status_code=404, detail="Session non trouvée")
        
        program.schedule[date]["exercises_snapshot"] = update_data["exercises"]
        program.schedule[date]["modified_at"] = datetime.now(timezone.utc).isoformat()
        
        # Recalculer le score
        new_score = calculate_session_quality_score(
            update_data["exercises"], 
            program.user_id,
            db
        )
        program.schedule[date]["predicted_score"] = new_score
    
    # Mettre à jour les métadonnées
    flag_modified(program, "schedule")
    update_program_schedule_metadata(program, db)
    
    db.commit()
    
    return {
        "message": "Schedule mis à jour",
        "date": date,
        "session": program.schedule.get(date),
        "schedule_metadata": program.schedule_metadata
    }

def _validate_session_move_schedule(program, old_date: str, new_date: str, db: Session):
    """Valide le déplacement d'une session dans le schedule avec toutes les règles métier"""
    
    try:
        old_session_date = datetime.fromisoformat(old_date).date()
        new_session_date = datetime.fromisoformat(new_date).date()
    except ValueError:
        return {"allowed": False, "reason": "Format de date invalide"}
    
    warnings = []
    
    # 1. Vérifier max 2 séances par jour
    same_day_sessions = sum(
        1 for d, s in program.schedule.items()
        if (datetime.fromisoformat(d).date() == new_session_date and 
            s.get("status") not in ["cancelled", "completed"] and 
            d != old_date)  # Exclure la session qu'on déplace
    )
    
    if same_day_sessions >= 2:
        return {"allowed": False, "reason": "Maximum 2 séances par jour autorisées"}
    
    # 2. Vérifier récupération musculaire
    if old_date in program.schedule:
        session = program.schedule[old_date]
        primary_muscles = session.get("primary_muscles", [])
        
        # Chercher d'autres séances des mêmes muscles dans les 48h
        for date_str, other_session in program.schedule.items():
            if date_str == old_date or date_str == new_date:
                continue
                
            try:
                other_date = datetime.fromisoformat(date_str).date()
                days_diff = abs((new_session_date - other_date).days)
                
                if days_diff < 2:  # Moins de 48h
                    other_muscles = other_session.get("primary_muscles", [])
                    overlap = set(primary_muscles) & set(other_muscles)
                    
                    if overlap:
                        warnings.append(
                            f"Récupération musculaire: {', '.join(overlap)} "
                            f"travaillés il y a {days_diff} jour(s)"
                        )
            except ValueError:
                continue
    
    # 3. Vérifier que la nouvelle date n'est pas dans le passé
    today = datetime.now(timezone.utc).date()
    if new_session_date < today:
        return {"allowed": False, "reason": "Impossible de planifier dans le passé"}
    
    return {
        "allowed": True,
        "warnings": warnings,
        "validation_type": "schedule_move"
    }

@app.post("/api/programs/{program_id}/schedule")
def add_to_program_schedule(
    program_id: int,
    session_data: dict,
    db: Session = Depends(get_db)
):
    """Ajouter une nouvelle séance au schedule"""
    
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    if not program.schedule:
        program.schedule = {}
    
    # Valider les données requises
    if "date" not in session_data:
        raise HTTPException(status_code=400, detail="Date requise")
    
    date_str = session_data["date"]
    
    try:
        session_date = datetime.fromisoformat(date_str).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Format de date invalide")
    
    # Vérifier max 2 séances par jour
    same_day_sessions = sum(
        1 for d, s in program.schedule.items()
        if datetime.fromisoformat(d).date() == session_date
    )

    if same_day_sessions >= 2:
        raise HTTPException(status_code=400, detail="Maximum 2 séances par jour")

    # Générer une clé unique pour cette date
    session_index = same_day_sessions
    schedule_key = f"{date_str}_{session_index}"
    
    # Créer la séance
    exercises = session_data.get("exercises", [])
    
    # Si pas d'exercices fournis, utiliser une session du template
    if not exercises and program.weekly_structure:
        # Prendre la première session disponible comme template
        if isinstance(program.weekly_structure, dict):
            for day, sessions in program.weekly_structure.items():
                if sessions:
                    exercises = sessions[0].get("exercise_pool", [])
                    break
        elif isinstance(program.weekly_structure, list) and program.weekly_structure:
            if program.weekly_structure[0].get("sessions"):
                exercises = program.weekly_structure[0]["sessions"][0].get("exercise_pool", [])
    
    # Adapter les exercices pour éviter répétitions
    adapted_exercises = adapt_session_exercises(
        exercises, program.user_id, session_date, db
    )
    
    # Calculer le score prédictif
    quality_score = calculate_session_quality_score(
        adapted_exercises, program.user_id, db
    )
    
    # Créer l'entrée du schedule
    new_session = {
        "session_ref": f"manual_{len(program.schedule)}",
        "time": session_data.get("time", "18:00"),
        "status": "planned",
        "predicted_score": quality_score,
        "actual_score": None,
        "exercises_snapshot": adapted_exercises,
        "primary_muscles": extract_primary_muscles(adapted_exercises),
        "estimated_duration": session_data.get("duration", 60),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "modifications": []
    }
    
    program.schedule[schedule_key] = new_session
    
    # Mettre à jour les métadonnées
    flag_modified(program, "schedule")
    update_program_schedule_metadata(program, db)
    
    db.commit()
    
    return {
        "message": "Séance ajoutée au schedule",
        "date": date_str,
        "session": new_session,
        "total_sessions": len(program.schedule)
    }

@app.delete("/api/programs/{program_id}/schedule/{date}")
def remove_from_schedule(
    program_id: int,
    date: str,
    db: Session = Depends(get_db)
):
    """Supprimer une séance du schedule"""
    
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    if not program.schedule or date not in program.schedule:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    # Sauvegarder les infos de la séance supprimée
    deleted_session = program.schedule[date]
    
    # Supprimer la séance
    del program.schedule[date]
    
    # Mettre à jour les métadonnées
    flag_modified(program, "schedule")
    update_program_schedule_metadata(program, db)
    
    # Ajouter dans l'historique des métadonnées
    if not program.schedule_metadata:
        program.schedule_metadata = {}
    
    if "deleted_sessions" not in program.schedule_metadata:
        program.schedule_metadata["deleted_sessions"] = []
    
    program.schedule_metadata["deleted_sessions"].append({
        "date": date,
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "session_data": deleted_session
    })
    
    flag_modified(program, "schedule_metadata")
    db.commit()
    
    return {
        "message": "Séance supprimée du schedule",
        "date": date,
        "remaining_sessions": len(program.schedule)
    }

def _get_selection_reason(item):
    """Génère une raison lisible pour la sélection d'un exercice"""
    reasons = []
    
    if item['staleness'] > 0.8:
        reasons.append("Pas fait récemment")
    if item['readiness'] > 0.8:
        reasons.append("Muscles récupérés")
    if item['volume_deficit'] > 0.5:
        reasons.append("Retard de volume")
    if item['focus_match'] > 0.5:
        reasons.append("Zone prioritaire")
    
    return " • ".join(reasons) if reasons else "Sélection équilibrée"

@app.get("/api/users/{user_id}/programs/next-session")
def get_next_intelligent_session(user_id: int, db: Session = Depends(get_db)):
    """Sélection intelligente d'exercices via ML complet"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        raise HTTPException(status_code=404, detail="Aucun programme actif")

    if program.format_version != "2.0" or not program.weekly_structure:
        raise HTTPException(status_code=400, detail="Programme v2.0 requis - veuillez recréer votre programme")
    
    try:
        recovery_tracker = RecoveryTracker(db)
        volume_optimizer = VolumeOptimizer(db)
        progression_analyzer = ProgressionAnalyzer(db)
        
        # Dictionnaires pour stocker les résultats ML
        muscle_readiness_dict = {}
        volume_deficit_dict = {}
        
        # Appels ML avec fallbacks
        try:
            all_muscles = ["pectoraux", "dos", "deltoïdes", "jambes", "bras", "abdominaux"]
            for muscle in all_muscles:
                try:
                    readiness = recovery_tracker.get_muscle_readiness(muscle, user)
                    muscle_readiness_dict[muscle] = readiness
                except Exception as e:
                    logger.warning(f"Erreur readiness pour {muscle}: {e}")
                    muscle_readiness_dict[muscle] = 1.0
                
                try:
                    deficit = volume_optimizer.get_volume_deficit(user, muscle)
                    volume_deficit_dict[muscle] = deficit
                except Exception as e:
                    logger.warning(f"Erreur volume deficit pour {muscle}: {e}")
                    volume_deficit_dict[muscle] = 0.0
        except Exception as e:
            logger.error(f"Erreur ML globale: {e}")
            # Valeurs par défaut si ML échoue
            for muscle in all_muscles:
                muscle_readiness_dict[muscle] = 1.0
                volume_deficit_dict[muscle] = 0.0
        
        # Vérifier le format du programme
        if not (program.exercises and isinstance(program.exercises, dict) and program.exercises.get('exercise_pool')):
            # Ancien format - fallback sur sélection statique avec enrichissement
            if program.exercises and isinstance(program.exercises, list):
                
                # Enrichir les exercices avec les données de la table Exercise
                enriched_exercises = []
                for exercise_data in program.exercises[:6]:
                    exercise_id = exercise_data.get('exercise_id') if isinstance(exercise_data, dict) else exercise_data
                    
                    # Récupérer l'exercice complet depuis la DB
                    exercise_db = db.query(Exercise).filter(Exercise.id == exercise_id).first()
                    if exercise_db:
                        enriched_exercise = {
                            "exercise_id": exercise_db.id,
                            "exercise_name": exercise_db.name,
                            "muscle_groups": exercise_db.muscle_groups or [],
                            "sets": exercise_data.get('sets', 3) if isinstance(exercise_data, dict) else 3,
                            "reps_min": exercise_data.get('reps_min', 8) if isinstance(exercise_data, dict) else 8,
                            "reps_max": exercise_data.get('reps_max', 12) if isinstance(exercise_data, dict) else 12,
                            "score": 0.75,  # Score par défaut
                            "selection_reason": "Programme standard"
                        }
                        enriched_exercises.append(enriched_exercise)
                    else:
                        logger.warning(f"Exercice {exercise_id} non trouvé en DB")
                
                if not enriched_exercises:
                    raise HTTPException(status_code=400, detail="Aucun exercice valide dans le programme")
                
                return {
                    "selected_exercises": enriched_exercises,
                    "session_metadata": {
                        "ml_used": False,
                        "reason": "Programme format v1.0",
                        "estimated_duration": len(enriched_exercises) * 8,
                        "muscle_distribution": {},
                        "warnings": []
                    }
                }
            else:
                raise HTTPException(status_code=400, detail="Format de programme invalide")
        
        # 2. Vérifier le format du programme
        if program.format_version == "2.0" and program.weekly_structure:
            # NOUVEAU FORMAT v2.0: Utiliser la structure temporelle
            try:
                # Obtenir la session actuelle dans la structure
                current_week_data = program.weekly_structure[program.current_week - 1]
                session_index = (program.current_session_in_week - 1) % len(current_week_data["sessions"])
                session_template = current_week_data["sessions"][session_index]
                
                # Utiliser l'exercise_pool de la session
                exercise_pool_data = session_template.get("exercise_pool", [])
                
                if not exercise_pool_data:
                    raise HTTPException(status_code=400, detail="Pas d'exercices dans le pool de cette session")
                
                # Convertir en format compatible avec la logique ML existante
                program_exercises_adapted = []
                for pool_exercise in exercise_pool_data:
                    exercise_db = db.query(Exercise).filter(Exercise.id == pool_exercise["exercise_id"]).first()
                    if exercise_db:
                        adapted_exercise = {
                            "exercise_id": pool_exercise["exercise_id"],
                            "sets": pool_exercise.get("sets", 3),
                            "reps_min": pool_exercise.get("reps_min", 8),
                            "reps_max": pool_exercise.get("reps_max", 12),
                            "priority": pool_exercise.get("priority", 3),
                            # Ajouter données nécessaires pour ML
                            "muscle_groups": exercise_db.muscle_groups,
                            "equipment_required": exercise_db.equipment_required,
                            "difficulty": exercise_db.difficulty
                        }
                        program_exercises_adapted.append(adapted_exercise)
                
                # Remplacer program.exercises par les données adaptées pour le reste de la logique
                program_exercises_for_ml = program_exercises_adapted
                
                logger.info(f"Format ComprehensiveProgram détecté - {len(program_exercises_for_ml)} exercices dans le pool")
                
            except (IndexError, KeyError) as e:
                logger.error(f"Erreur structure ComprehensiveProgram: {e}")
                raise HTTPException(status_code=400, detail="Structure de programme invalide")
                
        elif program.exercises and isinstance(program.exercises, dict) and program.exercises.get('exercise_pool'):
            # ANCIEN FORMAT avec exercise_pool
            pool = program.exercises.get('exercise_pool', [])
            program_exercises_for_ml = pool
            logger.info(f"Format legacy avec pool détecté - {len(program_exercises_for_ml)} exercices")
            
        else:
            # ANCIEN FORMAT simple liste
            program_exercises_for_ml = program.exercises or []
            logger.info(f"Format legacy simple détecté - {len(program_exercises_for_ml)} exercices")
        
        
        # Nouveau format - sélection intelligente
        exercise_pool = program_exercises_for_ml
        exercise_pool_ids = [ex['exercise_id'] for ex in exercise_pool]
        
        # Récupérer les stats depuis la table de cache
        stats = db.query(ExerciseCompletionStats).filter(
            ExerciseCompletionStats.user_id == user_id,
            ExerciseCompletionStats.exercise_id.in_(exercise_pool_ids)
        ).all()
        
        # Créer un dictionnaire pour accès rapide
        stats_dict = {stat.exercise_id: stat for stat in stats}
        
        # Calculer les scores pour chaque exercice
        exercise_scores = []
        
        for exercise in exercise_pool:
            exercise_id = exercise['exercise_id']
            stat = stats_dict.get(exercise_id)
            
            # Score de fraîcheur (0-1, 1 = pas fait récemment)
            if stat and stat.last_performed:
                # CORRECTION TIMEZONE : s'assurer que last_performed a une timezone
                last_performed = stat.last_performed
                if last_performed.tzinfo is None:
                    last_performed = last_performed.replace(tzinfo=timezone.utc)
                days_since = (datetime.now(timezone.utc) - last_performed).days
                staleness_score = min(1.0, days_since / 7.0)  # Max à 7 jours
            else:
                staleness_score = 1.0  # Jamais fait = priorité max
            
            # Récupérer les infos de l'exercice
            exercise_db = db.query(Exercise).filter(Exercise.id == exercise_id).first()
            if not exercise_db:
                continue
            
            # Score de readiness musculaire
            muscle_readiness = 1.0
            if exercise_db.muscle_groups:
                for muscle in exercise_db.muscle_groups:
                    muscle_normalized = normalize_muscle_group(muscle)
                    readiness = muscle_readiness_dict.get(muscle_normalized, 1.0)
                    muscle_readiness = min(muscle_readiness, readiness)
            
            # Score de déficit de volume
            volume_deficit_score = 0.0
            if exercise_db.muscle_groups:
                for muscle in exercise_db.muscle_groups:
                    muscle_normalized = normalize_muscle_group(muscle)
                    deficit = volume_deficit_dict.get(muscle_normalized, 0.0)
                    volume_deficit_score = max(volume_deficit_score, deficit)
            
            # Score de correspondance avec les focus areas
            focus_match_score = 0.0
            if program.focus_areas and exercise_db.muscle_groups:
                for focus in program.focus_areas:
                    for muscle in exercise_db.muscle_groups:
                        if normalize_muscle_group(muscle) in focus.lower():
                            focus_match_score = 1.0
                            break
            
            # Score combiné
            score = (
                muscle_readiness * 0.4 +
                staleness_score * 0.3 +
                volume_deficit_score * 0.2 +
                focus_match_score * 0.1
            )
            
            exercise_scores.append({
                'exercise': exercise,
                'exercise_db': exercise_db,
                'score': score,
                'staleness': staleness_score,
                'readiness': muscle_readiness,
                'volume_deficit': volume_deficit_score,
                'focus_match': focus_match_score
            })
        
        # Trier par score décroissant
        exercise_scores.sort(key=lambda x: x['score'], reverse=True)
        
        # Sélectionner les exercices pour la séance
        session_duration = program.session_duration_minutes
        selected_exercises = []
        total_duration = 0
        muscle_coverage = set()
        
        for item in exercise_scores:
            exercise = item['exercise']
            exercise_db = item['exercise_db']
            
            # Estimer la durée (5 min par exercice en moyenne)
            estimated_duration = 5
            
            if total_duration + estimated_duration > session_duration:
                break
            
            # Éviter trop d'exercices sur le même muscle
            if exercise_db.muscle_groups:
                muscle_overlap = any(m in muscle_coverage for m in exercise_db.muscle_groups)
                if muscle_overlap and len(selected_exercises) >= 3:
                    continue
                
                muscle_coverage.update(exercise_db.muscle_groups)
            
            # Ajouter l'exercice avec ses métadonnées
            exercise_with_metadata = {
                **item['exercise'],
                'exercise_name': item['exercise_db'].name,
                'muscle_groups': item['exercise_db'].muscle_groups,
                'score': item['score'],
                'selection_reason': _get_selection_reason(item)  # Sans self.
            }
            
            selected_exercises.append(exercise_with_metadata)
            total_duration += estimated_duration
            
            # Limite à 8 exercices max
            if len(selected_exercises) >= 8:
                break
        
        # S'assurer d'avoir au moins 3 exercices
        if len(selected_exercises) < 3 and len(exercise_scores) >= 3:
            selected_exercises = []
            for i in range(min(3, len(exercise_scores))):
                item = exercise_scores[i]
                exercise_with_metadata = {
                    **item['exercise'],
                    'exercise_name': item['exercise_db'].name,
                    'muscle_groups': item['exercise_db'].muscle_groups,
                    'score': item['score'],
                    'selection_reason': _get_selection_reason(item)
                }
                selected_exercises.append(exercise_with_metadata)
        
        # Calculer la distribution musculaire
        muscle_distribution = {}
        for ex in selected_exercises:
            if ex.get('muscle_groups'):
                for muscle in ex['muscle_groups']:
                    muscle_distribution[muscle] = muscle_distribution.get(muscle, 0) + 1
        
        # Métadonnées de la session
        session_metadata = {
            'ml_used': True,
            'ml_confidence': 0.85,  # Valeur fixe pour l'instant
            'muscle_distribution': muscle_distribution,
            'estimated_duration': len(selected_exercises) * 5,
            'warnings': []
        }
        
        # Ajouter des warnings si nécessaire
        for muscle, readiness in muscle_readiness_dict.items():
            if readiness < 0.5 and muscle in muscle_distribution:
                session_metadata['warnings'].append(f"{muscle.capitalize()} encore en récupération")
        

        # Ajouter métadonnées spécifiques au format ComprehensiveProgram
        session_metadata = {
            'ml_used': True,
            'ml_confidence': 0.85,
            'muscle_distribution': muscle_distribution,
            'estimated_duration': len(selected_exercises) * 5,
            'warnings': []
        }
        
        # Si ComprehensiveProgram, ajouter infos de progression
        if hasattr(program, 'weekly_structure') and program.weekly_structure:
            session_metadata.update({
                'week_number': program.current_week,
                'session_number': program.current_session_in_week,
                'total_weeks': program.duration_weeks,
                'focus': session_template.get("focus", "general"),
                'target_duration': session_template.get("target_duration", 60),
                'format': 'comprehensive'
            })
            
            # Avancer à la session suivante pour la prochaine fois
            try:
                program.current_session_in_week += 1
                
                # Si on dépasse les sessions de la semaine, passer à la semaine suivante
                current_week_sessions = len(program.weekly_structure[program.current_week - 1]["sessions"])
                if program.current_session_in_week > current_week_sessions:
                    program.current_session_in_week = 1
                    program.current_week += 1
                    
                    # Si première session d'une nouvelle semaine, marquer le démarrage
                    if not program.started_at:
                        program.started_at = datetime.now(timezone.utc)
                        program.estimated_completion = program.started_at + timedelta(weeks=program.duration_weeks)
                
                db.commit()
                logger.info(f"Progression mise à jour: semaine {program.current_week}, session {program.current_session_in_week}")
                
            except Exception as e:
                logger.warning(f"Erreur mise à jour progression: {e}")
        
        return {
            "selected_exercises": selected_exercises,
            "session_metadata": session_metadata
        }
        
    except Exception as e:
        logger.error(f"Erreur sélection intelligente pour user {user_id}: {str(e)}")
        logger.error(f"Type erreur: {type(e).__name__}")
        
        # Fallback sur première séance du programme v2.0
        if program.weekly_structure and len(program.weekly_structure) > 0:
            try:
                week_data = program.weekly_structure[0]  # Première semaine
                if "sessions" in week_data and len(week_data["sessions"]) > 0:
                    first_session = week_data["sessions"][0]
                    exercise_pool = first_session.get("exercise_pool", [])
                    
                    # Limiter à 6 exercices et enrichir
                    selected = []
                    for ex in exercise_pool[:6]:
                        selected.append({
                            "exercise_id": ex["exercise_id"],
                            "exercise_name": ex.get("exercise_name", ""),
                            "sets": ex.get("sets", 3),
                            "target_reps": (ex.get("reps_min", 8) + ex.get("reps_max", 12)) // 2,
                            "predicted_weight": 20.0,  # Poids par défaut
                            "selection_reason": "Sélection de secours",
                            "priority_score": 0.5
                        })
                    
                    return {
                        "selected_exercises": selected,
                        "session_metadata": {
                            "ml_used": False,
                            "reason": f"Fallback suite erreur: {str(e)}",
                            "estimated_duration": len(selected) * 10,
                            "muscle_distribution": {},
                            "warnings": ["Sélection ML indisponible - programme standard utilisé"]
                        }
                    }
            except Exception as fallback_error:
                logger.error(f"Erreur fallback v2.0: {fallback_error}")
        
        # Si tout échoue
        raise HTTPException(status_code=500, detail="Erreur de sélection d'exercices")


# ===== NOUVEAUX ENDPOINTS PROGRAM BUILDER =====
@app.post("/api/users/{user_id}/program-builder/start", response_model=ProgramBuilderRecommendations)
def start_program_builder(
    user_id: int, 
    builder_data: ProgramBuilderStart, 
    db: Session = Depends(get_db)
):
    """Initialiser ProgramBuilder avec recommandations ML personnalisées"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    try:
        # Utiliser les services ML existants pour personnaliser le questionnaire
        try:
            ml_engine = FitnessMLEngine(db)
        except Exception as e:
            logger.error(f"Impossible d'initialiser FitnessMLEngine: {e}")
            raise HTTPException(status_code=500, detail="Service ML indisponible")
                
        # Analyser le profil utilisateur
        user_insights = []
        suggested_focus_areas = []
        
        # Logique basée sur l'expérience
        if user.experience_level == "beginner":
            suggested_focus_areas = ["pectoraux", "jambes", "abdominaux"]
            user_insights.append("Programme débutant recommandé avec focus équilibré")
        elif user.experience_level == "intermediate":
            suggested_focus_areas = ["pectoraux", "dos", "jambes"]
            user_insights.append("Vous pouvez gérer une intensité modérée à élevée")
        else:  # advanced
            suggested_focus_areas = ["pectoraux", "dos", "jambes"]
            user_insights.append("Programme avancé avec périodisation recommandée")
        
        # Adapter selon l'équipement disponible
        equipment_keys = list(user.equipment_config.keys()) if user.equipment_config else []
        if len(equipment_keys) < 3:
            user_insights.append("Équipement limité détecté - focus sur exercices polyarticulaires")
                
        focus_options = [
            {"value": "pectoraux", "label": "Pectoraux", "recommended": True},
            {"value": "dos", "label": "Dos", "recommended": True},
            {"value": "jambes", "label": "Jambes", "recommended": True},
            {"value": "epaules", "label": "Épaules", "recommended": user.experience_level == "beginner"},
            {"value": "bras", "label": "Bras", "recommended": False},
            {"value": "abdominaux", "label": "Abdominaux", "recommended": user.experience_level == "beginner"}
        ]

        # Générer questionnaire adaptatif (8-12 questions)
        questionnaire_items = [
            {
                "id": "training_frequency",
                "question": "Combien de séances d'entraînement par semaine souhaitez-vous ?",
                "type": "single_choice",
                "options": [
                    {"value": 1, "label": "1 séance/semaine", "recommended": False},
                    {"value": 2, "label": "2 séances/semaine", "recommended": user.experience_level == "beginner"},
                    {"value": 3, "label": "3 séances/semaine", "recommended": user.experience_level == "intermediate"},
                    {"value": 4, "label": "4 séances/semaine", "recommended": user.experience_level in ["intermediate", "advanced"]},
                    {"value": 5, "label": "5 séances/semaine", "recommended": user.experience_level == "advanced"},
                    {"value": 6, "label": "6 séances/semaine", "recommended": False}
                ]
            },
            {
                "id": "session_duration",
                "question": "Combien de temps pouvez-vous consacrer par séance ?",
                "type": "single_choice",
                "options": [
                    {"value": 30, "label": "30-45 minutes"},
                    {"value": 60, "label": "45-75 minutes", "recommended": True},
                    {"value": 90, "label": "75-90 minutes", "recommended": user.experience_level == "advanced"}
                ]
            },
            {
                "id": "focus_selection",
                "question": "Quelles zones corporelles souhaitez-vous prioriser ?",
                "type": "multiple_choice",
                "min_selections": 1,
                "max_selections": 3,
                "options": focus_options
            },
            {
                "id": "periodization_preference", 
                "question": "Quel type de progression préférez-vous ?",
                "type": "single_choice",
                "options": [
                    {"value": "linear", "label": "Progression linéaire constante", "recommended": user.experience_level in ["beginner", "intermediate"]},
                    {"value": "undulating", "label": "Progression ondulante (variation)", "recommended": user.experience_level == "advanced"}
                ]
            },
            {
                "id": "exercise_variety_preference",
                "question": "Niveau de variété d'exercices souhaité ?", 
                "type": "single_choice",
                "options": [
                    {"value": "minimal", "label": "Peu d'exercices, maîtrise technique", "recommended": user.experience_level == "beginner"},
                    {"value": "balanced", "label": "Équilibre variété/consistance", "recommended": True},
                    {"value": "high", "label": "Beaucoup de variété", "recommended": False}
                ]
            },
            {
                "id": "session_intensity_preference",
                "question": "Intensité des séances préférée ?",
                "type": "single_choice", 
                "options": [
                    {"value": "light", "label": "Légère", "recommended": user.experience_level == "beginner"},
                    {"value": "moderate", "label": "Modérée", "recommended": True},
                    {"value": "intense", "label": "Intense", "recommended": user.experience_level == "advanced"}
                ]
            },
            {
                "id": "recovery_priority",
                "question": "Priorité récupération vs performance ?",
                "type": "single_choice",
                "options": [
                    {"value": "performance", "label": "Performance maximale", "recommended": user.experience_level == "advanced"},
                    {"value": "balanced", "label": "Équilibre performance/récupération", "recommended": True},
                    {"value": "recovery", "label": "Récupération prioritaire", "recommended": user.experience_level == "beginner"}
                ]
            }
        ]
        
        # Calcul de la fréquence suggérée
        suggested_frequency = builder_data.training_frequency
        if user.experience_level == "beginner" and suggested_frequency > 4:
            suggested_frequency = 4
            user_insights.append("Fréquence réduite recommandée pour débuter")
        
        return ProgramBuilderRecommendations(
            suggested_duration=builder_data.duration_weeks,
            suggested_frequency=suggested_frequency,
            suggested_focus_areas=suggested_focus_areas,
            questionnaire_items=questionnaire_items,
            user_insights=user_insights,
            confidence_level=0.85
        )
        
    except Exception as e:
        logger.error(f"Erreur initialisation ProgramBuilder pour user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'initialisation")


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

def calculate_exercise_swap_impact(current_ex, new_ex, program_id, db):
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


@app.post("/api/users/{user_id}/program-builder/generate", response_model=ComprehensiveProgramResponse)  
def generate_comprehensive_program(
    user_id: int, 
    selections: ProgramBuilderSelections,
    db: Session = Depends(get_db)
):
    """Générer un programme complet basé sur les sélections utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    try:
        # Désactiver les anciens programmes
        db.query(Program).filter(Program.user_id == user_id).update({"is_active": False})
        
        # Générer la structure temporelle multi-semaines
        weekly_structure = []
        
        # Logique de génération basée sur les sélections utilisateur
        sessions_per_week = getattr(selections, 'training_frequency', 4)  # Utiliser la sélection utilisateur
        session_duration = getattr(selections, 'session_duration', 60)   # Utiliser la sélection utilisateur

        # Ajustements basés sur d'autres préférences (garde la logique existante comme fallback)
        if not hasattr(selections, 'training_frequency'):
            if selections.exercise_variety_preference == "minimal":
                sessions_per_week = 3
            elif selections.exercise_variety_preference == "high":
                sessions_per_week = 5
            
        # Générer structure pour chaque semaine
        for week in range(1, 9):  # 8 semaines par défaut
            week_sessions = []
            
            # Distribution des focus areas sur la semaine
            focus_rotation = selections.focus_areas * (sessions_per_week // len(selections.focus_areas) + 1)
            
            for session_num in range(sessions_per_week):
                focus_area = focus_rotation[session_num % len(selections.focus_areas)]
                
                # Récupérer TOUS les exercices d'abord
                all_exercises = db.query(Exercise).all()
                
                # Filtrer par muscle_groups en Python
                available_exercises = []
                available_equipment = EquipmentService.get_available_equipment_types(user.equipment_config)
                
                for ex in all_exercises:
                    # Vérifier si l'exercice correspond au focus_area avec le nouveau mapping
                    if exercise_matches_focus_area(ex.muscle_groups, focus_area):
                        # Vérifier si l'équipement est disponible
                        if can_perform_exercise(ex, list(available_equipment)):
                            available_exercises.append(ex)
                            
                # CORRECTION CRITIQUE : Ne créer la session QUE si des exercices sont disponibles
                if not available_exercises:
                    logger.warning(f"Aucun exercice trouvé pour focus_area={focus_area}, session ignorée")
                    continue  # Skip cette session complètement

                # Créer pool d'exercices pour cette session
                exercise_pool = []
                # Calculer duration intelligemment
                session_optimization = calculate_session_duration(available_exercises, session_duration)

                # Si les ajustements n'ont pas suffi, réduire encore plus d'exercices
                if not session_optimization["duration_accuracy"]:
                    # Réduire drastiquement le nombre d'exercices
                    max_for_duration = {
                        15: 2, 30: 3, 45: 4, 60: 6, 90: 8
                    }.get(session_duration, 4)
                    
                    shorter_optimization = calculate_session_duration(
                        available_exercises[:max_for_duration], 
                        session_duration
                    )
                    session_optimization = shorter_optimization

                # Utiliser les exercices optimisés
                optimized_exercise_pool = session_optimization["exercise_pool"]

                # Log pour debugging
                logger.info(f"Session {focus_area}: {len(optimized_exercise_pool)} exercices, "
                        f"durée estimée {session_optimization['estimated_duration_minutes']:.1f}min "
                        f"(cible {session_duration}min)")

                # Continuer avec optimized_exercise_pool au lieu de available_exercises[:6]
                for pool_exercise in optimized_exercise_pool:
                    pool_entry = {
                        "exercise_id": pool_exercise["exercise_id"],  # ← CORRECTION
                        "exercise_name": pool_exercise["exercise_name"],  # ← AJOUTER 
                        "sets": pool_exercise.get("sets", 3),  # ← CORRECTION
                        "reps_min": pool_exercise.get("reps_min", 8),  # ← CORRECTION
                        "reps_max": pool_exercise.get("reps_max", 12),  # ← CORRECTION
                        "priority": 3,
                        "constraints": {
                            "min_recovery_hours": 48,
                            "max_frequency_per_week": 2
                        },
                        "muscle_groups": pool_exercise.get("muscle_groups", [])  # ← AJOUTER
                    }
                    exercise_pool.append(pool_entry)
                
                # CORRECTION : Vérifier que exercise_pool n'est pas vide
                if len(exercise_pool) == 0:
                    logger.warning(f"Pool d'exercices vide pour focus_area={focus_area}, session ignorée")
                    continue
                
                session = {
                    "day": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][session_num % 6],
                    "exercise_pool": exercise_pool,
                    "focus": focus_area,
                    "target_duration": 60
                }
                week_sessions.append(session)

            # CORRECTION ADDITIONNELLE : Log du nombre réel de sessions créées
            logger.info(f"Semaine {week}: {len(week_sessions)} sessions créées sur {sessions_per_week} demandées")
            
            weekly_structure.append({
                "week": week,
                "sessions": week_sessions
            })
        
        # Règles de progression
        progression_rules = {
            "intensity_progression": selections.periodization_preference,
            "volume_progression": "linear" if selections.session_intensity_preference == "moderate" else "wave",
            "deload_frequency": 4,
            "weight_increase_percentage": 2.5,
            "rep_increase_threshold": 12
        }
        
        # Calculer score de qualité initial
        base_quality_score = 75.0  # Score de base
        if len(selections.focus_areas) <= 2:
            base_quality_score += 10  # Bonus pour focus ciblé
        if selections.recovery_priority == "balanced":
            base_quality_score += 5   # Bonus pour équilibre
            
        # Créer le programme
        program_name = f"Programme {user.name} - {', '.join(selections.focus_areas)}"
        
        db_program = Program(
            user_id=user_id,
            name=program_name,
            duration_weeks=8,
            periodization_type=selections.periodization_preference,
            sessions_per_week=sessions_per_week,
            session_duration_minutes=session_duration,  # Utilise la sélection utilisateur
            focus_areas=selections.focus_areas,
            weekly_structure=weekly_structure,
            progression_rules=progression_rules,
            base_quality_score=base_quality_score,
            format_version="2.0",
            is_active=True
        )
        
        db.add(db_program)
        db.commit()
        db.refresh(db_program)

        # Générer le schedule initial après la création du programme
        logger.info(f"Génération du schedule pour le programme {db_program.id}")
        populate_program_planning_intelligent(db, db_program)
        db.refresh(db_program)  # Rafraîchir pour récupérer le schedule mis à jour
                
        logger.info(f"Programme complet créé pour user {user_id}: {db_program.id}")

        # NOUVEAU : Générer automatiquement le schedule
        try:
            # Appeler populate_program_planning_intelligent pour créer le schedule
            populate_program_planning_intelligent(db, db_program)
            logger.info(f"Schedule généré automatiquement pour programme {db_program.id}")
        except Exception as e:
            logger.warning(f"Impossible de générer le schedule pour programme {db_program.id}: {e}")
            # Ne pas faire échouer la création du programme si le schedule échoue
        
        return db_program
        
    except Exception as e:
        logger.error(f"Erreur génération programme pour user {user_id}: {str(e)}")
        logger.error(f"Traceback complet: {traceback.format_exc()}")  # Ajouter ceci
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))  # Modifier pour voir l'erreur

@app.put("/api/programs/{program_id}")
def update_program(
    program_id: int,
    update_data: dict,
    db: Session = Depends(get_db)
):
    """Mettre à jour un programme (notamment weekly_structure)"""
    try:
        # Récupérer le programme
        program = db.query(Program).filter(Program.id == program_id).first()
        if not program:
            raise HTTPException(status_code=404, detail="Programme non trouvé")
                
        # Logger pour debug
        logger.info(f"Mise à jour programme {program_id}")
        logger.debug(f"Données reçues: {update_data}")
        
        # Mettre à jour weekly_structure si présent
        if "weekly_structure" in update_data:
            # Validation basique
            if not isinstance(update_data["weekly_structure"], dict):
                raise HTTPException(status_code=400, detail="weekly_structure doit être un objet")
            
            # Vérifier que les jours sont valides
            valid_days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
            for day in update_data["weekly_structure"].keys():
                if day not in valid_days and not day.isdigit():
                    logger.warning(f"Jour invalide ignoré: {day}")
            
            program.weekly_structure = update_data["weekly_structure"]
            logger.info(f"weekly_structure mis à jour avec {len(update_data['weekly_structure'])} jours")
        
        # Mettre à jour d'autres champs si nécessaire
        if "name" in update_data:
            program.name = update_data["name"]
        
        if "duration_weeks" in update_data:
            program.duration_weeks = update_data["duration_weeks"]
        
        # Sauvegarder
        db.commit()
        db.refresh(program)
        
        return {
            "message": "Programme mis à jour avec succès",
            "program": {
                "id": program.id,
                "name": program.name,
                "weekly_structure": program.weekly_structure,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur mise à jour programme {program_id}: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")

@app.post("/api/programs/{program_id}/calculate-session-score")
def calculate_session_score_endpoint(
    program_id: int,
    score_data: dict,
    db: Session = Depends(get_db)
):
    """Calculer le score d'une session"""
    try:
        program = db.query(Program).filter(Program.id == program_id).first()
        if not program:
            raise HTTPException(status_code=404, detail="Programme non trouvé")
        
        exercises = score_data.get("exercises", [])
        if not exercises:
            return {"score": 75.0, "message": "Pas d'exercices fournis"}
        
        # Utiliser la fonction existante
        score = calculate_session_quality_score(exercises, program.user_id, db)
        
        return {
            "score": score,
            "breakdown": {
                "exercise_count": len(exercises),
                "muscle_diversity": len(set(ex.get("muscle_name", "autre") for ex in exercises)),
                "base_score": 75.0,
                "final_score": score
            }
        }
        
    except Exception as e:
        logger.error(f"Erreur calcul score: {str(e)}")
        return {"score": 75.0, "error": str(e)}
    
@app.put("/api/programs/{program_id}/reorder-session")
def reorder_session_exercises(
    program_id: int,
    reorder_data: dict,
    db: Session = Depends(get_db)
):
    """Réorganise les exercices d'une séance avec recalcul du score"""
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    week_index = reorder_data.get("week_index", 0)
    session_index = reorder_data.get("session_index", 0)
    new_order = reorder_data.get("new_exercise_order", [])
    
    # Vérifier format v2.0
    if program.format_version != "2.0" or not program.weekly_structure:
        raise HTTPException(status_code=400, detail="Cette fonction nécessite un programme v2.0")
    
    # Vérifier les indices
    if week_index >= len(program.weekly_structure):
        raise HTTPException(status_code=400, detail="Index de semaine invalide")
    
    week_data = program.weekly_structure[week_index]
    if session_index >= len(week_data.get("sessions", [])):
        raise HTTPException(status_code=400, detail="Index de session invalide")
    
    # Réorganiser
    session = week_data["sessions"][session_index]
    original_pool = session.get("exercise_pool", [])
    
    if len(new_order) != len(original_pool):
        raise HTTPException(status_code=400, detail="Nombre d'indices incorrect")
    
    # Créer le nouvel ordre
    reordered_pool = []
    for idx in new_order:
        if idx < 0 or idx >= len(original_pool):
            raise HTTPException(status_code=400, detail=f"Index {idx} invalide")
        reordered_pool.append(original_pool[idx])
    
    # Mettre à jour
    session["exercise_pool"] = reordered_pool
    
    # Calculer le score
    new_score = calculate_session_quality_score(reordered_pool, program.user_id, db)
    old_score = session.get("quality_score", 75.0)
    
    # Sauvegarder le score
    session["quality_score"] = new_score
    
    # Marquer comme modifié et sauvegarder
    flag_modified(program, "weekly_structure")
    db.commit()
    
    return {
        "success": True,
        "new_score": new_score,
        "score_delta": new_score - old_score,
        "message": f"Score: {new_score:.0f}% ({new_score - old_score:+.0f})"
    }

@app.get("/api/programs/{program_id}/exercise-alternatives")
def get_exercise_alternatives(
    program_id: int,
    week_index: int,
    session_index: int,
    exercise_index: int,
    db: Session = Depends(get_db)
):
    """Obtient les alternatives scorées pour un exercice"""
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    # Récupérer l'exercice actuel
    try:
        session = program.weekly_structure[week_index]["sessions"][session_index]
        current_exercise = session["exercise_pool"][exercise_index]
    except (KeyError, IndexError):
        raise HTTPException(status_code=400, detail="Indices invalides")
    
    current_id = current_exercise.get("exercise_id")
    
    # Récupérer l'exercice de la DB
    current_ex_db = db.query(Exercise).filter(Exercise.id == current_id).first()
    if not current_ex_db:
        raise HTTPException(status_code=404, detail="Exercice non trouvé en base")
    
    # Trouver des alternatives (même muscle principal)
    main_muscle = current_ex_db.muscle_groups[0] if current_ex_db.muscle_groups else None
    
    if main_muscle:
        alternatives = db.query(Exercise).filter(
            Exercise.id != current_id,
            cast(Exercise.muscle_groups, JSONB).contains([main_muscle])  # ✅ PostgreSQL compatible
        ).limit(10).all()
    else:
        alternatives = []
    
    # Scorer les alternatives
    user = db.query(User).filter(User.id == program.user_id).first()
    available_equipment = get_available_equipment(user.equipment_config)
    
    scored_alternatives = []
    for alt in alternatives:
        score = 100
        
        # Pénalité équipement
        if not can_perform_exercise(alt, available_equipment):
            score -= 50
        
        # Bonus focus areas
        for muscle in alt.muscle_groups:
            if muscle in program.focus_areas:
                score += 10
                break
        
        # Pénalité difficulté
        if user.experience_level == "beginner" and alt.difficulty == "advanced":
            score -= 30
        elif user.experience_level == "advanced" and alt.difficulty == "beginner":
            score -= 10
        
        scored_alternatives.append({
            "exercise_id": alt.id,
            "name": alt.name,
            "muscle_groups": alt.muscle_groups,
            "equipment_required": alt.equipment_required,
            "difficulty": alt.difficulty,
            "score": max(0, min(100, score)),
            "can_perform": can_perform_exercise(alt, available_equipment)
        })
    
    # Trier par score
    scored_alternatives.sort(key=lambda x: x["score"], reverse=True)
    
    return {
        "current_exercise": {
            "id": current_ex_db.id,
            "name": current_ex_db.name,
            "muscle_groups": current_ex_db.muscle_groups
        },
        "alternatives": scored_alternatives[:5]
    }

@app.post("/api/programs/{program_id}/swap-exercise")
def swap_exercise_in_program(
    program_id: int,
    swap_data: dict,
    db: Session = Depends(get_db)
):
    """Remplace un exercice dans le programme"""
    program = db.query(Program).filter(Program.id == program_id).first()
    if not program:
        raise HTTPException(status_code=404, detail="Programme non trouvé")
    
    week_index = swap_data.get("week_index", 0)
    session_index = swap_data.get("session_index", 0)
    exercise_index = swap_data.get("exercise_index", 0)
    new_exercise_id = swap_data.get("new_exercise_id")
    
    if not new_exercise_id:
        raise HTTPException(status_code=400, detail="ID du nouvel exercice requis")
    
    # Récupérer le nouvel exercice
    new_exercise = db.query(Exercise).filter(Exercise.id == new_exercise_id).first()
    if not new_exercise:
        raise HTTPException(status_code=404, detail="Nouvel exercice non trouvé")
    
    try:
        # Accéder à la session
        session = program.weekly_structure[week_index]["sessions"][session_index]
        old_exercise = session["exercise_pool"][exercise_index]
        
        # Créer la structure du nouvel exercice
        new_exercise_data = {
            "exercise_id": new_exercise.id,
            "exercise_name": new_exercise.name,
            "sets": old_exercise.get("sets", 3),
            "reps_min": old_exercise.get("reps_min", 8),
            "reps_max": old_exercise.get("reps_max", 12),
            "rest_seconds": old_exercise.get("rest_seconds", 90),
            "muscle_groups": new_exercise.muscle_groups,
            "equipment_required": new_exercise.equipment_required,
            "difficulty": new_exercise.difficulty
        }
        
        # Remplacer
        session["exercise_pool"][exercise_index] = new_exercise_data
        
        # Recalculer le score
        new_score = calculate_session_quality_score(session["exercise_pool"], program.user_id, db)
        old_score = session.get("quality_score", 75.0)
        session["quality_score"] = new_score
        
        # Sauvegarder
        flag_modified(program, "weekly_structure")
        db.commit()
        
        return {
            "success": True,
            "new_exercise": new_exercise_data,
            "score_impact": new_score - old_score,
            "new_score": new_score,
            "message": f"Exercice remplacé. Score: {new_score:.0f}% ({new_score - old_score:+.0f})"
        }
        
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=400, detail=f"Indices invalides: {str(e)}")
    
# ===== ENDPOINTS SÉANCES =====

@app.post("/api/users/{user_id}/workouts")
def start_workout(user_id: int, workout: WorkoutCreate, db: Session = Depends(get_db)):
    """Démarrer une nouvelle séance"""
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
    
    db_workout = Workout(
        user_id=user_id,
        type=workout.type,
        program_id=workout.program_id
    )
    
    db.add(db_workout)
    db.commit()
    db.refresh(db_workout)
    
    # NOUVEAU : Mettre à jour le schedule si c'est un workout de programme
    if workout.program_id:
        program = db.query(Program).filter(Program.id == workout.program_id).first()
        if program and program.schedule:
            today = datetime.now(timezone.utc).date().isoformat()
            if today in program.schedule and program.schedule[today].get("status") == "planned":
                program.schedule[today]["status"] = "in_progress"
                program.schedule[today]["started_at"] = datetime.now(timezone.utc).isoformat()
                flag_modified(program, "schedule")
                db.commit()
                logger.info(f"Schedule mis à jour: session {today} démarrée")
    
    return {"message": "Séance démarrée", "workout": db_workout}

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
            "program_id": workout.program_id,
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

def _enrich_attendance_with_schedule_data(calendar_data: dict, user_id: int, db: Session) -> dict:
    """Enrichit le calendrier avec les données du schedule pour comparaison planifié vs réalisé"""
    
    # Récupérer le programme actif avec son schedule
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program or not program.schedule:
        return calendar_data
    
    # Ajouter les séances planifiées vs réalisées
    enriched_data = calendar_data.copy()
    
    for date_str, session in program.schedule.items():
        session_date = datetime.fromisoformat(date_str).date()
        date_key = session_date.isoformat()
        
        if date_key not in enriched_data:
            enriched_data[date_key] = {"workouts": 0, "volume": 0, "duration": 0}
        
        # Ajouter info planning
        enriched_data[date_key]["planned"] = True
        enriched_data[date_key]["status"] = session.get("status", "planned")
        enriched_data[date_key]["predicted_score"] = session.get("predicted_score", 0)
        
        # Marquer les séances manquées
        if session.get("status") == "planned" and session_date < datetime.now(timezone.utc).date():
            enriched_data[date_key]["missed_planned"] = True
    
    return enriched_data

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

def populate_program_planning_intelligent(db: Session, program):
    """Génère intelligemment le schedule du programme"""
    
    if not program.weekly_structure or not program.duration_weeks:
        logger.warning(f"Programme {program.id} sans structure complète")
        return
        
    # Démarrer à partir de lundi prochain
    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    start_date = today + timedelta(days=days_until_monday if days_until_monday > 0 else 7)
    
    # Analyser la structure pour optimiser l'espacement
    if isinstance(program.weekly_structure, dict):
        days_with_sessions = [day for day, sessions in program.weekly_structure.items() if sessions]
        sessions_per_week = len(days_with_sessions)
    elif isinstance(program.weekly_structure, list) and program.weekly_structure:
        sessions_per_week = len(program.weekly_structure[0].get("sessions", []))
    else:
        sessions_per_week = program.sessions_per_week or 3
    
    # Calculer l'espacement optimal
    optimal_spacing = calculate_optimal_session_spacing(sessions_per_week, {})
    
    # Initialiser le schedule
    if not program.schedule:
        program.schedule = {}
    
    # Générer les séances pour toute la durée
    for week_index in range(program.duration_weeks):
        for session_index, day_offset in enumerate(optimal_spacing):
            session_date = start_date + timedelta(weeks=week_index, days=day_offset)
            date_str = session_date.isoformat()
            
            # Extraire la session template appropriée
            session_template = None
            if isinstance(program.weekly_structure, dict):
                day_name = session_date.strftime('%A').lower()
                day_sessions = program.weekly_structure.get(day_name, [])
                if session_index < len(day_sessions):
                    session_template = day_sessions[session_index]
            else:
                # Format array
                week_template_index = week_index % len(program.weekly_structure)
                week_data = program.weekly_structure[week_template_index]
                week_sessions = week_data.get("sessions", [])
                if session_index < len(week_sessions):
                    session_template = week_sessions[session_index]
            
            if not session_template:
                continue
            
            # Adapter les exercices pour éviter répétitions
            base_exercises = session_template.get("exercise_pool", [])
            adapted_exercises = adapt_session_exercises(
                base_exercises, program.user_id, session_date, db
            )
            
            # Calculer le score prédictif ML
            quality_score = calculate_session_quality_score(
                adapted_exercises, program.user_id, db
            )
            
            # Créer l'entrée du schedule
            program.schedule[date_str] = {
                "session_ref": f"{week_index}_{session_index}",
                "time": "18:00",  # Heure par défaut
                "status": "planned",
                "predicted_score": quality_score,
                "actual_score": None,
                "exercises_snapshot": adapted_exercises,
                "primary_muscles": extract_primary_muscles(adapted_exercises),
                "estimated_duration": session_template.get("estimated_duration_minutes", 60),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "modifications": []
            }
    
    # Mettre à jour les métadonnées
    flag_modified(program, "schedule")
    update_program_schedule_metadata(program, db)
    
    logger.info(f"Schedule généré: {len(program.schedule)} séances pour programme {program.id}")

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

@app.post("/api/users/{user_id}/populate-planning-intelligent")
def populate_user_planning_intelligent(user_id: int, db: Session = Depends(get_db)):
    """Crée intelligemment le schedule complet pour le programme actif"""
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        raise HTTPException(status_code=404, detail="Aucun programme actif trouvé")
    
    try:
        # Vérifier que le programme a la structure nécessaire
        if not program.weekly_structure:
            raise HTTPException(status_code=400, detail="Programme sans structure weekly_structure")
        
        # Si un schedule existe déjà, le sauvegarder
        if program.schedule:
            if not program.schedule_metadata:
                program.schedule_metadata = {}
            program.schedule_metadata["previous_schedule_backup"] = program.schedule
            program.schedule_metadata["regenerated_at"] = datetime.now(timezone.utc).isoformat()
        
        # Générer le nouveau schedule complet
        populate_program_planning_intelligent(db, program)
        
        # Mettre à jour les métadonnées du programme
        program.started_at = datetime.now(timezone.utc)
        flag_modified(program, "schedule")
        flag_modified(program, "schedule_metadata")
        
        db.commit()
        db.refresh(program)
        
        # Compter les sessions créées
        total_sessions = len(program.schedule)
        completed_sessions = len([
            s for s in program.schedule.values() 
            if s.get("status") == "completed"
        ])
        
        return {
            "message": f"Planning intelligent créé avec {total_sessions} séances",
            "total_sessions": total_sessions,
            "completed_sessions": completed_sessions,
            "duration_weeks": program.duration_weeks,
            "sessions_per_week": program.sessions_per_week,
            "start_date": min(program.schedule.keys()) if program.schedule else None,
            "end_date": max(program.schedule.keys()) if program.schedule else None,
            "schedule_metadata": program.schedule_metadata
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur création planning intelligent: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

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
def get_volume_burndown(user_id: int, period: str, db: Session = Depends(get_db)):
    """Graphique burndown du volume depuis le schedule - VERSION CORRIGÉE"""
    
    if period not in ["week", "month", "quarter", "year"]:
        period = "week"  # Fallback par défaut
    
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program or not program.schedule:
        return {
            "dailyVolumes": [],
            "targetVolume": 0,
            "currentVolume": 0,
            "projection": {"onTrack": False, "dailyRateNeeded": 0}
        }
    
    # Réutiliser la logique existante mais adapter le format
    planned_volume = 0
    completed_volume = 0
    daily_volumes = []
    
    for date_str in sorted(program.schedule.keys()):
        session = program.schedule[date_str]
        session_volume = len(session.get("exercises_snapshot", []))
        planned_volume += session_volume
        
        if session.get("status") == "completed":
            completed_volume += session_volume
        
        daily_volumes.append({
            "date": date_str,
            "cumulativeVolume": completed_volume
        })
    
    # Calcul projection simple
    if planned_volume > 0:
        completion_rate = (completed_volume / planned_volume) * 100
        on_track = completion_rate >= 80
        daily_rate_needed = max(0, (planned_volume - completed_volume) / 7)
    else:
        on_track = True
        daily_rate_needed = 0
    
    return {
        "dailyVolumes": daily_volumes,
        "targetVolume": planned_volume,
        "currentVolume": completed_volume,
        "projection": {
            "onTrack": on_track,
            "dailyRateNeeded": daily_rate_needed
        }
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
    
def update_program_schedule_metadata(program: Program, db: Session):
    """Met à jour les métriques précalculées du schedule"""
    
    if not program.schedule:
        return
    
    metadata = {
        "total_sessions_planned": 0,
        "sessions_completed": 0,
        "sessions_skipped": 0,
        "sessions_in_progress": 0,
        "total_actual_score": 0,
        "total_predicted_score": 0,
        "muscle_distribution": {},
        "last_metrics_update": datetime.now(timezone.utc).isoformat()
    }
    
    # Calculer les métriques depuis le schedule
    for date, session in program.schedule.items():
        metadata["total_sessions_planned"] += 1
        
        status = session.get("status", "planned")
        if status == "completed":
            metadata["sessions_completed"] += 1
            if session.get("actual_score"):
                metadata["total_actual_score"] += session["actual_score"]
        elif status == "skipped":
            metadata["sessions_skipped"] += 1
        elif status == "in_progress":
            metadata["sessions_in_progress"] += 1
            
        if session.get("predicted_score"):
            metadata["total_predicted_score"] += session["predicted_score"]
        
        # Distribution musculaire
        exercises = session.get("exercises_snapshot", [])
        for ex in exercises:
            for muscle in ex.get("muscle_groups", []):
                metadata["muscle_distribution"][muscle] = metadata["muscle_distribution"].get(muscle, 0) + 1
    
    # Moyennes
    if metadata["sessions_completed"] > 0:
        metadata["average_actual_score"] = metadata["total_actual_score"] / metadata["sessions_completed"]
        metadata["completion_rate"] = (metadata["sessions_completed"] / metadata["total_sessions_planned"]) * 100
    
    if metadata["total_sessions_planned"] > 0:
        metadata["average_predicted_score"] = metadata["total_predicted_score"] / metadata["total_sessions_planned"]
    
    # Calculer les 3 prochaines séances
    today = datetime.now(timezone.utc).date()
    next_sessions = []
    
    for date_str in sorted(program.schedule.keys()):
        session_date = datetime.fromisoformat(date_str).date()
        if session_date >= today and program.schedule[date_str].get("status") == "planned":
            session = program.schedule[date_str]
            muscles = set()
            for ex in session.get("exercises_snapshot", []):
                muscles.update(ex.get("muscle_groups", []))
            
            next_sessions.append({
                "date": date_str,
                "muscles": list(muscles),
                "predicted_score": session.get("predicted_score", 75)
            })
            
            if len(next_sessions) >= 3:
                break
    
    metadata["next_sessions"] = next_sessions
    
    # Sauvegarder
    program.schedule_metadata = metadata
    flag_modified(program, "schedule_metadata")
    db.commit()