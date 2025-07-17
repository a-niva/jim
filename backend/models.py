# ===== backend/models.py - VERSION REFACTORISÉE =====
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, Time, ForeignKey, JSON, Boolean, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime, timezone
from backend.database import Base


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    birth_date = Column(DateTime, nullable=False)
    height = Column(Float, nullable=False)  # cm
    weight = Column(Float, nullable=False)  # kg
    experience_level = Column(String, nullable=False)  # beginner, intermediate, advanced
    equipment_config = Column(JSON, nullable=False)  # Configuration complète équipement
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    favorite_exercises = Column(JSON, nullable=True, default=lambda: [])   # Liste des IDs d'exercices favoris
    prefer_weight_changes_between_sets = Column(Boolean, default=True)
    sound_notifications_enabled = Column(Boolean, default=True)
    show_plate_helper = Column(Boolean, default=False)

    # Relations
    workouts = relationship("Workout", back_populates="user", cascade="all, delete-orphan")
    programs = relationship("Program", back_populates="user", cascade="all, delete-orphan")
    adaptation_coefficients = relationship("UserAdaptationCoefficients", back_populates="user", cascade="all, delete-orphan")
    performance_states = relationship("PerformanceStates", back_populates="user", cascade="all, delete-orphan")

    comprehensive_program = relationship("ComprehensiveProgram", back_populates="user", uselist=False)

class Exercise(Base):
    __tablename__ = "exercises"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    muscle_groups = Column(JSON, nullable=False)  # ["bras", "dos"]
    muscles = Column(JSON, nullable=True)  # ["triceps", "deltoides"]
    equipment_required = Column(JSON, nullable=False)  # ["dumbbells"] ou ["bodyweight"]
    difficulty = Column(String, nullable=False)  # beginner, intermediate, advanced
    default_sets = Column(Integer, default=3)
    default_reps_min = Column(Integer, default=8)
    default_reps_max = Column(Integer, default=12)
    base_rest_time_seconds = Column(Integer, default=60)  # Temps de repos de base
    instructions = Column(Text)
    
    # Métadonnées pour le ML
    exercise_type = Column(String)  # compound, isolation, cardio
    intensity_factor = Column(Float, default=1.0)  # Facteur d'intensité pour ajuster le repos
    
    # NOUVEAUX CHAMPS
    weight_type = Column(String, default="external")  # "external", "bodyweight", "hybrid"
    base_weights_kg = Column(JSON, nullable=True)  # Structure avec base + per_kg_bodyweight
    bodyweight_percentage = Column(JSON, nullable=True)  # Pour exercices bodyweight/hybrid


class Program(Base):
    """Programme de fitness complet avec structure temporelle et scoring"""
    __tablename__ = "programs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Métadonnées programme
    name = Column(String(100), nullable=False)
    duration_weeks = Column(Integer, nullable=False)  # 4-16 semaines
    periodization_type = Column(String(50), default="linear")  # "linear", "undulating"
    sessions_per_week = Column(Integer, nullable=False)
    session_duration_minutes = Column(Integer, nullable=False)
    focus_areas = Column(JSON, nullable=False)  # ["upper_body", "legs", "core"]
    
    # Structure temporelle NOUVELLE
    weekly_structure = Column(JSON, nullable=False)  
    # Format: [
    #   {
    #     "week": 1, 
    #     "sessions": [
    #       {
    #         "day": "monday", 
    #         "exercise_pool": [
    #           {
    #             "exercise_id": 1,
    #             "sets": 3,
    #             "reps_min": 8,
    #             "reps_max": 12,
    #             "priority": 5,
    #             "constraints": {
    #               "min_recovery_hours": 48,
    #               "max_frequency_per_week": 2
    #             }
    #           }
    #         ],
    #         "focus": "upper",
    #         "target_duration": 60
    #       }
    #     ]
    #   }
    # ]
    
    progression_rules = Column(JSON, nullable=False)  # Règles intensité/volume
    # Format: {
    #   "intensity_progression": "linear",  # +2.5% par semaine
    #   "volume_progression": "wave",       # ondulée
    #   "deload_frequency": 4               # toutes les 4 semaines
    # }
    
    # État et suivi
    current_week = Column(Integer, default=1)
    current_session_in_week = Column(Integer, default=1)
    started_at = Column(DateTime, nullable=True)
    estimated_completion = Column(DateTime, nullable=True)
    
    # Scoring et qualité
    base_quality_score = Column(Float, default=0.0)  # Score 0-100
    user_modifications = Column(JSON, default=lambda: [])  # Historique changements
    
    # VERSION - CHAMP MANQUANT CRITIQUE !
    format_version = Column(String(10), default="2.0")
    
    # LEGACY - Pour compatibilité avec l'ancien code
    exercises = Column(JSON, nullable=True, default=lambda: [])
    goals = Column(JSON, nullable=True, default=lambda: [])
    
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    format_version = Column(String(10), default="1.0") # VERSION - Pour distinguer les formats
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True)
    
    user = relationship("User", back_populates="programs")

class ComprehensiveProgram(Base):
    """Modèle programme v2.0 avec structure temporelle avancée"""
    __tablename__ = "comprehensive_programs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)  # 1 programme par user
    
    # Métadonnées programme
    name = Column(String(100), nullable=False)
    duration_weeks = Column(Integer, nullable=False)  # 4-16 semaines
    periodization_type = Column(String(50), default="linear")  # "linear", "undulating"
    sessions_per_week = Column(Integer, nullable=False)
    session_duration_minutes = Column(Integer, nullable=False)
    focus_areas = Column(JSON, nullable=False)  # ["upper_body", "legs", "core"]
    
    # Structure temporelle NOUVELLE
    weekly_structure = Column(JSON, nullable=False)  
    # Format: [
    #   {
    #     "week": 1, 
    #     "sessions": [
    #       {
    #         "day": "monday", 
    #         "exercise_pool": [
    #           {
    #             "exercise_id": 1,
    #             "exercise_name": "Développé couché",
    #             "sets": 3,
    #             "reps_min": 8,
    #             "reps_max": 12,
    #             "muscle_groups": ["pectoraux"],
    #             "priority": 5
    #           }
    #         ],
    #         "focus": "upper",
    #         "target_duration": 60,
    #         "quality_score": 75.0
    #       }
    #     ]
    #   }
    # ]
    
    progression_rules = Column(JSON, nullable=False)  # Règles intensité/volume
    
    # État et suivi
    current_week = Column(Integer, default=1)
    current_session_in_week = Column(Integer, default=1)
    started_at = Column(DateTime, nullable=True)
    estimated_completion = Column(DateTime, nullable=True)
    
    # Scoring et qualité
    base_quality_score = Column(Float, default=75.0)  # Score 0-100
    user_modifications = Column(JSON, default=lambda: [])  # Historique changements
    
    # Version et état
    format_version = Column(String(10), default="2.0")
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))
    
    # Relations
    user = relationship("User", back_populates="comprehensive_program")

class Workout(Base):
    __tablename__ = "workouts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)  # "free" ou "program"
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=True)
    status = Column(String, default="active")  # active, completed, abandoned
    started_at = Column(DateTime, default=datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)
    total_duration_minutes = Column(Integer, nullable=True)
    total_rest_time_seconds = Column(Integer, nullable=True)
    
    # Métadonnées de séance pour le ML
    session_notes = Column(Text, nullable=True)
    overall_fatigue_start = Column(Integer, nullable=True)  # 1-5
    overall_fatigue_end = Column(Integer, nullable=True)  # 1-5
    # Tracking des exercices skippés pour le ML
    skipped_exercises = Column(JSON, nullable=True, default=lambda: [])
    session_metadata = Column(JSON, nullable=True, default=lambda: {})
    # MODULE 1 : Tracking modifications globales
    modifications = Column(JSON, nullable=True, default=lambda: [])
        
    user = relationship("User", back_populates="workouts")
    program = relationship("Program")
    sets = relationship("WorkoutSet", back_populates="workout", cascade="all, delete-orphan")


class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    
    id = Column(Integer, primary_key=True, index=True)
    workout_id = Column(Integer, ForeignKey("workouts.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    set_number = Column(Integer, nullable=False)
    reps = Column(Integer, nullable=False)
    weight = Column(Float, nullable=True)  # null pour exercices au poids du corps
    duration_seconds = Column(Integer, nullable=True)  # pour exercices isométriques
    
    # NOUVEAUX CHAMPS pour le ML et l'interface détaillée
    target_reps = Column(Integer, nullable=True)  # Reps prévues
    target_weight = Column(Float, nullable=True)  # Poids prévu
    base_rest_time_seconds = Column(Integer, nullable=True)  # Temps de repos effectué après cette série
    suggested_rest_seconds = Column(Integer, nullable=True)  # Repos suggéré par le ML
    actual_rest_duration_seconds = Column(Integer, nullable=True)  # Temps de repos réellement écoulé


    # Feedback utilisateur pour le ML
    fatigue_level = Column(Integer, nullable=True)  # 1-5 (très facile à très difficile)
    effort_level = Column(Integer, nullable=True)  # 1-5 (réserve importante à échec total)
        
    # ML recommendations tracking
    ml_weight_suggestion = Column(Float, nullable=True)
    ml_reps_suggestion = Column(Integer, nullable=True)
    ml_confidence = Column(Float, nullable=True)
    user_followed_ml_weight = Column(Boolean, nullable=True)
    user_followed_ml_reps = Column(Boolean, nullable=True)
    #État du toggle ML au moment de la série
    ml_adjustment_enabled = Column(Boolean, nullable=True)

    # MODULE 1 : Champs swap
    swap_from_exercise_id = Column(Integer, ForeignKey('exercises.id'), nullable=True)
    swap_reason = Column(String(20), nullable=True)  # 'pain', 'equipment', 'preference'

    # Position dans la séance pour le ML
    exercise_order_in_session = Column(Integer, nullable=True)
    set_order_in_session = Column(Integer, nullable=True)  # 1ère, 2ème, 3ème série globale...

    completed_at = Column(DateTime, default=datetime.now(timezone.utc))

    workout = relationship("Workout", back_populates="sets")
    exercise = relationship("Exercise", foreign_keys="WorkoutSet.exercise_id")

    # MODULE 3 : Champs swap context
    swap_from_exercise_id = Column(Integer, ForeignKey('exercises.id'), nullable=True)
    swap_reason = Column(String(50), nullable=True)

class SetHistory(Base):
    """Table d'historique pour l'analyse ML avancée"""
    __tablename__ = "set_history"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    workout_id = Column(Integer, ForeignKey("workouts.id"), nullable=True)  # NOUVEAU
    
    # Contexte de la série
    weight = Column(Float, nullable=False)
    reps = Column(Integer, nullable=False)
    fatigue_level = Column(Integer, nullable=False)
    effort_level = Column(Integer, nullable=False)
    
    # Position dans la séance
    exercise_order_in_session = Column(Integer, nullable=False)
    set_order_in_session = Column(Integer, nullable=False)
    set_number_in_exercise = Column(Integer, nullable=False)
    
    # Contexte temporel
    rest_before_seconds = Column(Integer, nullable=True)
    session_fatigue_start = Column(Integer, nullable=True)
    
    # Résultat
    success = Column(Boolean, nullable=False)
    actual_reps = Column(Integer, nullable=False)
    
    date_performed = Column(DateTime, default=datetime.now(timezone.utc))
    
    # Relations
    user = relationship("User")
    exercise = relationship("Exercise")
    workout = relationship("Workout")  # OK avec le FK ajouté

class ExerciseCompletionStats(Base):
    """Table de cache pour les statistiques d'exercices - Alternative à la vue matérialisée"""
    __tablename__ = "exercise_completion_stats"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False, index=True)
    
    # Statistiques agrégées
    total_sessions = Column(Integer, default=0)
    total_sets = Column(Integer, default=0)
    sessions_last_7d = Column(Integer, default=0)
    sets_last_7d = Column(Integer, default=0)
    sessions_last_30d = Column(Integer, default=0)
    avg_weight_last_30d = Column(Float, nullable=True)
    
    # Dernière utilisation
    last_performed = Column(DateTime, nullable=True, index=True)
    
    # Performance
    avg_weight_all_time = Column(Float, nullable=True)
    max_weight_all_time = Column(Float, nullable=True)
    avg_fatigue_level = Column(Float, nullable=True)
    
    # Métadonnées
    last_updated = Column(DateTime, default=datetime.now(timezone.utc))
    
    # Index composé pour les requêtes fréquentes
    __table_args__ = (
        Index('idx_user_exercise_stats', 'user_id', 'exercise_id'),
        Index('idx_user_last_performed', 'user_id', 'last_performed'),
    )
    
    # Relations
    user = relationship("User")
    exercise = relationship("Exercise")

class UserCommitment(Base):
    """Engagement et objectifs de l'utilisateur"""
    __tablename__ = "user_commitments"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    
    # Objectifs hebdomadaires
    sessions_per_week = Column(Integer, nullable=False)
    minutes_per_session = Column(Integer, nullable=False)
    
    # Priorités musculaires
    focus_muscles = Column(JSON, nullable=True)  # {"pectoraux": "priority", "dos": "normal"}
    
    # Préférences
    preferred_days = Column(JSON, nullable=True)  # ["lundi", "mercredi", "vendredi"]
    preferred_time = Column(String, nullable=True)  # "morning", "afternoon", "evening"
    
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
    
    user = relationship("User")


class AdaptiveTargets(Base):
    """Objectifs adaptatifs par groupe musculaire"""
    __tablename__ = "adaptive_targets"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    muscle_group = Column(String, nullable=False)
    
    # Volumes cibles et actuels
    target_volume = Column(Float, nullable=False)
    current_volume = Column(Float, default=0.0)
    
    # Récupération
    recovery_debt = Column(Float, default=0.0)
    last_trained = Column(DateTime, nullable=True)
    
    # Adaptation
    adaptation_rate = Column(Float, default=1.0)
    
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
    
    user = relationship("User")


class PlannedSession(Base):
    """Séances planifiées pour le planning hebdomadaire"""
    __tablename__ = "planned_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=True)
    
    # Timing
    planned_date = Column(Date, nullable=False, index=True)
    planned_time = Column(Time, nullable=True)  # Optionnel
    week_number = Column(Integer, nullable=True)  # Dans le programme
    session_number_in_week = Column(Integer, nullable=True)  # 1-7
    
    # Contenu
    exercises = Column(JSON, nullable=False, default=lambda: [])
    estimated_duration = Column(Integer, nullable=True)  # minutes
    primary_muscles = Column(JSON, nullable=True, default=lambda: [])  # Pour warnings récupération
    
    # Scoring et état
    predicted_quality_score = Column(Float, nullable=True)
    actual_quality_score = Column(Float, nullable=True)  # Après réalisation
    status = Column(String(20), default="planned")  # planned, completed, skipped, moved
    
    # Métadonnées
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)
    
    # Relations
    user = relationship("User")
    program = relationship("Program")
    
    # Index composé pour les requêtes fréquentes
    __table_args__ = (
        Index('idx_user_planned_date', 'user_id', 'planned_date'),
        Index('idx_user_program_week', 'user_id', 'program_id', 'week_number'),
    )

class UserAdaptationCoefficients(Base):
    """Coefficients d'adaptation personnalisés pour chaque utilisateur"""
    __tablename__ = "user_adaptation_coefficients"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    
    # Coefficients personnalisés
    fatigue_sensitivity = Column(Float, default=1.0, nullable=False)
    effort_responsiveness = Column(Float, default=1.0, nullable=False)
    recovery_rate = Column(Float, default=1.0, nullable=False)
    volume_adaptability = Column(Float, default=1.0, nullable=False)
    strength_endurance_ratio = Column(Float, default=0.5, nullable=False)
    optimal_volume_multiplier = Column(Float, default=1.0, nullable=False)
    
    last_updated = Column(DateTime, default=datetime.now(timezone.utc))
    
    # Relations
    user = relationship("User")
    exercise = relationship("Exercise")
    
    # Index unique pour éviter les doublons
    __table_args__ = (
        Index('idx_user_exercise_coefficients', 'user_id', 'exercise_id', unique=True),
    )


class PerformanceStates(Base):
    """État de performance actuel pour chaque combinaison utilisateur-exercice"""
    __tablename__ = "performance_states"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    
    # État de performance
    base_potential = Column(Float, default=0.0)  # Potentiel de base (moyenne mobile)
    acute_fatigue = Column(Float, default=0.0)  # Fatigue aiguë de la séance
    last_session_timestamp = Column(DateTime, nullable=True)
    progression_pattern = Column(JSON, nullable=True)  # Patterns de progression observés
    
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc))
    
    # Relations
    user = relationship("User")
    exercise = relationship("Exercise")
    
    # Index unique
    __table_args__ = (
        Index('idx_user_exercise_performance', 'user_id', 'exercise_id', unique=True),
    )

class SwapLog(Base):
    __tablename__ = "swap_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    workout_id = Column(Integer, ForeignKey("workouts.id"), nullable=False)
    original_exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    new_exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    reason = Column(String(20), nullable=False)
    sets_completed_before = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    
    # Relations avec foreign_keys en string
    user = relationship("User")
    workout = relationship("Workout")
    original_exercise = relationship("Exercise", foreign_keys="SwapLog.original_exercise_id")
    new_exercise = relationship("Exercise", foreign_keys="SwapLog.new_exercise_id")

    # Index
    __table_args__ = (
        Index('idx_swap_user_original', 'user_id', 'original_exercise_id'),
    )