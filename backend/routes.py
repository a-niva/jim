# ===== backend/routes.py - VERSION COMPLÈTE CORRIGÉE =====
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timezone, timedelta
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
    
# ===== backend/routes.py - AJOUTS PHASE 3.1 =====
@router.get("/api/users/{user_id}/muscle-readiness")
async def get_muscle_readiness_for_scoring(user_id: int, db: Session = Depends(get_db)):
    """
    Endpoint optimisé pour le scoring Phase 3.1
    Récupère l'état de récupération musculaire via les modules ML existants
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    try:
        # Utiliser RecoveryTracker existant
        recovery_tracker = RecoveryTracker(db)
        
        # Muscles standards du système
        muscle_groups = ["dos", "pectoraux", "jambes", "epaules", "bras", "abdominaux"]
        
        readiness_data = {}
        overall_scores = []
        
        for muscle in muscle_groups:
            try:
                readiness_score = recovery_tracker.get_muscle_readiness(muscle, user)
                readiness_data[muscle] = round(float(readiness_score), 3)
                overall_scores.append(readiness_score)
            except Exception as e:
                logger.warning(f"Erreur readiness {muscle}: {str(e)}")
                readiness_data[muscle] = 0.7  # Valeur par défaut
                overall_scores.append(0.7)
        
        # Calculer la récupération globale
        overall_readiness = sum(overall_scores) / len(overall_scores) if overall_scores else 0.7
        
        return {
            "readiness": readiness_data,
            "metadata": {
                "user_id": user_id,
                "overall_readiness": round(overall_readiness, 3),
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "calculation_method": "recovery_tracker_ml",
                "muscles_analyzed": len(muscle_groups)
            }
        }
        
    except Exception as e:
        logger.error(f"Erreur muscle readiness user {user_id}: {str(e)}")
        
        # Fallback gracieux avec valeurs par défaut
        default_readiness = {
            "dos": 0.75,
            "pectoraux": 0.70,
            "jambes": 0.80,
            "epaules": 0.65,
            "bras": 0.70,
            "abdominaux": 0.85
        }
        
        return {
            "readiness": default_readiness,
            "metadata": {
                "user_id": user_id,
                "overall_readiness": 0.74,
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "calculation_method": "fallback_default",
                "fallback": True,
                "error": "ML calculation failed, using defaults"
            }
        }

@router.get("/api/users/{user_id}/recent-performance")
async def get_recent_performance_for_scoring(
    user_id: int, 
    days: int = 14, 
    db: Session = Depends(get_db)
):
    """
    Endpoint pour récupérer les performances récentes optimisé pour le scoring
    Utilise les données réelles de WorkoutSet pour l'analyse de progression
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    try:
        # Calculer la date de début
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        # Query optimisée pour les performances récentes
        recent_performance = db.query(
            WorkoutSet.exercise_id,
            Exercise.name.label('exercise_name'),
            Exercise.body_part,
            func.avg(WorkoutSet.weight).label('avg_weight'),
            func.max(WorkoutSet.weight).label('max_weight'),
            func.avg(WorkoutSet.reps).label('avg_reps'),
            func.count(WorkoutSet.id).label('total_sets'),
            func.max(Workout.completed_at).label('last_performed'),
            func.avg(WorkoutSet.fatigue_level).label('avg_fatigue'),
            func.avg(WorkoutSet.effort_level).label('avg_effort')
        ).join(
            Workout, WorkoutSet.workout_id == Workout.id
        ).join(
            Exercise, WorkoutSet.exercise_id == Exercise.id
        ).filter(
            Workout.user_id == user_id,
            Workout.status == 'completed',
            Workout.completed_at >= cutoff_date,
            WorkoutSet.weight.isnot(None)  # Uniquement exercices avec poids
        ).group_by(
            WorkoutSet.exercise_id, 
            Exercise.name, 
            Exercise.body_part
        ).order_by(
            func.max(Workout.completed_at).desc()
        ).all()
        
        # Formater les données pour le frontend
        performance_data = []
        for row in recent_performance:
            performance_data.append({
                "exercise_id": row.exercise_id,
                "exercise_name": row.exercise_name,
                "body_part": row.body_part,
                "avg_weight": round(float(row.avg_weight or 0), 1),
                "max_weight": round(float(row.max_weight or 0), 1),
                "avg_reps": round(float(row.avg_reps or 0), 1),
                "total_sets": int(row.total_sets or 0),
                "last_performed": row.last_performed.isoformat() if row.last_performed else None,
                "avg_fatigue": round(float(row.avg_fatigue or 3), 1) if row.avg_fatigue else None,
                "avg_effort": round(float(row.avg_effort or 3), 1) if row.avg_effort else None,
                "days_since_last": (datetime.now(timezone.utc) - row.last_performed).days if row.last_performed else None
            })
        
        # Statistiques globales
        total_workouts = db.query(Workout).filter(
            Workout.user_id == user_id,
            Workout.status == 'completed',
            Workout.completed_at >= cutoff_date
        ).count()
        
        return {
            "performance": performance_data,
            "metadata": {
                "period_days": days,
                "exercises_analyzed": len(performance_data),
                "total_workouts_period": total_workouts,
                "cutoff_date": cutoff_date.isoformat(),
                "generated_at": datetime.now(timezone.utc).isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"Erreur recent performance user {user_id}: {str(e)}")
        
        # Fallback avec données vides mais structure cohérente
        return {
            "performance": [],
            "metadata": {
                "period_days": days,
                "exercises_analyzed": 0,
                "total_workouts_period": 0,
                "cutoff_date": cutoff_date.isoformat() if 'cutoff_date' in locals() else None,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "error": "Performance calculation failed"
            }
        }

@router.post("/api/users/{user_id}/session-quality-validation")
async def validate_session_quality_backend(
    user_id: int,
    request: dict,  # {exercises: [...], current_score: int}
    db: Session = Depends(get_db)
):
    """
    Endpoint pour validation backend du scoring Phase 3.1
    Compare le score frontend avec un calcul backend pour détecter les divergences
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    try:
        exercises = request.get('exercises', [])
        frontend_score = request.get('current_score', 0)
        
        if not exercises:
            return {
                "validation": "failed",
                "reason": "No exercises provided",
                "backend_score": 0,
                "frontend_score": frontend_score,
                "divergence": abs(frontend_score)
            }
        
        # Calcul backend simplifié pour validation
        recovery_tracker = RecoveryTracker(db)
        volume_optimizer = VolumeOptimizer(db)
        
        # Score de récupération backend
        recovery_scores = []
        for exercise in exercises:
            exercise_id = exercise.get('exercise_id')
            if exercise_id:
                # Récupérer l'exercice pour obtenir body_part
                exercise_detail = db.query(Exercise).filter(Exercise.id == exercise_id).first()
                if exercise_detail:
                    muscle = exercise_detail.body_part
                    readiness = recovery_tracker.get_muscle_readiness(muscle, user)
                    recovery_scores.append(readiness)
        
        # Calculer score backend approximatif
        avg_recovery = sum(recovery_scores) / len(recovery_scores) if recovery_scores else 0.7
        backend_recovery_score = avg_recovery * 25  # Sur 25 points
        
        # Autres scores simplifiés
        muscle_variety = len(set(ex.get('body_part', 'unknown') for ex in exercises))
        muscle_rotation_score = min(25, muscle_variety * 6)  # Max 25
        
        progression_score = 20  # Score neutre
        adherence_score = max(10, 25 - max(0, len(exercises) - 6) * 3)  # Pénalité si trop d'exercices
        
        backend_total = int(backend_recovery_score + muscle_rotation_score + progression_score + adherence_score)
        divergence = abs(backend_total - frontend_score)
        
        # Déterminer la validation
        validation_status = "valid" if divergence <= 10 else "divergent"
        
        return {
            "validation": validation_status,
            "backend_score": backend_total,
            "frontend_score": frontend_score,
            "divergence": divergence,
            "breakdown": {
                "recovery": int(backend_recovery_score),
                "muscle_rotation": muscle_rotation_score,
                "progression": progression_score,
                "adherence": adherence_score
            },
            "metadata": {
                "exercises_count": len(exercises),
                "recovery_samples": len(recovery_scores),
                "muscle_variety": muscle_variety,
                "calculation_method": "simplified_backend",
                "validated_at": datetime.now(timezone.utc).isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"Erreur validation scoring user {user_id}: {str(e)}")
        
        return {
            "validation": "error",
            "backend_score": 0,
            "frontend_score": request.get('current_score', 0),
            "divergence": request.get('current_score', 0),
            "error": str(e),
            "metadata": {
                "validated_at": datetime.now(timezone.utc).isoformat()
            }
        }

@router.get("/api/users/{user_id}/scoring-analytics")
async def get_scoring_analytics(user_id: int, db: Session = Depends(get_db)):
    """
    Endpoint pour analytics du système de scoring Phase 3.1
    Fournit des métriques sur l'utilisation et l'efficacité du scoring
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    try:
        # Analyser les dernières séances pour trends
        recent_workouts = db.query(Workout).filter(
            Workout.user_id == user_id,
            Workout.status == 'completed'
        ).order_by(Workout.completed_at.desc()).limit(10).all()
        
        # Calculer métriques basiques
        completion_rate = len([w for w in recent_workouts if w.status == 'completed']) / max(1, len(recent_workouts))
        
        avg_duration = None
        if recent_workouts:
            durations = [w.total_duration_minutes for w in recent_workouts if w.total_duration_minutes]
            avg_duration = sum(durations) / len(durations) if durations else None
        
        # Analyser la diversité musculaire
        muscle_distribution = {}
        for workout in recent_workouts:
            for workout_set in workout.sets:
                exercise = db.query(Exercise).filter(Exercise.id == workout_set.exercise_id).first()
                if exercise and exercise.body_part:
                    muscle = exercise.body_part
                    muscle_distribution[muscle] = muscle_distribution.get(muscle, 0) + 1
        
        # Calculer score de diversité
        total_sets = sum(muscle_distribution.values())
        diversity_score = len(muscle_distribution) * 10 if total_sets > 0 else 0  # Sur 60 (6 muscles * 10)
        
        return {
            "analytics": {
                "completion_rate": round(completion_rate, 3),
                "avg_session_duration": round(avg_duration, 1) if avg_duration else None,
                "muscle_diversity_score": min(60, diversity_score),
                "muscle_distribution": muscle_distribution,
                "recent_workouts_count": len(recent_workouts)
            },
            "recommendations": {
                "scoring_reliability": "high" if completion_rate > 0.8 else "medium" if completion_rate > 0.6 else "low",
                "suggested_improvements": _generate_scoring_recommendations(completion_rate, diversity_score, muscle_distribution)
            },
            "metadata": {
                "analysis_period": "last_10_workouts",
                "calculated_at": datetime.now(timezone.utc).isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"Erreur analytics scoring user {user_id}: {str(e)}")
        
        return {
            "analytics": {
                "completion_rate": 0.0,
                "avg_session_duration": None,
                "muscle_diversity_score": 0,
                "muscle_distribution": {},
                "recent_workouts_count": 0
            },
            "recommendations": {
                "scoring_reliability": "unknown",
                "suggested_improvements": ["Données insuffisantes pour l'analyse"]
            },
            "metadata": {
                "analysis_period": "last_10_workouts",
                "calculated_at": datetime.now(timezone.utc).isoformat(),
                "error": str(e)
            }
        }

@router.delete("/api/workouts/{workout_id}")
async def delete_workout(workout_id: int, db: Session = Depends(get_db)):
    """Supprime une séance et toutes ses séries associées"""
    workout = db.query(Workout).filter(Workout.id == workout_id).first()
    if not workout:
        raise HTTPException(status_code=404, detail="Workout not found")
    
    # Supprimer toutes les séries associées (cascade devrait le faire automatiquement)
    db.query(WorkoutSet).filter(WorkoutSet.workout_id == workout_id).delete()
    
    # Supprimer la séance
    db.delete(workout)
    db.commit()
    
    return {"message": "Workout deleted successfully"}

def _generate_scoring_recommendations(completion_rate: float, diversity_score: int, muscle_distribution: dict) -> list:
    """Génère des recommandations basées sur les analytics"""
    recommendations = []
    
    if completion_rate < 0.7:
        recommendations.append("Considérer des séances plus courtes pour améliorer l'adhérence")
    
    if diversity_score < 30:
        recommendations.append("Augmenter la variété des groupes musculaires travaillés")
    
    if muscle_distribution:
        max_muscle = max(muscle_distribution, key=muscle_distribution.get)
        max_count = muscle_distribution[max_muscle]
        total_count = sum(muscle_distribution.values())
        
        if max_count / total_count > 0.4:
            recommendations.append(f"Réduire la fréquence de {max_muscle} pour un meilleur équilibre")
    
    if not recommendations:
        recommendations.append("Programme bien équilibré, continuez ainsi !")
    
    return recommendations