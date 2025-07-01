# ===== backend/schemas.py - VERSION REFACTORISÉE =====
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime


# ===== SCHEMAS UTILISATEUR =====

class UserCreate(BaseModel):
    name: str
    birth_date: datetime
    height: float  # cm
    weight: float  # kg
    experience_level: str  # beginner, intermediate, advanced
    equipment_config: Dict[str, Any]
    prefer_weight_changes_between_sets: bool = True


class UserResponse(BaseModel):
    id: int
    name: str
    birth_date: datetime
    height: float
    weight: float
    experience_level: str
    equipment_config: Dict[str, Any]
    prefer_weight_changes_between_sets: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class UserPreferenceUpdate(BaseModel):
    prefer_weight_changes_between_sets: bool

# ===== SCHEMAS EXERCICES =====

class ExerciseResponse(BaseModel):
    id: int
    name: str
    muscle_groups: List[str]
    muscles: Optional[List[str]]
    equipment_required: List[str]
    difficulty: str
    default_sets: int
    default_reps_min: int
    default_reps_max: int
    base_rest_time_seconds: int
    instructions: Optional[str]
    exercise_type: Optional[str]
    intensity_factor: Optional[float]
    weight_type: str = "external"
    base_weights_kg: Optional[Dict[str, Dict[str, float]]] = None
    bodyweight_percentage: Optional[Dict[str, float]] = None
    
    class Config:
        from_attributes = True


# ===== SCHEMAS PROGRAMMES =====

class ProgramCreate(BaseModel):
    name: str
    sessions_per_week: int
    session_duration_minutes: int
    focus_areas: List[str]  # ["upper_body", "legs", "core"]


class ProgramResponse(BaseModel):
    id: int
    user_id: int
    name: str
    sessions_per_week: int
    session_duration_minutes: int
    focus_areas: List[str]
    exercises: List[Dict[str, Any]]
    created_at: datetime
    is_active: bool
    
    class Config:
        from_attributes = True


# ===== SCHEMAS SÉANCES =====

class WorkoutCreate(BaseModel):
    type: str  # "free" ou "program"
    program_id: Optional[int] = None


class WorkoutResponse(BaseModel):
    id: int
    user_id: int
    type: str
    program_id: Optional[int]
    status: str
    started_at: datetime
    completed_at: Optional[datetime]
    total_duration_minutes: Optional[int]
    
    class Config:
        from_attributes = True


class SetCreate(BaseModel):
    exercise_id: int
    set_number: int
    reps: int
    weight: Optional[float] = None
    duration_seconds: Optional[int] = None
    base_rest_time_seconds: Optional[int] = None
    
    # Champs pour l'interface détaillée et le ML
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    fatigue_level: Optional[int] = None  # 1-5
    effort_level: Optional[int] = None   # 1-5
    
    # Recommandations ML
    ml_weight_suggestion: Optional[float] = None
    ml_reps_suggestion: Optional[int] = None
    ml_confidence: Optional[float] = None
    user_followed_ml_weight: Optional[bool] = None
    user_followed_ml_reps: Optional[bool] = None
    
    # Position dans la séance
    exercise_order_in_session: Optional[int] = None
    set_order_in_session: Optional[int] = None
    suggested_rest_seconds: Optional[int] = None  # Repos suggéré par le ML

class SetResponse(BaseModel):
    id: int
    workout_id: int
    exercise_id: int
    set_number: int
    reps: int
    weight: Optional[float]
    duration_seconds: Optional[int]
    base_rest_time_seconds: Optional[int]
    target_reps: Optional[int]
    target_weight: Optional[float]
    fatigue_level: Optional[int]
    effort_level: Optional[int]
    ml_weight_suggestion: Optional[float]
    ml_reps_suggestion: Optional[int]
    ml_confidence: Optional[float]
    user_followed_ml_weight: Optional[bool]
    user_followed_ml_reps: Optional[bool]
    exercise_order_in_session: Optional[int]
    set_order_in_session: Optional[int]
    suggested_rest_seconds: Optional[int]
    completed_at: datetime
    
    class Config:
        from_attributes = True


# Nouveau schéma pour les recommandations ML
class RecommendationRequest(BaseModel):
    exercise_id: int
    set_number: int = 1
    current_fatigue: int = 3  # 1-5
    previous_effort: int = 3  # 1-5
    last_rest_duration: Optional[int] = None
    exercise_order: int = 1
    set_order_global: int = 1


class RecommendationResponse(BaseModel):
    weight_recommendation: Optional[float]
    reps_recommendation: int
    rest_seconds_recommendation: Optional[int]  # NOUVEAU
    rest_range: Optional[Dict[str, int]]  # NOUVEAU: {"min": 30, "max": 120}
    confidence: float
    reasoning: str
    weight_change: str  # "increase", "decrease", "same"
    reps_change: str
    baseline_weight: Optional[float]
    baseline_reps: int
    adaptation_strategy: str  # NOUVEAU: "variable_weight" ou "fixed_weight"
    exercise_type: Optional[str] = None  # NOUVEAU: "external", "bodyweight", "hybrid"

# ===== SCHEMAS POUR LA GÉNÉRATION DE PROGRAMMES =====

class ProgramGenerationRequest(BaseModel):
    weeks: int = 4
    frequency: int = 3
    

# ===== SCHEMAS POUR LE SYSTÈME ADAPTATIF =====

class UserCommitmentCreate(BaseModel):
    sessions_per_week: int
    minutes_per_session: int
    focus_muscles: Optional[Dict[str, str]] = None
    preferred_days: Optional[List[str]] = None
    preferred_time: Optional[str] = None


class UserCommitmentResponse(BaseModel):
    id: int
    user_id: int
    sessions_per_week: int
    minutes_per_session: int
    focus_muscles: Optional[Dict[str, str]]
    preferred_days: Optional[List[str]]
    preferred_time: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class AdaptiveTargetsResponse(BaseModel):
    id: int
    user_id: int
    muscle_group: str
    target_volume: float
    current_volume: float
    recovery_debt: float
    last_trained: Optional[datetime]
    adaptation_rate: float
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TrajectoryAnalysis(BaseModel):
    status: str = "ready"
    on_track: bool
    sessions_this_week: int
    sessions_target: int
    volume_adherence: float
    consistency_score: float
    muscle_balance: Dict[str, float]
    insights: List[str]


# ===== SCHEMAS NON UTILISÉS MAIS RÉFÉRENCÉS (optionnels) =====

class ProgramDayBase(BaseModel):
    """Schéma pour un jour de programme (non utilisé actuellement)"""
    day: int
    exercises: List[Dict[str, Any]]


class ProgramExerciseBase(BaseModel):
    """Schéma pour un exercice dans un programme (non utilisé actuellement)"""
    exercise_id: int
    sets: int
    reps: int
    rest_seconds: int = 90