import json
import requests
from pathlib import Path
from typing import Dict, List
import time
import logging

# Configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

class OllamaExerciseEnricher:
    """Utilise Ollama pour enrichir les exercices avec des valeurs réalistes"""
    
    def __init__(self, model="llama3.1:8b", ollama_url="http://localhost:11434"):
        self.model = model
        self.api_url = f"{ollama_url}/api/generate"
        self.verify_ollama_connection()
        
    def verify_ollama_connection(self):
        """Vérifie qu'Ollama est accessible"""
        try:
            response = requests.get(self.api_url.replace("/generate", "/tags"))
            if response.status_code == 200:
                models = response.json()
                logger.info("Connexion Ollama OK")
                logger.info(f"Modeles disponibles: {[m['name'] for m in models['models']]}")
                logger.info(f"Modele utilise: {self.model}")
            else:
                raise Exception("Ollama non accessible")
        except Exception as e:
            logger.error(f"Erreur connexion Ollama: {e}")
            exit(1)
    
    def create_prompt(self, exercise: Dict) -> str:
        """Crée un prompt optimisé pour Llama3"""
        return f"""Tu es un expert en science du sport. Analyse cet exercice et retourne UNIQUEMENT un JSON valide.

EXERCICE:
- Nom: {exercise['name_fr']}
- Equipement: {', '.join(exercise['equipment'])}
- Muscle: {exercise['body_part']}
- Niveau: {exercise['level']}

Retourne ce JSON EXACT (pas de texte avant ou après):
{{
  "progression_metadata": {{
    "min_weight_increment": 2.5,
    "typical_increment": 5.0,
    "plateau_threshold": 3,
    "deload_percentage": 0.85,
    "skill_complexity": 3
  }},
  "muscle_groups": {{
    "primary": ["{exercise['body_part'].lower()}"],
    "secondary": [],
    "stabilizers": ["Abdominaux"]
  }},
  "fatigue_profile": {{
    "systemic_impact": 3.0,
    "local_recovery_hours": 48,
    "weekly_frequency_max": 3,
    "compound_movement": true
  }},
  "recovery_hours": 48,
  "injury_risk_zones": ["épaule"],
  "can_superset_with": []
}}

IMPORTANT: Ajuste les valeurs selon ces règles:
- Squat/Soulevé de terre: complexity=5, impact=5, recovery=72h
- Développé/Rowing: complexity=3, impact=4, recovery=48h
- Curl/Extension: complexity=1, impact=2, recovery=24h
- Barbell: increment=2.5kg, Dumbbell: increment=2.0kg"""

    def query_ollama(self, prompt: str, max_retries: int = 3) -> Dict:
        """Interroge Ollama et parse la réponse"""
        for attempt in range(max_retries):
            try:
                logger.debug(f"Tentative {attempt + 1}/{max_retries}")
                
                response = requests.post(
                    self.api_url,
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "temperature": 0.1,  # Très bas pour cohérence
                        "system": "Tu es un assistant qui répond UNIQUEMENT en JSON valide."
                    },
                    timeout=60  # Plus de temps
                )
                
                if response.status_code == 200:
                    result = response.json()
                    response_text = result.get('response', '')
                    
                    logger.debug(f"Reponse brute: {response_text[:200]}...")
                    
                    # Essayer plusieurs méthodes pour extraire le JSON
                    json_data = None
                    
                    # Méthode 1: Essayer directement
                    try:
                        json_data = json.loads(response_text)
                    except:
                        pass
                    
                    # Méthode 2: Chercher entre accolades
                    if not json_data:
                        start = response_text.find('{')
                        end = response_text.rfind('}') + 1
                        if start >= 0 and end > start:
                            try:
                                json_str = response_text[start:end]
                                json_data = json.loads(json_str)
                            except Exception as e:
                                logger.debug(f"Erreur parsing JSON: {e}")
                    
                    if json_data:
                        logger.debug("JSON parse avec succes")
                        return json_data
                    else:
                        raise ValueError("Impossible d'extraire le JSON")
                else:
                    logger.error(f"Erreur HTTP: {response.status_code}")
                    
            except requests.exceptions.Timeout:
                logger.warning(f"Timeout apres 60s")
            except Exception as e:
                logger.warning(f"Erreur: {type(e).__name__}: {e}")
                
            if attempt < max_retries - 1:
                time.sleep(2)
                    
        return None

    def enrich_exercise(self, exercise: Dict) -> Dict:
        """Enrichit un exercice via Ollama"""
        # Créer le prompt
        prompt = self.create_prompt(exercise)
        
        # Interroger Ollama
        enrichment_data = self.query_ollama(prompt)
        
        if enrichment_data:
            # Fusionner avec l'exercice original
            enriched = exercise.copy()
            
            # Ajouter chaque champ s'il existe dans la réponse
            for key in ['progression_metadata', 'muscle_groups', 'fatigue_profile', 
                        'recovery_hours', 'injury_risk_zones', 'can_superset_with']:
                if key in enrichment_data:
                    enriched[key] = enrichment_data[key]
            
            # Validation et corrections
            enriched = self.validate_and_fix(enriched, exercise)
            
            logger.info(f"Enrichi avec succes")
            return enriched
        else:
            logger.error(f"Echec - utilisation des valeurs par defaut")
            return self.add_smart_defaults(exercise)

    def validate_and_fix(self, enriched: Dict, original: Dict) -> Dict:
        """Valide et ajuste les valeurs selon le type d'exercice"""
        name = original['name_fr'].lower()
        
        # Ajustements spécifiques selon l'exercice
        if any(word in name for word in ['squat', 'soulevé']):
            enriched['progression_metadata']['skill_complexity'] = 5
            enriched['fatigue_profile']['systemic_impact'] = 5
            enriched['recovery_hours'] = 72
        elif any(word in name for word in ['développé', 'presse', 'rowing']):
            enriched['progression_metadata']['skill_complexity'] = 3
            enriched['fatigue_profile']['systemic_impact'] = 4
        elif any(word in name for word in ['curl', 'extension', 'élévation']):
            enriched['progression_metadata']['skill_complexity'] = 1
            enriched['fatigue_profile']['systemic_impact'] = 2
            enriched['recovery_hours'] = 36
        
        return enriched

    def add_smart_defaults(self, exercise: Dict) -> Dict:
        """Ajoute des valeurs par défaut intelligentes selon l'exercice"""
        name = exercise['name_fr'].lower()
        body_part = exercise['body_part']
        
        # Déterminer si c'est composé
        is_compound = any(word in name for word in 
                          ['squat', 'soulevé', 'développé', 'rowing', 'presse', 'tractions'])
        
        # Déterminer la complexité
        if any(word in name for word in ['soulevé de terre', 'squat']):
            complexity = 5
            impact = 5
            recovery = 72
        elif is_compound:
            complexity = 3
            impact = 4
            recovery = 48
        else:
            complexity = 1
            impact = 2
            recovery = 36
        
        # Incrément selon équipement
        increment = 2.5
        if 'halteres' in exercise['equipment']:
            increment = 2.0
        elif 'kettlebell' in exercise['equipment']:
            increment = 4.0
        
        # Muscles secondaires logiques
        secondary = []
        if body_part == "Pectoraux":
            secondary = ["triceps", "deltoïdes"]
        elif body_part == "Dos":
            secondary = ["biceps", "trapèzes"]
        elif body_part == "Quadriceps":
            secondary = ["fessiers", "mollets"]
        
        exercise['progression_metadata'] = {
            "min_weight_increment": increment,
            "typical_increment": increment * 2,
            "plateau_threshold": 3,
            "deload_percentage": 0.85,
            "skill_complexity": complexity
        }
        
        exercise['muscle_groups'] = {
            "primary": [body_part.lower()],
            "secondary": secondary,
            "stabilizers": ["Abdominaux"] if is_compound else []
        }
        
        exercise['fatigue_profile'] = {
            "systemic_impact": float(impact),
            "local_recovery_hours": recovery,
            "weekly_frequency_max": 2 if impact >= 4 else 3,
            "compound_movement": is_compound
        }
        
        exercise['recovery_hours'] = recovery
        exercise['injury_risk_zones'] = ["bas_du_dos"] if is_compound else ["épaule"]
        exercise['can_superset_with'] = []
        
        return exercise

def main():
    """Fonction principale"""
    # Chemins
    input_file = Path("exercises.json")
    output_file = Path("exercises_enriched_ollama.json")
    
    if not input_file.exists():
        logger.error(f"Fichier non trouvé: {input_file}")
        return
    
    try:
        # Chargement
        logger.info("Chargement des exercices...")
        with open(input_file, 'r', encoding='utf-8') as f:
            exercises = json.load(f)
        logger.info(f"{len(exercises)} exercices charges")
        
        # Initialisation Ollama avec le bon modèle
        logger.info("\nInitialisation d'Ollama...")
        enricher = OllamaExerciseEnricher(model="llama3.1:8b")  # Votre modèle
        
        # Enrichissement
        logger.info("\nEnrichissement via Ollama...")
        logger.info("(Cela peut prendre plusieurs minutes...)\n")
        
        enriched_exercises = []
        success_count = 0
        
        for i, exercise in enumerate(exercises):
            logger.info(f"[{i+1}/{len(exercises)}] {exercise['name_fr']}")
            
            try:
                enriched = enricher.enrich_exercise(exercise)
                enriched_exercises.append(enriched)
                
                # Vérifier si vraiment enrichi
                if 'progression_metadata' in enriched:
                    success_count += 1
                
                # Pause pour ne pas surcharger
                if i < len(exercises) - 1:
                    time.sleep(0.5)
                    
            except Exception as e:
                logger.error(f"Erreur inattendue: {e}")
                enriched_exercises.append(enricher.add_smart_defaults(exercise))
        
        # Sauvegarde
        logger.info(f"\nSauvegarde...")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(enriched_exercises, f, indent=2, ensure_ascii=False)
        
        # Rapport
        logger.info(f"\nTermine!")
        logger.info(f"Resultats:")
        logger.info(f"- Exercices traites: {len(enriched_exercises)}")
        logger.info(f"- Enrichis via Ollama: {success_count}")
        logger.info(f"- Valeurs par defaut: {len(exercises) - success_count}")
        logger.info(f"- Fichier: {output_file}")
        
    except Exception as e:
        logger.error(f"Erreur fatale: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("ENRICHISSEMENT D'EXERCICES AVEC OLLAMA")
    print("=" * 50)
    print(f"Modèle: llama3.1:8b")
    print(f"Exercices à traiter: 132")
    print(f"Temps estimé: 5-10 minutes")
    print("=" * 50)
    
    input("\nAppuyez sur Entrée pour commencer...")
    main()