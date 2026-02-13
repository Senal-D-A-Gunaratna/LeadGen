# **LeadGen - The Next Generation School Prefect Attendance Monitor**

Overview
LeadGen is an attendance monitoring system intended for school environments. It combines a Next.js-based user interface with a Flask backend to provide real-time attendance capture, administrative controls for prefects and staff, and local data persistence via SQLite. The project is suitable for single-host or LAN deployments where simplicity and reliability are priorities.

Core technologies
- Frontend: Next.js (React) with TypeScript
- Styling: Tailwind CSS; optional Radix UI components
- State management: Zustand
- Real-time: Socket.IO (WebSockets)
- Backend: Flask with Flask-SocketIO
- Storage: SQLite databases stored in `backend/data/`

Primary capabilities
- Real-time attendance marking with live dashboard synchronization
- Student records management, search, and role assignments (e.g., prefect)
- Integration points for RFID/fingerprint scanners for rapid check-ins
- Historical records, CSV import/export, and automated local backups
- Role-based access control (Admin, Moderator, Developer)
- Lightweight migration tools and data integrity checks

Architecture (high level)
- Frontend runs on port 9002 and communicates with the backend API and Socket.IO server.
- Backend serves REST endpoints and Socket.IO events on port 5000 and stores data in local SQLite files: `students.db`, `attendance.db`, `logs.db`.

Quick start (development)
1. Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./start_backend.sh  # or: python app.py
```
2. Frontend
```bash
cd frontend
npm install
npm run dev
```
3. Defaults
<!--
Development servers
- Frontend: served on localhost:9002
- Backend: API and WebSockets: served on localhost:5000

Notes:
- Typo corrected: "Websokets" → "WebSockets"
- Start/backend should be running before the frontend; adjust PORT env vars if needed.
-->
- Frontend: http://localhost:9002 or http://host_ip:9002
- Backend API and WebSockets: http://localhost:5000 or http://host_ip:5000
- Replace <host> with your machine's IP/hostname when accessing from other devices on the network.
- To point the frontend to another backend, set `NEXT_PUBLIC_BACKEND_URL`.

Repository layout
- `backend/` — Flask application, API endpoints, utilities and helper scripts
- `backend/data/` — SQLite files (keep backups before changes)
- `frontend/` — Next.js application, components, and client code
- `docs/` — design notes and operational guidance

Operational notes
- Back up `backend/data/*.db` regularly before migrations or destructive operations.
- Use `bash fix-setup.sh` for common dependency fixes.
- Check `backend/log.txt` for runtime errors and diagnostic information.

Security and production guidance
- LeadGen is intended for trusted networks. For production, deploy behind a TLS-terminating reverse proxy (for example, nginx), enforce strict CORS rules, rotate default credentials, and restrict access to the database files.

Contributing and license
- Contributions: fork the repository, create a feature branch, add tests where appropriate, and open a pull request.
- License: MIT. See the `LICENSE` file for details.

For additional implementation details, consult the source under `backend/` and `frontend/` or review the documents in `docs/`.
