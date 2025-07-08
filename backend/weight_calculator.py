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
                # SEUL le poids total (2×dumbbell) est ajouté
                weights.add(weight * 2)
        
        # Barres courtes + disques (équivalence dumbbells)
        barres_courtes = config.get('barbell_short_pair', {})
        if (barres_courtes.get('available', False) and 
            barres_courtes.get('count', 0) >= 2):
            
            bar_weight = barres_courtes.get('weight', 2.5)
            plates = config.get('weight_plates', {}).get('weights', {})
            symmetric_combinations = EquipmentService._calculate_plate_combinations(plates)
            
            for combo in symmetric_combinations:
                # Poids total : 2 barres + disques sur chaque barre
                total_weight = (bar_weight + combo) * 2
                weights.add(total_weight)
        
        return sorted(list(weights))
    
    @staticmethod
    def get_kettlebell_weights(config: dict) -> List[float]:
        """Retourne les poids kettlebells (unitaire + paire)"""
        weights = set()
        
        if config.get('kettlebells', {}).get('available', False):
            kb_weights = config['kettlebells'].get('weights', [])
            for weight in kb_weights:
                weights.add(weight)      # Unitaire (exercices à une main)
                weights.add(weight * 2)  # Paire (exercices à deux mains)
        
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