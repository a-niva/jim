# ===== backend/main.py - VERSION REFACTORISÉE =====
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, cast, text
from sqlalchemy.dialects.postgresql import JSONB
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import json
import os
import logging
from backend.ml_recommendations import FitnessRecommendationEngine
from backend.database import engine, get_db, SessionLocal
from backend.models import Base, User, Exercise, Program, Workout, WorkoutSet, SetHistory, UserCommitment, AdaptiveTargets, UserAdaptationCoefficients, PerformanceStates
from backend.schemas import UserCreate, UserResponse, ProgramCreate, WorkoutCreate, SetCreate, ExerciseResponse, UserPreferenceUpdate
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
            "volume_response": coefficients.volume_response if coefficients else 1.0,
            "typical_progression_increment": coefficients.typical_progression_increment if coefficients else 2.5
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
        Workout.started_at >= start_of_week  # ✅ CORRIGÉ
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
    
    # CORRECTION : Enrichir les exercices avec leurs noms si nécessaire
    if program.exercises:
        for ex in program.exercises:
            # Vérifier si le nom de l'exercice est manquant
            if 'exercise_name' not in ex and 'exercise_id' in ex:
                # Récupérer l'exercice depuis la base de données
                exercise_db = db.query(Exercise).filter(Exercise.id == ex['exercise_id']).first()
                if exercise_db:
                    ex['exercise_name'] = exercise_db.name
                else:
                    # Si l'exercice n'existe pas dans la base, mettre un nom par défaut
                    ex['exercise_name'] = f"Exercice ID {ex['exercise_id']}"
                    logger.warning(f"Exercice ID {ex['exercise_id']} non trouvé dans la base")
    
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
def complete_workout(workout_id: int, data: Dict[str, int] = {}, db: Session = Depends(get_db)):
    """Terminer une séance"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Séance non trouvée")
    
    workout.status = "completed"
    workout.completed_at = datetime.now(timezone.utc)
    
    # Utiliser la durée fournie par le frontend (en secondes) si disponible
    if "total_duration" in data:
        workout.total_duration_minutes = int(data["total_duration"] / 60)
    elif workout.started_at:
        # Fallback: calculer depuis les timestamps
        duration = workout.completed_at - workout.started_at
        workout.total_duration_minutes = int(duration.total_seconds() / 60)
    
    # Sauvegarder le temps de repos total s'il est fourni
    if "total_rest_time" in data:
        workout.total_rest_time_seconds = data["total_rest_time"]
    
    db.commit()  # AJOUT CRITIQUE !
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
    # Récupérer tous les sets avec leurs exercices
    sets_with_exercises = db.query(WorkoutSet, Exercise).join(
        Workout, WorkoutSet.workout_id == Workout.id
    ).join(
        Exercise, WorkoutSet.exercise_id == Exercise.id
    ).filter(
        Workout.user_id == user_id
    ).all()

    # Calculer le volume en tenant compte du type d'exercice
    user = db.query(User).filter(User.id == user_id).first()
    ml_engine = FitnessRecommendationEngine(db)
    total_volume = sum(
        ml_engine.calculate_exercise_volume(s.weight, s.reps, e, user, s.effort_level) 
        for s, e in sets_with_exercises
    )
    
    # Historique récent (3 dernières séances) avec temps calculés
    recent_workouts_raw = db.query(Workout).filter(
        Workout.user_id == user_id,
        Workout.status == "completed"
    ).order_by(desc(Workout.completed_at)).limit(3).all()
    
    # Enrichir avec les temps calculés à la volée
    recent_workouts = []
    for workout in recent_workouts_raw:
        sets = db.query(WorkoutSet).filter(WorkoutSet.workout_id == workout.id).all()
        
        # ✅ CALCULER SEULEMENT LES TEMPS RÉELLEMENT MESURÉS
        total_exercise_seconds = sum(s.duration_seconds or 0 for s in sets)
        total_rest_seconds = sum(s.actual_rest_duration_seconds or 0 for s in sets)  # ✅ SUPPRIMER base_rest_time_seconds

        # ✅ AJOUTER DEBUG POUR IDENTIFIER LE PROBLÈME
        print(f"DEBUG Workout {workout.id}:")
        print(f"  Duration in DB: {workout.total_duration_minutes}min = {(workout.total_duration_minutes or 0) * 60}s")
        print(f"  Sets count: {len(sets)}")
        print(f"  Exercise seconds: {total_exercise_seconds}")
        print(f"  Rest seconds: {total_rest_seconds}")
        for i, s in enumerate(sets):
            print(f"    Set {i+1}: duration_seconds={s.duration_seconds}, actual_rest={s.actual_rest_duration_seconds}, base_rest={s.base_rest_time_seconds}")

        # Si pas de duration_seconds, estimer depuis la durée totale
        if total_exercise_seconds == 0 and workout.total_duration_minutes:
            total_duration_seconds = workout.total_duration_minutes * 60
            total_exercise_seconds = max(0, total_duration_seconds - total_rest_seconds)
            print(f"WARNING: Estimated exercise time: {total_exercise_seconds}s")
        
        # Convertir l'objet Workout en dict avec tous les temps
        workout_dict = {
            "id": workout.id,
            "user_id": workout.user_id,
            "type": workout.type,
            "program_id": workout.program_id,
            "status": workout.status,
            "started_at": workout.started_at,
            "completed_at": workout.completed_at,
            "total_duration_minutes": workout.total_duration_minutes,
            "total_rest_time_seconds": total_rest_seconds,
            "total_exercise_time_seconds": total_exercise_seconds
        }
        recent_workouts.append(workout_dict)
    
    return {
        "total_workouts": total_workouts,
        "last_workout_date": last_workout.completed_at if last_workout else None,
        "total_volume_kg": round(total_volume, 1),
        "recent_workouts": recent_workouts
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
    """Graphique 7: Burndown chart volume avec différentes périodes"""
    now = datetime.now(timezone.utc)
    
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
        
        ml_engine = FitnessRecommendationEngine(db)
        day_volume = 0
        for s in day_sets:
            exercise = db.query(Exercise).filter(Exercise.id == s.exercise_id).first()
            if exercise:
                # Récupérer l'user depuis le workout
                workout = db.query(Workout).filter(Workout.id == s.workout_id).first()
                if workout:
                    user = db.query(User).filter(User.id == workout.user_id).first()
                    if user:
                        day_volume += ml_engine.calculate_exercise_volume(s.weight, s.reps, exercise, user)
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
