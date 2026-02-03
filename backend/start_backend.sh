#!/bin/bash
# Start script for Flask backend

echo "Starting Flask backend..."
# Ensure script runs from its own directory so relative paths (requirements, app.py)
# resolve correctly when the script is invoked from the repo root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
echo "Installing dependencies if needed..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Initialize database (SQLite is the only source of truth)
python -c "from database import init_database; init_database()"

# Prefer ASGI/uvicorn to enable async WebSocket support (python-socketio AsyncServer)
echo "Starting backend with ASGI (uvicorn) to enable WebSocket support"
# Force the app to use the ASGI code path inside app.py
export FORCE_ASGI=1
python app.py

