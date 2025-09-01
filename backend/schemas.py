# ===== backend/schemas.py - VERSION REFACTORISÉE =====
from pydantic import BaseModel, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from sqlalchemy import func

# ===== SCHEMAS UTILISATEUR =====

class UserCreate(BaseModel):
    name: str
    birth_date: datetime
    height: float  # cm
    weight: float  # kg
    experience_level: str  # beginner, intermediate, advanced
    equipment_config: Dict[str, Any]
    prefer_weight_changes_between_sets: bool = True
    sound_notifications_enabled: bool = True
    focus_areas: Optional[List[str]] = None
    sessions_per_week: Optional[int] = 3
    session_duration: Optional[int] = 45


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
    favorite_exercises: Optional[List[int]] = []
    sound_notifications_enabled: bool
    voice_counting_enabled: bool
    voice_counting_mode: str
    motion_detection_enabled: bool
    motion_calibration_data: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class UserPreferenceUpdate(BaseModel):
    prefer_weight_changes_between_sets: Optional[bool] = None
    sound_notifications_enabled: Optional[bool] = None
    motion_detection_enabled: Optional[bool] = None
    motion_calibration_data: Optional[Dict[str, Any]] = None

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
    ppl: List[str] = []

    class Config:
        from_attributes = True

# ===== SCHEMAS SÉANCES =====

class WorkoutCreate(BaseModel):
    type: str  # "free" ou "program"
    ai_generated: Optional[bool] = False 

class WorkoutResponse(BaseModel):
    id: int
    user_id: int
    type: str
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

    # Tracking du toggle ML
    ml_adjustment_enabled: Optional[bool] = True
    confidence_score: Optional[float] = None
    voice_data: Optional[Dict] = None

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
    voice_data: Optional[Dict]
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
    rest_confidence: Optional[float] = None  # NOUVEAU
    rest_reason: Optional[str] = None  # NOUVEAU
    confidence: float
    reasoning: str
    weight_change: str  # "increase", "decrease", "same"
    reps_change: str
    baseline_weight: Optional[float]
    baseline_reps: int
    adaptation_strategy: str  # NOUVEAU: "variable_weight" ou "fixed_weight"
    exercise_type: Optional[str] = None  # NOUVEAU: "external", "bodyweight", "hybrid"
   

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


# ===== MODULE 1 - SWAP SCHEMAS =====
class SwapRequest(BaseModel):
    original_exercise_id: int
    new_exercise_id: int
    reason: str  # 'pain', 'equipment', 'preference'
    sets_completed_before: int = 0

class ExerciseAlternative(BaseModel):
    exercise_id: int
    name: str
    muscle_groups: List[str]
    equipment_required: List[str]
    ppl: List[str] = []
    difficulty: str
    score: float
    reason_match: str

class AlternativesResponse(BaseModel):
    alternatives: List[ExerciseAlternative]
    keep_current: Dict[str, str]
    source_exercise: str
    reason: str

class SwapEligibility(BaseModel):
    allowed: bool
    reason: str

# ===== SCHÉMA VOCAL ML =====

class VoiceDataML(BaseModel):
    """Schéma pour données vocales enrichies ML"""
    count: int
    tempo_avg: Optional[float] = None
    gaps: List[int] = []
    timestamps: List[int] = []
    confidence: float = 1.0
    suspicious_jumps: int = 0
    repetitions: int = 0
    validated: bool = False
    validation_method: str = 'unknown'  # 'auto_confirmed', 'user_confirmed', 'legacy'
    start_time: Optional[int] = None
    total_duration: Optional[int] = None
    data_quality: Optional[Dict[str, Any]] = None

class SetCreate(BaseModel):
    exercise_id: int
    set_number: int
    reps: int
    weight: Optional[float] = None
    duration_seconds: Optional[int] = None
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    fatigue_level: Optional[int] = None
    effort_level: Optional[int] = None
    base_rest_time_seconds: Optional[int] = None
    ml_weight_suggestion: Optional[float] = None
    ml_reps_suggestion: Optional[int] = None
    ml_confidence: Optional[float] = None
    user_followed_ml_weight: Optional[bool] = None
    user_followed_ml_reps: Optional[bool] = None
    exercise_order_in_session: Optional[int] = None
    set_order_in_session: Optional[int] = None
    ml_adjustment_enabled: Optional[bool] = None
    voice_data: Optional[VoiceDataML] = None  # MODIFIER POUR UTILISER LE NOUVEAU SCHÉMA