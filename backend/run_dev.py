#!/usr/bin/env python3
"""
Script de développement pour Fitness Coach
Démarre le serveur FastAPI avec rechargement automatique
"""

import uvicorn
import os
import sys

# Ajouter le répertoire racine au path Python
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("🚀 Démarrage de Fitness Coach en mode développement")
    print("📱 Interface disponible sur: http://localhost:8000")
    print("📖 API docs sur: http://localhost:8000/docs")
    print("💾 Base de données: SQLite locale (fitness_coach.db)")
    print("🔄 Rechargement automatique activé")
    print("\n✋ Ctrl+C pour arrêter\n")
    
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["backend"],
        log_level="info"
    ) 