# ===== backend/models.py - VERSION REFACTORISÉE =====
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Boolean, Text, Index
from sqlalchemy.orm import relationship
from datetime import datetime
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
    created_at = Column(DateTime, default=datetime.utcnow)
    prefer_weight_changes_between_sets = Column(Boolean, default=True)

    # Relations
    workouts = relationship("Workout", back_populates="user", cascade="all, delete-orphan")
    programs = relationship("Program", back_populates="user", cascade="all, delete-orphan")
    adaptation_coefficients = relationship("UserAdaptationCoefficients", back_populates="user", cascade="all, delete-orphan")
    performance_states = relationship("PerformanceStates", back_populates="user", cascade="all, delete-orphan")

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


class Program(Base):
    __tablename__ = "programs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    sessions_per_week = Column(Integer, nullable=False)
    session_duration_minutes = Column(Integer, nullable=False)
    focus_areas = Column(JSON, nullable=False)  # ["upper_body", "core"]
    exercises = Column(JSON, nullable=False)  # Liste ordonnée des exercices avec sets/reps
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    
    user = relationship("User", back_populates="programs")


class Workout(Base):
    __tablename__ = "workouts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)  # "free" ou "program"
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=True)
    status = Column(String, default="active")  # active, completed, abandoned
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    total_duration_minutes = Column(Integer, nullable=True)
    
    # Métadonnées de séance pour le ML
    session_notes = Column(Text, nullable=True)
    overall_fatigue_start = Column(Integer, nullable=True)  # 1-5
    overall_fatigue_end = Column(Integer, nullable=True)  # 1-5
    
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

    # Feedback utilisateur pour le ML
    fatigue_level = Column(Integer, nullable=True)  # 1-5 (très facile à très difficile)
    effort_level = Column(Integer, nullable=True)  # 1-5 (réserve importante à échec total)
    
    # Métadonnées pour les recommandations ML
    ml_weight_suggestion = Column(Float, nullable=True)  # Poids suggéré par le ML
    ml_reps_suggestion = Column(Integer, nullable=True)  # Reps suggérées par le ML
    ml_confidence = Column(Float, nullable=True)  # Confiance de la recommandation (0-1)
    user_followed_ml_weight = Column(Boolean, nullable=True)  # L'utilisateur a-t-il suivi la suggestion de poids
    user_followed_ml_reps = Column(Boolean, nullable=True)  # L'utilisateur a-t-il suivi la suggestion de reps
    
    # Position dans la séance pour le ML
    exercise_order_in_session = Column(Integer, nullable=True)  # 1er, 2ème, 3ème exercice...
    set_order_in_session = Column(Integer, nullable=True)  # 1ère, 2ème, 3ème série globale...
    
    completed_at = Column(DateTime, default=datetime.utcnow)
    
    workout = relationship("Workout", back_populates="sets")
    exercise = relationship("Exercise")


class SetHistory(Base):
    """Table d'historique pour l'analyse ML avancée"""
    __tablename__ = "set_history"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    
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
    rest_before_seconds = Column(Integer, nullable=True)  # Repos avant cette série
    session_fatigue_start = Column(Integer, nullable=True)  # Fatigue début séance
    
    # Résultat
    success = Column(Boolean, nullable=False)  # L'utilisateur a-t-il réussi la série comme prévu
    actual_reps = Column(Integer, nullable=False)  # Reps réellement effectuées
    
    date_performed = Column(DateTime, default=datetime.utcnow)
    
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
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
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
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User")

class UserAdaptationCoefficients(Base):
    """Coefficients d'adaptation personnalisés pour chaque utilisateur"""
    __tablename__ = "user_adaptation_coefficients"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    
    # Coefficients personnalisés
    recovery_rate = Column(Float, default=1.0)  # Vitesse de récupération entre séries
    fatigue_sensitivity = Column(Float, default=1.0)  # Sensibilité à la fatigue
    volume_response = Column(Float, default=1.0)  # Réponse au volume d'entraînement
    typical_progression_increment = Column(Float, default=2.5)  # Incrément de progression habituel
    
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
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
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relations
    user = relationship("User")
    exercise = relationship("Exercise")
    
    # Index unique
    __table_args__ = (
        Index('idx_user_exercise_performance', 'user_id', 'exercise_id', unique=True),
    )