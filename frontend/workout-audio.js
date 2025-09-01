// ===== SYSTÈME AUDIO POUR NOTIFICATIONS DE REPOS =====

class WorkoutAudioSystem {
    constructor() {
        this.audioContext = null;
        this.isEnabled = true;
        this.volume = 0.3;
        this.scheduledSounds = [];
        this.init();
    }

    init() {
        // Initialiser AudioContext après interaction utilisateur
        document.addEventListener('click', () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
        }, { once: true });
    }

    // Créer un oscillateur avec paramètres spécifiques
    createTone(frequency, duration, type = 'sine', volume = this.volume) {
        if (!this.audioContext || !this.isEnabled) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        oscillator.type = type;
        
        // Envelope pour éviter les clics
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }

    // Sons spécifiques pour chaque étape
    playRestStart() {
        // Mélodie motivante pour célébrer la série terminée (Do-Mi-Sol montant)
        this.createTone(523, 0.2, 'sine', 0.35); // Do (C5)
        setTimeout(() => this.createTone(659, 0.2, 'sine', 0.35), 150); // Mi (E5)
        setTimeout(() => this.createTone(784, 0.3, 'sine', 0.4), 300); // Sol (G5)
        // Petit accent final
        setTimeout(() => this.createTone(1047, 0.15, 'sine', 0.3), 650); // Do octave (C6)
    }

    playOneMinuteWarning() {
        // Bip simple et clair
        this.createTone(800, 0.2, 'sine', 0.35);
    }

    playThirtySecondWarning() {
        // Double bip
        this.createTone(900, 0.15, 'sine', 0.35);
        setTimeout(() => this.createTone(900, 0.15, 'sine', 0.35), 200);
    }

    playFifteenSecondWarning() {
        // Triple bip plus urgent
        this.createTone(1000, 0.1, 'sine', 0.4);
        setTimeout(() => this.createTone(1000, 0.1, 'sine', 0.4), 150);
        setTimeout(() => this.createTone(1000, 0.1, 'sine', 0.4), 300);
    }

    playCountdown(number) {
        // Sons aigus pour le compte à rebours 3-2-1
        const frequency = 1200 + (number * 200); // Plus aigu pour 3, 2, 1
        this.createTone(frequency, 0.2, 'square', 0.45);
    }

    playRestEnd() {
        // Mélodie d'accomplissement (Do-Mi-Sol)
        this.createTone(523, 0.2, 'sine', 0.4); // Do
        setTimeout(() => this.createTone(659, 0.2, 'sine', 0.4), 150); // Mi
        setTimeout(() => this.createTone(784, 0.3, 'sine', 0.4), 300); // Sol
    }
    // Son générique pour différents événements
    playSound(type) {
        if (!this.audioContext || !this.isEnabled) return;
        
        switch(type) {
            case 'achievement':
                // Son d'accomplissement énergique
                this.createTone(880, 0.2, 'sine', 0.4); // La
                setTimeout(() => this.createTone(1047, 0.3, 'sine', 0.4), 150); // Do
                break;
            default:
                console.warn(`Type de son non reconnu: ${type}`);
        }
    }
    // Schedule toutes les notifications pour une période de repos
    scheduleRestNotifications(totalSeconds) {
        this.clearScheduledSounds();
        
        // Début du repos
        this.playRestStart();
        
        // Schedule les notifications
        const notifications = [
            { time: Math.max(0, totalSeconds - 60), action: () => this.playOneMinuteWarning() },
            { time: Math.max(0, totalSeconds - 30), action: () => this.playThirtySecondWarning() },
            { time: Math.max(0, totalSeconds - 15), action: () => this.playFifteenSecondWarning() },
            { time: Math.max(0, totalSeconds - 3), action: () => this.playCountdown(3) },
            { time: Math.max(0, totalSeconds - 2), action: () => this.playCountdown(2) },
            { time: Math.max(0, totalSeconds - 1), action: () => this.playCountdown(1) },
            { time: totalSeconds, action: () => this.playRestEnd() }
        ];

        notifications.forEach(notification => {
            if (notification.time >= 0 && notification.time <= totalSeconds) {
                const timeout = setTimeout(notification.action, notification.time * 1000);
                this.scheduledSounds.push(timeout);
            }
        });
    }

    // Annuler tous les sons schedulés (utile si repos interrompu)
    clearScheduledSounds() {
        this.scheduledSounds.forEach(timeout => clearTimeout(timeout));
        this.scheduledSounds = [];
    }

    // Contrôles utilisateur
    toggle() {
        this.isEnabled = !this.isEnabled;
        return this.isEnabled;
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
    }

    // Test des sons
    testAllSounds() {
        console.log('Test des sons de repos...');
        this.playRestStart();
        setTimeout(() => this.playOneMinuteWarning(), 1000);
        setTimeout(() => this.playThirtySecondWarning(), 2000);
        setTimeout(() => this.playFifteenSecondWarning(), 3000);
        setTimeout(() => {
            this.playCountdown(3);
            setTimeout(() => this.playCountdown(2), 500);
            setTimeout(() => this.playCountdown(1), 1000);
            setTimeout(() => this.playRestEnd(), 1500);
        }, 4000);
    }
}

// Instance globale - avec protection contre double chargement
if (!window.workoutAudio) {
    window.workoutAudio = new WorkoutAudioSystem();
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkoutAudioSystem;
} else {
    window.WorkoutAudioSystem = WorkoutAudioSystem;
}