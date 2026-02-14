#!/bin/bash
# Fix script for common setup issues

set -e

echo "=========================================="
echo "Fixing Project Setup Issues"
echo "=========================================="
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "Project root: $PROJECT_ROOT"
echo ""

# Fix concurrently issue
echo "Fixing concurrently module..."
if [ -d "node_modules/concurrently" ]; then
    echo "Removing corrupted concurrently installation..."
    rm -rf node_modules/.bin/concurrently
    rm -rf node_modules/concurrently
fi

echo "Reinstalling concurrently..."
npm install concurrently@^8.2.2 --save-dev

# Fix Next.js issue
echo ""
echo "Fixing Next.js module..."
if [ -d "node_modules/next" ]; then
    echo "Removing corrupted Next.js installation..."
    rm -rf node_modules/.bin/next
    rm -rf node_modules/next
fi

echo "Reinstalling Next.js..."
npm install next@14.2.4 --save

echo ""
echo "Installing backend dependencies..."
if [ ! -f "servers/backend/requirements.txt" ]; then
    echo "❌ Error: servers/backend/requirements.txt not found!"
    exit 1
fi

cd servers/backend
pip3 install -r requirements.txt
cd ..

echo ""
echo "=========================================="
echo "✅ Fix Complete!"
echo "=========================================="
echo ""
echo "Now try running:"
echo "  npm run dev"
echo ""
