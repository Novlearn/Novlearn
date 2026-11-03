#!/bin/bash

# Script de déploiement pour Novlearn
# Ce script est exécuté sur le VPS après chaque déploiement

set -e  # Arrêter en cas d'erreur

echo "🚀 Démarrage du déploiement Novlearn..."

# Variables
APP_DIR="/opt/novlearn"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
DUEL_DIR="$APP_DIR/duel-server"
VENV_DIR="$BACKEND_DIR/venv"
BACKEND_SERVICE="novlearn-backend"
FRONTEND_SERVICE="novlearn-frontend"
DUEL_SERVICE="novlearn-duel-server"

# ===== BACKEND =====
echo "📦 Déploiement du backend..."

# Aller dans le répertoire backend
cd "$BACKEND_DIR"

# Créer l'environnement virtuel Python s'il n'existe pas
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Création de l'environnement virtuel Python..."
    python3 -m venv venv
fi

# Activer l'environnement virtuel
source venv/bin/activate

# Installer/mettre à jour les dépendances
echo "📦 Installation des dépendances Python..."
pip install --upgrade pip
pip install -r requirements.txt

# Appliquer les migrations de base de données (si vous utilisez Alembic)
# echo "🗄️ Application des migrations..."
# alembic upgrade head

# Redémarrer le service systemd backend
echo "🔄 Redémarrage du service backend..."
if systemctl list-unit-files | grep -q "^${BACKEND_SERVICE}.service"; then
    sudo systemctl restart $BACKEND_SERVICE
    
    # Vérifier le statut du service
    if sudo systemctl is-active --quiet $BACKEND_SERVICE; then
        echo "✅ Service $BACKEND_SERVICE démarré avec succès"
    else
        echo "❌ Erreur: le service $BACKEND_SERVICE n'a pas démarré"
        sudo systemctl status $BACKEND_SERVICE
        exit 1
    fi
else
    echo "⚠️  Le service $BACKEND_SERVICE n'existe pas encore. Il sera créé par le workflow GitHub Actions."
fi

# ===== FRONTEND =====
echo "📦 Déploiement du frontend..."

# Vérifier et installer Node.js 24.19+ si nécessaire
echo "🔍 Vérification de la version de Node.js..."
NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===24&&minor>=19?0:1)' 2>/dev/null; then
    echo "⚠️  Node.js version $NODE_VERSION détectée. Installation de Node.js 24.19+..."
    
    # Détecter la distribution Linux
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    else
        OS="unknown"
    fi
    
    # Installer Node.js 24.19+ selon la distribution
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ] || [ "$OS" = "fedora" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo "❌ Distribution non supportée: $OS. Veuillez installer Node.js 24.19+ manuellement."
        exit 1
    fi
    
    echo "✅ Node.js $(node --version) installé avec succès"
else
    echo "✅ Node.js $(node --version) est déjà installé (version 24.19+)"
fi

# Aller dans le répertoire frontend
cd "$FRONTEND_DIR"

# Installer les dépendances npm (le build .next est déployé depuis la CI).
# Le build étant déjà fait en CI, `next start` n'a besoin que des deps de prod :
# --omit=dev évite de réinstaller typescript/eslint/tailwind…, --prefer-offline
# réutilise node_modules existant (incrémental) au lieu de tout réinstaller comme `npm ci`.
echo "📦 Installation des dépendances Node.js..."
npm install --prefer-offline --no-audit --omit=dev

# Démarrer/redémarrer le service systemd frontend
echo "🔄 Démarrage/redémarrage du service frontend..."
if systemctl list-unit-files | grep -q "^${FRONTEND_SERVICE}.service"; then
    # Si le service est actif, le redémarrer, sinon le démarrer
    if sudo systemctl is-active --quiet $FRONTEND_SERVICE; then
        sudo systemctl restart $FRONTEND_SERVICE
    else
        sudo systemctl start $FRONTEND_SERVICE
    fi
    
    # Attendre un peu pour le démarrage
    sleep 2
    
    # Vérifier le statut du service
    if sudo systemctl is-active --quiet $FRONTEND_SERVICE; then
        echo "✅ Service $FRONTEND_SERVICE démarré avec succès"
    else
        echo "❌ Erreur: le service $FRONTEND_SERVICE n'a pas démarré"
        echo "Logs du service:"
        sudo journalctl -u $FRONTEND_SERVICE -n 50 --no-pager
        sudo systemctl status $FRONTEND_SERVICE
        exit 1
    fi
else
    echo "⚠️  Le service $FRONTEND_SERVICE n'existe pas encore. Il sera créé par le workflow GitHub Actions."
fi

# ===== DUEL-SERVER (Colyseus) =====
echo "📦 Déploiement du duel-server (Colyseus)..."

if [ -d "$DUEL_DIR" ]; then
    cd "$DUEL_DIR"

    # Si dist/ a été buildé en CI, on n'installe que les deps de prod (pas de tsc/typescript).
    # Sinon, fallback : install complète + build sur le VPS.
    if [ -d dist ]; then
        echo "📦 dist/ présent (buildé en CI) — installation des deps de prod uniquement..."
        npm install --prefer-offline --no-audit --omit=dev
    else
        echo "📦 Pas de dist/ — installation complète + build sur le VPS..."
        npm install --prefer-offline --no-audit
        echo "🔨 Build du duel-server..."
        npm run build
    fi

    # Créer le fichier .env si nécessaire (les variables sont déjà copiées par le workflow)
    if [ ! -f ".env" ]; then
        echo "⚠️  Aucun .env trouvé pour le duel-server. Pensez à le créer avec SUPABASE_URL et SUPABASE_SERVICE_KEY."
    fi

    # Redémarrer le service systemd duel-server
    echo "🔄 Redémarrage du service duel-server..."
    if systemctl list-unit-files | grep -q "^${DUEL_SERVICE}.service"; then
        sudo systemctl restart $DUEL_SERVICE

        if sudo systemctl is-active --quiet $DUEL_SERVICE; then
            echo "✅ Service $DUEL_SERVICE démarré avec succès"
        else
            echo "❌ Erreur: le service $DUEL_SERVICE n'a pas démarré"
            sudo systemctl status $DUEL_SERVICE
            exit 1
        fi
    else
        echo "⚠️  Le service $DUEL_SERVICE n'existe pas encore. Il sera créé par le workflow GitHub Actions."
    fi
else
    echo "⚠️  Répertoire duel-server introuvable, saut de cette étape."
fi

echo "✅ Déploiement terminé avec succès!"

