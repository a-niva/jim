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
    program_name: Optional[str] = "Mon programme"


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

    class Config:
        from_attributes = True

class UserPreferenceUpdate(BaseModel):
    prefer_weight_changes_between_sets: Optional[bool] = None
    sound_notifications_enabled: Optional[bool] = None
    motion_detection_enabled: Optional[bool] = None

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
    
    # NOUVEAU : Champs schedule
    schedule: Optional[Dict[str, Any]] = {}
    schedule_metadata: Optional[Dict[str, Any]] = {}
    
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

# ===== NOUVEAUX SCHEMAS POUR PROGRAM BUILDER =====

class ProgramBuilderStart(BaseModel):
    """Données initiales pour démarrer le ProgramBuilder"""
    duration_weeks: int = 8  # 4-16 semaines
    goals: List[str]  # ["muscle", "strength", "endurance"]
    training_frequency: int  # 3-6 fois par semaine
    experience_level: str  # de l'onboarding
    available_time_per_session: int = 60  # minutes
    
    @validator('duration_weeks')
    def validate_duration(cls, v):
        if not 4 <= v <= 16:
            raise ValueError('Durée doit être entre 4 et 16 semaines')
        return v
    
    @validator('training_frequency')
    def validate_frequency(cls, v):
        if not 3 <= v <= 6:
            raise ValueError('Fréquence doit être entre 3 et 6 fois par semaine')
        return v

class ProgramBuilderSelections(BaseModel):
    """Réponses au questionnaire ProgramBuilder"""
    training_frequency: int = 4  # 3-6 séances par semaine  
    session_duration: int = 60   # 30-90 minutes par séance
    focus_areas: List[str]  # ["upper_body", "legs", "core", "back", "shoulders", "arms"]
    periodization_preference: str = "linear"  # "linear", "undulating"
    exercise_variety_preference: str = "balanced"  # "minimal", "balanced", "high"
    session_intensity_preference: str = "moderate"  # "light", "moderate", "intense"
    recovery_priority: str = "balanced"  # "performance", "balanced", "recovery"
    equipment_priorities: List[str] = []  # Équipements préférés
    time_constraints: Dict[str, Any] = {}  # Contraintes horaires spécifiques
    
    @validator('focus_areas')
    def validate_focus_areas(cls, v):
        allowed = ["pectoraux", "dos", "epaules", "jambes", "abdominaux", "bras"]
        if not all(area in allowed for area in v):
            raise ValueError(f'Focus areas doivent être dans {allowed}')
        if len(v) < 1 or len(v) > 3:
            raise ValueError('1 à 3 focus areas requis')
        return v 

class ComprehensiveProgramCreate(BaseModel):
    """Schéma pour créer un programme complet"""
    name: str
    duration_weeks: int
    periodization_type: str
    sessions_per_week: int
    session_duration_minutes: int
    focus_areas: List[str]
    weekly_structure: List[Dict[str, Any]]
    progression_rules: Dict[str, Any]
    base_quality_score: float = 0.0

class ComprehensiveProgramResponse(BaseModel):
    """Réponse programme complet avec métadonnées"""
    id: int
    user_id: int
    name: str
    duration_weeks: int
    periodization_type: str
    sessions_per_week: int
    session_duration_minutes: int
    focus_areas: List[str]
    weekly_structure: List[Dict[str, Any]]
    progression_rules: Dict[str, Any]
    current_week: int
    current_session_in_week: int
    started_at: Optional[datetime]
    estimated_completion: Optional[datetime]
    base_quality_score: float
    format_version: str = "2.0"
    created_at: datetime
    is_active: bool
    
    class Config:
        from_attributes = True

class ProgramBuilderRecommendations(BaseModel):
    """Recommandations ML pour le questionnaire"""
    suggested_duration: int
    suggested_frequency: int
    suggested_focus_areas: List[str]
    questionnaire_items: List[Dict[str, Any]]
    user_insights: List[str]  # Messages personnalisés
    confidence_level: float

class WeeklySessionPreview(BaseModel):
    """Preview d'une semaine de programme"""
    week_number: int
    sessions: List[Dict[str, Any]]
    total_weekly_volume: float
    muscle_distribution: Dict[str, float]
    estimated_weekly_duration: int
    progression_notes: List[str]

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