"""
Migration simple pour Module 1 - Swap
Usage: python backend/migration_swap.py
"""

from sqlalchemy import text
from backend.database import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_swap_fields():
    """Migration rapide et sûre"""
    logger.info("🔄 Migration Module 1 - Swap...")
    
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            # 1. WorkoutSet - ajouter champs swap
            conn.execute(text("""
                ALTER TABLE workout_sets 
                ADD COLUMN IF NOT EXISTS swap_from_exercise_id INTEGER REFERENCES exercises(id),
                ADD COLUMN IF NOT EXISTS swap_reason VARCHAR(20)
            """))
            
            # 2. Workout - ajouter modifications
            conn.execute(text("""
                ALTER TABLE workouts 
                ADD COLUMN IF NOT EXISTS modifications JSON DEFAULT '[]'
            """))
            
            # 3. Table SwapLog
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS swap_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    workout_id INTEGER NOT NULL REFERENCES workouts(id),
                    original_exercise_id INTEGER NOT NULL REFERENCES exercises(id),
                    new_exercise_id INTEGER NOT NULL REFERENCES exercises(id),
                    reason VARCHAR(20) NOT NULL,
                    sets_completed_before INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            
            # 4. Index essentiel
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_swap_user_original 
                ON swap_logs(user_id, original_exercise_id)
            """))
            
            trans.commit()
            logger.info("✅ Migration terminée")
            
        except Exception as e:
            trans.rollback()
            logger.error(f"❌ Erreur: {e}")
            raise

if __name__ == "__main__":
    migrate_swap_fields()