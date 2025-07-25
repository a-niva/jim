from typing import List, Set
import logging

logger = logging.getLogger(__name__)

class WeightCalculator:
    """Calculateur de poids spécialisé par type d'équipement"""
    
    @staticmethod
    def get_barbell_weights(config: dict) -> List[float]:
        """Retourne UNIQUEMENT les poids barbell réalisables symétriquement"""
        from .equipment_service import EquipmentService
        
        weights = set()
        
        # Barre athlétique
        if config.get('barbell_athletic', {}).get('available', False):
            bar_weight = config['barbell_athletic'].get('weight', 20)
            plates = config.get('weight_plates', {}).get('weights', {})
            symmetric_combinations = EquipmentService._calculate_plate_combinations(plates)
            
            for combo in symmetric_combinations:
                weights.add(bar_weight + combo)
        
        # Barre EZ
        if config.get('barbell_ez', {}).get('available', False):
            bar_weight = config['barbell_ez'].get('weight', 10)
            plates = config.get('weight_plates', {}).get('weights', {})
            symmetric_combinations = EquipmentService._calculate_plate_combinations(plates)
            
            for combo in symmetric_combinations:
                weights.add(bar_weight + combo)
        
        return sorted(list(weights))
        
    @staticmethod
    def get_dumbbell_weights(config: dict) -> List[float]:
        """Retourne UNIQUEMENT les poids dumbbells en PAIRES réalisables"""
        from .equipment_service import EquipmentService
        
        weights = set()
        
        # Dumbbells fixes
        if config.get('dumbbells', {}).get('available', False):
            fixed_weights = config['dumbbells'].get('weights', [])
            for weight in fixed_weights:
                # Poids total des 2 dumbbells
                weights.add(weight * 2)
        
        # Barres courtes + disques
        barres_courtes = config.get('barbell_short_pair', {})
        if (barres_courtes.get('available', False) and 
            barres_courtes.get('count', 0) >= 2):
            
            bar_weight = barres_courtes.get('weight', 2.5)
            plates = config.get('weight_plates', {}).get('weights', {})
            
            if plates:
                # Pour les dumbbells, on doit pouvoir équiper 2 barres identiquement
                # Donc on a besoin de 4 disques du même poids (2 par barre)
                dumbbell_combinations = set([0])  # Barres seules
                
                for weight_str, total_count in plates.items():
                    weight = float(weight_str)
                    # Nombre de QUADRUPLETS disponibles (4 disques identiques)
                    quads_available = total_count // 4
                    
                    if quads_available > 0:
                        # Ajouter toutes les combinaisons possibles
                        new_combinations = set()
                        for existing in dumbbell_combinations:
                            for quads in range(1, quads_available + 1):
                                # Poids total : 2 barres + 4 disques par quad
                                total_weight = (bar_weight * 2) + existing + (weight * 4 * quads)
                                new_combinations.add(total_weight)
                        
                        dumbbell_combinations.update(new_combinations)
                
                # Cas spécial : on peut aussi utiliser des PAIRES différentes sur chaque barre
                # si on a au moins 2 disques de chaque poids
                for combo in WeightCalculator._calculate_mixed_dumbbell_combinations(plates):
                    total_weight = (bar_weight * 2) + combo
                    weights.add(total_weight)
                
                # Ajouter toutes les combinaisons valides
                for combo_weight in dumbbell_combinations:
                    total = (bar_weight * 2) + combo_weight
                    weights.add(total)
        
        return sorted(list(weights))

    @staticmethod
    def _calculate_mixed_dumbbell_combinations(plates: dict) -> List[float]:
        """Calcule les combinaisons mixtes pour dumbbells (paires différentes)"""
        combinations = set()
        
        # Pour chaque poids où on a au moins 2 disques
        valid_weights = [(float(w), count) for w, count in plates.items() if count >= 2]
        
        # Générer les combinaisons en utilisant des paires
        for i, (weight1, count1) in enumerate(valid_weights):
            # Utiliser une paire de ce poids (2 disques sur les 2 barres)
            combinations.add(weight1 * 2)
            
            # Combiner avec d'autres poids
            for j, (weight2, count2) in enumerate(valid_weights[i+1:], i+1):
                # On peut utiliser 1 paire de chaque
                combinations.add((weight1 + weight2) * 2)
                
                # Si on a 4+ disques d'un poids, on peut en mettre 2 par barre
                if count1 >= 4:
                    combinations.add((weight1 * 2 + weight2) * 2)
                if count2 >= 4:
                    combinations.add((weight1 + weight2 * 2) * 2)
        
        return list(combinations)
        
    @staticmethod
    def get_kettlebell_weights(config: dict) -> List[float]:
        """Retourne les poids kettlebells (unitaire + paire)"""
        weights = set()
        
        if config.get('kettlebells', {}).get('available', False):
            kb_weights = config['kettlebells'].get('weights', [])
            for weight in kb_weights:
                weights.add(weight)      # Unitaire (exercices à une main)
        
        return sorted(list(weights))
        
    @staticmethod
    def get_machine_weights(config: dict, required_equipment: List[str]) -> List[float]:
        """Retourne les poids machines"""
        weights = set()
        
        machine_types = ['cable_machine', 'leg_press', 'lat_pulldown', 'chest_press']
        
        for machine in machine_types:
            if (machine in required_equipment and 
                config.get(machine, {}).get('available', False)):
                
                max_weight = config[machine].get('max_weight', 100)
                increment = config[machine].get('increment', 5)
                machine_weights = [i * increment for i in range(0, int(max_weight / increment) + 1)]
                weights.update(machine_weights)
        
        return sorted(list(weights))
    
    @staticmethod
    def get_resistance_bands_weights(config: dict) -> List[float]:
        """Retourne les tensions élastiques disponibles"""
        weights = set()
        
        if config.get('resistance_bands', {}).get('available', False):
            tensions = config['resistance_bands'].get('tensions', {})
            for tension_str, count in tensions.items():
                if count > 0:
                    weights.add(float(tension_str))
            
            # Combinaisons si autorisées
            if config['resistance_bands'].get('combinable', False):
                # Ajouter quelques combinaisons simples
                tension_values = [float(t) for t, c in tensions.items() if c > 0]
                for t1 in tension_values:
                    for t2 in tension_values:
                        if t1 <= t2:  # Éviter doublons
                            weights.add(t1 + t2)
        
        return sorted(list(weights))

    @staticmethod  
    def get_bodyweight_weights(config: dict, user_weight: float) -> List[float]:
        """Retourne variations du poids de corps (avec assistance/lest)"""
        weights = [user_weight]
        
        # Si pull_up_bar disponible, proposer assistances
        if config.get('pull_up_bar', {}).get('available', False):
            assistance_bands = [5, 10, 15, 20, 25]  # Assistance elastiques courantes
            for assist in assistance_bands:
                if user_weight - assist > 20:  # Garde un minimum logique
                    weights.append(user_weight - assist)
        
        return sorted(weights)