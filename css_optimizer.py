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
import fnmatch
from pathlib import Path
from typing import Set, List, Dict, Tuple
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time
import argparse
from datetime import datetime
import json
import sys
import glob

def load_config(config_file='.css-optimizer.json'):
    """Charge la configuration ou utilise des valeurs par défaut."""
    default_config = {
        'css_files': ['*.css'],
        'search_directories': ['.'],
        'search_extensions': ['.html', '.js', '.jsx', '.ts', '.tsx', '.vue', '.py'],
        'ignore_patterns': [],
        'exclude_dirs': ['node_modules', '.git', 'dist', 'build', 'venv', '__pycache__'],
        'exclude_files': ['css_optimizer.py', 'css_step*.txt', 'css_optimization_report.txt'],
        'search_mode': 'safe'  # 'safe' = détection permissive, 'strict' = patterns exacts uniquement
    }
    
    if os.path.exists(config_file):
        with open(config_file, 'r') as f:
            user_config = json.load(f)
            default_config.update(user_config)
    
    return default_config

class CSSOptimizer:
    def __init__(self, dry_run=False, threads=8, config_file='.css-optimizer.json', force_mode=None):
        config = load_config(config_file)
        
        self.css_files = self._expand_css_files(config['css_files'])
        self.search_extensions = config['search_extensions']
        self.search_directories = config['search_directories']
        self.ignore_patterns = config['ignore_patterns']
        self.exclude_dirs = config['exclude_dirs']
        self.exclude_files = config.get('exclude_files', ['css_optimizer.py', 'css_step*.txt', 'css_optimization_report.txt'])
        self.search_mode = force_mode or config.get('search_mode', 'safe')
        self.dry_run = dry_run
        self.max_threads = threads
        
        # Afficher le mode de recherche
        if self.search_mode == 'safe':
            print("🛡️  Mode SAFE : Détection permissive (évite les suppressions accidentelles)")
        else:
            print("⚡ Mode STRICT : Détection exacte (peut manquer certains usages)")
        
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
    
    # ============= ÉTAPE 1: DÉTECTION =============
    def _expand_css_files(self, patterns):
        """Expand glob patterns pour trouver les fichiers CSS."""
        css_files = []
        for pattern in patterns:
            if '*' in pattern:
                css_files.extend(glob.glob(pattern, recursive=True))
            else:
                if os.path.exists(pattern):
                    css_files.append(pattern)
        return css_files
    
    def _should_exclude_file(self, filename: str) -> bool:
        """Vérifie si un fichier doit être exclu de la recherche."""
        basename = os.path.basename(filename)
        
        for pattern in self.exclude_files:
            if '*' in pattern:
                if fnmatch.fnmatch(basename, pattern):
                    return True
            elif pattern in basename:
                return True
        
        return False

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
        
        # Vérifier chaque classe
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
        
        # Enlever les commentaires CSS
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        
        # Ignorer le contenu des @keyframes et @media pour l'extraction
        content_without_at_rules = self._remove_at_rules_for_extraction(content)
        
        # Regex pour trouver les classes CSS
        class_pattern = r'\.([a-zA-Z][\w-]+)(?=\s*[{,\s:[])'
        matches = re.findall(class_pattern, content_without_at_rules)
        
        # Filtrer les classes à ignorer
        classes = set()
        for match in matches:
            if not any(re.match(pattern, match) for pattern in self.ignore_patterns):
                classes.add(match)
        
        return classes
    
    def _remove_at_rules_for_extraction(self, content: str) -> str:
        """Enlève temporairement les @rules pour l'extraction des classes."""
        # Enlever @keyframes
        content = re.sub(r'@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', '', content, flags=re.MULTILINE | re.DOTALL)
        
        # Enlever @media et autres @rules avec blocs imbriqués
        lines = content.split('\n')
        new_lines = []
        in_at_rule = False
        brace_count = 0
        
        for line in lines:
            if '@' in line and '{' in line:
                in_at_rule = True
                brace_count = line.count('{') - line.count('}')
            elif in_at_rule:
                brace_count += line.count('{') - line.count('}')
                if brace_count <= 0:
                    in_at_rule = False
                    brace_count = 0
            elif not in_at_rule:
                new_lines.append(line)
        
        return '\n'.join(new_lines)
    
    def _quick_search_class(self, class_name: str) -> List[str]:
        """Recherche rapide d'une classe dans le projet."""
        found_files = []
        escaped_name = re.escape(class_name)
        
        # Patterns de base (mode strict)
        patterns_strict = [
            # Patterns HTML
            rf'class\s*=\s*["\'][^"\']*\b{escaped_name}\b[^"\']*["\']',
            # Patterns JS/TS pour utilisation directe
            rf'\.{escaped_name}(?![a-zA-Z0-9_-])',
            rf'querySelector[^(]*\([^)]*\.{escaped_name}(?![a-zA-Z0-9_-])',
            rf'classList\.[^(]+\(["\']?{escaped_name}(?![a-zA-Z0-9_-])',
            rf'className[^=]*=[^"\']*["\'][^"\']*\b{escaped_name}\b',
        ]
        
        # Patterns additionnels pour mode safe
        patterns_safe = [
            # Pattern général pour TOUTE chaîne contenant la classe
            rf'["\'][^"\']*{escaped_name}[^"\']*["\']',
            rf'`[^`]*{escaped_name}[^`]*`',  # Template literals
        ]
        
        # Choisir les patterns selon le mode
        if self.search_mode == 'safe':
            patterns = patterns_strict + patterns_safe
        else:
            patterns = patterns_strict
        
        for directory in self.search_directories:
            if not os.path.exists(directory):
                continue
                
            for root, dirs, files in os.walk(directory):
                dirs[:] = [d for d in dirs if d not in self.exclude_dirs]
                
                for file in files:
                    if self._should_exclude_file(file):
                        continue
                        
                    if any(file.endswith(ext) for ext in self.search_extensions):
                        file_path = os.path.join(root, file)
                        
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                            
                            # Enlever les commentaires pour éviter les faux positifs
                            if file.endswith('.py'):
                                content = re.sub(r'#.*$', '', content, flags=re.MULTILINE)
                                content = re.sub(r'""".*?"""', '', content, flags=re.DOTALL)
                                content = re.sub(r"'''.*?'''", '', content, flags=re.DOTALL)
                            elif file.endswith(('.js', '.jsx', '.ts', '.tsx')):
                                # Enlever les commentaires JS
                                content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
                                content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
                            
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
                dirs[:] = [d for d in dirs if d not in self.exclude_dirs]
                
                for file in files:
                    if self._should_exclude_file(file):
                        continue
                    
                    ext = '.' + file.split('.')[-1] if '.' in file else ''
                    if ext in self.search_extensions:
                        file_path = os.path.join(root, file)
                        matches = self._search_in_file(file_path, class_name, ext)
                        if matches and ext in results:
                            results[ext].extend(matches)
        
        return results
    
    def _search_in_file(self, file_path: str, class_name: str, extension: str) -> List[Tuple]:
        """Recherche dans un fichier avec patterns appropriés."""
        if self._should_exclude_file(file_path):
            return []
            
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                lines = content.split('\n')
        except Exception:
            return []
        
        # Pour les fichiers Python, enlever les commentaires
        if extension == '.py':
            content = re.sub(r'""".*?"""', '', content, flags=re.DOTALL)
            content = re.sub(r"'''.*?'''", '', content, flags=re.DOTALL)
            lines = content.split('\n')
            lines = [re.sub(r'#.*$', '', line) for line in lines]
        
        # Pour les fichiers JS, enlever les commentaires aussi
        if extension in ['.js', '.jsx', '.ts', '.tsx']:
            # Enlever les commentaires // et /* */
            lines_cleaned = []
            in_block_comment = False
            for line in lines:
                # Gérer les commentaires de bloc
                if '/*' in line and '*/' in line:
                    line = re.sub(r'/\*.*?\*/', '', line)
                elif '/*' in line:
                    line = line[:line.index('/*')]
                    in_block_comment = True
                elif '*/' in line and in_block_comment:
                    line = line[line.index('*/')+2:]
                    in_block_comment = False
                elif in_block_comment:
                    continue
                    
                # Enlever les commentaires de ligne
                if '//' in line:
                    # Attention aux URL qui contiennent //
                    if not re.search(r'https?://', line):
                        line = re.sub(r'//.*$', '', line)
                
                lines_cleaned.append(line)
            lines = lines_cleaned
        
        escaped_name = re.escape(class_name)
        
        # Patterns adaptés par type de fichier et mode
        if extension == '.html':
            patterns = [
                rf'class\s*=\s*["\'][^"\']*\b{escaped_name}\b[^"\']*["\']',
            ]
        elif extension in ['.js', '.jsx', '.ts', '.tsx']:
            patterns_strict = [
                # Patterns pour utilisation directe
                rf'\.{escaped_name}(?![a-zA-Z0-9_-])',
                rf'classList\.(?:add|remove|toggle|contains)\s*\(\s*["\']?{escaped_name}(?![a-zA-Z0-9_-])',
                rf'querySelector[^(]*\([^)]*\.{escaped_name}(?![a-zA-Z0-9_-])',
                rf'className[^=]*=[^"\']*["\'][^"\']*\b{escaped_name}\b',
            ]
            
            patterns_safe = [
                # Patterns additionnels pour cas "tordus" (mode safe uniquement)
                rf'return\s+["\']({escaped_name}|[^"\']*\s{escaped_name}|{escaped_name}\s[^"\']*|[^"\']*\s{escaped_name}\s[^"\']*)["\']',
                rf'(?:const|let|var)\s+\w+\s*=\s*["\'][^"\']*{escaped_name}[^"\']*["\']',
                rf':\s*["\'][^"\']*{escaped_name}[^"\']*["\']',
                rf'\[[^\]]*["\'][^"\']*{escaped_name}[^"\']*["\'][^\]]*\]',
                rf'\?\s*["\'][^"\']*{escaped_name}[^"\']*["\']',
                rf'\([^)]*["\'][^"\']*{escaped_name}[^"\']*["\'][^)]*\)',
                rf'`[^`]*{escaped_name}[^`]*`',
                # Pattern le plus permissif en dernier
                rf'["\'][^"\']*{escaped_name}[^"\']*["\']',
            ]
            
            if self.search_mode == 'safe':
                patterns = patterns_strict + patterns_safe
            else:
                patterns = patterns_strict
                
        elif extension == '.py':
            patterns_strict = [
                rf'class\s*=\s*["\'][^"\']*\b{escaped_name}\b[^"\']*["\']',
                rf'f["\'][^"\']*\b{escaped_name}\b[^"\']*["\']',
            ]
            
            if self.search_mode == 'safe':
                # Ajouter le pattern général pour Python en mode safe
                patterns = patterns_strict + [rf'["\'][^"\']*{escaped_name}[^"\']*["\']']
            else:
                patterns = patterns_strict
        else:
            patterns = [rf'\.{escaped_name}(?![a-zA-Z0-9_-])']
        
        matches = []
        for line_num, line in enumerate(lines, 1):
            if not line.strip():
                continue
                
            for pattern in patterns:
                if re.search(pattern, line, re.IGNORECASE):
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
        """Supprime les classes du fichier CSS de manière sûre."""
        if not os.path.exists(css_file):
            return 0
        
        print(f"🔧 Traitement de {css_file}...")
        
        with open(css_file, 'r', encoding='utf-8') as f:
            original_content = f.read()
        
        original_size = len(original_content)
        
        # Parser le CSS en préservant la structure
        modified_content = self._safe_remove_classes(original_content, classes_to_remove)
        
        new_size = len(modified_content)
        bytes_saved = original_size - new_size
        
        if not self.dry_run and modified_content != original_content:
            with open(css_file, 'w', encoding='utf-8') as f:
                f.write(modified_content)
            print(f"  💾 {bytes_saved:,} octets économisés")
        elif self.dry_run:
            print(f"  🔍 [DRY-RUN] Économiserait {bytes_saved:,} octets")
        
        return bytes_saved
    
    def _safe_remove_classes(self, content: str, classes_to_remove: Set[str]) -> str:
        """Supprime les classes de manière sûre en préservant la structure CSS."""
        result_lines = []
        lines = content.split('\n')
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            # Détecter et préserver les @keyframes
            if '@keyframes' in line:
                keyframe_block = [line]
                brace_count = line.count('{') - line.count('}')
                i += 1
                
                while i < len(lines) and brace_count > 0:
                    keyframe_block.append(lines[i])
                    brace_count += lines[i].count('{') - lines[i].count('}')
                    i += 1
                
                result_lines.extend(keyframe_block)
                continue
            
            # Détecter les @media, @supports, etc.
            elif line.strip().startswith('@') and '{' in line:
                at_rule_block = [line]
                brace_count = line.count('{') - line.count('}')
                i += 1
                
                at_rule_content = []
                while i < len(lines) and brace_count > 0:
                    at_rule_content.append(lines[i])
                    brace_count += lines[i].count('{') - lines[i].count('}')
                    i += 1
                
                # Traiter le contenu de l'@rule
                at_rule_content_str = '\n'.join(at_rule_content)
                if at_rule_content_str.rstrip().endswith('}'):
                    at_rule_content_str = at_rule_content_str.rstrip()[:-1]
                    modified_at_rule_content = self._process_css_rules(at_rule_content_str, classes_to_remove)
                    
                    if modified_at_rule_content.strip():
                        result_lines.append(line)
                        result_lines.append(modified_at_rule_content)
                        result_lines.append('}')
                else:
                    result_lines.extend([line] + at_rule_content)
                continue
            
            # Détecter une règle CSS normale
            elif self._is_css_rule_start(line):
                rule_lines = [line]
                if '{' in line and '}' in line:
                    # Règle sur une seule ligne
                    modified_rule = self._process_single_rule(line, classes_to_remove)
                    if modified_rule:
                        result_lines.append(modified_rule)
                    i += 1
                    continue
                elif '{' in line:
                    # Règle sur plusieurs lignes
                    i += 1
                    while i < len(lines) and '}' not in lines[i]:
                        rule_lines.append(lines[i])
                        i += 1
                    if i < len(lines):
                        rule_lines.append(lines[i])
                    
                    rule_str = '\n'.join(rule_lines)
                    modified_rule = self._process_single_rule(rule_str, classes_to_remove)
                    if modified_rule:
                        result_lines.append(modified_rule)
                    i += 1
                    continue
            
            # Ligne normale (commentaire, espace, etc.)
            result_lines.append(line)
            i += 1
        
        result = '\n'.join(result_lines)
        
        # Nettoyer les espaces multiples
        result = re.sub(r'\n\s*\n\s*\n+', '\n\n', result)
        
        return result
    
    def _is_css_rule_start(self, line: str) -> bool:
        """Détecte si une ligne est le début d'une règle CSS."""
        line = line.strip()
        if not line or line.startswith('//') or line.startswith('/*'):
            return False
        if line.startswith('@'):
            return False
        if re.match(r'^[\.#:\[\w\s,>+~*-]+', line):
            return True
        return False
    
    def _process_single_rule(self, rule: str, classes_to_remove: Set[str]) -> str:
        """Traite une règle CSS unique."""
        match = re.match(r'^([^{]+)\{([^}]*)\}', rule, re.DOTALL)
        if not match:
            return rule
        
        selector = match.group(1).strip()
        properties = match.group(2).strip()
        
        # Traiter les sélecteurs multiples
        selectors = [s.strip() for s in selector.split(',')]
        new_selectors = []
        
        for sel in selectors:
            should_remove = False
            for class_name in classes_to_remove:
                class_pattern = rf'\.{re.escape(class_name)}(?![a-zA-Z0-9_-])'
                if re.search(class_pattern, sel):
                    should_remove = True
                    break
            
            if not should_remove:
                new_selectors.append(sel)
        
        if not new_selectors:
            return ''
        
        new_selector = ', '.join(new_selectors)
        
        if '\n' in rule:
            return f"{new_selector} {{\n{properties}\n}}"
        else:
            return f"{new_selector} {{ {properties} }}"
    
    def _process_css_rules(self, content: str, classes_to_remove: Set[str]) -> str:
        """Traite un bloc de règles CSS."""
        lines = content.split('\n')
        result_lines = []
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            if self._is_css_rule_start(line):
                rule_lines = [line]
                if '{' in line and '}' in line:
                    modified_rule = self._process_single_rule(line, classes_to_remove)
                    if modified_rule:
                        result_lines.append(modified_rule)
                    i += 1
                    continue
                elif '{' in line:
                    i += 1
                    while i < len(lines) and '}' not in lines[i]:
                        rule_lines.append(lines[i])
                        i += 1
                    if i < len(lines):
                        rule_lines.append(lines[i])
                    
                    rule_str = '\n'.join(rule_lines)
                    modified_rule = self._process_single_rule(rule_str, classes_to_remove)
                    if modified_rule:
                        result_lines.append(modified_rule)
                    i += 1
                    continue
            
            result_lines.append(line)
            i += 1
        
        return '\n'.join(result_lines)
    
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
        
        # Parser les règles CSS en préservant @keyframes et @media
        rules, at_rules = self._parse_css_with_at_rules(original_content)
        rules_before = len(rules)
        print(f"  📊 {rules_before} règles trouvées")
        
        # Consolider les règles dupliquées
        consolidated = self._merge_duplicate_rules(rules)
        rules_after = len(consolidated)
        print(f"  ✨ {rules_after} règles après consolidation")
        
        # Reconstruire le CSS
        new_content = self._format_consolidated_with_at_rules(consolidated, at_rules)
        
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
    
    def _parse_css_with_at_rules(self, content: str) -> Tuple[List[Dict], List[str]]:
        """Parse le CSS en préservant les @rules."""
        rules = []
        at_rules = []
        
        # Enlever les commentaires
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        
        # Extraire et préserver les @keyframes
        keyframes_pattern = r'(@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\})'
        keyframes = re.findall(keyframes_pattern, content, flags=re.MULTILINE | re.DOTALL)
        at_rules.extend(keyframes)
        
        # Enlever les @keyframes du contenu
        for kf in keyframes:
            content = content.replace(kf, f'/*KEYFRAME_PLACEHOLDER_{len(at_rules)-1}*/')
        
        # Parser les règles normales
        pattern = r'([^{}]+)\s*\{([^{}]+)\}'
        
        for match in re.finditer(pattern, content, re.MULTILINE):
            selector = match.group(1).strip()
            properties_text = match.group(2).strip()
            
            if 'PLACEHOLDER' in selector:
                continue
            
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
        
        return rules, at_rules
    
    def _merge_duplicate_rules(self, rules: List[Dict]) -> List[Dict]:
        """Fusionne les règles avec sélecteurs identiques."""
        consolidated = OrderedDict()
        
        for rule in rules:
            selector = rule['selector']
            normalized = re.sub(r'\s+', ' ', selector).strip()
            
            if normalized in consolidated:
                consolidated[normalized]['properties'].update(rule['properties'])
            else:
                consolidated[normalized] = {
                    'selector': selector,
                    'properties': OrderedDict(rule['properties'])
                }
        
        return list(consolidated.values())
    
    def _format_consolidated_with_at_rules(self, rules: List[Dict], at_rules: List[str]) -> str:
        """Formate les règles CSS consolidées avec les @rules préservées."""
        output = []
        
        # Ajouter les @keyframes en premier
        output.extend(at_rules)
        
        # Ajouter les règles consolidées
        for rule in rules:
            selector = rule['selector']
            properties = rule['properties']
            
            if not properties:
                continue
            
            props_lines = [f"    {name}: {value};" for name, value in properties.items()]
            output.append(f"\n{selector} {{")
            output.extend(props_lines)
            output.append("}")
        
        return '\n'.join(output)
    
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
    
    def debug_class(self, class_name: str):
        """Debug pourquoi une classe n'est pas supprimée."""
        print(f"\n🔍 DEBUG pour la classe: .{class_name}")
        print("="*50)
        
        # Test 1: Extraction
        print("\n1️⃣ TEST D'EXTRACTION:")
        all_classes = set()
        for css_file in self.css_files:
            if os.path.exists(css_file):
                classes = self._extract_css_classes(css_file)
                if class_name in classes:
                    print(f"  ✅ Trouvée dans {css_file}")
                    all_classes.add(class_name)
                else:
                    print(f"  ❌ Pas trouvée dans {css_file}")
        
        if class_name not in all_classes:
            print(f"  ⚠️  La classe n'est pas détectée dans les fichiers CSS!")
            return
        
        # Test 2: Recherche rapide
        print("\n2️⃣ TEST DE RECHERCHE RAPIDE:")
        usage_files = self._quick_search_class(class_name)
        if usage_files:
            print(f"  ❌ Trouvée dans {len(usage_files)} fichiers:")
            for f in usage_files[:5]:
                print(f"    - {f}")
        else:
            print(f"  ✅ Aucune utilisation trouvée")
        
        # Test 3: Recherche approfondie
        print("\n3️⃣ TEST DE RECHERCHE APPROFONDIE:")
        results = self._deep_search_class(class_name)
        total_occurrences = sum(len(matches) for matches in results.values())
        
        if total_occurrences > 0:
            print(f"  ❌ {total_occurrences} occurrences trouvées:")
            for ext, matches in results.items():
                if matches:
                    print(f"\n  Dans les fichiers {ext} ({len(matches)} occurrences):")
                    for file_path, line_num, line_content in matches[:3]:
                        print(f"    {file_path}:{line_num}")
                        print(f"      {line_content}")
        else:
            print(f"  ✅ Aucune occurrence trouvée")
        
        print("\n" + "="*50)
        if total_occurrences == 0 and not usage_files:
            print("✅ Cette classe devrait être supprimée lors de l'optimisation")
        else:
            print("❌ Cette classe ne sera PAS supprimée car des utilisations ont été trouvées")
    
    def run(self, steps=None, skip_steps=None, debug_class=None):
        """Lance le processus d'optimisation."""
        # Mode debug pour une classe spécifique
        if debug_class:
            self.debug_class(debug_class)
            return
        
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
  python css_optimizer.py --mode strict       # Mode strict (patterns exacts uniquement)
  python css_optimizer.py --debug muscle-readiness2  # Debug pourquoi une classe n'est pas supprimée
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
    parser.add_argument('--mode', choices=['safe', 'strict'], 
                       help='Mode de recherche: safe (défaut, plus permissif) ou strict (patterns exacts)')
    parser.add_argument('--debug', type=str, metavar='CLASS_NAME',
                       help='Debug pourquoi une classe spécifique n\'est pas supprimée')
    
    args = parser.parse_args()
    
    optimizer = CSSOptimizer(
        dry_run=args.dry_run,
        threads=args.threads,
        force_mode=args.mode
    )
    
    try:
        optimizer.run(
            steps=args.step,
            skip_steps=args.skip_step,
            debug_class=args.debug
        )
    except KeyboardInterrupt:
        print("\n⚠️  Optimisation interrompue")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        raise

if __name__ == "__main__":
    main()