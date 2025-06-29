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
from backend.models import Base, User, Exercise, Program, Workout, WorkoutSet
from backend.schemas import UserCreate, UserResponse, ProgramCreate, WorkoutCreate, SetCreate, ExerciseResponse

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
    
    db.delete(user)
    db.commit()
    return {"message": "Profil supprimé avec succès"}

@app.delete("/api/users/{user_id}/history")
def clear_user_history(user_id: int, db: Session = Depends(get_db)):
    """Vider l'historique des séances d'un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Supprimer toutes les séances et leurs sets
    db.query(Workout).filter(Workout.user_id == user_id).delete()
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