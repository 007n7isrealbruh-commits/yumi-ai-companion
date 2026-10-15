#!/usr/bin/env bash
# ============================================================
# AI Waifu Companion - Unified One-Click Launcher
# Starts both the backend API/WebSocket server and frontend web app.
# ============================================================

set -e

# Change to script directory (project root)
cd "$(dirname "$0")"

echo "============================================================"
echo "🌸 Starting Yumi AI Companion"
echo "============================================================"

# 1. Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 could not be found. Please install Python 3."
    exit 1
fi

# 2. Check .env
if [ ! -f ".env" ]; then
    echo "[INFO] No .env found. Creating default local configuration..."
    cat << 'EOF' > .env
LLM_PROVIDER=mock
LLM_MODEL=offline-waifu
LLM_API_KEY=not-needed
LLM_BASE_URL=
TTS_PROVIDER=browser
STT_ENGINE=browser
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
CHARACTER_NAME=Yumi
MEMORY_FILE_PATH=./backend/memory_store.json
EOF
    echo "[INFO] .env initialized successfully."
fi

# 3. Clean up any existing listeners on ports 8000 or 5500
cleanup_port() {
    local port=$1
    local pids=$(lsof -ti :$port 2>/dev/null || fuser $port/tcp 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "[INFO] Freeing port $port (PIDs: $pids)..."
        kill -9 $pids 2>/dev/null || true
    fi
}

cleanup_port 8000
cleanup_port 5500

# 4. Handle clean exit on Ctrl+C
cleanup() {
    echo ""
    echo "[INFO] Shutting down servers..."
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    echo "[INFO] Servers stopped cleanly. See you next time! ✨"
    exit 0
}

trap cleanup INT TERM EXIT

# 5. Start Backend
echo "[1/2] Starting backend server on port 8000..."
python3 -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait briefly for backend to initialize
sleep 2

# 6. Start Frontend Web Server
echo "[2/2] Starting frontend web server on port 5500..."
python3 -m http.server 5500 --directory frontend --bind 0.0.0.0 &
FRONTEND_PID=$!

sleep 1

echo ""
echo "============================================================"
echo "✨ Yumi AI Companion is LIVE and RUNNING!"
echo "============================================================"
echo "🌐 Frontend URL:  http://127.0.0.1:5500"
echo "⚙️ Backend API:   http://127.0.0.1:8000"
echo "🧠 Active Brain:  Local / Configured Provider"
echo "🔊 Voice Engine:  Browser Speech / Neural TTS"
echo "🎙️ Mic / STT:     Silero VAD / Web Speech / Whisper"
echo "============================================================"
echo "💡 Open http://127.0.0.1:5500 in your browser to start!"
echo "   (Press Ctrl + C anytime in this terminal to stop)"
echo "============================================================"
echo ""

# Keep running until user stops
wait
