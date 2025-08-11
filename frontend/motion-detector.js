// ===== MOTION DETECTOR MODULE (SIMPLIFIÉ) =====
// Détection pose/reprise smartphone pour fitness

class MotionDetector {
    constructor() {
        // Configuration simple et pragmatique
        this.THRESHOLDS = {
            STATIONARY: {
                acceleration: 1.0,      // Plus tolérant (vibrations sol/table gym)
                duration: 2000          // 2s stable = posé
            },
            PICKUP: {
                acceleration: 3.0,      // Seuil élevé (éviter faux positifs)
                duration: 300          // 300ms mouvement = reprise intentionnelle
            }
        };

        // Calibration data
        this.calibrationMode = false;
        this.calibrationSamples = [];
        this.baselineNoise = 0;

        this.state = 'unknown';
        this.monitoring = false;
        this.callbacks = {};
        
        // Simplification : juste les dernières valeurs
        this.lastAcceleration = 0;
        this.stationaryStartTime = null;
        this.pickupStartTime = null;
        
        this.checkInterval = null;
    }

    /**
     * Initialise avec gestion permissions simple
     */
    async init() {
        if (!window.DeviceMotionEvent) {
            console.log('[Motion] API non supportée');
            return false;
        }

        // iOS 13+ demande permission
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceMotionEvent.requestPermission();
                if (permission !== 'granted') return false;
            } catch (e) {
                return false;
            }
        }

        console.log('[Motion] Initialisé');
        return true;
    }

    /**
     * Démarre le monitoring
     */
    startMonitoring(callbacks = {}) {
        if (this.monitoring) return;
        
        this.callbacks = callbacks;
        this.monitoring = true;
        this.state = 'unknown';
        
        // Un seul listener simplifié
        this.motionHandler = this.handleMotion.bind(this);
        window.addEventListener('devicemotion', this.motionHandler);
        
        // Check périodique état
        this.checkInterval = setInterval(() => this.checkState(), 200);
        
        console.log('[Motion] Monitoring démarré');
    }

    /**
     * Arrête le monitoring
     */
    stopMonitoring() {
        this.monitoring = false;
        
        window.removeEventListener('devicemotion', this.motionHandler);
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        
        this.state = 'unknown';
        console.log('[Motion] Monitoring arrêté');
    }

    /**
     * Handler motion simplifié
     */
    handleMotion(event) {
        if (!this.monitoring || !event.acceleration) return;
        
        const acc = event.acceleration;
        const magnitude = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
        
        // Mode calibration
        if (this.calibrationMode) {
            this.calibrationSamples.push(magnitude);
            return;
        }
        
        if (!this.monitoring || !event.acceleration) return;
        
        // Calcul simple magnitude
        this.lastAcceleration = Math.sqrt(
            (acc.x || 0) ** 2 + 
            (acc.y || 0) ** 2 + 
            (acc.z || 0) ** 2
        );
    }

    /**
     * Vérification état périodique
     */
    checkState() {
        const now = Date.now();
        const acc = this.lastAcceleration;
        
        // Détection stationnaire
        if (acc < this.THRESHOLDS.STATIONARY.acceleration) {
            if (!this.stationaryStartTime) {
                this.stationaryStartTime = now;
            } else if (now - this.stationaryStartTime > this.THRESHOLDS.STATIONARY.duration) {
                if (this.state !== 'stationary') {
                    this.state = 'stationary';
                    console.log('[Motion] STATIONNAIRE détecté');
                    if (this.callbacks.onStationary) {
                        this.callbacks.onStationary();
                    }
                }
            }
        } else {
            this.stationaryStartTime = null;
            
            // Détection pickup
            if (acc > this.THRESHOLDS.PICKUP.acceleration) {
                if (!this.pickupStartTime) {
                    this.pickupStartTime = now;
                } else if (now - this.pickupStartTime > this.THRESHOLDS.PICKUP.duration) {
                    if (this.state !== 'pickup') {
                        const wasStationary = this.state === 'stationary';
                        this.state = 'pickup';
                        console.log('[Motion] REPRISE détectée');
                        if (this.callbacks.onPickup) {
                            this.callbacks.onPickup(wasStationary);
                        }
                    }
                }
            } else {
                this.pickupStartTime = null;
            }
        }
    }

    /**
     * Info debug minimale
     */
    getDebugInfo() {
        return {
            state: this.state,
            acceleration: this.lastAcceleration.toFixed(2),
            monitoring: this.monitoring
        };
    }

    async calibrate(duration = 5000) {
        console.log('[Motion] Début calibration');
        this.calibrationMode = true;
        this.calibrationSamples = [];
        
        // Instructions UI
        showCalibrationUI();
        
        // Collecter samples
        return new Promise((resolve) => {
            setTimeout(() => {
                this.calibrationMode = false;
                this.processCalibration();
                hideCalibrationUI();
                resolve(this.baselineNoise);
            }, duration);
        });
    }

    processCalibration() {
        if (this.calibrationSamples.length === 0) {
            this.baselineNoise = 0.5; // Défaut
            return;
        }
        
        // Calculer moyenne et écart-type
        const avg = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
        const variance = this.calibrationSamples.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / this.calibrationSamples.length;
        const stdDev = Math.sqrt(variance);
        
        // Ajuster seuils basés sur le bruit ambiant
        this.baselineNoise = avg + (2 * stdDev); // 2 écarts-types
        
        // Adapter thresholds
        this.THRESHOLDS.STATIONARY.acceleration = Math.max(1.0, this.baselineNoise + 0.5);
        this.THRESHOLDS.PICKUP.acceleration = Math.max(3.0, this.baselineNoise + 2.5);
        
        console.log('[Motion] Calibration terminée:', {
            baseline: this.baselineNoise,
            stationary: this.THRESHOLDS.STATIONARY.acceleration,
            pickup: this.THRESHOLDS.PICKUP.acceleration
        });
        
        // Sauvegarder en localStorage
        localStorage.setItem('motionCalibration', JSON.stringify({
            baseline: this.baselineNoise,
            thresholds: this.THRESHOLDS,
            timestamp: Date.now()
        }));
    }

    loadCalibration() {
        try {
            const saved = localStorage.getItem('motionCalibration');
            if (saved) {
                const data = JSON.parse(saved);
                // Utiliser si moins de 30 jours
                if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
                    this.baselineNoise = data.baseline;
                    this.THRESHOLDS = data.thresholds;
                    console.log('[Motion] Calibration chargée');
                    return true;
                }
            }
        } catch (error) {
            console.error('[Motion] Erreur chargement calibration:', error);
        }
        return false;
    }
}

// Export global
window.MotionDetector = MotionDetector;