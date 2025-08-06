#!/usr/bin/env python3
"""
GESTIONNAIRE UNIFIÉ CSS - NETTOYAGE CLASSES INUTILISÉES
=======================================================
Script tout-en-un pour détecter, vérifier et supprimer les classes CSS inutilisées.

Usage: python css_manager.py [step] [options]

Steps:
  1, analyze    - Analyser et estimer les classes supprimables
  2, verify     - Vérifier avec patterns avancés (recommandé avant suppression)
  3, clean      - Supprimer les classes avec backup (IRRÉVERSIBLE sans backup)

Options globales:
  --threads N   - Nombre de threads pour l'analyse (défaut: 8)
  --dry-run     - Mode simulation pour l'étape 3 (clean)
"""

import re
import os
import shutil
import argparse
import signal
import sys
from pathlib import Path
from typing import Set, List, Dict, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time

class CSSManager:
    def __init__(self, threads=8):
        self.css_files = ['frontend/styles.css', 'frontend/muscle-colors.css']
        self.search_extensions = ['.html', '.js', '.py']
        self.search_directories = ['frontend/', 'backend/', '.']
        self.threads = threads
        
        # Patterns ignorés (classes dynamiques)
        self.ignore_patterns = [
            r'^muscle-\w+', r'^chart-\w+', r'^animation-\w+',
            r'^hover\w*', r'^active\w*', r'^\w+-\d+$'
        ]
        
        # Patterns de recherche avancés
        self.js_patterns = [
            r'classList\.(?:add|remove|toggle|contains)\s*\(\s*["\']([^"\']*{classname}[^"\']*)["\']',
            r'className\s*[=+]\s*["\'][^"\']*\b{classname}\b[^"\']*["\']',
            r'querySelector(?:All)?\s*\(\s*["\'][^"\']*\.{classname}(?:[^"\']*)?["\']',
            r'\.{classname}\b',
            r'["\']([^"\']*{classname}[^"\']*)["\']',
        ]
        self.html_patterns = [
            r'class\s*=\s*["\'][^"\']*\b{classname}\b[^"\']*["\']',
        ]
        self.python_patterns = [
            r'class\s*=\s*["\'][^"\']*\b{classname}\b[^"\']*["\']',
            r'f["\'][^"\']*\b{classname}\b[^"\']*["\']',
        ]
        
        # Progress tracking
        self.progress_lock = threading.Lock()
        self.completed_tasks = 0
        self.total_tasks = 0
        
        # Signal handler
        signal.signal(signal.SIGINT, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        print(f"\n⚠️  Interruption détectée. Arrêt en cours...")
        sys.exit(0)
    
    def _get_file_stats(self, css_file: str) -> Dict:
        """Obtient les statistiques d'un fichier CSS."""
        if not os.path.exists(css_file):
            return {'lines': 0, 'chars': 0, 'size_kb': 0}
        
        with open(css_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return {
            'lines': len(content.split('\n')),
            'chars': len(content),
            'size_kb': len(content.encode('utf-8')) / 1024
        }
    
    def _extract_css_classes(self, css_file: str) -> Set[str]:
        """Extrait toutes les classes CSS d'un fichier."""
        try:
            with open(css_file, 'r', encoding='utf-8') as f:
                content = f.read()
        except FileNotFoundError:
            return set()
        
        class_pattern = r'\.([a-zA-Z][\w-]+)(?=\s*[{,\s])'
        matches = re.findall(class_pattern, content)
        
        classes = set()
        for match in matches:
            if not any(re.match(pattern, match) for pattern in self.ignore_patterns):
                classes.add(match)
        return classes
    
    def _search_class_in_file(self, file_path: str, class_name: str, extension: str) -> bool:
        """Recherche une classe dans un fichier spécifique."""
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except:
            return False
        
        # Choisir les patterns selon l'extension
        if extension == '.html':
            patterns = self.html_patterns
        elif extension == '.js':
            patterns = self.js_patterns  
        elif extension == '.py':
            patterns = self.python_patterns
        else:
            patterns = [r'\b{classname}\b']
        
        for pattern in patterns:
            formatted_pattern = pattern.format(classname=re.escape(class_name))
            if re.search(formatted_pattern, content, re.IGNORECASE):
                return True
        return False
    
    def _update_progress(self, class_name: str, status: str) -> None:
        """Met à jour la progression thread-safe."""
        with self.progress_lock:
            self.completed_tasks += 1
            if self.total_tasks > 0:
                progress = (self.completed_tasks / self.total_tasks) * 100
                print(f"\r  🔍 [{self.completed_tasks:3d}/{self.total_tasks}] ({progress:5.1f}%) .{class_name:<20} - {status}", end="", flush=True)
    
    def step1_analyze(self) -> Dict:
        """ÉTAPE 1: Analyse initiale et estimation."""
        print("🔍 ÉTAPE 1: ANALYSE DES CLASSES CSS")
        print("=" * 50)
        
        # Stats des fichiers CSS
        total_stats = {'lines': 0, 'chars': 0, 'size_kb': 0}
        print("📁 Fichiers CSS analysés:")
        for css_file in self.css_files:
            if os.path.exists(css_file):
                stats = self._get_file_stats(css_file)
                total_stats['lines'] += stats['lines']
                total_stats['chars'] += stats['chars'] 
                total_stats['size_kb'] += stats['size_kb']
                print(f"  • {css_file}: {stats['lines']:,} lignes, {stats['size_kb']:.1f} KB")
        
        print(f"\n📊 TOTAUX: {total_stats['lines']:,} lignes, {total_stats['size_kb']:.1f} KB")
        
        # Extraction des classes
        print("\n🔎 Extraction des classes CSS...")
        all_classes = set()
        for css_file in self.css_files:
            if os.path.exists(css_file):
                classes = self._extract_css_classes(css_file)
                all_classes.update(classes)
                print(f"  • {css_file}: {len(classes)} classes uniques")
        
        print(f"📈 TOTAL: {len(all_classes)} classes CSS à vérifier")
        
        # Recherche rapide des classes utilisées
        print(f"\n🚀 Recherche d'utilisation (threads: {self.threads})...")
        self.total_tasks = len(all_classes)
        self.completed_tasks = 0
        
        # Collecte des fichiers à analyser
        files_to_check = []
        for directory in self.search_directories:
            if os.path.exists(directory):
                for root, dirs, files in os.walk(directory):
                    dirs[:] = [d for d in dirs if d not in ['__pycache__', 'node_modules', '.git', 'venv']]
                    for file in files:
                        ext = '.' + file.split('.')[-1] if '.' in file else ''
                        if ext in self.search_extensions:
                            files_to_check.append(os.path.join(root, file))
        
        print(f"  📂 {len(files_to_check)} fichiers source à vérifier")
        
        unused_classes = []
        used_classes = []
        
        def check_class(class_name):
            is_used = False
            for file_path in files_to_check:
                ext = '.' + file_path.split('.')[-1] if '.' in file_path else ''
                if self._search_class_in_file(file_path, class_name, ext):
                    is_used = True
                    break
            
            status = "❌ UTILISÉE" if is_used else "✅ INUTILISÉE"
            self._update_progress(class_name, status)
            return (class_name, is_used)
        
        # Analyse parallèle
        with ThreadPoolExecutor(max_workers=self.threads) as executor:
            results = list(executor.map(check_class, sorted(all_classes)))
        
        print()  # Nouvelle ligne après la progression
        
        for class_name, is_used in results:
            if is_used:
                used_classes.append(class_name)
            else:
                unused_classes.append(class_name)
        
        # Estimation de l'économie
        estimated_lines_saved = len(unused_classes) * 3  # Estimation 3 lignes par classe
        estimated_kb_saved = (len(unused_classes) * 50) / 1024  # Estimation 50 chars par classe
        
        results = {
            'total_classes': len(all_classes),
            'unused_classes': unused_classes,
            'used_classes': used_classes,
            'total_stats': total_stats,
            'estimated_lines_saved': estimated_lines_saved,
            'estimated_kb_saved': estimated_kb_saved
        }
        
        # Sauvegarde du rapport
        self._save_step1_report(results)
        
        # Affichage des résultats
        print("\n" + "="*60)
        print("📋 RÉSULTATS ÉTAPE 1 - ESTIMATION")
        print("="*60)
        print(f"📊 Classes totales trouvées: {len(all_classes)}")
        print(f"✅ Classes utilisées: {len(used_classes)}")
        print(f"🗑️  Classes potentiellement supprimables: {len(unused_classes)}")
        print(f"\n💡 ESTIMATION des gains:")
        print(f"  • Lignes économisées: ~{estimated_lines_saved:,}")
        print(f"  • Espace économisé: ~{estimated_kb_saved:.1f} KB")
        
        if len(unused_classes) > 0:
            print(f"\n🔎 Aperçu des classes à supprimer:")
            for class_name in unused_classes[:10]:
                print(f"  • .{class_name}")
            if len(unused_classes) > 10:
                print(f"  • ... et {len(unused_classes) - 10} autres")
        
        print(f"\n💾 Rapport sauvegardé: css_analysis_report.txt")
        
        # Instructions pour l'étape suivante
        print("\n" + "🚀 ÉTAPE SUIVANTE".center(60, "="))
        print("Pour vérifier ces résultats avec des patterns avancés:")
        print("👉 python css_manager.py 2")
        print("   ou")
        print("👉 python css_manager.py verify")
        
        return results
    
    def step2_verify(self) -> Dict:
        """ÉTAPE 2: Vérification avancée avec patterns JavaScript/HTML."""
        print("🔍 ÉTAPE 2: VÉRIFICATION AVANCÉE")
        print("=" * 50)
        
        # Charger les classes de l'étape 1
        if not os.path.exists('css_analysis_report.txt'):
            print("❌ Rapport d'analyse non trouvé!")
            print("👉 Lancez d'abord: python css_manager.py 1")
            return {}
        
        # Parse du rapport de l'étape 1 (simple)
        unused_classes = []
        with open('css_analysis_report.txt', 'r', encoding='utf-8') as f:
            content = f.read()
            # Extraire les classes de la section "Classes supprimables"
            if "CLASSES SUPPRIMABLES:" in content:
                lines = content.split('\n')
                in_section = False
                for line in lines:
                    if "CLASSES SUPPRIMABLES:" in line:
                        in_section = True
                        continue
                    elif line.startswith('=') or line.startswith('-'):
                        continue
                    elif in_section and line.strip().startswith('.'):
                        class_name = line.strip()[1:]  # Retirer le point
                        unused_classes.append(class_name)
        
        if not unused_classes:
            print("❌ Aucune classe à vérifier trouvée dans le rapport")
            return {}
        
        print(f"📊 Vérification de {len(unused_classes)} classes avec patterns avancés...")
        
        self.total_tasks = len(unused_classes)
        self.completed_tasks = 0
        
        confirmed_unused = []
        actually_used = []
        
        def verify_class(class_name):
            # Recherche exhaustive avec tous les patterns
            is_used = False
            for directory in self.search_directories:
                if not os.path.exists(directory):
                    continue
                for root, dirs, files in os.walk(directory):
                    dirs[:] = [d for d in dirs if d not in ['__pycache__', 'node_modules', '.git', 'venv']]
                    for file in files:
                        ext = '.' + file.split('.')[-1] if '.' in file else ''
                        if ext in self.search_extensions:
                            file_path = os.path.join(root, file)
                            if self._search_class_in_file(file_path, class_name, ext):
                                is_used = True
                                break
                    if is_used:
                        break
                if is_used:
                    break
            
            status = "❌ UTILISÉE" if is_used else "✅ CONFIRMÉE INUTILISÉE"
            self._update_progress(class_name, status)
            return (class_name, is_used)
        
        # Vérification parallèle
        with ThreadPoolExecutor(max_workers=self.threads) as executor:
            results = list(executor.map(verify_class, unused_classes))
        
        print()  # Nouvelle ligne
        
        for class_name, is_used in results:
            if is_used:
                actually_used.append(class_name)
            else:
                confirmed_unused.append(class_name)
        
        verification_results = {
            'confirmed_unused': confirmed_unused,
            'actually_used': actually_used,
            'verification_date': datetime.now().isoformat()
        }
        
        # Sauvegarde
        self._save_step2_report(verification_results)
        
        # Affichage
        print("\n" + "="*60)
        print("📋 RÉSULTATS ÉTAPE 2 - VÉRIFICATION")
        print("="*60)
        print(f"🔍 Classes vérifiées: {len(unused_classes)}")
        print(f"✅ Confirmées INUTILISÉES: {len(confirmed_unused)}")
        print(f"❌ Finalement UTILISÉES: {len(actually_used)}")
        
        if len(actually_used) > 0:
            print(f"\n⚠️  Classes sauvées de la suppression:")
            for class_name in actually_used[:5]:
                print(f"  • .{class_name}")
            if len(actually_used) > 5:
                print(f"  • ... et {len(actually_used) - 5} autres")
        
        print(f"\n💾 Rapport sauvegardé: css_verification_report.txt")
        
        # Instructions pour l'étape suivante
        if len(confirmed_unused) > 0:
            print("\n" + "🚀 ÉTAPE SUIVANTE".center(60, "="))
            print("Pour supprimer les classes confirmées inutilisées:")
            print("👉 python css_manager.py 3 --dry-run  (simulation)")
            print("👉 python css_manager.py 3             (suppression réelle)")
            print("   ou")
            print("👉 python css_manager.py clean --dry-run")
            print("👉 python css_manager.py clean")
        else:
            print("\n🎉 Aucune classe à supprimer - Votre CSS est optimisé!")
        
        return verification_results
    
    def step3_clean(self, dry_run=False) -> Dict:
        """ÉTAPE 3: Suppression des classes avec backup."""
        print("🗑️  ÉTAPE 3: SUPPRESSION DES CLASSES CSS")
        print("=" * 50)
        
        if dry_run:
            print("🔍 MODE SIMULATION (DRY-RUN)")
        else:
            print("⚠️  MODE SUPPRESSION RÉELLE")
        
        # Charger les classes confirmées inutilisées
        if not os.path.exists('css_verification_report.txt'):
            print("❌ Rapport de vérification non trouvé!")
            print("👉 Lancez d'abord: python css_manager.py 2")
            return {}
        
        confirmed_unused = []
        with open('css_verification_report.txt', 'r', encoding='utf-8') as f:
            content = f.read()
            if "CLASSES CONFIRMÉES INUTILISÉES:" in content:
                lines = content.split('\n')
                in_section = False
                for line in lines:
                    if "CLASSES CONFIRMÉES INUTILISÉES:" in line:
                        in_section = True
                        continue
                    elif line.startswith('✅') or line.startswith('⚠️'):
                        in_section = False
                    elif in_section and line.strip().startswith('.'):
                        class_name = line.strip()[1:]  # Retirer le point
                        confirmed_unused.append(class_name)
        
        if not confirmed_unused:
            print("✅ Aucune classe à supprimer trouvée!")
            return {}
        
        print(f"🎯 Classes à supprimer: {len(confirmed_unused)}")
        
        # Stats avant suppression
        before_stats = {}
        total_before = {'lines': 0, 'size_kb': 0}
        for css_file in self.css_files:
            if os.path.exists(css_file):
                stats = self._get_file_stats(css_file)
                before_stats[css_file] = stats
                total_before['lines'] += stats['lines']
                total_before['size_kb'] += stats['size_kb']
                print(f"  📄 {css_file}: {stats['lines']:,} lignes, {stats['size_kb']:.1f} KB")
        
        # Backup (si pas dry-run)
        backup_path = None
        if not dry_run:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = f"css_backup_{timestamp}"
            os.makedirs(backup_path, exist_ok=True)
            
            for css_file in self.css_files:
                if os.path.exists(css_file):
                    backup_file = os.path.join(backup_path, os.path.basename(css_file))
                    shutil.copy2(css_file, backup_file)
                    print(f"💾 Backup: {css_file} → {backup_file}")
        else:
            print("🔍 [DRY-RUN] Backup simulé")
        
        # Suppression des classes
        removal_stats = {'classes_removed': 0, 'blocks_removed': 0}
        
        for css_file in self.css_files:
            if os.path.exists(css_file):
                print(f"\n🔧 Traitement: {css_file}")
                file_stats = self._remove_classes_from_file(css_file, confirmed_unused, dry_run)
                removal_stats['classes_removed'] += file_stats['removed']
                removal_stats['blocks_removed'] += file_stats['blocks_removed']
        
        # Stats après suppression
        after_stats = {}
        total_after = {'lines': 0, 'size_kb': 0}
        for css_file in self.css_files:
            if os.path.exists(css_file):
                stats = self._get_file_stats(css_file)
                after_stats[css_file] = stats
                total_after['lines'] += stats['lines']
                total_after['size_kb'] += stats['size_kb']
        
        # Calcul des gains
        lines_saved = total_before['lines'] - total_after['lines']
        kb_saved = total_before['size_kb'] - total_after['size_kb']
        
        results = {
            'before_stats': before_stats,
            'after_stats': after_stats,
            'lines_saved': lines_saved,
            'kb_saved': kb_saved,
            'classes_removed': removal_stats['classes_removed'],
            'blocks_removed': removal_stats['blocks_removed'],
            'backup_path': backup_path,
            'dry_run': dry_run
        }
        
        # Sauvegarde du rapport
        self._save_step3_report(results)
        
        # Affichage final
        print("\n" + "="*60)
        print("📋 RÉSULTATS ÉTAPE 3 - NETTOYAGE")
        print("="*60)
        print(f"🗑️  Classes supprimées: {removal_stats['classes_removed']}")
        print(f"🧹 Blocs CSS supprimés: {removal_stats['blocks_removed']}")
        print(f"📏 Lignes économisées: {lines_saved:,}")
        print(f"💾 Espace économisé: {kb_saved:.1f} KB")
        
        if not dry_run and backup_path:
            print(f"💾 Backup créé: {backup_path}")
        elif dry_run:
            print("🔍 MODE DRY-RUN - Aucun fichier modifié")
        
        print(f"\n💾 Rapport sauvegardé: css_cleanup_report.txt")
        
        if dry_run and lines_saved > 0:
            print("\n" + "🚀 PRÊT POUR NETTOYAGE RÉEL".center(60, "="))
            print("Pour appliquer ces modifications:")
            print("👉 python css_manager.py 3")
        elif not dry_run:
            print("\n🎉 NETTOYAGE TERMINÉ!")
            print("N'oubliez pas de tester votre application web!")
        
        return results
    
    def _remove_classes_from_file(self, css_file: str, classes_to_remove: List[str], dry_run: bool) -> Dict:
        """Supprime les classes d'un fichier CSS."""
        with open(css_file, 'r', encoding='utf-8') as f:
            original_content = f.read()
        
        modified_content = original_content
        stats = {'removed': 0, 'blocks_removed': 0}
        
        # Simple regex pour supprimer les blocs de classes
        for class_name in classes_to_remove:
            # Pattern pour trouver les blocs CSS complets
            pattern = rf'\.{re.escape(class_name)}\s*\{{[^}}]*\}}'
            matches = re.findall(pattern, modified_content, re.MULTILINE | re.DOTALL)
            if matches:
                modified_content = re.sub(pattern, '', modified_content, flags=re.MULTILINE | re.DOTALL)
                stats['removed'] += 1
                stats['blocks_removed'] += len(matches)
                print(f"  🗑️  .{class_name} supprimée")
        
        # Nettoyer les lignes vides multiples
        modified_content = re.sub(r'\n\s*\n\s*\n+', '\n\n', modified_content)
        
        # Sauvegarder (si pas dry-run)
        if not dry_run and modified_content != original_content:
            with open(css_file, 'w', encoding='utf-8') as f:
                f.write(modified_content)
        
        return stats
    
    def _save_step1_report(self, results: Dict) -> None:
        """Sauvegarde le rapport de l'étape 1."""
        with open('css_analysis_report.txt', 'w', encoding='utf-8') as f:
            f.write("RAPPORT ANALYSE CSS - ÉTAPE 1\n")
            f.write("=" * 40 + "\n\n")
            f.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Classes totales: {results['total_classes']}\n")
            f.write(f"Classes utilisées: {len(results['used_classes'])}\n")
            f.write(f"Classes supprimables: {len(results['unused_classes'])}\n\n")
            f.write("STATISTIQUES FICHIERS:\n")
            f.write(f"Lignes totales: {results['total_stats']['lines']:,}\n")
            f.write(f"Taille totale: {results['total_stats']['size_kb']:.1f} KB\n\n")
            f.write("CLASSES SUPPRIMABLES:\n")
            f.write("-" * 20 + "\n")
            for class_name in sorted(results['unused_classes']):
                f.write(f".{class_name}\n")
    
    def _save_step2_report(self, results: Dict) -> None:
        """Sauvegarde le rapport de l'étape 2."""
        with open('css_verification_report.txt', 'w', encoding='utf-8') as f:
            f.write("RAPPORT VÉRIFICATION CSS - ÉTAPE 2\n")
            f.write("=" * 40 + "\n\n")
            f.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write("CLASSES CONFIRMÉES INUTILISÉES:\n")
            f.write("-" * 30 + "\n")
            for class_name in sorted(results['confirmed_unused']):
                f.write(f".{class_name}\n")
            f.write(f"\nCLASSES EFFECTIVEMENT UTILISÉES:\n")
            f.write("-" * 30 + "\n")
            for class_name in sorted(results['actually_used']):
                f.write(f".{class_name}\n")
    
    def _save_step3_report(self, results: Dict) -> None:
        """Sauvegarde le rapport de l'étape 3."""
        with open('css_cleanup_report.txt', 'w', encoding='utf-8') as f:
            f.write("RAPPORT NETTOYAGE CSS - ÉTAPE 3\n")
            f.write("=" * 40 + "\n\n")
            f.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Mode: {'DRY-RUN' if results['dry_run'] else 'SUPPRESSION RÉELLE'}\n")
            f.write(f"Classes supprimées: {results['classes_removed']}\n")
            f.write(f"Blocs supprimés: {results['blocks_removed']}\n")
            f.write(f"Lignes économisées: {results['lines_saved']:,}\n")
            f.write(f"Espace économisé: {results['kb_saved']:.1f} KB\n")
            if results['backup_path']:
                f.write(f"Backup: {results['backup_path']}\n")

def main():
    parser = argparse.ArgumentParser(
        description='Gestionnaire unifié CSS - Nettoyage classes inutilisées',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Étapes recommandées:
  1. python css_manager.py 1          # Analyser
  2. python css_manager.py 2          # Vérifier  
  3. python css_manager.py 3 --dry-run # Tester
  4. python css_manager.py 3          # Nettoyer
        """
    )
    
    parser.add_argument('step', nargs='?', default='help',
                       help='Étape à exécuter: 1/analyze, 2/verify, 3/clean, ou help')
    parser.add_argument('--threads', '-t', type=int, default=8,
                       help='Nombre de threads (défaut: 8)')
    parser.add_argument('--dry-run', action='store_true',
                       help='Mode simulation pour l\'étape 3')
    
    args = parser.parse_args()
    
    if args.step in ['help', '-h', '--help']:
        print(__doc__)
        return
    
    manager = CSSManager(threads=args.threads)
    
    try:
        if args.step in ['1', 'analyze']:
            manager.step1_analyze()
        elif args.step in ['2', 'verify']:
            manager.step2_verify()
        elif args.step in ['3', 'clean']:
            manager.step3_clean(dry_run=args.dry_run)
        else:
            print(f"❌ Étape inconnue: {args.step}")
            print("👉 Utilisez: python css_manager.py help")
            
    except KeyboardInterrupt:
        print("\n⚠️  Opération interrompue")
    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        raise

if __name__ == "__main__":
    main()