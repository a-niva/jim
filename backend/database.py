# ===== backend/database.py - VERSION REFACTORISÉE =====
# sur Render : Name : fitness_coach_db Database : fitness_coach User : fitness_coach_user

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Render fournira DATABASE_URL automatiquement pour PostgreSQL
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./fitness_coach.db")

# Render utilise postgres:// mais SQLAlchemy nécessite postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Configuration différente selon le type de base de données
if DATABASE_URL.startswith("postgresql://"):
    # Configuration PostgreSQL pour production
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        echo=False
    )
else:
    # Configuration SQLite pour développement local
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()