# Migration to Flask Backend with WebSocket

This document describes the migration from Next.js server actions to Flask backend with WebSocket support.

## What Changed

### Backend
- **Replaced**: Next.js server actions (file-based JSON storage)
- **With**: Flask backend with SQLite database
- **Added**: WebSocket support for real-time updates
- **Location**: `backend/` folder

### Frontend
- **Kept**: All UI components and functionality (no breaking changes)
- **Updated**: API calls now go to Flask backend instead of Next.js API routes
- **Replaced**: Long-polling with WebSocket connections
- **Added**: WebSocket client for real-time updates

## Setup Instructions

### 1. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

Or use the startup script:
```bash
cd backend
./start.sh
```

### 2. Install Frontend Dependencies

```bash
npm install
```

This will install `socket.io-client` for WebSocket support.

### 3. Configure Backend URL

Create a `.env.local` file in the root directory:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
```

### 4. Run Both Servers

**Option 1: Use npm script (recommended)**
```bash
npm run dev
```

This runs both Next.js frontend (port 9002) and Flask backend (port 5000) concurrently.

**Option 2: Run separately**
```bash
# Terminal 1: Frontend
npm run dev-next

# Terminal 2: Backend
cd backend
python app.py
```

## Database Migration

The Flask backend will automatically:
1. Create SQLite database at `backend/data/attendance.db`
2. Migrate existing JSON data from `src/lib/` on first run
3. Set up all required tables

## WebSocket Features

- **Real-time Updates**: All data changes are broadcast to connected clients
- **Student Scanning**: Uses WebSocket for instant scan responses
- **Authentication**: Can authenticate via WebSocket (currently using REST for login)

## API Endpoints

All endpoints are now at `http://localhost:5000/api/`:

- Student operations: `/api/get-filtered-students`, `/api/add-student`, etc.
- Attendance: `/api/save-attendance`, `/api/get-student-by-id`, etc.
- Backups: `/api/create-backup`, `/api/restore-backup`, etc.
- Exports: `/api/download-student-data-csv`, `/api/download-attendance-summary-pdf`, etc.

## WebSocket Events

**Client → Server:**
- `authenticate` - Authenticate with role and password
- `scan_student` - Scan a student fingerprint

**Server → Client:**
- `auth_response` - Authentication result
- `scan_response` - Scan result
- `data_changed` - Broadcast when any data changes

## What's Preserved

✅ All UI components work exactly the same
✅ All functionality preserved
✅ Same API contract (function signatures unchanged)
✅ Role-based access control
✅ Backup/restore system
✅ CSV/JSON/PDF exports
✅ Attendance tracking logic
✅ Statistics and charts

## What's New

✨ Real-time updates via WebSocket (no more polling)
✨ SQLite database (more reliable than JSON files)
✨ Active backend that syncs changes to all clients
✨ Better separation of concerns (frontend/backend)

## Troubleshooting

**Backend won't start:**
- Make sure Python 3.8+ is installed
- Install dependencies: `pip install -r requirements.txt`
- Check port 5000 is not in use

**Frontend can't connect:**
- Verify backend is running on port 5000
- Check `NEXT_PUBLIC_BACKEND_URL` in `.env.local`
- Check browser console for connection errors

**WebSocket connection fails:**
- Ensure Flask backend is running
- Check CORS settings in `backend/app.py`
- Verify `socket.io-client` is installed in frontend

## Next Steps

The system is now ready to use! The frontend will automatically connect to the Flask backend and use WebSocket for real-time updates.

