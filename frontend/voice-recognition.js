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
    confidence_system: true,    // Étape 1 - ACTIF
    validation_ui: DEBUG_MODE,  // ✅ Étape 2 - CONTRÔLÉ PAR DEBUG_MODE
    voice_correction: false,    // Étape 3
    auto_validation: false      // Étape 4
};

// NOUVEAU - Variables d'état pour la validation
let voiceState = 'LISTENING'; // 'LISTENING' | 'VALIDATING' | 'CONFIRMED'
let validationTimer = null;
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
        
        // Timer auto-validation
        if (typeof startAutoValidationTimer === 'function') {
            startAutoValidationTimer();
        }
        
        // UI feedback
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
        
        if (typeof handleVoiceStartupError === 'function') {
            handleVoiceStartupError(error);
        }
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
        return;
    }
    
    try {
        recognition.stop();
        voiceRecognitionActive = false;
        
        // Nettoyer les timers (si la fonction existe)
        if (typeof clearAutoValidationTimer === 'function') {
            clearAutoValidationTimer();
        }
        
        // Calculer la confiance finale basée sur les gaps
        if (voiceData.gaps.length > 0) {
            const gapPenalty = Math.min(voiceData.gaps.length * 0.1, 0.3);
            voiceData.confidence = Math.max(0.6, 1.0 - gapPenalty);
        }
        
        // Calcul confiance finale intelligent
        if (VOICE_FEATURES.confidence_system) {
            voiceData.confidence = calculateConfidence();
            
            // Déterminer si validation nécessaire
            voiceData.needsValidation = voiceData.confidence < CONFIDENCE_LEVELS.HIGH;
            
            console.log('[Voice] Confiance finale:', {
                score: voiceData.confidence.toFixed(2),
                level: voiceData.confidence >= CONFIDENCE_LEVELS.HIGH ? 'HIGH' : 
                    voiceData.confidence >= CONFIDENCE_LEVELS.MEDIUM ? 'MEDIUM' : 'LOW',
                needsValidation: voiceData.needsValidation,
                suspiciousJumps: voiceData.suspiciousJumps,
                gaps: voiceData.gaps.length
            });
        }

        // Déclencher validation UI si confiance faible
        if (VOICE_FEATURES.validation_ui && voiceData.needsValidation) {
            showValidationUI(voiceData.count, voiceData.confidence);
        } else {
            // Mode normal - pas de validation UI
            console.log('[Voice] Confiance suffisante, pas de validation UI requise');
        }

        // Mettre à jour l'interface - icône micro inactive
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
    if (!VOICE_FEATURES.confidence_system) {
        return 1.0; // Mode legacy
    }
    
    let score = 1.0;
    
    // Pénalités simples et rapides
    if (voiceData.gaps.length > 0) {
        score -= voiceData.gaps.length * 0.1; // -10% par gap
    }
    
    if (voiceData.suspiciousJumps > 0) {
        score -= voiceData.suspiciousJumps * 0.15; // -15% par saut suspect
    }
    
    if (voiceData.repetitions > 1) {
        score -= 0.2; // -20% si répétitions détectées
    }
    
    // Bonus pour séquences courtes et cohérentes
    if (voiceData.count <= 5 && voiceData.gaps.length === 0) {
        score += 0.1; // +10% bonus
    }
    
    // Borner le résultat
    return Math.max(0.1, Math.min(1.0, score));
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
        return; // Interface désactivée
    }
    
    const repsElement = document.getElementById('setReps');
    if (!repsElement) {
        console.warn('[Voice] Élément setReps non trouvé');
        return;
    }
    
    // Sauvegarder le contenu original
    repsElement.setAttribute('data-original', repsElement.textContent);
    
    // Interface inline minimaliste
    repsElement.innerHTML = `
        <span class="voice-count">${count}</span>
        <div class="quick-actions">
            <button onclick="adjustVoiceCount(-1)" class="adjust-btn">−</button>
            <button onclick="adjustVoiceCount(1)" class="adjust-btn">+</button>
        </div>
    `;
    
    // Classe CSS selon niveau de confiance
    repsElement.className = getConfidenceClass(confidence);
    
    // Animation discrète
    repsElement.style.transform = 'scale(1.02)';
    setTimeout(() => {
        repsElement.style.transform = '';
    }, 200);
    
    // Timer auto-validation
    startValidationTimer(count);
    
    console.log(`[Voice] UI validation affichée - Count: ${count}, Confiance: ${confidence.toFixed(2)}`);
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
    voiceData.count = finalCount;
    voiceState = 'CONFIRMED';
    
    // Nettoyer l'interface
    clearValidationUI();
    
    // Exposer pour executeSet
    window.voiceData = voiceData;
    
    console.log(`[Voice] Count confirmé: ${finalCount}`);
    
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
    
    // NOUVEAU - Validation intelligente du saut
    const validation = validateNumberJump(number, voiceData.lastDetected || voiceData.count);
    
    if (!validation.valid) {
        console.log(`[Voice] Rejeté: ${number} - ${validation.reason}`);
        return;
    }
    
    // NOUVEAU - Tracking des patterns suspects
    if (validation.suspicious) {
        voiceData.suspiciousJumps++;
        console.log(`[Voice] Saut suspect détecté: +${validation.jump}`);
    }
    
    // NOUVEAU - Détection répétitions
    if (number === voiceData.lastDetected) {
        voiceData.repetitions++;
        return; // Ignorer les répétitions
    }
    
    // Monotonie croissante (CONSERVER logique existante)
    if (number <= voiceData.count) {
        console.log(`[Voice] Ignoré: ${number} <= ${voiceData.count}`);
        return;
    }
    
    // Gestion des gaps (CONSERVER)
    const previousCount = voiceData.count;
    if (number > voiceData.count + 1) {
        for (let i = voiceData.count + 1; i < number; i++) {
            voiceData.gaps.push(i);
        }
    }
    
    // Mise à jour des données (MODIFIER)
    voiceData.count = number;
    voiceData.lastDetected = number; // NOUVEAU
    voiceData.timestamps.push(now - voiceData.startTime);
    voiceData.lastNumber = number;
    
    // CONSERVER le reste de la logique existante...
    if (pendingValidation === number) {
        pendingValidation = null;
    } else {
        updateVoiceDisplay(number);
    }
    
    updatePrediction(number + 1);
    
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
    
    if (typeof resetAutoValidationTimer === 'function') {
        resetAutoValidationTimer();
    }
    
    // NOUVEAU - Log avec confiance
    const confidence = calculateConfidence();
    const gapCount = voiceData.gaps.length;
    console.log(`[Voice] ${previousCount} → ${number}${gapCount > 0 ? ` (${gapCount} gaps)` : ''} - Confiance: ${confidence.toFixed(2)}`);
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
console.log('[Voice] Module voice-recognition.js chargé - Phase 0');

// NOUVEAU - Mode preview pour tests internes
if (DEBUG_MODE) {
    console.log('🧪 [Voice] MODE DEBUG ACTIVÉ - Interface validation disponible');
    
    // Fonction de test rapide
    window.testValidationUI = (count = 12, confidence = 0.6) => {
        voiceData.count = count;
        voiceData.confidence = confidence;
        showValidationUI(count, confidence);
    };
    
    // Raccourci clavier pour tests (Ctrl+Shift+V)
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'V') {
            window.testValidationUI();
        }
    });
}