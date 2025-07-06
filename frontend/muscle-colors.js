/**
 * Configuration centralisée des couleurs musculaires
 * Synchronisé avec muscle-colors.css
 */

// Configuration complète des couleurs
const MUSCLE_COLORS = {
    // Groupe DOS
    dos: {
        primary: '#3b82f6',
        rgba: '59, 130, 246',
        name: 'Dos',
        muscles: {
            'trapezes': { color: '#5b95f8', name: 'Trapèzes' },
            'grand-dorsal': { color: '#2563eb', name: 'Grand dorsal' },
            'lombaires': { color: '#60a5fa', name: 'Lombaires' }
        }
    },
    
    // Groupe PECTORAUX
    pectoraux: {
        primary: '#ec4899',
        rgba: '236, 72, 153',
        name: 'Pectoraux',
        muscles: {
            'pectoraux-superieurs': { color: '#f472b6', name: 'Pectoraux supérieurs' },
            'pectoraux-inferieurs': { color: '#db2777', name: 'Pectoraux inférieurs' }
        }
    },
    
    // Groupe JAMBES
    jambes: {
        primary: '#10b981',
        rgba: '16, 185, 129',
        name: 'Jambes',
        muscles: {
            'quadriceps': { color: '#34d399', name: 'Quadriceps' },
            'ischio-jambiers': { color: '#059669', name: 'Ischio-jambiers' },
            'fessiers': { color: '#6ee7b7', name: 'Fessiers' },
            'mollets': { color: '#047857', name: 'Mollets' }
        }
    },
    
    // Groupe ÉPAULES
    epaules: {
        primary: '#f59e0b',
        rgba: '245, 158, 11',
        name: 'Épaules',
        muscles: {
            'deltoides-anterieurs': { color: '#fbbf24', name: 'Deltoïdes antérieurs' },
            'deltoides-lateraux': { color: '#f59e0b', name: 'Deltoïdes latéraux' },
            'deltoides-posterieurs': { color: '#d97706', name: 'Deltoïdes postérieurs' }
        }
    },
    
    // Groupe BRAS
    bras: {
        primary: '#8b5cf6',
        rgba: '139, 92, 246',
        name: 'Bras',
        muscles: {
            'biceps': { color: '#a78bfa', name: 'Biceps' },
            'triceps': { color: '#7c3aed', name: 'Triceps' }
        }
    },
    
    // Groupe ABDOMINAUX
    abdominaux: {
        primary: '#ef4444',
        rgba: '239, 68, 68',
        name: 'Abdominaux',
        muscles: {
            'abdominaux': { color: '#f87171', name: 'Abdominaux' },
            'obliques': { color: '#dc2626', name: 'Obliques' }
        }
    }
};

// Mapping pour la compatibilité avec l'ancien système
const MUSCLE_GROUP_MAPPING = {
    // Groupes principaux
    'dos': 'dos',
    'pectoraux': 'pectoraux',
    'jambes': 'jambes',
    'epaules': 'epaules',
    'bras': 'bras',
    'abdominaux': 'abdominaux',
    
    // Muscles spécifiques vers leur groupe
    'trapezes': 'dos',
    'grand-dorsal': 'dos',
    'lombaires': 'dos',
    'pectoraux-superieurs': 'pectoraux',
    'pectoraux-inferieurs': 'pectoraux',
    'quadriceps': 'jambes',
    'ischio-jambiers': 'jambes',
    'fessiers': 'jambes',
    'mollets': 'jambes',
    'deltoides-anterieurs': 'epaules',
    'deltoides-lateraux': 'epaules',
    'deltoides-posterieurs': 'epaules',
    'biceps': 'bras',
    'triceps': 'bras',
    'obliques': 'abdominaux',
    'abdominaux': 'abdominaux'
};

/**
 * Obtenir la couleur d'un muscle ou groupe musculaire
 * @param {string} muscleOrGroup - Nom du muscle ou du groupe
 * @param {boolean} returnRgba - Retourner au format rgba (pour les backgrounds)
 * @returns {string} Couleur hex ou rgba
 */
function getMuscleColor(muscleOrGroup, returnRgba = false) {
    const normalized = muscleOrGroup.toLowerCase().replace(/[éè]/g, 'e');
    
    // Vérifier si c'est un groupe principal
    if (MUSCLE_COLORS[normalized]) {
        return returnRgba 
            ? MUSCLE_COLORS[normalized].rgba 
            : MUSCLE_COLORS[normalized].primary;
    }
    
    // Chercher dans les muscles spécifiques
    const group = MUSCLE_GROUP_MAPPING[normalized];
    if (group && MUSCLE_COLORS[group]) {
        const muscle = MUSCLE_COLORS[group].muscles[normalized];
        if (muscle) {
            return muscle.color;
        }
        // Fallback sur la couleur du groupe
        return returnRgba 
            ? MUSCLE_COLORS[group].rgba 
            : MUSCLE_COLORS[group].primary;
    }
    
    // Couleur par défaut
    return returnRgba ? '148, 163, 184' : '#94a3b8';
}

/**
 * Obtenir le groupe musculaire d'un muscle spécifique
 * @param {string} muscle - Nom du muscle
 * @returns {string} Nom du groupe
 */
function getMuscleGroup(muscle) {
    const normalized = muscle.toLowerCase().replace(/[éè]/g, 'e');
    return MUSCLE_GROUP_MAPPING[normalized] || muscle;
}

/**
 * Obtenir toutes les couleurs pour Chart.js
 * @param {boolean} includeSpecific - Inclure les muscles spécifiques
 * @returns {Object} Objet de couleurs
 */
function getChartColors(includeSpecific = false) {
    const colors = {};
    
    // Ajouter les groupes principaux
    Object.entries(MUSCLE_COLORS).forEach(([key, value]) => {
        colors[key] = value.primary;
        colors[value.name] = value.primary; // Support des noms français
        
        if (includeSpecific) {
            Object.entries(value.muscles).forEach(([muscleKey, muscleData]) => {
                colors[muscleKey] = muscleData.color;
                colors[muscleData.name] = muscleData.color;
            });
        }
    });
    
    return colors;
}

/**
 * Générer un style de background avec opacité
 * @param {string} muscleOrGroup - Nom du muscle ou groupe
 * @param {number} opacity - Opacité (0-1)
 * @returns {string} Style rgba
 */
function getMuscleBackground(muscleOrGroup, opacity = 0.15) {
    const rgba = getMuscleColor(muscleOrGroup, true);
    return `rgba(${rgba}, ${opacity})`;
}

/**
 * Obtenir la classe CSS appropriée
 * @param {string} muscleOrGroup - Nom du muscle ou groupe
 * @param {string} type - Type de classe ('color', 'bg', 'border', 'card')
 * @returns {string} Nom de la classe CSS
 */
function getMuscleClass(muscleOrGroup, type = 'color') {
    const normalized = muscleOrGroup.toLowerCase()
        .replace(/[éè]/g, 'e')
        .replace(/\s+/g, '-');
    
    const group = MUSCLE_GROUP_MAPPING[normalized] || normalized;
    
    switch(type) {
        case 'color':
            return `muscle-color-${group}`;
        case 'bg':
            return `muscle-bg-${group}`;
        case 'bg-light':
            return `muscle-bg-${group}-light`;
        case 'border':
            return `muscle-border-${group}`;
        case 'border-left':
            return `muscle-border-left-${group}`;
        case 'card':
            return `muscle-card-${group}`;
        default:
            return `muscle-color-${group}`;
    }
}

/**
 * Configuration pour les graphiques de volume musculaire
 * @returns {Object} Configuration Chart.js
 */
function getVolumeChartConfig() {
    const colors = getChartColors();
    
    return {
        backgroundColor: Object.values(colors),
        borderColor: Object.values(colors),
        hoverBackgroundColor: Object.values(colors).map(color => color + 'CC'), // 80% opacity
        borderWidth: 2
    };
}

/**
 * Helper pour créer un élément avec les bonnes couleurs
 * @param {string} muscle - Nom du muscle
 * @param {HTMLElement} element - Élément DOM
 * @param {Object} options - Options de style
 */
function applyMuscleStyle(muscle, element, options = {}) {
    const {
        colorType = 'border-left',
        additionalClasses = [],
        useGradient = false
    } = options;
    
    // Nettoyer les anciennes classes
    element.className = element.className.replace(/muscle-\S+/g, '');
    
    // Appliquer la nouvelle classe
    const muscleClass = getMuscleClass(muscle, colorType);
    element.classList.add(muscleClass);
    
    // Ajouter les classes additionnelles
    additionalClasses.forEach(cls => element.classList.add(cls));
    
    // Ajouter un gradient si demandé
    if (useGradient) {
        const color = getMuscleColor(muscle);
        element.style.background = `linear-gradient(to right, ${getMuscleBackground(muscle, 0.05)}, transparent)`;
    }
    
    return element;
}

// Pour compatibilité sans modules ES6
window.MuscleColors = {
    MUSCLE_COLORS,
    MUSCLE_GROUP_MAPPING,
    getMuscleColor,
    getMuscleGroup,
    getChartColors,
    getMuscleBackground,
    getMuscleClass,
    getVolumeChartConfig,
    applyMuscleStyle
};