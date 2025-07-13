# ===== NOUVEAU FICHIER: backend/init_test_data.py =====
"""
Script pour créer des données de test avec le nouveau format ComprehensiveProgram
À exécuter après création/recréation de la base de données
"""

from sqlalchemy.orm import Session
from backend.database import engine, get_db
from backend.models import User, Exercise, Program
from datetime import datetime, timezone, timedelta
import json

def create_test_data():
    """Créer des données de test pour le nouveau système"""
    
    # Créer les tables
    from backend.models import Base
    Base.metadata.create_all(bind=engine)
    
    db = next(get_db())
    
    try:
        # 1. Créer un utilisateur de test
        test_user = User(
            name="Test User",
            birth_date=datetime(1990, 1, 1),
            height=175.0,
            weight=70.0,
            experience_level="intermediate",
            equipment_config={
                "dumbbells": True,
                "barbell_athletic": True,
                "bench": {
                    "available": True,
                    "positions": {
                        "flat": True,
                        "incline_up": True,
                        "decline": False
                    }
                }
            }
        )
        db.add(test_user)
        db.commit()
        db.refresh(test_user)
        print(f"✅ Utilisateur test créé: ID {test_user.id}")
        
        # 2. Créer des exercices de test s'ils n'existent pas
        exercises_data = [
            {
                "name": "Développé couché",
                "muscle_groups": ["Pectoraux"],
                "muscles": ["grand_pectoral", "triceps", "deltoïdes"],
                "equipment_required": ["barbell_athletic", "bench"],
                "difficulty": "intermediate",
                "default_sets": 4,
                "default_reps_min": 6,
                "default_reps_max": 10,
                "exercise_type": "compound",
                "intensity_factor": 1.2
            },
            {
                "name": "Rowing barre",
                "muscle_groups": ["Dos"],
                "muscles": ["grand_dorsal", "rhomboïdes", "biceps"],
                "equipment_required": ["barbell_athletic"],
                "difficulty": "intermediate",
                "default_sets": 4,
                "default_reps_min": 8,
                "default_reps_max": 12,
                "exercise_type": "compound",
                "intensity_factor": 1.1
            },
            {
                "name": "Squat",
                "muscle_groups": ["Jambes"],
                "muscles": ["quadriceps", "fessiers", "ischio_jambiers"],
                "equipment_required": ["barbell_athletic"],
                "difficulty": "intermediate",
                "default_sets": 4,
                "default_reps_min": 8,
                "default_reps_max": 12,
                "exercise_type": "compound",
                "intensity_factor": 1.3
            },
            {
                "name": "Développé militaire",
                "muscle_groups": ["Épaules"],
                "muscles": ["deltoïdes", "triceps"],
                "equipment_required": ["barbell_athletic"],
                "difficulty": "intermediate",
                "default_sets": 3,
                "default_reps_min": 8,
                "default_reps_max": 12,
                "exercise_type": "compound",
                "intensity_factor": 1.0
            },
            {
                "name": "Curls biceps",
                "muscle_groups": ["Bras"],
                "muscles": ["biceps"],
                "equipment_required": ["dumbbells"],
                "difficulty": "beginner",
                "default_sets": 3,
                "default_reps_min": 10,
                "default_reps_max": 15,
                "exercise_type": "isolation",
                "intensity_factor": 0.8
            },
            {
                "name": "Planche",
                "muscle_groups": ["Abdominaux"],
                "muscles": ["abdominaux", "transverse"],
                "equipment_required": ["bodyweight"],
                "difficulty": "beginner",
                "default_sets": 3,
                "default_reps_min": 30,
                "default_reps_max": 60,
                "exercise_type": "isometric",
                "intensity_factor": 0.7
            }
        ]
        
        created_exercises = []
        for ex_data in exercises_data:
            existing = db.query(Exercise).filter(Exercise.name == ex_data["name"]).first()
            if not existing:
                exercise = Exercise(**ex_data)
                db.add(exercise)
                created_exercises.append(exercise)
        
        db.commit()
        
        # Refresh pour avoir les IDs
        for ex in created_exercises:
            db.refresh(ex)
        
        print(f"✅ {len(created_exercises)} exercices créés")
        
        # 3. Créer un programme ComprehensiveProgram de test
        all_exercises = db.query(Exercise).all()
        exercise_ids = [ex.id for ex in all_exercises]
        
        # Structure de 8 semaines avec 3 sessions par semaine
        weekly_structure = []
        
        for week in range(1, 9):  # 8 semaines
            week_sessions = []
            
            # 3 sessions par semaine : Push, Pull, Legs
            sessions_config = [
                {
                    "day": "monday",
                    "focus": "upper_body",
                    "exercises": [1, 4, 5],  # Développé couché, Développé militaire, Curls
                    "target_duration": 60
                },
                {
                    "day": "wednesday", 
                    "focus": "back",
                    "exercises": [2, 5, 6],  # Rowing, Curls, Planche
                    "target_duration": 55
                },
                {
                    "day": "friday",
                    "focus": "legs",
                    "exercises": [3, 6],  # Squat, Planche
                    "target_duration": 50
                }
            ]
            
            for session_config in sessions_config:
                exercise_pool = []
                for ex_id in session_config["exercises"]:
                    if ex_id <= len(all_exercises):
                        exercise = all_exercises[ex_id - 1]
                        pool_entry = {
                            "exercise_id": exercise.id,
                            "sets": exercise.default_sets,
                            "reps_min": exercise.default_reps_min,
                            "reps_max": exercise.default_reps_max,
                            "priority": 3,  # Priorité neutre
                            "constraints": {
                                "min_recovery_hours": 48,
                                "max_frequency_per_week": 2
                            }
                        }
                        exercise_pool.append(pool_entry)
                
                session = {
                    "day": session_config["day"],
                    "exercise_pool": exercise_pool,
                    "focus": session_config["focus"],
                    "target_duration": session_config["target_duration"]
                }
                week_sessions.append(session)
            
            weekly_structure.append({
                "week": week,
                "sessions": week_sessions
            })
        
        # Règles de progression
        progression_rules = {
            "intensity_progression": "linear",
            "volume_progression": "wave",
            "deload_frequency": 4,
            "weight_increase_percentage": 2.5,
            "rep_increase_threshold": 12
        }
        
        # Créer le programme
        test_program = Program(
            user_id=test_user.id,
            name="Programme Test ComprehensiveProgram",
            duration_weeks=8,
            periodization_type="linear",
            sessions_per_week=3,
            session_duration_minutes=60,
            focus_areas=["upper_body", "legs", "back"],
            weekly_structure=weekly_structure,
            progression_rules=progression_rules,
            base_quality_score=85.0,
            current_week=1,
            current_session_in_week=1,
            is_active=True
        )
        
        db.add(test_program)
        db.commit()
        db.refresh(test_program)
        
        print(f"✅ Programme ComprehensiveProgram créé: ID {test_program.id}")
        print(f"   - {test_program.duration_weeks} semaines")
        print(f"   - {test_program.sessions_per_week} sessions/semaine")
        print(f"   - {len(weekly_structure)} semaines structurées")
        print(f"   - Score qualité: {test_program.base_quality_score}/100")
        
        print("\n🎉 Données de test créées avec succès!")
        print(f"Vous pouvez maintenant tester avec l'utilisateur ID: {test_user.id}")
        
        return {
            "user_id": test_user.id,
            "program_id": test_program.id,
            "exercises_count": len(all_exercises)
        }
        
    except Exception as e:
        print(f"❌ Erreur lors de la création des données de test: {e}")
        db.rollback()
        raise
    finally:
        db.close()

def verify_data():
    """Vérifier que les données ont été créées correctement"""
    db = next(get_db())
    
    try:
        users_count = db.query(User).count()
        exercises_count = db.query(Exercise).count() 
        programs_count = db.query(Program).count()
        
        print("\n📊 Vérification des données:")
        print(f"   - Utilisateurs: {users_count}")
        print(f"   - Exercices: {exercises_count}")
        print(f"   - Programmes: {programs_count}")
        
        # Vérifier structure du programme
        test_program = db.query(Program).filter(Program.is_active == True).first()
        if test_program and test_program.weekly_structure:
            week_1 = test_program.weekly_structure[0]
            print(f"   - Semaine 1 a {len(week_1['sessions'])} sessions")
            print(f"   - Session 1 a {len(week_1['sessions'][0]['exercise_pool'])} exercices")
            
        print("✅ Vérification terminée")
        
    except Exception as e:
        print(f"❌ Erreur lors de la vérification: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    print("🚀 Initialisation des données de test...")
    result = create_test_data()
    verify_data()
    
    print(f"\n🔧 Pour tester:")
    print(f"   1. Lancez le serveur FastAPI")
    print(f"   2. Connectez-vous avec l'utilisateur ID: {result['user_id']}")
    print(f"   3. Testez le démarrage d'une séance programme")
    print(f"   4. L'endpoint /programs/next-session devrait fonctionner")