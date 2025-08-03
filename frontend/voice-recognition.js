/**
 * 🎤 MODULE DE RECONNAISSANCE VOCALE
 * ================================
 * 
 * Gère le comptage vocal des répétitions pendant l'exercice.
 * Supporte le comptage naturel ("1, 2, 3...") et par mot-clé ("top").
 * 
 * @version 1.0.0
 * @author Assistant
 */

// ===== VARIABLES GLOBALES =====

/**
 * Instance de reconnaissance vocale du navigateur
 * @type {SpeechRecognition|null}
 */
let recognition = null;

/**
 * État de la reconnaissance vocale
 * @type {boolean}
 */
let voiceRecognitionActive = false;

/**
 * Données de comptage vocal de la session courante
 * @type {Object}
 */
let voiceData = {
    count: 0,
    timestamps: [],
    gaps: [],
    lastNumber: 0,
    startTime: null,
    confidence: 1.0
};

// ===== FONCTIONS PRINCIPALES =====

/**
 * Initialise le module de reconnaissance vocale
 * Vérifie la compatibilité du navigateur et configure l'instance
 * 
 * @returns {boolean} true si l'initialisation réussit, false sinon
 */
function initVoiceRecognition() {
    // Vérifier le support de la reconnaissance vocale
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        console.warn('[Voice] Speech Recognition non supportée par ce navigateur');
        return false;
    }
    
    try {
        // Créer l'instance de reconnaissance vocale
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        // Configuration de base
        recognition.lang = 'fr-FR';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        
        // Attacher les gestionnaires d'événements
        recognition.onresult = handleVoiceResult;
        recognition.onerror = handleVoiceError;
        recognition.onend = handleVoiceEnd;
        recognition.onstart = () => {
            console.log('[Voice] Reconnaissance démarrée');
        };
        
        console.log('[Voice] Module initialisé avec succès');
        console.log('[Voice] Langue configurée:', recognition.lang);
        console.log('[Voice] Mode continu:', recognition.continuous);
        
        return true;
        
    } catch (error) {
        console.error('[Voice] Erreur lors de l\'initialisation:', error);
        return false;
    }
}

/**
 * Démarre la reconnaissance vocale pour une nouvelle série
 * Remet à zéro les données et active l'écoute
 * 
 * @returns {void}
 */
function startVoiceRecognition() {
    if (!recognition || voiceRecognitionActive) {
        console.log('[Voice] Reconnaissance non disponible ou déjà active');
        return;
    }
    
    // Réinitialiser les données de comptage
    voiceData = {
        count: 0,
        timestamps: [],
        gaps: [],
        lastNumber: 0,
        startTime: Date.now(),
        confidence: 1.0
    };
    
    try {
        recognition.start();
        voiceRecognitionActive = true;
        
        // Mettre à jour l'interface - icône micro active
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            microIcon.classList.add('active');
        }
        
        console.log('[Voice] Reconnaissance démarrée avec succès');
        
    } catch (error) {
        console.error('[Voice] Erreur au démarrage:', error);
        voiceRecognitionActive = false;
    }
}

/**
 * Arrête la reconnaissance vocale et finalise les données
 * Calcule la confiance finale et nettoie l'état
 * 
 * @returns {void}
 */
function stopVoiceRecognition() {
    if (!recognition || !voiceRecognitionActive) {
        return;
    }
    
    try {
        recognition.stop();
        voiceRecognitionActive = false;
        
        // Calculer la confiance finale basée sur les gaps
        if (voiceData.gaps.length > 0) {
            const gapPenalty = Math.min(voiceData.gaps.length * 0.1, 0.3);
            voiceData.confidence = Math.max(0.6, 1.0 - gapPenalty);
        }
        
        // Mettre à jour l'interface - icône micro inactive
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            microIcon.classList.remove('active');
        }
        
        console.log('[Voice] Reconnaissance arrêtée');
        console.log('[Voice] Données finales:', {
            count: voiceData.count,
            gaps: voiceData.gaps,
            confidence: voiceData.confidence.toFixed(2),
            duration: voiceData.timestamps.length > 0 ? 
                Math.round((voiceData.timestamps[voiceData.timestamps.length - 1]) / 1000) + 's' : '0s'
        });
        
    } catch (error) {
        console.error('[Voice] Erreur lors de l\'arrêt:', error);
        voiceRecognitionActive = false;
    }
}

/**
 * Gestionnaire principal des résultats de reconnaissance
 * Parse les transcripts et identifie les nombres/commandes
 * 
 * @param {SpeechRecognitionEvent} event - Événement de reconnaissance
 * @returns {void}
 */
function handleVoiceResult(event) {
    const result = event.results[event.results.length - 1];
    if (!result.isFinal) return;
    
    const transcript = result[0].transcript.toLowerCase().trim();
    console.log('[Voice] Transcript reçu:', transcript);
    
    // Map complète des nombres français et numériques
    const numbers = {
        'un': 1, '1': 1,
        'deux': 2, '2': 2,
        'trois': 3, '3': 3,
        'quatre': 4, '4': 4,
        'cinq': 5, '5': 5,
        'six': 6, '6': 6,
        'sept': 7, '7': 7,
        'huit': 8, '8': 8,
        'neuf': 9, '9': 9,
        'dix': 10, '10': 10,
        'onze': 11, '11': 11,
        'douze': 12, '12': 12,
        'treize': 13, '13': 13,
        'quatorze': 14, '14': 14,
        'quinze': 15, '15': 15,
        'seize': 16, '16': 16,
        'dix-sept': 17, '17': 17,
        'dix-huit': 18, '18': 18,
        'dix-neuf': 19, '19': 19,
        'vingt': 20, '20': 20
    };
    
    // Détection des nombres - priorité aux correspondances exactes
    for (const [word, number] of Object.entries(numbers)) {
        if (transcript === word || transcript.includes(` ${word} `) || 
            transcript.startsWith(`${word} `) || transcript.endsWith(` ${word}`)) {
            console.log('[Voice] Nombre détecté:', number);
            handleNumberDetected(number);
            return;
        }
    }
    
    // Détection des mots-clés répétitifs
    if (transcript.includes('top') || transcript.includes('hop')) {
        console.log('[Voice] Mot-clé détecté');
        handleKeywordDetected();
        return;
    }
    
    // Détection des commandes de fin
    if (transcript.includes('terminé') || transcript.includes('fini') || 
        transcript.includes('stop') || transcript.includes('fin')) {
        console.log('[Voice] Commande de fin détectée');
        if (typeof window.executeSet === 'function') {
            window.executeSet();
        }
        return;
    }
    
    console.log('[Voice] Transcript non reconnu:', transcript);
}

/**
 * Traite la détection d'un nombre spécifique
 * Gère les gaps et met à jour le compteur
 * 
 * @param {number} number - Nombre détecté (1, 2, 3...)
 * @returns {void}
 */
function handleNumberDetected(number) {
    const now = Date.now();
    
    // Calculer le timestamp relatif au début de l'exercice
    const relativeTimestamp = now - voiceData.startTime;
    
    // Gestion intelligente des gaps (nombres manqués)
    if (number > voiceData.lastNumber + 1) {
        // Nombres manqués détectés
        for (let i = voiceData.lastNumber + 1; i < number; i++) {
            voiceData.gaps.push(i);
        }
        console.log('[Voice] Gaps détectés:', voiceData.gaps);
        
        // Réduire légèrement la confiance
        voiceData.confidence = Math.max(0.7, voiceData.confidence - 0.1);
    }
    
    // Mettre à jour les données de comptage
    voiceData.count = Math.max(voiceData.count, number);
    voiceData.timestamps.push(relativeTimestamp);
    voiceData.lastNumber = number;
    
    console.log('[Voice] Données mises à jour:', {
        count: voiceData.count,
        lastNumber: voiceData.lastNumber,
        gaps: voiceData.gaps,
        confidence: voiceData.confidence
    });
    
    // Mettre à jour l'affichage en temps réel
    updateVoiceDisplay(voiceData.count);
    
    // Feedback haptique si disponible
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

/**
 * Traite la détection d'un mot-clé répétitif
 * Incrémente le compteur sans logique de gaps
 * 
 * @returns {void}
 */
function handleKeywordDetected() {
    const now = Date.now();
    
    // Mode mot-clé : simple incrémentation
    voiceData.count++;
    voiceData.timestamps.push(now - voiceData.startTime);
    voiceData.lastNumber = voiceData.count; // Cohérence avec le mode nombres
    
    console.log('[Voice] Comptage mot-clé:', voiceData.count);
    
    // Mettre à jour l'affichage
    updateVoiceDisplay(voiceData.count);
    
    // Feedback haptique
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

/**
 * Met à jour l'affichage en temps réel du comptage
 * Anime l'UI pour feedback utilisateur
 * 
 * @param {number} count - Nouveau nombre à afficher
 * @returns {void}
 */
function updateVoiceDisplay(count) {
    // Mettre à jour l'affichage principal des répétitions
    const repsElement = document.getElementById('setReps');
    if (repsElement) {
        repsElement.textContent = count;
        repsElement.classList.add('voice-updated');
        
        // Nettoyer l'animation après 300ms
        setTimeout(() => {
            repsElement.classList.remove('voice-updated');
        }, 300);
    }
    
    // Mettre à jour l'indicateur sur l'icône micro si présent
    const indicator = document.querySelector('.voice-indicator');
    if (indicator) {
        indicator.textContent = count;
        indicator.classList.add('pulse');
        
        setTimeout(() => {
            indicator.classList.remove('pulse');
        }, 300);
    } else {
        // Créer l'indicateur s'il n'existe pas
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon && count > 0) {
            const newIndicator = document.createElement('div');
            newIndicator.className = 'voice-indicator pulse';
            newIndicator.textContent = count;
            
            const container = microIcon.parentElement;
            if (container && !container.querySelector('.voice-indicator')) {
                container.appendChild(newIndicator);
                
                setTimeout(() => {
                    newIndicator.classList.remove('pulse');
                }, 300);
            }
        }
    }
    
    console.log('[Voice] Interface mise à jour pour count:', count);
}

/**
 * Gestionnaire d'erreurs de la reconnaissance vocale
 * Gère les erreurs de permissions, réseau, etc.
 * 
 * @param {SpeechRecognitionError} error - Erreur de reconnaissance
 * @returns {void}
 */
function handleVoiceError(error) {
    // TODO: Analyser error.error (no-speech, audio-capture, etc.)
    // TODO: Afficher toast approprié selon le type d'erreur
    // TODO: Désactiver reconnaissance si erreur critique
    // TODO: Log pour debugging
    
    console.log('[Voice] Erreur reconnaissance (placeholder):', error);
}

/**
 * Gestionnaire de fin de reconnaissance vocale
 * Redémarre automatiquement si nécessaire
 * 
 * @returns {void}
 */
function handleVoiceEnd() {
    // TODO: Vérifier si arrêt intentionnel ou accidentel
    // TODO: Redémarrer si encore en EXECUTING state
    // TODO: Log état final
    
    console.log('[Voice] Reconnaissance terminée (placeholder)');
}

// ===== FONCTIONS UTILITAIRES =====

/**
 * Calcule le tempo moyen entre les répétitions
 * Utilisé pour enrichir les données ML
 * 
 * @param {number[]} timestamps - Tableau des timestamps en ms
 * @returns {number|null} Tempo moyen en ms, null si < 2 timestamps
 */
function calculateAvgTempo(timestamps) {
    // TODO: Valider input (au moins 2 timestamps)
    // TODO: Calculer intervalles entre timestamps consécutifs
    // TODO: Retourner moyenne arrondie
    
    console.log('[Voice] Calcul tempo (placeholder):', timestamps);
    return null;
}

/**
 * Valide les données vocales avant envoi
 * Vérifie cohérence et qualité des données
 * 
 * @param {Object} data - Données vocales à valider
 * @returns {boolean} true si données valides
 */
function validateVoiceData(data) {
    // TODO: Vérifier structure obligatoire
    // TODO: Valider cohérence count/timestamps
    // TODO: Vérifier plausibilité des gaps
    // TODO: Calculer score de confiance
    
    console.log('[Voice] Validation données (placeholder):', data);
    return false;
}

// ===== EXPORTS GLOBAUX =====

// Exposer les fonctions principales dans l'objet window
// pour utilisation depuis app.js et autres modules
window.initVoiceRecognition = initVoiceRecognition;
window.startVoiceRecognition = startVoiceRecognition;
window.stopVoiceRecognition = stopVoiceRecognition;

// Exposer variables globales pour debug et monitoring
window.voiceRecognitionActive = () => voiceRecognitionActive;
window.getVoiceData = () => voiceData;

console.log('[Voice] Module voice-recognition.js chargé - Phase 0');