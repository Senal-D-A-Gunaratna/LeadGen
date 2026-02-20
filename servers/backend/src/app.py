"""
Flask backend application with WebSocket support.
Handles all API endpoints and real-time updates via WebSocket.
"""
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import socketio as socketio_module  # type: ignore[import]
import sqlite3
import json
from datetime import datetime, date, timezone
from pathlib import Path
import os
import logging
from logging.handlers import RotatingFileHandler
from typing import Dict, List, Optional
from servers.backend.database import get_db_connection, init_database, migrate_json_to_sqlite, DatabaseContext, save_checkin_utc, get_earliest_checkin, recalculate_school_days, ATTENDANCE_DB_PATH, get_student_attendance_summary, get_school_days_count, register_post_mtime_change_callback, start_attendance_watcher
import asyncio
from servers.backend.config import ATTENDANCE_ONTIME_END, ATTENDANCE_LATE_END, GRADES as CANONICAL_GRADES, PREFECT_ROLES as CANONICAL_PREFECT_ROLES, CLASSES as CANONICAL_CLASSES
from servers.backend.utils import compute_attendance_status
import csv
import io
import base64
import traceback

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
CORS(app, resources={r"/*": {"origins": "*"}})

# Configure logging: write DEBUG to `debug.log` and send INFO+ to console.
# Capture warnings and route most library logs into the root logger so
# `debug.log` contains nearly everything useful for debugging.
_log_dir = Path(__file__).resolve().parents[1]
_debug_log = _log_dir / 'debug.log'
_log_dir.mkdir(parents=True, exist_ok=True)

root_logger = logging.getLogger()
if not root_logger.handlers:
    root_logger.setLevel(logging.DEBUG)
    logging.captureWarnings(True)

    # File handler for debug-level logs (most details)
    debug_handler = RotatingFileHandler(str(_debug_log), maxBytes=10 * 1024 * 1024, backupCount=5)
    debug_handler.setLevel(logging.DEBUG)
    debug_fmt = logging.Formatter('%(asctime)s %(levelname)s [%(name)s] %(pathname)s:%(lineno)d %(message)s')
    debug_handler.setFormatter(debug_fmt)

    # Console handler for info+ to keep terminal output readable
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    info_fmt = logging.Formatter('%(asctime)s %(levelname)s [%(name)s] %(message)s')
    console.setFormatter(info_fmt)

    root_logger.addHandler(debug_handler)
    root_logger.addHandler(console)

    # Ensure common libraries produce DEBUG output and propagate to root logger
    for name in ('werkzeug', 'socketio', 'engineio', 'asyncio', 'uvicorn', 'uvicorn.error', 'uvicorn.access', 'aiohttp.access'):
        try:
            lg = logging.getLogger(name)
            lg.setLevel(logging.DEBUG)
            lg.propagate = True
        except Exception:
            pass

    # Make sure third-party modules that add their own handlers still propagate
    logging.getLogger().setLevel(logging.DEBUG)

# SSL Configuration for HTTPS
# Prefer project-local certs stored in servers/backend/certificates (localhost.pem/localhost-key.pem).
from pathlib import Path as _Path
# Adapter to convert Flask (WSGI) app to ASGI for uvicorn
from typing import Optional, Tuple

# Adapter type for converting Flask (WSGI) app to ASGI; default to None.
WsgiToAsgi: Optional[type] = None
try:
    from asgiref.wsgi import WsgiToAsgi as _WsgiToAsgi
    WsgiToAsgi = _WsgiToAsgi
except Exception:
    WsgiToAsgi = None
_repo_root = _Path(__file__).resolve().parents[1]
_cert_dir = _repo_root / 'certificates'
_cert_file = _cert_dir / 'localhost.pem'
_key_file = _cert_dir / 'localhost-key.pem'
if _cert_file.exists() and _key_file.exists():
    ssl_context: Optional[Tuple[str, str]] = (str(_cert_file), str(_key_file))
else:
    # Fall back to no SSL if certs are not available (dev only).
    ssl_context = None
    print('SSL certificates not found in servers/backend/certificates. Starting without TLS (HTTP).')

# Create an Async Socket.IO server and wrap the Flask WSGI app in an ASGI app.
# We create the AsyncServer via the python-socketio package and then build
# an ASGI application so we can run the whole app with an ASGI server
# (uvicorn). Let python-socketio auto-detect the best async implementation
# instead of forcing `async_mode='asyncio'`, which may raise `Invalid async_mode`
# in environments lacking the required async driver.
# Create AsyncServer and ASGI app. Pass the Flask `app` positionally for
# compatibility with different python-socketio versions.
# Create AsyncServer. Wrap the Flask WSGI app with WsgiToAsgi when available
# so the ASGIApp receives a proper ASGI callable for HTTP requests.
sio = socketio_module.AsyncServer(async_mode='asgi', cors_allowed_origins="*")
if WsgiToAsgi is not None:
    asgi_flask_app = WsgiToAsgi(app)
    # Pass the ASGI-wrapped Flask app as the second positional argument
    # to maintain compatibility with different python-socketio versions.
    asgi_app = socketio_module.ASGIApp(sio, asgi_flask_app)
else:
    # Fallback: pass the WSGI app directly (older python-socketio may handle it),
    # but this can trigger Flask.__call__ signature errors under ASGI servers.
    asgi_app = socketio_module.ASGIApp(sio, app)
# Keep the historical name `socketio` for in-file references (handlers,
# emit helpers) by pointing it at the AsyncServer instance.
socketio = sio


@app.errorhandler(Exception)
def handle_uncaught_exception(e):
    """Global exception handler: log traceback and return JSON for API clients.

    This prevents Flask's default HTML 500 page from being returned to
    API consumers (frontend), avoiding large HTML blobs reaching the UI.
    """
    tb = traceback.format_exc()
    try:
        print(f"[error] Uncaught exception:\n{tb}")
    except Exception:
        pass

    try:
        accept = request.headers.get('Accept', '')
        if (request.path and request.path.startswith('/api')) or ('application/json' in accept) or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': False, 'message': 'Internal server error', 'error': str(e)}), 500
    except Exception:
        pass

    # Fallback: return a concise JSON error to avoid HTML responses
    return jsonify({'success': False, 'message': 'Internal server error'}), 500

# Password file path
PASSWORDS_JSON_PATH = Path(__file__).resolve().parents[1] / 'data' / 'passwords.json'

def get_passwords() -> Dict[str, str]:
    """Read passwords from JSON file."""
    if PASSWORDS_JSON_PATH.exists():
        with open(PASSWORDS_JSON_PATH, 'r') as f:
            return json.load(f)
    else:
        # Return default passwords if file doesn't exist
        default_passwords = {
            "admin": "admin",
            "moderator": "moderator",
            "dev": "dev"
        }
        # Create the file with defaults
        PASSWORDS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(PASSWORDS_JSON_PATH, 'w') as f:
            json.dump(default_passwords, f, indent=2)
        return default_passwords


def save_passwords(passwords: Dict[str, str]):
    """Save passwords to JSON file."""
    PASSWORDS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PASSWORDS_JSON_PATH, 'w') as f:
        json.dump(passwords, f, indent=2)


def get_password(role: str) -> Optional[str]:
    """Get password for a specific role."""
    passwords = get_passwords()
    return passwords.get(role)


def validate_password(role: str, password: str) -> bool:
    """Validate a password for a role."""
    stored_password = get_password(role)
    return stored_password is not None and stored_password == password

# Store authenticated WebSocket sessions
from typing import Any, Dict

authenticated_sessions: Dict[str, Any] = {}
# Track all connected socket session IDs (unauthenticated + authenticated)
connected_sids = set()
# Optional scanner token for unauthenticated scanner devices
# Use a development default when not provided so local/dev testing is easy.
SCANNER_TOKEN = os.environ.get('SCANNER_TOKEN', 'dev-scanner-token')
if SCANNER_TOKEN == 'dev-scanner-token':
    print('NOTE: SCANNER_TOKEN not set; using development default "dev-scanner-token". Do not use this in production.')

# Development mode: force full client access (bypass auth checks)
if os.environ.get('DEV_FORCE_FULL_ACCESS') == '1':
    class DevSessions(dict):
        def __contains__(self, key):
            return True
    authenticated_sessions = DevSessions()
    print('WARNING: DEV_FORCE_FULL_ACCESS=1 -> bypassing WebSocket auth checks')
    print('WARNING: DEV_FORCE_FULL_ACCESS=1 -> bypassing WebSocket auth checks')

# Broadcast data changes to all connected clients
def broadcast_data_change(event_type: str, data: Optional[dict] = None):
    """Broadcast data changes to all authenticated WebSocket clients."""
    try:
        print(f"[broadcast] scheduling data_changed -> type={event_type} data_keys={list((data or {}).keys())}")
    except Exception:
        pass
    payload = {'type': event_type, 'data': data or {}}

    async def _emit(payload):
        try:
            await socketio.emit('data_changed', payload, namespace='/', broadcast=True)
        except TypeError:
            try:
                await socketio.emit('data_changed', payload, namespace='/')
            except Exception as e:
                try:
                    print(f"[broadcast] failed to emit data_changed: {e}")
                except Exception:
                    pass
        except Exception as e:
            try:
                print(f"[broadcast] failed to emit data_changed: {e}")
            except Exception:
                pass

    try:
        socketio.start_background_task(_emit, payload)
    except Exception as e:
        try:
            print(f"[broadcast] failed to schedule data_changed task: {e}")
        except Exception:
            pass

def broadcast_summary_update(affected_student_ids: Optional[list[int]] = None):
    """Broadcast updated attendance summaries for affected students or all if None.

    This function is a synchronous entrypoint that schedules the actual
    work on the application's asyncio event loop. The heavy summary
    computation is performed in a thread to avoid blocking the loop.
    """

    async def _compute_and_emit(affected_ids: Optional[list[int]]):
        # Compute summaries in a background thread to avoid blocking the loop
        def _compute():
            summaries = []
            if affected_ids is None:
                students = get_all_students_with_history()
                for student in students:
                    summary = get_attendance_summary(student, students)
                    summaries.append({
                        'studentId': student['id'],
                        'name': student['name'],
                        'grade': student['grade'],
                        'className': student['className'],
                        'summary': summary
                    })
            else:
                # Compute only for affected IDs
                students = get_all_students_with_history()
                id_map = {s['id']: s for s in students}
                for sid in affected_ids:
                    student = id_map.get(sid)
                    if not student:
                        continue
                    summary = get_attendance_summary(student, students)
                    summaries.append({
                        'studentId': student['id'],
                        'name': student['name'],
                        'grade': student['grade'],
                        'className': student['className'],
                        'summary': summary
                    })
            return summaries

        try:
            summaries = await asyncio.to_thread(_compute)
        except Exception:
            summaries = []

        try:
            print(f"[broadcast] scheduling summary_update -> summaries_count={len(summaries)}")
        except Exception:
            pass

        payload = {'summaries': summaries}

        try:
            await socketio.emit('summary_update', payload, namespace='/', broadcast=True)
        except TypeError:
            try:
                await socketio.emit('summary_update', payload, namespace='/')
            except Exception as e:
                try:
                    print(f"[broadcast] failed to emit summary_update: {e}")
                except Exception:
                    pass
        except Exception as e:
            try:
                print(f"[broadcast] failed to emit summary_update: {e}")
            except Exception:
                pass

    # Schedule on the running event loop if available, otherwise submit
    # to the main loop so calls from threads or synchronous endpoints
    # are handled safely.
    try:
        loop = asyncio.get_running_loop()
        # We're on the event loop — create a task
        loop.create_task(_compute_and_emit(affected_student_ids))
        return
    except RuntimeError:
        pass

    try:
        main_loop = asyncio.get_event_loop()
        try:
            asyncio.run_coroutine_threadsafe(_compute_and_emit(affected_student_ids), main_loop)
            return
        except Exception:
            pass
    except Exception:
        pass

    # Fallback: try socketio.start_background_task (best-effort)
    try:
        socketio.start_background_task(lambda ids=affected_student_ids: None, affected_student_ids)
    except Exception:
        try:
            print('[broadcast] failed to schedule summary_update task (fallback)')
        except Exception:
            pass


def compute_static_filters_from_db() -> Dict[str, List[str]]:
    """Compute distinct grades, classes, and roles from the students DB.

    Returns a dict with keys: 'grades', 'classes', 'roles'. Grades are
    converted to strings for consistency with frontend expectations.
    """
    conn = get_db_connection('students')
    cur = conn.cursor()
    try:
        cur.execute('SELECT DISTINCT grade FROM students WHERE grade IS NOT NULL ORDER BY grade')
        grades = [str(r['grade']) for r in cur.fetchall() if r['grade'] is not None]

        cur.execute("SELECT DISTINCT className FROM students WHERE className IS NOT NULL AND className != '' ORDER BY className")
        classes = [r['className'] for r in cur.fetchall()]

        cur.execute("SELECT DISTINCT role FROM students WHERE role IS NOT NULL AND role != '' ORDER BY role")
        roles = [r['role'] for r in cur.fetchall()]
    finally:
        conn.close()

    return {'grades': grades, 'classes': classes, 'roles': roles}


def broadcast_static_filters():
    """Emit current static filters to all connected clients via WebSocket.

    Uses DB-derived values so the frontend stays consistent with student data.
    """
    # Broadcast helper removed — static filter pushes are disabled.
    raise NotImplementedError('broadcast_static_filters was removed; use get_static_filters request instead')

# ==================== HELPER FUNCTIONS ====================

def get_student_by_id(student_id: int) -> Optional[Dict]:
    """Get a single student with attendance history."""
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    # Get core student record
    cursor_students.execute('SELECT * FROM students WHERE id = ?', (student_id,))
    row = cursor_students.fetchone()
    if not row:
        conn_students.close()
        return None
    
    student = dict(row)
    
    # Get fingerprints from normalized table
    cursor_students.execute('''
        SELECT fingerprint, position FROM student_fingerprints_id
        WHERE student_id = ?
        ORDER BY position
    ''', (student_id,))
    fp_rows = cursor_students.fetchall()
    fingerprints = [''] * 4
    for fp in fp_rows:
        pos = fp['position']
        if 1 <= pos <= 4:
            fingerprints[pos - 1] = fp['fingerprint']
    
    # Get attendance history from attendance database
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    # Detect whether the attendance_records table has a check_in_time column.
    cursor_attendance.execute("PRAGMA table_info(attendance_records)")
    cols = [r['name'] for r in cursor_attendance.fetchall()]
    if 'check_in_time' in cols:
        cursor_attendance.execute('''
            SELECT date, status, check_in_time FROM attendance_records
            WHERE student_id = ?
            ORDER BY date DESC
        ''', (student_id,))
    else:
        # Older DBs may not have the column yet; return NULL for compatibility.
        cursor_attendance.execute('''
            SELECT date, status, NULL as check_in_time FROM attendance_records
            WHERE student_id = ?
            ORDER BY date DESC
        ''', (student_id,))

    rows = cursor_attendance.fetchall()
    # Build a map of existing attendance records by date for this student
    att_map = {r['date']: {'date': r['date'], 'status': r['status'], 'checkInTime': r['check_in_time']} for r in rows}
    conn_attendance.close()

    # Build attendanceHistory aligned to authoritative school_days
    try:
        from .database import get_school_days
        school_days = get_school_days()
    except Exception:
        # Fallback: use dates from existing rows
        school_days = sorted(list(att_map.keys()))

    history = []
    for sd in school_days:
        rec = att_map.get(sd)
        if rec:
            history.append({'date': sd, 'status': rec.get('status'), 'checkInTime': rec.get('checkInTime')})
        else:
            history.append({'date': sd, 'status': 'absent', 'checkInTime': None})

    # Get today's status
    today = date.today().isoformat()
    today_record = next((h for h in history if h['date'] == today), None)
    
    student['fingerprints'] = fingerprints
    student['contact'] = {
        'email': student.get('email'),
        'phone': student.get('phone'),
        'whatsapp': student.get('whatsapp_no') or ''
    }
    student['attendanceHistory'] = history
    student['status'] = today_record['status'] if today_record else 'absent'
    student['hasScannedToday'] = today_record is not None and today_record['status'] != 'absent'
    
    # Remove SQLite-specific fields
    for key in ['fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4', 'email', 'phone', 'whatsapp_no']:
        student.pop(key, None)
    
    conn_students.close()
    return student

def get_all_students_with_history(target_date: Optional[str] = None) -> List[Dict]:
    """Get all students with their attendance history for TODAY only (Live Attendance)."""
    # Use provided target_date if valid (YYYY-MM-DD); otherwise default to today.
    if target_date:
        try:
            td = date.fromisoformat(target_date)
        except Exception:
            td = date.today()
    else:
        td = date.today()

    target_date = td.isoformat()
    is_weekend = td.weekday() >= 5  # 5=Saturday, 6=Sunday
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    cursor_students.execute('SELECT * FROM students ORDER BY name')
    students_data = cursor_students.fetchall()
    
    # Get all attendance records in one query for efficiency
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    # Detect whether the attendance_records table has a check_in_time column.
    cursor_attendance.execute("PRAGMA table_info(attendance_records)")
    cols = [r['name'] for r in cursor_attendance.fetchall()]
    if 'check_in_time' in cols:
        cursor_attendance.execute('''
            SELECT student_id, date, status, check_in_time FROM attendance_records
            ORDER BY student_id, date DESC
        ''')
    else:
        # Older DBs may not have the column yet; select NULL to keep schema stable.
        cursor_attendance.execute('''
            SELECT student_id, date, status, NULL as check_in_time FROM attendance_records
            ORDER BY student_id, date DESC
        ''')
    attendance_records = cursor_attendance.fetchall()
    conn_attendance.close()
    
    # Group attendance by student_id -> date for quick lookup
    attendance_by_student: Dict[int, Dict[str, Any]] = {}
    for record in attendance_records:
        student_id = record['student_id']
        if student_id not in attendance_by_student:
            attendance_by_student[student_id] = {}
        attendance_by_student[student_id][record['date']] = {
            'date': record['date'],
            'status': record['status'],
            'checkInTime': record['check_in_time']
        }
    
    # Preload all fingerprints from normalized table
    cursor_students.execute('SELECT student_id, fingerprint, position FROM student_fingerprints_id')
    fp_rows = cursor_students.fetchall()
    fingerprints_by_student: Dict[int, List[str]] = {}
    for fp in fp_rows:
        sid = fp['student_id']
        pos = fp['position']
        if sid not in fingerprints_by_student:
            fingerprints_by_student[sid] = [''] * 4
        if 1 <= pos <= 4:
            fingerprints_by_student[sid][pos - 1] = fp['fingerprint']
    
    students: List[Dict] = []
    for row in students_data:
        student = dict(row)
        student_id = student['id']
        
        # Build attendance history aligned to authoritative `school_days`
        from .database import get_school_days
        school_days = get_school_days()
        student_att_map = attendance_by_student.get(student_id, {})
        history = []
        for sd in school_days:
            rec = student_att_map.get(sd)
            if rec:
                history.append({
                    'date': sd,
                    'status': rec.get('status'),
                    'checkInTime': rec.get('checkInTime')
                })
            else:
                history.append({
                    'date': sd,
                    'status': 'absent',
                    'checkInTime': None
                })

        # Get status for target date
        date_record = next((h for h in history if h['date'] == target_date), None)
        
        student['fingerprints'] = fingerprints_by_student.get(student_id, [''] * 4)
        student['contact'] = {
            'email': student.get('email'),
            'phone': student.get('phone'),
            'whatsapp': student.get('whatsapp_no') or ''
        }
        student['attendanceHistory'] = history
        if is_weekend:
            student['status'] = 'weekend'
            student['lastScanTime'] = None
        else:
            student['status'] = date_record['status'] if date_record else 'absent'
            student['lastScanTime'] = date_record['checkInTime'] if date_record else None
        student['hasScannedToday'] = date_record is not None and date_record['status'] != 'absent'
        
        # Remove SQLite-specific fields
        for key in ['fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4', 'email', 'phone', 'whatsapp_no', 'created_at', 'updated_at']:
            student.pop(key, None)
        
        students.append(student)
    
    # Ensure consistent alphabetical ordering across all consumers by
    # normalizing names (trim + case-insensitive) before returning.
    try:
        students.sort(key=lambda s: (s.get('name') or '').strip().lower())
    except Exception:
        # If sorting fails for any reason, fall back to original DB order.
        pass

    conn_students.close()
    return students

def get_attendance_summary(student: Dict, all_students: List[Dict]) -> Dict:
    """Calculate attendance summary for a student using DB helper only.

    This function delegates to `get_student_attendance_summary` which
    reads counts from the authoritative `school_days` table. On any
    failure the function returns a zeroed summary instead of falling
    back to legacy in-memory logic.
    """
    try:
        sid_val = student.get('id')
        if isinstance(sid_val, (int, str)):
            sid = int(sid_val)
        else:
            sid = 0
        db_summary = get_student_attendance_summary(sid)
        total = int(db_summary.get('total_school_days', 0))
        present = int(db_summary.get('present_days', 0))
        ontime = int(db_summary.get('on_time', 0))
        late = int(db_summary.get('late', 0))

        absent = max(0, total - present)
        presence_percentage = round((present / total) * 100, 1) if total > 0 else 0.0
        absence_percentage = round((absent / total) * 100, 1) if total > 0 else 0.0
        on_time_percentage = round((ontime / total) * 100, 1) if total > 0 else 0.0
        late_percentage = round((late / total) * 100, 1) if total > 0 else 0.0

        return {
            'totalSchoolDays': total,
            'presentDays': present,
            'absentDays': absent,
            'onTimeDays': ontime,
            'lateDays': late,
            'presencePercentage': presence_percentage,
            'absencePercentage': absence_percentage,
            'onTimePercentage': on_time_percentage,
            'latePercentage': late_percentage
        }
    except Exception:
        # On error return an empty/zeroed summary
        try:
            import traceback as _tb
            _tb.print_exc()
        except Exception:
            pass
        return {
            'totalSchoolDays': 0,
            'presentDays': 0,
            'absentDays': 0,
            'onTimeDays': 0,
            'lateDays': 0,
            'presencePercentage': 0.0,
            'absencePercentage': 0.0,
            'onTimePercentage': 0.0,
            'latePercentage': 0.0
        }


@app.route('/api/attendance/history', methods=['GET'])
def api_attendance_history():
    """Return aggregated attendance percentage per day for a date range.

    Query params:
      - start: ISO date (YYYY-MM-DD)
      - end: ISO date (YYYY-MM-DD)
      - grade: grade number as string or 'all'
    """
    from datetime import timedelta

    start = request.args.get('start')
    end = request.args.get('end')
    grade = request.args.get('grade', 'all')

    try:
        if end:
            end_date = date.fromisoformat(end)
        else:
            end_date = None

        if start:
            start_date = date.fromisoformat(start)
        else:
            start_date = None
    except Exception:
        return jsonify({'success': False, 'message': 'Invalid date format'}), 400

    # If start or end not provided, compute full available range from DB
    conn_att = get_db_connection('attendance')
    cursor_att = conn_att.cursor()
    if start_date is None or end_date is None:
        # If filtering by grade, join students; otherwise simple min/max
        if grade and grade != 'all':
            cursor_att.execute('''
                SELECT MIN(ar.date) as min_date, MAX(ar.date) as max_date
                FROM attendance_records ar
                JOIN students s ON s.id = ar.student_id
                WHERE s.grade = ?
            ''', (int(grade),))
        else:
            cursor_att.execute('SELECT MIN(date) as min_date, MAX(date) as max_date FROM attendance_records')
        row = cursor_att.fetchone()
        conn_att.close()
        if row and row['min_date'] and row['max_date']:
            if start_date is None:
                start_date = date.fromisoformat(row['min_date'])
            if end_date is None:
                end_date = date.fromisoformat(row['max_date'])
        else:
            # No records — fallback to last 7 days
            if end_date is None:
                end_date = date.today()
            if start_date is None:
                start_date = end_date - timedelta(days=6)
    else:
        conn_att.close()

    # Normalize range
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    # At this point we have start_date and end_date set

    params: List = [start_date.isoformat(), end_date.isoformat()]
    join_students = False
    grade_filter_sql = ''
    if grade and grade != 'all':
        join_students = True
        grade_filter_sql = 'AND s.grade = ?'
        params.append(int(grade))

    # Determine denominator: number of students in scope (filtered by grade if requested)
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    if grade and grade != 'all':
        cursor_students.execute('SELECT COUNT(*) as cnt FROM students WHERE grade = ?', (int(grade),))
    else:
        cursor_students.execute('SELECT COUNT(*) as cnt FROM students')
    row_cnt = cursor_students.fetchone()
    student_count = row_cnt['cnt'] if row_cnt else 0
    conn_students.close()

    # Fetch present counts per date (present = status != 'absent')
    if grade and grade != 'all':
        cursor_att = get_db_connection('attendance').cursor()
        cursor_att.execute('''
            SELECT ar.date as date, SUM(CASE WHEN ar.status != 'absent' THEN 1 ELSE 0 END) as present
            FROM attendance_records ar
            JOIN students s ON s.id = ar.student_id
            WHERE ar.date BETWEEN ? AND ? AND s.grade = ?
            GROUP BY ar.date
            ORDER BY ar.date ASC
        ''', (start_date.isoformat(), end_date.isoformat(), int(grade)))
    else:
        cursor_att = get_db_connection('attendance').cursor()
        cursor_att.execute('''
            SELECT date, SUM(CASE WHEN status != 'absent' THEN 1 ELSE 0 END) as present
            FROM attendance_records
            WHERE date BETWEEN ? AND ?
            GROUP BY date
            ORDER BY date ASC
        ''', (start_date.isoformat(), end_date.isoformat()))

    rows = cursor_att.fetchall()

    # Map present counts by date
    results_by_date = {r['date']: (r['present'] or 0) for r in rows}
    # Prefer authoritative `school_days` as the X-axis. If there are no
    # school_days for the requested range, fall back to a full-day series
    # (preserving legacy behavior).
    series = []
    try:
        cur_sd = get_db_connection('attendance').cursor()
        cur_sd.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
        sd_rows = cur_sd.fetchall()
        school_dates = [r['date'] for r in sd_rows]
        try:
            cur_sd.connection.close()
        except Exception:
            pass
    except Exception:
        school_dates = []

    if school_dates:
        for iso in school_dates:
            present = results_by_date.get(iso, 0)
            percent = round((present / student_count) * 100, 1) if student_count > 0 else 0
            series.append({'date': iso, 'percent': percent})
    else:
        # Fallback to daily series across the full range
        day = start_date
        while day <= end_date:
            iso = day.isoformat()
            present = results_by_date.get(iso, 0)
            if student_count > 0:
                percent = round((present / student_count) * 100, 1)
            else:
                percent = 0
            series.append({'date': iso, 'percent': percent})
            day = day + timedelta(days=1)

    return jsonify({'success': True, 'data': series})


@app.route('/api/attendance/aggregate', methods=['GET'])
def api_attendance_aggregate():
    """Return computed aggregate data for attendance history tab.

    Query params:
      - month: YYYY-MM (optional)
      - start, end: ISO dates (optional)
      - grade: grade number or 'all'
      - classFilter: className or 'all'
      - roleFilter: role or 'all' or 'none'
    Returns JSON with: pie, gradeBars, students, points
    """
    try:
        month = request.args.get('month')
        start = request.args.get('start')
        end = request.args.get('end')
        grade = request.args.get('grade', 'all')
        classFilter = request.args.get('classFilter')
        roleFilter = request.args.get('roleFilter')
        # Optional: scope gradeBars to a single status. Accepted values:
        # 'on_time'|'on time'|'ontime', 'late', 'absent', or 'all' (default)
        status = (request.args.get('status') or 'all').strip().lower()

        # Determine date range
        from datetime import timedelta
        if month:
            try:
                sd = date.fromisoformat(f"{month}-01")
            except Exception:
                return jsonify({'success': False, 'message': 'Invalid month format (expected YYYY-MM)'}), 400
            start_date = sd
            if sd.month == 12:
                next_mon = date(sd.year + 1, 1, 1)
            else:
                next_mon = date(sd.year, sd.month + 1, 1)
            end_date = next_mon - timedelta(days=1)
        else:
            try:
                start_date = date.fromisoformat(start) if start else None
                end_date = date.fromisoformat(end) if end else None
            except Exception:
                return jsonify({'success': False, 'message': 'Invalid date format for start/end'}), 400

        # If start/end still None, derive from attendance_records range
        conn_att = get_db_connection('attendance')
        cur_att = conn_att.cursor()
        if start_date is None or end_date is None:
            cur_att.execute('SELECT MIN(date) as min_date, MAX(date) as max_date FROM attendance_records')
            row = cur_att.fetchone()
            if row and row['min_date'] and row['max_date']:
                if start_date is None:
                    start_date = date.fromisoformat(row['min_date'])
                if end_date is None:
                    end_date = date.fromisoformat(row['max_date'])
            else:
                end_date = date.today()
                start_date = end_date - timedelta(days=29)

        if start_date > end_date:
            start_date, end_date = end_date, start_date

        # Ensure attendance-derived school_days are up-to-date before using them
        try:
            from .database import ensure_recalculated
            ensure_recalculated()
        except Exception:
            pass

        # Build authoritative school dates for range
        try:
            cur_sd = get_db_connection('attendance').cursor()
            cur_sd.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
            sd_rows = cur_sd.fetchall()
            school_dates = [r['date'] for r in sd_rows]
            try:
                cur_sd.connection.close()
            except Exception:
                pass
        except Exception:
            # Fallback to weekdays in range
            school_dates = []
            day = start_date
            while day <= end_date:
                if day.weekday() < 5:
                    school_dates.append(day.isoformat())
                day = day + timedelta(days=1)

        total_school_days = len(school_dates)

        # Load all students and filter by client-provided filters
        all_students = get_all_students_with_history()
        def student_matches(s: dict) -> bool:
            if grade and grade != 'all':
                try:
                    try:
                        gval = s.get('grade')
                        if isinstance(gval, (int, str)):
                            if int(gval) != int(grade):
                                return False
                        else:
                            return False
                    except Exception:
                        return False
                except Exception:
                    return False
            if classFilter and classFilter != 'all':
                if s.get('className') != classFilter:
                    return False
            if roleFilter and roleFilter != 'all':
                if roleFilter == 'none':
                    if s.get('role'):
                        return False
                else:
                    if s.get('role') != roleFilter:
                        return False
            return True

        filtered_students = [s for s in all_students if student_matches(s)]
        student_count = len(filtered_students)

        # Build per-student summaries for the requested date range (using school_dates)
        students_out = []
        grade_buckets = {}
        total_present_days = 0
        total_on_time_days = 0
        total_late_days = 0
        for s in filtered_students:
            records = s.get('attendanceHistory', [])
            on_time = 0
            late = 0
            for r in records:
                if r.get('date') in school_dates:
                    st = r.get('status')
                    if st == 'on time':
                        on_time += 1
                    elif st == 'late':
                        late += 1
            present = on_time + late
            absent = max(0, total_school_days - present) if total_school_days > 0 else 0
            total_present_days += present
            total_on_time_days += on_time
            total_late_days += late
            perc = round((present / total_school_days) * 100, 1) if total_school_days > 0 else 0
            students_out.append({
                'id': s.get('id'),
                'name': s.get('name'),
                'grade': s.get('grade'),
                'className': s.get('className'),
                'on_time': on_time,
                'late': late,
                'absent': absent,
                'presencePercentage': perc
            })
            g = str(s.get('grade') or '')
            if g not in grade_buckets:
                grade_buckets[g] = { 'students': 0, 'present': 0, 'on_time': 0, 'late': 0 }
            grade_buckets[g]['students'] += 1
            grade_buckets[g]['present'] += present
            grade_buckets[g]['on_time'] += on_time
            grade_buckets[g]['late'] += late

        # Build pie (overall percentages across all students and school days)
        if student_count == 0 or total_school_days == 0:
            pie = {
                'totalSchoolDays': total_school_days,
                'studentCount': student_count,
                'presentDays': 0,
                'onTimeDays': 0,
                'lateDays': 0,
                'absentDays': 0,
                'presencePercentage': 0,
                'absencePercentage': 0
            }
        else:
            total_possible = student_count * total_school_days
            absent_days = total_possible - total_present_days
            pie = {
                'totalSchoolDays': total_school_days,
                'studentCount': student_count,
                'presentDays': total_present_days,
                'onTimeDays': total_on_time_days,
                'lateDays': total_late_days,
                'absentDays': absent_days,
                'presencePercentage': round((total_present_days / total_possible) * 100, 1),
                'absencePercentage': round((absent_days / total_possible) * 100, 1)
            }

        # Grade bars
        gradeBars = []
        for g, data in grade_buckets.items():
            students_in_grade = data['students']
            if students_in_grade == 0 or total_school_days == 0:
                gradeBars.append({ 'grade': g, 'onTime': 0, 'late': 0, 'absent': 0, 'onTimeCount': 0, 'lateCount': 0, 'absentCount': 0 })
            else:
                total_possible_grade = students_in_grade * total_school_days
                present_grade = data['present']
                absent_grade = total_possible_grade - present_grade

                # Compute ratios depending on requested status scope.
                if status in ('on_time', 'on time', 'ontime'):
                    on_ratio = round((data.get('on_time', 0) / total_possible_grade), 3) if total_possible_grade > 0 else 0
                    late_ratio = 0
                    absent_ratio = 0
                elif status == 'late':
                    on_ratio = 0
                    late_ratio = round((data.get('late', 0) / total_possible_grade), 3) if total_possible_grade > 0 else 0
                    absent_ratio = 0
                elif status == 'absent':
                    on_ratio = 0
                    late_ratio = 0
                    absent_ratio = round((absent_grade / total_possible_grade), 3) if total_possible_grade > 0 else 0
                else:
                    # default: include all statuses (backwards compatible)
                    on_ratio = round((data.get('on_time', 0) / total_possible_grade), 3) if total_possible_grade > 0 else 0
                    late_ratio = round((data.get('late', 0) / total_possible_grade), 3) if total_possible_grade > 0 else 0
                    absent_ratio = round((absent_grade / total_possible_grade), 3) if total_possible_grade > 0 else 0

                gradeBars.append({
                    'grade': g,
                    'onTime': on_ratio,
                    'late': late_ratio,
                    'absent': absent_ratio,
                    'onTimeCount': data.get('on_time', 0),
                    'lateCount': data.get('late', 0),
                    'absentCount': absent_grade,
                })

        # Points series per school date
        points = []
        for iso in school_dates:
            present_count = 0
            for s in filtered_students:
                found = next((r for r in s.get('attendanceHistory', []) if r.get('date') == iso), None)
                if found and found.get('status') != 'absent':
                    present_count += 1
            percent = round((present_count / student_count) * 100, 1) if student_count > 0 else 0
            points.append({ 'date': iso, 'present': present_count, 'percent': percent })

        # Determine whether this date range (month) has any attendance data.
        # Check per-student attendanceHistory for any record inside school_dates
        has_data = False
        if school_dates and filtered_students:
            sd_set = set(school_dates)
            for s in filtered_students:
                for r in s.get('attendanceHistory', []):
                    if r.get('date') in sd_set:
                        has_data = True
                        break
                if has_data:
                    break

        # Also check attendance_records table as authoritative fallback
        try:
            cur_chk = get_db_connection('attendance').cursor()
            cur_chk.execute('SELECT COUNT(1) as cnt FROM attendance_records WHERE date BETWEEN ? AND ?', (start_date.isoformat(), end_date.isoformat()))
            row_chk = cur_chk.fetchone()
            if row_chk and row_chk.get('cnt', 0) > 0:
                has_data = True
            try:
                cur_chk.connection.close()
            except Exception:
                pass
        except Exception:
            # If the check fails, conservatively leave has_data as computed above
            pass

        return jsonify({'success': True, 'pie': pie, 'gradeBars': gradeBars, 'students': students_out, 'points': points, 'hasData': bool(has_data)})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Error computing attendance aggregate', 'error': str(e)}), 500


# Debug: log unmatched routes to help trace 404s during development
@app.errorhandler(404)
def log_not_found(e):
    try:
        from flask import request
        print(f"DEBUG 404: path={request.path} method={request.method} args={dict(request.args)}")
    except Exception:
        pass
    return jsonify({'success': False, 'message': 'Not Found'}), 404

# ==================== WEBSOCKET HANDLERS ====================

@socketio.on('connect')
async def handle_connect(sid, environ):
    """Handle WebSocket connection."""
    try:
        connected_sids.add(sid)
    except Exception:
        pass
    print(f'Client connected: {sid}')
    # Emit current connection counts to all clients
    try:
        await socketio.emit('connection_count', {
            'total': len(connected_sids),
            'authenticated': len(authenticated_sessions)
        }, namespace='/')
    except Exception:
        pass

@socketio.on('disconnect')
async def handle_disconnect(sid):
    """Handle WebSocket disconnection."""
    try:
        # Use pop to avoid KeyError if session not present
        try:
            authenticated_sessions.pop(sid, None)
        except Exception:
            pass
    except Exception:
        # Defensive: ignore any errors during disconnect handling
        pass
    try:
        # Remove from connected set and emit updated counts
        try:
            connected_sids.discard(sid)
        except Exception:
            pass
        print(f'Client disconnected: {sid}')
        try:
            await socketio.emit('connection_count', {
                'total': len(connected_sids),
                'authenticated': len(authenticated_sessions)
            }, namespace='/')
        except Exception:
            pass
    except Exception:
        pass

@socketio.on('authenticate')
async def handle_authentication(sid, data):
    """Handle authentication via WebSocket."""
    print(f"Authentication attempt: role={data.get('role')}, password_provided={bool(data.get('password'))}, sid={sid}")

    role = data.get('role')
    password = data.get('password')

    if not role or not password:
        print("Authentication failed: missing role or password")
        await socketio.emit('auth_response', {'success': False, 'message': 'Missing role or password'}, to=sid)
        return

    if validate_password(role, password):
        print("Password validated successfully")
        authenticated_sessions[sid] = role
        await socketio.emit('auth_response', {'success': True, 'role': role, 'message': 'Authentication successful'}, to=sid)

        # Log authentication
        conn_logs = get_db_connection('logs')
        cursor_logs = conn_logs.cursor()
        cursor_logs.execute('''
            INSERT INTO auth_logs (timestamp, message)
            VALUES (?, ?)
        ''', (datetime.now().isoformat(), f'User signed in as: {role}'))
        conn_logs.commit()
        conn_logs.close()
        # Emit updated connection counts (some connected clients now authenticated)
        try:
            await socketio.emit('connection_count', {
                'total': len(connected_sids),
                'authenticated': len(authenticated_sessions)
            }, namespace='/')
        except Exception:
            pass
    else:
        print("Password validation failed")
        await socketio.emit('auth_response', {'success': False, 'message': 'Invalid credentials'}, to=sid)

@socketio.on('scan_student')
async def handle_scan(sid, data):
    """Handle student scan via WebSocket.

    Behavior:
    - If the socket session is authenticated, proceed as before.
    - If unauthenticated, require a matching `scanner_token` payload when
      `SCANNER_TOKEN` is set in the environment; otherwise reject.
    """
    unauthenticated = sid not in authenticated_sessions
    if unauthenticated:
        # If a scanner token is configured, require it for unauthenticated scans.
        if SCANNER_TOKEN:
            supplied = (data or {}).get('scanner_token')
            if supplied != SCANNER_TOKEN:
                await socketio.emit('scan_response', {'success': False, 'message': 'Invalid scanner token'}, to=sid)
                return
        else:
            await socketio.emit('scan_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return
    
    # Block weekend scans (Saturday=5, Sunday=6)
    today = date.today()
    if today.weekday() >= 5:
        await socketio.emit('scan_response', {'success': False, 'message': 'Scanning not allowed on weekends'}, to=sid)
        return
    
    fingerprint = data.get('fingerprint')
    if not fingerprint:
        await socketio.emit('scan_response', {'success': False, 'message': 'Missing fingerprint'}, to=sid)
        return
    
    # Find student by fingerprint using normalized table
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    cursor_students.execute('''
        SELECT s.*
        FROM students s
        JOIN student_fingerprints_id f ON s.id = f.student_id
        WHERE f.fingerprint = ?
        LIMIT 1
    ''', (fingerprint,))
    
    row = cursor_students.fetchone()
    if not row:
        conn_students.close()
        await socketio.emit('scan_response', {'success': False, 'message': 'Student not found'}, to=sid)
        return
    
    student = dict(row)
    student_id = student['id']
    today = date.today().isoformat()
    conn_students.close()
    
    # Determine server receipt time (server-local) and UTC stamp to persist (timezone-aware)
    receipt_local = datetime.now()
    receipt_utc_iso = datetime.now(timezone.utc).isoformat()
    print(f"DEBUG: receipt_local={receipt_local.isoformat()} receipt_utc_iso={receipt_utc_iso}")
    date_str = receipt_local.date().isoformat()

    # Save check-in using transactional helper - ensures earliest checkin wins
    try:
        earliest_utc = save_checkin_utc(student_id, date_str, receipt_utc_iso)
    except Exception:
        # On failure, fall back to a simple insert/update to avoid losing scans
        conn_attendance = get_db_connection('attendance')
        cur = conn_attendance.cursor()
        try:
            cur.execute('''
                INSERT OR REPLACE INTO attendance_records (student_id, date, status, updated_at, check_in_time)
                VALUES (?, ?, ?, ?, ?)
            ''', (student_id, date_str, 'absent', datetime.utcnow().isoformat(), receipt_utc_iso))
            conn_attendance.commit()
            earliest_utc = receipt_utc_iso
        except Exception:
            earliest_utc = receipt_utc_iso
        finally:
            conn_attendance.close()

    # Compute status using server local receipt time (system time).
    # This ensures comparisons use the server's wall-clock unambiguously.
    status = compute_attendance_status(receipt_local, ATTENDANCE_ONTIME_END, ATTENDANCE_LATE_END)
    print(f"DEBUG: computed status from receipt_local={receipt_local.isoformat()} -> {status}")

    # Persist computed status and ensure check_in_time is earliest_utc
    conn_attendance = get_db_connection('attendance')
    cur = conn_attendance.cursor()
    try:
        # If a row exists, update it; otherwise insert a new row.
        # attendance_records no longer has an auto-increment `id` column —
        # check existence using a scalar select.
        cur.execute('SELECT 1 FROM attendance_records WHERE student_id = ? AND date = ?', (student_id, date_str))
        existing_row = cur.fetchone()
        if existing_row:
            cur.execute('''
                UPDATE attendance_records
                SET status = ?, updated_at = ?, check_in_time = ?
                WHERE student_id = ? AND date = ?
            ''', (status, datetime.utcnow().isoformat(), earliest_utc, student_id, date_str))
        else:
            cur.execute('''
                INSERT INTO attendance_records (student_id, date, status, created_at, updated_at, check_in_time)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (student_id, date_str, status, datetime.utcnow().isoformat(), datetime.utcnow().isoformat(), earliest_utc))
        conn_attendance.commit()
        # If this checkin denotes an actual presence (on time or late), mark the date as a school day
        try:
            if status in ('on time', 'late'):
                cur.execute('INSERT OR IGNORE INTO school_days (date, created_at) VALUES (?, ?)', (date_str, datetime.utcnow().isoformat()))
                conn_attendance.commit()
        except Exception:
            # Non-fatal — if the table isn't present or insert fails, continue
            pass
    except Exception as e:
        try:
            conn_attendance.rollback()
        except Exception:
            pass
        print('Error persisting attendance record:', e)
    finally:
        conn_attendance.close()

    student_data = get_student_by_id(student_id)
    await socketio.emit('scan_response', {'success': True, 'student': student_data}, to=sid)
    broadcast_data_change('scan', {'studentId': student_id})

@socketio.on('get_filtered_students')
async def handle_get_filtered_students(sid, data):
    """Deprecated WebSocket RPC for filtered students.

    Frontend now uses the HTTP endpoint `GET /api/students` for snapshots.
    This handler remains for backward compatibility but returns a deprecation
    notice and an empty result set to avoid expensive realtime computation via socket.
    """
    # Removed: this RPC was deprecated and is intentionally hard-failed
    # to avoid accidental use. Clients should call HTTP GET /api/students
    # for snapshot data.
    try:
        print('Hard-fail: get_filtered_students RPC removed; use HTTP GET /api/students')
    except Exception:
        pass
    await socketio.emit('filtered_students_response', {
        'success': False,
        'message': 'Removed: use HTTP GET /api/students?date=...&statusFilter=...&gradeFilter=...',
        'students': []
    }, to=sid)


@app.route('/api/students', methods=['GET'])
def http_get_filtered_students():
    """HTTP endpoint returning filtered students for a given date and filters.

    Query params:
      - date (YYYY-MM-DD)
      - statusFilter
      - gradeFilter
      - classFilter
      - roleFilter
      - searchQuery
    """
    try:
        filters = {
            'date': request.args.get('date'),
            'statusFilter': request.args.get('statusFilter'),
            'gradeFilter': request.args.get('gradeFilter'),
            'classFilter': request.args.get('classFilter'),
            'roleFilter': request.args.get('roleFilter'),
            'searchQuery': request.args.get('searchQuery'),
        }

        target_date = filters.get('date') or date.today().isoformat()
        all_students = get_all_students_with_history(target_date)

        filtered = all_students
        if filters.get('statusFilter'):
            filtered = [s for s in filtered if s['status'] == filters['statusFilter']]
        if filters.get('gradeFilter') and filters['gradeFilter'] != 'all':
            filtered = [s for s in filtered if s['grade'] == int(filters['gradeFilter'])]
        if filters.get('classFilter') and filters['classFilter'] != 'all':
            filtered = [s for s in filtered if s['className'] == filters['classFilter']]
        if filters.get('roleFilter') and filters['roleFilter'] != 'all':
            if filters['roleFilter'] == 'none':
                filtered = [s for s in filtered if not s.get('role')]
            else:
                filtered = [s for s in filtered if s.get('role') == filters['roleFilter']]
        if filters.get('searchQuery'):
            query = filters['searchQuery'].lower()
            def contact_field(s, k):
                return (s.get('contact', {}).get(k) or '').lower()
            filtered = [
                s for s in filtered
                if query in (s.get('name') or '').lower()
                or query in contact_field(s, 'phone')
                or query in contact_field(s, 'whatsapp')
                or query in contact_field(s, 'email')
            ]

        # Use trimmed, case-insensitive ordering to match UX expectations
        try:
            filtered.sort(key=lambda x: (x.get('name') or '').strip().lower())
        except Exception:
            filtered.sort(key=lambda x: x.get('name') or '')
        return jsonify({'success': True, 'students': filtered})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Error fetching students', 'error': str(e)}), 500


@app.route('/api/students/<int:student_id>', methods=['GET'])
def http_get_student_by_id(student_id):
    try:
        student = get_student_by_id(student_id)
        if not student:
            return jsonify({'success': False, 'message': 'Student not found'}), 404

        # Compute authoritative summary using server helpers. If computation
        # fails, continue returning the student object without summary to avoid
        # breaking clients.
        try:
            all_students = get_all_students_with_history()
            summary = get_attendance_summary(student, all_students)
        except Exception:
            summary = None

        # Build ordered student payload placing `summary` before `attendanceHistory`.
        ordered_student = {
            'id': student.get('id'),
            'name': student.get('name'),
            'grade': student.get('grade'),
            'className': student.get('className'),
            'role': student.get('role'),
            'contact': student.get('contact'),
            'specialRoles': student.get('specialRoles'),
            'notes': student.get('notes'),
            'fingerprints': student.get('fingerprints', []),
            'summary': summary,
            'status': student.get('status'),
            'hasScannedToday': student.get('hasScannedToday'),
            'created_at': student.get('created_at'),
            'updated_at': student.get('updated_at'),
        }
        ordered_student['attendanceHistory'] = student.get('attendanceHistory', [])

        return jsonify({'success': True, 'student': ordered_student})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Error fetching student', 'error': str(e)}), 500


@app.route('/api/students/<int:student_id>/attendance', methods=['GET'])
def http_get_student_attendance_month(student_id):
    """Return attendance records for a single student.

    Query params:
      - month: optional string in YYYY-MM format. If provided, only records
        within that month are returned. If omitted, the full attendance
        history for the student is returned.
    """
    try:
        month = request.args.get('month')
        student = get_student_by_id(student_id)
        if not student:
            return jsonify({'success': False, 'message': 'Student not found'}), 404

        # If no month filter provided, return the pre-computed attendanceHistory
        if not month:
            return jsonify({'success': True, 'attendanceHistory': student.get('attendanceHistory', [])})

        # Validate month format YYYY-MM and compute month range
        try:
            from datetime import timedelta
            start_date = date.fromisoformat(f"{month}-01")
        except Exception:
            return jsonify({'success': False, 'message': 'Invalid month format (expected YYYY-MM)'}), 400

        if start_date.month == 12:
            next_month = date(start_date.year + 1, 1, 1)
        else:
            next_month = date(start_date.year, start_date.month + 1, 1)
        end_date = next_month - timedelta(days=1)

        conn_att = get_db_connection('attendance')
        cur = conn_att.cursor()
        # Detect check_in_time presence and keep response shape stable
        cur.execute("PRAGMA table_info(attendance_records)")
        cols = [r['name'] for r in cur.fetchall()]
        if 'check_in_time' in cols:
            cur.execute('''
                SELECT date, status, check_in_time
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                ORDER BY date ASC
            ''', (student_id, start_date.isoformat(), end_date.isoformat()))
            rows = cur.fetchall()
            attendance = [{'date': r['date'], 'status': r['status'], 'checkInTime': r['check_in_time']} for r in rows]
        else:
            cur.execute('''
                SELECT date, status, NULL as check_in_time
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                ORDER BY date ASC
            ''', (student_id, start_date.isoformat(), end_date.isoformat()))
            rows = cur.fetchall()
            attendance = [{'date': r['date'], 'status': r['status'], 'checkInTime': None} for r in rows]

        # Also return school days for the requested month so clients
        # can distinguish weekdays which were not school days from
        # actual absences. If `school_days` table is unavailable or
        # empty for the range, fall back to weekdays.
        try:
            cur.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
            sd_rows = cur.fetchall()
            school_days = [r['date'] for r in sd_rows]
            # If table exists but has no rows for the month, return empty list
        except Exception:
            # Fallback: compute weekdays in the month
            from calendar import monthrange as _mr
            ld = _mr(start_date.year, start_date.month)[1]
            school_days = []
            for day_num in range(1, ld + 1):
                d = date(start_date.year, start_date.month, day_num)
                if d.weekday() >= 5:
                    continue
                school_days.append(d.isoformat())

        conn_att.close()
        return jsonify({'success': True, 'attendanceHistory': attendance, 'schoolDays': school_days})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Error fetching attendance', 'error': str(e)}), 500


@app.route('/api/students/<int:student_id>/attendance/trend', methods=['GET'])
def http_get_student_attendance_trend(student_id):
    """HTTP endpoint that returns per-day attendance points for a student for a given month.

    Query params:
      - month: required YYYY-MM

    Returns: { success: True, studentId, year, month, points: [ { date, on_time, late, absent, arrival_ts, arrival_local, arrival_minutes } ] }
    """
    try:
        month = request.args.get('month')
        if not month:
            return jsonify({'success': False, 'message': 'Missing month parameter (expected YYYY-MM)'}), 400

        # Validate month
        try:
            from calendar import monthrange
            year = int(month.split('-')[0])
            mon = int(month.split('-')[1])
            if mon < 1 or mon > 12:
                raise ValueError()
        except Exception:
            return jsonify({'success': False, 'message': 'Invalid month format (expected YYYY-MM)'}), 400

        last_day = monthrange(year, mon)[1]
        start_date = date(year, mon, 1)
        end_date = date(year, mon, last_day)

        conn_att = get_db_connection('attendance')
        cur = conn_att.cursor()
        cur.execute("PRAGMA table_info(attendance_records)")
        cols = [r['name'] for r in cur.fetchall()]
        has_check_in = 'check_in_time' in cols

        if has_check_in:
            cur.execute('''
                SELECT date,
                       SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                       SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                       MIN(check_in_time) as arrival_iso
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                GROUP BY date
                ORDER BY date ASC
            ''', (int(student_id), start_date.isoformat(), end_date.isoformat()))
        else:
            cur.execute('''
                SELECT date,
                       SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                       SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                       NULL as arrival_iso
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                GROUP BY date
                ORDER BY date ASC
            ''', (int(student_id), start_date.isoformat(), end_date.isoformat()))

        fetched = cur.fetchall()
        rows = {}
        for r in fetched:
            arrival_iso = r.get('arrival_iso') if isinstance(r, dict) else r['arrival_iso']
            arrival_ts = None
            arrival_local = None
            arrival_minutes = None
            if arrival_iso:
                try:
                    arrival_dt = datetime.fromisoformat(arrival_iso)
                    arrival_ts = int(arrival_dt.timestamp())
                    arrival_local = arrival_dt.strftime('%H:%M')
                    arrival_minutes = arrival_dt.hour * 60 + arrival_dt.minute
                except Exception:
                    arrival_ts = None
                    arrival_local = None
                    arrival_minutes = None
            rows[r['date']] = {
                'on_time': int(r['on_time'] or 0),
                'late': int(r['late'] or 0),
                'absent': int(r['absent'] or 0),
                'arrival_ts': arrival_ts,
                'arrival_local': arrival_local,
                'arrival_minutes': arrival_minutes,
            }

        # Build list of school dates using school_days table if present
        try:
            cur.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
            sd_rows = cur.fetchall()
            school_dates = [r['date'] for r in sd_rows]
        except Exception:
            # Fallback to weekdays
            from calendar import monthrange as _mr
            ld = _mr(year, mon)[1]
            school_dates = []
            for day in range(1, ld + 1):
                d = date(year, mon, day)
                if d.weekday() >= 5:
                    continue
                school_dates.append(d.isoformat())

        points = []
        for iso_date in school_dates:
            if iso_date in rows:
                counts = rows[iso_date]
                points.append({
                    'date': iso_date,
                    'on_time': counts.get('on_time', 0),
                    'late': counts.get('late', 0),
                    'absent': counts.get('absent', 0),
                    'arrival_ts': counts.get('arrival_ts'),
                    'arrival_local': counts.get('arrival_local'),
                    'arrival_minutes': counts.get('arrival_minutes'),
                })
            else:
                points.append({
                    'date': iso_date,
                    'on_time': 0,
                    'late': 0,
                    'absent': 1,
                    'arrival_ts': None,
                    'arrival_local': None,
                    'arrival_minutes': None,
                })

        conn_att.close()
        return jsonify({'success': True, 'studentId': int(student_id), 'year': year, 'month': mon, 'points': points})
    except Exception as e:
        try:
            if conn_att:
                conn_att.close()
        except Exception:
            pass
        return jsonify({'success': False, 'message': 'Error computing trend', 'error': str(e)}), 500


@socketio.on('get_static_filters')
async def handle_get_static_filters(sid):
    """Respond with server-side computed static filters via WebSocket."""
    try:
        print(f"Received get_static_filters request from sid={sid}")
        # Return canonical lists (from config) alongside DB-derived available lists.
        db_payload = compute_static_filters_from_db()
        await socketio.emit('get_static_filters_response', {
            'success': True,
            'grades': CANONICAL_GRADES,
            'classes': CANONICAL_CLASSES,
            'roles': CANONICAL_PREFECT_ROLES,
            'availableGrades': db_payload.get('grades', []),
            'availableClasses': db_payload.get('classes', []),
            'availableRoles': db_payload.get('roles', []),
        }, to=sid)
    except Exception as e:
        await socketio.emit('get_static_filters_response', {'success': False, 'message': 'Error computing filters', 'error': str(e)}, to=sid)

@socketio.on('get_student_by_id')
async def handle_get_student_by_id(sid, data):
    """Deprecated WebSocket RPC for fetching a student by ID.

    Use the HTTP endpoint `GET /api/students/<id>` instead. This handler
    returns a deprecation message to encourage migration away from socket RPCs.
    """
    # Removed: hard-fail to prevent accidental use. Use HTTP GET /api/students/<id> instead.
    try:
        print('Hard-fail: get_student_by_id RPC removed; use HTTP GET /api/students/<id>')
    except Exception:
        pass


@app.route('/api/students/<int:student_id>/summary', methods=['GET'])
def http_get_student_summary(student_id):
    """Return computed attendance summary for a student.

    This provides the same functionality as the FastAPI `/api/students/{id}/summary`
    endpoint and ensures the path is available when the application is run via
    the Flask/Socket.IO ASGI wrapper (the default dev startup path).
    """
    try:
        student = get_student_by_id(student_id)
        if not student:
            return jsonify({'success': False, 'message': 'Student not found'}), 404
        try:
            all_students = get_all_students_with_history()
            summary = get_attendance_summary(student, all_students)
        except Exception:
            summary = None
        return jsonify({'success': True, 'studentId': student_id, 'summary': summary})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Error computing summary', 'error': str(e)}), 500

@socketio.on('save_attendance')
async def handle_save_attendance(sid, data):
    """Save attendance records for students via WebSocket. Strictly forbids weekend dates."""
    if sid not in authenticated_sessions:
        await socketio.emit('save_attendance_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
        return

    students = data.get('students', [])
    
    # Validate all record dates first: reject weekends or invalid dates before any DB writes
    inserts = []
    for student in students:
        student_id = student.get('id')
        for record in student.get('attendanceHistory', []):
            date_str = record.get('date')
            if not date_str:
                await socketio.emit('save_attendance_response', {'success': False, 'message': f"Invalid or missing date for student {student_id}"}, to=sid)
                return
            try:
                parsed_date = datetime.fromisoformat(date_str).date()
            except (ValueError, TypeError):
                await socketio.emit('save_attendance_response', {'success': False, 'message': f"Invalid date format for student {student_id}: {date_str}"}, to=sid)
                return
            # weekday(): Mon=0..Fri=4, Sat=5, Sun=6 -> reject if >=5
            if parsed_date.weekday() >= 5:
                await socketio.emit('save_attendance_response', {'success': False, 'message': 'Weekend attendance cannot be marked, Please select a weekday (Monday-Friday)'}, to=sid)
                return
            
            supplied_check_in = record.get('checkInTime') or record.get('check_in_time')
            check_in_time = supplied_check_in if supplied_check_in else datetime.now().isoformat()
            inserts.append((
                student_id,
                parsed_date.isoformat(),
                record.get('status'),
                datetime.now().isoformat(),
                check_in_time
            ))
    
    # All validated — perform DB inserts
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    for ins in inserts:
        cursor_attendance.execute('''
            INSERT OR REPLACE INTO attendance_records (student_id, date, status, updated_at, check_in_time)
            VALUES (?, ?, ?, ?, ?)
        ''', ins)
    
    conn_attendance.commit()
    conn_attendance.close()
    
    # Determine affected student ids and broadcast with details so clients can
    # apply lightweight merges or perform a full snapshot refresh if needed.
    # Recalculate school days after writes and broadcast updates
    try:
        recalculate_school_days()
    except Exception:
        pass
    affected_ids = [student.get('id') for student in students]
    broadcast_data_change('attendance_updated', {'affectedIds': affected_ids})
    broadcast_summary_update(affected_ids)
    await socketio.emit('save_attendance_response', {'success': True}, to=sid)


@app.route('/api/save-attendance', methods=['POST'])
def api_save_attendance():
    """HTTP endpoint to save attendance records. Accepts JSON payload:
    { students: [ { id, attendanceHistory: [ { date, status, checkInTime? } ] } ] }
    Weekend dates are rejected by the server.
    """
    try:
        payload = request.get_json(force=True)
    except Exception:
        return jsonify({'success': False, 'message': 'Invalid JSON payload'}), 400

    students = payload.get('students') if isinstance(payload, dict) else None
    if students is None:
        return jsonify({'success': False, 'message': 'Missing students array in payload'}), 400


    inserts = []
    for student in students:
        student_id = student.get('id')
        for record in student.get('attendanceHistory', []):
            date_str = record.get('date')
            if not date_str:
                return jsonify({'success': False, 'message': f'Invalid or missing date for student {student_id}'}), 400
            try:
                parsed_date = date.fromisoformat(date_str)
            except Exception:
                return jsonify({'success': False, 'message': f'Invalid date format for student {student_id}: {date_str}'}), 400
            # Reject weekend dates (Sat=5, Sun=6)
            if parsed_date.weekday() >= 5:
                return jsonify({'success': False, 'message': 'Weekend attendance cannot be marked. Please select a weekday (Monday-Friday).'}), 400

            supplied_check_in = record.get('checkInTime') or record.get('check_in_time')
            check_in_time = supplied_check_in if supplied_check_in else datetime.now(timezone.utc).isoformat()
            inserts.append((
                student_id,
                parsed_date.isoformat(),
                record.get('status'),
                datetime.now(timezone.utc).isoformat(),
                check_in_time
            ))

    if not inserts:
        return jsonify({'success': False, 'message': 'No attendance records to save.'}), 400

    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    # Perform inserts
    for ins in inserts:
        cursor_attendance.execute('''
            INSERT OR REPLACE INTO attendance_records (student_id, date, status, updated_at, check_in_time)
            VALUES (?, ?, ?, ?, ?)
        ''', ins)

    conn_attendance.commit()
    conn_attendance.close()
    # Recalculate school days after writes and broadcast updates
    try:
        recalculate_school_days()
    except Exception:
        pass

    affected_ids = [s.get('id') for s in students]
    broadcast_data_change('attendance_updated', {'affectedIds': affected_ids})
    broadcast_summary_update(affected_ids)

    return jsonify({'success': True})

@socketio.on('add_student')
async def handle_add_student(sid, data):
    """Add a new student via WebSocket."""
    if sid not in authenticated_sessions:
        await socketio.emit('add_student_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
        return

    if not data:
        await socketio.emit('add_student_response', {'success': False, 'message': 'No data provided'}, to=sid)
        return
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    # Get next ID
    cursor_students.execute('SELECT MAX(id) FROM students')
    max_id = cursor_students.fetchone()[0] or 0
    next_id = max_id + 1
    
    fingerprints = data.get('fingerprints', ['', '', '', ''])
    
    cursor_students.execute('''
        INSERT INTO students (id, name, grade, className, role, email, phone,
                            whatsapp_no, fingerprint1, fingerprint2, fingerprint3, fingerprint4,
                            specialRoles, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        next_id,
        data['name'],
        data['grade'],
        data['className'],
        data.get('role'),
        data['contact'].get('email'),
        data['contact'].get('phone'),
        # Accept either `whatsapp` or `whatsapp_no` from client contact
        data['contact'].get('whatsapp') or data['contact'].get('whatsapp_no') or '',
        fingerprints[0] if len(fingerprints) > 0 else '',
        fingerprints[1] if len(fingerprints) > 1 else '',
        fingerprints[2] if len(fingerprints) > 2 else '',
        fingerprints[3] if len(fingerprints) > 3 else '',
        data.get('specialRoles', ''),
        data.get('notes', '')
    ))
    
    # Also insert into normalized fingerprints table
    for position, fp in enumerate(fingerprints, start=1):
        if fp:
            cursor_students.execute('''
                INSERT OR IGNORE INTO student_fingerprints_id (student_id, fingerprint, position)
                VALUES (?, ?, ?)
            ''', (next_id, fp, position))
    
    conn_students.commit()
    conn_students.close()
    
    student = get_student_by_id(next_id)
    broadcast_data_change('student_added', {'studentId': next_id})
    broadcast_summary_update([next_id])
    # static filter pushes removed
    await socketio.emit('add_student_response', {'success': True, 'student': student}, to=sid)

@socketio.on('remove_student')
async def handle_remove_student(sid, data):
    """Remove a student via WebSocket."""
    if sid not in authenticated_sessions:
        await socketio.emit('remove_student_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
        return

    student_id = data.get('studentId')
    if not student_id:
        await socketio.emit('remove_student_response', {'success': False, 'message': 'Missing studentId'}, to=sid)
        return
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    cursor_students.execute('DELETE FROM students WHERE id = ?', (student_id,))
    conn_students.commit()
    conn_students.close()
    
    # Also remove attendance records
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    cursor_attendance.execute('DELETE FROM attendance_records WHERE student_id = ?', (student_id,))
    conn_attendance.commit()
    conn_attendance.close()
    
    broadcast_data_change('student_removed', {'studentId': student_id})
    broadcast_summary_update()  # Emit all summaries since student removed
    # static filter pushes removed
    await socketio.emit('remove_student_response', {'success': True}, to=sid)

@socketio.on('update_student')
async def handle_update_student(sid, data):
    """Update a student's information via WebSocket."""
    if sid not in authenticated_sessions:
        await socketio.emit('update_student_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
        return

    student_id = data.get('studentId')
    update_data = data.get('data')
    if not student_id or not update_data:
        await socketio.emit('update_student_response', {'success': False, 'message': 'Missing studentId or data'}, to=sid)
        return
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    # Get existing student
    cursor_students.execute('SELECT * FROM students WHERE id = ?', (student_id,))
    existing = cursor_students.fetchone()
    if not existing:
        conn_students.close()
        await socketio.emit('update_student_response', {'success': False, 'message': 'Student not found'}, to=sid)
        return
    
    existing_dict = dict(existing)
    
    # Update fields
    name = update_data.get('name', existing_dict['name'])
    grade = update_data.get('grade', existing_dict['grade'])
    className = update_data.get('className', existing_dict['className'])
    role = update_data.get('role', existing_dict['role'])
    email = update_data.get('contact', {}).get('email', existing_dict['email'])
    phone = update_data.get('contact', {}).get('phone', existing_dict['phone'])
    whatsapp_no = update_data.get('contact', {}).get('whatsapp') or update_data.get('contact', {}).get('whatsapp_no') or existing_dict.get('whatsapp_no', '')
    specialRoles = update_data.get('specialRoles', existing_dict.get('specialRoles', ''))
    notes = update_data.get('notes', existing_dict.get('notes', ''))
    
    fingerprints = update_data.get('fingerprints')
    if fingerprints is None:
        # If not provided, derive from existing normalized table or legacy columns
        cursor_students.execute('''
            SELECT fingerprint, position FROM student_fingerprints_id
            WHERE student_id = ?
            ORDER BY position
        ''', (student_id,))
        fp_rows = cursor_students.fetchall()
        if fp_rows:
            fingerprints = [''] * 4
            for fp in fp_rows:
                pos = fp['position']
                if 1 <= pos <= 4:
                    fingerprints[pos - 1] = fp['fingerprint']
        else:
            fingerprints = [
                existing_dict['fingerprint1'],
                existing_dict['fingerprint2'],
                existing_dict['fingerprint3'],
                existing_dict['fingerprint4']
            ]
    
    # Handle role removal
    if 'role' in update_data and update_data['role'] is None:
        role = None
    
    cursor_students.execute('''
        UPDATE students
        SET name = ?, grade = ?, className = ?, role = ?, email = ?, phone = ?,
            whatsapp_no = ?, fingerprint1 = ?, fingerprint2 = ?, fingerprint3 = ?, fingerprint4 = ?,
            specialRoles = ?, notes = ?, updated_at = ?
        WHERE id = ?
    ''', (
        name, grade, className, role, email, phone,
        whatsapp_no,
        fingerprints[0] if len(fingerprints) > 0 else '',
        fingerprints[1] if len(fingerprints) > 1 else '',
        fingerprints[2] if len(fingerprints) > 2 else '',
        fingerprints[3] if len(fingerprints) > 3 else '',
        specialRoles, notes, datetime.now().isoformat(),
        student_id
    ))
    
    # Sync normalized fingerprints table
    cursor_students.execute('DELETE FROM student_fingerprints_id WHERE student_id = ?', (student_id,))
    for position, fp in enumerate(fingerprints, start=1):
        if fp:
            cursor_students.execute('''
                INSERT OR IGNORE INTO student_fingerprints_id (student_id, fingerprint, position)
                VALUES (?, ?, ?)
            ''', (student_id, fp, position))
    
    conn_students.commit()
    conn_students.close()
    
    student = get_student_by_id(student_id)
    broadcast_data_change('student_updated', {'studentId': student_id})
    broadcast_summary_update([student_id])
    # static filter pushes removed
    await socketio.emit('update_student_response', {'success': True, 'student': student}, to=sid)

@socketio.on('validate_password')
async def handle_validate_password(sid, data):
    """Validate a password for a role via WebSocket."""
    role = data.get('role')
    password = data.get('password')

    if not role or not password:
        await socketio.emit('validate_password_response', {'valid': False}, to=sid)
        return

    try:
        valid = validate_password(role, password)
        await socketio.emit('validate_password_response', {'valid': valid}, to=sid)
    except Exception as e:
        print(f"Error validating password: {e}")
        await socketio.emit('validate_password_response', {'valid': False}, to=sid)

@socketio.on('update_passwords')
async def handle_update_passwords(sid, data):
    """Update passwords for roles via WebSocket."""
    if sid not in authenticated_sessions:
        await socketio.emit('update_passwords_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
        return

    passwords_to_update = data.get('passwords', {})
    authorizer_role = data.get('authorizerRole')
    authorizer_password = data.get('authorizerPassword')

    # Validate authorizer
    if not validate_password(authorizer_role, authorizer_password):
        await socketio.emit('update_passwords_response', {'success': False, 'message': 'Unauthorized'}, to=sid)
        return

    # Update passwords
    current_passwords = get_passwords()
    for role, new_password in passwords_to_update.items():
        if role in ['admin', 'moderator', 'dev']:
            current_passwords[role] = new_password

    save_passwords(current_passwords)

    broadcast_data_change('passwords_updated')
    await socketio.emit('update_passwords_response', {'success': True}, to=sid)

@socketio.on('get_current_time')
async def handle_get_current_time(sid):
    """Get current server time via WebSocket."""
    # Allow unauthenticated access
    await socketio.emit('current_time_response', {'time': datetime.now().isoformat()}, to=sid)


@socketio.on('request_attendance_aggregate')
async def handle_request_attendance_aggregate(sid, data):
    """Compute attendance aggregates for Day/Week/Month/Year and emit response.

    Expects data: { range: 'day'|'week'|'month'|'year', grade: 'all' or grade number }
    Emits: 'attendance_aggregate_response' with { success, range, grade, points: [{label, percent}] }
    """
    rng = (data or {}).get('range', 'week')
    grade = (data or {}).get('grade', 'all')
    status = (data or {}).get('status', 'overview')

    # Default SQL case expression for single-series queries. This ensures
    # `case_expr` is always defined for all code paths (avoids static analysis warnings).
    case_expr = "SUM(CASE WHEN ar.status != 'absent' THEN 1 ELSE 0 END) as present"
    from datetime import timedelta

    # Denominator: number of students in scope
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    try:
        if grade and grade != 'all':
            cursor_students.execute('SELECT COUNT(*) as cnt FROM students WHERE grade = ?', (int(grade),))
        else:
            cursor_students.execute('SELECT COUNT(*) as cnt FROM students')
        student_count = cursor_students.fetchone()['cnt']
    except Exception:
        student_count = 0
    finally:
        conn_students.close()

    today = date.today()
    points = []

    conn_att = None
    try:
        conn_att = get_db_connection('attendance')
        cur = conn_att.cursor()

        if rng == 'day':
            target = today.isoformat()
            if status in ('overview', 'attendance'):
                # return three-series: on_time, late, absent counts per hour
                if grade and grade != 'all':
                    cur.execute('''
                        SELECT strftime('%H', check_in_time) as hour,
                               SUM(CASE WHEN ar.status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records ar
                        JOIN students s ON s.id = ar.student_id
                        WHERE ar.date = ? AND s.grade = ?
                        GROUP BY hour
                    ''', (target, int(grade)))
                else:
                    cur.execute('''
                        SELECT strftime('%H', check_in_time) as hour,
                               SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records
                        WHERE date = ?
                        GROUP BY hour
                    ''', (target,))
                rows = {r['hour']: {'on_time': (r['on_time'] or 0), 'late': (r['late'] or 0), 'absent': (r['absent'] or 0)} for r in cur.fetchall()}
                for h in range(24):
                    key = f"{h:02d}"
                    counts = rows.get(key, {'on_time': 0, 'late': 0, 'absent': 0})
                    if student_count > 0:
                        on_p = round((counts['on_time'] / student_count) * 100, 1)
                        late_p = round((counts['late'] / student_count) * 100, 1)
                        absent_p = round((counts['absent'] / student_count) * 100, 1)
                    else:
                        on_p = late_p = absent_p = 0
                    points.append({'label': f'{key}:00', 'on_time': on_p, 'late': late_p, 'absent': absent_p})
            else:
                # fallback to single-series behavior
                if status in ('ontime', 'on time', 'on_time'):
                    case_expr = "SUM(CASE WHEN ar.status = 'on time' THEN 1 ELSE 0 END) as present"
                elif status == 'late':
                    case_expr = "SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) as present"
                elif status == 'absent':
                    case_expr = "SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as present"
                else:
                    case_expr = "SUM(CASE WHEN ar.status != 'absent' THEN 1 ELSE 0 END) as present"

                if grade and grade != 'all':
                    sql = f"SELECT strftime('%H', check_in_time) as hour, {case_expr} FROM attendance_records ar JOIN students s ON s.id = ar.student_id WHERE ar.date = ? AND s.grade = ? GROUP BY hour"
                    cur.execute(sql, (target, int(grade)))
                else:
                    sql = f"SELECT strftime('%H', check_in_time) as hour, {case_expr} FROM attendance_records ar WHERE ar.date = ? GROUP BY hour"
                    cur.execute(sql, (target,))
                rows = {r['hour']: (r['present'] or 0) for r in cur.fetchall()}
                for h in range(24):
                    key = f"{h:02d}"
                    present = rows.get(key, 0)
                    percent = round((present / student_count) * 100, 1) if student_count > 0 else 0
                    points.append({'label': f'{key}:00', 'percent': percent})

        elif rng == 'week':
            end_date = today
            start_date = end_date - timedelta(days=6)
            if status in ('overview', 'attendance'):
                # fetch three series per date
                if grade and grade != 'all':
                    cur.execute('''
                        SELECT ar.date as date,
                               SUM(CASE WHEN ar.status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records ar
                        JOIN students s ON s.id = ar.student_id
                        WHERE ar.date BETWEEN ? AND ? AND s.grade = ?
                        GROUP BY ar.date
                        ORDER BY ar.date ASC
                    ''', (start_date.isoformat(), end_date.isoformat(), int(grade)))
                else:
                    cur.execute('''
                        SELECT date,
                               SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records
                        WHERE date BETWEEN ? AND ?
                        GROUP BY date
                        ORDER BY date ASC
                    ''', (start_date.isoformat(), end_date.isoformat()))
                rows = {r['date']: {'on_time': (r['on_time'] or 0), 'late': (r['late'] or 0), 'absent': (r['absent'] or 0)} for r in cur.fetchall()}
                day = start_date
                while day <= end_date:
                    iso = day.isoformat()
                    counts = rows.get(iso, {'on_time': 0, 'late': 0, 'absent': 0})
                    if student_count > 0:
                        on_p = round((counts['on_time'] / student_count) * 100, 1)
                        late_p = round((counts['late'] / student_count) * 100, 1)
                        absent_p = round((counts['absent'] / student_count) * 100, 1)
                    else:
                        on_p = late_p = absent_p = 0
                    points.append({'label': iso, 'on_time': on_p, 'late': late_p, 'absent': absent_p})
                    day = day + timedelta(days=1)
            else:
                # single-series fallback
                if status in ('ontime', 'on time', 'on_time'):
                    case_expr = "SUM(CASE WHEN ar.status = 'on time' THEN 1 ELSE 0 END) as present"
                elif status == 'late':
                    case_expr = "SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) as present"
                elif status == 'absent':
                    case_expr = "SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as present"
                else:
                    case_expr = "SUM(CASE WHEN ar.status != 'absent' THEN 1 ELSE 0 END) as present"

                if grade and grade != 'all':
                    sql = f"SELECT ar.date as date, {case_expr} FROM attendance_records ar JOIN students s ON s.id = ar.student_id WHERE ar.date BETWEEN ? AND ? AND s.grade = ? GROUP BY ar.date ORDER BY ar.date ASC"
                    cur.execute(sql, (start_date.isoformat(), end_date.isoformat(), int(grade)))
                else:
                    sql = f"SELECT date, {case_expr} FROM attendance_records WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date ASC"
                    cur.execute(sql, (start_date.isoformat(), end_date.isoformat()))
                rows = {r['date']: (r['present'] or 0) for r in cur.fetchall()}
                day = start_date
                while day <= end_date:
                    iso = day.isoformat()
                    present = rows.get(iso, 0)
                    percent = round((present / student_count) * 100, 1) if student_count > 0 else 0
                    points.append({'label': iso, 'percent': percent})
                    day = day + timedelta(days=1)

        elif rng == 'month':
            end_date = today
            start_date = end_date - timedelta(days=29)
            # month uses same logic as week but longer range
            if status in ('overview', 'attendance'):
                if grade and grade != 'all':
                    cur.execute('''
                        SELECT ar.date as date,
                               SUM(CASE WHEN ar.status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records ar
                        JOIN students s ON s.id = ar.student_id
                        WHERE ar.date BETWEEN ? AND ? AND s.grade = ?
                        GROUP BY ar.date
                        ORDER BY ar.date ASC
                    ''', (start_date.isoformat(), end_date.isoformat(), int(grade)))
                else:
                    cur.execute('''
                        SELECT date,
                               SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records
                        WHERE date BETWEEN ? AND ?
                        GROUP BY date
                        ORDER BY date ASC
                    ''', (start_date.isoformat(), end_date.isoformat()))
                rows = {r['date']: {'on_time': (r['on_time'] or 0), 'late': (r['late'] or 0), 'absent': (r['absent'] or 0)} for r in cur.fetchall()}
                day = start_date
                while day <= end_date:
                    iso = day.isoformat()
                    counts = rows.get(iso, {'on_time': 0, 'late': 0, 'absent': 0})
                    if student_count > 0:
                        on_p = round((counts['on_time'] / student_count) * 100, 1)
                        late_p = round((counts['late'] / student_count) * 100, 1)
                        absent_p = round((counts['absent'] / student_count) * 100, 1)
                    else:
                        on_p = late_p = absent_p = 0
                    points.append({'label': iso, 'on_time': on_p, 'late': late_p, 'absent': absent_p})
                    day = day + timedelta(days=1)
            else:
                if grade and grade != 'all':
                    sql = f"SELECT ar.date as date, {case_expr} FROM attendance_records ar JOIN students s ON s.id = ar.student_id WHERE ar.date BETWEEN ? AND ? AND s.grade = ? GROUP BY ar.date ORDER BY ar.date ASC"
                    cur.execute(sql, (start_date.isoformat(), end_date.isoformat(), int(grade)))
                else:
                    sql = f"SELECT date, {case_expr} FROM attendance_records WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date ASC"
                    cur.execute(sql, (start_date.isoformat(), end_date.isoformat()))
                rows = {r['date']: (r['present'] or 0) for r in cur.fetchall()}
                day = start_date
                while day <= end_date:
                    iso = day.isoformat()
                    present = rows.get(iso, 0)
                    percent = round((present / student_count) * 100, 1) if student_count > 0 else 0
                    points.append({'label': iso, 'percent': percent})
                    day = day + timedelta(days=1)

        elif rng == 'year':
            # last 12 months aggregated by YYYY-MM
            end_month = today.replace(day=1)
            def month_shift(dt, delta):
                m = dt.month - 1 + delta
                y = dt.year + m // 12
                mm = m % 12 + 1
                return dt.replace(year=y, month=mm, day=1)

            months = [month_shift(end_month, -i) for i in range(11, -1, -1)]
            ym_start = months[0].strftime('%Y-%m')
            ym_end = months[-1].strftime('%Y-%m')
            # year aggregation by month using case_expr or three-series for overview
            if status in ('overview', 'attendance'):
                if grade and grade != 'all':
                    cur.execute('''
                        SELECT substr(ar.date,1,7) as ym,
                               SUM(CASE WHEN ar.status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records ar
                        JOIN students s ON s.id = ar.student_id
                        WHERE substr(ar.date,1,7) BETWEEN ? AND ? AND s.grade = ?
                        GROUP BY ym
                    ''', (ym_start, ym_end, int(grade)))
                else:
                    cur.execute('''
                        SELECT substr(date,1,7) as ym,
                               SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                               SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                               SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
                        FROM attendance_records
                        WHERE substr(date,1,7) BETWEEN ? AND ?
                        GROUP BY ym
                    ''', (ym_start, ym_end))
                rows = {r['ym']: {'on_time': (r['on_time'] or 0), 'late': (r['late'] or 0), 'absent': (r['absent'] or 0)} for r in cur.fetchall()}
                for m in months:
                    label = m.strftime('%Y-%m')
                    counts = rows.get(label, {'on_time': 0, 'late': 0, 'absent': 0})
                    if student_count > 0:
                        on_p = round((counts['on_time'] / student_count) * 100, 1)
                        late_p = round((counts['late'] / student_count) * 100, 1)
                        absent_p = round((counts['absent'] / student_count) * 100, 1)
                    else:
                        on_p = late_p = absent_p = 0
                    points.append({'label': label, 'on_time': on_p, 'late': late_p, 'absent': absent_p})
            else:
                if grade and grade != 'all':
                    sql = f"SELECT substr(ar.date,1,7) as ym, {case_expr} FROM attendance_records ar JOIN students s ON s.id = ar.student_id WHERE substr(ar.date,1,7) BETWEEN ? AND ? AND s.grade = ? GROUP BY ym"
                    cur.execute(sql, (ym_start, ym_end, int(grade)))
                else:
                    sql = f"SELECT substr(date,1,7) as ym, {case_expr} FROM attendance_records WHERE substr(date,1,7) BETWEEN ? AND ? GROUP BY ym"
                    cur.execute(sql, (ym_start, ym_end))
                rows = {r['ym']: (r['present'] or 0) for r in cur.fetchall()}
                for m in months:
                    label = m.strftime('%Y-%m')
                    present = rows.get(label, 0)
                    percent = round((present / student_count) * 100, 1) if student_count > 0 else 0
                    points.append({'label': label, 'percent': percent})

        else:
            await socketio.emit('attendance_aggregate_response', {'success': False, 'message': 'Invalid range'}, to=sid)
            return

        # Debug log: report sample of points and context to help frontend mapping issues
        try:
            print(f"attendance_aggregate_response -> range={rng} grade={grade} status={status} student_count={student_count} total_points={len(points)} sample_points={points[:3]}")
        except Exception:
            pass
        await socketio.emit('attendance_aggregate_response', {'success': True, 'range': rng, 'grade': grade, 'points': points}, to=sid)
    except Exception as e:
        await socketio.emit('attendance_aggregate_response', {'success': False, 'message': str(e)}, to=sid)
    finally:
        try:
            if conn_att:
                conn_att.close()
        except Exception:
            pass


@socketio.on('request_attendance_trend')
async def handle_request_attendance_trend(sid, data):
    """Compute per-day attendance counts for a single student for a given month.

    Expects: { studentId: int, year: int, month: int }
    Emits: 'attendance_trend_response' with { success, studentId, year, month, points: [{date, on_time, late, absent}] }
    """
    try:
        print(f"handle_request_attendance_trend called with: {data}")
        print(f"request_attendance_trend received: {data}")
        student_id = (data or {}).get('studentId')
        year = (data or {}).get('year')
        month = (data or {}).get('month')
        if not student_id or not year or not month:
            await socketio.emit('attendance_trend_response', {'success': False, 'message': 'Missing parameters'}, to=sid)
            return

        # Normalize month/year
        try:
            year = int(year)
            month = int(month)
            if month < 1 or month > 12:
                raise ValueError('Invalid month')
        except Exception:
            await socketio.emit('attendance_trend_response', {'success': False, 'message': 'Invalid year/month'}, to=sid)
            return

        import calendar as _cal
        from datetime import timedelta as _td

        last_day = _cal.monthrange(year, month)[1]
        start_date = date(year, month, 1)
        end_date = date(year, month, last_day)

        conn_att = get_db_connection('attendance')
        cur = conn_att.cursor()

        # Detect whether attendance_records has a check_in_time column
        cur.execute("PRAGMA table_info(attendance_records)")
        cols = [r['name'] for r in cur.fetchall()]
        has_check_in = 'check_in_time' in cols

        if has_check_in:
            # Select counts plus earliest check_in_time (ISO string) per date
            cur.execute('''
                SELECT date,
                       SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                       SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                       MIN(check_in_time) as arrival_iso
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                GROUP BY date
                ORDER BY date ASC
            ''', (int(student_id), start_date.isoformat(), end_date.isoformat()))
        else:
            # Older DBs may not have the column; return counts and no arrival
            cur.execute('''
                SELECT date,
                       SUM(CASE WHEN status = 'on time' THEN 1 ELSE 0 END) as on_time,
                       SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
                       SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
                       NULL as arrival_iso
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                GROUP BY date
                ORDER BY date ASC
            ''', (int(student_id), start_date.isoformat(), end_date.isoformat()))

        fetched = cur.fetchall()
        rows = {}
        for r in fetched:
            arrival_iso = r['arrival_iso']
            arrival_ts = None
            arrival_local = None
            arrival_minutes = None
            if arrival_iso:
                try:
                    # Parse ISO string using server local time and emit epoch seconds
                    arrival_dt = datetime.fromisoformat(arrival_iso)
                    arrival_ts = int(arrival_dt.timestamp())
                    # Provide a server-local human string (HH:MM) and minutes-since-midnight
                    arrival_local = arrival_dt.strftime('%H:%M')
                    arrival_minutes = arrival_dt.hour * 60 + arrival_dt.minute
                except Exception:
                    arrival_ts = None
                    arrival_local = None
                    arrival_minutes = None
            rows[r['date']] = {
                'on_time': (r['on_time'] or 0),
                'late': (r['late'] or 0),
                'absent': (r['absent'] or 0),
                'arrival_ts': arrival_ts,
                'arrival_local': arrival_local,
                'arrival_minutes': arrival_minutes,
            }

        # Build points for every recorded school day in the month.
        # Use the `school_days` table as the authoritative list of school days;
        # if the student has no record for a school day, treat that day as absent for that student.
        points = []
        try:
            cur.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
            sd_rows = cur.fetchall()
            school_dates = [r['date'] for r in sd_rows]
        except Exception:
            # If school_days table is not present or the query fails, fall back to weekday heuristic
            school_dates = []
            for day in range(1, last_day + 1):
                d = date(year, month, day)
                if d.weekday() >= 5:
                    continue
                school_dates.append(d.isoformat())

        for iso_date in school_dates:
            if iso_date in rows:
                counts = rows[iso_date]
                points.append({
                    'date': iso_date,
                    'on_time': int(counts.get('on_time', 0)),
                    'late': int(counts.get('late', 0)),
                    'absent': int(counts.get('absent', 0)),
                    'arrival_ts': counts.get('arrival_ts'),
                    'arrival_local': counts.get('arrival_local'),
                    'arrival_minutes': counts.get('arrival_minutes')
                })
            else:
                # No attendance record for this student on this school day -> mark absent
                points.append({
                    'date': iso_date,
                    'on_time': 0,
                    'late': 0,
                    'absent': 1,
                    'arrival_ts': None,
                    'arrival_local': None,
                    'arrival_minutes': None
                })

        conn_att.close()
        print(f"attendance_trend_response -> student={student_id} year={year} month={month} points={len(points)}")
        await socketio.emit('attendance_trend_response', {'success': True, 'studentId': int(student_id), 'year': year, 'month': month, 'points': points}, to=sid)
    except Exception as e:
        try:
            await socketio.emit('attendance_trend_response', {'success': False, 'message': str(e)}, to=sid)
        except Exception:
            pass

# ==================== REST API ENDPOINTS ====================
# File-related endpoints kept as REST for downloads/uploads

# Import additional endpoints
from .api_endpoints import register_endpoints


# === DB MTIME -> application wiring ===
# We register a lightweight thread callback (invoked by the watcher thread)
# that enqueues a message into an asyncio.Queue on the main event loop.
# An async processor consumes the queue, performs `recalculate_school_days`
# off-thread and then publishes updates to connected clients from the
# event loop (so Async Socket.IO emits run in the proper loop).
_db_event_queue: "asyncio.Queue[bool]" = asyncio.Queue()
_db_event_processor_task: Optional[asyncio.Task] = None


def _db_watcher_thread_callback() -> None:
    """Called from the database watcher thread when the attendance DB mtime changes.

    This should be very small and must not block: it schedules a put into
    the main event loop's queue using `call_soon_threadsafe`.
    """
    try:
        loop = asyncio.get_event_loop()
    except Exception:
        # No loop in this thread — try to find a running loop via the default policy
        try:
            loop = asyncio.get_event_loop()
        except Exception:
            return
    try:
        loop.call_soon_threadsafe(_db_event_queue.put_nowait, True)
    except Exception:
        pass


async def _db_event_processor():
    while True:
        try:
            await _db_event_queue.get()
            # Perform recalculation in a thread to avoid blocking the event loop
            try:
                await asyncio.to_thread(recalculate_school_days)
            except Exception:
                pass

            # Publish a concise db-changed event to clients
            payload = {'type': 'attendance_db_changed', 'data': {}}
            try:
                await socketio.emit('data_changed', payload, namespace='/', broadcast=True)
            except Exception:
                # Best-effort fallback: try socketio.start_background_task from loop
                try:
                    socketio.start_background_task(lambda p=payload: None, payload)
                except Exception:
                    pass

            # Also publish summary update (existing helper will schedule its work)
            try:
                broadcast_summary_update(None)
            except Exception:
                pass
        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(0.5)


def setup_db_mtime_handler(loop: Optional[asyncio.AbstractEventLoop] = None):
    """Initialize DB mtime handling: start the watcher and ensure the
    async processor is running on the given `loop` (or current loop).
    """
    global _db_event_processor_task
    if loop is None:
        try:
            loop = asyncio.get_event_loop()
        except Exception:
            return
    # Ensure the processor task is running in the provided loop
    try:
        if _db_event_processor_task is None or _db_event_processor_task.done():
            _db_event_processor_task = loop.create_task(_db_event_processor())
    except Exception:
        pass

    # Register the thread-callback so the watcher notifies us
    try:
        register_post_mtime_change_callback(_db_watcher_thread_callback)
    except Exception:
        pass

    # Start the database watcher thread owned by the database module; keep
    # control in app.py by starting it here so only the application owns
    # the watcher lifecycle.
    try:
        start_attendance_watcher()
    except Exception:
        pass


def request_recalc():
    """Synchronous request to perform authoritative recalculation and
    publish updates to connected clients. This centralizes DB-derived
    computation and broadcasting in `app.py` so other modules simply
    request the work instead of doing it themselves.
    """
    try:
        recalculate_school_days()
    except Exception:
        pass

    # Notify clients that the attendance DB changed and publish summaries
    try:
        broadcast_data_change('attendance_db_changed', {})
    except Exception:
        pass

    try:
        # Use None to indicate full summaries
        broadcast_summary_update(None)
    except Exception:
        pass


    # Register all additional endpoints with helper functions
    register_endpoints(app, socketio, {
        'get_all_students_with_history': get_all_students_with_history,
        'get_student_by_id': get_student_by_id,
        'get_attendance_summary': get_attendance_summary,
        'broadcast_data_change': broadcast_data_change,
        'broadcast_summary_update': broadcast_summary_update,
        'request_recalc': request_recalc,
        'emit': socketio.emit,
        'authenticated_sessions': authenticated_sessions
    })

if __name__ == '__main__':
    init_database()
    migrate_json_to_sqlite()
    print("Flask backend starting on http://0.0.0.0:5000")
    print("WebSocket support enabled (HTTP, asyncio mode)")
    # Start a background watcher that monitors the attendance DB file for external changes
    try:
        import threading, time

        def _watch_attendance_db(poll_interval: float = 2.0):
            try:
                last_mtime = None
                db_path = ATTENDANCE_DB_PATH
                while True:
                    try:
                        mtime = db_path.stat().st_mtime
                    except Exception:
                        mtime = None
                    if last_mtime is None:
                        last_mtime = mtime
                    elif mtime is not None and mtime != last_mtime:
                        # File changed externally: recalc school days and broadcast updates
                        try:
                            recalculate_school_days()
                        except Exception:
                            pass
                        try:
                            broadcast_data_change('attendance_db_changed', {})
                            broadcast_summary_update(None)
                        except Exception:
                            pass
                        last_mtime = mtime
                    time.sleep(poll_interval)
            except Exception:
                pass

        watcher = threading.Thread(target=_watch_attendance_db, daemon=True)
        watcher.start()
    except Exception:
        pass
    # Default: run the Flask/Socket.IO server via the synchronous `socketio.run`
    # This avoids ASGI/engineio signature mismatches that appear with some
    # local dependency combinations. If you explicitly want the ASGI/uvicorn
    # path (for production async workloads), set the environment variable
    # `FORCE_ASGI=1` and ensure your environment's packages are compatible.
    try:
        # Prefer ASGI/uvicorn by default so the Async Socket.IO server is active
        try:
            import uvicorn
            if asgi_app is not None:
                print('Starting uvicorn ASGI server (default)')
                uvicorn.run(asgi_app, host='0.0.0.0', port=5000)
            else:
                # asgi_app may be None if WsgiToAsgi wrapping failed earlier
                print('ASGI app unavailable; falling back to socketio.run')
                socketio.run(app, host='0.0.0.0', port=5000)
        except Exception as uv_err:
            # If uvicorn import or run fails, fallback to socketio.run which
            # will start the embedded Socket.IO server and enable broadcasts.
            try:
                print(f'uvicorn start failed ({uv_err}); falling back to socketio.run')
            except Exception:
                pass
            try:
                socketio.run(app, host='0.0.0.0', port=5000)
            except Exception as sock_err:
                try:
                    print(f'Socket.IO fallback failed: {sock_err}; exiting')
                except Exception:
                    pass
    except Exception as e:
        try:
            print(f'Server start failed unexpectedly: {e}; exiting')
        except Exception:
            pass
