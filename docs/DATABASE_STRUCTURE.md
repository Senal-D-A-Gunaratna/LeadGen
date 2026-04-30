# Database Structure

The system organizes data into separate SQLite files under `servers/backend/data/`.

## Database files

1. `servers/backend/data/students.db` — student records and backups
   - `students` table: student profiles and metadata
   - `backups` table: backup metadata

2. `servers/backend/data/attendance.db` — attendance history
   - `attendance_records` table: per-day attendance entries

3. `servers/backend/data/logs.db` — system logs
   - `action_logs` table: system actions
   - `auth_logs` table: authentication events

## Benefits

- Clear separation of concerns (students, attendance, logs)
- Smaller files improve query performance and reduce locking
- Easier targeted backups and restores

## Migration behavior

On first startup the backend will create the database files if missing and migrate any legacy JSON data into the appropriate DBs.

## Access pattern

Backend code uses a helper like `get_db_connection(db_type)` where `db_type` is one of `students`, `attendance`, or `logs` to open the appropriate SQLite file in `servers/backend/data/`.

## Passwords

Passwords and small credential data live in `servers/backend/data/passwords.json` (not in SQLite). Password helper routines in the backend read and update that JSON file; see `servers/backend/app.py` and `servers/backend/api_endpoints.py` for the exact helpers.


