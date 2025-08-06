#!/usr/bin/env python3
"""
Script unifié pour optimisation CSS complète en 4 étapes:
1. Détection des classes inutilisées
2. Vérification parallélisée 
3. Suppression des classes confirmées inutilisées
4. Consolidation des règles CSS dupliquées

Usage: python css_optimizer.py [--step STEP] [--threads N] [--dry-run] [--skip-step STEP]
"""

import re
import os
import shutil
from pathlib import Path
from typing import Set, List, Dict, Tuple
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time
import argparse
from datetime import datetime
import json
import signal
import sys

class CSSOptimizer:
    def __init__(self, dry_run=False, threads=8):
        self.css_files = ['frontend/styles.css', 'frontend/muscle-colors.css']
        self.search_extensions = ['.html', '.js', '.py']
        self.search_directories = ['frontend/', 'backend/', '.']
        self.dry_run = dry_run
        self.max_threads = threads
        
        # Patterns à ignorer
        self.ignore_patterns = [
            r'^muscle-\w+',      # Classes dynamiques muscles
            r'^chart-\w+',       # Classes Chart.js
            r'^animation-\w+',   # Classes animations
            r'^hover\w*',        # Classes hover states
            r'^active\w*',       # Classes active states
            r'^\w+-\d+$',        # Classes avec numéros (ex: col-12)
        ]
        
        # Statistiques globales
        self.global_stats = {
            'step1_total_classes': 0,
            'step1_unused_classes': 0,
            'step2_confirmed_unused': 0,
            'step2_actually_used': 0,
            'step3_classes_removed': 0,
            'step3_bytes_saved': 0,
            'step4_rules_merged': 0,
            'step4_bytes_saved': 0,
            'total_time': 0
        }
        
        # Données partagées entre étapes
        self.unused_classes = []
        self.confirmed_unused = []
        self.css_rules = {}
        
        # Pour la progression parallèle
        self.progress_lock = threading.Lock()
        self.completed_tasks = 0
        self.total_tasks = 0
        
        # Patterns de recherche JavaScript
        self.js_patterns = [
            r'classList\.(?:add|remove|toggle|contains)\s*\(\s*["\']([^"\']*{classname}[^"\']*)["\']',
            r'className\s*[=+]\s*["\'][^"\']*\b{classname}\b[^"\']*["\']',
            r'querySelector(?:All)?\s*\(\s*["\'][^"\']*\.{classname}(?:[^"\']*)?["\']',
            r'getElementById\s*\([^)]*\)\.classList\.(?:add|remove|toggle)\([^)]*["\']([^"\']*{classname}[^"\']*)["\']',
            r'document\.getElementsByClassName\s*\(\s*["\']([^"\']*{classname}[^"\']*)["\']',
            r'\.{classname}\b',
            r'["\']([^"\']*\s{classname}\s[^"\']*)["\']',
            r'["\']([^"\']*{classname}[^"\']*)["\']',
        ]
        
        # Patterns HTML
        self.html_patterns = [
            r'class\s*=\s*["\'][^"\']*\b{classname}\b[^"\']*["\']',
            r'class\s*=\s*["\']([^"\']*{classname}[^"\']*)["\']',
        ]
        
        # Patterns Python
        self.python_patterns = [
            r'class\s*=\s*["\'][^"\']*\b{classname}\b[^"\']*["\']',
            r'f["\'][^"\']*\b{classname}\b[^"\']*["\']',
            r'["\']([^"\']*{classname}[^"\']*)["\']',
        ]
    
    # ============= ÉTAPE 1: DÉTECTION =============
    
    def step1_detect_unused(self) -> Dict:
        """Étape 1: Détecte les classes CSS potentiellement inutilisées."""
        print("\n" + "="*70)
        print("📋 ÉTAPE 1: DÉTECTION DES CLASSES INUTILISÉES")
        print("="*70)
        
        all_classes = set()
        
        # Extraire toutes les classes CSS
        for css_file in self.css_files:
            if os.path.exists(css_file):
                classes = self._extract_css_classes(css_file)
                all_classes.update(classes)
                print(f"📁 {css_file}: {len(classes)} classes trouvées")
        
        self.global_stats['step1_total_classes'] = len(all_classes)
        print(f"\n📊 Total: {len(all_classes)} classes CSS à vérifier")
        
        # Vérifier chaque classe (recherche basique)
        unused = []
        used = []
        
        for i, class_name in enumerate(sorted(all_classes), 1):
            print(f"🔎 [{i}/{len(all_classes)}] Vérification: .{class_name}", end="")
            
            usage_files = self._quick_search_class(class_name)
            
            if usage_files:
                used.append(class_name)
                print(f" ✅ UTILISÉE")
            else:
                unused.append(class_name)
                print(f" ❌ INUTILISÉE")
        
        self.unused_classes = unused
        self.global_stats['step1_unused_classes'] = len(unused)
        
        # Générer rapport étape 1
        self._generate_step1_report(unused, used)
        
        return {
            'total_classes': len(all_classes),
            'unused_classes': unused,
            'used_classes': used
        }
    
    def _extract_css_classes(self, css_file: str) -> Set[str]:
        """Extrait toutes les classes CSS d'un fichier."""
        try:
            with open(css_file, 'r', encoding='utf-8') as f:
                content = f.read()
        except FileNotFoundError:
            print(f"❌ Fichier CSS non trouvé: {css_file}")
            return set()
        
        # Regex pour trouver les classes CSS
        class_pattern = r'\.([a-zA-Z][\w-]+)(?=\s*[{,\s])'
        matches = re.findall(class_pattern, content)
        
        # Filtrer les classes à ignorer
        classes = set()
        for match in matches:
            if not any(re.match(pattern, match) for pattern in self.ignore_patterns):
                classes.add(match)
        
        return classes
    
    def _quick_search_class(self, class_name: str) -> List[str]:
        """Recherche rapide d'une classe dans le projet."""
        found_files = []
        patterns = [rf'\b{re.escape(class_name)}\b']
        
        for directory in self.search_directories:
            if not os.path.exists(directory):
                continue
                
            for root, dirs, files in os.walk(directory):
                dirs[:] = [d for d in dirs if d not in ['__pycache__', 'node_modules', '.git', 'venv']]
                
                for file in files:
                    if any(file.endswith(ext) for ext in self.search_extensions):
                        file_path = os.path.join(root, file)
                        
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                            
                            for pattern in patterns:
                                if re.search(pattern, content, re.IGNORECASE):
                                    found_files.append(file_path)
                                    break
                        except Exception:
                            pass
        
        return found_files
    
    # ============= ÉTAPE 2: VÉRIFICATION PARALLÉLISÉE =============
    
    def step2_verify_parallel(self) -> Dict:
        """Étape 2: Vérification parallélisée approfondie des classes inutilisées."""
        if not self.unused_classes:
            print("\n⚠️  Aucune classe inutilisée à vérifier")
            return {}
        
        print("\n" + "="*70)
        print("🔍 ÉTAPE 2: VÉRIFICATION PARALLÉLISÉE")
        print("="*70)
        
        self.total_tasks = len(self.unused_classes)
        self.completed_tasks = 0
        
        print(f"🚀 Vérification de {len(self.unused_classes)} classes avec {self.max_threads} threads...")
        print("📊 Progression:")
        
        start_time = time.time()
        
        confirmed_unused = []
        actually_used = []
        suspicious_cases = []
        
        # Traitement parallèle
        with ThreadPoolExecutor(max_workers=self.max_threads) as executor:
            future_to_class = {
                executor.submit(self._analyze_single_class, class_name): class_name
                for class_name in self.unused_classes
            }
            
            for future in as_completed(future_to_class):
                class_name = future_to_class[future]
                try:
                    analysis = future.result()
                    
                    if analysis['status'] == 'UNUSED':
                        confirmed_unused.append(class_name)
                    elif analysis['total_occurrences'] == 1:
                        suspicious_cases.append(class_name)
                    else:
                        actually_used.append(class_name)
                        
                except Exception:
                    pass
        
        end_time = time.time()
        print(f"\n⚡ Analyse terminée en {end_time - start_time:.1f}s")
        
        self.confirmed_unused = confirmed_unused
        self.global_stats['step2_confirmed_unused'] = len(confirmed_unused)
        self.global_stats['step2_actually_used'] = len(actually_used)
        
        # Générer rapport étape 2
        self._generate_step2_report(confirmed_unused, actually_used, suspicious_cases)
        
        return {
            'confirmed_unused': confirmed_unused,
            'actually_used': actually_used,
            'suspicious': suspicious_cases
        }
    
    def _analyze_single_class(self, class_name: str) -> Dict:
        """Analyse approfondie d'une classe."""
        try:
            results = self._deep_search_class(class_name)
            total_occurrences = sum(len(matches) for matches in results.values())
            
            status = "✅ INUTILISÉE" if total_occurrences == 0 else f"❌ UTILISÉE ({total_occurrences})"
            self._update_progress(class_name, status)
            
            return {
                'class_name': class_name,
                'total_occurrences': total_occurrences,
                'results': results,
                'status': 'UNUSED' if total_occurrences == 0 else 'USED'
            }
        except Exception as e:
            return {
                'class_name': class_name,
                'total_occurrences': 0,
                'results': {},
                'status': 'ERROR'
            }
    
    def _deep_search_class(self, class_name: str) -> Dict[str, List]:
        """Recherche approfondie avec patterns spécifiques."""
        results = {'.html': [], '.js': [], '.py': []}
        
        for directory in self.search_directories:
            if not os.path.exists(directory):
                continue
                
            for root, dirs, files in os.walk(directory):
                dirs[:] = [d for d in dirs if d not in ['__pycache__', 'node_modules', '.git', 'venv']]
                
                for file in files:
                    ext = '.' + file.split('.')[-1] if '.' in file else ''
                    if ext in self.search_extensions:
                        file_path = os.path.join(root, file)
                        matches = self._search_in_file(file_path, class_name, ext)
                        if matches and ext in results:
                            results[ext].extend(matches)
        
        return results
    
    def _search_in_file(self, file_path: str, class_name: str, extension: str) -> List[Tuple]:
        """Recherche dans un fichier avec patterns appropriés."""
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
        except Exception:
            return []
        
        # Choisir les patterns selon l'extension
        if extension == '.html':
            patterns = self.html_patterns
        elif extension == '.js':
            patterns = self.js_patterns
        elif extension == '.py':
            patterns = self.python_patterns
        else:
            patterns = [r'\b{classname}\b']
        
        matches = []
        for line_num, line in enumerate(lines, 1):
            for pattern in patterns:
                formatted_pattern = pattern.format(classname=re.escape(class_name))
                
                if re.search(formatted_pattern, line, re.IGNORECASE):
                    clean_line = line.strip()[:100] + '...' if len(line.strip()) > 100 else line.strip()
                    matches.append((file_path, line_num, clean_line))
                    break
        
        return matches
    
    def _update_progress(self, class_name: str, status: str) -> None:
        """Met à jour la progression thread-safe."""
        with self.progress_lock:
            self.completed_tasks += 1
            progress = (self.completed_tasks / self.total_tasks) * 100
            print(f"\r🔍 [{self.completed_tasks:3d}/{self.total_tasks}] ({progress:5.1f}%) .{class_name:<20} - {status}", 
                  end="", flush=True)
    
    # ============= ÉTAPE 3: SUPPRESSION =============
    
    def step3_remove_classes(self) -> Dict:
        """Étape 3: Supprime les classes confirmées inutilisées des fichiers CSS."""
        if not self.confirmed_unused:
            print("\n⚠️  Aucune classe à supprimer")
            return {}
        
        print("\n" + "="*70)
        print("🗑️  ÉTAPE 3: SUPPRESSION DES CLASSES INUTILISÉES")
        print("="*70)
        
        print(f"🎯 Classes à supprimer: {len(self.confirmed_unused)}")
        
        # Créer backup
        if not self.dry_run:
            backup_dir = self._create_backup()
            print(f"💾 Backup créé: {backup_dir}")
        
        total_bytes_saved = 0
        classes_set = set(self.confirmed_unused)
        
        for css_file in self.css_files:
            if os.path.exists(css_file):
                bytes_saved = self._remove_classes_from_file(css_file, classes_set)
                total_bytes_saved += bytes_saved
        
        self.global_stats['step3_classes_removed'] = len(self.confirmed_unused)
        self.global_stats['step3_bytes_saved'] = total_bytes_saved
        
        print(f"\n✅ Suppression terminée: {total_bytes_saved:,} octets économisés")
        
        return {
            'classes_removed': len(self.confirmed_unused),
            'bytes_saved': total_bytes_saved
        }
    
    def _remove_classes_from_file(self, css_file: str, classes_to_remove: Set[str]) -> int:
        """Supprime les classes du fichier CSS."""
        if not os.path.exists(css_file):
            return 0
        
        print(f"🔧 Traitement de {css_file}...")
        
        with open(css_file, 'r', encoding='utf-8') as f:
            original_content = f.read()
        
        original_size = len(original_content)
        modified_content = original_content
        
        # Supprimer chaque classe
        for class_name in classes_to_remove:
            # Pattern pour supprimer les règles complètes
            rule_pattern = rf'\.{re.escape(class_name)}[^{{]*\{{[^}}]*\}}'
            modified_content = re.sub(rule_pattern, '', modified_content, flags=re.MULTILINE)
            
            # Pattern pour supprimer des sélecteurs multiples
            selector_pattern = rf'\.{re.escape(class_name)}(?=[\s,:.#\[])'
            modified_content = re.sub(selector_pattern, '', modified_content)
        
        # Nettoyer les lignes vides multiples
        modified_content = re.sub(r'\n\s*\n\s*\n', '\n\n', modified_content)
        
        new_size = len(modified_content)
        bytes_saved = original_size - new_size
        
        if not self.dry_run and modified_content != original_content:
            with open(css_file, 'w', encoding='utf-8') as f:
                f.write(modified_content)
            print(f"  💾 {bytes_saved:,} octets économisés")
        elif self.dry_run:
            print(f"  🔍 [DRY-RUN] Économiserait {bytes_saved:,} octets")
        
        return bytes_saved
    
    # ============= ÉTAPE 4: CONSOLIDATION =============
    
    def step4_consolidate(self) -> Dict:
        """Étape 4: Consolide les règles CSS dupliquées."""
        print("\n" + "="*70)
        print("✨ ÉTAPE 4: CONSOLIDATION DES RÈGLES CSS")
        print("="*70)
        
        total_rules_before = 0
        total_rules_after = 0
        total_bytes_saved = 0
        
        for css_file in self.css_files:
            if os.path.exists(css_file):
                result = self._consolidate_file(css_file)
                total_rules_before += result['rules_before']
                total_rules_after += result['rules_after']
                total_bytes_saved += result['bytes_saved']
        
        self.global_stats['step4_rules_merged'] = total_rules_before - total_rules_after
        self.global_stats['step4_bytes_saved'] = total_bytes_saved
        
        if total_rules_before > 0:
            reduction = ((total_rules_before - total_rules_after) / total_rules_before * 100)
            print(f"\n🎉 Consolidation: {reduction:.1f}% de réduction")
            print(f"💾 {total_bytes_saved:,} octets économisés")
        
        return {
            'rules_merged': total_rules_before - total_rules_after,
            'bytes_saved': total_bytes_saved
        }
    
    def _consolidate_file(self, css_file: str) -> Dict:
        """Consolide un fichier CSS."""
        if not os.path.exists(css_file):
            return {'rules_before': 0, 'rules_after': 0, 'bytes_saved': 0}
        
        print(f"📄 Consolidation de {css_file}...")
        
        with open(css_file, 'r', encoding='utf-8') as f:
            original_content = f.read()
        
        original_size = len(original_content)
        
        # Parser les règles CSS
        rules = self._parse_css_rules(original_content)
        rules_before = len(rules)
        print(f"  📊 {rules_before} règles trouvées")
        
        # Consolider les règles dupliquées
        consolidated = self._merge_duplicate_rules(rules)
        rules_after = len(consolidated)
        print(f"  ✨ {rules_after} règles après consolidation")
        
        # Reconstruire le CSS
        new_content = self._format_consolidated_css(consolidated)
        
        new_size = len(new_content)
        bytes_saved = original_size - new_size
        
        if not self.dry_run and new_content != original_content:
            with open(css_file, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"  ✅ {bytes_saved:,} octets économisés")
        elif self.dry_run:
            print(f"  🔍 [DRY-RUN] Économiserait {bytes_saved:,} octets")
        
        return {
            'rules_before': rules_before,
            'rules_after': rules_after,
            'bytes_saved': bytes_saved
        }
    
    def _parse_css_rules(self, content: str) -> List[Dict]:
        """Parse le CSS en règles structurées."""
        rules = []
        
        # Pattern simple pour capturer sélecteur { propriétés }
        pattern = r'([^{}]+)\s*\{([^{}]+)\}'
        
        for match in re.finditer(pattern, content, re.MULTILINE):
            selector = match.group(1).strip()
            properties_text = match.group(2).strip()
            
            # Parser les propriétés
            properties = OrderedDict()
            prop_pattern = r'([^:;]+)\s*:\s*([^;]+);?'
            
            for prop_match in re.finditer(prop_pattern, properties_text):
                prop_name = prop_match.group(1).strip()
                prop_value = prop_match.group(2).strip()
                properties[prop_name] = prop_value
            
            if properties:
                rules.append({
                    'selector': selector,
                    'properties': properties
                })
        
        return rules
    
    def _merge_duplicate_rules(self, rules: List[Dict]) -> List[Dict]:
        """Fusionne les règles avec sélecteurs identiques."""
        consolidated = OrderedDict()
        
        for rule in rules:
            selector = rule['selector']
            
            # Normaliser le sélecteur
            normalized = re.sub(r'\s+', ' ', selector).strip()
            
            if normalized in consolidated:
                # Fusionner les propriétés (dernière valeur gagne)
                consolidated[normalized]['properties'].update(rule['properties'])
            else:
                consolidated[normalized] = {
                    'selector': selector,
                    'properties': OrderedDict(rule['properties'])
                }
        
        return list(consolidated.values())
    
    def _format_consolidated_css(self, rules: List[Dict]) -> str:
        """Formate les règles CSS consolidées."""
        output = []
        
        for rule in rules:
            selector = rule['selector']
            properties = rule['properties']
            
            if not properties:
                continue
            
            # Format compact pour une propriété, multi-ligne pour plusieurs
            if len(properties) == 1:
                prop_name, prop_value = list(properties.items())[0]
                output.append(f"{selector} {{ {prop_name}: {prop_value}; }}")
            else:
                props_lines = [f"    {name}: {value};" for name, value in properties.items()]
                output.append(f"{selector} {{")
                output.extend(props_lines)
                output.append("}")
        
        return '\n\n'.join(output) if len(properties) == 1 else '\n'.join(output)
    
    # ============= UTILITAIRES =============
    
    def _create_backup(self) -> str:
        """Crée un backup des fichiers CSS."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = f"css_backup_{timestamp}"
        
        os.makedirs(backup_dir, exist_ok=True)
        
        for css_file in self.css_files:
            if os.path.exists(css_file):
                backup_file = os.path.join(backup_dir, os.path.basename(css_file))
                shutil.copy2(css_file, backup_file)
        
        return backup_dir
    
    def _generate_step1_report(self, unused: List[str], used: List[str]) -> None:
        """Génère le rapport de l'étape 1."""
        with open('css_step1_report.txt', 'w', encoding='utf-8') as f:
            f.write("ÉTAPE 1: DÉTECTION DES CLASSES INUTILISÉES\n")
            f.write("="*50 + "\n\n")
            f.write(f"Classes totales: {self.global_stats['step1_total_classes']}\n")
            f.write(f"Classes utilisées: {len(used)}\n")
            f.write(f"Classes inutilisées: {len(unused)}\n\n")
            
            if unused:
                f.write("CLASSES POTENTIELLEMENT INUTILISÉES:\n")
                for class_name in sorted(unused):
                    f.write(f".{class_name}\n")
    
    def _generate_step2_report(self, confirmed: List[str], used: List[str], suspicious: List[str]) -> None:
        """Génère le rapport de l'étape 2."""
        with open('css_step2_report.txt', 'w', encoding='utf-8') as f:
            f.write("ÉTAPE 2: VÉRIFICATION PARALLÉLISÉE\n")
            f.write("="*50 + "\n\n")
            f.write(f"Classes confirmées inutilisées: {len(confirmed)}\n")
            f.write(f"Classes effectivement utilisées: {len(used)}\n")
            f.write(f"Cas suspects: {len(suspicious)}\n\n")
            
            if confirmed:
                f.write("CLASSES CONFIRMÉES INUTILISÉES:\n")
                for class_name in sorted(confirmed):
                    f.write(f".{class_name}\n")
    
    def generate_final_report(self) -> None:
        """Génère le rapport final complet."""
        print("\n" + "="*70)
        print("📊 RAPPORT FINAL D'OPTIMISATION CSS")
        print("="*70)
        
        report = []
        report.append("RAPPORT FINAL D'OPTIMISATION CSS")
        report.append("="*70)
        report.append(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        report.append(f"Mode: {'DRY-RUN' if self.dry_run else 'PRODUCTION'}")
        report.append("")
        
        # Statistiques par étape
        report.append("📋 ÉTAPE 1 - DÉTECTION:")
        report.append(f"  • Classes totales analysées: {self.global_stats['step1_total_classes']}")
        report.append(f"  • Classes potentiellement inutilisées: {self.global_stats['step1_unused_classes']}")
        report.append("")
        
        report.append("🔍 ÉTAPE 2 - VÉRIFICATION:")
        report.append(f"  • Classes confirmées inutilisées: {self.global_stats['step2_confirmed_unused']}")
        report.append(f"  • Classes effectivement utilisées: {self.global_stats['step2_actually_used']}")
        report.append("")
        
        report.append("🗑️  ÉTAPE 3 - SUPPRESSION:")
        report.append(f"  • Classes supprimées: {self.global_stats['step3_classes_removed']}")
        report.append(f"  • Octets économisés: {self.global_stats['step3_bytes_saved']:,}")
        report.append("")
        
        report.append("✨ ÉTAPE 4 - CONSOLIDATION:")
        report.append(f"  • Règles fusionnées: {self.global_stats['step4_rules_merged']}")
        report.append(f"  • Octets économisés: {self.global_stats['step4_bytes_saved']:,}")
        report.append("")
        
        # Total
        total_saved = self.global_stats['step3_bytes_saved'] + self.global_stats['step4_bytes_saved']
        report.append("💾 TOTAL:")
        report.append(f"  • Octets économisés: {total_saved:,} ({total_saved/1024:.1f} KB)")
        
        # Sauvegarder et afficher
        report_text = '\n'.join(report)
        
        with open('css_optimization_report.txt', 'w', encoding='utf-8') as f:
            f.write(report_text)
        
        print('\n'.join(report[3:]))  # Skip header for console
        print(f"\n📄 Rapport complet sauvegardé: css_optimization_report.txt")
    
    def run(self, steps=None, skip_steps=None):
        """Lance le processus d'optimisation."""
        steps = steps or [1, 2, 3, 4]
        skip_steps = skip_steps or []
        
        print("🚀 OPTIMISEUR CSS UNIFIÉ")
        print("="*70)
        print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"🔧 Mode: {'DRY-RUN' if self.dry_run else 'PRODUCTION'}")
        print(f"🧵 Threads: {self.max_threads}")
        print(f"📋 Étapes à exécuter: {[s for s in steps if s not in skip_steps]}")
        
        start_time = time.time()
        
        # Exécuter les étapes demandées
        if 1 in steps and 1 not in skip_steps:
            self.step1_detect_unused()
        
        if 2 in steps and 2 not in skip_steps:
            self.step2_verify_parallel()
        
        if 3 in steps and 3 not in skip_steps:
            self.step3_remove_classes()
        
        if 4 in steps and 4 not in skip_steps:
            self.step4_consolidate()
        
        self.global_stats['total_time'] = time.time() - start_time
        
        # Générer le rapport final
        self.generate_final_report()
        
        print(f"\n⏱️  Temps total: {self.global_stats['total_time']:.1f}s")
        print("✅ Optimisation terminée!")

def main():
    parser = argparse.ArgumentParser(
        description='Optimiseur CSS unifié en 4 étapes',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  python css_optimizer.py                     # Exécute toutes les étapes
  python css_optimizer.py --step 1            # Exécute seulement l'étape 1
  python css_optimizer.py --step 1 2          # Exécute les étapes 1 et 2
  python css_optimizer.py --skip-step 2       # Exécute tout sauf l'étape 2
  python css_optimizer.py --dry-run           # Mode simulation
  python css_optimizer.py --threads 16        # Utilise 16 threads pour l'étape 2
        """
    )
    
    parser.add_argument('--step', nargs='+', type=int, choices=[1, 2, 3, 4],
                       help='Étapes spécifiques à exécuter (1=détection, 2=vérification, 3=suppression, 4=consolidation)')
    parser.add_argument('--skip-step', nargs='+', type=int, choices=[1, 2, 3, 4],
                       help='Étapes à ignorer')
    parser.add_argument('--dry-run', action='store_true',
                       help='Mode simulation sans modification des fichiers')
    parser.add_argument('--threads', type=int, default=8,
                       help='Nombre de threads pour la vérification parallélisée (défaut: 8)')
    
    args = parser.parse_args()
    
    optimizer = CSSOptimizer(
        dry_run=args.dry_run,
        threads=args.threads
    )
    
    try:
        optimizer.run(
            steps=args.step,
            skip_steps=args.skip_step
        )
    except KeyboardInterrupt:
        print("\n⚠️  Optimisation interrompue")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        raise

if __name__ == "__main__":
    main()