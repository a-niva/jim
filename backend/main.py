# ===== backend/main.py - VERSION REFACTORISÉE =====
from fastapi import FastAPI, HTTPException, Depends, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func, desc, cast, text, distinct
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import json
import os
import logging
from backend.ml_recommendations import FitnessRecommendationEngine
from backend.ml_engine import RecoveryTracker, VolumeOptimizer, ProgressionAnalyzer
from backend.constants import normalize_muscle_group 
from backend.database import engine, get_db, SessionLocal
from backend.models import Base, User, Exercise, Program, Workout, WorkoutSet, SetHistory, UserCommitment, AdaptiveTargets, UserAdaptationCoefficients, PerformanceStates, ExerciseCompletionStats
from backend.schemas import UserCreate, UserResponse, ProgramCreate, WorkoutCreate, SetCreate, ExerciseResponse, UserPreferenceUpdate
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
        
        db_user = User(**user.dict())
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        
        logger.info(f"User créé avec ID: {db_user.id}")
        return db_user
    except Exception as e:
        logger.error(f"❌ Erreur création user: {str(e)}")
        logger.error(f"🔍 Type erreur: {type(e).__name__}")
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
    
    db.commit()
    db.refresh(user)
    
    logger.info(f"Préférences mises à jour pour user {user_id}: poids variables = {user.prefer_weight_changes_between_sets}, sons = {user.sound_notifications_enabled}")
    
    return {
        "message": "Préférences mises à jour avec succès",
        "prefer_weight_changes_between_sets": user.prefer_weight_changes_between_sets,
        "sound_notifications_enabled": user.sound_notifications_enabled
    }

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
    
    # Les workouts/programs ont cascade configuré, donc seront supprimés automatiquement
    db.query(ExerciseCompletionStats).filter(ExerciseCompletionStats.user_id == user_id).delete(synchronize_session=False)
    db.query(UserAdaptationCoefficients).filter(UserAdaptationCoefficients.user_id == user_id).delete(synchronize_session=False)
    db.query(PerformanceStates).filter(PerformanceStates.user_id == user_id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"message": "Profil supprimé avec succès"}

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
    
    # Générer les exercices du programme basé sur les focus_areas
    exercises = generate_program_exercises(user, program, db)
    
    db_program = Program(
        user_id=user_id,
        name=program.name,
        sessions_per_week=program.sessions_per_week,
        session_duration_minutes=program.session_duration_minutes,
        focus_areas=program.focus_areas,
        exercises=exercises,
        is_active=True
    )
    
    db.add(db_program)
    db.commit()
    db.refresh(db_program)
    return db_program


@app.get("/api/users/{user_id}/program-status")
def get_program_status(user_id: int, db: Session = Depends(get_db)):
    """Obtenir le statut actuel du programme de l'utilisateur"""
    
    # Récupérer le programme actif
    """Obtenir le statut actuel du programme de l'utilisateur"""
    
    # Récupérer le programme actif
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        return None
    
    # Calculer la semaine actuelle (depuis la création du programme)
    from datetime import datetime, timedelta, timezone
    weeks_elapsed = (datetime.now() - program.created_at).days // 7
    # Utiliser la durée réelle du programme si disponible, sinon 4 semaines
    total_weeks = len(set(ex.get('week', 1) for ex in program.exercises)) if program.exercises else 4
    current_week = min(weeks_elapsed + 1, total_weeks)
    
    # Compter les séances de cette semaine
    now = datetime.now(timezone.utc)
    start_of_week = now - timedelta(days=now.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
    
    sessions_this_week = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.type == 'program',
        Workout.started_at >= start_of_week  # CORRIGÉ
    ).count()
    
    # Analyser la dernière séance pour les adaptations ML
    last_workout = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.type == 'program'
    ).order_by(Workout.started_at.desc()).first()
    
    ml_adaptations = "Standard"
    if last_workout:
        # Calculer la tendance des dernières séances
        recent_sets = db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user_id,
            Workout.type == 'program',
            WorkoutSet.completed_at >= datetime.now() - timedelta(days=7)
        ).all()
        
        if recent_sets:
            avg_effort = sum(s.effort_level or 3 for s in recent_sets) / len(recent_sets)
            avg_fatigue = sum(s.fatigue_level or 3 for s in recent_sets) / len(recent_sets)
            
            if avg_effort > 4 and avg_fatigue < 3:
                ml_adaptations = "Volume +5% (excellente forme)"
            elif avg_fatigue > 4:
                ml_adaptations = "Volume -10% (fatigue détectée)"
            elif avg_effort < 3:
                ml_adaptations = "Charge +2.5kg (marge de progression)"
    
    # Analyser les exercices du programme pour déterminer les muscles de la prochaine séance
    # Créer des groupes de séances basés sur les exercices réels
    from collections import defaultdict
    
    # Grouper les exercices par pattern de muscles
    session_patterns = defaultdict(list)
    if program.exercises:
        for ex in program.exercises:
            # Utiliser le nom de l'exercice et ses groupes musculaires
            exercise_db = db.query(Exercise).filter(Exercise.id == ex.get('exercise_id')).first()
            if exercise_db and exercise_db.muscle_groups:
                # Créer une clé unique pour ce pattern de muscles
                muscle_key = tuple(sorted(exercise_db.muscle_groups))
                session_patterns[muscle_key].append(exercise_db.name)
    
    # Si on a des patterns, les utiliser pour déterminer la prochaine séance
    if session_patterns:
        patterns_list = list(session_patterns.keys())
        total_program_sessions = db.query(Workout).filter(
            Workout.user_id == user_id,
            Workout.type == 'program',
            Workout.program_id == program.id
        ).count()
        
        pattern_index = total_program_sessions % len(patterns_list)
        next_pattern = patterns_list[pattern_index]
        
        # Formater les muscles pour l'affichage
        muscle_names = [m.capitalize() for m in next_pattern]
        if len(muscle_names) > 2:
            next_muscles = f"{', '.join(muscle_names[:2])} + autres"
        else:
            next_muscles = ' + '.join(muscle_names)
        
        # Compter les exercices pour cette séance
        exercises_count = len(session_patterns[next_pattern])
    else:
        # Fallback si pas de patterns détectables
        next_muscles = "Séance complète"
        exercises_count = min(6, len(program.exercises) if program.exercises else 4)
    
    return {
        "current_week": current_week,
        "total_weeks": total_weeks,
        "sessions_this_week": sessions_this_week,
        "target_sessions": program.sessions_per_week,
        "next_session_preview": {
            "muscles": next_muscles,
            "exercises_count": exercises_count,
            "estimated_duration": program.session_duration_minutes,
            "ml_adaptations": ml_adaptations
        },
        "on_track": sessions_this_week >= max(1, int(program.sessions_per_week * ((datetime.now().weekday() + 1) / 7))),
        "program_name": program.name,
        "created_weeks_ago": weeks_elapsed
    }

@app.get("/api/users/{user_id}/programs/active")
def get_active_program(user_id: int, db: Session = Depends(get_db)):
    """Récupérer le programme actif d'un utilisateur"""
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        return None
    
    # Détecter le format du programme
    program_data = dict(program.__dict__)
    
    # Nouveau format (v2.0) avec exercise_pool
    if isinstance(program.exercises, dict) and program.exercises.get('version') == '2.0':
        program_data['format'] = 'dynamic'
        program_data['exercise_pool'] = program.exercises.get('exercise_pool', [])
        program_data['session_templates'] = program.exercises.get('session_templates', {})
        logger.info(f"Programme v2.0 détecté: {len(program_data['exercise_pool'])} exercices dans pool")
    
    # Ancien format (liste d'exercices)
    else:
        program_data['format'] = 'static'
        # Enrichir les exercices avec leurs noms si nécessaire (compatibilité)
        if program.exercises and isinstance(program.exercises, list):
            for ex in program.exercises:
                if 'exercise_name' not in ex and 'exercise_id' in ex:
                    exercise_db = db.query(Exercise).filter(Exercise.id == ex['exercise_id']).first()
                    if exercise_db:
                        ex['exercise_name'] = exercise_db.name
        logger.info(f"Programme v1.0 détecté: {len(program.exercises) if program.exercises else 0} exercices statiques")
    
    return program_data

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
            # Ancien format - fallback sur sélection statique
            if program.exercises and isinstance(program.exercises, list):
                return {
                    "selected_exercises": program.exercises[:6],  # Prendre les 6 premiers
                    "session_metadata": {
                        "ml_used": False,
                        "reason": "Programme format v1.0"
                    }
                }
            else:
                raise HTTPException(status_code=400, detail="Format de programme invalide")
        
        # Nouveau format - sélection intelligente
        exercise_pool = program.exercises.get('exercise_pool', [])
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
                days_since = (datetime.now(timezone.utc) - stat.last_performed).days
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
        
        return {
            "selected_exercises": selected_exercises,
            "session_metadata": session_metadata
        }
        
    except Exception as e:
        logger.error(f"Erreur sélection intelligente pour user {user_id}: {str(e)}")
        logger.error(f"Type erreur: {type(e).__name__}")
        
        # Fallback sur sélection basique
        if program.exercises and isinstance(program.exercises, dict):
            pool = program.exercises.get('exercise_pool', [])
            return {
                "selected_exercises": pool[:6],
                "session_metadata": {
                    "ml_used": False,
                    "reason": f"Erreur ML: {str(e)}"
                }
            }
        else:
            raise HTTPException(status_code=500, detail="Erreur de sélection d'exercices")

def generate_program_exercises(user: User, program: ProgramCreate, db: Session) -> List[Dict[str, Any]]:
    """Génère une liste d'exercices pour le programme basé sur les zones focus"""
    import logging
    logger = logging.getLogger(__name__)
    
    # 1. Récupérer TOUS les exercices une seule fois
    all_exercises = db.query(Exercise).all()
    logger.info(f"Total exercices en DB: {len(all_exercises)}")
    
    # 2. Obtenir équipement disponible
    available_equipment = get_available_equipment(user.equipment_config)
    logger.info(f"Équipement disponible: {available_equipment}")
    
    # 3. Filtrer par niveau d'expérience
    level_mapping = {
        'beginner': ['beginner', 'intermediate'],
        'intermediate': ['beginner', 'intermediate', 'advanced'], 
        'advanced': ['beginner', 'intermediate', 'advanced']
    }
    allowed_difficulties = level_mapping.get(user.experience_level, ['beginner'])
    
    level_filtered = [
        ex for ex in all_exercises 
        if ex.difficulty in allowed_difficulties
    ]
    logger.info(f"Après filtre niveau {user.experience_level}: {len(level_filtered)} exercices")
    
    # 4. Filtrer par équipement disponible
    equipment_filtered = []
    for ex in level_filtered:
        if can_perform_exercise(ex, available_equipment):
            equipment_filtered.append(ex)
    
    logger.info(f"Après filtre équipement: {len(equipment_filtered)} exercices")
    
    # 5. Grouper par focus_areas
    exercises_by_focus = {}
    for focus_area in program.focus_areas:
        matching_exercises = [
            ex for ex in equipment_filtered
            if ex.muscle_groups and focus_area in ex.muscle_groups
        ]
        exercises_by_focus[focus_area] = matching_exercises
        logger.info(f"Focus '{focus_area}': {len(matching_exercises)} exercices")
    
    # 6. Sélectionner exercices par focus area
    selected_exercises = []
    max_exercises_per_focus = 2  # Maximum 2 exercices par focus area
    
    for focus_area, exercises in exercises_by_focus.items():
        if exercises:
            # Prendre les premiers exercices (pourrait être randomisé)
            selected = exercises[:max_exercises_per_focus]
            selected_exercises.extend(selected)
            logger.info(f"Sélectionné {len(selected)} exercices pour '{focus_area}'")
    
    # 7. Limiter le nombre total d'exercices selon la durée
    duration_limits = {
        15: 2,   # 15min = max 2 exercices
        30: 4,   # 30min = max 4 exercices  
        45: 6,   # 45min = max 6 exercices
        60: 8,   # 60min = max 8 exercices
        90: 10   # 90min = max 10 exercices
    }
    
    max_total = duration_limits.get(program.session_duration_minutes, 6)
    if len(selected_exercises) > max_total:
        selected_exercises = selected_exercises[:max_total]
        logger.info(f"Limité à {max_total} exercices pour {program.session_duration_minutes}min")
    
    # Construire le pool d'exercices avec métadonnées ML
    exercise_pool = []
    for ex in selected_exercises:
        # Calculer priorité basée sur focus areas
        priority = 3  # neutre par défaut
        if ex.muscle_groups:
            for muscle in ex.muscle_groups:
                if muscle.lower() in [fa.lower() for fa in program.focus_areas]:
                    priority = 5  # prioritaire
                    break
        
        exercise_pool.append({
            "exercise_id": ex.id,
            "exercise_name": ex.name,
            "priority": priority,
            "constraints": {
                "min_recovery_hours": 48,
                "max_frequency_per_week": 2,
                "required_equipment": ex.equipment_required or []
            },
            "default_sets": ex.default_sets,
            "default_reps_range": [ex.default_reps_min, ex.default_reps_max],
            "muscle_groups": ex.muscle_groups
        })
    
    # Structure du nouveau format
    return {
        "exercise_pool": exercise_pool,
        "session_templates": {
            "rotation": determine_rotation_pattern(program.focus_areas),
            "exercises_per_session": min(6, program.session_duration_minutes // 10),
            "target_duration": program.session_duration_minutes
        }
    }

def determine_rotation_pattern(focus_areas: List[str]) -> List[str]:
    """Détermine le pattern de rotation optimal"""
    if set(focus_areas) & {"upper_body", "arms", "shoulders"}:
        if set(focus_areas) & {"legs", "core"}:
            return ["upper_body", "lower_body"]
        else:
            return ["push", "pull", "full_body"]
    elif "legs" in focus_areas and len(focus_areas) > 1:
        return ["upper_body", "lower_body"]
    else:
        return ["full_body"]
    
    # Détecter rotation basée sur focus areas
    rotation_pattern = ["full_body"]  # Défaut
    if len(program.focus_areas) >= 2:
        if "upper_body" in program.focus_areas and "legs" in program.focus_areas:
            rotation_pattern = ["upper", "lower"]
        elif len(program.focus_areas) >= 3:
            rotation_pattern = ["push", "pull", "legs"]
    
    program_structure = {
        "version": "2.0",  # Marquer nouveau format
        "exercise_pool": exercise_pool,
        "session_templates": {
            "rotation": rotation_pattern,
            "exercises_per_session": min(6, program.session_duration_minutes // 10),
            "target_duration": program.session_duration_minutes
        }
    }
    
    logger.info(f"Nouveau format: {len(exercise_pool)} exercices dans pool, rotation {rotation_pattern}")
    return program_structure


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
    return {"message": "Séance démarrée", "workout": db_workout}

@app.get("/api/users/{user_id}/workouts/active")
def get_active_workout(user_id: int, db: Session = Depends(get_db)):
    """Récupérer la séance active"""
    workout = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "active"
    ).first()
    
    return workout

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
        ml_adjustment_enabled=set_data.ml_adjustment_enabled
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
    
    # NOUVEAU: Extraire les données de séance en cours
    session_history = request.get('session_history', [])
    completed_sets_count = request.get('completed_sets_this_exercise', 0)
    set_number = request.get("set_number", 1)
    current_fatigue = request.get("current_fatigue", 3)
    previous_effort = request.get("previous_effort", 3)
    
    # Obtenir recommandations de base du ML
    base_recommendations = ml_engine.get_set_recommendations(
        user=user,
        exercise=exercise,
        set_number=set_number,
        current_fatigue=current_fatigue,
        current_effort=previous_effort,
        last_rest_duration=request.get("last_rest_duration"),
        exercise_order=request.get("exercise_order", 1),
        set_order_global=request.get("set_order_global", 1),
        available_weights=available_weights,
        workout_id=workout_id
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
    
    # LOGGING pour debug et amélioration continue
    logger.info(f"Recommandations pour user {user.id}, exercise {exercise.id}, set {set_number}:")
    logger.info(f"  Base: {base_recommendations.get('baseline_weight')}kg x {base_recommendations.get('reps_recommendation')} reps")
    logger.info(f"  Confiance: {base_recommendations.get('confidence', 0):.2f}")
    logger.info(f"  Historique séance: {len(session_history)} séries")
    if base_recommendations.get('reasoning'):
        logger.info(f"  Raison: {base_recommendations['reasoning']}")
    
    return base_recommendations

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
def complete_workout(workout_id: int, data: Dict[str, int] = {}, db: Session = Depends(get_db)):
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
    
    db.commit()
    return {"message": "Séance terminée", "workout": workout}

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
    """Graphique 5: Calendrier d'assiduité avec séances manquées"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=months * 30)
    
    # Récupérer toutes les séances
    workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.started_at >= cutoff_date
    ).all()
    
    # Récupérer l'engagement utilisateur
    commitment = db.query(UserCommitment).filter(
        UserCommitment.user_id == user_id
    ).first()
    
    target_per_week = commitment.sessions_per_week if commitment else 3
    
    # Organiser par date
    calendar_data = defaultdict(lambda: {"workouts": 0, "volume": 0, "duration": 0})
    
    for workout in workouts:
        date_key = workout.started_at.date().isoformat()
        calendar_data[date_key]["workouts"] += 1
        
        if workout.total_duration_minutes:
            calendar_data[date_key]["duration"] += workout.total_duration_minutes
        
        # Calculer le volume total
        sets = db.query(WorkoutSet).filter(WorkoutSet.workout_id == workout.id).all()
        ml_engine = FitnessRecommendationEngine(db)
        volume = 0
        for s in sets:
            exercise = db.query(Exercise).filter(Exercise.id == s.exercise_id).first()
            if exercise:
                user = db.query(User).filter(User.id == user_id).first()
                volume += ml_engine.calculate_exercise_volume(s.weight, s.reps, exercise, user)
        calendar_data[date_key]["volume"] += volume
    
    # Identifier les semaines avec séances manquantes
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


@app.get("/api/users/{user_id}/stats/volume-burndown/{period}")
def get_volume_burndown(
    user_id: int,
    period: str,  # week, month, quarter, year
    db: Session = Depends(get_db)
):
    """Graphique 7: Burndown chart volume avec différentes périodes - CORRIGÉ"""
    now = datetime.now(timezone.utc)
    
    # Récupérer l'utilisateur pour avoir sa date de création
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Déterminer les dates selon la période - TOUJOURS AVEC TIMEZONE
    if period == "week":
        start_date = now - timedelta(days=now.weekday())
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        end_date = start_date + timedelta(days=6)
        end_date = end_date.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        days_in_period = 7
    elif period == "month":
        start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        # Calculer le dernier jour du mois
        if now.month == 12:
            end_date = now.replace(year=now.year + 1, month=1, day=1, tzinfo=timezone.utc) - timedelta(days=1)
        else:
            end_date = now.replace(month=now.month + 1, day=1, tzinfo=timezone.utc) - timedelta(days=1)
        end_date = end_date.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        days_in_period = (end_date - start_date).days + 1
    elif period == "quarter":
        quarter = (now.month - 1) // 3
        start_date = datetime(now.year, quarter * 3 + 1, 1, tzinfo=timezone.utc)
        # Calcul plus précis de la fin du trimestre
        if quarter < 3:
            end_date = datetime(now.year, (quarter + 1) * 3 + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
        else:
            end_date = datetime(now.year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        days_in_period = (end_date - start_date).days + 1
    else:  # year
        start_date = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        end_date = now.replace(month=12, day=31, hour=23, minute=59, second=59, tzinfo=timezone.utc)
        days_in_period = 365
    
    # Ajuster start_date si l'utilisateur a été créé après - GARDER TIMEZONE
    user_created_date = user.created_at.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    if user_created_date > start_date:
        start_date = user_created_date
        # Recalculer days_in_period
        days_in_period = (end_date - start_date).days + 1
    
    # Récupérer les targets adaptatifs
    targets = db.query(AdaptiveTargets).filter(
        AdaptiveTargets.user_id == user_id
    ).all()
    
    total_target_volume = sum(t.target_volume for t in targets if t.target_volume is not None) * (days_in_period / 7)
    
    # Calculer le volume réalisé jour par jour
    daily_volumes = []
    cumulative_volume = 0
    
    current = start_date
    while current <= min(end_date, now):
        day_sets = db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user_id,
            func.date(Workout.started_at) == current.date()
        ).all()
        
        ml_engine = FitnessRecommendationEngine(db)
        day_volume = 0
        for s in day_sets:
            exercise = db.query(Exercise).filter(Exercise.id == s.exercise_id).first()
            if exercise:
                # Récupérer l'user depuis le workout
                workout = db.query(Workout).filter(Workout.id == s.workout_id).first()
                if workout:
                    user_obj = db.query(User).filter(User.id == workout.user_id).first()
                    if user_obj:
                        day_volume += ml_engine.calculate_exercise_volume(s.weight, s.reps, exercise, user_obj)
        
        cumulative_volume += day_volume
        
        daily_volumes.append({
            "date": current.date().isoformat(),
            "dailyVolume": day_volume,
            "cumulativeVolume": cumulative_volume,
            "remainingTarget": max(0, total_target_volume - cumulative_volume),
            "percentComplete": (cumulative_volume / total_target_volume * 100) if total_target_volume > 0 else 0
        })
        
        current += timedelta(days=1)
    
    # Projection pour les jours restants
    days_elapsed = (now - start_date).days + 1
    days_remaining = max(1, days_in_period - days_elapsed)
    daily_rate_needed = (total_target_volume - cumulative_volume) / days_remaining if days_remaining > 0 else 0
    
    return {
        "period": period,
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "targetVolume": round(total_target_volume),
        "currentVolume": round(cumulative_volume),
        "dailyVolumes": daily_volumes,
        "projection": {
            "dailyRateNeeded": round(daily_rate_needed),
            "onTrack": cumulative_volume >= (total_target_volume * days_elapsed / days_in_period)
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
                "recoveryPercent": round(recovery_percent, 1),
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
    """Version corrigée avec validation des poids pairs"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.equipment_config:
        raise HTTPException(status_code=400, detail="Configuration manquante")
    
    # Déterminer équipement depuis l'exercice
    exercise_equipment = ['barbell']  # default
    if exercise_id:
        exercise = db.query(Exercise).filter(Exercise.id == exercise_id).first()
        if exercise:
            # Validation poids pair pour dumbbells
            if 'dumbbells' in exercise_equipment and weight % 2 != 0:
                return {
                    'feasible': False,
                    'reason': f'Poids impair ({weight}kg) impossible avec des haltères. Utilisez {int(weight/2)*2}kg ou {int(weight/2)*2+2}kg.',
                    'type': 'error'
                }
            exercise_equipment = exercise.equipment_required
    
    try:
        layout = EquipmentService.get_plate_layout(user_id, weight, exercise_equipment, user.equipment_config)
        return layout
    except Exception as e:
        logger.error(f"Erreur layout user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Erreur calcul")

@app.put("/api/users/{user_id}/plate-helper")  
def toggle_plate_helper(user_id: int, enabled: bool = Body(..., embed=True), db: Session = Depends(get_db)):
    """Toggle aide montage"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.show_plate_helper = enabled
    db.commit()
    return {"enabled": enabled}

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
        # Validation des données reçues
        required_fields = ['exercise_id', 'recommendation', 'accepted']
        if not all(field in feedback_data for field in required_fields):
            raise HTTPException(status_code=400, detail="Champs manquants")
        
        # Logs pour amélioration future du modèle
        logger.info(f"ML feedback reçu:")
        logger.info(f"  Exercise: {feedback_data['exercise_id']}")
        logger.info(f"  Recommandation suivie: {feedback_data['accepted']}")
        logger.info(f"  Données: {feedback_data['recommendation']}")
        
        # Ici on pourrait enrichir la base SetHistory avec le feedback
        # Pour l'instant on accepte juste la requête
        
        return {"status": "success", "message": "Feedback ML enregistré"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur enregistrement ML feedback: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")