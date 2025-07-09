from typing import List, Dict, Set
import logging
from sqlalchemy.orm import Session
from .models import User, Exercise

logger = logging.getLogger(__name__)

class EquipmentService:
    
    # Mapping unifié des équipements
    EQUIPMENT_MAPPING = {
        'dumbbells': 'dumbbells',
        'barbell_athletic': 'barbell',  # ← CHANGÉ 
        'barbell_ez': 'barbell',       # ← CHANGÉ (était 'ez_curl')
        'barbell_short_pair': 'dumbbells',
        'weight_plates': 'plates',
        'kettlebells': 'kettlebells',
        'resistance_bands': 'resistance_bands',
        'pull_up_bar': 'pull_up_bar',
        'dip_bar': 'dip_bar', 
        'bench': 'bench_flat',         # ← CHANGÉ
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
        #Ajout du mapping barbell générique
        # FORCE barbell si configuré
        if any(config.get(key, {}).get('available', False) for key in ['barbell_athletic', 'barbell_ez']):
            available.add('barbell')
        # FORCE dumbbells si configuré 
        if config.get('dumbbells', {}).get('available', False):
            available.add('dumbbells')
        # Logique d'équivalence : barres courtes + disques = dumbbells
        if (config.get('barbell_short_pair', {}).get('available', False) and 
            config.get('barbell_short_pair', {}).get('count', 0) >= 2 and
            config.get('weight_plates', {}).get('available', False) and
            'dumbbells' not in available):
            available.add('dumbbells')
            logger.info("✅ Équivalence activée: barres courtes + disques = dumbbells")
        
        return available

    @classmethod
    def get_available_weights(cls, db: Session, user_id: int, exercise: 'Exercise' = None) -> List[float]:
        """Version corrigée : SEULS les poids réellement réalisables"""
        from .weight_calculator import WeightCalculator
        
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.equipment_config:
            return [user.weight if user else 0.0]  # Bodyweight seulement
            
        config = user.equipment_config
        all_weights = set([user.weight])  # Poids du corps
        
        # Déterminer les types d'équipement pour cet exercice
        if exercise:
            required_equipment = exercise.equipment_required
        else:
            # Si pas d'exercice spécifique, calculer pour tous les types
            required_equipment = ['barbell', 'dumbbells', 'kettlebells']
        
        # 1. Poids barbell (si requis)
        if any(eq in ['barbell', 'barbell_athletic', 'barbell_ez'] for eq in required_equipment):
            barbell_weights = WeightCalculator.get_barbell_weights(config)
            all_weights.update(barbell_weights)
        
        # 2. Poids dumbbells (si requis)  
        if 'dumbbells' in required_equipment:
            dumbbell_weights = WeightCalculator.get_dumbbell_weights(config)
            # Forcer uniquement des poids pairs pour les dumbbells
            dumbbell_weights = [w for w in dumbbell_weights if w % 2 == 0]
            all_weights.update(dumbbell_weights)
        
        # 3. Kettlebells (si requis)
        if 'kettlebells' in required_equipment:
            kettlebell_weights = WeightCalculator.get_kettlebell_weights(config)
            all_weights.update(kettlebell_weights)
        
        # 4. Machines (pas de problème de symétrie)
        machine_weights = WeightCalculator.get_machine_weights(config, required_equipment)
        all_weights.update(machine_weights)
        
        # 5. Élastiques (tensions équivalentes)
        if 'resistance_bands' in required_equipment and config.get('resistance_bands', {}).get('available', False):
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
        valid_weights = sorted([w for w in all_weights if 0 <= w <= 500])  # Limite raisonnable
        
        logger.info(f"Poids calculés pour user {user_id}: {len(valid_weights)} options")
        return valid_weights
        
    @classmethod
    def _calculate_plate_combinations(cls, plates_dict: dict, max_per_side: float = 50) -> List[float]:
        """
        Calcule UNIQUEMENT les combinaisons symétriques réalisables
        Pour dumbbells : doit pouvoir équiper 2 barres identiquement
        Pour barbell : doit pouvoir équiper les 2 côtés identiquement
        """
        if not plates_dict:
            return [0]
        
        # Pour dumbbells, on a besoin de 4 disques identiques (2 par barre)
        # Pour barbell, on a besoin de 2 disques identiques (1 par côté)
        # Cette fonction est utilisée pour les deux, donc on prend le cas le plus restrictif
        
        combinations = set([0])  # Toujours possible sans disques
        
        # Convertir et trier les disques
        sorted_plates = sorted(
            [(float(w), count) for w, count in plates_dict.items()],
            key=lambda x: x[0]
        )
        
        # Générer toutes les combinaisons possibles
        def generate_combinations(plates, current_weight, current_index, used_plates):
            if current_index >= len(plates):
                return
            
            plate_weight, available_count = plates[current_index]
            
            # Pour chaque nombre de paires possibles avec ce poids
            for pairs in range(0, available_count // 2 + 1):
                if pairs > 0:
                    # Poids ajouté (2 disques par paire)
                    added_weight = pairs * plate_weight * 2
                    new_weight = current_weight + added_weight
                    
                    if new_weight <= max_per_side * 2:
                        combinations.add(new_weight)
                        
                        # Continuer avec les disques suivants
                        new_used = used_plates.copy()
                        new_used[plate_weight] = pairs * 2
                        generate_combinations(plates, new_weight, current_index + 1, new_used)
                else:
                    # Cas où on n'utilise pas ce disque
                    generate_combinations(plates, current_weight, current_index + 1, used_plates)
        
        generate_combinations(sorted_plates, 0, 0, {})
        
        return sorted(list(combinations))
        
    @classmethod
    def can_perform_exercise(cls, exercise: Exercise, available_equipment: List[str]) -> bool:
        """Vérifier si un exercice peut être effectué avec l'équipement disponible"""
        if not exercise.equipment_required:
            return True  # Pas d'équipement requis = toujours possible
        
        # Convertir la liste en set pour performance
        available_set = set(available_equipment)
        
        # Vérifier qu'au moins un équipement requis est disponible
        for eq in exercise.equipment_required:
            if eq in available_set:
                return True
                
            # Mapping spécial banc
            if eq.startswith('bench_') and 'bench_flat' in available_set:
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
    def get_plate_layout(cls, user_id: int, target_weight: float, exercise_equipment: List[str], config: dict) -> dict:
        """Version optimisée : réutilise la logique existante"""
        equipment_type = 'barbell'
        if 'dumbbells' in exercise_equipment:
            equipment_type = 'dumbbells'
        
        # Réutiliser les méthodes existantes au lieu de recoder
        if equipment_type == 'barbell':
            return cls._barbell_layout(target_weight, config)
        else:
            return cls._dumbbell_layout(target_weight, config)
    
    @classmethod
    def _barbell_layout(cls, target_weight: float, config: dict) -> dict:
        """Optimisé : réutilise get_equipment_setup"""
        setup = cls.get_equipment_setup(config, target_weight, 'barbell')
        
        if setup['type'] == 'barbell_only':
            return {
                'feasible': True,
                'type': 'barbell',
                'weight': setup['total_weight'],
                'layout': [f"Barre {setup['bar_weight']}kg seule"]
            }
        elif setup['type'] == 'barbell_loaded':
            # Simplifier : juste les poids sans SVG complexe
            plates = []
            for plate in setup['plates_per_side']:
                plates.extend([f"{plate['weight']}kg"] * plate['count'])
            
            return {
                'feasible': True,
                'type': 'barbell',
                'weight': setup['total_weight'],
                'layout': plates
            }
        
        return {'feasible': False, 'reason': 'Poids non réalisable'}
    
    @classmethod  
    def _dumbbell_layout(cls, target_weight: float, config: dict) -> dict:
        """Version améliorée avec structure claire"""
        setup = cls.get_equipment_setup(config, target_weight, 'dumbbells')
        
        if setup['type'] == 'fixed_dumbbells':
            return {
                'feasible': True,
                'type': 'dumbbells_fixed',
                'weight': setup['total_weight'],
                'weight_per_dumbbell': setup['weight_each'],
                'layout': [f"{setup['weight_each']}kg × 2"]
            }
        elif setup['type'] == 'adjustable_dumbbells':
            plates = []
            for plate in setup['plates_per_bar']:
                plates.extend([f"{plate['weight']}kg"] * plate['count'])
            
            return {
                'feasible': True,
                'type': 'dumbbells_adjustable',
                'weight': setup['total_weight'],
                'weight_per_dumbbell': setup['weight_each'],
                'bar_weight': setup['bar_weight'],
                'layout': [f"Barre {setup['bar_weight']}kg"] + plates
            }
        
        return {
            'feasible': False, 
            'reason': f'Impossible de réaliser {target_weight}kg avec votre équipement'
        }
        
    @classmethod
    def _optimize_plate_distribution(cls, available_plates: dict, target_weight: float) -> List[dict]:
        """Optimise la distribution de disques pour UN CÔTÉ de la barre"""
        result = []
        remaining = target_weight
        
        # Trier par poids décroissant pour mettre les gros disques à l'intérieur
        sorted_plates = sorted(
            [(float(w), count) for w, count in available_plates.items()],
            key=lambda x: x[0],
            reverse=True
        )
        
        for weight, available_count in sorted_plates:
            while remaining >= weight and available_count >= 2:  # PAIRES uniquement
                result.append({'weight': weight, 'count': 1})  # 1 disque par côté
                remaining -= weight
                available_count -= 2  # On utilise une paire
                
            if remaining < 0.1:  # Tolérance floating point
                break
        
        return result  # Ordre : gros disques d'abord