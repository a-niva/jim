from functools import lru_cache
from typing import List, Dict, Tuple
import json
from sqlalchemy.orm import Session
from .models import User
from .database import get_db

class EquipmentService:
    
    @staticmethod
    def get_available_weights(db: Session, user_id: int, exercise_type: str) -> List[float]:
        """Calculer tous les poids réalisables pour un type d'exercice"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.equipment_config:
            return []
            
        config = user.equipment_config
        
        if exercise_type == 'dumbbells':
            return EquipmentService._calculate_dumbbell_weights(config)
        elif exercise_type == 'barbell':
            return EquipmentService._calculate_barbell_weights(config, 20)  # Olympique
        elif exercise_type == 'ez_curl':
            return EquipmentService._calculate_barbell_weights(config, 10)  # EZ
        
        return []
    
    @staticmethod
    def _calculate_dumbbell_weights(config: dict) -> List[float]:
        weights = set()
        
        # Option 1: Dumbbells fixes
        if config.get('dumbbells', {}).get('weights'):
            for weight in config['dumbbells']['weights']:
                weights.add(weight * 2)  # Paire
        
        # Option 2: Barres courtes + disques
        if (config.get('barres', {}).get('courte', {}).get('available') and
            config.get('barres', {}).get('courte', {}).get('count', 0) >= 2):
            
            base_weight = 2.5 * 2  # Paire de barres courtes
            plate_combinations = EquipmentService._get_plate_combinations(
                config.get('disques', {}).get('weights', {}), 
                max_per_side=50  # Limite raisonnable
            )
            
            for plate_weight in plate_combinations:
                weights.add(base_weight + plate_weight)
        
        return sorted(list(weights))
    
    @staticmethod
    def _calculate_barbell_weights(config: dict, bar_weight: float) -> List[float]:
        weights = set()
        weights.add(bar_weight)  # Barre seule
        
        if config.get('disques', {}).get('weights'):
            plate_combinations = EquipmentService._get_plate_combinations(
                config['disques']['weights'], 
                max_per_side=200  # Limite raisonnable
            )
            
            for plate_weight in plate_combinations:
                weights.add(bar_weight + plate_weight)
        
        return sorted(list(weights))
    
    @staticmethod
    def _get_plate_combinations(available_plates: dict, max_per_side: float) -> List[float]:
        """Générer toutes les combinaisons possibles de disques"""
        combinations = set([0])  # Commencer avec 0 (barre seule)
        
        for weight_str, count in available_plates.items():
            weight = float(weight_str)
            if count < 2:  # Il faut au moins 2 disques (un par côté)
                continue
                
            max_pairs = count // 2
            new_combinations = set()
            
            for existing_weight in combinations:
                for pairs in range(1, max_pairs + 1):
                    total_plate_weight = existing_weight + (weight * pairs * 2)
                    if total_plate_weight <= max_per_side * 2:
                        new_combinations.add(total_plate_weight)
            
            combinations.update(new_combinations)
        
        return sorted(list(combinations))
    
    @staticmethod
    def get_equipment_visualization(db: Session, user_id: int, exercise_type: str, target_weight: float) -> dict:
        """Retourner la visualisation exacte pour un poids donné"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.equipment_config:
            return {}
            
        config = user.equipment_config
        
        if exercise_type == 'dumbbells':
            return EquipmentService._get_dumbbell_setup(config, target_weight)
        elif exercise_type in ['barbell', 'ez_curl']:
            bar_weight = 20 if exercise_type == 'barbell' else 10
            return EquipmentService._get_barbell_setup(config, target_weight, bar_weight)
        
        return {}
    
    @staticmethod
    def _get_dumbbell_setup(config: dict, target_weight: float) -> dict:
        # Vérifier d'abord les dumbbells fixes
        if config.get('dumbbells', {}).get('weights'):
            for weight in config['dumbbells']['weights']:
                if abs(weight * 2 - target_weight) < 0.1:
                    return {
                        'type': 'fixed_dumbbells',
                        'weight_each': weight,
                        'total_weight': target_weight
                    }
        
        # Sinon, barres courtes + disques
        base_weight = 2.5 * 2
        plate_weight_needed = target_weight - base_weight
        
        if plate_weight_needed >= 0:
            plate_distribution = EquipmentService._calculate_optimal_plates(
                config.get('disques', {}).get('weights', {}), 
                plate_weight_needed / 2  # Par haltère
            )
            
            return {
                'type': 'short_barbells',
                'bar_weight_each': 2.5,
                'plates_per_dumbbell': plate_distribution,
                'total_weight': target_weight
            }
        
        return {}
    
    @staticmethod
    def _get_barbell_setup(config: dict, target_weight: float, bar_weight: float) -> dict:
        plate_weight_needed = target_weight - bar_weight
        
        if plate_weight_needed >= 0:
            plate_distribution = EquipmentService._calculate_optimal_plates(
                config.get('disques', {}).get('weights', {}), 
                plate_weight_needed / 2  # Par côté
            )
            
            return {
                'type': 'barbell',
                'bar_weight': bar_weight,
                'plates_per_side': plate_distribution,
                'total_weight': target_weight
            }
        
        return {}
    
    @staticmethod
    def _calculate_optimal_plates(available_plates: dict, target_per_side: float) -> List[dict]:
        """Algorithme glouton pour distribuer les disques de façon optimale"""
        result = []
        remaining = target_per_side
        
        # Trier par poids décroissant
        sorted_plates = sorted(
            [(float(w), count) for w, count in available_plates.items()],
            key=lambda x: x[0],
            reverse=True
        )
        
        for weight, available_count in sorted_plates:
            max_usable = available_count // 2  # Paires seulement
            while remaining >= weight and max_usable > 0:
                existing = next((p for p in result if p['weight'] == weight), None)
                if existing:
                    existing['count'] += 1
                else:
                    result.append({'weight': weight, 'count': 1})
                
                remaining -= weight
                max_usable -= 1
        
        return result