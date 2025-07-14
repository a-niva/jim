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

def normalize_muscle_group(muscle_group: str) -> str:
    """Normalise un groupe musculaire vers le format standard"""
    return MUSCLE_GROUP_MAPPING.get(muscle_group, muscle_group.lower())

def normalize_muscle_groups(muscle_groups: list) -> list:
    """Normalise une liste de groupes musculaires"""
    return [normalize_muscle_group(mg) for mg in muscle_groups]

# Mapping des focus_areas (Program Builder) vers les muscle_groups (exercises.json)
FOCUS_AREA_TO_MUSCLE_GROUPS = {
    "upper_body": ["pectoraux", "dos", "epaules"],
    "legs": ["jambes"], 
    "arms": ["bras"],
    "core": ["abdominaux"],
    "back": ["dos"],
    "shoulders": ["epaules"]
}

def get_muscle_groups_for_focus_area(focus_area: str) -> list:
    """Retourne les muscle_groups correspondants à un focus_area"""
    return FOCUS_AREA_TO_MUSCLE_GROUPS.get(focus_area.lower(), [])

def exercise_matches_focus_area(exercise_muscle_groups: list, focus_area: str) -> bool:
    """Vérifie si un exercice correspond à un focus_area"""
    if not exercise_muscle_groups:
        return False
    
    target_muscles = get_muscle_groups_for_focus_area(focus_area)
    if not target_muscles:
        return False
    
    # Normaliser les muscle_groups de l'exercice
    normalized_exercise_muscles = [normalize_muscle_group(mg) for mg in exercise_muscle_groups]
    
    # Vérifier si au moins un muscle de l'exercice matche le focus_area
    return any(muscle in target_muscles for muscle in normalized_exercise_muscles)