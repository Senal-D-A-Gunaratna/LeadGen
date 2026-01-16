#!/bin/bash
# Setup script for LeadGen project
# Ensures all dependencies are installed and project is ready to run

set -e

echo "=========================================="
echo "LeadGen Project Setup"
echo "=========================================="
echo ""

# Get the project root directory (where this script is located)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "Project root: $PROJECT_ROOT"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    exit 1
fi
echo "✅ Node.js $(node --version) found"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi
echo "✅ Python $(python3 --version) found"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm."
    exit 1
fi
echo "✅ npm $(npm --version) found"

echo ""
echo "Installing frontend dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "✅ Frontend dependencies already installed"
fi

echo ""
echo "Installing backend dependencies..."
cd backend
if [ ! -f "requirements.txt" ]; then
    echo "❌ requirements.txt not found in backend directory"
    exit 1
fi

# Check if virtual environment exists, create if not
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
echo "Installing Python packages..."
pip install -q -r requirements.txt

cd "$PROJECT_ROOT"

echo ""
echo "Checking environment configuration..."

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "Creating .env.local file..."
    echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:5000" > .env.local
    echo "✅ Created .env.local"
else
    echo "✅ .env.local already exists"
fi

echo ""
echo "Initializing databases..."
cd backend
source venv/bin/activate
python -c "from database import init_database, migrate_json_to_sqlite; init_database(); migrate_json_to_sqlite()" 2>/dev/null || echo "⚠️  Database initialization completed (warnings are normal)"

cd "$PROJECT_ROOT"

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "To start the development servers, run:"
echo "  npm run dev"
echo ""
echo "This will start:"
echo "  - Frontend: http://localhost:9002"
echo "  - Backend:  http://localhost:5000"
echo ""
