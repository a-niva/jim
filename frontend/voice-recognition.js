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
 */
let voiceData = {
    count: 0,
    timestamps: [],
    gaps: [],
    lastNumber: 0,
    lastDetected: 0,        // NOUVEAU - dernier nombre explicitement détecté
    startTime: null,
    confidence: 1.0,
    suspiciousJumps: 0,     // NOUVEAU - compteur de sauts suspects (+3)
    repetitions: 0,         // NOUVEAU - compteur de répétitions du même nombre
    needsValidation: false  // NOUVEAU - flag pour forcer validation UI
};


const FRENCH_NUMBERS = new Map([
    // Existant 1-20 (conserver)
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
    ['vingt', 20], ['20', 20],
    ['vingt-et-un', 21], ['21', 21],
    ['vingt-deux', 22], ['22', 22],
    ['vingt-trois', 23], ['23', 23],
    ['vingt-quatre', 24], ['24', 24],
    ['vingt-cinq', 25], ['25', 25],
    ['vingt-six', 26], ['26', 26],
    ['vingt-sept', 27], ['27', 27],
    ['vingt-huit', 28], ['28', 28],
    ['vingt-neuf', 29], ['29', 29],
    ['trente', 30], ['30', 30],
    ['trente-et-un', 31], ['31', 31],
    ['trente-deux', 32], ['32', 32],
    ['trente-trois', 33], ['33', 33],
    ['trente-quatre', 34], ['34', 34],
    ['trente-cinq', 35], ['35', 35],
    ['trente-six', 36], ['36', 36],
    ['trente-sept', 37], ['37', 37],
    ['trente-huit', 38], ['38', 38],
    ['trente-neuf', 39], ['39', 39],
    ['quarante', 40], ['40', 40],
    ['quarante-et-un', 41], ['41', 41],
    ['quarante-deux', 42], ['42', 42],
    ['quarante-trois', 43], ['43', 43],
    ['quarante-quatre', 44], ['44', 44],
    ['quarante-cinq', 45], ['45', 45],
    ['quarante-six', 46], ['46', 46],
    ['quarante-sept', 47], ['47', 47],
    ['quarante-huit', 48], ['48', 48],
    ['quarante-neuf', 49], ['49', 49],
    ['cinquante', 50], ['50', 50]
]);

const QUICK_PATTERNS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

// Niveaux de confiance simplifiés
const CONFIDENCE_LEVELS = {
    HIGH: 0.8,    // Auto-validation 1.5s
    MEDIUM: 0.5   // Quick validation 4s
    // LOW: < 0.5  // Manuel requis
};

// NOUVEAU - Mode preview pour tests (DÉCLARER EN PREMIER)
const DEBUG_MODE = false; // Passer à true pour tester l'interface

// NOUVEAU - Feature toggles avec référence correcte
const VOICE_FEATURES = {
    confidence_system: true,
    validation_ui: true,        // ← Forcer à true (production)
    voice_correction: true,
    auto_validation: true,
    ml_enrichment: true
};

// NOUVEAU - Variables d'état pour la validation
let voiceState = 'LISTENING'; // 'LISTENING' | 'VALIDATING' | 'CONFIRMED'
let validationTimer = null;
// NOUVEAU - Variables pour correction vocale
let correctionMode = false;
let correctionTimer = null;
let passiveListening = false;

// NOUVEAU - Patterns de correction vocale
const CORRECTION_PATTERNS = [
    /correction\s+(\d+)/,           // "correction 15"
    /corriger\s+(\d+)/,             // "corriger 15"  
    /rectifier\s+(\d+)/,            // "rectifier 15"
    /correction\s+(un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix-sept|dix-huit|dix-neuf|vingt|vingt-et-un|vingt-deux|vingt-trois|vingt-quatre|vingt-cinq|vingt-six|vingt-sept|vingt-huit|vingt-neuf|trente|trente-et-un|trente-deux|trente-trois|trente-quatre|trente-cinq|trente-six|trente-sept|trente-huit|trente-neuf|quarante|quarante-et-un|quarante-deux|quarante-trois|quarante-quatre|quarante-cinq|quarante-six|quarante-sept|quarante-huit|quarante-neuf|cinquante)/ // "correction trente-cinq"
];
const recognitionCache = new Map();

// SYSTÈME DE PRÉDICTION
let predictedNext = 1;
let displayedCount = 0;
let pendingValidation = null;


// PHASE 4 - Variables interpolation et validation renforcée
let interpolationInProgress = false;
let interpolationIndex = 0;
let originalGapsArray = [];
let interpolationAnimationSpeed = 300; // ms entre chaque gap

// États validation renforcée
const VALIDATION_LEVELS = {
    STRICT: 'strict',      // Saut max +3, pas de répétitions
    PERMISSIVE: 'permissive' // Mode actuel tolérant
};

let validationMode = VALIDATION_LEVELS.STRICT; // Mode par défaut Phase 4

// États visuels du micro
let currentMicState = 'inactive';

// Met à jour l'état visuel du microphone - {'inactive'|'listening'|'processing'|'error'} state - État du micro
function updateMicrophoneVisualState(state) {
    // Chercher le bouton vocal existant
    const voiceBtn = document.querySelector('.voice-toggle-btn');
    
    if (!voiceBtn) {
        console.warn('[Voice] Bouton vocal introuvable');
        return;
    }
    
    // Retirer toutes les classes d'état précédentes
    voiceBtn.classList.remove('mic-inactive', 'mic-listening', 'mic-processing', 'mic-error');
    
    // Appliquer la nouvelle classe selon l'état
    switch(state) {
        case 'inactive':
            voiceBtn.classList.add('mic-inactive');
            voiceBtn.setAttribute('aria-label', 'Microphone inactif');
            break;
            
        case 'listening':
            voiceBtn.classList.add('mic-listening');
            voiceBtn.setAttribute('aria-label', 'Écoute en cours');
            break;
            
        case 'processing':
            voiceBtn.classList.add('mic-processing');
            voiceBtn.setAttribute('aria-label', 'Traitement en cours');
            break;
            
        case 'error':
            voiceBtn.classList.add('mic-error');
            voiceBtn.setAttribute('aria-label', 'Erreur microphone');
            // Reset après 2 secondes
            setTimeout(() => {
                if (!voiceRecognitionActive) {
                    updateMicrophoneVisualState('inactive');
                } else {
                    updateMicrophoneVisualState('listening');
                }
            }, 2000);
            break;
    }
    
    console.log(`[Voice] État visuel micro: ${state}`);
}

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
    if (!voiceRecognitionActive || executionInProgress) {
        return;
    }
    
    console.log('[Voice] Timeout atteint - auto-validation');
    
    // Marquer l'exécution en cours
    executionInProgress = true;
    
    // Arrêter la reconnaissance
    stopVoiceRecognition();
    
    // Valider avec le compte actuel
    if (voiceData.count > 0) {
        console.log(`[Voice] Auto-validation avec ${voiceData.count} répétitions`);
        
        // Déclencher executeSet() si disponible
        if (typeof window.executeSet === 'function') {
            window.executeSet();
        }
    }
    
    // Reset flag après délai
    setTimeout(() => {
        executionInProgress = false;
    }, 2000);
}

/**
 * Arrête la reconnaissance vocale et finalise les données
 * Version complète avec nettoyage et export global
 */
function stopVoiceRecognition() {
    if (!recognition || !voiceRecognitionActive) {
        console.log('[Voice] Reconnaissance non active');
        return;
    }
    
    try {
        recognition.stop();
        voiceRecognitionActive = false;
        
        // === NOUVEAU : État visuel inactif ===
        updateMicrophoneVisualState('inactive');
        
        // Calculer la confiance finale...
        // [reste du code existant]
        
        // Mettre à jour l'interface - icône micro inactive (legacy)
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            microIcon.classList.remove('active');
        }
        
        // CRUCIAL : Exposer les données finales globalement pour executeSet()
        window.voiceData = voiceData;
        
        console.log('[Voice] Reconnaissance arrêtée');
        console.log('[Voice] Données finales:', {
            count: voiceData.count,
            gaps: voiceData.gaps.length,
            confidence: voiceData.confidence.toFixed(2),
            timestamps: voiceData.timestamps.length
        });
        
    } catch (error) {
        console.error('[Voice] Erreur lors de l\'arrêt:', error);
        updateMicrophoneVisualState('inactive');
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
    
    // RESET COMPLET
    voiceData = {
        count: 0,
        timestamps: [],
        gaps: [],
        lastNumber: 0,
        startTime: Date.now(),
        confidence: 1.0
    };
    
    // Reset flags de protection
    executionInProgress = false;
    predictedNext = 1;
    displayedCount = 0;
    pendingValidation = null;
    recognitionCache.clear();
    
    try {
        recognition.start();
        voiceRecognitionActive = true;
        
        // === NOUVEAU : État visuel micro ===
        updateMicrophoneVisualState('listening');
        
        // Timer auto-validation
        if (typeof startAutoValidationTimer === 'function') {
            startAutoValidationTimer();
        }
        
        // UI feedback (legacy - garder pour compatibilité)
        const microIcon = document.querySelector('.voice-toggle-container i');
        if (microIcon) {
            microIcon.classList.add('active');
        }
        
        // Exposer globalement
        window.voiceData = voiceData;
        
        console.log('[Voice] Reconnaissance démarrée avec prédiction initialisée');
        
    } catch (error) {
        console.error('[Voice] Erreur au démarrage:', error);
        voiceRecognitionActive = false;
        
        // === NOUVEAU : État erreur ===
        updateMicrophoneVisualState('error');
        
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
    
    if (number && number > voiceData.count) {
        handleNumberDetected(number);
    }
}

/**
 * Traite les résultats finaux pour validation définitive
 */
function handleFinalResult(transcript) {
    console.log('[Voice] Final:', transcript);
    
    // Vérifier cache d'abord
    if (recognitionCache.has(transcript)) {
        const cachedNumber = recognitionCache.get(transcript);
        if (cachedNumber) {
            processValidatedNumber(cachedNumber);
            return;
        }
    }
    
    // NOUVEAU : Traiter les suites de nombres correctement
    const numbers = extractNumbersFromTranscript(transcript);
    
    if (numbers.length > 0) {
        // CORRECTION CRITIQUE : Traiter TOUS les nombres en séquence
        for (const number of numbers) {
            // Éviter les doublons avec pendingValidation
            if (number !== pendingValidation) {
                processValidatedNumber(number);
            }
        }
        
        // Mettre en cache le dernier nombre pour ce transcript
        const lastNumber = numbers[numbers.length - 1];
        recognitionCache.set(transcript, lastNumber);
        return;
    }
    
    // Si pendingValidation existe et transcript la contient, valider
    if (pendingValidation && transcript.includes(pendingValidation.toString())) {
        console.log('[Voice] Validation confirmée:', pendingValidation);
        pendingValidation = null;
        return;
    }
    
    // Mots-clés
    if (transcript.includes('top') || transcript.includes('hop')) {
        handleKeywordDetected();
        return;
    }
    
    // Commandes de fin - AVEC PROTECTION ANTI-DOUBLE
    if (transcript.includes('terminé') || transcript.includes('fini') || 
        transcript.includes('stop') || transcript.includes('fin')) {
        handleEndCommand();
        return;
    }
}

let executionInProgress = false; // Flag pour éviter double exécution

/**
 * Gère les commandes de fin avec protection anti-double
 */
function handleEndCommand() {
    if (executionInProgress) {
        console.log('[Voice] Exécution déjà en cours, commande ignorée');
        return;
    }
    
    executionInProgress = true;
    console.log('[Voice] Commande de fin détectée');
    
    // Arrêter la reconnaissance avant executeSet
    if (voiceRecognitionActive) {
        stopVoiceRecognition();
    }
    
    // Déclencher executeSet si disponible
    if (typeof window.executeSet === 'function') {
        window.executeSet();
    }
    
    // Reset flag après délai
    setTimeout(() => {
        executionInProgress = false;
    }, 2000);
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
 * Calcule le niveau de confiance des données vocales
 * Optimisé pour performance - calculs simples
 * 
 * @returns {number} Score de confiance entre 0.1 et 1.0
 */
function calculateConfidence() {
    let score = 1.0;
    
    // PHASE 4 - Pénalité gaps proportionnelle
    if (voiceData.gaps.length > 0) {
        const gapPenalty = Math.min(voiceData.gaps.length * 0.15, 0.4); // Pénalité plus sévère
        score -= gapPenalty;
        console.log(`[Confidence] Pénalité gaps: -${(gapPenalty * 100).toFixed(1)}%`);
    }
    
    // Pénalité sauts suspects
    if (voiceData.suspiciousJumps > 0) {
        const jumpPenalty = Math.min(voiceData.suspiciousJumps * 0.2, 0.3);
        score -= jumpPenalty;
        console.log(`[Confidence] Pénalité sauts suspects: -${(jumpPenalty * 100).toFixed(1)}%`);
    }
    
    // Pénalité répétitions
    if (voiceData.repetitions > 0) {
        const repPenalty = Math.min(voiceData.repetitions * 0.1, 0.2);
        score -= repPenalty;
        console.log(`[Confidence] Pénalité répétitions: -${(repPenalty * 100).toFixed(1)}%`);
    }
    
    // PHASE 4 - Bonus série courte sans problème
    if (voiceData.count <= 15 && voiceData.gaps.length === 0 && voiceData.suspiciousJumps === 0) {
        score += 0.1; // Bonus série propre
        console.log(`[Confidence] Bonus série propre: +10%`);
    }
    
    const finalScore = Math.max(0.1, Math.min(1.0, score));
    console.log(`[Confidence] Score final: ${(finalScore * 100).toFixed(1)}%`);
    
    return finalScore;
}

// ===== PHASE 4 - INTERPOLATION GAPS AVEC ANIMATIONS =====

/**
 * Interpole les gaps manqués avec animations séquentielles
 * Fonction principale d'interpolation Phase 4
 * @returns {Promise<boolean>} true si interpolation acceptée
 */
async function interpolateGapsWithAnimation() {
    if (voiceData.gaps.length === 0 || interpolationInProgress) {
        return true; // Pas de gaps ou déjà en cours
    }
    
    console.log(`[Gaps] Début interpolation: ${voiceData.gaps.length} gaps à combler`);
    
    interpolationInProgress = true;
    originalGapsArray = [...voiceData.gaps]; // Sauvegarde pour rollback
    
    // Trier gaps par ordre croissant
    const sortedGaps = voiceData.gaps.sort((a, b) => a - b);
    
    try {
        // Animation séquentielle de chaque gap
        for (let i = 0; i < sortedGaps.length; i++) {
            interpolationIndex = i;
            const gap = sortedGaps[i];
            
            console.log(`[Gaps] Animation gap ${gap} (${i + 1}/${sortedGaps.length})`);
            
            // Animation visuelle gap comblé
            await showGapInterpolation(gap, sortedGaps.length, i);
            
            // Délai entre animations pour fluidité
            if (i < sortedGaps.length - 1) {
                await new Promise(resolve => setTimeout(resolve, interpolationAnimationSpeed));
            }
        }
        
        // Confirmation utilisateur finale
        const accepted = await confirmGapInterpolation(voiceData.count, voiceData.count - sortedGaps.length, sortedGaps);
        
        if (!accepted) {
            // Rollback vers count original
            rollbackInterpolation();
            return false;
        }
        
        console.log(`[Gaps] Interpolation confirmée: ${voiceData.count} reps finales`);
        return true;
        
    } catch (error) {
        console.error('[Gaps] Erreur interpolation:', error);
        rollbackInterpolation();
        return false;
        
    } finally {
        interpolationInProgress = false;
        interpolationIndex = 0;
    }
}

/**
 * Affiche l'animation pour un gap spécifique
 * @param {number} gapNumber - Numéro gap à combler
 * @param {number} totalGaps - Total gaps à interpoler
 * @param {number} currentIndex - Index progression
 * @returns {Promise<void>}
 */
async function showGapInterpolation(gapNumber, totalGaps, currentIndex) {
    const targetRepEl = document.getElementById('targetRep');
    const targetReps = targetRepEl ? parseInt(targetRepEl.textContent) : 12;
    
    // Animation distincte de l'interface N/R normale
    updateRepDisplayModern(gapNumber, targetReps, {
        interpolating: true,
        interpolationProgress: `${currentIndex + 1}/${totalGaps}`
    });
    
    // Vibration différenciée pour interpolation
    if (navigator.vibrate) {
        navigator.vibrate([50, 30, 50]); // Pattern vibration interpolation
    }
    
    // Log pour debug
    console.log(`[Gaps] Gap ${gapNumber} interpolé visuellement`);
    
    // Attendre fin animation CSS
    await new Promise(resolve => setTimeout(resolve, 200));
}

/**
 * Validation robuste stricte pour Phase 4
 * @param {number} detectedNumber - Nombre détecté
 * @param {Object} context - Contexte détection
 * @returns {Object} Résultat validation
 */
function validateDetectionRobust(detectedNumber, context = {}) {
    const result = {
        valid: true,
        confidence: 1.0,
        action: 'accept',
        errorType: null,
        details: {}
    };
    
    // 1. Validation saut maximum strict
    const jump = detectedNumber - (voiceData.lastDetected || voiceData.count);
    
    if (validationMode === VALIDATION_LEVELS.STRICT) {
        // PHASE 4 : Saut maximum +3 strict
        if (jump > 3) {
            result.valid = false;
            result.errorType = 'jump_too_large';
            result.details = { jump, maxAllowed: 3 };
            result.confidence = 0.1;
            console.log(`[Validation] Saut trop grand: +${jump} > +3 autorisé`);
            return result;
        }
    }
    
    // 2. Détection répétitions stricte
    if (detectedNumber === voiceData.lastDetected) {
        result.valid = false;
        result.errorType = 'repetition';
        result.details = { repeatedNumber: detectedNumber };
        result.confidence = 0.2;
        console.log(`[Validation] Répétition détectée: ${detectedNumber}`);
        return result;
    }
    
    // 3. Validation monotonie croissante
    if (detectedNumber <= voiceData.count) {
        result.valid = false;
        result.errorType = 'backward_count';
        result.details = { detected: detectedNumber, current: voiceData.count };
        result.confidence = 0.1;
        console.log(`[Validation] Compte arrière: ${detectedNumber} <= ${voiceData.count}`);
        return result;
    }
    
    // 4. Calcul confiance selon contexte
    let confidence = 1.0;
    
    if (jump === 3) {
        confidence = 0.7; // Saut suspect mais autorisé
        result.action = 'confirm';
    } else if (jump === 2) {
        confidence = 0.85; // Léger gap normal
    }
    
    // Pénalité si gaps déjà présents
    if (voiceData.gaps.length > 0) {
        confidence -= Math.min(voiceData.gaps.length * 0.05, 0.2);
    }
    
    result.confidence = Math.max(0.3, confidence);
    
    console.log(`[Validation] Nombre ${detectedNumber} validé - Confiance: ${result.confidence.toFixed(2)}`);
    return result;
}

/**
 * Feedback erreur amélioré Phase 4
 * @param {string} errorType - Type erreur détaillé
 * @param {Object} details - Contexte erreur
 */
function enhancedErrorFeedback(errorType, details = {}) {
    // Interface N/R avec erreur spécifique
    const targetRepEl = document.getElementById('targetRep');
    const targetReps = targetRepEl ? parseInt(targetRepEl.textContent) : 12;
    
    const options = {
        voiceError: true,
        errorType: errorType
    };
    
    // Feedback différencié selon type erreur
    switch (errorType) {
        case 'jump_too_large':
            options.errorMessage = `Saut trop grand: +${details.jump}`;
            updateRepDisplayModern(voiceData.count, targetReps, options);
            // Double vibration pour erreur grave
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            break;
            
        case 'repetition':
            options.errorMessage = `Répétition: ${details.repeatedNumber}`;
            updateRepDisplayModern(voiceData.count, targetReps, options);
            // Vibration simple pour répétition
            if (navigator.vibrate) navigator.vibrate(150);
            break;
            
        case 'backward_count':
            options.errorMessage = 'Compte arrière détecté';
            updateRepDisplayModern(voiceData.count, targetReps, options);
            // Triple vibration pour erreur logique
            if (navigator.vibrate) navigator.vibrate([80, 30, 80, 30, 80]);
            break;
            
        default:
            updateRepDisplayModern(voiceData.count, targetReps, options);
            if (navigator.vibrate) navigator.vibrate(100);
    }
    
    console.log(`[Feedback] Erreur ${errorType} signalée visuellement`);
}

// Rollback interpolation en cas d'annulation
function rollbackInterpolation() {
    if (originalGapsArray.length > 0) {
        voiceData.gaps = [...originalGapsArray];
        voiceData.count = voiceData.count - originalGapsArray.length;
        
        // Restaurer interface
        const targetRepEl = document.getElementById('targetRep');
        const targetReps = targetRepEl ? parseInt(targetRepEl.textContent) : 12;
        updateRepDisplayModern(voiceData.count, targetReps);
        
        console.log(`[Gaps] Rollback effectué: count restauré à ${voiceData.count}`);
    }
}

/**
 * Affiche l'interface de validation inline intégrée
 * Version minimaliste sans overlay lourd
 * 
 * @param {number} count - Nombre à valider
 * @param {number} confidence - Score de confiance (0-1)
 */
function showValidationUI(count, confidence) {
    if (!VOICE_FEATURES.validation_ui) {
        console.log('[Voice] Interface validation désactivée');
        return;
    }
    
    const repsElement = document.getElementById('setReps');
    console.log('[Voice] Élément setReps trouvé:', !!repsElement, repsElement);
    
    if (!repsElement) {
        console.warn('[Voice] Élément setReps non trouvé - Interface impossible');
        return;
    }
    
    // Sauvegarder et vérifier le contenu original
    const originalContent = repsElement.textContent;
    repsElement.setAttribute('data-original', originalContent);
    console.log('[Voice] Contenu original sauvé:', originalContent);
    
    // Interface inline minimaliste
    repsElement.innerHTML = `
        <span class="voice-count">${count}</span>
        <div class="quick-actions">
            <button onclick="adjustVoiceCount(-1)" class="adjust-btn">−</button>
            <button onclick="adjustVoiceCount(1)" class="adjust-btn">+</button>
        </div>
    `;
    
    // Vérifier que le contenu a changé
    console.log('[Voice] Nouveau contenu DOM:', repsElement.innerHTML);
    
    // Classe CSS selon niveau de confiance
    const confidenceClass = getConfidenceClass(confidence);
    repsElement.className = confidenceClass;
    console.log('[Voice] Classe CSS appliquée:', confidenceClass);
    
    // Animation discrète
    repsElement.style.transform = 'scale(1.02)';
    repsElement.style.border = '2px solid orange'; // Debug visuel
    setTimeout(() => {
        repsElement.style.transform = '';
    }, 200);
    
    // Timer auto-validation
    startValidationTimer(count);
    
    console.log(`[Voice] Interface validation complète - Count: ${count}, Confiance: ${confidence.toFixed(2)}`);
}

/**
 * Ajuste le count vocal via les boutons +/-
 * Interaction rapide et responsive
 * 
 * @param {number} delta - Changement (-1 ou +1)
 */
function adjustVoiceCount(delta) {
    const countElement = document.querySelector('.voice-count');
    if (!countElement) return;
    
    const currentCount = parseInt(countElement.textContent);
    const newCount = Math.max(0, Math.min(50, currentCount + delta));
    
    // Mise à jour immédiate
    countElement.textContent = newCount;
    voiceData.count = newCount;
    
    // Reset timer sur interaction utilisateur
    resetValidationTimer(newCount);
    
    // Feedback vibration sur mobile
    if (navigator.vibrate) {
        navigator.vibrate(20);
    }
    
    console.log(`[Voice] Count ajusté: ${currentCount} → ${newCount}`);
}

/**
 * Détermine la classe CSS selon le niveau de confiance
 * 
 * @param {number} confidence - Score de confiance (0-1)
 * @returns {string} Nom de classe CSS
 */
function getConfidenceClass(confidence) {
    if (confidence >= CONFIDENCE_LEVELS.HIGH) {
        return 'voice-high-confidence';
    } else if (confidence >= CONFIDENCE_LEVELS.MEDIUM) {
        return 'voice-medium-confidence';
    } else {
        return 'voice-low-confidence';
    }
}

/**
 * Démarre le timer d'auto-validation
 * 
 * @param {number} count - Count à confirmer automatiquement
 */
function startValidationTimer(count) {
    voiceState = 'VALIDATING';
    
    validationTimer = setTimeout(() => {
        confirmVoiceCount(count);
    }, 4000); // 4s pour validation manuelle
}

/**
 * Reset le timer de validation sur interaction utilisateur
 * 
 * @param {number} newCount - Nouveau count après ajustement
 */
function resetValidationTimer(newCount) {
    if (validationTimer) {
        clearTimeout(validationTimer);
    }
    
    // Nouveau timer avec le count ajusté
    validationTimer = setTimeout(() => {
        confirmVoiceCount(newCount);
    }, 2000); // 2s après interaction
}

/**
 * Confirme le count final et nettoie l'interface
 * 
 * @param {number} finalCount - Count définitif
 */
function confirmVoiceCount(finalCount) {
    // NOUVEAU - Empêcher double confirmation
    if (voiceState === 'CONFIRMED') {
        console.log('[Voice] Déjà confirmé, ignore');
        return;
    }
    
    // NOUVEAU - Arrêter écoute passive avant confirmation
    if (VOICE_FEATURES.voice_correction) {
        stopPassiveListening();
    }

    voiceData.count = finalCount;
    voiceState = 'CONFIRMED';
    
    // Nettoyer l'interface
    clearValidationUI();
    
    // Exposer pour executeSet
    window.voiceData = voiceData;
    window.voiceState = voiceState;  // AJOUTER cette ligne
    
    console.log(`[Voice] Count confirmé: ${finalCount} - État: ${voiceState}`);
    
    // Auto-trigger executeSet si activé dans étapes futures
    if (VOICE_FEATURES.auto_validation && typeof window.executeSet === 'function') {
        setTimeout(window.executeSet, 100);
    }
}

/**
 * Nettoie l'interface de validation
 */
function clearValidationUI() {
    const repsElement = document.getElementById('setReps');
    if (!repsElement) return;
    
    // Restaurer contenu original ou afficher count final
    const originalContent = repsElement.getAttribute('data-original');
    repsElement.innerHTML = originalContent || voiceData.count.toString();
    repsElement.className = '';
    repsElement.removeAttribute('data-original');
    
    // Nettoyer timer
    if (validationTimer) {
        clearTimeout(validationTimer);
        validationTimer = null;
    }
    
    voiceState = 'LISTENING';

    // NOUVEAU - Nettoyer écoute passive
    if (VOICE_FEATURES.voice_correction) {
        stopPassiveListening();
    }
}

/**
 * Valide un saut de nombre et détecte les patterns suspects
 * 
 * @param {number} newNumber - Nouveau nombre détecté
 * @param {number} lastDetected - Dernier nombre explicitement détecté
 * @returns {Object} {valid: boolean, suspicious: boolean, reason?: string}
 */
function validateNumberJump(newNumber, lastDetected) {
    const jump = newNumber - lastDetected;
    
    // Validation de base
    if (jump <= 0) {
        return { valid: false, reason: 'Nombre déjà atteint ou en arrière' };
    }
    
    if (jump > 8) {
        return { valid: false, reason: `Saut trop important: +${jump}` };
    }
    
    // Détection de pattern suspect
    const suspicious = jump === 3; // Saut exactement de +3
    
    return { 
        valid: true, 
        suspicious: suspicious,
        jump: jump
    };
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
 * Gère la détection d'un nombre dans la reconnaissance vocale
 * 
 * @param {number} number - Nombre détecté
 * @returns {void}
 */
function handleNumberDetected(number) {
    console.log(`[Voice] Nombre détecté: ${number}`);
    
    // === COMMENTER TEMPORAIREMENT - PHASE 4 ===
    /*
    if (validationMode === VALIDATION_LEVELS.STRICT) {
        const validation = validateWithStrictMode(number, voiceData.lastNumber);
        
        if (!validation.valid) {
            console.warn(`[Voice] Nombre rejeté: ${validation.reason}`);
            
            if (window.applyVoiceErrorState) {
                let errorType = 'generic';
                if (validation.reason.includes('saut')) {
                    errorType = 'jump';
                } else if (validation.reason.includes('répétition')) {
                    errorType = 'repeat';
                } else if (validation.reason.includes('séquence')) {
                    errorType = 'invalid';
                }
                
                window.applyVoiceErrorState(errorType, 1000);
            }
            
            if (navigator.vibrate) {
                navigator.vibrate([50, 50, 50]);
            }
            
            return;
        }
    }
    */
    
    // Validation de base existante
    const expectedNext = voiceData.lastNumber + 1;
    const jump = number - voiceData.lastNumber;
    
    if (jump > 10) {
        console.warn(`[Voice] Saut trop important ignoré: ${voiceData.lastNumber} -> ${number}`);
        voiceData.suspiciousJumps++;
        
        // === NOUVEAU : Feedback erreur saut ===
        if (window.applyVoiceErrorState) {
            window.applyVoiceErrorState('jump', 1500);
        }
        
        return;
    }
    
    // Détection de répétition
    if (number === voiceData.lastNumber && voiceData.count > 0) {
        console.log('[Voice] Répétition détectée');
        voiceData.repetitions++;
        
        if (voiceData.repetitions > 2) {
            console.warn('[Voice] Trop de répétitions - validation requise');
            voiceData.needsValidation = true;
            
            // === NOUVEAU : Feedback erreur répétition ===
            if (window.applyVoiceErrorState) {
                window.applyVoiceErrorState('repeat', 800);
            }
        }
        return;
    }
    
    // Réinitialiser compteur répétitions si nombre différent
    if (number !== voiceData.lastNumber) {
        voiceData.repetitions = 0;
    }
    
    // Gestion des gaps
    if (jump > 1 && jump <= 10) {
        console.log(`[Voice] Gap détecté: ${expectedNext} à ${number-1}`);
        for (let i = expectedNext; i < number; i++) {
            if (!voiceData.gaps.includes(i)) {
                voiceData.gaps.push(i);
            }
        }
        voiceData.needsValidation = true;
    }
    
    // Mise à jour normale
    voiceData.count = number;
    voiceData.lastNumber = number;
    voiceData.timestamps.push(Date.now());
    voiceData.lastDetected = number;
    updateVoiceDisplay(number);
    
    // NOUVEAU - Mettre à jour la prédiction
    predictedNext = number + 1;
    
    console.log(`[Voice] État: count=${voiceData.count}, gaps=[${voiceData.gaps}], confiance=${voiceData.confidence}`);
}

/**
 * Traite les commandes de correction vocale
 * Parse "correction N" avec nombres français et chiffres
 * 
 * @param {string} transcript - Transcription contenant la correction
 * @returns {boolean} true si correction traitée, false sinon
 */
function handleCorrection(transcript) {
    if (!VOICE_FEATURES.voice_correction) {
        return false;
    }
    
    const cleanTranscript = transcript.toLowerCase().trim();
    
    for (const pattern of CORRECTION_PATTERNS) {
        const match = cleanTranscript.match(pattern);
        if (match) {
            const correctionValue = match[1];
            let newCount;
            
            // Parser nombre (chiffre ou mot français)
            if (/^\d+$/.test(correctionValue)) {
                newCount = parseInt(correctionValue);
            } else {
                newCount = FRENCH_NUMBERS.get(correctionValue);
            }
            
            if (newCount !== undefined && newCount >= 0 && newCount <= 50) {
                applyCorrectionCount(newCount);
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Démarre le processus d'auto-validation intelligent
 * Pattern optimisé: Confiance HAUTE → 1.5s, Confiance BASSE → 4s
 */
function scheduleAutoValidation() {
    if (!VOICE_FEATURES.auto_validation) {
        return;
    }
    
    const confidence = calculateConfidence();
    voiceData.confidence = confidence;
    
    if (confidence >= CONFIDENCE_LEVELS.HIGH) {
        // Auto-validation rapide et discrète
        scheduleQuickValidation();
    } else {
        // Validation avec UI et temps supplémentaire
        scheduleStandardValidation();
    }
}

/**
 * Auto-validation rapide pour confiance élevée (1.5s)
 */
function scheduleQuickValidation() {
    voiceState = 'AUTO_VALIDATING';
    
    // Indicateur discret
    showSubtleConfirmation(voiceData.count);
    
    validationTimer = setTimeout(() => {
        confirmFinalCount(voiceData.count);
    }, 1500); // 1.5s pour confiance haute
    
    console.log(`[Voice] Auto-validation rapide programmée - Count: ${voiceData.count}, Confiance: ${voiceData.confidence.toFixed(2)}`);
}

/**
 * Validation standard avec UI pour confiance faible (4s)
 */
function scheduleStandardValidation() {
    voiceState = 'VALIDATING';
    
    // Afficher UI de validation si activée
    if (VOICE_FEATURES.validation_ui) {
        showValidationUI(voiceData.count, voiceData.confidence);
    } else {
        // Mode legacy - simple indicateur
        showSubtleConfirmation(voiceData.count);
    }
    
    validationTimer = setTimeout(() => {
        confirmFinalCount(voiceData.count);
    }, 4000); // 4s pour confiance faible
    
    console.log(`[Voice] Validation standard programmée - Count: ${voiceData.count}, Confiance: ${voiceData.confidence.toFixed(2)}`);
}

/**
 * Affiche une confirmation discrète sans UI lourde
 * 
 * @param {number} count - Count à confirmer
 */
function showSubtleConfirmation(count) {
    const repsElement = document.getElementById('setReps');
    if (!repsElement) return;
    
    // Mise à jour immédiate du count
    repsElement.textContent = count;
    
    // Animation discrète
    repsElement.classList.add('voice-confirming');
    repsElement.style.transform = 'scale(1.02)';
    repsElement.style.color = 'var(--success, #28a745)';
    
    setTimeout(() => {
        repsElement.style.transform = '';
        repsElement.style.color = '';
        repsElement.classList.remove('voice-confirming');
    }, 300);
}

/**
 * Confirme le count final et déclenche executeSet automatiquement
 * 
 * @param {number} finalCount - Count définitif validé
 */
function confirmFinalCount(finalCount) {
    // Enregistrer métriques de validation
    const isAutoValidation = voiceState === 'AUTO_VALIDATING';
    const startTime = voiceData.startTime || Date.now();
    recordValidationMetrics(isAutoValidation, startTime);
        
    // Arrêter écoute passive si active
    if (VOICE_FEATURES.voice_correction) {
        stopPassiveListening();
    }
    
    // Finaliser les données
    voiceData.count = finalCount;
    voiceData.needsValidation = false;
    voiceState = 'CONFIRMED';
    
    // Nettoyer l'interface
    clearValidationUI();
    
    // Exposer globalement pour executeSet
    window.voiceData = voiceData;
    window.voiceState = voiceState;
    // PHASE 4 - Interpolation gaps automatique
    if (voiceData.gaps.length > 0) {
        console.log(`[Gaps] ${voiceData.gaps.length} gaps détectés, démarrage interpolation`);
        
        // Lancer interpolation en arrière-plan
        interpolateGapsWithAnimation()
            .then(accepted => {
                if (accepted) {
                    console.log('[Gaps] Interpolation acceptée, finalisation données');
                    // Recalculer confiance après interpolation
                    voiceData.confidence = calculateConfidence();
                    
                    // Continuer avec validation normale
                    if (VOICE_FEATURES.auto_validation && voiceData.count > 0) {
                        scheduleAutoValidation();
                    } else {
                        window.voiceData = voiceData;
                    }
                } else {
                    console.log('[Gaps] Interpolation rejetée, données rollback');
                    window.voiceData = voiceData;
                }
            })
            .catch(error => {
                console.error('[Gaps] Erreur interpolation:', error);
                window.voiceData = voiceData;
            });
        
        return; // Sortir ici, interpolation gère la suite
    }
    // NOUVEAU - Déclencher executeSet automatiquement
    if (VOICE_FEATURES.auto_validation && typeof window.executeSet === 'function') {
        console.log('[Voice] Déclenchement automatique executeSet()');
        
        // Micro-délai pour fluidité visuelle
        setTimeout(() => {
            window.executeSet();
            
            // Reset état après exécution
            setTimeout(() => {
                resetVoiceState();
            }, 500);
        }, 100);
    }
    
    console.log(`[Voice] Count final confirmé: ${finalCount} - État: ${voiceState}`);
}

/**
 * Remet à zéro l'état vocal après executeSet
 */
function resetVoiceState() {
    voiceState = 'LISTENING';
    voiceData = {
        count: 0,
        timestamps: [],
        gaps: [],
        lastNumber: 0,
        lastDetected: 0,
        startTime: null,
        confidence: 1.0,
        suspiciousJumps: 0,
        repetitions: 0,
        needsValidation: false
    };
    
    // Nettoyer les variables globales
    window.voiceData = null;
    window.voiceState = 'LISTENING';
    
    console.log('[Voice] État vocal réinitialisé');
}

/**
 * Annule la validation vocale en cours
 * Utilisée par transitionTo() pour nettoyer l'état
 */
function cancelVoiceValidation() {
    if (voiceState === 'LISTENING' || voiceState === 'CONFIRMED') {
        return; // Rien à annuler
    }
    
    console.log('[Voice] Annulation validation en cours');
    
    // Nettoyer timers
    if (validationTimer) {
        clearTimeout(validationTimer);
        validationTimer = null;
    }
    
    // Arrêter écoute passive
    if (VOICE_FEATURES.voice_correction) {
        stopPassiveListening();
    }
    
    // Nettoyer interface
    clearValidationUI();
    
    // Reset état
    voiceState = 'LISTENING';
    
    console.log('[Voice] Validation annulée, retour en mode écoute');
}

/**
 * Collecte des métriques UX pour monitoring
 */
const voiceMetrics = {
    validationsTotal: 0,
    validationsAuto: 0,
    validationsManual: 0,
    averageValidationTime: 0,
    confidenceScores: [],
    
    recordValidation: function(isAuto, validationTime, confidence) {
        this.validationsTotal++;
        
        if (isAuto) {
            this.validationsAuto++;
        } else {
            this.validationsManual++;
        }
        
        this.confidenceScores.push(confidence);
        
        // Calculer temps moyen
        const totalTime = this.averageValidationTime * (this.validationsTotal - 1) + validationTime;
        this.averageValidationTime = totalTime / this.validationsTotal;
        
        console.log('[Voice] Métriques:', this.getStats());
    },
    
    getStats: function() {
        const autoRate = this.validationsTotal > 0 ? 
            (this.validationsAuto / this.validationsTotal * 100).toFixed(1) : 0;
        
        const avgConfidence = this.confidenceScores.length > 0 ?
            (this.confidenceScores.reduce((a, b) => a + b, 0) / this.confidenceScores.length).toFixed(2) : 0;
        
        return {
            total: this.validationsTotal,
            autoRate: `${autoRate}%`,
            avgTime: `${this.averageValidationTime.toFixed(1)}s`,
            avgConfidence: avgConfidence
        };
    },
    
    reset: function() {
        this.validationsTotal = 0;
        this.validationsAuto = 0;
        this.validationsManual = 0;
        this.averageValidationTime = 0;
        this.confidenceScores = [];
    }
};

/**
 * Fonction de monitoring intégrée dans confirmFinalCount
 */
function recordValidationMetrics(isAuto, startTime) {
    const validationTime = (Date.now() - startTime) / 1000;
    voiceMetrics.recordValidation(isAuto, validationTime, voiceData.confidence);
}

/**
 * Démarre l'écoute passive pour corrections vocales
 * Optimisé pour préserver la batterie
 */
function startPassiveListening() {
    if (!VOICE_FEATURES.voice_correction || passiveListening || !recognition) {
        return;
    }
    
    // Vérifier l'état avant de démarrer
    if (voiceRecognitionActive) {
        console.log('[Voice] Reconnaissance déjà active, pas de mode passif');
        return;
    }
    
    try {
        // Configuration légère pour écoute passive
        recognition.continuous = true;
        recognition.interimResults = false; // Réduire le processing
        recognition.maxAlternatives = 1;   // Réduire le processing
        
        // Handler spécialisé pour corrections
        recognition.onresult = handlePassiveResult;
        recognition.onerror = handlePassiveError;
        recognition.onend = handlePassiveEnd;
        
        recognition.start();
        passiveListening = true;
        correctionMode = true;
        
        // Timeout automatique pour préserver batterie
        correctionTimer = setTimeout(() => {
            stopPassiveListening();
        }, 10000); // 10s max d'écoute passive
        
        console.log('[Voice] Écoute passive démarrée pour corrections');
        
    } catch (error) {
        console.warn('[Voice] Impossible de démarrer écoute passive:', error.message);
        passiveListening = false;
    }
}

/**
 * Traite les résultats en mode écoute passive
 * 
 * @param {SpeechRecognitionEvent} event
 */
function handlePassiveResult(event) {
    const result = event.results[event.results.length - 1];
    if (!result.isFinal) return;
    
    const transcript = result[0].transcript;
    
    // Traiter uniquement les corrections
    if (handleCorrection(transcript)) {
        // Correction trouvée et appliquée
        return;
    }
    
    // Vérifier commandes d'arrêt
    const lowerTranscript = transcript.toLowerCase();
    if (lowerTranscript.includes('stop') || 
        lowerTranscript.includes('arrêt') || 
        lowerTranscript.includes('terminé')) {
        stopPassiveListening();
    }
}

/**
 * Gère les erreurs en mode passif
 * 
 * @param {SpeechRecognitionError} event
 */
function handlePassiveError(event) {
    if (event.error === 'no-speech' || event.error === 'audio-capture') {
        // Erreurs normales en mode passif - continuer silencieusement
        return;
    }
    
    console.warn('[Voice] Erreur écoute passive:', event.error);
    stopPassiveListening();
}

/**
 * Gère la fin de l'écoute passive
 */
function handlePassiveEnd() {
    if (passiveListening && correctionMode) {
        // Redémarrer automatiquement si mode correction actif
        setTimeout(() => {
            if (correctionMode && passiveListening) {
                try {
                    recognition.start();
                } catch (error) {
                    stopPassiveListening();
                }
            }
        }, 100);
    }
}

/**
 * Arrête l'écoute passive et nettoie les timers
 */
function stopPassiveListening() {
    if (!passiveListening) return;
    
    passiveListening = false;
    correctionMode = false;
    
    if (correctionTimer) {
        clearTimeout(correctionTimer);
        correctionTimer = null;
    }
    
    try {
        if (recognition && voiceRecognitionActive) {
            recognition.stop();
        }
    } catch (error) {
        // Erreur silencieuse
    }
    
    // Restaurer configuration normale
    if (recognition) {
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        recognition.onresult = handleVoiceResult;
        recognition.onerror = handleVoiceError;
        recognition.onend = handleVoiceEnd;
    }
    
    console.log('[Voice] Écoute passive arrêtée');
}

/**
 * Valide les cas limites pour corrections vocales
 * 
 * @param {number} count - Count à valider
 * @returns {Object} {valid: boolean, adjustedCount?: number, reason?: string}
 */
function validateCorrectionCount(count) {
    // Cas limite: correction 0
    if (count === 0) {
        return {
            valid: true,
            adjustedCount: 0,
            reason: 'Reset à zéro autorisé'
        };
    }
    
    // Cas limite: correction > 50
    if (count > 50) {
        return {
            valid: true,
            adjustedCount: 50,
            reason: 'Plafonné à 50 reps maximum'
        };
    }
    
    // Cas limite: correction négative
    if (count < 0) {
        return {
            valid: false,
            reason: 'Count négatif impossible'
        };
    }
    
    // Validation supplémentaire: saut très important
    const currentCount = voiceData.count;
    const jump = Math.abs(count - currentCount);
    
    if (jump > 20) {
        return {
            valid: true,
            adjustedCount: count,
            reason: `Correction importante: ${currentCount} → ${count}`
        };
    }
    
    return { valid: true, adjustedCount: count };
}

/**
 * Version améliorée d'applyCorrectionCount avec validation
 * 
 * @param {number} rawCount - Count brut de la correction
 */
function applyCorrectionCount(rawCount) {
    const validation = validateCorrectionCount(rawCount);
    
    if (!validation.valid) {
        console.warn(`[Voice] Correction rejetée: ${validation.reason}`);
        return;
    }
    
    const newCount = validation.adjustedCount;
    const previousCount = voiceData.count;
    
    // Appliquer la correction
    voiceData.count = newCount;
    
    // Mise à jour interface
    updateCorrectionUI(newCount, previousCount);
    
    // Feedback utilisateur
    if (navigator.vibrate) {
        navigator.vibrate([50, 50, 50]);
    }
    
    // Log avec détails
    const logMessage = validation.reason ? 
        `[Voice] Correction: ${previousCount} → ${newCount} (${validation.reason})` :
        `[Voice] Correction: ${previousCount} → ${newCount}`;
    console.log(logMessage);
    
    // Arrêter écoute passive et confirmer
    stopPassiveListening();
    
    // Confirmation immédiate
    if (VOICE_FEATURES.validation_ui && voiceState === 'VALIDATING') {
        confirmVoiceCount(newCount);
    }
}

/**
 * Applique la correction de count avec feedback utilisateur
 * 
 * @param {number} newCount - Nouveau count corrigé
 */
function applyCorrectionCount(newCount) {
    const previousCount = voiceData.count;
    voiceData.count = newCount;
    
    // Mise à jour interface immédiate
    updateCorrectionUI(newCount, previousCount);
    
    // Feedback utilisateur
    if (navigator.vibrate) {
        navigator.vibrate([50, 50, 50]); // Triple vibration pour correction
    }
    
    // Log de correction
    console.log(`[Voice] Correction appliquée: ${previousCount} → ${newCount}`);
    
    // Arrêter écoute passive et confirmer
    stopPassiveListening();
    
    // Confirmer immédiatement après correction vocale
    if (VOICE_FEATURES.validation_ui && voiceState === 'VALIDATING') {
        confirmVoiceCount(newCount);
    }
}

/**
 * Met à jour l'interface après correction
 * 
 * @param {number} newCount - Nouveau count
 * @param {number} previousCount - Ancien count
 */
function updateCorrectionUI(newCount, previousCount) {
    const repsElement = document.getElementById('setReps');
    if (!repsElement) return;
    
    // Si interface de validation active, mettre à jour
    const voiceCountElement = document.querySelector('.voice-count');
    if (voiceCountElement) {
        voiceCountElement.textContent = newCount;
        
        // Animation de correction
        voiceCountElement.style.background = 'var(--info, #17a2b8)';
        voiceCountElement.style.color = 'white';
        voiceCountElement.style.padding = '0.2rem 0.4rem';
        voiceCountElement.style.borderRadius = '4px';
        voiceCountElement.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
            voiceCountElement.style.background = '';
            voiceCountElement.style.color = '';
            voiceCountElement.style.padding = '';
            voiceCountElement.style.borderRadius = '';
        }, 1000);
    } else {
        // Interface normale
        repsElement.textContent = newCount;
        repsElement.style.color = 'var(--info, #17a2b8)';
        setTimeout(() => {
            repsElement.style.color = '';
        }, 800);
    }
}

/**
 * Traite la détection d'un mot-clé avec logique de monotonie
 */
function handleKeywordDetected() {
    voiceData.count++;
    
    // Mise à jour UI
    updateVoiceDisplayImmediate(voiceData.count);
    
    // Feedback
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
    
    // Reset timer
    if (typeof resetAutoValidationTimer === 'function') {
        resetAutoValidationTimer();
    }
    
    console.log(`[Voice] Keyword → ${voiceData.count}`);
}

/**
 * Met à jour la prédiction pour le prochain nombre
 * 
 * @param {number} nextNumber - Prochain nombre attendu
 */
function updatePrediction(nextNumber) {
    predictedNext = nextNumber;
    
    // Optionnel: indicateur visuel du prochain nombre attendu
    const repsElement = document.getElementById('setReps');
    if (repsElement && predictedNext <= 50) {
        repsElement.setAttribute('data-next', predictedNext);
    }
}

/**
 * Met à jour l'affichage du compteur de répétitions
 * Compatible avec ancienne et nouvelle interface
 * 
 * @param {number} count - Nombre de répétitions détectées
 * @returns {void}
 */
function updateVoiceDisplay(count) {
    // Priorité à l'interface moderne
    if (document.getElementById('repsDisplay')) {
        // Récupérer l'objectif depuis l'interface
        const targetEl = document.getElementById('targetRep');
        const targetReps = targetEl ? parseInt(targetEl.textContent) || 12 : 12;
        
        // Utiliser la fonction moderne
        updateRepDisplayModern(count, targetReps);
        
        // Mettre à jour voiceData
        voiceData.count = count;
        displayedCount = count;
        
        console.log(`[Voice] Affichage moderne mis à jour: ${count}/${targetReps}`);
        return;
    }
    
    // Fallback sur ancienne interface
    const repsElement = document.getElementById('setReps');
    if (!repsElement) {
        console.warn('[Voice] Aucun élément d\'affichage trouvé');
        return;
    }
    
    // Mise à jour simple pour legacy
    repsElement.textContent = count;
    voiceData.count = count;
    displayedCount = count;
    
    console.log(`[Voice] Affichage legacy mis à jour: ${count}`);
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
*/
function handleVoiceError(event) {
    console.log('[Voice] Erreur de reconnaissance:', event.error);
    
    // === NOUVEAU : État visuel erreur ===
    updateMicrophoneVisualState('error');
    
    switch(event.error) {
        case 'no-speech':
            console.log('[Voice] Aucune parole détectée - normal');
            // Ne PAS afficher d'erreur pour no-speech mais reset l'état
            setTimeout(() => {
                if (voiceRecognitionActive) {
                    updateMicrophoneVisualState('listening');
                }
            }, 1000);
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
window.voiceData = voiceData;
window.initVoiceRecognition = initVoiceRecognition;
window.startVoiceRecognition = startVoiceRecognition;
window.stopVoiceRecognition = stopVoiceRecognition;
window.showValidationUI = showValidationUI;
window.adjustVoiceCount = adjustVoiceCount;
window.confirmVoiceCount = confirmVoiceCount;
window.clearValidationUI = clearValidationUI;
window.toggleValidationUI = () => {
    VOICE_FEATURES.validation_ui = !VOICE_FEATURES.validation_ui;
    console.log('[Voice] Validation UI:', VOICE_FEATURES.validation_ui ? 'ACTIVÉE' : 'DÉSACTIVÉE');
};

// Exposer variables globales pour debug et monitoring
window.voiceRecognitionActive = () => voiceRecognitionActive;
window.getVoiceData = () => voiceData;
window.calculateAvgTempo = calculateAvgTempo;
// NOUVEAU - Exposer les fonctions de correction vocale
window.handleCorrection = handleCorrection;
window.startPassiveListening = startPassiveListening;
window.stopPassiveListening = stopPassiveListening;
window.applyCorrectionCount = applyCorrectionCount;

// Debug helpers pour correction
window.testCorrection = (count = 15) => {
    applyCorrectionCount(count);
};

window.toggleCorrectionMode = () => {
    if (passiveListening) {
        stopPassiveListening();
    } else {
        startPassiveListening();
    }
    console.log('[Voice] Mode correction:', passiveListening ? 'ACTIF' : 'INACTIF');
};
// NOUVEAU - Exposer les fonctions d'auto-validation
window.scheduleAutoValidation = scheduleAutoValidation;
window.confirmFinalCount = confirmFinalCount;
window.cancelVoiceValidation = cancelVoiceValidation;
window.resetVoiceState = resetVoiceState;

// NOUVEAU - Exposer métriques pour debug
window.voiceMetrics = voiceMetrics;
window.getVoiceStats = () => voiceMetrics.getStats();
window.resetVoiceStats = () => voiceMetrics.reset();

// Debug helpers pour auto-validation
window.testAutoValidation = (count = 15, confidence = 0.9) => {
    voiceData.count = count;
    voiceData.confidence = confidence;
    voiceData.startTime = Date.now();
    scheduleAutoValidation();
};

window.forceExecuteSet = () => {
    if (typeof window.executeSet === 'function') {
        window.executeSet();
    }
};

// ===== EXPOSITIONS MANQUANTES ÉTAPE 4 =====

// Exposer les constantes
window.VOICE_FEATURES = VOICE_FEATURES;
window.CONFIDENCE_LEVELS = CONFIDENCE_LEVELS;
window.DEBUG_MODE = DEBUG_MODE;

// Exposer les variables d'état
window.voiceState = () => voiceState;
window.validationTimer = () => validationTimer;

// S'assurer que les métriques sont exposées
window.voiceMetrics = voiceMetrics;

// Vérifier que les fonctions auto-validation sont exposées
if (typeof scheduleAutoValidation !== 'undefined') {
    window.scheduleAutoValidation = scheduleAutoValidation;
} else {
    console.warn('[Voice] scheduleAutoValidation non définie');
}

if (typeof scheduleQuickValidation !== 'undefined') {
    window.scheduleQuickValidation = scheduleQuickValidation;
} else {
    console.warn('[Voice] scheduleQuickValidation non définie');
}

if (typeof scheduleStandardValidation !== 'undefined') {
    window.scheduleStandardValidation = scheduleStandardValidation;
} else {
    console.warn('[Voice] scheduleStandardValidation non définie');
}
// === EXPOSITION FONCTIONS PHASE 1 ===
window.updateMicrophoneVisualState = updateMicrophoneVisualState;

console.log('[Voice] ✅ Toutes les expositions globales configurées');

