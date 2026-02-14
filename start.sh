#!/bin/bash
# Start both backend (Flask) and frontend (npm run dev)
# Backend runs in the background; frontend stays in the foreground.

set -e

echo "Starting backend..."
(cd servers/backend && ./start_backend.sh) &
BACKEND_PID=$!

trap "echo 'Stopping backend (PID $BACKEND_PID)...'; kill $BACKEND_PID 2>/dev/null || true" EXIT INT

echo "Starting frontend (npm run dev)..."
cd servers/frontend
npm run dev
