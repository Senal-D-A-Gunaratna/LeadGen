"""
Database models and initialization for SQLite databases.
SQLite .db files are the single source of truth for all data.
"""
import sqlite3
import shutil
from datetime import datetime
from typing import Dict, Optional
from pathlib import Path

# Three separate database files
DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)

STUDENTS_DB_PATH = DATA_DIR / 'students.db'
ATTENDANCE_DB_PATH = DATA_DIR / 'attendance.db'
LOGS_DB_PATH = DATA_DIR / 'logs.db'

# Backups directory structure (filesystem-level .db copies)
# Only students and attendance databases are backed up here.
BACKUPS_DIR = Path(__file__).parent / 'backups'
BACKUPS_DIR.mkdir(exist_ok=True)

DB_BACKUP_DIRS: Dict[str, Path] = {
    'students': BACKUPS_DIR / 'students',
    'attendance': BACKUPS_DIR / 'attendance',
}
for _dir in DB_BACKUP_DIRS.values():
    _dir.mkdir(parents=True, exist_ok=True)

def get_db_connection(db_type: str = 'students'):
    """Get a database connection with proper timeout for concurrent access.
    
    Args:
        db_type: 'students', 'attendance', or 'logs'
    """
    if db_type == 'students':
        db_path = STUDENTS_DB_PATH
    elif db_type == 'attendance':
        db_path = ATTENDANCE_DB_PATH
    elif db_type == 'logs':
        db_path = LOGS_DB_PATH
    else:
        raise ValueError(f"Invalid db_type: {db_type}. Must be 'students', 'attendance', or 'logs'")
    
    conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=20.0)
    conn.row_factory = sqlite3.Row
    # Enable WAL mode for better concurrent access
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=20000')  # 20 second timeout
        conn.execute('PRAGMA synchronous=NORMAL')  # Better performance with WAL
    except:
        pass  # Ignore if already set
    return conn


def create_db_file_backup(db_type: str, timestamp: Optional[str] = None) -> Path:
    """Create a filesystem-level backup copy of a .db file.
    
    Backups are stored under backend/backups/<db_type>/ with timestamped filenames.
    """
    if db_type not in ('students', 'attendance'):
        raise ValueError(f"Invalid db_type for backup: {db_type}")
    
    if timestamp is None:
        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
    
    if db_type == 'students':
        db_path = STUDENTS_DB_PATH
    else:
        db_path = ATTENDANCE_DB_PATH
    
    backup_dir = DB_BACKUP_DIRS[db_type]
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    # Match logical backup naming used in the UI / database
    # e.g. students-backup-<timestamp>.db, attendance-backup-<timestamp>.db
    filename = f"{db_path.stem}-backup-{timestamp}.db"
    target = backup_dir / filename
    shutil.copy2(db_path, target)
    return target

class DatabaseContext:
    """Context manager for database connections to ensure proper cleanup."""
    def __init__(self, db_type: str = 'students'):
        self.conn = None
        self.db_type = db_type
    
    def __enter__(self):
        self.conn = get_db_connection(self.db_type)
        return self.conn
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn:
            try:
                self.conn.close()
            except:
                pass
        return False

def init_database():
    """Initialize all three databases with required tables."""
    
    # ========== STUDENTS DATABASE ==========
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    cursor_students.execute('''
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            grade INTEGER NOT NULL,
            className TEXT NOT NULL,
            role TEXT,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            fingerprint1 TEXT DEFAULT '',
            fingerprint2 TEXT DEFAULT '',
            fingerprint3 TEXT DEFAULT '',
            fingerprint4 TEXT DEFAULT '',
            specialRoles TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Fingerprints table: normalized mapping of students to fingerprint IDs
    cursor_students.execute('''
        CREATE TABLE IF NOT EXISTS student_fingerprints_id (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            fingerprint TEXT NOT NULL,
            position INTEGER NOT NULL, -- 1..4 to indicate slot
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_id, position)
        )
    ''')

    # Backups table (in students DB) - legacy JSON-based, kept for compatibility but not used
    cursor_students.execute('''
        CREATE TABLE IF NOT EXISTS backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_type TEXT NOT NULL CHECK(data_type IN ('students', 'attendance')),
            filename TEXT NOT NULL,
            data TEXT NOT NULL,
            is_frozen INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Ensure no attendance backups are stored in the students database
    try:
        cursor_students.execute("DELETE FROM backups WHERE data_type = 'attendance'")
    except Exception:
        # If the column/check doesn't exist for some reason, ignore
        pass

    # Relational backup tables for students (no JSON storage)
    cursor_students.execute('''
        CREATE TABLE IF NOT EXISTS student_backup_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            is_frozen INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor_students.execute('''
        CREATE TABLE IF NOT EXISTS student_backup_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            backup_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            grade INTEGER NOT NULL,
            className TEXT NOT NULL,
            role TEXT,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            fingerprint1 TEXT DEFAULT '',
            fingerprint2 TEXT DEFAULT '',
            fingerprint3 TEXT DEFAULT '',
            fingerprint4 TEXT DEFAULT '',
            specialRoles TEXT,
            notes TEXT
        )
    ''')

    # Clear any legacy JSON backups from students.backups
    try:
        cursor_students.execute('DELETE FROM backups')
    except Exception:
        pass

    # One-time migration: copy legacy fingerprint1-4 columns into student_fingerprints_id
    try:
        # Only run if student_fingerprints_id is empty but students has rows
        cursor_students.execute('SELECT COUNT(*) FROM student_fingerprints_id')
        has_fp_rows = cursor_students.fetchone()[0] > 0
        if not has_fp_rows:
            # If old table student_fingerprints exists, migrate from it first
            cursor_students.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name='student_fingerprints'
            """)
            old_exists = cursor_students.fetchone() is not None
            if old_exists:
                cursor_students.execute('SELECT student_id, fingerprint, position FROM student_fingerprints')
                for row in cursor_students.fetchall():
                    cursor_students.execute('''
                        INSERT OR IGNORE INTO student_fingerprints_id (student_id, fingerprint, position)
                        VALUES (?, ?, ?)
                    ''', (row['student_id'], row['fingerprint'], row['position']))
            else:
                # Fallback: migrate from legacy columns on students table
                cursor_students.execute('SELECT id, fingerprint1, fingerprint2, fingerprint3, fingerprint4 FROM students')
                rows = cursor_students.fetchall()
                for row in rows:
                    student_id = row['id']
                    for position, col in enumerate(['fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4'], start=1):
                        value = row[col]
                        if value:
                            cursor_students.execute('''
                                INSERT OR IGNORE INTO student_fingerprints_id (student_id, fingerprint, position)
                                VALUES (?, ?, ?)
                            ''', (student_id, value, position))
    except Exception:
        # If the table doesn't exist or other error, skip migration
        pass
    
    conn_students.commit()
    conn_students.close()
    
    # ========== ATTENDANCE DATABASE ==========
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    
    cursor_attendance.execute('''
        CREATE TABLE IF NOT EXISTS attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('on time', 'late', 'absent')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_id, date)
        )
    ''')
    # Ensure `check_in_time` column exists; if not, add it and populate existing rows.
    # Make migration resilient to busy/locked DB and run multiple retries if necessary.
    try:
        cursor_attendance.execute("PRAGMA table_info(attendance_records)")
        cols = [r[1] for r in cursor_attendance.fetchall()]
        if 'check_in_time' not in cols:
            now_iso = datetime.now().isoformat()
            tried = 0
            last_err = None
            import time as _time
            # Increase attempts to reduce races on busy systems
            max_attempts = 12
            while tried < max_attempts:
                try:
                    # Ensure PRAGMA settings for this connection
                    try:
                        conn_attendance.execute('PRAGMA journal_mode=WAL')
                        conn_attendance.execute('PRAGMA busy_timeout=20000')
                    except Exception:
                        pass

                    cursor_attendance.execute("ALTER TABLE attendance_records ADD COLUMN check_in_time TEXT")
                    # Populate existing rows with NULL (or timestamp) where appropriate
                    try:
                        cursor_attendance.execute("UPDATE attendance_records SET check_in_time = ? WHERE check_in_time IS NULL", (now_iso,))
                    except Exception:
                        pass
                    conn_attendance.commit()
                    # Re-check to ensure column now present
                    cursor_attendance.execute("PRAGMA table_info(attendance_records)")
                    cols_after = [r[1] for r in cursor_attendance.fetchall()]
                    if 'check_in_time' in cols_after:
                        break
                    # If not present despite successful ALTER, try again
                    tried += 1
                    _time.sleep(0.1 * tried)
                except sqlite3.OperationalError as e:
                    last_err = e
                    # If DB is locked or busy, wait a bit and retry
                    errstr = str(e).lower()
                    if 'locked' in errstr or 'busy' in errstr:
                        _time.sleep(0.15 * (tried + 1))
                        tried += 1
                        continue
                    # If column already exists due to race, treat as success
                    if 'duplicate column name' in errstr or 'already exists' in errstr:
                        break
                    # Other operational errors - stop retrying
                    break
            else:
                # Exhausted retries; log last error but continue (do not crash server)
                try:
                    import sys
                    print('Warning: failed to add check_in_time column after retries:', last_err, file=sys.stderr)
                except Exception:
                    pass
    except Exception:
        # If PRAGMA fails, skip migration but keep DB usable
        pass
    # Legacy JSON-based backups table (kept for compatibility but not used)
    cursor_attendance.execute('''
        CREATE TABLE IF NOT EXISTS backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_type TEXT NOT NULL CHECK(data_type IN ('attendance')),
            filename TEXT NOT NULL,
            data TEXT NOT NULL,
            is_frozen INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Relational backup tables for attendance (no JSON storage)
    cursor_attendance.execute('''
        CREATE TABLE IF NOT EXISTS attendance_backup_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            is_frozen INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor_attendance.execute('''
        CREATE TABLE IF NOT EXISTS attendance_backup_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            backup_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('on time', 'late', 'absent'))
        )
    ''')

    # Clear any legacy JSON backups from attendance.backups
    try:
        cursor_attendance.execute('DELETE FROM backups')
    except Exception:
        pass
    
    conn_attendance.commit()
    conn_attendance.close()
    
    # ========== LOGS DATABASE ==========
    conn_logs = get_db_connection('logs')
    cursor_logs = conn_logs.cursor()
    
    cursor_logs.execute('''
        CREATE TABLE IF NOT EXISTS action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor_logs.execute('''
        CREATE TABLE IF NOT EXISTS auth_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn_logs.commit()
    conn_logs.close()


def migrate_json_to_sqlite():
    """
    Legacy no-op kept for backwards compatibility.
    
    Older versions of the project stored data in JSON and used this function
    to migrate into SQLite. The current version uses SQLite as the single
    source of truth, so there is nothing left to migrate, but the symbol
    is still imported and called from app.py.
    """
    return


# Initialize database on import
init_database()


def get_earliest_checkin(student_id: int, date_str: str):
    """
    Return the earliest check_in_time (ISO UTC string) for a student/date, or None.
    """
    conn = get_db_connection('attendance')
    cur = conn.cursor()
    cur.execute('SELECT check_in_time FROM attendance_records WHERE student_id = ? AND date = ?', (student_id, date_str))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return row['check_in_time']


def save_checkin_utc(student_id: int, date_str: str, incoming_utc_iso: str):
    """
    Save a check-in timestamp for student/date using a transaction that ensures
    the earliest check-in is preserved. Returns the earliest check_in_time (ISO UTC).

    incoming_utc_iso should be an ISO-8601 string in UTC (e.g. datetime.utcnow().isoformat()).
    """
    import sqlite3
    from datetime import datetime, timezone

    conn = get_db_connection('attendance')
    cur = conn.cursor()
    try:
        # Begin an immediate transaction to avoid write/write races on SQLite
        cur.execute('BEGIN IMMEDIATE')
        cur.execute('SELECT id, check_in_time FROM attendance_records WHERE student_id = ? AND date = ?', (student_id, date_str))
        row = cur.fetchone()
        if not row:
            # Insert new record; status will be computed by caller after we return the earliest time
            cur.execute('''
                INSERT INTO attendance_records (student_id, date, status, created_at, updated_at, check_in_time)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (student_id, date_str, 'absent', datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat(), incoming_utc_iso))
            conn.commit()
            return incoming_utc_iso

        existing_iso = row['check_in_time']
        # If existing is None or incoming is earlier, update
        if existing_iso is None:
            cur.execute('UPDATE attendance_records SET check_in_time = ?, updated_at = ? WHERE id = ?', (incoming_utc_iso, datetime.now(timezone.utc).isoformat(), row['id']))
            conn.commit()
            return incoming_utc_iso

        try:
            existing_dt = datetime.fromisoformat(existing_iso)
        except Exception:
            # If parse fails, treat incoming as earlier (be conservative)
            existing_dt = None

        try:
            incoming_dt = datetime.fromisoformat(incoming_utc_iso)
        except Exception:
            incoming_dt = None

        # If either parse failed, prefer the non-null; otherwise compare
        if existing_dt is None:
            chosen = incoming_utc_iso
        elif incoming_dt is None:
            chosen = existing_iso
        else:
            # Ensure both are timezone-aware UTC for accurate compare
            if existing_dt.tzinfo is None:
                existing_dt = existing_dt.replace(tzinfo=timezone.utc)
            if incoming_dt.tzinfo is None:
                incoming_dt = incoming_dt.replace(tzinfo=timezone.utc)
            if incoming_dt < existing_dt:
                # Update to earlier time
                cur.execute('UPDATE attendance_records SET check_in_time = ?, updated_at = ? WHERE id = ?', (incoming_utc_iso, datetime.utcnow().isoformat(), row['id']))
                conn.commit()
                chosen = incoming_utc_iso
            else:
                chosen = existing_iso

        return chosen
    finally:
        try:
            conn.close()
        except Exception:
            pass

