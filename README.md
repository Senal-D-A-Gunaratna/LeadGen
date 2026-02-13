## LeadGen — School Prefect Attendance Monitor

Summary:
A compact, production-ready full-stack attendance management system pairing a Next.js (TypeScript) frontend with a Flask backend. Supports real-time updates via Socket.IO and stores data in local SQLite files for simple LAN or single-host deployments.

Key Capabilities:
- Real-time attendance marking and live dashboard synchronization
- Student profiles, search, role assignments (e.g., prefects)
- Fingerprint scanner integration hooks for fast check-ins
- Historical records, CSV import/export, and automated backups
- Role-based access control (Admin, Moderator, Developer)
- Lightweight migrations and data integrity checks

Architecture Overview:
- Frontend: Next.js + TypeScript, Tailwind CSS, Radix UI, Zustand state, Socket.IO client (port 9002)
- Backend: Flask + Flask-SocketIO, SQLite data stores, CORS & input validation (port 5000)
- Storage: Separate SQLite files (students, attendance, logs) under backend/data/

Quick Start (dev):
1. Backend:
   - create & activate venv, install requirements
   - run start_backend.sh or python app.py
2. Frontend:
   - npm install
   - npm run dev
3. Default endpoints:
   - Frontend: http://localhost:9002
   - Backend API: http://localhost:5000
   - Override backend: NEXT_PUBLIC_BACKEND_URL env var

Repository Layout (high level):
- backend/      — Flask app, API endpoints, utilities
- backend/data/ — students.db, attendance.db, logs.db (keep backups)
- frontend/     — Next.js app and UI components
- scripts: helper scripts for setup, fixes, and running services

Available Scripts:
- Frontend: npm run dev, build, start, lint, typecheck
- Backend: ./start_backend.sh, python app.py
- Helpers: bash fix-setup.sh, install-backend helper

Security & Deployment Notes:
- Intended primarily for LAN/trusted environments; secure for production behind TLS-terminating reverse proxy (e.g., nginx)
- Harden CORS, enable HTTPS, rotate default credentials, and restrict ports via firewall
- Do not expose SQLite files without proper backups and access controls

Operational Tips:
- Keep periodic backups of backend/data/*.db before destructive operations
- Use provided scripts to repair common environment issues
- Inspect backend logs for runtime errors; enable debug tools only for trusted developer role

Contributing & License:
- Fork, create branch, add changes and tests, open a pull request
- Licensed under MIT (see LICENSE file)

