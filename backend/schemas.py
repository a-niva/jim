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


class UserResponse(BaseModel):
    id: int
    name: str
    birth_date: datetime
    height: float
    weight: float
    experience_level: str
    equipment_config: Dict[str, Any]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ===== SCHEMAS EXERCICES =====

class ExerciseResponse(BaseModel):
    id: int
    name: str
    muscle_groups: List[str]
    equipment_required: List[str]
    difficulty: str
    default_sets: int
    default_reps_min: int
    default_reps_max: int
    rest_time_seconds: int
    instructions: Optional[str] = None
    
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
    rest_time_seconds: Optional[int] = None
    
    # Nouveaux champs pour l'interface détaillée et le ML
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


class SetResponse(BaseModel):
    id: int
    workout_id: int
    exercise_id: int
    set_number: int
    reps: int
    weight: Optional[float]
    duration_seconds: Optional[int]
    rest_time_seconds: Optional[int]
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
    confidence: float
    reasoning: str
    weight_change: str  # "increase", "decrease", "same"
    reps_change: str
    baseline_weight: Optional[float]
    baseline_reps: int