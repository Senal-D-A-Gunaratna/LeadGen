# Flask Backend for LeadGen

This is the Flask backend that replaces the Next.js server actions with a Python-based API and WebSocket support.

## Setup

1. Install Python dependencies:
```bash
cd servers/backend
pip install -r requirements.txt
```

2. Run the backend:
```bash
python app.py
```

The backend will start on `http://localhost:5000` with WebSocket support enabled.

## Database

The backend uses SQLite for data storage. The database file is created at `servers/backend/data/attendance.db` on first run.

The database will automatically migrate existing JSON data from `src/lib/` on first startup.

## API Endpoints

All endpoints are prefixed with `/api/`:

- `POST /api/get-filtered-students` - Get filtered students
- `GET /api/get-student-by-id/<id>` - Get student by ID
- `POST /api/save-attendance` - Save attendance records
- `POST /api/add-student` - Add new student
- `DELETE /api/remove-student/<id>` - Remove student
- `PUT /api/update-student/<id>` - Update student
- `POST /api/validate-password` - Validate password
- `POST /api/update-passwords` - Update passwords
- `GET /api/get-current-time` - Get server time
- And many more...

## WebSocket Events

- `authenticate` - Authenticate with role and password
- `scan_student` - Scan a student fingerprint
- `data_changed` - Broadcast when data changes (listened by clients)

## Environment Variables

Set `NEXT_PUBLIC_BACKEND_URL` in your frontend `.env.local` to point to the Flask backend (default: `http://localhost:5000`). The frontend `.env.local` is located in `servers/frontend/.env.local` after the repository restructure.

