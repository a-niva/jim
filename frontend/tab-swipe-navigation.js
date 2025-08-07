// ===== NAVIGATION SWIPE PRÉCISE =====
// Fichier: frontend/tab-swipe-navigation.js
// 80 lignes, fonctionne partout y compris Planning

class TabSwipeNavigation {
    constructor() {
        this.tabs = ['dashboard', 'stats', 'planning', 'profile'];
        this.currentTabIndex = 0;
        this.startX = 0;
        this.startY = 0;
        
        this.swipeThreshold = 100;
        this.verticalTolerance = 40;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.watchTabChanges();
        this.updateCurrentTab();
    }

    bindEvents() {
        // Touch uniquement - plus simple et précis
        document.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true });
        document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
    }

    onTouchStart(e) {
        if (e.touches.length !== 1) return;
        
        // Zone autorisée : précise et évite les conflits
        if (!this.isTabSwipeZone(e.target)) return;
        
        this.startX = e.touches[0].clientX;
        this.startY = e.touches[0].clientY;
    }

    onTouchMove(e) {
        if (!this.startX) return;
        
        const deltaY = Math.abs(e.touches[0].clientY - this.startY);
        
        // Annuler si trop vertical
        if (deltaY > this.verticalTolerance) {
            this.startX = 0;
            return;
        }
        
        const deltaX = Math.abs(e.touches[0].clientX - this.startX);
        
        // Empêcher scroll si mouvement horizontal significatif
        if (deltaX > 50) {
            e.preventDefault();
        }
    }

    onTouchEnd(e) {
        if (!this.startX) return;
        
        const deltaX = e.changedTouches[0].clientX - this.startX;
        const deltaY = Math.abs(e.changedTouches[0].clientY - this.startY);
        
        this.startX = 0;
        
        // Validation stricte
        if (Math.abs(deltaX) < this.swipeThreshold || deltaY > this.verticalTolerance) {
            return;
        }
        
        // Navigation
        const direction = deltaX > 0 ? -1 : 1;
        const targetIndex = this.currentTabIndex + direction;
        
        if (targetIndex >= 0 && targetIndex < this.tabs.length) {
            this.navigateToTab(targetIndex);
        }
    }

    isTabSwipeZone(target) {
        // Dans Planning : seulement zones sûres
        if (document.getElementById('planning')?.style.display !== 'none') {
            return this.isPlanningSwipeZone(target);
        }
        
        // Autres onglets : zones basiques
        return !target.closest('input, textarea, select, button, .modal');
    }

    isPlanningSwipeZone(target) {
        // Zones autorisées dans Planning
        return target.closest('.planning-header') ||
               target.closest('.week-navigation') ||
               target.closest('.day-name, .day-number') ||
               (target.closest('.container') && 
                !target.closest('.weeks-container, .session-card, .day-sessions'));
    }

    navigateToTab(index) {
        const targetTab = this.tabs[index];
        
        // Animation subtile
        this.animateTransition();
        
        // Navigation après délai
        setTimeout(() => {
            if (targetTab === 'planning') {
                window.showPlanning?.();
            } else {
                window.showView?.(targetTab);
            }
        }, 100);
        
        this.currentTabIndex = index;
    }

    animateTransition() {
        // Animation discrète sur bottom nav
        const nav = document.getElementById('bottomNav');
        if (nav) {
            nav.style.transform = 'scale(0.95)';
            nav.style.transition = 'transform 0.2s ease';
            
            setTimeout(() => {
                nav.style.transform = 'scale(1)';
            }, 200);
        }
    }

    getCurrentTab() {
        const activeNav = document.querySelector('.nav-item.active');
        if (!activeNav) return 0;
        
        const onclick = activeNav.getAttribute('onclick');
        if (onclick?.includes("'dashboard'")) return 0;
        if (onclick?.includes("'stats'")) return 1;
        if (onclick?.includes('showPlanning')) return 2;
        if (onclick?.includes("'profile'")) return 3;
        return 0;
    }

    updateCurrentTab() {
        this.currentTabIndex = this.getCurrentTab();
    }

    watchTabChanges() {
        // Observer les changements d'onglet
        const nav = document.getElementById('bottomNav');
        if (!nav) return;
        
        const observer = new MutationObserver(() => {
            this.updateCurrentTab();
        });
        
        observer.observe(nav, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }
}

// Initialisation
let tabSwipeNavigation;

function initTabSwipeNavigation() {
    return new Promise((resolve, reject) => {
        const checkBottomNav = () => {
            const bottomNav = document.getElementById('bottomNav');
            if (bottomNav) {
                tabSwipeNavigation = new TabSwipeNavigation();
                window.tabSwipeNavigation = tabSwipeNavigation;
                console.log('📱 Navigation swipe initialisée');
                resolve();
            } else {
                setTimeout(checkBottomNav, 100);
            }
        };
        checkBottomNav();
        
        // Timeout sécurité
        setTimeout(() => reject(new Error('bottomNav introuvable')), 2000);
    });
}

// Initialisation avec gestion d'erreur
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initTabSwipeNavigation().catch(error => {
            console.warn('Navigation swipe échouée:', error);
        });
    });
} else {
    initTabSwipeNavigation().catch(error => {
        console.warn('Navigation swipe échouée:', error);
    });
}