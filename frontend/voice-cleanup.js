/**
 * Centralise le nettoyage de tous les timers du système vocal
 */
function cleanupAllVoiceTimers() {
    const timers = [
        { name: 'validationTimer', ref: window.validationTimer },
        { name: 'autoValidationTimer', ref: window.autoValidationTimer },
        { name: 'correctionTimer', ref: window.correctionTimer }
    ];
    
    timers.forEach(timer => {
        if (timer.ref) {
            clearTimeout(timer.ref);
            window[timer.name] = null;
        }
    });
    
    console.log('[Voice] Cleanup: tous timers vocaux nettoyés');
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