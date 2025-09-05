"""
Constants pour le mapping des groupes musculaires
Assure la cohérence entre frontend, backend et exercises.json
"""

# Groupes musculaires standards (format exercises.json)
STANDARD_MUSCLE_GROUPS = [
    "dos",
    "pectoraux", 
    "epaules",
    "jambes",
    "abdominaux",
    "bras"
]

# Mapping de normalisation
MUSCLE_GROUP_MAPPING = {
    # Format minuscule (standard)
    "dos": "dos",
    "pectoraux": "pectoraux",
    "epaules": "epaules", 
    "jambes": "jambes",
    "abdominaux": "abdominaux",
    "bras": "bras",
    
    # Format majuscule (legacy)
    "Dos": "dos",
    "Pectoraux": "pectoraux",
    "Épaules": "epaules",
    "Deltoïdes": "epaules",  # ⚠️ IMPORTANT
    "Jambes": "jambes",
    "Abdominaux": "abdominaux",
    "Bras": "bras",
    
    # Variations d'affichage
    "épaules": "epaules",
    "deltoides": "epaules",
    "pecs": "pectoraux",
    "triceps": "bras",
    "biceps": "bras"
}

PPL_CATEGORIES = {
    'push': {
        'name': 'Push',
        'muscles': ['pectoraux', 'epaules', 'bras'],  # triceps inclus dans bras
        'description': 'Exercices de poussée - pectoraux, épaules, triceps',
        'icon': '💪',
        'color': '#3b82f6'
    },
    'pull': {
        'name': 'Pull', 
        'muscles': ['dos', 'bras'],  # biceps inclus dans bras
        'description': 'Exercices de traction - dos, biceps',
        'icon': '🏋️',
        'color': '#10b981'
    },
    'legs': {
        'name': 'Legs',
        'muscles': ['jambes'],
        'description': 'Exercices jambes complètes',
        'icon': '🦵',
        'color': '#f59e0b'
    },
    'core': {
        'name': 'Core (Abdominaux)',
        'muscles': ['abdominaux'], 
        'description': 'Exercices gainage et abdominaux',
        'icon': '💥',
        'color': '#ef4444'
    }
}

PPL_MUSCLE_MAPPING = {
    'pectoraux': ['push'],
    'epaules': ['push'],
    'dos': ['pull'],
    'jambes': ['legs'],
    'abdominaux': ['core'],
    'bras': ['push', 'pull']  # Hybride - dépend du contexte triceps/biceps
}

def normalize_muscle_group(muscle_group: str) -> str:
    """Normalise un groupe musculaire vers le format standard"""
    return MUSCLE_GROUP_MAPPING.get(muscle_group, muscle_group.lower())

def normalize_muscle_groups(muscle_groups: list) -> list:
    """Normalise une liste de groupes musculaires"""
    return [normalize_muscle_group(mg) for mg in muscle_groups]

def exercise_matches_focus_area(exercise_muscle_groups: list, focus_area: str) -> bool:
    """Vérifie si un exercice correspond à un focus_area - version simplifiée"""
    if not exercise_muscle_groups:
        return False
    
    # Normaliser les muscle_groups de l'exercice
    normalized_exercise_muscles = [normalize_muscle_group(mg) for mg in exercise_muscle_groups]
    
    # Vérification directe - focus_area doit être dans les muscle_groups
    normalized_focus = normalize_muscle_group(focus_area)
    return normalized_focus in normalized_exercise_muscles