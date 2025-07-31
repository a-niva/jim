#!/usr/bin/env python3
"""
🎨 CSS ANALYZER FINAL - ULTRA-STRICT CORRIGÉ
===========================================

CORRECTION TOTALE:
• SEULEMENT les vrais attributs class="..." et className="..."
• Template strings JavaScript support
• ZÉRO faux positifs (variables JS, opérateurs, etc.)
• Multi-fichiers CSS support
• Classification intelligente externe vs erreurs
• SYNTAXE PYTHON CORRIGÉE
"""

import os
import re
import json
import sys
import glob
from pathlib import Path
from typing import Set, List, Dict
from collections import defaultdict
from datetime import datetime

class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'
    DIM = '\033[2m'

def colorize(text: str, color: str) -> str:
    return f"{color}{text}{Colors.END}"

class CSSAnalyzerFinal:
    def __init__(self):
        self.css_classes = set()
        self.used_classes = set()
        self.css_files = []
        self.external_libs = set()
        self.class_origins = defaultdict(list)
        self.file_stats = {}
        
    def extract_css_classes_strict(self, css_content: str, file_path: str) -> Set[str]:
        """Extraction CSS ULTRA-STRICTE"""
        classes = set()
        
        # Nettoyer CSS (commentaires uniquement)
        css_clean = re.sub(r'/\*.*?\*/', '', css_content, flags=re.DOTALL)
        
        # SEULEMENT les sélecteurs de classe valides
        patterns = [
            r'\.([a-zA-Z][a-zA-Z0-9_-]+)(?=[\s\.:,{>+~\[\]#]|$)',  # .class-name
            r'@keyframes\s+([a-zA-Z][a-zA-Z0-9_-]+)',              # animations
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, css_clean)
            for match in matches:
                if len(match) > 1:  # Au moins 2 caractères
                    classes.add(match)
                    self.class_origins[match].append(file_path)
        
        # Media queries (récursif)
        media_matches = re.findall(r'@media[^{]*\{(.*?)\}', css_clean, re.DOTALL)
        for media_content in media_matches:
            media_classes = self.extract_css_classes_strict(media_content, file_path)
            classes.update(media_classes)
        
        return classes
    
    def extract_html_classes_intelligent(self, content: str, file_path: str) -> Set[str]:
        """EXTRACTION HTML INTELLIGENTE - Template strings + filtres anti-faux-positifs"""
        classes = set()
        
        # === PATTERNS INTELLIGENTS ===
        
        # 1. Attributs class HTML standard
        html_patterns = [
            r'<[^>]*\sclass\s*=\s*["\']([^"\']+)["\']',           # <div class="...">
            r'<[^>]*\sclassName\s*=\s*["\']([^"\']+)["\']',       # React className
        ]
        
        # 2. Template strings JavaScript avec HTML (CRITIQUE!)
        template_patterns = [
            r'`[^`]*<[^>]*class\s*=\s*["\']([^"\']+)["\'][^`]*`',     # `<div class="...">`
            r'`[^`]*<[^>]*className\s*=\s*["\']([^"\']+)["\'][^`]*`', # React dans template
        ]
        
        # 3. innerHTML et insertAdjacentHTML
        inner_html_patterns = [
            r'innerHTML\s*[+=]\s*["`][^"`]*<[^>]*class\s*=\s*["\']([^"\']+)["\']',
            r'insertAdjacentHTML\s*\([^,]*,\s*["`][^"`]*class\s*=\s*["\']([^"\']+)["\']',
        ]
        
        # 4. classList operations
        classList_patterns = [
            r'classList\.(?:add|remove|toggle|contains)\s*\(\s*["\']([a-zA-Z][a-zA-Z0-9_-]+)["\']',
        ]
        
        # Appliquer tous les patterns
        all_patterns = html_patterns + template_patterns + inner_html_patterns + classList_patterns
        
        for pattern in all_patterns:
            matches = re.findall(pattern, content, re.IGNORECASE | re.MULTILINE | re.DOTALL)
            for match in matches:
                # Split sur espaces pour classes multiples
                if ' ' in match:
                    class_list = re.split(r'\s+', match.strip())
                    for cls in class_list:
                        if cls and self._is_valid_css_class(cls):
                            classes.add(cls)
                            self.class_origins[cls].append(f"{file_path}:html")
                else:
                    if match and self._is_valid_css_class(match):
                        classes.add(match)
                        self.class_origins[match].append(f"{file_path}:html")
        
        # 5. React className objets (conditionnel)
        react_pattern = r'className\s*=\s*\{[^}]*["\']([a-zA-Z][a-zA-Z0-9_-]+)["\'][^}]*\}'
        matches = re.findall(react_pattern, content)
        for match in matches:
            if self._is_valid_css_class(match):
                classes.add(match)
                self.class_origins[match].append(f"{file_path}:react")
        
        return classes
    
    def _is_valid_css_class(self, cls: str) -> bool:
        """Validation INTELLIGENTE - Filtre les faux positifs mais garde les vraies classes"""
        # Nettoyage de base
        cls = cls.strip()
        
        # Doit commencer par une lettre
        if not re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', cls):
            return False
        
        # Au moins 2 caractères
        if len(cls) < 2:
            return False
        
        # === EXCLUSIONS STRICTES (faux positifs) ===
        
        # Mots JavaScript/programmation
        js_keywords = {
            'class', 'function', 'return', 'true', 'false', 'null', 'undefined',
            'var', 'let', 'const', 'if', 'else', 'for', 'while', 'do', 'switch',
            'case', 'break', 'continue', 'try', 'catch', 'throw', 'new', 'this',
            'super', 'extends', 'import', 'export', 'default', 'from', 'as',
            'typeof', 'instanceof', 'delete', 'void', 'in', 'of', 'async', 'await'
        }
        
        if cls.lower() in js_keywords:
            return False
        
        # Valeurs CSS standard (pas des classes)
        css_values = {
            'none', 'auto', 'inherit', 'initial', 'unset', 'normal', 'bold',
            'italic', 'left', 'right', 'center', 'top', 'bottom', 'middle',
            'block', 'inline', 'flex', 'grid', 'absolute', 'relative', 'fixed',
            'static', 'sticky', 'hidden', 'visible', 'transparent', 'solid',
            'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset'
        }
        
        if cls.lower() in css_values:
            return False
        
        # Nombres purs
        if re.match(r'^\d+(\.\d+)?$', cls):
            return False
        
        # Opérateurs et symboles
        operators = {'>', '<', '>=', '<=', '===', '==', '!=', '!==', '&&', '||', '++', '--'}
        if cls in operators:
            return False
        
        # Template literal artifacts
        if '${' in cls or '}' in cls:
            return False
        
        # === PATTERNS SUSPECTS MAIS POSSIBLES ===
        
        # Mots très courts (potentiellement variables JS)
        short_words = {'el', 'ex', 'id', 'is', 'if', 'on', 'to', 'up', 'me', 'my', 'go', 'no', 'be'}
        if len(cls) == 2 and cls.lower() in short_words:
            return False
        
        # Mais GARDER les vraies classes courtes CSS communes
        css_short_classes = {'btn', 'nav', 'card', 'form', 'item', 'list', 'text', 'icon', 'tab', 'row', 'col'}
        if cls.lower() in css_short_classes:
            return True
        
        return True
    
    def classify_external_libraries(self, class_name: str) -> bool:
        """Classification PRÉCISE des bibliothèques externes"""
        external_patterns = [
            # FontAwesome
            r'^fa[srlb]?-[a-zA-Z0-9_-]+$',
            
            # Bootstrap core classes
            r'^btn-(primary|secondary|success|danger|warning|info|light|dark|outline-\w+)$',
            r'^text-(primary|secondary|success|danger|warning|info|light|dark|muted|white)$',
            r'^bg-(primary|secondary|success|danger|warning|info|light|dark|transparent|white)$',
            r'^col-(xs|sm|md|lg|xl)-\d{1,2}$',
            r'^row$|^col$|^container(-fluid)?$',
            r'^d-(none|inline|inline-block|block|table|table-cell|table-row|flex|inline-flex)$',
            r'^justify-content-(start|end|center|between|around|evenly)$',
            r'^align-items-(start|end|center|baseline|stretch)$',
            
            # Bootstrap Icons
            r'^bi-[a-zA-Z0-9_-]+$',
            
            # Material Design Icons
            r'^mdi-[a-zA-Z0-9_-]+$',
            
            # Icon fonts génériques
            r'^icon-[a-zA-Z0-9_-]+$',
            
            # Utility classes communes (Tailwind-like)
            r'^[mp][trblxy]?-\d+$',  # margin/padding
            r'^w-\d+$|^h-\d+$',      # width/height
            r'^text-(xs|sm|base|lg|xl|\d+xl)$',  # font sizes
        ]
        
        return any(re.match(pattern, class_name) for pattern in external_patterns)
    
    def find_all_css_files(self) -> List[str]:
        """Trouve tous les fichiers CSS"""
        css_files = []
        
        # Recherche dans les dossiers standards
        patterns = [
            "frontend/**/*.css",
            "src/**/*.css", 
            "assets/**/*.css",
            "styles/**/*.css",
            "public/**/*.css",
            "*.css"
        ]
        
        for pattern in patterns:
            files = glob.glob(pattern, recursive=True)
            css_files.extend(files)
        
        # Déduplication et tri
        return sorted(list(set(css_files)))
    
    def scan_html_js_files(self) -> Dict[str, Set[str]]:
        """Scan INTELLIGENT des fichiers HTML/JS"""
        results = {}
        
        # Extensions à scanner
        extensions = [".html", ".js", ".jsx", ".ts", ".tsx", ".vue"]
        
        all_files = []
        for ext in extensions:
            # Chercher dans frontend/ et racine
            files = glob.glob(f"frontend/**/*{ext}", recursive=True)
            files.extend(glob.glob(f"*{ext}"))
            all_files.extend(files)
        
        print(f"🔍 Scan {len(all_files)} fichiers HTML/JS...")
        
        for file_path in all_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    classes = self.extract_html_classes_intelligent(content, file_path)
                    
                    if classes:
                        results[file_path] = classes
                        self.used_classes.update(classes)
                        self.file_stats[file_path] = len(classes)
                        
            except Exception as e:
                print(f"⚠️  Erreur {file_path}: {str(e)[:50]}...")
        
        return results
    
    def generate_final_report(self):
        """Rapport final ultra-précis"""
        print(f"{colorize('🎨 CSS ANALYZER FINAL - ULTRA-STRICT', Colors.BOLD)}")
        print("=" * 60)
        
        # 1. Scanner tous les CSS
        self.css_files = self.find_all_css_files()
        print(f"📄 CSS Files: {len(self.css_files)}")
        
        for css_file in self.css_files:
            try:
                with open(css_file, 'r', encoding='utf-8') as f:
                    css_content = f.read()
                    file_classes = self.extract_css_classes_strict(css_content, css_file)
                    self.css_classes.update(file_classes)
                    basename = os.path.basename(css_file)
                    print(f"   ✅ {len(file_classes)} classes dans {basename}")
            except Exception as e:
                print(f"   ❌ Erreur {css_file}: {e}")
        
        # 2. Scanner HTML/JS
        html_results = self.scan_html_js_files()
        
        # 3. Analyser les résultats
        orphaned = self.css_classes - self.used_classes
        undefined = self.used_classes - self.css_classes
        
        # 4. Classification PRÉCISE des undefined
        external_libs = set()
        real_errors = set()
        
        for cls in undefined:
            if self.classify_external_libraries(cls):
                external_libs.add(cls)
            else:
                real_errors.add(cls)
        
        # 5. Métriques finales
        total_css = len(self.css_classes)
        total_used = len(self.used_classes)
        coverage = (len(self.used_classes & self.css_classes) / total_css * 100) if total_css else 0
        efficiency = 100 - (len(orphaned) / total_css * 100) if total_css else 0
        
        # === RAPPORT FINAL ===
        print(f"\n{colorize('📊 RÉSULTATS FINAUX ULTRA-PRÉCIS', Colors.BOLD)}")
        print("=" * 50)
        
        print(f"📊 MÉTRIQUES RÉELLES:")
        print(f"   CSS défini: {colorize(str(total_css), Colors.GREEN)}")
        print(f"   HTML utilisé: {colorize(str(total_used), Colors.GREEN)}")
        print(f"   Vraiment utilisé: {colorize(str(len(self.used_classes & self.css_classes)), Colors.GREEN)}")
        print(f"   Orphelines: {colorize(str(len(orphaned)), Colors.RED if orphaned else Colors.GREEN)}")
        
        print(f"\n🔍 CLASSIFICATION UNDEFINED ({len(undefined)} total):")
        print(f"   📚 Libs externes (OK): {colorize(str(len(external_libs)), Colors.BLUE)}")
        print(f"   ❌ Non trouvées: {colorize(str(len(real_errors)), Colors.YELLOW if real_errors else Colors.GREEN)}")
        
        print(f"\n📈 QUALITÉ:")
        print(f"   Couverture: {colorize(f'{coverage:.1f}%', Colors.GREEN)}")
        print(f"   Efficacité: {colorize(f'{efficiency:.1f}%', Colors.GREEN)}")
        
        # Montrer les classes non trouvées
        if real_errors:
            print(f"\n🚨 CLASSES NON TROUVÉES À INVESTIGUER:")
            print(f"    {colorize('Note:', Colors.DIM)} Peuvent être générées dynamiquement ou dans des conditions")
            
            for i, cls in enumerate(sorted(real_errors)[:15], 1):
                origins = self.class_origins.get(cls, ['unknown'])
                origin_file = os.path.basename(origins[0].split(':')[0]) if ':' in origins[0] else origins[0]
                print(f"   {i:2d}. {colorize(f'.{cls}', Colors.YELLOW)} → {colorize(origin_file, Colors.DIM)}")
            
            if len(real_errors) > 15:
                print(f"   ... et {len(real_errors) - 15} autres")
                
            print(f"\n💡 {colorize('CAUSES POSSIBLES:', Colors.BLUE)}")
            print(f"   • Classes générées par JavaScript (conditions, variables)")
            print(f"   • Classes dans des @media queries spécifiques")
            print(f"   • Classes définies dans d'autres fichiers CSS non scannés")
            print(f"   • Classes de frameworks externes non détectées")
            
        else:
            print(f"\n{colorize('✅ AUCUNE CLASSE NON TROUVÉE!', Colors.GREEN)}")
            print(f"    Toutes les classes utilisées sont définies dans vos CSS")
        
        # Classes orphelines
        if orphaned:
            print(f"\n🗑️  CLASSES CSS ORPHELINES (TOP 10):")
            for i, cls in enumerate(sorted(orphaned)[:10], 1):
                print(f"   {i:2d}. {colorize(f'.{cls}', Colors.YELLOW)}")
            
            if len(orphaned) > 10:
                print(f"   ... et {len(orphaned) - 10} autres")
                
            estimated_savings = len(orphaned) * 25  # chars par classe
            print(f"\n💾 Gain possible: ~{estimated_savings:,} caractères")
        else:
            print(f"\n{colorize('✅ AUCUNE CLASSE ORPHELINE!', Colors.GREEN)}")
        
        # Sauvegarder rapport final
        self._save_final_report({
            "total_css_classes": total_css,
            "total_used_classes": total_used,
            "orphaned_classes": sorted(orphaned),
            "external_libraries": sorted(external_libs),
            "classes_not_found": sorted(real_errors),
            "coverage_percentage": round(coverage, 1),
            "efficiency_score": round(efficiency, 1),
            "css_files_analyzed": self.css_files
        })
        
        print(f"\n✅ Rapport sauvegardé: {colorize('css_analysis_final.json', Colors.CYAN)}")
        
        # Recommandation finale
        if len(real_errors) == 0 and len(orphaned) < 10:
            print(f"\n{colorize('🎉 EXCELLENT!', Colors.GREEN + Colors.BOLD)} Votre CSS est très bien optimisé!")
        elif len(real_errors) < 20 and len(orphaned) < 50:
            print(f"\n{colorize('✅ BON NIVEAU!', Colors.GREEN)} CSS globalement bien géré")
            if len(real_errors) > 0:
                print(f"   💡 {len(real_errors)} classes à vérifier (probablement normales)")
            if len(orphaned) > 10:
                print(f"   🧹 {len(orphaned)} classes orphelines à nettoyer")
        else:
            print(f"\n🔧 {colorize('AMÉLIORATIONS POSSIBLES:', Colors.YELLOW)}")
            if len(real_errors) > 20:
                print(f"   1. Investiguer les {len(real_errors)} classes non trouvées")
            if len(orphaned) > 50:
                print(f"   2. Nettoyer les {len(orphaned)} classes orphelines")
    
    def _save_final_report(self, data: Dict):
        """Sauvegarde du rapport final"""
        report = {
            "analysis_metadata": {
                "timestamp": datetime.now().isoformat(),
                "analyzer_version": "FINAL-ULTRA-STRICT-CORRECTED",
                "project": "Fitness Coach Jim",
                "correction_level": "TEMPLATE_STRINGS_SUPPORT"
            },
            "final_results": data,
            "manual_verification_needed": len(data["classes_not_found"]) > 0
        }
        
        with open("css_analysis_final.json", "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

def main():
    analyzer = CSSAnalyzerFinal()
    
    try:
        analyzer.generate_final_report()
        print(f"\n{colorize('✅ Analyse terminée!', Colors.GREEN)}")
    except Exception as e:
        print(f"\n{colorize('❌ Erreur:', Colors.RED)} {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()