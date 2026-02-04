#!/bin/bash
# Start script for FastAPI-wrapped backend (uses existing Flask+SocketIO ASGI app)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create and activate virtualenv
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate

# Install requirements
pip install -r requirements.txt

# Initialize DB
python -c "from database import init_database; init_database()"

# Start uvicorn serving the FastAPI wrapper which mounts the Flask/Socket.IO ASGI app
# Use --reload in dev if desired
uvicorn fastapi_app:app --host 0.0.0.0 --port 5000
