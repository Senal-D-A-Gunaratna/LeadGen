# Quick Start Guide

This guide will help you get the project running from the project folder

**please note that all comands listed on this file must be runed from project root**

## Prerequisites Check

Make sure you have:
- Node.js v18+
- Python v3.8+
- npm

## Quick Setup

1. **Navigate to the project folder:**
   ```bash
   cd /home/Senal/leadgen/studio-main
   ```

2. **Run the setup script (optional but recommended):**

   ```bash
   cd tools/shell_scripts
   ./setup.sh
   ```
   
   Or manually:

   ```bash
   # Install frontend dependencies
   cd servers/frontend
   npm install
   cd ..
   
   # Install backend dependencies (must be in servers/backend directory)
   cd servers/backend
   pip3 install -r requirements.txt
   cd ..
   ```

3. **Start both servers:**
 
   ```bash
   npm run dev
   ```

   This will start:
   - Frontend at http://localhost:9002
               or http://server_IP:9002
   - Backend at http://localhost:5000
               or http://server_IP:5000

## Running from Project Root

All scripts in `package.json` are designed to work from the project root directory (`/home/Senal/leadgen/studio-main`):

- `npm run dev` - Runs both frontend and backend
- `npm run dev-backend` - Runs only the Flask backend
- `npm run dev-frontend` - Runs only the Next.Js frontendend
- `npm run install-backend` - Installs Python dependencies
- `npm run install-frontend` - Installs Next.Js depandencies
- 
## Important Notes

- All paths in the codebase are **relative**, so the project will work from any location as long as you run commands from the project root
- The backend creates databases in `servers/backend/data/` automatically
- Environment variables are in `.env.local` (created automatically if missing)
- The backend will migrate existing JSON data to SQLite on first run

## Troubleshooting

**"Cannot find module '../src/defaults'" error (concurrently issue):**

```bash
# Fix the corrupted concurrently installation
cd tools/shell_scripts
./fix-setup.sh
```

```bash
# Fix manually:
rm -rf node_modules/.bin/concurrently node_modules/concurrently
npm install concurrently@^8.2.2 --save-dev
```

**"requirements.txt not found" error:**
- Make sure you're in the `servers/backend/` directory when running pip:
- 
   ```bash
   cd servers/backend
   pip3 install -r requirements.txt
   cd ..
   ```

**Backend won't start:**
- Make sure Python 3.8+ is installed
- Install dependencies: `cd backend && pip3 install -r requirements.txt`
- Check that port 5000 is not in use

**Frontend can't connect to backend:**
- Verify backend is running on port 5000
- Check `.env.local` has `NEXT_PUBLIC_BACKEND_URL=http://localhost:5000`
- Check browser console for connection errors

**Database issues:**
- Run integrity check: `cd servers/backend && python3 check_integrity.py`
- Run cleanup if needed: `cd servers/backend && python3 cleanup_databases.py`
