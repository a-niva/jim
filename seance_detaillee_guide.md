# Guide de la Séance Détaillée avec IA 🤖💪

## Vue d'ensemble

L'interface de séance détaillée offre une expérience complète avec recommandations IA, feedback utilisateur et adaptation en temps réel.

## 🚀 Démarrage d'une Séance

### 1. Fatigue Initiale
Au début de chaque séance, l'application demande votre niveau de fatigue :
- **😎 Très frais** : Prêt pour une séance intense
- **🙂 Frais** : Condition normale
- **😐 Normal** : État moyen
- **😓 Fatigué** : Journée difficile
- **🥵 Très fatigué** : Besoin de réduire l'intensité

Cette information aide l'IA à adapter ses recommandations.

## 🏋️ Interface par Exercice

### Recommandations IA 🤖
Pour chaque série, l'IA analyse :
- **Votre historique** : Performances passées sur cet exercice
- **Fatigue actuelle** : Niveau déclaré + position dans la séance
- **Effort précédent** : Difficulté de la série précédente
- **Temps de repos** : Récupération effectuée
- **Poids disponibles** : Contraintes de votre équipement

#### Affichage des Recommandations
```
🤖 Recommandations IA
Poids suggéré: 22.5kg ↗️ Augmentation
Répétitions: 10 ➡️ Maintien
Fatigue élevée détectée • Repos insuffisant
Confiance: 78%
```

### Ajustement des Paramètres

#### Poids
- **Boutons -2.5/+2.5** : Ajustement rapide
- **Input manuel** : Saisie précise
- **Suggestions IA** : Pré-remplissage automatique

#### Répétitions
- **Boutons -1/+1** : Ajustement fin
- **Recommandations IA** : Basées sur fatigue et objectifs

## 📊 Feedback Utilisateur

### Après Chaque Série

#### 1. Niveau de Fatigue Ressenti
- **1 - Très facile** : Aucun effort, énorme réserve
- **2 - Facile** : Effort léger, bonne réserve
- **3 - Modéré** : Effort normal, quelques reps en réserve
- **4 - Difficile** : Effort important, 1-2 reps maximum
- **5 - Très difficile** : Échec total, impossible de continuer

#### 2. Effort Fourni (Réserve Restante)
- **1 - Énorme réserve** : Pouvais faire 5+ reps de plus
- **2 - Bonne réserve** : 3-4 reps de plus possibles
- **3 - Quelques reps** : 1-2 reps de plus
- **4 - 1-2 reps max** : Presque à l'échec
- **5 - Échec total** : Impossible de faire une rep de plus

## ⏱️ Gestion du Repos

### Temps Adaptatif
Le temps de repos s'ajuste automatiquement selon :
- **Type d'exercice** : Compound vs isolation
- **Intensité** : Facteur de difficulté de l'exercice
- **Fatigue déclarée** : Plus fatigué = plus de repos
- **Effort fourni** : Série difficile = repos prolongé
- **Position dans la séance** : Fatigue cumulative

### Interface de Repos
```
Temps de repos
02:15
████████████░░░░ 75%

Prochaine série : Série 2 - Développé couché

[⏭️ Passer le repos] [⏱️ +30s] [✅ Terminer le repos]
```

### Sons et Alertes 🔊
- **Début repos** : 2 bips de démarrage
- **10 secondes restantes** : 3 bips d'alerte
- **Fin repos** : 4 bips ascendants + vibration

## 🧠 Apprentissage de l'IA

### Données Collectées
L'IA apprend de :
- **Performance réalisée** vs **performance prédite**
- **Contexte de la série** : Position, fatigue, repos
- **Feedback utilisateur** : Fatigue et effort ressentis
- **Réussite/échec** : Série complétée ou non

### Amélioration Continue
Plus vous utilisez l'app, plus les recommandations deviennent précises :
- **0-10 séances** : Recommandations basiques
- **10-50 séances** : Adaptation aux patterns personnels
- **50+ séances** : Prédictions très personnalisées

## 📱 Fonctionnalités Avancées

### Contrôles de Séance
- **⏸️ Pause** : Mettre en pause temporairement
- **🔄 Changer d'exercice** : Mode libre uniquement
- **❌ Abandonner** : Arrêt complet avec sauvegarde
- **✅ Terminer** : Fin normale avec résumé

### Historique en Temps Réel
Visualisation des séries effectuées :
```
Séries effectuées
━━━━━━━━━━━━━━━━━━━━
[1] 20kg × 12 reps    Fatigue: 2/5  Effort: 3/5
[2] 20kg × 10 reps    Fatigue: 3/5  Effort: 4/5
[3] 17.5kg × 8 reps   Fatigue: 4/5  Effort: 4/5
```

### Navigation Série
- **← Série précédente** : Retour si besoin
- **Série suivante →** : Progression normale

## 📊 Résumé de Séance

À la fin, affichage des métriques :
```
Résumé de la séance
━━━━━━━━━━━━━━━━━━━
[12] Séries totales
[285kg] Volume total  
[3] Exercices
[3.2/5] Fatigue moyenne
[3.8/5] Effort moyen

Excellent travail ! 💪
```

## 🎯 Conseils d'Utilisation

### Pour Débuter
1. **Soyez honnête** sur votre fatigue initiale
2. **Suivez les recommandations IA** au début
3. **Donnez un feedback précis** après chaque série

### Pour Progresser
1. **Analysez les patterns** de vos performances
2. **Ajustez selon vos sensations** même si l'IA suggère autre chose
3. **Utilisez l'historique** pour voir votre évolution

### Pour Optimiser
1. **Respectez les temps de repos** adaptatifs
2. **Variez les exercices** pour enrichir les données IA
3. **Soyez régulier** pour des prédictions précises

## 🔧 Dépannage

### Recommandations Étranges
- **Cause** : Données insuffisantes ou contexte inhabituel
- **Solution** : Suivez vos sensations et donnez du feedback

### Sons Non Fonctionnels
- **Cause** : Navigateur bloque l'audio
- **Solution** : Autorisez l'audio dans les paramètres

### Synchronisation Lente
- **Cause** : Connexion Internet faible
- **Solution** : Les données sont sauvegardées localement

## 📈 Évolution et Personnalisation

L'interface s'adapte à votre style :
- **Temps de repos préférés** mémorisés
- **Patterns de fatigue** analysés
- **Progressions typiques** modélisées
- **Équipement optimal** identifié

Plus vous l'utilisez, plus elle devient votre coach personnel ! 🎯