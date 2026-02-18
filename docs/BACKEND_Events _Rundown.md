# Backend events and endpoints (overview)

This file summarizes the main backend API routes and WebSocket events as implemented in the repository. For running the backend and starting services, consult `docs/QUICKSTART.md`.

## Database

The backend uses SQLite files under `servers/backend/data/`. On first run the backend will create missing DB files and migrate legacy JSON stores into SQLite where applicable.

## Representative API endpoints

The backend exposes REST endpoints under `/api/`. Representative routes include:

- `GET /api/students` — return filtered student snapshots (query params for date, searchQuery, statusFilter, gradeFilter, classFilter, roleFilter)
- `GET /api/students/:id` — return a single student profile
- `POST /api/save-attendance` — save attendance records
- `POST /api/add-student` — add a new student
- `PUT /api/students/:id` — update an existing student
- `DELETE /api/students/:id` — remove a student
- `POST /api/validate-password` — validate a password
- `POST /api/update-passwords` — update password data
- `GET /api/get-current-time` — server time endpoint

For the full and authoritative list, inspect `servers/backend/api_endpoints.py`.

## WebSocket events

Common socket events used by the system:

- `authenticate` — authenticate a socket connection (role/password)
- `scan_student` — submit an automated scanner fingerprint payload
- `data_changed` — broadcasted after DB writes to notify clients of changes

The socket handling is implemented server-side and clients should subscribe to `data_changed` to receive notifications; payloads include `type` and optional `studentId` or `affectedIds`.

## Environment and frontend configuration

The frontend can be configured with `servers/frontend/.env.local`. If you want to override the backend URL, set `NEXT_PUBLIC_BACKEND_URL=http://<host>:5000` there. In typical LAN setups, the frontend auto-detects the host you used to access it and will contact the backend at the same host.


