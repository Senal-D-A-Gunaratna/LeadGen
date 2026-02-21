"""
Database models and initialization for SQLite databases.
SQLite .db files are the single source of truth for all data.
"""
import sqlite3
import shutil
from datetime import datetime
from typing import Dict, Optional
from pathlib import Path
import threading
import time

# Three separate database files
DATA_DIR = Path(__file__).resolve().parents[1] / 'database'
DATA_DIR.mkdir(parents=True, exist_ok=True)

STUDENTS_DB_PATH = DATA_DIR / 'students.db'
ATTENDANCE_DB_PATH = DATA_DIR / 'attendance.db'
LOGS_DB_PATH = DATA_DIR / 'logs.db'

# Backups directory structure (filesystem-level .db copies)
# Only students and attendance databases are backed up here.
BACKUPS_DIR = Path(__file__).resolve().parents[1] / 'backups'
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

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


# Callbacks invoked after a successful `recalculate_school_days()` run.
# External modules (e.g. app.py) can register a callback to be notified
# when the authoritative school_days table has been rebuilt.
_post_recalc_callbacks = []

# Callbacks invoked when the attendance DB file mtime changes.
# The watcher in this module will notify these callbacks and
# external modules (only `app.py` should register) should perform
# the actual recalculation and publishing work.
_post_mtime_change_callbacks = []

# Track last recalculation state for the attendance DB watcher
_last_recalc_mtime: float = 0.0
_recalc_done_event: threading.Event = threading.Event()
_recalc_done_event.set()

def register_post_recalc_callback(cb):
    """Register a callable to be invoked (safely) after each recalc.

    The callback will be called with no arguments. Exceptions raised by
    callbacks are caught and logged but do not stop other callbacks.
    """
    try:
        if cb not in _post_recalc_callbacks:
            _post_recalc_callbacks.append(cb)
    except Exception:
        pass


def register_post_mtime_change_callback(cb):
    """Register a callable to be invoked when the attendance DB file's
    modification time changes. Callbacks are invoked with no arguments
    and should run quickly or handle their own threading if necessary.
    """
    try:
        if cb not in _post_mtime_change_callbacks:
            _post_mtime_change_callbacks.append(cb)
    except Exception:
        pass


def unregister_post_mtime_change_callback(cb):
    try:
        if cb in _post_mtime_change_callbacks:
            _post_mtime_change_callbacks.remove(cb)
    except Exception:
        pass

def unregister_post_recalc_callback(cb):
    try:
        if cb in _post_recalc_callbacks:
            _post_recalc_callbacks.remove(cb)
    except Exception:
        pass


def create_db_file_backup(db_type: str, timestamp: Optional[str] = None) -> Path:
    """Create a filesystem-level backup copy of a .db file.
    
    Backups are stored under servers/backend/backups/<db_type>/ with timestamped filenames.
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
            phone TEXT NOT NULL,
            whatsapp_no TEXT DEFAULT '',
            email TEXT NOT NULL,
            specialRoles TEXT,
            notes TEXT,
            fingerprint1 TEXT DEFAULT '',
            fingerprint2 TEXT DEFAULT '',
            fingerprint3 TEXT DEFAULT '',
            fingerprint4 TEXT DEFAULT '',
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
            phone TEXT NOT NULL,
            whatsapp_no TEXT,
            email TEXT NOT NULL,
            specialRoles TEXT,
            notes TEXT,
            fingerprint1 TEXT DEFAULT '',
            fingerprint2 TEXT DEFAULT '',
            fingerprint3 TEXT DEFAULT '',
            fingerprint4 TEXT DEFAULT ''
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
    # Ensure `whatsapp_no` column exists on students table for older DBs
    try:
        cursor_students.execute("PRAGMA table_info(students)")
        cols = [r[1] for r in cursor_students.fetchall()]
        if 'whatsapp_no' not in cols:
            try:
                cursor_students.execute("ALTER TABLE students ADD COLUMN whatsapp_no TEXT DEFAULT ''")
            except Exception:
                # Best-effort: if ALTER fails (locked/busy), skip but do not crash
                pass
    except Exception:
        pass
    # Ensure `whatsapp_no` column is positioned after `phone` in the table schema.
    # SQLite doesn't support reordering columns directly, so recreate the table
    # with the desired column order and copy data if necessary.
    try:
        cursor_students.execute("PRAGMA table_info(students)")
        cols = [r[1] for r in cursor_students.fetchall()]
        desired_order = [
            'id', 'name', 'grade', 'className', 'role', 'phone', 'whatsapp_no', 'email',
            'specialRoles', 'notes', 'fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4',
            'created_at', 'updated_at'
        ]
        # If whatsapp_no exists but not directly after phone, rebuild table
        if 'whatsapp_no' in cols:
            try:
                phone_index = cols.index('phone')
                # Safe check: if whatsapp_no not immediately after phone, rebuild
                needs_rebuild = not (phone_index + 1 < len(cols) and cols[phone_index + 1] == 'whatsapp_no')
            except ValueError:
                needs_rebuild = True
        else:
            needs_rebuild = False

        if needs_rebuild:
            try:
                # Build CREATE TABLE statement with desired column order matching existing constraints
                cursor_students.execute('BEGIN')
                cursor_students.execute('''
                    CREATE TABLE IF NOT EXISTS students_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        grade INTEGER NOT NULL,
                        className TEXT NOT NULL,
                        role TEXT,
                        phone TEXT NOT NULL,
                        whatsapp_no TEXT DEFAULT '',
                        email TEXT NOT NULL,
                        specialRoles TEXT,
                        notes TEXT,
                        fingerprint1 TEXT DEFAULT '',
                        fingerprint2 TEXT DEFAULT '',
                        fingerprint3 TEXT DEFAULT '',
                        fingerprint4 TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Prepare column list for insert/select mapping. For any missing columns in the
                # source table, provide empty/default values.
                cursor_students.execute("PRAGMA table_info(students)")
                src_cols = [r[1] for r in cursor_students.fetchall()]

                select_expressions = []
                for col in desired_order:
                    if col in src_cols:
                        select_expressions.append(col)
                    else:
                        # Provide reasonable default for missing columns
                        if col in ('id', 'grade'):
                            select_expressions.append('0 AS ' + col)
                        else:
                            select_expressions.append("'' AS " + col)

                cursor_students.execute(f"INSERT INTO students_new ({', '.join(desired_order)}) SELECT {', '.join(select_expressions)} FROM students")
                cursor_students.execute('DROP TABLE students')
                cursor_students.execute('ALTER TABLE students_new RENAME TO students')
                cursor_students.execute('COMMIT')
            except Exception:
                try:
                    cursor_students.execute('ROLLBACK')
                except Exception:
                    pass
    except Exception:
        # Don't crash initialization on rebuild errors; it's best-effort.
        pass
    
    conn_students.commit()
    conn_students.close()
    
    # ========== ATTENDANCE DATABASE ==========
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    
    cursor_attendance.execute('''
        CREATE TABLE IF NOT EXISTS attendance_records (
            student_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('on time', 'late', 'absent')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            check_in_time TEXT,
            PRIMARY KEY (student_id, date)
        )
    ''')
    # Table to record which dates are considered school days.
    # A date becomes a school day if it appears in `attendance_records` (any status).
    cursor_attendance.execute('''
        CREATE TABLE IF NOT EXISTS school_days (
            date TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    # Populate initial school_days from any existing attendance_records (all statuses)
    try:
        conn_att = get_db_connection('attendance')
        cur = conn_att.cursor()
        # Normalize status comparison to avoid missing rows due to casing/whitespace
        cur.execute("INSERT OR IGNORE INTO school_days (date, created_at) SELECT date, MIN(created_at) FROM attendance_records GROUP BY date")
        conn_att.commit()
        conn_att.close()
    except Exception:
        # Non-fatal: if population fails (locked/busy), we'll populate incrementally on new inserts
        pass
    
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
        cur.execute('SELECT check_in_time FROM attendance_records WHERE student_id = ? AND date = ?', (student_id, date_str))
        row = cur.fetchone()
        if not row:
            # Insert new record; do NOT write 'absent' into the DB. Use a neutral
            # present status (late) here — absence is derived from missing
            # records against `school_days` rather than stored explicitly.
            cur.execute('''
                INSERT INTO attendance_records (student_id, date, status, created_at, updated_at, check_in_time)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (student_id, date_str, 'late', datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat(), incoming_utc_iso))
            conn.commit()
            return incoming_utc_iso

        existing_iso = row['check_in_time']
        # If existing is None or incoming is earlier, update
        if existing_iso is None:
            cur.execute('UPDATE attendance_records SET check_in_time = ?, updated_at = ? WHERE student_id = ? AND date = ?', (incoming_utc_iso, datetime.now(timezone.utc).isoformat(), student_id, date_str))
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
                cur.execute('UPDATE attendance_records SET check_in_time = ?, updated_at = ? WHERE student_id = ? AND date = ?', (incoming_utc_iso, datetime.utcnow().isoformat(), student_id, date_str))
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


def recalculate_school_days():
    """Rebuild the `school_days` table from attendance_records.

    A date is considered a school day if it appears in the
    `attendance_records` table for that date (regardless of status).
    """
    # Signal recalculation in progress to any waiters and update last mtime
    global _recalc_lock, _recalc_done_event, _last_recalc_mtime
    try:
        if '_recalc_lock' not in globals():
            _recalc_lock = threading.Lock()
        if '_recalc_done_event' not in globals():
            _recalc_done_event = threading.Event()
            _recalc_done_event.set()
        if '_last_recalc_mtime' not in globals():
            _last_recalc_mtime = 0

        # Acquire lock to ensure single recalculation at a time
        with _recalc_lock:
            _recalc_done_event.clear()
            conn = get_db_connection('attendance')
            cur = conn.cursor()
            try:
                # Replace contents atomically using a transaction
                cur.execute('BEGIN IMMEDIATE')
                # Clear table then insert distinct dates present in attendance_records
                cur.execute('DELETE FROM school_days')
                # Normalize status comparison to avoid missing rows due to casing/whitespace
                cur.execute("INSERT OR IGNORE INTO school_days (date, created_at) SELECT date, MIN(created_at) FROM attendance_records GROUP BY date")
                conn.commit()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            finally:
                try:
                    conn.close()
                except Exception:
                    pass

            # Update last mtime for attendance DB file
            try:
                _last_recalc_mtime = ATTENDANCE_DB_PATH.stat().st_mtime
            except Exception:
                _last_recalc_mtime = time.time()
            _recalc_done_event.set()

            # Notify registered callbacks AFTER recalculation completes so
            # external modules (e.g. app.py) can react (broadcast WS events, refresh caches).
            try:
                for cb in list(_post_recalc_callbacks):
                    try:
                        cb()
                    except Exception:
                        # Swallow callback errors to avoid breaking recalculation flow
                        pass
            except Exception:
                pass
    except Exception:
        # Ensure event is set on unexpected failure to avoid hangs
        try:
            _recalc_done_event.set()
        except Exception:
            pass


def ensure_recalculated(timeout: float = 5.0):
    """Ensure school_days is up-to-date with the attendance DB file.

    If the attendance DB file modification time is newer than the last
    recalculation, run a recalculation synchronously (or wait for ongoing one).
    """
    global _last_recalc_mtime, _recalc_done_event
    try:
        mtime = ATTENDANCE_DB_PATH.stat().st_mtime
    except Exception:
        mtime = 0

    if '_last_recalc_mtime' not in globals():
        _last_recalc_mtime = 0
    if '_recalc_done_event' not in globals():
        _recalc_done_event = threading.Event()
        _recalc_done_event.set()

    # If file changed since last recalculation, perform recalc now
    if mtime > _last_recalc_mtime:
        # If already recalculating, wait until done
        if not _recalc_done_event.is_set():
            _recalc_done_event.wait(timeout=timeout)
            return
        # Otherwise perform recalculation synchronously
        recalculate_school_days()


def start_attendance_watcher(poll_interval: float = 1.0):
    """Start a background thread that watches the attendance DB file for changes
    and triggers `recalculate_school_days()` when it is modified.
    """
    def _watcher():
        last_mtime = 0
        try:
            last_mtime = ATTENDANCE_DB_PATH.stat().st_mtime
        except Exception:
            last_mtime = 0
        while True:
            try:
                try:
                    mtime = ATTENDANCE_DB_PATH.stat().st_mtime
                except Exception:
                    mtime = 0
                if mtime != last_mtime:
                    # Notify registered mtime-change callbacks instead
                    # of performing recalculation here. The application
                    # layer (`app.py`) is responsible for performing the
                    # authoritative `recalculate_school_days()` and
                    # publishing changes to clients.
                    try:
                        for cb in list(_post_mtime_change_callbacks):
                            try:
                                cb()
                            except Exception:
                                pass
                    except Exception:
                        pass
                    last_mtime = mtime
                time.sleep(poll_interval)
            except Exception:
                # On unexpected watcher failure, sleep a bit and continue
                time.sleep(poll_interval)

    t = threading.Thread(target=_watcher, daemon=True, name='attendance-db-watcher')
    t.start()
    # Ensure we perform an initial recalculation on startup so `school_days`
    # reflects the current attendance records even if the file mtime hasn't
    # changed since the process started. Do this in a background thread to
    # avoid blocking the caller.
    def _initial_recalc():
        # On startup, notify mtime-change callbacks once so the
        # application layer can perform an initial recalculation and
        # publish initial state.
        try:
            for cb in list(_post_mtime_change_callbacks):
                try:
                    cb()
                except Exception:
                    pass
        except Exception:
            pass

    ti = threading.Thread(target=_initial_recalc, daemon=True, name='attendance-db-initial-recalc')
    ti.start()


def get_school_days():
    """Return list of school_day dates (strings) ordered."""
    conn = get_db_connection('attendance')
    cur = conn.cursor()
    cur.execute("SELECT date FROM school_days ORDER BY date")
    rows = [r['date'] for r in cur.fetchall()]
    try:
        conn.close()
    except Exception:
        pass
    return rows


def get_school_days_count() -> int:
    """Return the number of school days (rows in school_days)."""
    conn = get_db_connection('attendance')
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS cnt FROM school_days")
    row = cur.fetchone()
    try:
        conn.close()
    except Exception:
        pass
    try:
        return int(row['cnt']) if row and row['cnt'] is not None else 0
    except Exception:
        return 0


def get_student_attendance_summary(student_id: int) -> Dict:
    """
    Compute per-student attendance summary based on authoritative `school_days`:
      - total_school_days
      - present_days (distinct dates with status 'on time' or 'late' that are in school_days)
      - on_time count, late count
      - absent_days = total_school_days - present_days
      - presence_percentage = (present_days / total_school_days) * 100 (rounded to 1 decimal)
    Note: 'absent' is never written to the DB; absences are derived from missing records on school_days.
    """
    total_days = get_school_days_count()
    conn = get_db_connection('attendance')
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(DISTINCT date) AS present
        FROM attendance_records
        WHERE student_id = ?
          AND TRIM(LOWER(status)) IN ('on time','late')
          AND date IN (SELECT date FROM school_days)
    """, (student_id,))
    row = cur.fetchone()
    present = int(row['present']) if row and row['present'] is not None else 0

    cur.execute("""
        SELECT TRIM(LOWER(status)) AS status, COUNT(*) AS cnt
        FROM attendance_records
        WHERE student_id = ?
          AND TRIM(LOWER(status)) IN ('on time','late')
          AND date IN (SELECT date FROM school_days)
        GROUP BY TRIM(LOWER(status))
    """, (student_id,))
    ontime = 0
    late = 0
    for r in cur.fetchall():
        s = r['status']
        if s == 'on time':
            ontime = int(r['cnt'])
        elif s == 'late':
            late = int(r['cnt'])
    try:
        conn.close()
    except Exception:
        pass

    absent = max(0, total_days - present)
    presence_percentage = round((present / total_days) * 100, 1) if total_days > 0 else 0.0

    return {
        'student_id': student_id,
        'total_school_days': total_days,
        'present_days': present,
        'on_time': ontime,
        'late': late,
        'absent_days': absent,
        'presence_percentage': presence_percentage
    }

