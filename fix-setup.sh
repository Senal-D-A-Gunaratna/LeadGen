#!/usr/bin/env bash
# Hard dependency reset + reinstall for LeadGen

set -e

echo "=========================================="
echo "Hard Reset: Project Dependencies"
echo "=========================================="

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "Project root: $PROJECT_ROOT"
echo ""
echo "Removing frontend artifacts: node_modules, .next, package-lock.json"
echo ""
# Confirmation prompt
echo "WARNING: This will permanently remove frontend node_modules, servers/frontend/.next,
# and servers/frontend/package-lock.json, and will delete all __pycache__ under servers/backend."
read -p "Type 'y' to proceed with hard reset (anything else aborts): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborting hard reset. No changes made."
    exit 0
fi

echo "Proceeding with hard reset..."

echo ""
echo "Removing frontend artifacts: node_modules, .next, package-lock.json"
rm -rf servers/frontend/node_modules
rm -rf servers/frontend/.next
rm -f servers/frontend/package-lock.json
echo "Done removing frontend artifacts"

echo ""
echo "Removing backend __pycache__ directories"
if [ -d "servers/backend" ]; then
    find servers/backend -type d -name '__pycache__' -prune -exec rm -rf {} + || true
    echo "Done removing backend __pycache__"
else
    echo "servers/backend not found; skipping __pycache__ removal"
fi

echo ""
echo "Running project-wide install: npm run install-all"
if command -v npm >/dev/null 2>&1; then
  npm run install-all
else
  echo "npm not found; cannot run 'npm run install-all'"
fi

echo ""
echo "=========================================="
echo "✅ Hard reset complete"
echo "=========================================="
echo "You can now run: npm run dev"

