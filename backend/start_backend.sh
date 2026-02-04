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

# Prefer starting the FastAPI/uvicorn server which mounts the legacy Flask+SocketIO ASGI app.
# This keeps WebSocket support and lets us incrementally migrate HTTP endpoints to FastAPI.
# Default to the legacy Flask entrypoint to avoid delegating to FastAPI by default.
# To explicitly start the FastAPI+uvicorn server, set LEGACY_FLASK=0 in the environment.
LEGACY_FLASK=${LEGACY_FLASK:-1}

if [ "$LEGACY_FLASK" = "1" ]; then
    echo "LEGACY_FLASK=1 -> starting legacy Flask entrypoint (app.py)"
    # Force the app to use the ASGI code path inside app.py
    export FORCE_ASGI=1
    python app.py
else
    echo "Delegating to start_fastapi.sh (FastAPI + uvicorn)"
    ./start_fastapi.sh
fi

