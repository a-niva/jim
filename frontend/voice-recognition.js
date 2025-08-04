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


// OPTIMISATIONS PERFORMANCE
const FRENCH_NUMBERS = new Map([
    ['un', 1], ['1', 1],
    ['deux', 2], ['2', 2], 
    ['trois', 3], ['3', 3],
    ['quatre', 4], ['4', 4],
    ['cinq', 5], ['5', 5],
    ['six', 6], ['6', 6],
    ['sept', 7], ['7', 7],
    ['huit', 8], ['8', 8],
    ['neuf', 9], ['9', 9],
    ['dix', 10], ['10', 10],
    ['onze', 11], ['11', 11],
    ['douze', 12], ['12', 12],
    ['treize', 13], ['13', 13],
    ['quatorze', 14], ['14', 14],
    ['quinze', 15], ['15', 15],
    ['seize', 16], ['16', 16],
    ['dix-sept', 17], ['17', 17],
    ['dix-huit', 18], ['18', 18],
    ['dix-neuf', 19], ['19', 19],
    ['vingt', 20], ['20', 20]
]);

const QUICK_PATTERNS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
const recognitionCache = new Map();

// SYSTÈME DE PRÉDICTION
let predictedNext = 1;
let displayedCount = 0;
let pendingValidation = null;

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
        // ===== NOUVEAU : GESTION DES PERMISSIONS =====
        recognition.start();
        voiceRecognitionActive = true;
        
        // Démarrer le timeout d'auto-validation (Phase 6.3)
        startAutoValidationTimer();
        
        // Mettre à jour l'interface - icône micro active
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            microIcon.classList.add('active');
        }
        
        console.log('[Voice] Reconnaissance démarrée avec succès');
        
    } catch (error) {
        console.error('[Voice] Erreur au démarrage:', error);
        voiceRecognitionActive = false;
        
        // Gestion des erreurs de permissions
        handleVoiceStartupError(error);
    }
}

/**
 * Gère les erreurs de démarrage de la reconnaissance vocale
 */
function handleVoiceStartupError(error) {
    console.error('[Voice] Détail erreur démarrage:', error);
    
    // Désactiver le comptage vocal pour cette session
    voiceRecognitionActive = false;
    
    // Messages explicites selon l'erreur
    if (error.name === 'NotAllowedError' || error.message.includes('permission')) {
        showToast('Permission microphone refusée. Activez-la dans les paramètres du navigateur.', 'error');
        
        // Guide utilisateur
        setTimeout(() => {
            showToast('Chrome: cliquez sur 🔒 dans la barre d\'adresse → Autoriser le microphone', 'info');
        }, 3000);
        
    } else if (error.name === 'NotFoundError') {
        showToast('Aucun microphone détecté sur cet appareil', 'error');
        
    } else if (error.name === 'NotSupportedError') {
        showToast('Reconnaissance vocale non supportée par ce navigateur', 'error');
        
    } else {
        showToast('Erreur microphone. Utilisez le comptage manuel.', 'warning');
    }
    
    // Nettoyer l'interface
    const microIcon = document.querySelector('.voice-toggle-container i');
    if (microIcon) {
        microIcon.classList.remove('active');
    }
}


let autoValidationTimer = null;
let lastVoiceActivityTime = null;

/**
 * Démarre le timer d'auto-validation (30s après dernière activité vocale)
 */
function startAutoValidationTimer() {
    // Nettoyer le timer existant
    if (autoValidationTimer) {
        clearTimeout(autoValidationTimer);
    }
    
    lastVoiceActivityTime = Date.now();
    
    // Timer de 30 secondes
    autoValidationTimer = setTimeout(() => {
        handleAutoValidation();
    }, 30000);
    
    console.log('[Voice] Timer auto-validation démarré (30s)');
}

/**
 * Remet à zéro le timer à chaque activité vocale
 */
function resetAutoValidationTimer() {
    if (!voiceRecognitionActive) return;
    
    lastVoiceActivityTime = Date.now();
    
    // Redémarrer le timer
    if (autoValidationTimer) {
        clearTimeout(autoValidationTimer);
    }
    
    autoValidationTimer = setTimeout(() => {
        handleAutoValidation();
    }, 30000);
    
    console.log('[Voice] Timer auto-validation remis à zéro');
}

/**
 * Gère l'auto-validation après timeout
 */
function handleAutoValidation() {
    if (!voiceRecognitionActive) return;
    
    console.log('[Voice] Timeout atteint - auto-validation');
    
    // Afficher notification discrète
    showToast('Série validée automatiquement (30s sans activité vocale)', 'info');
    
    // Valider avec le compte actuel
    if (voiceData.count > 0) {
        console.log(`[Voice] Auto-validation avec ${voiceData.count} répétitions`);
        
        // Déclencher executeSet() si disponible
        if (typeof executeSet === 'function') {
            executeSet();
        } else {
            console.warn('[Voice] Fonction executeSet non disponible pour auto-validation');
        }
    } else {
        console.log('[Voice] Auto-validation sans comptage - arrêt reconnaissance');
        stopVoiceRecognition();
    }
}

/**
 * Nettoie le timer d'auto-validation
 */
function clearAutoValidationTimer() {
    if (autoValidationTimer) {
        clearTimeout(autoValidationTimer);
        autoValidationTimer = null;
        console.log('[Voice] Timer auto-validation supprimé');
    }
}

/**
 * Démarre la reconnaissance avec système de prédiction initialisé
 */
function startVoiceRecognition() {
    if (!recognition || voiceRecognitionActive) {
        console.log('[Voice] Reconnaissance non disponible ou déjà active');
        return;
    }
    
    // RÉINITIALISATION COMPLÈTE
    voiceData = {
        count: 0,
        timestamps: [],
        gaps: [],
        lastNumber: 0,
        startTime: Date.now(),
        confidence: 1.0
    };
    
    // RÉINITIALISATION PRÉDICTION
    predictedNext = 1;
    displayedCount = 0;
    pendingValidation = null;
    recognitionCache.clear(); // Nettoyer le cache pour cette série
    
    try {
        recognition.start();
        voiceRecognitionActive = true;
        
        // Timer auto-validation (si implémenté)
        if (typeof startAutoValidationTimer === 'function') {
            startAutoValidationTimer();
        }
        
        // UI feedback
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            microIcon.classList.add('active');
        }
        
        console.log('[Voice] Reconnaissance démarrée avec prédiction initialisée');
        
    } catch (error) {
        console.error('[Voice] Erreur au démarrage:', error);
        voiceRecognitionActive = false;
        
        // Gestion d'erreurs (si implémentée)
        if (typeof handleVoiceStartupError === 'function') {
            handleVoiceStartupError(error);
        }
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
    const transcript = result[0].transcript.toLowerCase().trim();
    
    // NOUVELLE LOGIQUE : identifier ce qui a changé
    if (!result.isFinal) {
        // Traitement interim SEULEMENT pour prédiction immédiate
        handleInterimResult(transcript);
    } else {
        // Traitement final SEULEMENT pour validation définitive
        handleFinalResult(transcript);
    }
}


/**
 * Traite les résultats intermédiaires pour affichage immédiat
 */
function handleInterimResult(transcript) {
    // Ne traiter QUE si c'est exactement le nombre prédit
    const cleanTranscript = transcript.trim();
    
    // Parsing rapide pour nombre unique
    const number = parseNumber(cleanTranscript);
    
    if (number && number === predictedNext && !pendingValidation) {
        // Affichage prédictif SEULEMENT si pas déjà en attente
        displayPredictedNumber(number);
    }
}

/**
 * Traite les résultats finaux pour validation définitive
 */
function handleFinalResult(transcript) {
    console.log('[Voice] Final:', transcript);
    
    // Si on a déjà une validation en attente, ignorer si c'est le même
    if (pendingValidation && transcript.includes(pendingValidation.toString())) {
        console.log('[Voice] Validation confirmée via final:', pendingValidation);
        pendingValidation = null;
        return;
    }
    
    // Vérifier cache d'abord
    if (recognitionCache.has(transcript)) {
        const cachedNumber = recognitionCache.get(transcript);
        if (cachedNumber) {
            processValidatedNumber(cachedNumber);
            return;
        }
    }
    
    // Parser le transcript (peut contenir plusieurs nombres)
    const numbers = extractNumbersFromTranscript(transcript);
    
    if (numbers.length > 0) {
        // Prendre le DERNIER nombre (le plus récent)
        const latestNumber = Math.max(...numbers);
        recognitionCache.set(transcript, latestNumber);
        processValidatedNumber(latestNumber);
        return;
    }
    
    // Mots-clés
    if (transcript.includes('top') || transcript.includes('hop')) {
        handleKeywordDetected();
        return;
    }
    
    // Commandes de fin
    if (transcript.includes('terminé') || transcript.includes('fini') || 
        transcript.includes('stop') || transcript.includes('fin')) {
        console.log('[Voice] Commande de fin détectée');
        if (typeof window.executeSet === 'function') {
            window.executeSet();
        }
        return;
    }
}

/**
 * Extrait TOUS les nombres d'un transcript (ex: "1 2 3" -> [1,2,3])
 */
function extractNumbersFromTranscript(transcript) {
    const numbers = [];
    const words = transcript.split(/\s+/);
    
    for (const word of words) {
        const number = parseNumber(word.trim());
        if (number) {
            numbers.push(number);
        }
    }
    
    return numbers.sort((a, b) => a - b); // Tri croissant
}


/**
 * Traite un nombre validé (unifie la logique)
 */
function processValidatedNumber(number) {
    // Éviter le double processing
    if (number === voiceData.count) {
        return; // Déjà traité
    }
    
    handleNumberDetected(number);
}


/**
 * Parse intelligent et optimisé des nombres
 */
function parseNumber(text) {
    if (!text || text.length === 0) return null;
    
    // Nettoyer le texte
    const cleanText = text.trim().toLowerCase();
    
    // Short-circuit pour patterns fréquents
    if (QUICK_PATTERNS.has(cleanText)) {
        return parseInt(cleanText);
    }
    
    // Recherche exacte dans la map française
    if (FRENCH_NUMBERS.has(cleanText)) {
        return FRENCH_NUMBERS.get(cleanText);
    }
    
    // Recherche flexible (contient le mot)
    for (const [word, number] of FRENCH_NUMBERS) {
        if (cleanText === word) {
            return number;
        }
    }
    
    return null;
}

/**
 * Affiche immédiatement le nombre prédit (version silencieuse)
 */
function displayPredictedNumber(number) {
    displayedCount = number;
    pendingValidation = number;
    updateVoiceDisplayImmediate(number);
    updatePrediction(number + 1);
    
    // Log unique et concis
    console.log(`[Voice] Prédit: ${number}`);
}

/**
 * Met à jour la prédiction pour le prochain nombre
 */
function updatePrediction(nextNumber) {
    predictedNext = nextNumber;
    
    // Préparer visuellement (optionnel)
    const repsElement = document.getElementById('setReps');
    if (repsElement) {
        repsElement.setAttribute('data-next', nextNumber);
    }
}

/**
 * Affichage immédiat optimisé (sans animation lourde)
 */
function updateVoiceDisplayImmediate(count) {
    const repsElement = document.getElementById('setReps');
    if (repsElement) {
        repsElement.textContent = count;
        // Animation légère mais immédiate
        repsElement.style.transform = 'scale(1.05)';
        repsElement.style.color = 'var(--primary)';
        
        setTimeout(() => {
            repsElement.style.transform = '';
            repsElement.style.color = '';
        }, 150);
    }
}

/**
 * Traite la détection VALIDÉE d'un nombre
 * Applique la logique de monotonie croissante (pas de retour arrière)
 */
function handleNumberDetected(number) {
    const now = Date.now();
    
    // Monotonie croissante
    if (number <= voiceData.count) {
        console.log(`[Voice] Ignoré: ${number} <= ${voiceData.count}`);
        return;
    }
    
    // Limite anti-erreur
    const maxJump = voiceData.count + 8;
    if (number > maxJump) {
        console.log(`[Voice] Plafonné: ${number} -> ${maxJump}`);
        number = maxJump;
    }
    
    // Gestion des gaps
    const previousCount = voiceData.count;
    if (number > voiceData.count + 1) {
        for (let i = voiceData.count + 1; i < number; i++) {
            voiceData.gaps.push(i);
        }
    }
    
    // Mise à jour des données
    voiceData.count = number;
    voiceData.timestamps.push(now - voiceData.startTime);
    voiceData.lastNumber = number;
    
    // Validation de la prédiction
    if (pendingValidation === number) {
        pendingValidation = null;
    } else {
        updateVoiceDisplay(number);
    }
    
    // Mise à jour prédiction
    updatePrediction(number + 1);
    
    // Feedback
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
    
    // Timer
    if (typeof resetAutoValidationTimer === 'function') {
        resetAutoValidationTimer();
    }
    
    // Log concis UNIQUEMENT
    const gapCount = voiceData.gaps.length;
    console.log(`[Voice] ${previousCount} → ${number}${gapCount > 0 ? ` (${gapCount} gaps)` : ''}`);
}

/**
 * Traite la détection d'un mot-clé avec logique de monotonie
 */
function handleKeywordDetected() {
    const now = Date.now();
    const newCount = voiceData.count + 1;
    
    voiceData.count = newCount;
    voiceData.timestamps.push(now - voiceData.startTime);
    
    updateVoiceDisplay(newCount);
    updatePrediction(newCount + 1);
    
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
    
    if (typeof resetAutoValidationTimer === 'function') {
        resetAutoValidationTimer();
    }
    
    console.log('[Voice] Mot-clé détecté, count:', newCount);
}

/**
 * Met à jour l'affichage avec optimisations performance
 */
function updateVoiceDisplay(count) {
    // Éviter les mises à jour inutiles
    if (displayedCount === count) return;
    
    displayedCount = count;
    
    // Mise à jour principale optimisée
    const repsElement = document.getElementById('setReps');
    if (repsElement) {
        repsElement.textContent = count;
        repsElement.classList.add('voice-updated');
        
        // Cleanup optimisé
        setTimeout(() => {
            repsElement.classList.remove('voice-updated');
        }, 300);
    }
    
    // Indicateur micro
    updateMicroIndicator(count);
}

/**
 * Met à jour l'indicateur micro de façon optimisée
 */
function updateMicroIndicator(count) {
    let indicator = document.querySelector('.voice-indicator');
    
    if (!indicator && count > 0) {
        // Créer seulement si nécessaire
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            indicator = document.createElement('div');
            indicator.className = 'voice-indicator';
            microIcon.parentElement.appendChild(indicator);
        }
    }
    
    if (indicator) {
        // Mise à jour directe
        indicator.textContent = count;
        indicator.classList.add('pulse');
        
        setTimeout(() => {
            indicator.classList.remove('pulse');
        }, 300);
    }
}

/**
 * Gestionnaire d'erreurs de la reconnaissance vocale
 * Gère les erreurs de permissions, réseau, etc.
 * 
 * @param {SpeechRecognitionError} error - Erreur de reconnaissance
 * @returns {void}
 */
function handleVoiceError(event) {
    console.log('[Voice] Erreur de reconnaissance:', event.error);
    
    switch(event.error) {
        case 'no-speech':
            console.log('[Voice] Aucune parole détectée - normal');
            // Ne PAS afficher d'erreur pour no-speech
            break;
        case 'audio-capture':
            console.error('[Voice] Pas de microphone disponible');
            showToast('Microphone non disponible', 'error');
            voiceRecognitionActive = false;
            break;
        case 'not-allowed':
            console.error('[Voice] Permission microphone refusée');
            showToast('Permission microphone refusée', 'error');
            voiceRecognitionActive = false;
            break;
        default:
            console.error('[Voice] Erreur:', event.error);
    }
}

/**
 * Gestionnaire de fin de reconnaissance vocale
 * Redémarre automatiquement si nécessaire
 * 
 * @returns {void}
 */
function handleVoiceEnd() {
    console.log('[Voice] Reconnaissance terminée');
    
    // Redémarrer SEULEMENT si on est toujours en état READY et actif
    if (voiceRecognitionActive && 
        window.workoutState && 
        window.workoutState.current === 'ready') {
        
        // Délai plus long pour éviter l'effet stroboscopique
        setTimeout(() => {
            if (voiceRecognitionActive && recognition) {
                try {
                    recognition.start();
                    console.log('[Voice] Redémarrage silencieux');
                } catch (e) {
                    // Ignorer l'erreur si déjà démarré
                    if (e.name !== 'InvalidStateError') {
                        console.error('[Voice] Erreur redémarrage:', e);
                    }
                }
            }
        }, 500); // 500ms au lieu de 100ms
    }
}

// ===== FONCTIONS UTILITAIRES =====

/**
 * Calcule le tempo moyen entre les répétitions
 * @param {number[]} timestamps - Tableau des timestamps en millisecondes
 * @returns {number|null} - Tempo moyen en millisecondes ou null si insuffisant
 */
function calculateAvgTempo(timestamps) {
    if (!timestamps || timestamps.length < 2) {
        console.log('[Voice] Pas assez de timestamps pour calculer le tempo');
        return null;
    }
    
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
        const interval = timestamps[i] - timestamps[i-1];
        intervals.push(interval);
    }
    
    const avgTempo = Math.round(
        intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
    );
    
    console.log('[Voice] Tempo moyen calculé:', avgTempo, 'ms entre reps');
    return avgTempo;
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
window.calculateAvgTempo = calculateAvgTempo;
console.log('[Voice] Module voice-recognition.js chargé - Phase 0');