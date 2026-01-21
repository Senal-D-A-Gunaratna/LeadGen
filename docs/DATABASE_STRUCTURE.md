# Database Structure

The system now uses **3 separate SQLite database files** for better organization:

## Database Files

1. **`backend/data/students.db`** - Student data
   - `students` table - All student information
   - `backups` table - Backup metadata

2. **`backend/data/attendance.db`** - Attendance history
   - `attendance_records` table - All attendance records

3. **`backend/data/logs.db`** - System logs
   - `action_logs` table - System action logs
   - `auth_logs` table - Authentication logs

## Benefits of Separate Databases

- **Better organization**: Each database has a clear purpose
- **Improved performance**: Smaller databases are faster to query
- **Easier backups**: Can backup each database independently
- **Reduced locking**: Less contention between different operations

## Migration

On first startup, the system will:
1. Create all 3 database files
2. Migrate existing JSON data to the appropriate databases
3. Set up all required tables

## Database Access

All database operations use `get_db_connection(db_type)` where `db_type` is:
- `'students'` - For student data, backups
- `'attendance'` - For attendance records
- `'logs'` - For action and auth logs

## Password Storage

**Passwords are stored in JSON file only**: `src/lib/passwords.json`
- Not stored in SQLite
- Managed by helper functions in `app.py` and `api_endpoints.py`

