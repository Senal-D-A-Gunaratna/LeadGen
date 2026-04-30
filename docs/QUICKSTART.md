# Quick Start Guide for LeadGen

Run these commands from the project root (`/home/Senal/leadgen/LeadGen`). This file centralizes installation and startup instructions; other docs reference it for setup steps.

## Prerequisites

- Node.js v18+ (LTS recommended)
- Python 3.8+
- npm

## Quick Setup (recommended)

1. From the project root, run the optional setup script to prepare environment and dependencies:

```bash
# from project root
bash tools/shell_scripts/setup.sh
```

2. If you prefer manual steps:

```bash
# Install frontend deps
cd servers/frontend
npm install
cd -

# Install backend deps
cd servers/backend
pip3 install -r requirements.txt
cd -
```

3. Start both services (development):

```bash
# from project root
npm run dev
```

Typical dev ports:
- Frontend: http://localhost:9002 (or http://<host_ip>:9002)
- Backend:  http://localhost:5000 (or http://<host_ip>:5000)

## Helpful npm scripts

Scripts are defined in the repository `package.json` (run from project root). Common ones include:

- `npm run dev` — runs both frontend and backend for development
- `npm run install-backend` — installs backend Python dependencies
- `npm run install-frontend` — installs frontend deps

Use `npm run` to list all available scripts.

## Environment files

- Frontend reads `servers/frontend/.env.local` for `NEXT_PUBLIC_BACKEND_URL` if provided. The app will auto-detect the backend hostname when accessed via a browser, so `.env.local` is optional for typical LAN use.

## Troubleshooting pointers

- Corrupted `concurrently` or `next` installs: run `bash tools/shell_scripts/fix-setup.sh` or the targeted fixes in `docs/FIX-ISSUES.md`.
- Backend dependency errors: ensure you're installing from `servers/backend` and that Python and pip are available.
- Backend port conflicts: ensure port 5000 is free or change backend port in configuration.
- If databases need repair: run `python3 servers/backend/check_integrity.py` and `python3 servers/backend/cleanup_databases.py` from the backend folder.

If you need step-by-step help for a specific error, see `docs/FIX-ISSUES.md`.
