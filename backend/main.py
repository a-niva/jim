# ===== backend/main.py - VERSION REFACTORISÉE =====
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, cast, text
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import json
import os
import logging
from backend.ml_recommendations import FitnessRecommendationEngine
from backend.database import engine, get_db, SessionLocal
from backend.models import Base, User, Exercise, Program, Workout, WorkoutSet, SetHistory, UserCommitment, AdaptiveTargets
from backend.schemas import UserCreate, UserResponse, ProgramCreate, WorkoutCreate, SetCreate, ExerciseResponse
from sqlalchemy import extract, and_
import calendar
from collections import defaultdict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Créer les tables
Base.metadata.create_all(bind=engine)

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
                existing = db.query(Exercise).filter(Exercise.name == exercise_data["name"]).first()
                if existing:
                    continue
                    
                exercise = Exercise(
                    name=exercise_data["name"],
                    muscle_groups=exercise_data["muscle_groups"],
                    equipment_required=exercise_data["equipment_required"],
                    difficulty=exercise_data["difficulty"],
                    default_sets=exercise_data.get("default_sets", 3),
                    default_reps_min=exercise_data.get("default_reps_min", 8),
                    default_reps_max=exercise_data.get("default_reps_max", 12),
                    base_rest_time_seconds=exercise_data.get("base_rest_time_seconds", 60),
                    instructions=exercise_data.get("instructions", "")
                )
                db.add(exercise)
            
            db.commit()
            logger.info(f"✅ Chargé {len(exercises_data)} exercices")
        else:
            logger.warning("❌ Fichier exercises.json non trouvé")
            
    except Exception as e:
        logger.error(f"❌ Erreur lors du chargement des exercices: {e}")
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
        
        logger.info(f"✅ User créé avec ID: {db_user.id}")
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
    db.delete(user)
    db.commit()
    return {"message": "Profil supprimé avec succès"}

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
    
    # Filtrer par équipement disponible si user_id fourni
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.equipment_config:
            available_equipment = get_available_equipment(user.equipment_config)
            exercises = [ex for ex in exercises if can_perform_exercise(ex, available_equipment)]
    
    return exercises

def get_available_equipment(equipment_config: Dict[str, Any]) -> List[str]:
    """Utilise le service d'équipement unifié"""
    from backend.equipment_service import EquipmentService
    return list(EquipmentService.get_available_equipment_types(equipment_config))

def can_perform_exercise(exercise: Exercise, available_equipment: List[str]) -> bool:
    """Utilise le service d'équipement unifié"""
    from backend.equipment_service import EquipmentService
    # Simuler une config depuis la liste disponible
    mock_config = {eq: {'available': True} for eq in available_equipment}
    return EquipmentService.can_perform_exercise(exercise.equipment_required, mock_config)

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

@app.get("/api/users/{user_id}/programs/active")
def get_active_program(user_id: int, db: Session = Depends(get_db)):
    """Récupérer le programme actif d'un utilisateur"""
    program = db.query(Program).filter(
        Program.user_id == user_id,
        Program.is_active == True
    ).first()
    
    if not program:
        return None
    
    return program

def generate_program_exercises(user: User, program: ProgramCreate, db: Session) -> List[Dict[str, Any]]:
    """Génère une liste d'exercices pour le programme basé sur les zones focus"""
    available_equipment = get_available_equipment(user.equipment_config)
    
    # Récupérer exercices par zone focus
    all_exercises = []
    for focus_area in program.focus_areas:
        muscle_exercises = db.query(Exercise).filter(
            cast(Exercise.muscle_groups, JSONB).contains([focus_area])
        ).all()
        
        # Filtrer par équipement disponible et niveau d'expérience
        available_exercises = []
        for ex in muscle_exercises:
            if can_perform_exercise(ex, available_equipment):
                # Adapter selon le niveau d'expérience
                if user.experience_level == 'beginner' and ex.difficulty in ['beginner', 'intermediate']:
                    available_exercises.append(ex)
                elif user.experience_level == 'intermediate' and ex.difficulty in ['beginner', 'intermediate', 'advanced']:
                    available_exercises.append(ex)
                elif user.experience_level == 'advanced':
                    available_exercises.append(ex)
        
        # Prendre 1-2 exercices par zone selon la fréquence
        max_exercises = 2 if program.sessions_per_week <= 3 else 1
        all_exercises.extend(available_exercises[:max_exercises])
    
    # Organiser en sessions de façon équilibrée
    exercises_per_session = max(1, len(all_exercises) // program.sessions_per_week)
    
    program_exercises = []
    for session in range(program.sessions_per_week):
        start_idx = session * exercises_per_session
        end_idx = min(start_idx + exercises_per_session, len(all_exercises))
        session_exercises = all_exercises[start_idx:end_idx]
        
        # Si dernière session, ajouter les exercices restants
        if session == program.sessions_per_week - 1:
            session_exercises.extend(all_exercises[end_idx:])
        
        for exercise in session_exercises:
            program_exercises.append({
                "exercise_id": exercise.id,
                "exercise_name": exercise.name,
                "session_number": session + 1,
                "sets": exercise.default_sets,
                "reps_min": exercise.default_reps_min,
                "reps_max": exercise.default_reps_max,
                "rest_seconds": exercise.base_rest_time_seconds
            })
    
    return program_exercises

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
        set_order_in_session=set_data.set_order_in_session
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
    
    return db_set

@app.post("/api/workouts/{workout_id}/recommendations")
def get_set_recommendations(
    workout_id: int, 
    request: Dict[str, Any], 
    db: Session = Depends(get_db)
):
    """Obtenir des recommandations ML pour la prochaine série"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    user = workout.user
    exercise = db.query(Exercise).filter(Exercise.id == request["exercise_id"]).first()
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercice non trouvé")
    
    # Récupérer les poids disponibles
    weights_data = get_available_weights(user.id, db)
    available_weights = weights_data["available_weights"]
    
    # Importer et utiliser le moteur ML
    from backend.ml_recommendations import FitnessRecommendationEngine
    ml_engine = FitnessRecommendationEngine(db)
    
    recommendations = ml_engine.get_set_recommendations(
        user=user,
        exercise=exercise,
        set_number=request.get("set_number", 1),
        current_fatigue=request.get("current_fatigue", 3),
        current_effort=request.get("previous_effort", 3),
        last_rest_duration=request.get("last_rest_duration"),
        exercise_order=request.get("exercise_order", 1),
        set_order_global=request.get("set_order_global", 1),
        available_weights=available_weights
    )
    
    return recommendations

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
def complete_workout(workout_id: int, db: Session = Depends(get_db)):
    """Terminer une séance"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    workout.status = "completed"
    workout.completed_at = datetime.utcnow()
    
    # Calculer la durée totale
    if workout.started_at:
        duration = workout.completed_at - workout.started_at
        workout.total_duration_minutes = int(duration.total_seconds() / 60)
    
    db.commit()
    return {"message": "Séance terminée", "workout": workout}

# ===== ENDPOINTS STATISTIQUES =====

@app.get("/api/users/{user_id}/stats")
def get_user_stats(user_id: int, db: Session = Depends(get_db)):
    """Récupérer les statistiques de l'utilisateur"""
    # Séances totales
    total_workouts = db.query(func.count(Workout.id)).filter(
        Workout.user_id == user_id,
        Workout.status == "completed"
    ).scalar()
    
    # Dernière séance
    last_workout = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "completed"
    ).order_by(desc(Workout.completed_at)).first()
    
    # Volume total (poids x reps)
    total_volume = db.query(
        func.sum(WorkoutSet.weight * WorkoutSet.reps)
    ).join(Workout).filter(
        Workout.user_id == user_id,
        WorkoutSet.weight.isnot(None)
    ).scalar() or 0
    
    # Historique récent (3 dernières séances)
    recent_workouts = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "completed"
    ).order_by(desc(Workout.completed_at)).limit(3).all()
    
    return {
        "total_workouts": total_workouts,
        "last_workout_date": last_workout.completed_at if last_workout else None,
        "total_volume_kg": round(total_volume, 1),
        "recent_workouts": recent_workouts
    }

@app.get("/api/users/{user_id}/progress")
def get_progress_data(user_id: int, days: int = 30, db: Session = Depends(get_db)):
    """Récupérer les données de progression"""
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    # Volume par jour
    daily_volume = db.query(
        func.date(Workout.completed_at).label('date'),
        func.sum(WorkoutSet.weight * WorkoutSet.reps).label('volume')
    ).join(WorkoutSet).filter(
        Workout.user_id == user_id,
        Workout.completed_at >= cutoff_date,
        WorkoutSet.weight.isnot(None)
    ).group_by(func.date(Workout.completed_at)).all()
    
    # Progression par exercice (records)
    exercise_records = db.query(
        Exercise.name,
        func.max(WorkoutSet.weight).label('max_weight'),
        func.max(WorkoutSet.reps).label('max_reps')
    ).join(WorkoutSet).join(Workout).filter(
        Workout.user_id == user_id,
        Workout.completed_at >= cutoff_date
    ).group_by(Exercise.id, Exercise.name).all()
    
    return {
        "daily_volume": [{"date": str(dv.date), "volume": float(dv.volume or 0)} for dv in daily_volume],
        "exercise_records": [{"name": er.name, "max_weight": float(er.max_weight or 0), "max_reps": er.max_reps} for er in exercise_records]
    }

@app.get("/api/users/{user_id}/stats/progression/{exercise_id}")
def get_exercise_progression(
    user_id: int,
    exercise_id: int,
    months: int = 6,
    db: Session = Depends(get_db)
):
    """Graphique 1: Courbe de progression 1RM estimé"""
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)
    
    sets = db.query(SetHistory).filter(
        SetHistory.user_id == user_id,
        SetHistory.exercise_id == exercise_id,
        SetHistory.date_performed >= cutoff_date
    ).order_by(SetHistory.date_performed).all()
    
    if not sets:
        return {"data": [], "trend": None}
    
    # Calculer 1RM estimé (formule d'Epley)
    progression_data = []
    for s in sets:
        if s.weight and s.actual_reps:
            one_rm = s.weight * (1 + s.actual_reps / 30)
            progression_data.append({
                "date": s.date_performed.isoformat(),
                "oneRM": round(one_rm, 1),
                "weight": s.weight,
                "reps": s.actual_reps,
                "fatigue": s.fatigue_level
            })
    
    # Calculer la tendance linéaire
    if len(progression_data) >= 2:
        x_values = list(range(len(progression_data)))
        y_values = [p["oneRM"] for p in progression_data]
        n = len(x_values)
        
        sum_x = sum(x_values)
        sum_y = sum(y_values)
        sum_xy = sum(x * y for x, y in zip(x_values, y_values))
        sum_x2 = sum(x * x for x in x_values)
        
        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x) if n * sum_x2 - sum_x * sum_x != 0 else 0
        intercept = (sum_y - slope * sum_x) / n
        
        trend = {
            "slope": round(slope, 2),
            "intercept": round(intercept, 2),
            "progression_percent": round((slope / intercept * 100) if intercept else 0, 1)
        }
    else:
        trend = None
    
    return {"data": progression_data, "trend": trend}


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
            "muscleGroups": muscle_groups,
            "muscles": muscles if muscles else [],
            "weight": record.weight,
            "reps": record.actual_reps,
            "date": record.date_performed.isoformat(),
            "fatigue": record.fatigue_level,
            "effort": record.effort_level,
            "daysAgo": (datetime.utcnow() - record.date_performed).days
        })
    
    return sorted(result, key=lambda x: x["weight"], reverse=True)


@app.get("/api/users/{user_id}/stats/attendance-calendar")
def get_attendance_calendar(user_id: int, months: int = 6, db: Session = Depends(get_db)):
    """Graphique 5: Calendrier d'assiduité avec séances manquées"""
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)
    
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
        volume = sum((s.weight or 0) * s.reps for s in sets)
        calendar_data[date_key]["volume"] += volume
    
    # Identifier les semaines avec séances manquantes
    weeks_analysis = []
    current_date = datetime.utcnow().date()
    
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
    """Graphique 7: Burndown chart volume avec différentes périodes"""
    now = datetime.utcnow()
    
    # Déterminer les dates selon la période
    if period == "week":
        start_date = now - timedelta(days=now.weekday())
        end_date = start_date + timedelta(days=6)
        days_in_period = 7
    elif period == "month":
        start_date = now.replace(day=1)
        end_date = (start_date + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        days_in_period = (end_date - start_date).days + 1
    elif period == "quarter":
        quarter = (now.month - 1) // 3
        start_date = datetime(now.year, quarter * 3 + 1, 1)
        end_date = (start_date + timedelta(days=93)).replace(day=1) - timedelta(days=1)
        days_in_period = (end_date - start_date).days + 1
    else:  # year
        start_date = now.replace(month=1, day=1)
        end_date = now.replace(month=12, day=31)
        days_in_period = 365
    
    # Récupérer les targets adaptatifs
    targets = db.query(AdaptiveTargets).filter(
        AdaptiveTargets.user_id == user_id
    ).all()
    
    total_target_volume = sum(t.target_volume for t in targets) * (days_in_period / 7)
    
    # Calculer le volume réalisé jour par jour
    daily_volumes = []
    cumulative_volume = 0
    
    current = start_date
    while current <= min(end_date, now):
        day_sets = db.query(WorkoutSet).join(Workout).filter(
            Workout.user_id == user_id,
            func.date(Workout.started_at) == current.date()
        ).all()
        
        day_volume = sum((s.weight or 0) * s.reps for s in day_sets)
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
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
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
            
            # Dans la fonction get_muscle_sunburst, remplacer toute la logique de distribution par :
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
    now = datetime.utcnow()
    
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
            hours_since = (now - last_workout).total_seconds() / 3600
            recovery_percent = min(100, (hours_since / 72) * 100)  # 72h = récupération complète
            
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
    
    if not targets:
        # Créer des targets par défaut si elles n'existent pas
        return {
            "muscles": ["dos", "pectoraux", "jambes", "epaules", "bras", "abdominaux"],
            "targetVolumes": [5000] * 6,
            "currentVolumes": [0] * 6,
            "ratios": [0] * 6
        }
    
    muscle_data = []
    for target in targets:
        ratio = (target.current_volume / target.target_volume * 100) if target.target_volume > 0 else 0
        muscle_data.append({
            "muscle": target.muscle_group,
            "targetVolume": target.target_volume,
            "currentVolume": target.current_volume,
            "ratio": round(ratio, 1),
            "recoveryDebt": target.recovery_debt
        })
    
    # Trier par groupe musculaire pour consistency
    muscle_order = ["dos", "pectoraux", "jambes", "epaules", "bras", "abdominaux"]
    sorted_data = sorted(muscle_data, key=lambda x: muscle_order.index(x["muscle"]) if x["muscle"] in muscle_order else 99)
    
    return {
        "muscles": [d["muscle"] for d in sorted_data],
        "targetVolumes": [d["targetVolume"] for d in sorted_data],
        "currentVolumes": [d["currentVolume"] for d in sorted_data],
        "ratios": [d["ratio"] for d in sorted_data],
        "recoveryDebts": [d["recoveryDebt"] for d in sorted_data]
    }


@app.get("/api/users/{user_id}/stats/ml-confidence")
def get_ml_confidence_evolution(user_id: int, days: int = 60, db: Session = Depends(get_db)):
    """Graphique 14: Evolution de la confiance ML"""
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
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
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
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
        total_exercise_time = sum(s.duration_seconds or 60 for s in sets)  # 60s par défaut par série
        total_rest_time = sum(s.base_rest_time_seconds or 0 for s in sets)
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
def get_available_weights(user_id: int, db: Session = Depends(get_db)):
    """Utilise le service d'équipement unifié"""
    from backend.equipment_service import EquipmentService
    
    try:
        weights = EquipmentService.get_available_weights(db, user_id)
        return {"available_weights": weights}
    except Exception as e:
        logger.error(f"Erreur calcul poids user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Erreur calcul des poids")

def generate_plate_combinations(plates: List[float]) -> List[float]:
    """Génère toutes les combinaisons possibles de disques"""
    if not plates:
        return [0]
    
    combinations = set([0])  # Barre seule
    
    # Pour chaque disque, ajouter toutes les quantités possibles (0 à nombre max raisonnable)
    for plate in plates:
        new_combinations = set()
        for existing in combinations:
            # Ajouter 0, 1, 2, 3, 4 disques de ce poids (quantité raisonnable)
            for count in range(5):  
                new_combinations.add(existing + plate * count)
        combinations.update(new_combinations)
    
    return list(combinations)

def generate_band_combinations(tensions: List[float]) -> List[float]:
    """Génère les combinaisons possibles d'élastiques"""
    if not tensions:
        return []
    
    combinations = set()
    
    # Combinaisons de 2 élastiques maximum (réaliste)
    for i, tension1 in enumerate(tensions):
        for j, tension2 in enumerate(tensions[i:], i):
            if i == j:
                continue  # Éviter la duplication simple
            combinations.add(tension1 + tension2)
    
    return list(combinations)

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