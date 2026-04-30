#!/usr/bin/env bash
# Simplified setup: validate Node.js and Python versions, then run npm install-all

set -e

echo "=========================================="
echo "LeadGen Simple Setup"
echo "=========================================="

# Project root (where this script lives)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Validate Node.js (major >= 18)
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    exit 1
fi
node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$node_major" -lt 18 ]; then
    echo "❌ Node.js $(node -v) detected. Please upgrade to v18 or higher."
    exit 1
fi
echo "✅ Node.js $(node -v) found"

# Validate Python3 (>= 3.8)
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi
py_version=$(python3 -V 2>&1 | awk '{print $2}')
py_major=$(echo "$py_version" | cut -d. -f1)
py_minor=$(echo "$py_version" | cut -d. -f2)
if [ "$py_major" -lt 3 ] || { [ "$py_major" -eq 3 ] && [ "$py_minor" -lt 8 ]; }; then
    echo "❌ Python $py_version detected. Please use Python 3.8 or higher."
    exit 1
fi
echo "✅ Python $py_version found"

echo ""
echo "Running npm install-all from project root..."
if ! command -v npm >/dev/null 2>&1; then
    echo "❌ npm is not installed. Please install npm to continue."
    exit 1
fi

echo ""
echo attemting to run install-all depandanciies (pyton and node modules)...
npm run install-all

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="

