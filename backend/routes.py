# ===== backend/routes.py - VERSION COMPLÈTE CORRIGÉE =====
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
import logging

from backend.database import get_db
from backend.models import User, Exercise, Workout, WorkoutSet, UserCommitment, AdaptiveTargets
from backend.ml_engine import FitnessMLEngine, RecoveryTracker, VolumeOptimizer, SessionBuilder, ProgressionAnalyzer, RealTimeAdapter
from backend.schemas import (
    UserCreate, WorkoutCreate, SetCreate, 
    UserCommitmentCreate, UserCommitmentResponse, 
    AdaptiveTargetsResponse, TrajectoryAnalysis,
    ProgramGenerationRequest
)
from backend.equipment_service import EquipmentService

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter()

@router.post("/api/users/{user_id}/program")
async def generate_program(
    user_id: int, 
    request: ProgramGenerationRequest,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    ml_engine = FitnessMLEngine(db)

    try:
        program = ml_engine.generate_adaptive_program(user, request.weeks, request.frequency)
        return {"program": program}
    except Exception as e:
        logger.error(f"Program generation failed for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Program generation failed")

@router.get("/api/users/{user_id}/injury-risk")
async def check_injury_risk(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    ml_engine = FitnessMLEngine(db)
    risk_analysis = ml_engine.analyze_injury_risk(user)
    
    return risk_analysis

@router.post("/api/workouts/{workout_id}/sets/{set_id}/adjust")
async def adjust_workout(
    workout_id: int, 
    set_id: int,
    remaining_sets: int,
    db: Session = Depends(get_db)
):
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    current_set = db.query(WorkoutSet).filter(WorkoutSet.id == set_id).first()
    
    if not workout or not current_set:
        raise HTTPException(status_code=404, detail="Workout or set not found")
    
    ml_engine = FitnessMLEngine(db)
    adjustments = ml_engine.adjust_workout_in_progress(
        workout.user,
        current_set,
        remaining_sets
    )
    
    return adjustments

# ========== ENDPOINTS SYSTÈME ADAPTATIF ==========

@router.post("/api/users/{user_id}/commitment")
async def create_user_commitment(
    user_id: int,
    commitment: UserCommitmentCreate,
    db: Session = Depends(get_db)
):
    """Créer ou mettre à jour l'engagement utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Vérifier si un engagement existe déjà
    existing = db.query(UserCommitment).filter(
        UserCommitment.user_id == user_id
    ).first()
    
    if existing:
        # Mettre à jour
        for key, value in commitment.dict().items():
            setattr(existing, key, value)
        existing.updated_at = datetime.now(timezone.utc)
    else:
        # Créer nouveau
        new_commitment = UserCommitment(
            user_id=user_id,
            **commitment.dict()
        )
        db.add(new_commitment)
    
    db.commit()
    
    # Initialiser les targets adaptatifs
    volume_optimizer = VolumeOptimizer(db)
    muscles = ["Pectoraux", "Dos", "Deltoïdes", "Jambes", "Bras", "Abdominaux"]
    
    for muscle in muscles:
        # Vérifier si existe déjà
        target = db.query(AdaptiveTargets).filter(
            AdaptiveTargets.user_id == user_id,
            AdaptiveTargets.muscle_group == muscle
        ).first()
        
        if not target:
            # Calculer le volume optimal ou utiliser une valeur par défaut
            optimal_volume = volume_optimizer.calculate_optimal_volume(user, muscle)
            if optimal_volume is None or optimal_volume <= 0:
                optimal_volume = 5000.0  # Valeur par défaut raisonnable
            
            target = AdaptiveTargets(
                user_id=user_id,
                muscle_group=muscle,
                target_volume=float(optimal_volume),
                current_volume=0.0,
                recovery_debt=0.0,
                adaptation_rate=1.0
            )
            db.add(target)
    
    db.commit()
    
    return {"message": "Commitment created/updated successfully"}

@router.get("/api/users/{user_id}/commitment", response_model=UserCommitmentResponse)
async def get_user_commitment(user_id: int, db: Session = Depends(get_db)):
    """Récupérer l'engagement utilisateur"""
    commitment = db.query(UserCommitment).filter(
        UserCommitment.user_id == user_id
    ).first()
    
    if not commitment:
        raise HTTPException(status_code=404, detail="No commitment found")
    
    return commitment

@router.get("/api/users/{user_id}/adaptive-targets", response_model=List[AdaptiveTargetsResponse])
def get_adaptive_targets(user_id: int, db: Session = Depends(get_db)):
    """Récupérer les objectifs adaptatifs"""
    targets = db.query(AdaptiveTargets).filter(
        AdaptiveTargets.user_id == user_id
    ).all()
    
    # Corriger les valeurs None à la volée
    volume_optimizer = VolumeOptimizer(db)
    for target in targets:
        if target.target_volume is None or target.target_volume <= 0:
            # Calculer une valeur par défaut
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                optimal_volume = volume_optimizer.calculate_optimal_volume(user, target.muscle_group)
                target.target_volume = float(optimal_volume) if optimal_volume else 5000.0
            else:
                target.target_volume = 5000.0
            db.commit()
    
    return targets

@router.get("/api/users/{user_id}/trajectory", response_model=TrajectoryAnalysis)
async def get_trajectory_analysis(user_id: int, db: Session = Depends(get_db)):
    """Analyser la trajectoire de progression"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    analyzer = ProgressionAnalyzer(db)
    analysis = analyzer.get_trajectory_status(user)
    
    return analysis

@router.post("/api/users/{user_id}/adaptive-workout")
async def generate_adaptive_workout(
    user_id: int,
    time_available: int = 60,
    db: Session = Depends(get_db)
):
    """Génère une séance adaptative intelligente basée sur les besoins actuels"""

    logger.info(f"🎯 [API] Demande séance adaptative user {user_id}, temps: {time_available}min")
    
    # Validation utilisateur
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.error(f"❌ [API] Utilisateur {user_id} non trouvé")
        raise HTTPException(status_code=404, detail="User not found")
    
    # Validation configuration équipement
    if not user.equipment_config:
        logger.error(f"❌ [API] Configuration équipement manquante pour user {user_id}")
        raise HTTPException(status_code=400, detail="Equipment configuration missing")
    
    try:
        ml_engine = FitnessMLEngine(db)
        workout_data = ml_engine.generate_adaptive_workout(user, time_available)
        
        logger.info(f"✅ [API] Séance générée avec succès: {len(workout_data['exercises'])} exercices")
        return workout_data
        
    except Exception as e:
        logger.error(f"❌ [API] Erreur génération: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Workout generation failed: {str(e)}")

@router.get("/api/adaptive-workouts/{workout_id}")
async def get_adaptive_workout_plan(
    workout_id: int,
    db: Session = Depends(get_db)
):
    """Récupérer le plan d'une séance adaptative"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        logger.error(f"❌ [ERROR] Workout {workout_id} non trouvé")
        raise HTTPException(status_code=404, detail="Workout not found")
    
    if workout.type != "adaptive":
        logger.error(f"❌ [ERROR] Workout {workout_id} n'est pas adaptatif (type: {workout.type})")
        raise HTTPException(status_code=400, detail="Workout is not adaptive type")
    
    # Pour l'instant, retourner le plan depuis metadata ou regenerer
    if hasattr(workout, 'metadata') and workout.metadata:
        return workout.metadata
    else:
        logger.warning(f"⚠️ [WARNING] Plan non stocké pour workout {workout_id}, régénération...")
        raise HTTPException(status_code=404, detail="Workout plan not found")

@router.post("/api/workouts/{workout_id}/complete-adaptive")
async def complete_adaptive_workout(
    workout_id: int,
    db: Session = Depends(get_db)
):
    """Marquer une séance comme terminée et adapter les objectifs"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    # Marquer comme complété
    workout.status = "completed"
    workout.completed_at = datetime.now(timezone.utc)
    db.commit()
    
    # Adapter en temps réel
    adapter = RealTimeAdapter(db)
    adapter.handle_session_completed(workout)
    
    return {"message": "Workout completed and targets adapted"}

@router.post("/api/users/{user_id}/skip-session")
async def skip_session(
    user_id: int,
    reason: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Gérer une séance ratée intelligemment"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    adapter = RealTimeAdapter(db)
    adapter.handle_session_skipped(user, reason)
    
    # Générer un message encourageant
    reminder = adapter.get_smart_reminder(user)
    
    return {
        "message": "Session skipped handled",
        "reminder": reminder
    }

@router.get("/api/programs/{program_id}/adjustments")
async def get_program_adjustments(
    program_id: int,
    user_id: int,
    db: Session = Depends(get_db)
):
    """Obtenir les suggestions d'ajustement pour un programme"""
    ml_engine = FitnessMLEngine(db)
    
    try:
        suggestions = ml_engine.suggest_program_adjustments(user_id, program_id)
        return suggestions
    except Exception as e:
        logger.error(f"Error getting adjustments: {str(e)}")
        raise HTTPException(status_code=500, detail="Analysis failed")

# ========== ENDPOINTS ÉQUIPEMENT ==========

@router.get("/api/users/{user_id}/available-weights/{exercise_type}")
async def get_available_weights(
    user_id: int, 
    exercise_type: str,
    db: Session = Depends(get_db)
):
    """Obtenir tous les poids réalisables pour un type d'exercice"""
    try:
        weights = EquipmentService.get_available_weights(db, user_id, exercise_type)
        return {"weights": weights}
    except Exception as e:
        logger.error(f"Error calculating weights for user {user_id}, exercise {exercise_type}: {str(e)}")
        raise HTTPException(status_code=500, detail="Calculation failed")

@router.get("/api/users/{user_id}/equipment-setup/{exercise_type}/{weight}")
async def get_equipment_setup(
    user_id: int, 
    exercise_type: str, 
    weight: float,
    db: Session = Depends(get_db)
):
    """Obtenir la visualisation exacte pour un poids donné"""
    try:
        setup = EquipmentService.get_equipment_visualization(db, user_id, exercise_type, weight)
        return setup
    except Exception as e:
        logger.error(f"Error getting setup for user {user_id}, exercise {exercise_type}, weight {weight}: {str(e)}")
        raise HTTPException(status_code=500, detail="Setup calculation failed")