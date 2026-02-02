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

# Start Flask app
echo "Starting Flask on http://0.0.0.0:5000"
python app.py

