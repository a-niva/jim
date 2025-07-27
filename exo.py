import json

# Charger le fichier JSON
with open('exercises.json', 'r', encoding='utf-8') as f:
    exercises = json.load(f)

# Filtrer les exercices avec barbell et extraire les noms
barbell_exercises = [ex for ex in exercises if "barbell" in ex.get("equipment_required", [])]
names = [f'"{ex["name"]}"' for ex in barbell_exercises]
result = ';'.join(names)

print(result)
print(f"\nNombre d'exercices avec barbell: {len(barbell_exercises)}")