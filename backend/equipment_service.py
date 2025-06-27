from typing import List, Dict, Set
import logging
from sqlalchemy.orm import Session
from .models import User

logger = logging.getLogger(__name__)

class EquipmentService:
    
    # Mapping unifié des équipements
    EQUIPMENT_MAPPING = {
        'dumbbells': 'dumbbells',
        'barbell_athletic': 'barbell',
        'barbell_ez': 'ez_curl', 
        'barbell_short_pair': 'dumbbells',  # Équivalence clé
        'weight_plates': 'plates',
        'kettlebells': 'kettlebells',
        'resistance_bands': 'resistance_bands',
        'pull_up_bar': 'pull_up_bar',
        'dip_bar': 'dip_bar',
        'bench': 'bench',  # Unifié
        'cable_machine': 'cable_machine',
        'leg_press': 'leg_press',
        'lat_pulldown': 'lat_pulldown',
        'chest_press': 'chest_press'
    }
        
    @classmethod
    def _calculate_resistance_combinations(cls, tensions_dict: dict, max_combined: int = 3) -> List[float]:
        """Calcule les combinaisons possibles d'élastiques"""
        if not tensions_dict:
            return []
        
        combinations = set()
        available_tensions = []
        
        # Créer une liste avec les quantités disponibles
        for tension_str, count in tensions_dict.items():
            tension = float(tension_str)
            available_tensions.extend([tension] * count)
        
        # Générer les combinaisons (jusqu'à max_combined élastiques ensemble)
        from itertools import combinations as iter_combinations
        
        for combo_size in range(2, min(len(available_tensions) + 1, max_combined + 1)):
            for combo in iter_combinations(available_tensions, combo_size):
                # Vérifier qu'on ne dépasse pas les quantités disponibles
                tension_counts = {}
                for t in combo:
                    tension_counts[t] = tension_counts.get(t, 0) + 1
                
                # Valider que chaque tension n'est pas utilisée plus que disponible
                valid = True
                for tension, used_count in tension_counts.items():
                    if used_count > tensions_dict.get(str(int(tension)), 0):
                        valid = False
                        break
                
                if valid:
                    combinations.add(sum(combo))
        
        return sorted(list(combinations))

    @classmethod
    def get_available_equipment_types(cls, config: dict) -> Set[str]:
        """Retourne les types d'équipement disponibles selon la config"""
        available = set(['bodyweight'])  # Toujours disponible
        
        if not config:
            return available
            
        for equipment_key, equipment_data in config.items():
            if equipment_data.get('available', False):
                mapped_type = cls.EQUIPMENT_MAPPING.get(equipment_key)
                if mapped_type:
                    available.add(mapped_type)
        
        # Logique d'équivalence : barres courtes + disques = dumbbells
        if (config.get('barbell_short_pair', {}).get('available', False) and 
            config.get('barbell_short_pair', {}).get('count', 0) >= 2 and
            config.get('weight_plates', {}).get('available', False) and
            'dumbbells' not in available):
            available.add('dumbbells')
            logger.info("✅ Équivalence activée: barres courtes + disques = dumbbells")
        
        return available

    @classmethod
    def get_available_bench_types(cls, config: dict) -> List[str]:
        """Retourne les types de banc disponibles selon la configuration"""
        bench_types = []
        
        bench_config = config.get('bench', {})
        if not bench_config.get('available', False):
            return bench_types
        
        positions = bench_config.get('positions', {})
        
        if positions.get('flat', False):
            bench_types.append('bench_flat')
        if positions.get('incline_up', False):
            bench_types.append('bench_incline')
        if positions.get('decline', False):
            bench_types.append('bench_decline')
        
        return bench_types

    @classmethod
    def get_available_equipment_types(cls, config: dict) -> Set[str]:
        """Version mise à jour avec gestion du banc unifié"""
        available = set(['bodyweight'])
        
        if not config:
            return available
            
        for equipment_key, equipment_data in config.items():
            if equipment_data.get('available', False):
                if equipment_key == 'bench':
                    # Gestion spéciale pour le banc
                    bench_types = cls.get_available_bench_types(config)
                    available.update(bench_types)
                else:
                    mapped_type = cls.EQUIPMENT_MAPPING.get(equipment_key)
                    if mapped_type:
                        available.add(mapped_type)
        
        # Logique d'équivalence : barres courtes + disques = dumbbells
        if (config.get('barbell_short_pair', {}).get('available', False) and 
            config.get('barbell_short_pair', {}).get('count', 0) >= 2 and
            config.get('weight_plates', {}).get('available', False) and
            'dumbbells' not in available):
            available.add('dumbbells')
            logger.info("✅ Équivalence activée: barres courtes + disques = dumbbells")
        
        return available

    @classmethod
    def get_available_weights(cls, db: Session, user_id: int, exercise_type: str = None) -> List[float]:
        """Calcule tous les poids disponibles selon la configuration"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.equipment_config:
            return [0.0]  # Poids du corps minimum
            
        config = user.equipment_config
        all_weights = set([user.weight])  # Poids du corps
        
        # 1. Dumbbells fixes
        if config.get('dumbbells', {}).get('available', False):
            weights = config['dumbbells'].get('weights', [])
            for weight in weights:
                all_weights.add(weight)      # Poids unitaire
                all_weights.add(weight * 2)  # Paire
        
        # 2. Barres + disques
        plates = config.get('weight_plates', {}).get('weights', {})
        
        # Barre athlétique
        if config.get('barbell_athletic', {}).get('available', False):
            bar_weight = config['barbell_athletic'].get('weight', 20)
            combinations = cls._calculate_plate_combinations(plates)
            for combo in combinations:
                all_weights.add(bar_weight + combo)
        
        # Barre EZ
        if config.get('barbell_ez', {}).get('available', False):
            bar_weight = config['barbell_ez'].get('weight', 10)
            combinations = cls._calculate_plate_combinations(plates)
            for combo in combinations:
                all_weights.add(bar_weight + combo)
        
        # 3. ÉQUIVALENCE : Barres courtes + disques = dumbbells
        barres_courtes = config.get('barbell_short_pair', {})
        if (barres_courtes.get('available', False) and 
            barres_courtes.get('count', 0) >= 2 and 
            plates):
            
            bar_weight = barres_courtes.get('weight', 2.5)
            combinations = cls._calculate_plate_combinations(plates, max_per_side=25)
            
            for combo in combinations:
                # Poids par barre courte
                single_weight = bar_weight + combo
                all_weights.add(single_weight)      # Unitaire
                all_weights.add(single_weight * 2)  # Paire (équivalent dumbbells)
        
        # 4. Kettlebells
        if config.get('kettlebells', {}).get('available', False):
            weights = config['kettlebells'].get('weights', [])
            for weight in weights:
                all_weights.add(weight)
                all_weights.add(weight * 2)  # Paire si disponible
        
        # 5. Machines
        for machine in ['cable_machine', 'leg_press', 'lat_pulldown', 'chest_press']:
            if config.get(machine, {}).get('available', False):
                max_weight = config[machine].get('max_weight', 100)
                increment = config[machine].get('increment', 5)
                machine_weights = [i * increment for i in range(0, int(max_weight / increment) + 1)]
                all_weights.update(machine_weights)

        # 6. Élastiques (tensions équivalentes)
        if config.get('resistance_bands', {}).get('available', False):
            tensions = config['resistance_bands'].get('tensions', {})
            
            # Ajouter les tensions individuelles
            for tension_str, count in tensions.items():
                tension = float(tension_str)
                if count > 0:
                    all_weights.add(tension)
            
            # Si combinables, ajouter les combinaisons
            if config['resistance_bands'].get('combinable', False):
                combinations = cls._calculate_resistance_combinations(tensions)
                all_weights.update(combinations)

        # Filtrer et trier
        valid_weights = sorted([w for w in all_weights if 0 <= w <= 1000])
        
        logger.info(f"Poids calculés pour user {user_id}: {len(valid_weights)} options")
        return valid_weights
    
    @classmethod
    def _calculate_plate_combinations(cls, plates_dict: dict, max_per_side: float = 50) -> List[float]:
        """Calcule toutes les combinaisons de disques possibles"""
        if not plates_dict:
            return [0]
        
        combinations = set([0])
        
        for weight_str, count in plates_dict.items():
            weight = float(weight_str)
            max_pairs = count // 2  # Paires seulement
            
            if max_pairs == 0:
                continue
                
            new_combinations = set()
            for existing in combinations:
                for pairs in range(1, max_pairs + 1):
                    total = existing + (weight * pairs * 2)  # Des deux côtés
                    if total <= max_per_side * 2:
                        new_combinations.add(total)
            
            combinations.update(new_combinations)
        
        return sorted(list(combinations))
        
    @classmethod
    def can_perform_exercise(cls, exercise_equipment: List[str], user_config: dict) -> bool:
        """Version améliorée avec gestion fine des bancs"""
        if not exercise_equipment:
            return True  # Poids du corps
            
        available_types = cls.get_available_equipment_types(user_config)
        
        # Gestion spéciale pour les exercices nécessitant un type de banc spécifique
        bench_mapping = {
            'bench_flat': 'bench_flat',
            'bench_incline': 'bench_incline', 
            'bench_decline': 'bench_decline',
            'bench': 'bench_flat'  # Mapping par défaut vers plat
        }
        
        for required_equipment in exercise_equipment:
            # Si c'est un type de banc spécifique, vérifier la position
            if required_equipment in bench_mapping:
                bench_type_needed = bench_mapping[required_equipment]
                if bench_type_needed in available_types:
                    return True
            # Sinon, vérification standard
            elif required_equipment in available_types:
                return True
        
        return False
    
    @classmethod
    def get_equipment_setup(cls, config: dict, target_weight: float, exercise_type: str) -> dict:
        """Retourne la configuration optimale pour atteindre un poids cible"""
        if exercise_type == 'dumbbells':
            return cls._get_dumbbell_setup(config, target_weight)
        elif exercise_type in ['barbell', 'ez_curl']:
            bar_weight = 20 if exercise_type == 'barbell' else 10
            return cls._get_barbell_setup(config, target_weight, bar_weight)
        elif exercise_type == 'resistance_bands':
            return cls._get_resistance_setup(config, target_weight)
                
        return {'type': 'unknown', 'target_weight': target_weight}
        
    @classmethod
    def _get_resistance_setup(cls, config: dict, target_weight: float) -> dict:
        """Optimise la configuration pour élastiques"""
        tensions = config.get('resistance_bands', {}).get('tensions', {})
        combinable = config.get('resistance_bands', {}).get('combinable', False)
        
        if not tensions:
            return {'type': 'unavailable', 'target_weight': target_weight}
        
        # 1. Essayer avec un seul élastique
        available_singles = [float(t) for t, count in tensions.items() if count > 0]
        if available_singles:
            closest_single = min(available_singles, key=lambda x: abs(x - target_weight))
            
            if abs(closest_single - target_weight) < 2.5:  # Tolérance 2.5kg
                return {
                    'type': 'single_resistance',
                    'tension': closest_single,
                    'total_weight': closest_single,
                    'setup': f"Élastique {closest_single}kg"
                }
        
        # 2. Si combinables, essayer les combinaisons
        if combinable:
            combinations = cls._calculate_resistance_combinations(tensions)
            if combinations:
                closest_combo = min(combinations, key=lambda x: abs(x - target_weight))
                
                if abs(closest_combo - target_weight) < 5:  # Tolérance plus large pour combos
                    # Trouver quelle combinaison donne ce résultat
                    combo_details = cls._find_resistance_combination(tensions, closest_combo)
                    
                    return {
                        'type': 'combined_resistance',
                        'tensions': combo_details,
                        'total_weight': closest_combo,
                        'setup': f"Combinaison: {' + '.join(f'{t}kg' for t in combo_details)}"
                    }
        
        # 3. Fallback sur la tension la plus proche
        if available_singles:
            fallback = min(available_singles, key=lambda x: abs(x - target_weight))
            return {
                'type': 'approximate_resistance',
                'tension': fallback,
                'total_weight': fallback,
                'setup': f"Élastique {fallback}kg (approximation)"
            }
        
        return {'type': 'unavailable', 'target_weight': target_weight}

    @classmethod
    def _find_resistance_combination(cls, tensions_dict: dict, target_sum: float) -> List[float]:
        """Trouve une combinaison d'élastiques qui donne la somme cible"""
        from itertools import combinations as iter_combinations
        
        available_tensions = []
        for tension_str, count in tensions_dict.items():
            tension = float(tension_str)
            available_tensions.extend([tension] * count)
        
        # Chercher la combinaison exacte ou la plus proche
        for combo_size in range(2, min(len(available_tensions) + 1, 4)):
            for combo in iter_combinations(available_tensions, combo_size):
                if abs(sum(combo) - target_sum) < 0.1:  # Tolérance très fine
                    return list(combo)
        
        return []

    @classmethod
    def _get_dumbbell_setup(cls, config: dict, target_weight: float) -> dict:
        """Optimise la configuration pour dumbbells"""
        # 1. Essayer les dumbbells fixes d'abord
        if config.get('dumbbells', {}).get('available', False):
            weights = config['dumbbells'].get('weights', [])
            target_per_dumbbell = target_weight / 2
            
            closest = min(weights, key=lambda x: abs(x - target_per_dumbbell), default=None)
            if closest and abs(closest - target_per_dumbbell) < 2.5:
                return {
                    'type': 'fixed_dumbbells',
                    'weight_each': closest,
                    'total_weight': closest * 2,
                    'setup': f"Dumbbells fixes: {closest}kg × 2"
                }
        
        # 2. Utiliser barres courtes + disques
        barres_courtes = config.get('barbell_short_pair', {})
        plates = config.get('weight_plates', {}).get('weights', {})
        
        if (barres_courtes.get('available', False) and 
            barres_courtes.get('count', 0) >= 2 and plates):
            
            bar_weight = barres_courtes.get('weight', 2.5)
            target_per_bar = target_weight / 2
            plate_weight_needed = max(0, target_per_bar - bar_weight)
            
            plate_setup = cls._optimize_plate_distribution(plates, plate_weight_needed)
            
            if plate_setup:
                actual_weight = bar_weight + sum(p['weight'] * p['count'] for p in plate_setup)
                return {
                    'type': 'adjustable_dumbbells',
                    'bar_weight': bar_weight,
                    'plates_per_bar': plate_setup,
                    'weight_each': actual_weight,
                    'total_weight': actual_weight * 2,
                    'setup': f"Barres courtes: {bar_weight}kg + disques"
                }
        
        return {'type': 'unavailable', 'target_weight': target_weight}
    
    @classmethod
    def _get_barbell_setup(cls, config: dict, target_weight: float, bar_weight: float) -> dict:
        """Optimise la configuration pour barbell"""
        plates = config.get('weight_plates', {}).get('weights', {})
        
        if not plates:
            return {
                'type': 'barbell_only',
                'bar_weight': bar_weight,
                'total_weight': bar_weight,
                'setup': f"Barre seule: {bar_weight}kg"
            }
        
        plate_weight_needed = max(0, target_weight - bar_weight)
        plate_weight_per_side = plate_weight_needed / 2
        
        plate_setup = cls._optimize_plate_distribution(plates, plate_weight_per_side)
        
        if plate_setup:
            actual_plate_weight = sum(p['weight'] * p['count'] for p in plate_setup) * 2
            return {
                'type': 'barbell_loaded',
                'bar_weight': bar_weight,
                'plates_per_side': plate_setup,
                'total_weight': bar_weight + actual_plate_weight,
                'setup': f"Barre {bar_weight}kg + {actual_plate_weight}kg disques"
            }
        
        return {
            'type': 'barbell_only',
            'bar_weight': bar_weight,
            'total_weight': bar_weight,
            'setup': f"Barre seule: {bar_weight}kg"
        }
    
    @classmethod
    def _optimize_plate_distribution(cls, available_plates: dict, target_weight: float) -> List[dict]:
        """Algorithme glouton pour optimiser la distribution de disques"""
        result = []
        remaining = target_weight
        
        # Trier par poids décroissant
        sorted_plates = sorted(
            [(float(w), count) for w, count in available_plates.items()],
            key=lambda x: x[0],
            reverse=True
        )
        
        for weight, available_count in sorted_plates:
            while remaining >= weight and available_count > 0:
                existing = next((p for p in result if p['weight'] == weight), None)
                if existing:
                    existing['count'] += 1
                else:
                    result.append({'weight': weight, 'count': 1})
                
                remaining -= weight
                available_count -= 1
                
                if remaining <= 0.1:  # Tolérance
                    break
            
            if remaining <= 0.1:
                break
        
        return result