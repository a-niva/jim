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