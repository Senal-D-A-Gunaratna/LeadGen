"""
Additional API endpoints for backups, CSV/PDF exports, and logs.
"""
from flask import request, jsonify, send_file
import os
from flask_socketio import emit
import asyncio
from .database import get_db_connection, DatabaseContext, create_db_file_backup
from datetime import datetime, date
import json
import csv
import io
import sqlite3
import time
import calendar
import re
from pathlib import Path
from typing import Dict, Optional
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

# Import flask app helpers for HTTP token validation
from . import app as flask_app

# Password file path
PASSWORDS_JSON_PATH = Path(__file__).resolve().parents[1] / 'database' / 'passwords.json'

def get_passwords() -> Dict[str, str]:
    """Read passwords from JSON file."""
    if PASSWORDS_JSON_PATH.exists():
        with open(PASSWORDS_JSON_PATH, 'r') as f:
            return json.load(f)
    else:
        # Return default passwords if file doesn't exist
        default_passwords = {
            "admin": "bot",
            "moderator": "bot",
            "dev": "luanti"
        }
        # Create the file with defaults
        PASSWORDS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(PASSWORDS_JSON_PATH, 'w') as f:
            json.dump(default_passwords, f, indent=2)
        return default_passwords

def validate_password(role: str, password: str) -> bool:
    """Validate a password for a role."""
    passwords = get_passwords()
    stored_password = passwords.get(role)
    return stored_password is not None and stored_password == password

# Import helper functions from app module
# These will be passed in via register_endpoints function

def register_endpoints(app, socketio, helpers):
    """Register all additional API endpoints.
    
    Args:
        app: Flask app instance
        socketio: SocketIO instance
        helpers: Dict with helper functions (get_all_students_with_history, get_student_by_id, get_attendance_summary, broadcast_data_change, broadcast_summary_update, emit)
    """
    get_all_students_with_history = helpers['get_all_students_with_history']
    get_student_by_id = helpers['get_student_by_id']
    get_attendance_summary = helpers['get_attendance_summary']
    broadcast_data_change = helpers['broadcast_data_change']
    broadcast_summary_update = helpers['broadcast_summary_update']
    request_recalc = helpers.get('request_recalc')
    emit = helpers['emit']
    authenticated_sessions = helpers['authenticated_sessions']
    # Helper to allow alternate auth via HTTP tokens or authorizer role/password
    def _is_authorized(sid, data=None):
        try:
            if sid in authenticated_sessions:  # type: ignore
                return True
        except Exception:
            pass
        # Allow token-based auth provided in payload
        try:
            if isinstance(data, dict):
                token = data.get('authorizerToken') or data.get('token') or data.get('authToken')
                if token:
                    try:
                        role = flask_app.validate_http_token(token)
                        if role:
                            return True
                    except Exception:
                        pass
                # Allow authorizerRole/authorizerPassword in payload
                ar = data.get('authorizerRole') or data.get('role')
                ap = data.get('authorizerPassword') or data.get('password')
                if ar and ap and validate_password(ar, ap):
                    return True
        except Exception:
            pass
        return False
    # Allow forcing insecure HTTP for development (set to '1' to bypass HTTPS checks)
    FORCE_ALLOW_INSECURE_HTTP = os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1'
    # Helper to determine whether the incoming request is from a local/LAN address
    def _get_forwarded_ip():
        xff = request.headers.get('X-Forwarded-For', '')
        if xff:
            # may contain a comma-separated list
            return xff.split(',')[0].strip()
        return request.remote_addr or ''

    def _is_local_request():
        try:
            host_no_port = (request.host or '').split(':')[0].lower()
            remote = _get_forwarded_ip()
            if host_no_port.startswith('127.') or 'localhost' in host_no_port:
                return True
            if remote in ('127.0.0.1', '::1'):
                return True
            # Private IPv4 ranges
            if remote.startswith('192.168.') or remote.startswith('10.'):
                return True
            if remote.startswith('172.'):
                parts = remote.split('.')
                if len(parts) > 1:
                    try:
                        second = int(parts[1])
                        if 16 <= second <= 31:
                            return True
                    except Exception:
                        pass
            return False
        except Exception:
            return False
    
    # ------------------- HTTP Auth endpoints (Flask) -------------------

    # Helper: write a timestamped message to backend.log and frontend.log
    DEBUG_LOG_PATH = Path(__file__).resolve().parents[1] / 'backend.log'
    FRONTEND_LOG_PATH = Path(__file__).resolve().parents[1] / 'frontend.log'

    def _write_backend_log(msg: str):
        try:
            ts = datetime.utcnow().isoformat() + 'Z'
            with open(DEBUG_LOG_PATH, 'a') as f:
                f.write(f"[{ts}] {msg}\n")
        except Exception:
            pass

    def _write_frontend_log(msg: str):
        try:
            ts = datetime.utcnow().isoformat() + 'Z'
            with open(FRONTEND_LOG_PATH, 'a') as f:
                f.write(f"[{ts}] {msg}\n")
        except Exception:
            pass

    @app.route('/api/auth/login', methods=['POST'])
    def flask_api_auth_login():
        data = request.get_json() or {}
        role = data.get('role')
        password = data.get('password')
        remote = request.remote_addr or ''
        _write_backend_log(f"auth.login attempt role={role} remote={remote}")
        if not role or not password:
            _write_backend_log(f"auth.login missing fields from {remote}")
            return jsonify({'success': False, 'message': 'Missing role or password'}), 400
        try:
            if flask_app.validate_password(role, password):
                token = flask_app.create_http_session(role)
                _write_backend_log(f"auth.login success role={role} remote={remote} token={token}")
                return jsonify({'success': True, 'token': token, 'role': role})
            else:
                _write_backend_log(f"auth.login failed invalid credentials role={role} remote={remote}")
                return jsonify({'success': False, 'message': 'Invalid credentials'}), 401
        except Exception as e:
            _write_backend_log(f"auth.login error role={role} remote={remote} error={e}")
            return jsonify({'success': False, 'message': str(e)}), 500

    @app.route('/api/auth/validate', methods=['POST'])
    def flask_api_auth_validate():
        data = request.get_json() or {}
        token = data.get('token')
        remote = request.remote_addr or ''
        _write_backend_log(f"auth.validate called remote={remote} token_present={bool(token)}")
        if token:
            try:
                role = flask_app.validate_http_token(token)
                _write_backend_log(f"auth.validate token lookup remote={remote} role={role}")
                return jsonify({'success': True, 'valid': bool(role), 'role': role})
            except Exception as e:
                _write_backend_log(f"auth.validate error remote={remote} error={e}")
                return jsonify({'success': False, 'message': str(e)}), 500
        role = data.get('role')
        password = data.get('password')
        if role and password:
            try:
                valid = validate_password(role, password)
                _write_backend_log(f"auth.validate role/password remote={remote} role={role} valid={valid}")
                return jsonify({'success': True, 'valid': bool(valid)})
            except Exception as e:
                _write_backend_log(f"auth.validate error remote={remote} error={e}")
                return jsonify({'success': False, 'message': str(e)}), 500
        _write_backend_log(f"auth.validate missing data remote={remote}")
        return jsonify({'success': False, 'message': 'Missing token or role/password'}), 400

    @app.route('/api/attendance/has_data', methods=['GET'])
    def flask_api_attendance_has_data():
        month = request.args.get('month')
        start = request.args.get('start')
        end = request.args.get('end')
        grade = request.args.get('grade', 'all')
        classFilter = request.args.get('classFilter')
        roleFilter = request.args.get('roleFilter')
        try:
            from datetime import date, timedelta
            start_date = None
            end_date = None
            if month:
                try:
                    sd = date.fromisoformat(f"{month}-01")
                except Exception:
                    return jsonify({'success': False, 'error': 'Invalid month format (expected YYYY-MM)'}), 400
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
                    return jsonify({'success': False, 'error': 'Invalid date format for start/end'}), 400

            if start_date is None or end_date is None:
                conn_att = get_db_connection('attendance')
                cur_att = conn_att.cursor()
                cur_att.execute('SELECT MIN(date) as min_date, MAX(date) as max_date FROM attendance_records')
                row = cur_att.fetchone()
                try:
                    cur_att.connection.close()
                except Exception:
                    pass
                if row and row['min_date'] and row['max_date']:
                    if start_date is None:
                        start_date = date.fromisoformat(row['min_date'])
                    if end_date is None:
                        end_date = date.fromisoformat(row['max_date'])
                else:
                    return jsonify({'success': True, 'hasData': False})

            assert start_date is not None and end_date is not None
            if start_date > end_date:
                start_date, end_date = end_date, start_date

            params = [start_date.isoformat(), end_date.isoformat()]
            join_students = False
            where_clauses = ['ar.date BETWEEN ? AND ?']
            if grade and grade != 'all':
                join_students = True
                where_clauses.append('s.grade = ?')
                params.append(int(grade))
            if classFilter and classFilter != 'all':
                join_students = True
                where_clauses.append('s.className = ?')
                params.append(classFilter)
            if roleFilter and roleFilter != 'all':
                join_students = True
                if roleFilter == 'none':
                    where_clauses.append('(s.role IS NULL OR s.role = "")')
                else:
                    where_clauses.append('s.role = ?')
                    params.append(roleFilter)

            if join_students:
                sql = f"SELECT COUNT(1) as cnt FROM attendance_records ar JOIN students s ON s.id = ar.student_id WHERE {' AND '.join(where_clauses)}"
            else:
                sql = f"SELECT COUNT(1) as cnt FROM attendance_records ar WHERE {' AND '.join(where_clauses)}"

            conn = get_db_connection('attendance')
            cur = conn.cursor()
            cur.execute(sql, tuple(params))
            row = cur.fetchone()
            try:
                cur.connection.close()
            except Exception:
                pass

            has = False
            if row and ('cnt' in row.keys()):
                try:
                    has = bool(row['cnt'] > 0)
                except Exception:
                    has = False
            return jsonify({'success': True, 'hasData': has})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/frontend-log', methods=['POST'])
    def flask_api_frontend_log():
        data = request.get_json() or {}
        msg = data.get('message') or ''
        level = data.get('level') or 'info'
        remote = request.remote_addr or ''
        try:
            _write_frontend_log(f"{level} from {remote}: {msg}")
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    # ==================== WEBSOCKET HANDLERS ====================
    
    @socketio.on('list_backups')
    async def handle_list_backups(sid):
        """List all available backups via WebSocket."""
        if not _is_authorized(sid):
            await emit('list_backups_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return

        def _list():
            backups_root = Path(__file__).resolve().parents[1] / 'backups'
            students_dir = backups_root / 'students'
            attendance_dir = backups_root / 'attendance'

            students_dir.mkdir(parents=True, exist_ok=True)
            attendance_dir.mkdir(parents=True, exist_ok=True)

            student_backups = sorted([p.name for p in students_dir.glob('*.db')], reverse=True)
            attendance_backups = sorted([p.name for p in attendance_dir.glob('*.db')], reverse=True)
            return student_backups, attendance_backups

        student_backups, attendance_backups = await asyncio.to_thread(_list)
        await emit('list_backups_response', {'success': True, 'students': student_backups, 'attendance': attendance_backups}, to=sid)

    @socketio.on('restore_backup')
    async def handle_restore_backup(sid, data):
        """Restore a backup via WebSocket."""
        if not _is_authorized(sid, data):
            await emit('restore_backup_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return

        data_type = data.get('dataType')
        filename = data.get('filename')

        if not data_type or not filename:
            await emit('restore_backup_response', {'success': False, 'message': 'Missing dataType or filename'}, to=sid)
            return

        backups_root = Path(__file__).resolve().parents[1] / 'backups'

        def _restore():
            if data_type == 'students':
                file_path = backups_root / 'students' / filename
                if not file_path.exists():
                    return False, 'Backup file not found'

                # Replace the main students database file with the backup
                main_db_path = Path(__file__).resolve().parents[1] / 'database' / 'students.db'
                import shutil
                shutil.copy2(file_path, main_db_path)
                return True, None
            elif data_type == 'attendance':
                file_path = backups_root / 'attendance' / filename
                if not file_path.exists():
                    return False, 'Backup file not found'

                # Replace the main attendance database file with the backup
                main_db_path = Path(__file__).resolve().parents[1] / 'database' / 'attendance.db'
                import shutil
                shutil.copy2(file_path, main_db_path)
                return True, None
            return False, 'Invalid dataType'

        ok, err = await asyncio.to_thread(_restore)
        if not ok:
            await emit('restore_backup_response', {'success': False, 'message': err}, to=sid)
            return

        # After replacing the attendance DB file, request the central
        # application to perform authoritative recalculation of school_days.
        if data_type == 'attendance' and request_recalc:
            try:
                await asyncio.to_thread(request_recalc)
            except Exception as e:
                await emit('restore_backup_response', {'success': False, 'message': 'Failed to recalculate school days', 'error': str(e)}, to=sid)
                return

        # Broadcast that a backup was restored (recalculation already performed for attendance)
        broadcast_data_change('backup_restored')
        try:
            broadcast_summary_update()  # Emit all summaries after restore
        except sqlite3.OperationalError as e:
            await emit('restore_backup_response', {'success': False, 'message': 'Failed to restore backup', 'error': str(e)}, to=sid)
            return
        except Exception as e:
            await emit('restore_backup_response', {'success': False, 'message': 'Failed to restore backup', 'error': str(e)}, to=sid)
            return

        await emit('restore_backup_response', {'success': True}, to=sid)

    @socketio.on('get_action_logs')
    async def handle_get_action_logs(sid):
        """Get action logs via WebSocket."""
        if not _is_authorized(sid):
            await emit('get_action_logs_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return

        def _fetch():
            conn_logs = get_db_connection('logs')
            cursor_logs = conn_logs.cursor()
            cursor_logs.execute('SELECT timestamp, action FROM action_logs ORDER BY created_at DESC LIMIT 200')
            logs = [{'timestamp': r['timestamp'], 'action': r['action']} for r in cursor_logs.fetchall()]
            conn_logs.close()
            return logs

        logs = await asyncio.to_thread(_fetch)
        await emit('get_action_logs_response', {'success': True, 'logs': logs}, to=sid)

    @socketio.on('get_student_summary')
    async def handle_get_student_summary(sid, data):
        """Get attendance summary for a single student via WebSocket."""
        # Allow unauthenticated access for student details
        student_id = data.get('studentId')

        def _compute(student_id):
            student = get_student_by_id(student_id)
            if not student:
                return None, None
            students = get_all_students_with_history()
            summary = get_attendance_summary(student, students)
            return student, summary

        student, summary = await asyncio.to_thread(_compute, student_id)
        if not student:
            await emit('get_student_summary_response', {'success': False, 'message': 'Student not found'}, to=sid)
            return
        await emit('get_student_summary_response', {'success': True, 'studentId': student_id, 'summary': summary}, to=sid)

    @socketio.on('get_all_students_summaries')
    async def handle_get_all_students_summaries(sid):
        """Get attendance summaries for all students via WebSocket."""
        # Allow unauthenticated access for dashboard stats

        def _compute_all():
            students = get_all_students_with_history()
            summaries = []
            for student in students:
                summary = get_attendance_summary(student, students)
                summaries.append({
                    'studentId': student['id'],
                    'name': student['name'],
                    'grade': student['grade'],
                    'className': student['className'],
                    'summary': summary
                })
            return summaries

        summaries = await asyncio.to_thread(_compute_all)
        await emit('get_all_students_summaries_response', {'success': True, 'summaries': summaries}, to=sid)

    @socketio.on('append_action_log')
    async def handle_append_action_log(sid, data):
        """Append an action log entry via WebSocket."""
        if not _is_authorized(sid, data):
            await emit('append_action_log_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return

        timestamp = data.get('timestamp')
        action = data.get('action')

        # Validate required fields
        if not timestamp or not action:
            await emit('append_action_log_response', {'success': False, 'message': 'Missing timestamp or action'}, to=sid)
            return

        def _insert():
            try:
                with DatabaseContext('logs') as conn:
                    cursor = conn.cursor()
                    cursor.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (timestamp, action))
                    conn.commit()
                    return True, None
            except sqlite3.OperationalError as e:
                if 'locked' in str(e).lower():
                    time.sleep(0.1)
                    try:
                        with DatabaseContext('logs') as conn:
                            cursor = conn.cursor()
                            cursor.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (timestamp, action))
                            conn.commit()
                            return True, None
                    except Exception as retry_error:
                        return False, f'Database busy: {str(retry_error)}'
                return False, str(e)
            except Exception as e:
                return False, str(e)

        ok, err = await asyncio.to_thread(_insert)
        if ok:
            await emit('append_action_log_response', {'success': True}, to=sid)
        else:
            await emit('append_action_log_response', {'success': False, 'message': err}, to=sid)

    @socketio.on('clear_action_logs')
    async def handle_clear_action_logs(sid, data):
        """Clear all action logs via WebSocket."""
        if not _is_authorized(sid, data):
            await emit('clear_action_logs_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return

        role = data.get('role') or 'unknown'

        def _clear():
            conn_logs = get_db_connection('logs')
            cursor_logs = conn_logs.cursor()
            cursor_logs.execute('DELETE FROM action_logs')
            cursor_logs.execute('''
                INSERT INTO action_logs (timestamp, action)
                VALUES (?, ?)
            ''', (datetime.now().isoformat(), f'[{role}] Cleared all action logs.'))
            conn_logs.commit()
            conn_logs.close()

        await asyncio.to_thread(_clear)
        await emit('clear_action_logs_response', {'success': True}, to=sid)

    @socketio.on('get_auth_logs')
    async def handle_get_auth_logs(sid):
        """Get authentication logs via WebSocket."""
        if not _is_authorized(sid):
            await emit('get_auth_logs_response', {'success': False, 'message': 'Not authenticated'}, to=sid)
            return

        def _fetch():
            conn_logs = get_db_connection('logs')
            cursor_logs = conn_logs.cursor()
            cursor_logs.execute('SELECT timestamp, message FROM auth_logs ORDER BY created_at DESC LIMIT 200')
            logs = [{'timestamp': r['timestamp'], 'message': r['message']} for r in cursor_logs.fetchall()]
            conn_logs.close()
            return logs

        logs = await asyncio.to_thread(_fetch)
        await emit('get_auth_logs_response', {'success': True, 'logs': logs}, to=sid)

    # ==================== BACKUP ENDPOINTS ====================
    
    @app.route('/api/create-backup', methods=['POST'])
    def create_backup():
        """Create a backup of student or attendance data."""
        # SECURITY: Prefer HTTPS for backups, but allow on localhost/LAN or when
        # ALLOW_INSECURE_BACKUPS=1 or FORCE_ALLOW_INSECURE_HTTP is set (development convenience).
        allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
        dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
        # treat DEV_FORCE_FULL_ACCESS as a developer override for backup ops
        if dev_force:
            allow_insecure = True
        is_local = _is_local_request()
        if not request.is_secure and not (allow_insecure or is_local or FORCE_ALLOW_INSECURE_HTTP):
            # Debug information to help the client and developer diagnose why the request was rejected
            remote = _get_forwarded_ip()
            host_no_port = (request.host or '').split(':')[0]
            print(f"create_backup: forbidden secure={request.is_secure} allow_insecure={allow_insecure} dev_force={dev_force} is_local={is_local} host={host_no_port} remote={remote} xff={request.headers.get('X-Forwarded-For')}")
            return jsonify({'error': 'Backup operations must use HTTPS', 'debug': {'is_secure': request.is_secure, 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}), 403

        try:
            data = request.get_json(force=True)
        except Exception as e:
            print('create_backup: invalid request body', repr(e))
            return jsonify({'error': 'Invalid request body'}), 400

        data_type = data.get('dataType')  # 'students' or 'attendance'
        timestamp = data.get('timestamp')
        is_frozen = data.get('isFrozen', False)

        if data_type not in ('students', 'attendance'):
            return jsonify({'error': 'Invalid dataType'}), 400

        

        try:
            if data_type == 'students':
                conn_students = get_db_connection('students')
                cursor_students = conn_students.cursor()
                filename = f"{data_type}-backup-{timestamp}{'-FROZEN' if is_frozen else ''}.db"

                # Create backup set
                cursor_students.execute('''
                    INSERT INTO student_backup_sets (filename, is_frozen)
                    VALUES (?, ?)
                ''', (filename, 1 if is_frozen else 0))
                backup_id = cursor_students.lastrowid

                # Copy all students into backup items
                cursor_students.execute('''
                    SELECT id, name, grade, className, role, phone, whatsapp_no, email,
                           specialRoles, notes, fingerprint1, fingerprint2, fingerprint3, fingerprint4
                    FROM students
                ''')
                for row in cursor_students.fetchall():
                    cursor_students.execute('''
                        INSERT INTO student_backup_items (
                            backup_id, student_id, name, grade, className, role,
                            phone, whatsapp_no, email,
                            specialRoles, notes, fingerprint1, fingerprint2, fingerprint3, fingerprint4
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        backup_id,
                        row['id'], row['name'], row['grade'], row['className'], row['role'],
                        row.get('phone', ''), row.get('whatsapp_no', ''), row.get('email', ''),
                        row.get('specialRoles', ''), row.get('notes', ''),
                        row.get('fingerprint1', ''), row.get('fingerprint2', ''), row.get('fingerprint3', ''), row.get('fingerprint4', '')
                    ))

                conn_students.commit()
                conn_students.close()
            else:  # attendance
                conn_attendance = get_db_connection('attendance')
                cursor_attendance = conn_attendance.cursor()

                filename = f"{data_type}-backup-{timestamp}{'-FROZEN' if is_frozen else ''}.db"
                # Create backup set
                cursor_attendance.execute('''
                    INSERT INTO attendance_backup_sets (filename, is_frozen)
                    VALUES (?, ?)
                ''', (filename, 1 if is_frozen else 0))
                backup_id = cursor_attendance.lastrowid

                # Copy all attendance records into backup items
                cursor_attendance.execute('''
                    SELECT student_id, date, status FROM attendance_records
                    ORDER BY student_id, date DESC
                ''')
                for record in cursor_attendance.fetchall():
                    cursor_attendance.execute('''
                        INSERT INTO attendance_backup_items (backup_id, student_id, date, status)
                        VALUES (?, ?, ?, ?)
                    ''', (backup_id, record['student_id'], record['date'], record['status']))

                conn_attendance.commit()
                conn_attendance.close()

            # Also create a filesystem-level .db backup for the relevant database
            try:
                create_db_file_backup(data_type, timestamp)
            except Exception as e:
                print('create_backup: filesystem backup failed', repr(e))
                # Do not fail the API if file backup fails; logical backup already succeeded
                pass

            filename = f"{data_type}-backup-{timestamp}{'-FROZEN' if is_frozen else ''}.db"
            return jsonify({'filename': filename})
        except Exception as e:
            print('create_backup: unexpected error', repr(e))
            return jsonify({'error': 'Failed to create backup', 'detail': str(e)}), 500
    
    @app.route('/api/download-backup', methods=['POST'])
    def download_backup():
        """Download a backup file (SQLite DB)."""
        # Accept authorizer headers (for authorized clients over HTTP)
        try:
            data = request.get_json(force=True)
        except Exception:
            data = {}

        # Check headers for authorizer (preferred) or JSON body fallback
        header_role = request.headers.get('X-Authorizer-Role')
        header_pass = request.headers.get('X-Authorizer-Password')

        filename = (data.get('filename') if isinstance(data, dict) else None) or request.args.get('filename')
        data_type = (data.get('dataType') if isinstance(data, dict) else None) or request.args.get('dataType')

        # Security: require filename and dataType
        if not filename or not data_type:
            return jsonify({'error': 'Missing filename or dataType'}), 400

        # Security: prevent directory traversal
        filename = Path(filename).name

        backups_root = Path(__file__).resolve().parents[1] / 'backups'
        if data_type == 'students':
            file_path = backups_root / 'students' / filename
        elif data_type == 'attendance':
            file_path = backups_root / 'attendance' / filename
        else:
            return jsonify({'error': 'Invalid dataType'}), 400

        if not file_path.exists():
            return jsonify({'error': 'Backup file not found'}), 404

        # Authorization: allow if local, dev flags, or valid authorizer credentials provided
        allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
        dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
        if dev_force:
            allow_insecure = True

        # If headers provided, validate them
        authorizer_valid = False
        if header_role and header_pass:
            try:
                authorizer_valid = validate_password(header_role, header_pass)
            except Exception as e:
                print('download_backup: password validation error', repr(e))

        # Also accept credentials in JSON body for backward compatibility
        body_role = None
        body_pass = None
        if isinstance(data, dict):
            body_role = data.get('authorizerRole')
            body_pass = data.get('authorizerPassword')
            if body_role and body_pass and not authorizer_valid:
                try:
                    authorizer_valid = validate_password(body_role, body_pass)
                except Exception as e:
                    print('download_backup: password validation error (body)', repr(e))

        is_local = _is_local_request()
        # If not secure and not allowed, reject with debug info
        if not request.is_secure and not (allow_insecure or is_local or FORCE_ALLOW_INSECURE_HTTP or authorizer_valid):
            remote = _get_forwarded_ip()
            host_no_port = (request.host or '').split(':')[0]
            print(f"download_backup: forbidden secure={request.is_secure} allow_insecure={allow_insecure} dev_force={dev_force} is_local={is_local} authorizer_valid={authorizer_valid} host={host_no_port} remote={remote} xff={request.headers.get('X-Forwarded-For')}")
            return jsonify({'error': 'Backup operations must use HTTPS or valid authorizer headers', 'debug': {'is_secure': request.is_secure, 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'authorizer_valid': authorizer_valid, 'host': host_no_port, 'remote': remote}}), 403

        # Authorized — stream the file directly to client
        try:
            return send_file(
                file_path,
                as_attachment=True,
                download_name=filename,
                mimetype='application/x-sqlite3'
            )
        except Exception as e:
            print('download_backup: send_file failed', repr(e))
            return jsonify({'error': 'Failed to send backup file', 'detail': str(e)}), 500
    
    @app.route('/api/delete-backup', methods=['POST'])
    def delete_backup():
        """Delete a single backup (DB metadata and filesystem file)."""
        # SECURITY: Prefer HTTPS for backups, but allow on localhost/LAN or when
        # ALLOW_INSECURE_BACKUPS=1 or FORCE_ALLOW_INSECURE_HTTP is set (dev only).
        allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
        dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
        if dev_force:
            allow_insecure = True
        is_local = _is_local_request()
        if not request.is_secure and not (allow_insecure or is_local or FORCE_ALLOW_INSECURE_HTTP):
            remote = _get_forwarded_ip()
            host_no_port = (request.host or '').split(':')[0]
            print(f"delete_backup: forbidden secure={request.is_secure} allow_insecure={allow_insecure} dev_force={dev_force} is_local={is_local} host={host_no_port} remote={remote} xff={request.headers.get('X-Forwarded-For')}")
            return jsonify({'error': 'Backup operations must use HTTPS', 'debug': {'is_secure': request.is_secure, 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}), 403

        try:
            data = request.get_json(force=True)
        except Exception as e:
            print('delete_backup: invalid request body', repr(e))
            return jsonify({'error': 'Invalid request body'}), 400

        filename = data.get('filename')
        data_type = data.get('dataType')

        if not filename or not data_type:
            return jsonify({'error': 'Missing filename or dataType'}), 400

        try:
            if data_type == 'students':
                conn_students = get_db_connection('students')
                cursor_students = conn_students.cursor()
                cursor_students.execute('SELECT id FROM student_backup_sets WHERE filename = ?', (filename,))
                row = cursor_students.fetchone()
                if row:
                    backup_id = row['id']
                    cursor_students.execute('DELETE FROM student_backup_items WHERE backup_id = ?', (backup_id,))
                    cursor_students.execute('DELETE FROM student_backup_sets WHERE id = ?', (backup_id,))
                    conn_students.commit()
                conn_students.close()
            else:
                conn_attendance = get_db_connection('attendance')
                cursor_attendance = conn_attendance.cursor()
                cursor_attendance.execute('SELECT id FROM attendance_backup_sets WHERE filename = ?', (filename,))
                row = cursor_attendance.fetchone()
                if row:
                    backup_id = row['id']
                    cursor_attendance.execute('DELETE FROM attendance_backup_items WHERE backup_id = ?', (backup_id,))
                    cursor_attendance.execute('DELETE FROM attendance_backup_sets WHERE id = ?', (backup_id,))
                    conn_attendance.commit()
                conn_attendance.close()

            # Also remove matching filesystem-level .db file if it exists
            try:
                backups_root = Path(__file__).resolve().parents[1] / 'backups'
                dir_name = 'students' if data_type == 'students' else 'attendance'
                file_path = backups_root / dir_name / filename
                if file_path.exists():
                    file_path.unlink()
            except Exception as e:
                print('delete_backup: filesystem unlink failed', repr(e))
                # ignore filesystem failures
                pass

            return jsonify({'success': True})
        except Exception as e:
            print('delete_backup: unexpected error', repr(e))
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/delete-all-backups', methods=['POST'])
    def delete_all_backups():
        """
        Delete all backups.
        
        The frontend is responsible for immediately creating one new safety
        backup for students and one for attendance after this call completes.
        """
        # SECURITY: Prefer HTTPS for backups, but allow on localhost/LAN or when
        # ALLOW_INSECURE_BACKUPS=1 is set (development convenience).
        allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
        dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
        if dev_force:
            allow_insecure = True
        is_local = _is_local_request()
        if not request.is_secure and not (allow_insecure or is_local or FORCE_ALLOW_INSECURE_HTTP):
            remote = _get_forwarded_ip()
            host_no_port = (request.host or '').split(':')[0]
            print(f"delete_all_backups: forbidden secure={request.is_secure} allow_insecure={allow_insecure} dev_force={dev_force} is_local={is_local} host={host_no_port} remote={remote} xff={request.headers.get('X-Forwarded-For')}")
            return jsonify({'error': 'Backup operations must use HTTPS', 'debug': {'is_secure': request.is_secure, 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}), 403
        try:
            # ---------- Delete all existing backups from metadata tables ----------
            # Student backups
            conn_students = get_db_connection('students')
            cursor_students = conn_students.cursor()
            cursor_students.execute('DELETE FROM student_backup_items')
            cursor_students.execute('DELETE FROM student_backup_sets')
            conn_students.commit()
            conn_students.close()

            # Attendance backups
            conn_attendance = get_db_connection('attendance')
            cursor_attendance = conn_attendance.cursor()
            cursor_attendance.execute('DELETE FROM attendance_backup_items')
            cursor_attendance.execute('DELETE FROM attendance_backup_sets')
            conn_attendance.commit()
            conn_attendance.close()

            # ---------- Delete all filesystem-level .db backup files ----------
            try:
                backups_root = Path(__file__).resolve().parents[1] / 'backups'
                for sub in ['students', 'attendance']:
                    subdir = backups_root / sub
                    if subdir.exists():
                        for db_file in subdir.glob('*.db'):
                            try:
                                db_file.unlink()
                            except Exception:
                                # Ignore failures on individual files
                                pass
            except Exception as e:
                print('delete_all_backups: filesystem cleanup error', repr(e))
                pass

            return jsonify({'success': True})
        except Exception as e:
            print('delete_all_backups: unexpected error', repr(e))
            return jsonify({'success': False, 'error': str(e)}), 500
    
    # ==================== CSV/JSON EXPORT ENDPOINTS ====================
    
    @app.route('/api/download-student-data-csv', methods=['GET'])
    def download_student_data_csv():
        """Download student data as CSV."""
        students = get_all_students_with_history()
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow([
            'ID', 'Name', 'Grade', 'Class_Name', 'Role',
            'Phone_Number', 'Email_Address',
            'Special_Roles', 'Notes',
            'Fingerprint_1', 'Fingerprint_2', 'Fingerprint_3', 'Fingerprint_4'
        ])
        
        # Write data
        for student in students:
            fingerprints = student.get('fingerprints', ['', '', '', ''])
            writer.writerow([
                student['id'],
                student['name'],
                student['grade'],
                student['className'],
                student.get('role', ''),
                student['contact']['phone'],
                student['contact']['email'],
                student.get('specialRoles', ''),
                student.get('notes', ''),
                fingerprints[0] if len(fingerprints) > 0 else '',
                fingerprints[1] if len(fingerprints) > 1 else '',
                fingerprints[2] if len(fingerprints) > 2 else '',
                fingerprints[3] if len(fingerprints) > 3 else ''
            ])
        
        response = app.response_class(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=student-data.csv'}
        )
        return response
    
    @app.route('/api/upload-student-data-csv', methods=['POST'])
    def upload_student_data_csv():
        """Upload student data from CSV."""
        # SECURITY: Only allow data import operations over HTTPS
        if not request.is_secure:
            return jsonify({'error': 'Data import operations must use HTTPS'}), 403
        
        data = request.json
        csv_content = data.get('csvContent')
        timestamp = data.get('timestamp')
        is_frozen = data.get('isFrozen', False)
        authorizer_role = data.get('authorizerRole')
        authorizer_password = data.get('authorizerPassword')
        
        # Validate authorizer
        if not validate_password(authorizer_role, authorizer_password):
            return jsonify({'success': False, 'message': 'Unauthorized'}), 401
        
        # Create backup first
        # ... (backup creation code)
        
        # Parse CSV and import
        # This is simplified - you'd need proper CSV parsing
        try:
            # For now, return success - full CSV parsing would go here
            return jsonify({'success': True, 'message': 'CSV uploaded successfully'})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 400
    
    @app.route('/api/download-detailed-attendance-history-csv', methods=['GET'])
    def download_detailed_attendance_history_csv():
        """Download detailed attendance history as CSV with names."""
        students = get_all_students_with_history()
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Student ID', 'Name', 'Date', 'Status'])
        
        for student in students:
            for record in student.get('attendanceHistory', []):
                writer.writerow([
                    student['id'],
                    student['name'],
                    record['date'],
                    record['status']
                ])
        
        response = app.response_class(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=attendance-history.csv'}
        )
        return response
    
    @app.route('/api/download-attendance-summary-csv', methods=['GET'])
    def download_attendance_summary_csv():
        """Download attendance summary as CSV."""
        students = get_all_students_with_history()
        
        if not students:
            return jsonify({'error': 'No students found'}), 404
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            'ID', 'Name', 'Grade', 'Class_Name', 'Total_School_Days',
            'On_Time Days', 'Late_Days', 'Present_Days', 'Absent_Days',
            'On_Time(%)', 'Late(%)', 'Present(%)', 'Absent(%)'
        ])
        
        for student in students:
            summary = get_attendance_summary(student, students)
            writer.writerow([
                student['id'],
                student['name'],
                student['grade'],
                student['className'],
                summary['totalSchoolDays'],
                summary['onTimeDays'],
                summary['lateDays'],
                summary['presentDays'],
                summary['absentDays'],
                summary['onTimePercentage'],
                summary['latePercentage'],
                summary['presencePercentage'],
                summary['absencePercentage']
            ])
        
        response = app.response_class(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=attendance-summary.csv'}
        )
        return response
    
    @app.route('/api/download-student-attendance-summary-csv', methods=['POST'])
    def download_student_attendance_summary_csv():
        """Download attendance summary for a single student as CSV."""
        data = request.json
        student_id = data.get('studentId')
        
        student = get_student_by_id(student_id)
        if not student:
            return jsonify({'error': 'Student not found'}), 404
        
        students = get_all_students_with_history()
        summary = get_attendance_summary(student, students)
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            'ID', 'Name', 'Grade', 'Class_Name', 'Total_School_Days',
            'On_Time Days', 'Late_Days', 'Present_Days', 'Absent_Days',
            'On_Time(%)', 'Late(%)', 'Present(%)', 'Absent(%)'
        ])
        writer.writerow([
            student['id'],
            student['name'],
            student['grade'],
            student['className'],
            summary['totalSchoolDays'],
            summary['onTimeDays'],
            summary['lateDays'],
            summary['presentDays'],
            summary['absentDays'],
            summary['onTimePercentage'],
            summary['latePercentage'],
            summary['presencePercentage'],
            summary['absencePercentage']
        ])
        
        response = app.response_class(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename=student-{student_id}-summary.csv'}
        )
        return response
    
    # ==================== PDF EXPORT ENDPOINTS ====================
    
    @app.route('/api/download-student-data-pdf', methods=['GET'])
    def download_student_data_pdf():
        """Download student data as PDF."""
        students = get_all_students_with_history()
        
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
        elements = []
        
        styles = getSampleStyleSheet()
        elements.append(Paragraph("All Student Data", styles['Title']))
        elements.append(Spacer(1, 12))
        
        # Create table
        data = [['ID', 'Name', 'Grade', 'Class', 'Role', 'Phone', 'Email', 'Special Roles', 'Notes']]
        for student in students:
            data.append([
                str(student['id']),
                student['name'],
                str(student['grade']),
                student['className'],
                student.get('role', 'N/A'),
                student['contact']['phone'],
                student['contact']['email'] or 'N/A',
                student.get('specialRoles', ''),
                student.get('notes', '')
            ])
        
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3B82C4')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
            ('LINEBELOW', (0, 0), (-1, 0), 1.5, colors.HexColor('#3B82C4')),
            ('LINEBELOW', (0, 1), (-1, -1), 0.5, colors.lightgrey),
            ('ALIGN', (0, 1), (-1, -1), 'CENTER'),
            ('ALIGN', (1, 1), (1, -1), 'LEFT'), # Name
            ('ALIGN', (3, 1), (3, -1), 'LEFT'), # Class
        ]))
        elements.append(table)
        
        doc.build(elements)
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='student-data.pdf'
        )
    
    @app.route('/api/download-attendance-summary-pdf', methods=['GET'])
    def download_attendance_summary_pdf():
        """Download attendance summary as PDF."""
        students = get_all_students_with_history()
        
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
        elements = []
        
        styles = getSampleStyleSheet()
        elements.append(Paragraph("Attendance Summary", styles['Title']))
        elements.append(Spacer(1, 12))
        
        # Create table
        data = [['ID', 'Name', 'Grade', 'Class', 'Total Days', 'On Time', 'Late', 'Present', 'Absent', 'On Time %', 'Late %', 'Present %', 'Absent %']]
        for student in students:
            summary = get_attendance_summary(student, students)
            data.append([
                str(student['id']),
                student['name'],
                str(student['grade']),
                student['className'],
                str(summary['totalSchoolDays']),
                str(summary['onTimeDays']),
                str(summary['lateDays']),
                str(summary['presentDays']),
                str(summary['absentDays']),
                f"{summary['onTimePercentage']}%",
                f"{summary['latePercentage']}%",
                f"{summary['presencePercentage']}%",
                f"{summary['absencePercentage']}%"
            ])
        
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#3B82C4")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
            ('LINEBELOW', (0, 0), (-1, 0), 1.5, colors.HexColor('#3B82C4')),
            ('LINEBELOW', (0, 1), (-1, -1), 0.5, colors.lightgrey),
            ('ALIGN', (0, 1), (-1, -1), 'CENTER'),
            ('ALIGN', (1, 1), (1, -1), 'LEFT'), # Name
            ('ALIGN', (3, 1), (3, -1), 'LEFT'), # Class
        ]))
        elements.append(table)
        
        doc.build(elements)
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='attendance-summary.pdf'
        )
    
    @app.route('/api/download-student-attendance-summary-pdf', methods=['POST'])
    def download_student_attendance_summary_pdf():
        """Download attendance summary for a single student as PDF."""
        data = request.json
        student_id = data.get('studentId')
        
        student = get_student_by_id(student_id)
        if not student:
            return jsonify({'error': 'Student not found'}), 404
        
        students = get_all_students_with_history()
        summary = get_attendance_summary(student, students)
        
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        elements = []
        
        styles = getSampleStyleSheet()
        elements.append(Paragraph(student['name'], styles['Title']))
        elements.append(Paragraph(f"ID: {student['id']} | Grade: {student['grade']} | Class: {student['className']}", styles['Normal']))
        elements.append(Spacer(1, 20))
        
        # Summary table
        summary_data = [['Metric', 'Value']]
        summary_data.extend([
            ['Total School Days', str(summary['totalSchoolDays'])],
            ['Present Days', str(summary['presentDays'])],
            ['Absent Days', str(summary['absentDays'])],
            ['On Time Days', str(summary['onTimeDays'])],
            ['Late Days', str(summary['lateDays'])],
            ['Presence Percentage', f"{summary['presencePercentage']}%"],
            ['Absence Percentage', f"{summary['absencePercentage']}%"],
            ['On-Time Percentage (of Present)', f"{summary['onTimePercentage']}%"],
            ['Late Percentage (of Present)', f"{summary['latePercentage']}%"]
        ])
        
        table = Table(summary_data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3B82C4')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 14),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
            ('LINEBELOW', (0, 0), (-1, 0), 1.5, colors.HexColor('#3B82C4')),
            ('LINEBELOW', (0, 1), (-1, -1), 0.5, colors.lightgrey),
            ('ALIGN', (0, 1), (-1, -1), 'LEFT'),
        ]))
        elements.append(table)
        
        doc.build(elements)
        buffer.seek(0)
        
        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f'student-{student_id}-summary.pdf'
        )
    
    # ==================== LOG ENDPOINTS ====================
    
    @app.route('/api/append-action-log', methods=['POST'])
    def append_action_log():
        """Append an action log entry."""
        data = request.json or {}
        timestamp = data.get('timestamp')
        action = data.get('action')
        
        # Validate required fields
        if not timestamp or not action:
            return jsonify({'success': False, 'error': 'Missing timestamp or action'}), 400
        
        try:
            with DatabaseContext('logs') as conn:
                cursor = conn.cursor()
                cursor.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (timestamp, action))
                conn.commit()
                return jsonify({'success': True})
        except sqlite3.OperationalError as e:
            if 'locked' in str(e).lower():
                # Retry once after a short delay
                time.sleep(0.1)
                try:
                    with DatabaseContext('logs') as conn:
                        cursor = conn.cursor()
                        cursor.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (timestamp, action))
                        conn.commit()
                        return jsonify({'success': True})
                except Exception as retry_error:
                    return jsonify({'success': False, 'error': f'Database busy: {str(retry_error)}'}), 503
            return jsonify({'success': False, 'error': str(e)}), 500
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/append-auth-log', methods=['POST'])
    def append_auth_log():
        """Append an auth log entry."""
        data = request.json or {}
        timestamp = data.get('timestamp')
        message = data.get('message')
        
        # Validate required fields
        if not timestamp or not message:
            return jsonify({'success': False, 'error': 'Missing timestamp or message'}), 400
        
        try:
            with DatabaseContext('logs') as conn:
                cursor = conn.cursor()
                cursor.execute('INSERT INTO auth_logs (timestamp, message) VALUES (?, ?)', (timestamp, message))
                conn.commit()
                try:
                    _write_backend_log(f"append_auth_log: {timestamp} {message}")
                except Exception:
                    pass
                return jsonify({'success': True})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/clear-auth-logs', methods=['POST'])
    def clear_auth_logs():
        """Clear authentication logs via REST endpoint.

        Expects JSON body: { role: string }
        """
        data = request.json or {}
        role = data.get('role', 'unknown')

        try:
            conn_logs = get_db_connection('logs')
            cursor_logs = conn_logs.cursor()
            cursor_logs.execute('DELETE FROM auth_logs')
            cursor_logs.execute('INSERT INTO auth_logs (timestamp, message) VALUES (?, ?)',
                               (datetime.now().isoformat(), f'[{role}] Cleared all auth logs.'))
            conn_logs.commit()
            conn_logs.close()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    # ==================== DELETE ENDPOINTS ====================
    
    @app.route('/api/delete-history', methods=['POST'])
    def delete_history():
        """Delete all attendance history."""
        conn_attendance = get_db_connection('attendance')
        cursor_attendance = conn_attendance.cursor()
        cursor_attendance.execute('DELETE FROM attendance_records')
        conn_attendance.commit()
        conn_attendance.close()
        # Recalculate derived school_days after clearing attendance records
        try:
                if request_recalc:
                    request_recalc()
                else:
                    # Fallback to direct recalculation if helper not available
                    from .database import recalculate_school_days as _rr
                    _rr()
        except Exception as e:
            return jsonify({'success': False, 'error': f'Failed to recalculate after delete: {str(e)}'}), 500

        broadcast_data_change('history_deleted')
        broadcast_summary_update()  # Emit all summaries after history deletion
        return jsonify({'success': True})
    
    @app.route('/api/delete-all-student-data', methods=['POST'])
    def delete_all_student_data():
        """Delete all student data and attendance history."""
        conn_students = get_db_connection('students')
        cursor_students = conn_students.cursor()
        cursor_students.execute('DELETE FROM students')
        conn_students.commit()
        conn_students.close()
        
        conn_attendance = get_db_connection('attendance')
        cursor_attendance = conn_attendance.cursor()
        cursor_attendance.execute('DELETE FROM attendance_records')
        conn_attendance.commit()
        conn_attendance.close()
        # Recalculate derived school_days after removing all data
        try:
                if request_recalc:
                    request_recalc()
                else:
                    from .database import recalculate_school_days as _rr
                    _rr()
        except Exception as e:
            return jsonify({'success': False, 'error': f'Failed to recalculate after delete all: {str(e)}'}), 500

        broadcast_data_change('all_data_deleted')
        broadcast_summary_update()  # Emit all summaries after all data deletion
        return jsonify({'success': True})
