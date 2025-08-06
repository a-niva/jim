/**
 * Centralise le nettoyage de tous les timers du système vocal
 */
function cleanupAllVoiceTimers() {
    // Au lieu d'accéder directement aux propriétés window
    // Utiliser une approche plus sûre
    
    if (typeof window.validationTimer !== 'undefined' && window.validationTimer) {
        clearTimeout(window.validationTimer);
        window.validationTimer = null;
    }
    
    // Pour autoValidationTimer, vérifier d'abord son existence
    if ('autoValidationTimer' in window && window.autoValidationTimer) {
        clearTimeout(window.autoValidationTimer);
        window.autoValidationTimer = null;
    }
    
    if ('correctionTimer' in window && window.correctionTimer) {
        clearTimeout(window.correctionTimer);
        window.correctionTimer = null;
    }
    
    console.log('[Voice] Cleanup: timers vocaux nettoyés');
}

/**
 * Centralise le nettoyage de tous les timers du workout
 */
function cleanupAllWorkoutTimers() {
    const timers = [
        { name: 'restTimer', ref: window.restTimer },
        { name: 'setTimer', ref: window.setTimer },
        { name: 'notificationTimeout', ref: window.notificationTimeout }
    ];
    
    timers.forEach(timer => {
        if (timer.ref) {
            clearInterval(timer.ref);
            clearTimeout(timer.ref);
            window[timer.name] = null;
        }
    });
    
    console.log('[Workout] Cleanup: tous timers workout nettoyés');
}

// Exposition globale
window.cleanupAllVoiceTimers = cleanupAllVoiceTimers;
window.cleanupAllWorkoutTimers = cleanupAllWorkoutTimers;