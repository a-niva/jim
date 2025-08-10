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
// Index inversé pour recherche rapide
const NUMBERS_TO_TEXT = new Map();
for (let [text, num] of FRENCH_NUMBERS) {
    if (!NUMBERS_TO_TEXT.has(num)) {
        NUMBERS_TO_TEXT.set(num, []);
    }
    NUMBERS_TO_TEXT.get(num).push(text);
}

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
    ml_enrichment: true,
    passive_mode: true
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

// Cache avec limite de taille
const recognitionCache = new Map();
const MAX_CACHE_SIZE = 100;

function addToCache(key, value) {
    // Limite la taille du cache
    if (recognitionCache.size >= MAX_CACHE_SIZE) {
        const firstKey = recognitionCache.keys().next().value;
        recognitionCache.delete(firstKey);
    }
    recognitionCache.set(key, value);
}

// Debounce pour éviter updates DOM trop fréquentes
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Version debounced de updateRepDisplayModern
// Utiliser la version globale si disponible, sinon créer une version locale
const debouncedVoiceDisplay = window.debouncedUpdateDisplay || debounce((count, target, options) => {
    if (window.updateRepDisplayModern) {
        window.updateRepDisplayModern(count, target, options);
    }
}, 150); // 150ms si pas de version globale


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

// Cache DOM pour éviter querySelector répétitifs
let domCache = {
    voiceContainer: null,
    voiceIcon: null,
    voiceBtn: null,
    currentRepEl: null,
    targetRepEl: null
};

// Gestionnaire centralisé des timers
const timers = {
    validation: null,
    autoValidation: null,
    correction: null,
    
    set(name, timer) {
        this.clear(name);  // Clear ancien timer
        this[name] = timer;
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Timers] ${name} défini`);
    },
    
    clear(timerName) {
        if (this[timerName]) {
            clearTimeout(this[timerName]);
            this[timerName] = null;
        }
    },
    
    clearAll() {
        Object.keys(this).forEach(key => {
            if (typeof this[key] === 'number') {
                clearTimeout(this[key]);
                this[key] = null;
            }
        });
    }
};

// ===== VARIABLES ANDROID =====
const PLATFORM_CONFIG = {
    isAndroid: /Android/i.test(navigator.userAgent),
    android: {
        maxRestarts: 50,        // 30 → 50 (séries plus longues)
        restartDelay: 50,       // 300 → 50 (utiliser cette valeur)
        duplicateWindow: 1500,  // 2000 → 1500 (plus réactif)
        sessionTimeout: 300000, // 180000 → 300000 (5 minutes)
        cleanupDelay: 500
    }
};

let androidRestartCount = 0;
let androidSessionStartTime = 0;
let androidRestartTimer = null;
let androidLastTranscripts = [];

// Système de logs conditionnels
const VOICE_DEBUG_LEVEL = {
    NONE: 0,      // Aucun log
    CRITICAL: 1,  // Erreurs seulement  
    NORMAL: 2,    // Opérations importantes
    VERBOSE: 3    // Tout (debug)
};

// En production : NORMAL, en debug : VERBOSE
let currentDebugLevel = window.location.hostname === 'localhost' ? 
    VOICE_DEBUG_LEVEL.VERBOSE : VOICE_DEBUG_LEVEL.NORMAL;

function voiceLog(level, ...args) {
    if (level <= currentDebugLevel) {
        console.log(...args);
    }
}

// Initialiser le cache une seule fois
function initDOMCache() {
    domCache.voiceContainer = document.getElementById('voiceStatusContainer');
    if (domCache.voiceContainer) {
        domCache.voiceIcon = domCache.voiceContainer.querySelector('#voiceStatusIcon');
        domCache.voiceBtn = domCache.voiceContainer.querySelector('#voiceStatusBtn');
    }
    domCache.currentRepEl = document.getElementById('currentRep');
    domCache.targetRepEl = document.getElementById('targetRep');
}

// Vérifier les permissions au démarrage des séances
async function checkMicrophonePermissions() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return false;
    }
    
    try {
        const result = await navigator.permissions.query({ name: 'microphone' });
        
        if (result.state === 'granted') {
            return true;
        } else if (result.state === 'denied') {
            return false;
        } else {
            return true; // État 'prompt' 
        }
    } catch (e) {
        return true; // Fallback
    }
}

// Masquer l'indicateur micro (appelé en fin de séance)
function hideVoiceStatus() {
    const container = document.getElementById('voiceStatusContainer');
    if (container) {
        container.style.display = 'none';
    }
}

// Exposer globalement
window.hideVoiceStatus = hideVoiceStatus;

// Met à jour l'état visuel du microphone - {'inactive'|'listening'|'processing'|'error'} state - État du micro
// Version optimisée avec cache DOM et RAF
function updateMicrophoneVisualState(state) {
    if (!domCache.voiceContainer) {
        initDOMCache();
        if (!domCache.voiceContainer) return;
    }
    
    // Éviter updates inutiles
    if (currentMicState === state) return;
    
    // Utiliser requestAnimationFrame pour regrouper les updates DOM
    requestAnimationFrame(() => {
        const { voiceContainer, voiceIcon, voiceBtn } = domCache;
        // Reset classes en une seule opération :
        voiceBtn.className = 'voice-status-btn';
        voiceIcon.className = ''; // AJOUTER CETTE LIGNE pour reset complet
                
        // Switch optimisé avec moins d'opérations DOM
        switch(state) {
            case 'inactive':
                voiceIcon.className = 'fas fa-microphone';
                voiceIcon.style.color = '#6b7280';
                voiceBtn.classList.remove('pulse', 'shake', 'shake-error');
                break;
                
            case 'listening':
                voiceIcon.className = 'fas fa-microphone';
                voiceIcon.style.color = '#22c55e';
                voiceBtn.classList.add('pulse'); // Animation sur le bouton
                break;
                
            case 'ready':
                voiceIcon.className = 'fas fa-microphone';
                voiceIcon.style.color = '#3b82f6';
                voiceIcon.style.opacity = '0.8';
                voiceBtn.classList.add('shake');
                break;
                
            case 'error':
                voiceIcon.className = 'fas fa-microphone-slash';
                voiceIcon.style.color = '#ef4444';
                voiceBtn.classList.add('shake-error');
                break;
        }
        
        currentMicState = state;
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] État visuel micro: ${state}`);
    });
}

// ===== FONCTIONS PRINCIPALES =====

/**
 * Initialise le module de reconnaissance vocale
 * Vérifie la compatibilité du navigateur et configure l'instance
 * 
 * @returns {boolean} true si l'initialisation réussit, false sinon
 */
function initVoiceRecognition() {
    // Initialiser le cache DOM dès le début
    initDOMCache();
    // Vérifier le support de la reconnaissance vocale
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        console.warn('[Voice] Speech Recognition non supportée par ce navigateur');
        return false;
    }
    
    try {
        // Créer l'instance de reconnaissance vocale
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
                
        recognition.onstart = () => {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Recognition STARTED', {
                timestamp: new Date().toISOString(),
                continuous: recognition.continuous,
                lang: recognition.lang
            });
        };

        recognition.onspeechstart = () => {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Speech START detected');
        };

        recognition.onspeechend = () => {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Speech END detected');
        };

        recognition.onaudiostart = () => {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Audio START');
        };

        recognition.onaudioend = () => {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Audio END');
        };

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
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance démarrée');
        };
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Module initialisé avec succès');
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Langue configurée:', recognition.lang);
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Mode continu:', recognition.continuous);
        
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
    autotimers.set('validation', setTimeout(() => {
        handleAutoValidation();
    }, 30000));
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Timer auto-validation démarré (30s)');
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
    
    autotimers.set('validation', setTimeout(() => {
        handleAutoValidation();
    }, 30000));
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Timer auto-validation remis à zéro');
}

/**
 * Gère l'auto-validation après timeout
 */
function handleAutoValidation() {
    if (!voiceRecognitionActive || executionInProgress) {
        return;
    }
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Timeout atteint - auto-validation');
    
    // Marquer l'exécution en cours
    executionInProgress = true;
    
    // Arrêter la reconnaissance
    stopVoiceRecognition();
    
    // Valider avec le compte actuel
    if (voiceData.count > 0) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Auto-validation avec ${voiceData.count} répétitions`);
        
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
    if (!voiceRecognitionActive) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance déjà inactive');
        return;
    }
    
    try {
        recognition.stop();
        voiceRecognitionActive = false;
        
        // ÉTAT VISUEL - SOURCE UNIQUE
        updateMicrophoneVisualState('inactive');
        
        // Cleanup timers
        clearAutoValidationTimer();
        timers.clear('correction');
        
        // Calcul confiance finale
        voiceData.confidence = calculateConfidence();
        
        // Exposition pour executeSet
        window.voiceData = voiceData;
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance arrêtée');
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Données finales:', {
            count: voiceData.count,
            confidence: voiceData.confidence.toFixed(2)
        });
        
    } catch (error) {
        console.error('[Voice] Erreur arrêt:', error);
        voiceRecognitionActive = false;
        updateMicrophoneVisualState('inactive');
    }
}

/**
 * Nettoie le timer d'auto-validation
 */
function clearAutoValidationTimer() {
    timers.clear('autoValidation');
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Timer auto-validation supprimé');
}

/**
 * Démarre la reconnaissance avec système de prédiction initialisé
 */
function startVoiceRecognition() {
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Platform check:', {
        isAndroid: PLATFORM_CONFIG?.isAndroid,
        userAgent: navigator.userAgent,
        platformConfigExists: typeof PLATFORM_CONFIG !== 'undefined'
    });
    // PROTECTION RENFORCÉE
    if (voiceRecognitionActive) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance déjà active - état synchronisé');
        updateMicrophoneVisualState('listening'); // Synchroniser visuel
        return true; // ← CRUCIAL : retourner true, pas false
    }
    
    if (!recognition) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Instance manquante, initialisation...');
        const initSuccess = initVoiceRecognition();
        if (!initSuccess || !recognition) {
            console.error('[Voice] Impossible de créer instance recognition');
            updateMicrophoneVisualState('error');
            return false;
        }
    }
    
    // Vérification utilisateur autorise vocal
    if (!currentUser?.voice_counting_enabled) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Comptage vocal désactivé pour cet utilisateur');
        showToast('Comptage vocal désactivé', 'info');
        return false;
    }
    
    // Cleanup modes conflictuels
    passiveListening = false;
    correctionMode = false;
    timers.clear('correction');
    
    // Reset données
    voiceData = {
        count: 0,
        timestamps: [],
        gaps: [],
        lastNumber: 0,
        startTime: Date.now(),
        confidence: 1.0
    };
    
    // Reset flags
    executionInProgress = false;
    predictedNext = 1;
    displayedCount = 0;
    pendingValidation = null;
    if (recognitionCache.size > MAX_CACHE_SIZE / 2) {
        recognitionCache.clear();
    }
    
    try {
        recognition.start();
        voiceRecognitionActive = true;
        // Configuration Android
        if (PLATFORM_CONFIG.isAndroid) {
            androidRestartCount = 0;
            androidSessionStartTime = Date.now();
            androidLastTranscripts = [];
            
            // Informer l'utilisateur
            showToast('Mode Android : redémarrage automatique du micro', 'info');
            
            // Cleanup listeners
            window.addEventListener('beforeunload', cleanupAndroidResources);
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }
                
        // ÉTAT VISUEL - ICI À LA FIN
        updateMicrophoneVisualState('listening');
        
        // Exposer globalement
        window.voiceData = voiceData;
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance démarrée avec succès');
        return true;
        
    } catch (error) {
        console.error('[Voice] Erreur démarrage:', error);
        voiceRecognitionActive = false;
        updateMicrophoneVisualState('error');
        return false;
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
let lastInterimTime = 0;
function handleInterimResult(transcript) {
    // Limiter à 5 updates par seconde max
    const now = Date.now();
    if (now - lastInterimTime < 200) return;
    lastInterimTime = now;
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
    // Détection de doublons Android
    if (PLATFORM_CONFIG.isAndroid && isAndroidDuplicate(transcript)) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Doublon détecté, ignoré:', transcript);
        return;
    }
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Final:', transcript);
    
    // 1. Vérifier cache (existant)
    if (recognitionCache.has(transcript)) {
        const cachedNumber = recognitionCache.get(transcript);
        if (cachedNumber) {
            processValidatedNumber(cachedNumber);
            return;
        }
    }
    
    // 2. PRIORITÉ : Détecter commandes de fin AVANT les nombres
    const hasEndCommand = transcript.includes('terminé') || 
                         transcript.includes('fini') || 
                         transcript.includes('stop') || 
                         transcript.includes('fin');
    
    // 3. Extraire et traiter les nombres
    const numbers = extractNumbersFromTranscript(transcript);
    
    if (numbers.length > 0) {
        // Traiter tous les nombres
        for (const number of numbers) {
            if (number !== pendingValidation) {
                processValidatedNumber(number);
            }
        }
        
        // Mettre en cache le dernier nombre
        const lastNumber = numbers[numbers.length - 1];
        recognitionCache.set(transcript, lastNumber);
    }
    
    // 4. Si commande de fin détectée, la traiter APRÈS les nombres
    if (hasEndCommand) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Commande fin détectée après traitement nombres');
        // Petit délai pour s'assurer que l'UI est à jour
        setTimeout(() => {
            handleEndCommand();
        }, 100);
        return;
    }
    
    // 5. Autres détections (inchangé)
    if (pendingValidation && transcript.includes(pendingValidation.toString())) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation confirmée:', pendingValidation);
        pendingValidation = null;
        return;
    }
    
    if (transcript.includes('top') || transcript.includes('hop')) {
        handleKeywordDetected();
        return;
    }
    
    // Tentative de correction
    if (handleCorrection(transcript)) {
        return;
    }
}

let executionInProgress = false; // Flag pour éviter double exécution

/**
 * Gère les commandes de fin avec protection anti-double
 */
function handleEndCommand() {
    if (executionInProgress) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Fin déjà en cours, ignorer');
        return;
    }
    
    executionInProgress = true;
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Commande de fin détectée');
    
    // Arrêter reconnaissance vocale et calculer confiance finale
    stopVoiceRecognition();
    
    const finalConfidence = calculateConfidence();
    voiceData.confidence = finalConfidence;
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Confiance finale calculée: ${(finalConfidence * 100).toFixed(1)}%`);
    
    // Préparer les données
    voiceData.validated = false; // Important : pas encore validé
    window.voiceData = voiceData;
    window.voiceState = voiceState;
    
    // Décision basée sur confiance ET gaps
    // Tolérer 1 gap si confiance >= 85%, sinon 0 gap
    const acceptableGaps = finalConfidence >= 0.85 ? 1 : 0;
    if (finalConfidence >= 0.8 && voiceData.gaps.length <= acceptableGaps) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Confiance suffisante (${(finalConfidence*100).toFixed(1)}%) et gaps acceptables (${voiceData.gaps.length}/${acceptableGaps}) - Validation automatique`);
        
        // NE PAS marquer comme confirmé ici - laisser confirmFinalCount() le faire
        voiceData.validated = false; // Sera mis à true par confirmFinalCount
        voiceState = 'AUTO_VALIDATING'; // État temporaire
        window.voiceData = voiceData;
        window.voiceState = voiceState;

        // Confirmer et déclencher executeSet automatiquement
        confirmFinalCount(voiceData.count);
                
    } else {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation manuelle requise - Confiance:', finalConfidence.toFixed(2), 'Gaps:', voiceData.gaps.length);
        
        // Afficher modal de validation - PAS DE TIMEOUT !
        voiceState = 'VALIDATING';
        window.voiceState = voiceState;
        
        showValidationModal(voiceData.count, finalConfidence);
        // PAS de setTimeout ici - attendre action utilisateur
    }
    
    // Reset mutex
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

// Calcule le niveau de confiance des données vocales
// Score de confiance entre 0.1 et 1.0
let cachedConfidence = null;
let confidenceInvalidated = true;

function calculateConfidence() {
    // Cache hit si pas d'invalidation
    if (!confidenceInvalidated && cachedConfidence !== null) {
        console.log('[Voice] Confiance depuis cache:', (cachedConfidence * 100).toFixed(1) + '%');
        return cachedConfidence;
    }
    
    let score = 1.0;
    
    // Protection séries trop courtes pour évaluation fiable
    if (voiceData.count < 3) {
        score = 0.8; // Confiance réduite car échantillon insuffisant
        console.log(`[Confidence] Série courte (${voiceData.count} reps) - Confiance limitée: 80%`);
    }
    
    // Pénalité gaps basée sur ratio - RÉALISTE et SÉVÈRE
    if (voiceData.gaps.length > 0 && voiceData.count > 0) {
        const gapRatio = voiceData.gaps.length / voiceData.count;
        const gapPenalty = Math.min(gapRatio * 1.2, 0.9); // Légèrement moins sévère
        score -= gapPenalty;
        console.log(`[Confidence] Gaps: ${voiceData.gaps.length}/${voiceData.count} (${(gapRatio*100).toFixed(1)}%) - Pénalité: -${(gapPenalty * 100).toFixed(1)}%`);
    }
    
    // Pénalité sauts suspects
    if (voiceData.suspiciousJumps > 0) {
        const jumpPenalty = Math.min(voiceData.suspiciousJumps * 0.15, 0.25); // Légèrement réduit
        score -= jumpPenalty;
        console.log(`[Confidence] Pénalité sauts suspects: -${(jumpPenalty * 100).toFixed(1)}%`);
    }
    
    // Pénalité répétitions
    if (voiceData.repetitions > 0) {
        const repPenalty = Math.min(voiceData.repetitions * 0.08, 0.15); // Légèrement réduit
        score -= repPenalty;
        console.log(`[Confidence] Pénalité répétitions: -${(repPenalty * 100).toFixed(1)}%`);
    }
    
    // Bonus tempo régulier
    if (voiceData.timestamps.length >= 3) {
        const avgTempo = calculateAvgTempo(voiceData.timestamps);
        if (avgTempo && avgTempo > 800 && avgTempo < 3000) {
            const tempoBonus = 0.05; // 5% bonus pour tempo régulier
            score += tempoBonus;
            console.log(`[Confidence] Bonus tempo régulier (${avgTempo}ms): +${(tempoBonus * 100).toFixed(1)}%`);
        }
    }
    
    // Borner entre 0.1 et 1.0
    score = Math.max(0.1, Math.min(1.0, score));
    
    // Mettre en cache
    cachedConfidence = score;
    confidenceInvalidated = false;
    
    console.log(`[Confidence] Score final: ${(score * 100).toFixed(1)}%`);
    return score;
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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Gaps] Début interpolation: ${voiceData.gaps.length} gaps à combler`);
    
    interpolationInProgress = true;
    originalGapsArray = [...voiceData.gaps]; // Sauvegarde pour rollback
    
    // Trier gaps par ordre croissant
    const sortedGaps = voiceData.gaps.sort((a, b) => a - b);
    
    try {
        // Animation séquentielle de chaque gap
        for (let i = 0; i < sortedGaps.length; i++) {
            interpolationIndex = i;
            const gap = sortedGaps[i];
            
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Gaps] Animation gap ${gap} (${i + 1}/${sortedGaps.length})`);
            
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
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Gaps] Interpolation confirmée: ${voiceData.count} reps finales`);
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
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Gaps] Gap ${gapNumber} interpolé visuellement`);
    
    // Attendre fin animation CSS
    await new Promise(resolve => setTimeout(resolve, 200));
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
    
    // Utiliser la version globale ou fallback
    const updateDisplay = window.debouncedUpdateDisplay || window.updateRepDisplayModern;
   
    // Feedback différencié selon type erreur
    switch (errorType) {
        case 'jump_too_large':
            options.errorMessage = `Saut trop grand: +${details.jump}`;
            updateDisplay(voiceData.count, targetReps, options);
            // Double vibration pour erreur grave
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            break;
           
        case 'repetition':
            options.errorMessage = `Répétition: ${details.repeatedNumber}`;
            updateDisplay(voiceData.count, targetReps, options);
            // Vibration simple pour répétition
            if (navigator.vibrate) navigator.vibrate(150);
            break;
           
        case 'backward_count':
            options.errorMessage = 'Compte arrière détecté';
            updateDisplay(voiceData.count, targetReps, options);
            // Triple vibration pour erreur logique
            if (navigator.vibrate) navigator.vibrate([80, 30, 80, 30, 80]);
            break;
           
        default:
            updateDisplay(voiceData.count, targetReps, options);
            if (navigator.vibrate) navigator.vibrate(100);
    }
   
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Feedback] Erreur ${errorType} signalée visuellement`);
}

// Rollback interpolation en cas d'annulation
function rollbackInterpolation() {
    if (originalGapsArray.length > 0) {
        voiceData.gaps = [...originalGapsArray];
        voiceData.count = voiceData.count - originalGapsArray.length;
        
        // Restaurer interface
        const targetRepEl = document.getElementById('targetRep');
        const targetReps = targetRepEl ? parseInt(targetRepEl.textContent) : 12;
        debouncedVoiceDisplay(voiceData.count, targetReps);
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Gaps] Rollback effectué: count restauré à ${voiceData.count}`);
    }
}

function showValidationModal(count, confidence) {
    // Nettoyer tout modal existant
    const existingModal = document.getElementById('voice-validation-modal');
    if (existingModal) existingModal.remove();
    
    // Créer overlay
    const overlay = document.createElement('div');
    overlay.id = 'voice-validation-modal';
    overlay.className = 'voice-validation-modal';
    overlay.innerHTML = `
        <div class="voice-modal-content">
            <h3>Valider le nombre de répétitions</h3>
            
            <div class="voice-count-display">
                <button class="count-btn minus" onclick="adjustModalCount(-1)">−</button>
                <span class="count-value" id="modalCount">${count}</span>
                <button class="count-btn plus" onclick="adjustModalCount(1)">+</button>
            </div>
            
            <div class="voice-info">
                <p class="confidence-text">Confiance: ${(confidence * 100).toFixed(0)}%</p>
                ${voiceData.gaps.length > 0 ? 
                    `<p class="gaps-text">Répétitions manquées: ${voiceData.gaps.join(', ')}</p>` : 
                    ''}
            </div>
            
            <div class="modal-actions">
                <button class="btn-validate" onclick="validateVoiceCount()">
                    Valider ${count} répétitions
                </button>
            </div>
            
            <p class="help-text">Ajustez si nécessaire puis validez</p>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Animation d'entrée
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Modal validation affiché - Count: ${count}, Confiance: ${confidence.toFixed(2)}`);
}

// Fonction pour ajuster le count dans le modal
window.adjustModalCount = function(delta) {
    const countEl = document.getElementById('modalCount');
    if (!countEl) return;
    
    let currentCount = parseInt(countEl.textContent);
    let newCount = Math.max(0, Math.min(50, currentCount + delta));
    
    countEl.textContent = newCount;
    
    // Mettre à jour le bouton
    const btnValidate = document.querySelector('.btn-validate');
    if (btnValidate) {
        btnValidate.textContent = `Valider ${newCount} répétitions`;
    }
    
    // Vibration feedback
    if (navigator.vibrate) navigator.vibrate(20);
};

// Fonction pour valider depuis le modal
window.validateVoiceCount = function() {
    const count = parseInt(document.getElementById('modalCount').textContent);
    const modal = document.getElementById('voice-validation-modal');
    
    // Animation de sortie
    modal.classList.remove('visible');
    
    setTimeout(() => {
        modal.remove();
        
        // Confirmer le count
        voiceData.count = count;
        voiceData.validated = true;
        voiceState = 'CONFIRMED';
        window.voiceData = voiceData;
        window.voiceState = voiceState;
        
        confirmFinalCount(count);
        // Déclencher automatiquement executeSet après validation manuelle
        setTimeout(() => {
            if (typeof window.executeSet === 'function') {
                window.executeSet();
            }
        }, 100);
    }, 300);
};

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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Count ajusté: ${currentCount} → ${newCount}`);
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
    
    timers.set('validation', setTimeout(() => {
        confirmVoiceCount(count);
    }, 4000)); // 4s pour validation manuelle
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
    timers.set('validation', setTimeout(() => {
        confirmVoiceCount(newCount);
    }, 2000)); // 2s après interaction
}

/**
 * Confirme le count final et nettoie l'interface
 * 
 * @param {number} finalCount - Count définitif
 */
function confirmVoiceCount(finalCount) {
    // NOUVEAU - Empêcher double confirmation
    if (voiceState === 'CONFIRMED') {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Déjà confirmé, ignore');
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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Count confirmé: ${finalCount} - État: ${voiceState}`);
    
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
    
    // Restaurer contenu original
    const original = repsElement.getAttribute('data-original');
    if (original) {
        repsElement.textContent = original;
        repsElement.removeAttribute('data-original');
    }
    
    // Nettoyer styles
    repsElement.className = '';
    repsElement.style.transform = '';
    repsElement.style.color = '';
    repsElement.style.border = '';
    
    // REMETTRE CACHÉ
    repsElement.style.display = 'none';
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Élément setReps remis en mode caché');
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Interface validation nettoyée');
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
/**
 * Gère la détection d'un nombre dans la reconnaissance vocale
 * VERSION OPTIMISÉE avec gestion gaps intelligente + debouncing + cache confidence
 * 
 * @param {number} number - Nombre détecté
 * @returns {void}
 */
function handleNumberDetected(number) {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Nombre détecté: ${number}`);
    
    // OPT-B : Invalider le cache de confiance
    confidenceInvalidated = true;
    
    // Validation de base existante - INCHANGÉE
    const expectedNext = voiceData.lastNumber + 1;
    const jump = number - voiceData.lastNumber;
    
    if (jump > 10) {
        console.warn(`[Voice] Saut trop important ignoré: ${voiceData.lastNumber} -> ${number}`);
        voiceData.suspiciousJumps++;
        
        // Feedback discret passif
        if (window.showToast) {
            window.showToast(`Saut important détecté (+${jump})`, 'warning');
        }
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }
        return;
    }
    
    // Détection répétition - INCHANGÉE avec feedback discret
    if (number === voiceData.lastNumber && voiceData.count > 0) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Répétition détectée');
        voiceData.repetitions++;
        
        if (voiceData.repetitions > 2) {
            // Feedback discret
            if (window.showToast) {
                window.showToast(`Répétition du ${number}`, 'info');
            }
            if (navigator.vibrate) {
                navigator.vibrate([50, 30, 50]);
            }
        }
        return;
    }
    
    // Reset répétitions - INCHANGÉ
    if (number !== voiceData.lastNumber) {
        voiceData.repetitions = 0;
    }
    
    // OPTIM 6 : Gestion gaps intelligente avec vérification tempo
    if (jump > 1 && jump <= 10) {
        // NOUVEAU : Vérifier tempo avant de marquer comme gap
        const tempo = calculateAvgTempo(voiceData.timestamps);
        if (jump <= 2 && tempo && tempo > 500 && tempo < 2000) {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Gap ignoré (tempo régulier ${tempo}ms): ${expectedNext} à ${number-1}`);
            // Ne pas ajouter aux gaps - comptage régulier détecté
        } else {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Gap détecté: ${expectedNext} à ${number-1}`);
            for (let i = expectedNext; i < number; i++) {
                if (!voiceData.gaps.includes(i)) {
                    voiceData.gaps.push(i);
                }
            }
            voiceData.needsValidation = true;
            
            // Feedback discret seulement
            const newGaps = number - expectedNext;
            if (window.showToast) {
                window.showToast(`${newGaps} répétition${newGaps > 1 ? 's' : ''} sautée${newGaps > 1 ? 's' : ''}`, 'warning');
            }
            if (navigator.vibrate) {
                navigator.vibrate([80, 40, 80]);
            }
        }
    }
    
    // Mise à jour normale - OPTIMISÉE
    voiceData.count = number;
    voiceData.lastNumber = number;
    voiceData.timestamps.push(Date.now());
    voiceData.lastDetected = number;
    
    // OPT-A : Utiliser version debouncée pour éviter reflow DOM excessifs
    debouncedUpdate(number);
    
    predictedNext = number + 1;

    // Mode passif = pas de validation forcée
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] État passif: count=${voiceData.count}, gaps=[${voiceData.gaps}], confiance en cours de calcul...`);
}

function predictMissingNumbers(detectedNumber) {
    const expectedNext = voiceData.count + 1;
    
    // Si on détecte un nombre > expectedNext, remplir automatiquement
    if (detectedNumber > expectedNext) {
        const tempo = calculateAverageTempo();
        const gapSize = detectedNumber - expectedNext;
        
        // Si tempo régulier ET gap raisonnable, auto-remplir
        if (tempo < 2000 && gapSize <= 3) {
            for (let i = expectedNext; i < detectedNumber; i++) {
                handleNumberDetected(i, true); // true = predicted
            }
        }
    }
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
    
    timers.set('validation', setTimeout(() => {
        confirmFinalCount(voiceData.count);
    }, 1500)); // 1.5s pour confiance haute
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Auto-validation rapide programmée - Count: ${voiceData.count}, Confiance: ${voiceData.confidence.toFixed(2)}`);
}

/**
 * Validation standard avec UI pour confiance faible (4s)
 */
function scheduleStandardValidation() {
    voiceState = 'VALIDATING';
    
    // Afficher UI de validation si activée
    if (VOICE_FEATURES.validation_ui) {
        showValidationModal(voiceData.count, voiceData.confidence);
    } else {
        // Mode legacy - simple indicateur
        showSubtleConfirmation(voiceData.count);
    }
    
    timers.set('validation', setTimeout(() => {
        confirmFinalCount(voiceData.count);
    }, 4000)); // 4s pour confiance faible
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Validation standard programmée - Count: ${voiceData.count}, Confiance: ${voiceData.confidence.toFixed(2)}`);
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
    // Empêcher double confirmation
    if (voiceState === 'CONFIRMED' && voiceData.validated) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Déjà confirmé, ignore');
        return;
    }
    
    // Enregistrer métriques de validation
    const isAutoValidation = voiceState === 'AUTO_VALIDATING' || 
                            (voiceData.confidence >= 0.8 && voiceData.gaps.length === 0);
    const startTime = voiceData.startTime || Date.now();
    recordValidationMetrics(isAutoValidation, startTime);
    
    // Arrêter écoute passive si active
    if (VOICE_FEATURES.voice_correction) {
        stopPassiveListening();
    }
    
    // Finaliser les données
    voiceData.count = finalCount;
    voiceData.needsValidation = false;
    voiceData.validated = true; // IMPORTANT: Marquer comme validé
    voiceState = 'CONFIRMED';
    
    // Nettoyer l'interface (modal ou ancienne UI)
    clearValidationUI();
    
    // Fermer le modal si présent
    const modal = document.getElementById('voice-validation-modal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    }
    
    // INTERPOLATION SILENCIEUSE si gaps présents
    if (voiceData.gaps.length > 0) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] ${voiceData.gaps.length} gaps détectés - Calcul interpolation silencieux`);
        
        // Calculer tempo moyen des reps existantes
        const avgTempo = calculateAvgTempo(voiceData.timestamps);
        
        // Créer timestamps interpolés pour analyse ML
        const interpolatedTimestamps = [];
        let lastTime = voiceData.timestamps[0] || voiceData.startTime;
        
        for (let i = 1; i <= voiceData.count; i++) {
            if (voiceData.gaps.includes(i)) {
                // Gap: ajouter timestamp interpolé
                lastTime += avgTempo;
                interpolatedTimestamps.push(lastTime);
            } else {
                // Rep réelle: utiliser timestamp existant
                const prevGaps = voiceData.gaps.filter(g => g < i).length;
                const realIndex = i - prevGaps - 1;
                
                if (realIndex >= 0 && realIndex < voiceData.timestamps.length) {
                    lastTime = voiceData.timestamps[realIndex];
                    interpolatedTimestamps.push(lastTime);
                }
            }
        }
        
        // Stocker les données interpolées pour ML
        voiceData.interpolated_timestamps = interpolatedTimestamps;
        voiceData.tempo_avg_interpolated = calculateAvgTempo(interpolatedTimestamps);
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Interpolation calculée - Tempo interpolé:', voiceData.tempo_avg_interpolated);
    }
    
    // Exposer globalement pour executeSet
    window.voiceData = voiceData;
    window.voiceState = voiceState;
    
    // DÉCISION CRITIQUE : executeSet automatique SEULEMENT si validation auto
    // C'est-à-dire : confiance >= 0.8 ET pas de gaps ET pas depuis modal
    const wasAutoValidation = isAutoValidation && 
                             voiceData.confidence >= 0.8 && 
                             voiceData.gaps.length === 0;
    
    if (wasAutoValidation) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation automatique confirmée - Déclenchement executeSet()');
        
        // Micro-délai pour fluidité visuelle
        setTimeout(() => {
            if (typeof window.executeSet === 'function') {
                window.executeSet();
            }
            
            // Reset état après exécution
            setTimeout(() => {
                resetVoiceState();
            }, 200);
        }, 50);
        
    } else {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation manuelle - Affichage bouton executeSet');
        
        // Pour validation manuelle, juste afficher le bouton
        const executeBtn = document.getElementById('executeSetBtn');
        if (executeBtn) {
            executeBtn.style.display = 'block';
            
            // S'assurer que le bouton garde son apparence normale
            const emoji = executeBtn.querySelector('.go-emoji');
            if (emoji) {
                emoji.textContent = ''; // Garder l'emoji par défaut
            }
        }
    }
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Count final confirmé: ${finalCount} - État: ${voiceState}, Validé: ${voiceData.validated}`);
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
    timers.clearAll(); // Nettoyer tous les timers
    // Nettoyer les variables globales
    window.voiceData = null;
    window.voiceState = 'LISTENING';
}

/**
 * Annule la validation vocale en cours
 * Utilisée par transitionTo() pour nettoyer l'état
 */
function cancelVoiceValidation() {
    if (voiceState === 'LISTENING' || voiceState === 'CONFIRMED') {
        return; // Rien à annuler
    }
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Annulation validation en cours');
    
    // Nettoyer timers
    timers.clear('validation');
    
    // Arrêter écoute passive
    if (VOICE_FEATURES.voice_correction) {
        stopPassiveListening();
    }
    
    // Nettoyer interface
    clearValidationUI();
    
    // Reset état
    voiceState = 'LISTENING';
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation annulée, retour en mode écoute');
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
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Métriques:', this.getStats());
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
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance déjà active, pas de mode passif');
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
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Écoute passive démarrée pour corrections');
        
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
    
    timers.clear('correction');
    
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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Écoute passive arrêtée');
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
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Correction appliquée: ${previousCount} → ${newCount}`);
    
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
    debouncedVoiceDisplay(voiceData.count, voiceData.targetReps || 12, { voiceActive: true });
    
    // Feedback
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
    
    // Reset timer
    if (typeof resetAutoValidationTimer === 'function') {
        resetAutoValidationTimer();
    }
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Keyword → ${voiceData.count}`);
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
        debouncedVoiceDisplay(count, targetReps, { voiceActive: true });
        
        // Mettre à jour voiceData
        voiceData.count = count;
        displayedCount = count;
        
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Affichage moderne mis à jour: ${count}/${targetReps}`);
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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Affichage legacy mis à jour: ${count}`);
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
    // Erreurs ignorables sur Android
    if (PLATFORM_CONFIG.isAndroid) {
        if (event.error === 'no-speech' || event.error === 'aborted') {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Erreur normale, restart automatique');
            return;
        }
    }
    // Gestion spéciale "aborted"
    if (event.error === 'aborted') {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Reconnaissance aborted - transition propre');
        voiceRecognitionActive = false;
        // NE PAS changer l'état visuel pour 'aborted' - éviter confusion
        return;
    }
    
    // Pour toutes les autres erreurs réelles
    voiceRecognitionActive = false;
    updateMicrophoneVisualState('error');
    
    switch(event.error) {
        case 'no-speech':
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Aucune parole détectée - normal');
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
 */
function handleVoiceEnd() {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] ============ handleVoiceEnd START ============');
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] État actuel:', {
        timestamp: new Date().toISOString(),
        voiceActive: voiceRecognitionActive,
        workoutState: window.workoutState?.current,
        isAndroid: PLATFORM_CONFIG?.isAndroid,
        shouldRestart: false // sera calculé
    });
    
    // Comportement spécifique Android
    if (PLATFORM_CONFIG?.isAndroid) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Android détecté, vérification restart...');
        
        const shouldRestart = shouldRestartAndroid();
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] shouldRestartAndroid() =', shouldRestart);
        
        if (shouldRestart) {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Conditions OK, appel handleAndroidRestart()');
            handleAndroidRestart();
            return;
        } else {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Conditions restart NON remplies');
        }
    } else {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Pas Android ou PLATFORM_CONFIG manquant');
    }
    
    // Comportement desktop normal
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] Comportement normal (pas de restart)');
    voiceRecognitionActive = false;
    updateMicrophoneVisualState('inactive');
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] ============ handleVoiceEnd END ============');
}

/**
 * Vérifier si restart Android nécessaire
 */
function shouldRestartAndroid() {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] shouldRestartAndroid() check:', {
        voiceRecognitionActive: voiceRecognitionActive,
        workoutState: window.workoutState?.current,
        visibility: document.visibilityState,
        restartCount: androidRestartCount,
        maxRestarts: PLATFORM_CONFIG?.android?.maxRestarts
    });
    
    const result = voiceRecognitionActive && 
           window.workoutState?.current === 'ready' &&
           document.visibilityState === 'visible' &&
           androidRestartCount < (PLATFORM_CONFIG?.android?.maxRestarts || 30);
           
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] shouldRestartAndroid() result:', result);
    return result;
}

/**
 * Gestion du restart Android
 */
function handleAndroidRestart() {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] handleAndroidRestart() APPELÉ', {
        restartCount: androidRestartCount,
        sessionStartTime: androidSessionStartTime,
        currentTime: Date.now()
    });
    
    // Vérifications de sécurité
    if (androidRestartCount >= PLATFORM_CONFIG.android.maxRestarts) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Limite de restarts atteinte');
        stopVoiceRecognitionWithReason('Limite de redémarrages atteinte');
        return;
    }
    
    const sessionDuration = Date.now() - androidSessionStartTime;
    if (sessionDuration > PLATFORM_CONFIG.android.sessionTimeout) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Timeout session atteint');
        stopVoiceRecognitionWithReason('Session expirée');
        return;
    }
    
    // Préserver l'état
    const preservedState = {
        count: voiceData.count || 0,
        timestamps: voiceData.timestamps ? [...voiceData.timestamps] : [],
        gaps: voiceData.gaps ? [...voiceData.gaps] : [],
        lastNumber: voiceData.lastNumber || 0,
        confidence: voiceData.confidence || 1
    };
    
    androidRestartCount++;
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Android] Restart #${androidRestartCount}`);
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] État préservé:', preservedState);
    
    // NE PAS toucher à voiceRecognitionActive ici !
    // Le micro est encore techniquement actif du point de vue de l'API
    
    // Restart immédiat sans délai
    try {
        // D'abord restaurer l'état
        Object.assign(voiceData, preservedState);
        window.voiceData = voiceData;
        
        // Puis restart direct
        recognition.stop();
        
        // Petit délai pour laisser l'API respirer
        setTimeout(() => {
            try {
                recognition.start();
                voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Restart réussi, état restauré');
                
                // Garder l'interface synchronisée
                updateMicrophoneVisualState('listening');
                
            } catch (e) {
                console.error('[Android] Erreur au restart:', e);
                voiceRecognitionActive = false;
                updateMicrophoneVisualState('inactive');
            }
        }, 20);
        
    } catch (error) {
        console.error('[Android] Erreur:', error);
        voiceRecognitionActive = false;
        updateMicrophoneVisualState('inactive');
    }
}

/**
 * Arrêt avec raison
 */
function stopVoiceRecognitionWithReason(reason) {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Arrêt:', reason);
    
    if (window.showToast) {
        window.showToast(`Micro arrêté : ${reason}`, 'warning');
    }
    
    cleanupAndroidResources();
    stopVoiceRecognition();
}

/**
 * Cleanup ressources Android
 */
function cleanupAndroidResources() {
    // Cleanup timers
    if (androidRestartTimer) {
        clearTimeout(androidRestartTimer);
        androidRestartTimer = null;
    }
    
    // Reset compteurs
    androidRestartCount = 0;
    androidLastTranscripts = [];
    
    // NOUVEAU : Reset cache et état vocal
    if (recognitionCache) {
        recognitionCache.clear();
    }
    
    // Reset voiceData complet
    voiceData = {
        count: 0,
        timestamps: [],
        gaps: [],
        lastNumber: 0,
        confidence: 1.0
    };
    
    // Reset flags de cache
    cachedConfidence = null;
    confidenceInvalidated = true;
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Cleanup complet effectué');
}

/**
 * Gestion visibilité page
 */
function handleVisibilityChange() {
    if (document.visibilityState === 'hidden' && PLATFORM_CONFIG.isAndroid) {
        if (androidRestartTimer) {
            clearTimeout(androidRestartTimer);
            androidRestartTimer = null;
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Page cachée, restarts suspendus');
        }
    }
}

/**
 * Détection de doublons Android
 */
// Version optimisée O(1)
let duplicateCache = new Set();

function isAndroidDuplicate(transcript) {
    const now = Date.now();
    const timeWindow = Math.floor(now / 1000); // Fenêtre 1 seconde
    const cacheKey = `${transcript.toLowerCase().trim()}_${timeWindow}`;
    
    if (duplicateCache.has(cacheKey)) {
        return true;
    }
    
    duplicateCache.add(cacheKey);
    
    // Cleanup toutes les 10 secondes
    if (duplicateCache.size > 20) {
        duplicateCache.clear();
    }
    
    return false;
}


// ===== FONCTIONS UTILITAIRES =====

/**
 * Calcule le tempo moyen entre les répétitions
 * @param {number[]} timestamps - Tableau des timestamps en millisecondes
 * @returns {number|null} - Tempo moyen en millisecondes ou null si insuffisant
 */
function calculateAvgTempo(timestamps) {
    if (!timestamps || timestamps.length < 2) {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Pas assez de timestamps pour calculer le tempo');
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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Tempo moyen calculé:', avgTempo, 'ms entre reps');
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
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation données (placeholder):', data);
    return false;
}

/**
 * Collecte l'état de santé du système vocal pour monitoring
 */
function getVoiceSystemHealth() {
    return {
        // État système
        speechRecognitionSupported: !!window.SpeechRecognition || !!window.webkitSpeechRecognition,
        voiceRecognitionActive: voiceRecognitionActive,
        userVoiceEnabled: currentUser?.voice_counting_enabled || false,
        workoutState: workoutState.current,
        
        // État DOM
        voiceContainer: !!document.getElementById('voiceStatusContainer'),
        voiceIcon: !!document.querySelector('#voiceStatusIcon'),
        
        // État données
        currentMicState: currentMicState,
        voiceDataCount: voiceData?.count || 0,
        
        // Permissions
        microphonePermission: 'unknown' // sera mis à jour par checkMicrophonePermissions
    };
}


/**
 * Valide la cohérence du système vocal
 */
function validateVoiceSystemCoherence() {
    const health = getVoiceSystemHealth();
    const issues = [];
    
    // Vérifications cohérence
    if (health.recognitionActive && health.currentState === 'LISTENING' && health.timersActive === 0) {
        issues.push('Recognition active mais aucun timer');
    }
    
    if (health.memoryUsage > 100) {
        issues.push('Cache recognition surchargé');
    }
    
    if (issues.length > 0) {
        console.warn('[Voice] Issues détectées:', issues);
    }
    
    return { healthy: issues.length === 0, issues };
}


// ===== DEBUG ANDROID =====
window.getAndroidVoiceStats = function() {
    if (!PLATFORM_CONFIG.isAndroid) {
        return { platform: 'desktop', message: 'Pas de stats Android' };
    }
    
    const sessionDuration = Date.now() - androidSessionStartTime;
    
    return {
        platform: 'Android',
        restartCount: androidRestartCount,
        maxRestarts: PLATFORM_CONFIG.android.maxRestarts,
        sessionDuration: Math.round(sessionDuration / 1000) + 's',
        duplicatesInCache: androidLastTranscripts.length,
        currentState: voiceRecognitionActive ? 'active' : 'inactive',
        workoutState: window.workoutState?.current,
        voiceData: {
            count: voiceData?.count || 0,
            gaps: voiceData?.gaps || [],
            confidence: voiceData?.confidence || 0
        }
    };
};


window.checkAndroidState = function() {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID DEBUG] État complet:', {
        platformConfig: PLATFORM_CONFIG,
        androidRestartCount: typeof androidRestartCount !== 'undefined' ? androidRestartCount : 'UNDEFINED',
        androidSessionStartTime: typeof androidSessionStartTime !== 'undefined' ? androidSessionStartTime : 'UNDEFINED',
        androidRestartTimer: typeof androidRestartTimer !== 'undefined' ? androidRestartTimer : 'UNDEFINED',
        androidLastTranscripts: typeof androidLastTranscripts !== 'undefined' ? androidLastTranscripts : 'UNDEFINED',
        functionsExist: {
            shouldRestartAndroid: typeof shouldRestartAndroid === 'function',
            handleAndroidRestart: typeof handleAndroidRestart === 'function',
            cleanupAndroidResources: typeof cleanupAndroidResources === 'function'
        }
    });
};





window.resetAndroidVoice = function() {
    cleanupAndroidResources();
    androidSessionStartTime = Date.now();
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Android] Reset forcé effectué');
};










// ===== PATCH ANDROID SIMPLIFIÉ =====
voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] Chargement...');

if (PLATFORM_CONFIG?.isAndroid) {
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] Android détecté:', true);
    
    // Sauvegarder l'ancienne fonction
    const originalHandleVoiceEnd = window.handleVoiceEnd;
    
    // Remplacer par une version qui NE fait PAS le comportement normal
    window.handleVoiceEnd = function() {
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] handleVoiceEnd intercepté');
        
        // Si on doit redémarrer, NE PAS appeler l'original
        if (shouldRestartAndroid()) {
            voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] Restart Android détecté - bypass comportement normal');
            handleAndroidRestart();
            // RETURN ICI - ne pas exécuter le reste
            return;
        }
        
        // Sinon, comportement normal
        voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] Pas de restart - comportement normal');
        if (typeof originalHandleVoiceEnd === 'function') {
            originalHandleVoiceEnd();
        }
    };
    
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] handleVoiceEnd remplacé avec logique restart');
    window.testAndroidPatch = () => voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[ANDROID PATCH] Test OK');
}















// Exposition pour debug
window.getVoiceSystemHealth = getVoiceSystemHealth;
window.validateVoiceSystemCoherence = validateVoiceSystemCoherence;

// ===== EXPORTS GLOBAUX =====

// Exposer les fonctions principales dans l'objet window
// pour utilisation depuis app.js et autres modules
window.voiceData = voiceData;
window.initVoiceRecognition = initVoiceRecognition;
window.startVoiceRecognition = startVoiceRecognition;
window.stopVoiceRecognition = stopVoiceRecognition;
window.showValidationModal = showValidationModal;
window.adjustVoiceCount = adjustVoiceCount;
window.confirmVoiceCount = confirmVoiceCount;
window.clearValidationUI = clearValidationUI;
window.toggleValidationUI = () => {
    VOICE_FEATURES.validation_ui = !VOICE_FEATURES.validation_ui;
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Validation UI:', VOICE_FEATURES.validation_ui ? 'ACTIVÉE' : 'DÉSACTIVÉE');
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
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Mode correction:', passiveListening ? 'ACTIF' : 'INACTIF');
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

voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] ✅ Toutes les expositions globales configurées');

// Initialiser l'état micro au chargement des séances
document.addEventListener('DOMContentLoaded', () => {
    // CRITIQUE : Initialiser l'instance immédiatement
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Initialisation automatique au chargement...');
    const initSuccess = initVoiceRecognition();
    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, `[Voice] Init au démarrage: ${initSuccess ? 'SUCCESS' : 'FAILED'}`);
    
    setTimeout(() => {
        const container = document.getElementById('voiceStatusContainer');
        if (container) {
            checkMicrophonePermissions().then(hasPermission => {
                if (hasPermission) {
                    updateMicrophoneVisualState('inactive'); // État par défaut
                    voiceLog(VOICE_DEBUG_LEVEL.NORMAL, '[Voice] Permissions accordées, état initial configuré');
                } else {
                    updateMicrophoneVisualState('error');
                }
            });
        }
    }, 600);
});