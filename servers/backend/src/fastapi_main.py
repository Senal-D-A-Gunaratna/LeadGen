from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import traceback
import sqlite3
import time
from datetime import datetime, date, timedelta
from fastapi import Request
from fastapi.responses import StreamingResponse
import asyncio
import os
import json
import csv
import io
import shutil
from pathlib import Path
from .database import get_db_connection, DatabaseContext, create_db_file_backup
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.platypus.flowables import Flowable
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

# Import existing helpers from app.py
from . import app as flask_app

fastapi_app = FastAPI(title="LeadGen Backend (FastAPI) - Student APIs")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.get("/api/health")
async def health():
    return {"status": "ok"}


@fastapi_app.get('/api/server/connections')
async def api_server_connections():
    """Return current connection counts (total and authenticated).

    Reads the in-memory tracking structures from the Flask app module so
    the frontend can poll over HTTP instead of relying on WebSocket events.
    """
    try:
        total = 0
        authenticated = 0
        try:
            total = len(flask_app.connected_sids)
        except Exception:
            total = 0
        try:
            authenticated = len(getattr(flask_app, 'authenticated_sessions', {}))
        except Exception:
            authenticated = 0
        return JSONResponse({'success': True, 'total': total, 'authenticated': authenticated})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get('/api/events/poll')
async def api_events_poll(since: Optional[int] = Query(0), timeout: Optional[int] = Query(25)):
    """Long-poll endpoint: returns events newer than `since`.

    Query params:
      - since: integer event id (default 0)
      - timeout: seconds to block waiting for new events (default 25)
    """
    try:
        loop = asyncio.get_running_loop()
        # Delegate waiting to the Flask app's thread-safe waiter to reuse
        # the same event queue used by internal broadcast functions.
        events = await loop.run_in_executor(None, flask_app.wait_for_events, int(since or 0), int(timeout or 25))
        latest = max((e['id'] for e in events), default=int(since or 0))
        return JSONResponse({'success': True, 'events': events, 'latest_id': latest})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get('/api/static-filters')
async def api_static_filters():
    """Return computed static filters (grades, classes, roles)."""
    try:
        out = flask_app.compute_static_filters_from_db()
        return JSONResponse({'success': True, **out})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.post('/api/save-attendance')
async def api_save_attendance(request: Request):
    """Save attendance records (mirror of Flask `/api/save-attendance`).

    Expects JSON: { students: [ { student_id, attendanceHistory: [ { date, status, checkInTime? } ] } ] }
    """
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON payload'}, status_code=400)

    students = payload.get('students') if isinstance(payload, dict) else None
    if students is None:
        return JSONResponse({'success': False, 'message': 'Missing students array in payload'}, status_code=400)

    inserts = []
    affected_ids = []
    try:
        from datetime import timezone
        for student in students:
            sid = student.get('student_id') or student.get('id') or student.get('studentId')
            if sid is None:
                continue
            for record in student.get('attendanceHistory', []):
                date_str = record.get('date')
                if not date_str:
                    return JSONResponse({'success': False, 'message': f'Invalid or missing date for student {sid}'}, status_code=400)
                try:
                    parsed_date = date.fromisoformat(date_str)
                except Exception:
                    return JSONResponse({'success': False, 'message': f'Invalid date format for student {sid}: {date_str}'}, status_code=400)
                # Reject weekend dates
                if parsed_date.weekday() >= 5:
                    return JSONResponse({'success': False, 'message': 'Weekend attendance cannot be marked. Please select a weekday (Monday-Friday).'} , status_code=400)

                status_val = (record.get('status') or '').strip()
                if status_val.lower() == 'absent':
                    check_in_time = None
                else:
                    supplied = record.get('checkInTime') or record.get('check_in_time')
                    check_in_time = supplied if supplied else datetime.now(timezone.utc).isoformat()

                inserts.append((sid, parsed_date.isoformat(), record.get('status'), datetime.now(timezone.utc).isoformat(), check_in_time))
            if sid not in affected_ids:
                affected_ids.append(sid)

        if not inserts:
            return JSONResponse({'success': False, 'message': 'No attendance records to save.'}, status_code=400)

        conn_attendance = get_db_connection('attendance')
        cursor_attendance = conn_attendance.cursor()
        for ins in inserts:
            cursor_attendance.execute('''
                INSERT OR REPLACE INTO attendance_records (student_id, date, status, updated_at, check_in_time)
                VALUES (?, ?, ?, ?, ?)
            ''', ins)
        conn_attendance.commit()
        conn_attendance.close()

        try:
            # attempt to reuse Flask's recalculation if available
            try:
                flask_app.recalculate_school_days()
            except Exception:
                pass
            flask_app.broadcast_data_change('attendance_updated', {'affectedIds': affected_ids})
            flask_app.broadcast_summary_update(affected_ids)
        except Exception:
            pass

        return JSONResponse({'success': True})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'message': str(e)}, status_code=500)


@fastapi_app.post('/api/scan')
async def api_scan(request: Request):
    """Scan fingerprint (HTTP wrapper for scanner devices).

    Expects JSON: { fingerprint: string, scanner_token?: string }
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON'}, status_code=400)
    fingerprint = data.get('fingerprint')
    scanner_token = data.get('scanner_token')
    try:
        # Allow HTTP auth via header token if provided
        # (fastapi_main delegates authentication elsewhere when needed)
        result = await asyncio.get_running_loop().run_in_executor(None, flask_app.perform_scan_sync, fingerprint, scanner_token, None)
        return JSONResponse(result)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'message': str(e)}, status_code=500)


@fastapi_app.post('/api/auth/login')
async def api_auth_login(request: Request):
    """Authenticate using role+password and return a server-side session token."""
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON'}, status_code=400)
    role = data.get('role')
    password = data.get('password')
    if not role or not password:
        return JSONResponse({'success': False, 'message': 'Missing role or password'}, status_code=400)
    try:
        # Reuse Flask app's validate_password and create_http_session
        if flask_app.validate_password(role, password):
            token = flask_app.create_http_session(role)
            return JSONResponse({'success': True, 'token': token, 'role': role})
        else:
            return JSONResponse({'success': False, 'message': 'Invalid credentials'}, status_code=401)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'message': str(e)}, status_code=500)


@fastapi_app.post('/api/auth/validate')
async def api_auth_validate(request: Request):
    """Validate either a role+password or an existing token.

    JSON body may include `{ "role": "admin", "password": "..." }` or
    `{ "token": "..." }`. Returns `{ valid: true }` on success.
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON'}, status_code=400)
    token = data.get('token')
    if token:
        try:
            role = flask_app.validate_http_token(token)
            return JSONResponse({'success': True, 'valid': bool(role), 'role': role})
        except Exception as e:
            traceback.print_exc()
            return JSONResponse({'success': False, 'message': str(e)}, status_code=500)
    role = data.get('role')
    password = data.get('password')
    if role and password:
        try:
            valid = flask_app.validate_password(role, password)
            return JSONResponse({'success': True, 'valid': bool(valid)})
        except Exception as e:
            traceback.print_exc()
            return JSONResponse({'success': False, 'message': str(e)}, status_code=500)
    return JSONResponse({'success': False, 'message': 'Missing token or role/password'}, status_code=400)


@fastapi_app.get('/api/attendance/has_data')
async def api_attendance_has_data(month: Optional[str] = Query(None), start: Optional[str] = Query(None), end: Optional[str] = Query(None), grade: Optional[str] = Query('all'), classFilter: Optional[str] = Query(None), roleFilter: Optional[str] = Query(None)):
    """Return whether any attendance records exist for a given month or date range.

    Query params:
      - month: YYYY-MM (optional)
      - start, end: YYYY-MM-DD (optional)
      - grade: grade number or 'all'
      - classFilter: className or 'all'
      - roleFilter: role or 'all' or 'none'
    """
    try:
        from datetime import date, timedelta
        # allow None during parsing; will assert non-None later
        start_date: Optional[date] = None
        end_date: Optional[date] = None
        # derive date range
        if month:
            try:
                sd = date.fromisoformat(f"{month}-01")
            except Exception:
                raise HTTPException(status_code=400, detail='Invalid month format (expected YYYY-MM)')
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
                raise HTTPException(status_code=400, detail='Invalid date format for start/end')

        if start_date is None or end_date is None:
            # fallback: derive range from attendance_records
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
                # no records at all
                return JSONResponse({'success': True, 'hasData': False})

        # At this point both start_date and end_date should be non-None
        assert start_date is not None and end_date is not None

        if start_date > end_date:
            start_date, end_date = end_date, start_date

        # Build count query; optionally join students for filters
        from typing import List, Any
        params: List[Any] = [start_date.isoformat(), end_date.isoformat()]
        join_students = False
        where_clauses = ['ar.date BETWEEN ? AND ?']
        if grade and grade != 'all':
            join_students = True
            where_clauses.append('s.grade = ?')
            # sqlite3 accepts ints; allow mixed param types
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
            sql = f"SELECT COUNT(1) as cnt FROM attendance_records ar JOIN students s ON s.student_id = ar.student_id WHERE {' AND '.join(where_clauses)}"
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
        return JSONResponse({'success': True, 'hasData': has})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.on_event('startup')
async def _startup_watchers():
    # Initialize the Flask app's DB-mtime handler on the FastAPI/ASGI
    # event loop so `app.py` owns recalculation and broadcasting.
    try:
        import asyncio
        try:
            # Use the running ASGI event loop so the backend stores the
            # correct loop for thread -> asyncio callbacks.
            flask_app.setup_db_mtime_handler(asyncio.get_running_loop())
        except Exception:
            try:
                flask_app.setup_db_mtime_handler(asyncio.get_event_loop())
            except Exception:
                pass
    except Exception:
        pass


def _filter_students_list(students: List[dict], search: Optional[str], status: Optional[str], grade: Optional[str], class_name: Optional[str], role: Optional[str]):
    out = students
    if search:
        s = search.lower()
        out = [st for st in out if s in (st.get('name','') or '').lower() or s in (st.get('contact',{}).get('phone','') or '') or s in (st.get('contact',{}).get('email','') or '')]
    if status and status != 'all':
        out = [st for st in out if st.get('status') == status]
    if grade and grade != 'all':
        try:
            g = int(grade)
            out = [st for st in out if st.get('grade') == g]
        except Exception:
            pass
    if class_name and class_name != 'all':
        out = [st for st in out if st.get('className') == class_name]
    if role and role != 'all':
        out = [st for st in out if (st.get('role') or 'none') == role]
    return out


@fastapi_app.get("/api/students")
async def api_get_students(date: Optional[str] = Query(None), searchQuery: Optional[str] = Query(None), statusFilter: Optional[str] = Query(None), gradeFilter: Optional[str] = Query(None), classFilter: Optional[str] = Query(None), roleFilter: Optional[str] = Query(None)):
    try:
        students = flask_app.get_all_students_with_history(date)
        filtered = _filter_students_list(students, searchQuery, statusFilter, gradeFilter, classFilter, roleFilter)
        return JSONResponse({"success": True, "students": filtered})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get("/api/students/{student_id}")
async def api_get_student(student_id: int):
    # Delegated to the Flask `app.py` implementation which is mounted
    # at the root of the ASGI app. Keep this lightweight wrapper so FastAPI
    # does not duplicate computation or diverge from the authoritative logic.
    try:
        # Forward to Flask handler for consistent behavior
        student = flask_app.get_student_by_id(student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        return JSONResponse({"success": True, "student": student})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get('/api/students/{student_id}/summary')
async def api_get_student_summary(student_id: int):
    # Delegate to Flask `get_attendance_summary` to avoid duplicate
    # computation and to ensure consistent responses regardless of
    # which HTTP adapter (Flask or FastAPI) is in use.
    try:
        student = flask_app.get_student_by_id(student_id)
        if not student:
            raise HTTPException(status_code=404, detail='Student not found')
        all_students = flask_app.get_all_students_with_history()
        summary = flask_app.get_attendance_summary(student, all_students)
        return JSONResponse({'success': True, 'studentId': student_id, 'summary': summary})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.post('/api/add-student')
async def api_add_student(request: Request):
    """Add a student via HTTP (requires bearer token).

    Body: same shape as frontend `addStudent` payload.
    """
    try:
        auth = request.headers.get('authorization') or request.headers.get('Authorization')
        token = None
        if auth and auth.lower().startswith('bearer '):
            token = auth.split(' ', 1)[1]
        role = flask_app.validate_http_token(token) if token else None
        if not role:
            return JSONResponse({'success': False, 'message': 'Not authenticated'}, status_code=401)
        data = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON'}, status_code=400)

    # Validate minimal fields
    if not data or not data.get('name'):
        return JSONResponse({'success': False, 'message': 'Missing student data'}, status_code=400)

    try:
        conn_students = get_db_connection('students')
        cursor_students = conn_students.cursor()
        cursor_students.execute('SELECT MAX(student_id) FROM students')
        max_id = cursor_students.fetchone()[0] or 0
        next_id = max_id + 1

        fingerprints = data.get('fingerprints', ['', '', '', ''])

        cursor_students.execute('''
            INSERT INTO students (student_id, name, grade, className, role, email, phone,
                                whatsapp_no, fingerprint1, fingerprint2, fingerprint3, fingerprint4,
                                specialRoles, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            next_id,
            data.get('name'),
            data.get('grade'),
            data.get('className'),
            data.get('role'),
            (data.get('contact') or {}).get('email'),
            (data.get('contact') or {}).get('phone'),
            (data.get('contact') or {}).get('whatsapp') or (data.get('contact') or {}).get('whatsapp_no') or '',
            fingerprints[0] if len(fingerprints) > 0 else '',
            fingerprints[1] if len(fingerprints) > 1 else '',
            fingerprints[2] if len(fingerprints) > 2 else '',
            fingerprints[3] if len(fingerprints) > 3 else '',
            data.get('specialRoles', ''),
            data.get('notes', '')
        ))

        for position, fp in enumerate(fingerprints, start=1):
            if fp:
                cursor_students.execute('''
                    INSERT OR IGNORE INTO student_fingerprints_id (student_id, fingerprint, position)
                    VALUES (?, ?, ?)
                ''', (next_id, fp, position))

        conn_students.commit()
        conn_students.close()

        student = flask_app.get_student_by_id(next_id)
        try:
            flask_app.broadcast_data_change('student_added', {'studentId': next_id})
            flask_app.broadcast_summary_update([next_id])
        except Exception:
            pass
        return JSONResponse({'success': True, 'student': student})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'message': str(e)}, status_code=500)


@fastapi_app.post('/api/remove-student')
async def api_remove_student(request: Request):
    try:
        auth = request.headers.get('authorization') or request.headers.get('Authorization')
        token = None
        if auth and auth.lower().startswith('bearer '):
            token = auth.split(' ', 1)[1]
        role = flask_app.validate_http_token(token) if token else None
        if not role:
            return JSONResponse({'success': False, 'message': 'Not authenticated'}, status_code=401)
        data = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON'}, status_code=400)

    student_id = data.get('studentId')
    if not student_id:
        return JSONResponse({'success': False, 'message': 'Missing studentId'}, status_code=400)

    try:
        conn_students = get_db_connection('students')
        cursor_students = conn_students.cursor()
        cursor_students.execute('DELETE FROM students WHERE student_id = ?', (student_id,))
        conn_students.commit()
        conn_students.close()

        conn_attendance = get_db_connection('attendance')
        cursor_attendance = conn_attendance.cursor()
        cursor_attendance.execute('DELETE FROM attendance_records WHERE student_id = ?', (student_id,))
        conn_attendance.commit()
        conn_attendance.close()

        try:
            flask_app.broadcast_data_change('student_removed', {'studentId': student_id})
            flask_app.broadcast_summary_update()
        except Exception:
            pass
        return JSONResponse({'success': True})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'message': str(e)}, status_code=500)


@fastapi_app.post('/api/update-student')
async def api_update_student(request: Request):
    try:
        auth = request.headers.get('authorization') or request.headers.get('Authorization')
        token = None
        if auth and auth.lower().startswith('bearer '):
            token = auth.split(' ', 1)[1]
        role = flask_app.validate_http_token(token) if token else None
        if not role:
            return JSONResponse({'success': False, 'message': 'Not authenticated'}, status_code=401)
        data = await request.json()
    except Exception:
        return JSONResponse({'success': False, 'message': 'Invalid JSON'}, status_code=400)

    student_id = data.get('studentId')
    update_data = data.get('data')
    if not student_id or not update_data:
        return JSONResponse({'success': False, 'message': 'Missing studentId or data'}, status_code=400)

    try:
        conn_students = get_db_connection('students')
        cursor_students = conn_students.cursor()
        cursor_students.execute('SELECT * FROM students WHERE student_id = ?', (student_id,))
        existing = cursor_students.fetchone()
        if not existing:
            conn_students.close()
            return JSONResponse({'success': False, 'message': 'Student not found'}, status_code=404)

        existing_dict = dict(existing)

        name = update_data.get('name', existing_dict['name'])
        grade = update_data.get('grade', existing_dict['grade'])
        className = update_data.get('className', existing_dict['className'])
        role_val = update_data.get('role', existing_dict['role'])
        email = update_data.get('contact', {}).get('email', existing_dict['email'])
        phone = update_data.get('contact', {}).get('phone', existing_dict['phone'])
        whatsapp_no = update_data.get('contact', {}).get('whatsapp') or update_data.get('contact', {}).get('whatsapp_no') or existing_dict.get('whatsapp_no', '')
        specialRoles = update_data.get('specialRoles', existing_dict.get('specialRoles', ''))
        notes = update_data.get('notes', existing_dict.get('notes', ''))
        batch = update_data.get('bach') if update_data.get('bach') is not None else update_data.get('batch', existing_dict.get('batch', ''))

        fingerprints = update_data.get('fingerprints')
        if fingerprints is None:
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

        if 'role' in update_data and update_data['role'] is None:
            role_val = None

        cursor_students.execute('''
            UPDATE students
            SET name = ?, grade = ?, className = ?, role = ?, email = ?, phone = ?,
                whatsapp_no = ?, fingerprint1 = ?, fingerprint2 = ?, fingerprint3 = ?, fingerprint4 = ?,
                specialRoles = ?, notes = ?, batch = ?, updated_at = ?
            WHERE student_id = ?
        ''', (
            name, grade, className, role_val, email, phone,
            whatsapp_no,
            fingerprints[0] if len(fingerprints) > 0 else '',
            fingerprints[1] if len(fingerprints) > 1 else '',
            fingerprints[2] if len(fingerprints) > 2 else '',
            fingerprints[3] if len(fingerprints) > 3 else '',
            specialRoles, notes, batch, datetime.now().isoformat(),
            student_id
        ))

        cursor_students.execute('DELETE FROM student_fingerprints_id WHERE student_id = ?', (student_id,))
        for position, fp in enumerate(fingerprints, start=1):
            if fp:
                cursor_students.execute('''
                    INSERT OR IGNORE INTO student_fingerprints_id (student_id, fingerprint, position)
                    VALUES (?, ?, ?)
                ''', (student_id, fp, position))

        conn_students.commit()
        conn_students.close()

        student = flask_app.get_student_by_id(student_id)
        try:
            if isinstance(student, dict):
                student['bach'] = student.get('batch') or student.get('bach')
        except Exception:
            pass
        try:
            flask_app.broadcast_data_change('student_updated', {'studentId': student_id})
            flask_app.broadcast_summary_update([student_id])
        except Exception:
            pass
        return JSONResponse({'success': True, 'student': student})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'message': str(e)}, status_code=500)


# ------------------ Backups & export endpoints (migrated/adapted) ------------------

def _get_forwarded_ip(request: Request) -> str:
    xff = request.headers.get('x-forwarded-for', '')
    if xff:
        return xff.split(',')[0].strip()
    return (request.client.host if request.client else '') or ''

def _is_local_request(request: Request) -> bool:
    try:
        host_no_port = (request.headers.get('host','') or '').split(':')[0].lower()
        remote = _get_forwarded_ip(request)
        if host_no_port.startswith('127.') or 'localhost' in host_no_port:
            return True
        if remote in ('127.0.0.1', '::1'):
            return True
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


@fastapi_app.post('/api/create-backup')
async def create_backup(request: Request):
    allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
    dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
    if dev_force:
        allow_insecure = True
    is_local = _is_local_request(request)
    if request.url.scheme != 'https' and not (allow_insecure or is_local or os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1'):
        remote = _get_forwarded_ip(request)
        host_no_port = (request.headers.get('host','') or '').split(':')[0]
        return JSONResponse({'error': 'Backup operations must use HTTPS', 'debug': {'is_secure': request.url.scheme == 'https', 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}, status_code=403)
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({'error': 'Invalid request body'}, status_code=400)
    data_type = data.get('dataType')
    timestamp = data.get('timestamp')
    is_frozen = data.get('isFrozen', False)
    if data_type not in ('students', 'attendance'):
        return JSONResponse({'error': 'Invalid dataType'}, status_code=400)
    # Retry loop to handle transient sqlite 'database is locked' errors
    max_attempts = 6
    for attempt in range(1, max_attempts + 1):
        try:
            if data_type == 'students':
                with DatabaseContext('students') as conn_students:
                    cursor_students = conn_students.cursor()
                    filename = f"{data_type}-backup-{timestamp}{'-FROZEN' if is_frozen else ''}.db"
                    cursor_students.execute('''
                        INSERT INTO student_backup_sets (filename, is_frozen)
                        VALUES (?, ?)
                    ''', (filename, 1 if is_frozen else 0))
                    backup_id = cursor_students.lastrowid
                    cursor_students.execute('''
                        SELECT id, name, grade, className, role, phone, whatsapp_no, email,
                               specialRoles, notes, fingerprint1, fingerprint2, fingerprint3, fingerprint4
                        FROM students
                    ''')
                    rows = cursor_students.fetchall()
                    for row in rows:
                        r = dict(row)
                        cursor_students.execute('''
                            INSERT INTO student_backup_items (
                                backup_id, student_id, name, grade, className, role,
                                phone, whatsapp_no, email,
                                specialRoles, notes, fingerprint1, fingerprint2, fingerprint3, fingerprint4
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            backup_id,
                            r['student_id'], r.get('name'), r.get('grade'), r.get('className'), r.get('role'),
                            r.get('phone', ''), r.get('whatsapp_no', ''), r.get('email', ''),
                            r.get('specialRoles', ''), r.get('notes', ''),
                            r.get('fingerprint1', ''), r.get('fingerprint2', ''), r.get('fingerprint3', ''), r.get('fingerprint4', '')
                        ))
                    conn_students.commit()
            else:
                with DatabaseContext('attendance') as conn_attendance:
                    cursor_attendance = conn_attendance.cursor()
                    filename = f"{data_type}-backup-{timestamp}{'-FROZEN' if is_frozen else ''}.db"
                    cursor_attendance.execute('''
                        INSERT INTO attendance_backup_sets (filename, is_frozen)
                        VALUES (?, ?)
                    ''', (filename, 1 if is_frozen else 0))
                    backup_id = cursor_attendance.lastrowid
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

            # Attempt filesystem-level copy; retry on transient errors
            try:
                create_db_file_backup(data_type, timestamp)
            except sqlite3.OperationalError as e:
                if 'locked' in str(e).lower() and attempt < max_attempts:
                    time.sleep(0.2 * attempt)
                    continue
                # otherwise ignore filesystem copy errors
            filename = f"{data_type}-backup-{timestamp}{'-FROZEN' if is_frozen else ''}.db"
            return JSONResponse({'filename': filename})
        except sqlite3.OperationalError as e:
            if 'locked' in str(e).lower() and attempt < max_attempts:
                time.sleep(0.15 * attempt)
                continue
            return JSONResponse({'error': 'Failed to create backup', 'detail': str(e)}, status_code=500)
        except Exception as e:
            return JSONResponse({'error': 'Failed to create backup', 'detail': str(e)}, status_code=500)
    return JSONResponse({'error': 'Failed to create backup', 'detail': 'max retries exceeded'}, status_code=500)


@fastapi_app.post('/api/download-backup')
async def download_backup(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    header_role = request.headers.get('X-Authorizer-Role')
    header_pass = request.headers.get('X-Authorizer-Password')
    filename = (data.get('filename') if isinstance(data, dict) else None) or request.query_params.get('filename')
    data_type = (data.get('dataType') if isinstance(data, dict) else None) or request.query_params.get('dataType')
    if not filename or not data_type:
        return JSONResponse({'error': 'Missing filename or dataType'}, status_code=400)
    filename = Path(filename).name
    backups_root = Path(__file__).resolve().parents[1] / 'backups'
    if data_type == 'students':
        file_path = backups_root / 'students' / filename
    elif data_type == 'attendance':
        file_path = backups_root / 'attendance' / filename
    else:
        return JSONResponse({'error': 'Invalid dataType'}, status_code=400)
    if not file_path.exists():
        return JSONResponse({'error': 'Backup file not found'}, status_code=404)
    allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
    dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
    if dev_force:
        allow_insecure = True
    authorizer_valid = False
    if header_role and header_pass:
        try:
            from .api_endpoints import validate_password
            authorizer_valid = validate_password(header_role, header_pass)
        except Exception:
            authorizer_valid = False
    if isinstance(data, dict):
        body_role = data.get('authorizerRole')
        body_pass = data.get('authorizerPassword')
        if body_role and body_pass and not authorizer_valid:
            try:
                from .api_endpoints import validate_password
                authorizer_valid = validate_password(body_role, body_pass)
            except Exception:
                authorizer_valid = False
    is_local = _is_local_request(request)
    if request.url.scheme != 'https' and not (allow_insecure or is_local or os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1' or authorizer_valid):
        remote = _get_forwarded_ip(request)
        host_no_port = (request.headers.get('host','') or '').split(':')[0]
        return JSONResponse({'error': 'Backup operations must use HTTPS or valid authorizer headers', 'debug': {'is_secure': request.url.scheme == 'https', 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'authorizer_valid': authorizer_valid, 'host': host_no_port, 'remote': remote}}, status_code=403)
    try:
        def file_stream():
            with open(file_path, 'rb') as fh:
                while True:
                    chunk = fh.read(8192)
                    if not chunk:
                        break
                    yield chunk
        return StreamingResponse(file_stream(), media_type='application/x-sqlite3', headers={'Content-Disposition': f'attachment; filename={filename}'})
    except Exception as e:
        return JSONResponse({'error': 'Failed to send backup file', 'detail': str(e)}, status_code=500)


@fastapi_app.post('/api/delete-backup')
async def delete_backup(request: Request):
    allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
    dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
    if dev_force:
        allow_insecure = True
    is_local = _is_local_request(request)
    if request.url.scheme != 'https' and not (allow_insecure or is_local or os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1'):
        remote = _get_forwarded_ip(request)
        host_no_port = (request.headers.get('host','') or '').split(':')[0]
        return JSONResponse({'error': 'Backup operations must use HTTPS', 'debug': {'is_secure': request.url.scheme == 'https', 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}, status_code=403)
    try:
        data = await request.json()
    except Exception as e:
        return JSONResponse({'error': 'Invalid request body'}, status_code=400)
    filename = data.get('filename')
    data_type = data.get('dataType')
    if not filename or not data_type:
        return JSONResponse({'error': 'Missing filename or dataType'}, status_code=400)
    try:
        if data_type == 'students':
            conn_students = get_db_connection('students')
            cursor_students = conn_students.cursor()
            cursor_students.execute('SELECT id FROM student_backup_sets WHERE filename = ?', (filename,))
            row = cursor_students.fetchone()
            if row:
                backup_id = row['student_id']
                cursor_students.execute('DELETE FROM student_backup_items WHERE backup_id = ?', (backup_id,))
                cursor_students.execute('DELETE FROM student_backup_sets WHERE student_id = ?', (backup_id,))
                conn_students.commit()
            conn_students.close()
        else:
            conn_attendance = get_db_connection('attendance')
            cursor_attendance = conn_attendance.cursor()
            cursor_attendance.execute('SELECT id FROM attendance_backup_sets WHERE filename = ?', (filename,))
            row = cursor_attendance.fetchone()
            if row:
                backup_id = row['student_id']
                cursor_attendance.execute('DELETE FROM attendance_backup_items WHERE backup_id = ?', (backup_id,))
                cursor_attendance.execute('DELETE FROM attendance_backup_sets WHERE student_id = ?', (backup_id,))
                conn_attendance.commit()
            conn_attendance.close()
        try:
            backups_root = Path(__file__).resolve().parents[1] / 'backups'
            dir_name = 'students' if data_type == 'students' else 'attendance'
            file_path = backups_root / dir_name / filename
            if file_path.exists():
                file_path.unlink()
        except Exception:
            pass
        return JSONResponse({'success': True})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.post('/api/delete-all-backups')
async def delete_all_backups(request: Request):
    allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
    dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
    if dev_force:
        allow_insecure = True
    is_local = _is_local_request(request)
    if request.url.scheme != 'https' and not (allow_insecure or is_local or os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1'):
        remote = _get_forwarded_ip(request)
        host_no_port = (request.headers.get('host','') or '').split(':')[0]
        return JSONResponse({'error': 'Backup operations must use HTTPS', 'debug': {'is_secure': request.url.scheme == 'https', 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}, status_code=403)
    try:
        conn_students = get_db_connection('students')
        cursor_students = conn_students.cursor()
        cursor_students.execute('DELETE FROM student_backup_items')
        cursor_students.execute('DELETE FROM student_backup_sets')
        conn_students.commit()
        conn_students.close()
        conn_attendance = get_db_connection('attendance')
        cursor_attendance = conn_attendance.cursor()
        cursor_attendance.execute('DELETE FROM attendance_backup_items')
        cursor_attendance.execute('DELETE FROM attendance_backup_sets')
        conn_attendance.commit()
        conn_attendance.close()
        try:
            backups_root = Path(__file__).resolve().parents[1] / 'backups'
            for sub in ['students', 'attendance']:
                subdir = backups_root / sub
                if subdir.exists():
                    for db_file in subdir.glob('*.db'):
                        try:
                            db_file.unlink()
                        except Exception:
                            pass
        except Exception:
            pass
        return JSONResponse({'success': True})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.get('/api/download-student-data-csv')
async def download_student_data_csv():
    students = flask_app.get_all_students_with_history()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'ID', 'Name', 'Grade', 'Class_Name', 'Role',
        'Phone_Number', 'Email_Address',
        'Special_Roles', 'Notes',
        'Fingerprint_1', 'Fingerprint_2', 'Fingerprint_3', 'Fingerprint_4'
    ])
    for student in students:
        fingerprints = student.get('fingerprints', ['', '', '', ''])
        writer.writerow([
            student['student_id'],
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
    return StreamingResponse(io.BytesIO(output.getvalue().encode('utf-8')), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename=student-data.csv'})


@fastapi_app.post('/api/upload-student-data-csv')
async def upload_student_data_csv(request: Request):
    """Upload student data from CSV (HTTP wrapper of the legacy Flask route).
    This keeps behavior minimal: enforces HTTPS (unless allowed), validates authorizer,
    creates a filesystem backup if `timestamp` is provided, and returns success.
    Full CSV parsing/import is intentionally left as the original implementation.
    """
    allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
    dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
    if dev_force:
        allow_insecure = True
    is_local = _is_local_request(request)
    if request.url.scheme != 'https' and not (allow_insecure or is_local or os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1'):
        remote = _get_forwarded_ip(request)
        host_no_port = (request.headers.get('host','') or '').split(':')[0]
        return JSONResponse({'error': 'Data import operations must use HTTPS', 'debug': {'is_secure': request.url.scheme == 'https', 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'host': host_no_port, 'remote': remote}}, status_code=403)
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({'error': 'Invalid request body'}, status_code=400)
    csv_content = data.get('csvContent')
    timestamp = data.get('timestamp')
    is_frozen = data.get('isFrozen', False)
    authorizer_role = data.get('authorizerRole')
    authorizer_password = data.get('authorizerPassword')

    # Validate authorizer
    try:
        from .api_endpoints import validate_password
        if not validate_password(authorizer_role, authorizer_password):
            return JSONResponse({'success': False, 'message': 'Unauthorized'}, status_code=401)
    except Exception:
        return JSONResponse({'success': False, 'message': 'Unauthorized'}, status_code=401)

    # Create a filesystem-level backup of the students DB before import if requested
    if timestamp:
        try:
            await asyncio.to_thread(create_db_file_backup, 'students', timestamp)
        except Exception:
            # Don't fail the whole request for backup write issues; return an error if critical
            return JSONResponse({'success': False, 'message': 'Failed to create backup before import'}, status_code=500)

    # NOTE: Full CSV parsing/import is intentionally not implemented here (keeps parity with legacy)
    return JSONResponse({'success': True, 'message': 'CSV uploaded successfully'})


@fastapi_app.post('/api/restore-backup')
async def restore_backup(request: Request):
    """Restore a backup (HTTP wrapper mirroring the WebSocket `restore_backup` handler).
    Security: allow when request is local or HTTPS or a valid authorizer is provided.
    """
    try:
        data = await request.json()
    except Exception:
        data = {}
    data_type = data.get('dataType')
    filename = data.get('filename')

    if not data_type or not filename:
        return JSONResponse({'success': False, 'message': 'Missing dataType or filename'}, status_code=400)

    # Authorization: either allow local/https or validate authorizer headers/body
    allow_insecure = os.environ.get('ALLOW_INSECURE_BACKUPS') == '1'
    dev_force = os.environ.get('DEV_FORCE_FULL_ACCESS') == '1'
    if dev_force:
        allow_insecure = True
    is_local = _is_local_request(request)
    header_role = request.headers.get('X-Authorizer-Role')
    header_pass = request.headers.get('X-Authorizer-Password')
    authorizer_valid = False
    try:
        from .api_endpoints import validate_password
        if header_role and header_pass:
            authorizer_valid = validate_password(header_role, header_pass)
        if not authorizer_valid:
            body_role = data.get('authorizerRole')
            body_pass = data.get('authorizerPassword')
            if body_role and body_pass:
                authorizer_valid = validate_password(body_role, body_pass)
    except Exception:
        authorizer_valid = False

    if request.url.scheme != 'https' and not (allow_insecure or is_local or os.environ.get('FORCE_ALLOW_INSECURE_HTTP') == '1' or authorizer_valid):
        remote = _get_forwarded_ip(request)
        host_no_port = (request.headers.get('host','') or '').split(':')[0]
        return JSONResponse({'error': 'Backup operations must use HTTPS or valid authorizer headers', 'debug': {'is_secure': request.url.scheme == 'https', 'allow_insecure': allow_insecure, 'dev_force': dev_force, 'is_local': is_local, 'authorizer_valid': authorizer_valid, 'host': host_no_port, 'remote': remote}}, status_code=403)

    backups_root = Path(__file__).resolve().parents[1] / 'backups'

    def _restore():
        try:
            if data_type == 'students':
                file_path = backups_root / 'students' / Path(filename).name
                if not file_path.exists():
                    return False, 'Backup file not found'
                main_db_path = Path(__file__).resolve().parents[1] / 'database' / 'students.db'
                shutil.copy2(file_path, main_db_path)
                return True, None
            elif data_type == 'attendance':
                file_path = backups_root / 'attendance' / Path(filename).name
                if not file_path.exists():
                    return False, 'Backup file not found'
                main_db_path = Path(__file__).resolve().parents[1] / 'database' / 'attendance.db'
                shutil.copy2(file_path, main_db_path)
                return True, None
            return False, 'Invalid dataType'
        except Exception as e:
            return False, str(e)

    ok, err = await asyncio.to_thread(_restore)
    if not ok:
        return JSONResponse({'success': False, 'message': err}, status_code=500)

    # After replacing the attendance DB file, request authoritative recalculation
    if data_type == 'attendance':
        try:
            await asyncio.to_thread(flask_app.request_recalc)
        except Exception as e:
            return JSONResponse({'success': False, 'message': 'Failed to recalculate school days', 'error': str(e)}, status_code=500)

    # Broadcast that a backup was restored
    try:
        flask_app.broadcast_data_change('backup_restored')
        try:
            flask_app.broadcast_summary_update()
        except sqlite3.OperationalError as e:
            return JSONResponse({'success': False, 'message': 'Failed to restore backup', 'error': str(e)}, status_code=500)
        except Exception as e:
            return JSONResponse({'success': False, 'message': 'Failed to restore backup', 'error': str(e)}, status_code=500)
    except Exception:
        # If broadcasting fails, still return success for the restore itself
        pass

    return JSONResponse({'success': True})


@fastapi_app.get('/api/list-backups')
async def list_backups(request: Request):
    """Return available backup filenames for students and attendance."""
    try:
        backups_root = Path(__file__).resolve().parents[1] / 'backups'
        students_dir = backups_root / 'students'
        attendance_dir = backups_root / 'attendance'

        students_dir.mkdir(parents=True, exist_ok=True)
        attendance_dir.mkdir(parents=True, exist_ok=True)

        def _list():
            student_backups = sorted([p.name for p in students_dir.glob('*.db')], reverse=True)
            attendance_backups = sorted([p.name for p in attendance_dir.glob('*.db')], reverse=True)
            return student_backups, attendance_backups

        student_backups, attendance_backups = await asyncio.to_thread(_list)
        return JSONResponse({'success': True, 'students': student_backups, 'attendance': attendance_backups})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.get('/api/download-detailed-attendance-history-csv')
async def download_detailed_attendance_history_csv():
    students = flask_app.get_all_students_with_history()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Student ID', 'Name', 'Date', 'Status'])
    for student in students:
        for record in student.get('attendanceHistory', []):
            writer.writerow([student['student_id'], student['name'], record['date'], record['status']])
    return StreamingResponse(io.BytesIO(output.getvalue().encode('utf-8')), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename=attendance-history.csv'})


@fastapi_app.get('/api/download-attendance-summary-csv')
async def download_attendance_summary_csv():
    students = flask_app.get_all_students_with_history()
    if not students:
        return JSONResponse({'error': 'No students found'}, status_code=404)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'ID', 'Name', 'Grade', 'Class_Name', 'Total_School_Days',
        'On_Time Days', 'Late_Days', 'Present_Days', 'Absent_Days',
        'On_Time(%)', 'Late(%)', 'Present(%)', 'Absent(%)'
    ])
    for student in students:
        summary = flask_app.get_attendance_summary(student, students)
        writer.writerow([
            student['student_id'],
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
    return StreamingResponse(io.BytesIO(output.getvalue().encode('utf-8')), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename=attendance-summary.csv'})


@fastapi_app.post('/api/download-student-attendance-summary-csv')
async def download_student_attendance_summary_csv(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    student_id = data.get('studentId')
    student = flask_app.get_student_by_id(student_id)
    if not student:
        return JSONResponse({'error': 'Student not found'}, status_code=404)
    students = flask_app.get_all_students_with_history()
    summary = flask_app.get_attendance_summary(student, students)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'ID', 'Name', 'Grade', 'Class_Name', 'Total_School_DAYS',
        'On_Time Days', 'Late_Days', 'Present_Days', 'Absent_Days',
        'On_Time(%)', 'Late(%)', 'Present(%)', 'Absent(%)'
    ])
    writer.writerow([
        student['student_id'],
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
    return StreamingResponse(io.BytesIO(output.getvalue().encode('utf-8')), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename=student-{student_id}-summary.csv'})


@fastapi_app.get('/api/download-student-data-pdf')
async def download_student_data_pdf():
    students = flask_app.get_all_students_with_history()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
    from typing import List
    elements: List[Flowable] = []
    styles = getSampleStyleSheet()
    elements.append(Paragraph("All Student Data", styles['Title']))
    elements.append(Spacer(1, 12))
    data = [['ID', 'Name', 'Grade', 'Class', 'Role', 'Phone', 'Email', 'Special Roles', 'Notes']]
    for student in students:
        data.append([str(student['student_id']), student['name'], str(student['grade']), student['className'], student.get('role', 'N/A'), student['contact']['phone'], student['contact']['email'] or 'N/A', student.get('specialRoles', ''), student.get('notes', '')])
    table = Table(data)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3B82C4')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ]))
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type='application/pdf', headers={'Content-Disposition': 'attachment; filename=student-data.pdf'})


@fastapi_app.get('/api/download-attendance-summary-pdf')
async def download_attendance_summary_pdf():
    students = flask_app.get_all_students_with_history()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
    from typing import List
    elements: List[Flowable] = []
    styles = getSampleStyleSheet()
    elements.append(Paragraph("Attendance Summary", styles['Title']))
    elements.append(Spacer(1, 12))
    data = [['ID', 'Name', 'Grade', 'Class', 'Total Days', 'On Time', 'Late', 'Present', 'Absent', 'On Time %', 'Late %', 'Present %', 'Absent %']]
    for student in students:
        summary = flask_app.get_attendance_summary(student, students)
        data.append([str(student['student_id']), student['name'], str(student['grade']), student['className'], str(summary['totalSchoolDays']), str(summary['onTimeDays']), str(summary['lateDays']), str(summary['presentDays']), str(summary['absentDays']), f"{summary['onTimePercentage']}%", f"{summary['latePercentage']}%", f"{summary['presencePercentage']}%", f"{summary['absencePercentage']}%"])
    table = Table(data)
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type='application/pdf', headers={'Content-Disposition': 'attachment; filename=attendance-summary.pdf'})


@fastapi_app.post('/api/download-student-attendance-summary-pdf')
async def download_student_attendance_summary_pdf(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    student_id = data.get('studentId')
    student = flask_app.get_student_by_id(student_id)
    if not student:
        return JSONResponse({'error': 'Student not found'}, status_code=404)
    students = flask_app.get_all_students_with_history()
    summary = flask_app.get_attendance_summary(student, students)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    from typing import List
    elements: List[Flowable] = []
    styles = getSampleStyleSheet()
    elements.append(Paragraph(student['name'], styles['Title']))
    elements.append(Paragraph(f"ID: {student['student_id']} | Grade: {student['grade']} | Class: {student['className']}", styles['Normal']))
    elements.append(Spacer(1, 20))
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
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename=student-{student_id}-summary.pdf'})


# ------------------ Log endpoints (migrated from api_endpoints.py) ------------------
@fastapi_app.post('/api/append-action-log')
async def append_action_log(data: dict):
    timestamp = data.get('timestamp')
    action = data.get('action')
    if not timestamp or not action:
        return JSONResponse({'success': False, 'error': 'Missing timestamp or action'}, status_code=400)
    try:
        from .database import DatabaseContext
        try:
            with DatabaseContext('logs') as conn:
                cursor = conn.cursor()
                cursor.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (timestamp, action))
                conn.commit()
                return JSONResponse({'success': True})
        except sqlite3.OperationalError as e:
            if 'locked' in str(e).lower():
                time.sleep(0.1)
                with DatabaseContext('logs') as conn:
                    cursor = conn.cursor()
                    cursor.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (timestamp, action))
                    conn.commit()
                    return JSONResponse({'success': True})
            return JSONResponse({'success': False, 'error': str(e)}, status_code=500)
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.post('/api/append-auth-log')
async def append_auth_log(data: dict):
    timestamp = data.get('timestamp')
    message = data.get('message')
    if not timestamp or not message:
        return JSONResponse({'success': False, 'error': 'Missing timestamp or message'}, status_code=400)
    try:
        from .database import DatabaseContext
        with DatabaseContext('logs') as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO auth_logs (timestamp, message) VALUES (?, ?)', (timestamp, message))
            conn.commit()
            return JSONResponse({'success': True})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.post('/api/clear-auth-logs')
async def clear_auth_logs(data: dict):
    role = (data or {}).get('role', 'unknown')
    try:
        from .database import get_db_connection
        conn_logs = get_db_connection('logs')
        cursor_logs = conn_logs.cursor()
        cursor_logs.execute('DELETE FROM auth_logs')
        cursor_logs.execute('INSERT INTO auth_logs (timestamp, message) VALUES (?, ?)', (datetime.now().isoformat(), f'[{role}] Cleared all auth logs.'))
        conn_logs.commit()
        conn_logs.close()
        return JSONResponse({'success': True})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.get('/api/action-logs')
async def api_get_action_logs(limit: Optional[int] = Query(500)):
    """Return recent action logs."""
    try:
        conn_logs = get_db_connection('logs')
        cur = conn_logs.cursor()
        cur.execute('SELECT id, timestamp, action FROM action_logs ORDER BY id DESC LIMIT ?', (int(limit),))
        rows = cur.fetchall()
        try:
            cur.connection.close()
        except Exception:
            pass
        logs = [{'id': r['id'], 'timestamp': r['timestamp'], 'action': r['action']} for r in rows]
        return JSONResponse({'success': True, 'logs': logs})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.post('/api/clear-action-logs')
async def api_clear_action_logs(data: dict):
    """Clear action logs and insert a clearing entry with the provided role."""
    role = (data or {}).get('role', 'unknown')
    try:
        conn_logs = get_db_connection('logs')
        cur = conn_logs.cursor()
        cur.execute('DELETE FROM action_logs')
        cur.execute('INSERT INTO action_logs (timestamp, action) VALUES (?, ?)', (datetime.now().isoformat(), f'[{role}] Cleared all action logs.'))
        conn_logs.commit()
        try:
            cur.connection.close()
        except Exception:
            pass
        return JSONResponse({'success': True})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.get('/api/auth-logs')
async def api_get_auth_logs(limit: Optional[int] = Query(500)):
    """Return recent authentication logs."""
    try:
        conn_logs = get_db_connection('logs')
        cur = conn_logs.cursor()
        cur.execute('SELECT id, timestamp, message FROM auth_logs ORDER BY id DESC LIMIT ?', (int(limit),))
        rows = cur.fetchall()
        try:
            cur.connection.close()
        except Exception:
            pass
        logs = [{'id': r['id'], 'timestamp': r['timestamp'], 'message': r['message']} for r in rows]
        return JSONResponse({'success': True, 'logs': logs})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.get("/api/students/{student_id}/attendance")
async def api_get_student_attendance(student_id: int, month: Optional[str] = Query(None)):
    try:
        student = flask_app.get_student_by_id(student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        # If no month filter provided, return precomputed attendanceHistory
        if not month:
            hist = student.get('attendanceHistory', [])
            return JSONResponse({"success": True, "attendanceHistory": hist})

        # Validate month and compute range
        try:
            from datetime import timedelta
            start_date = date.fromisoformat(f"{month}-01")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid month format (expected YYYY-MM)")

        if start_date.month == 12:
            next_month = date(start_date.year + 1, 1, 1)
        else:
            next_month = date(start_date.year, start_date.month + 1, 1)
        end_date = next_month - timedelta(days=1)

        # Query attendance DB for student's records in range
        try:
            from .database import get_db_connection
            conn_att = get_db_connection('attendance')
            cur = conn_att.cursor()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        cur.execute("PRAGMA table_info(attendance_records)")
        cols = [r['name'] for r in cur.fetchall()]
        if 'check_in_time' in cols:
            cur.execute('''
                SELECT date, status, check_in_time
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                ORDER BY date ASC
            ''', (student_id, start_date.isoformat(), end_date.isoformat()))
        else:
            cur.execute('''
                SELECT date, status, NULL as check_in_time
                FROM attendance_records
                WHERE student_id = ? AND date BETWEEN ? AND ?
                ORDER BY date ASC
            ''', (student_id, start_date.isoformat(), end_date.isoformat()))
        rows = cur.fetchall()

        def _normalize_status(s):
            if not s:
                return ''
            sl = str(s).strip().lower()
            if 'late' in sl:
                return 'late'
            if 'on' in sl and 'time' in sl:
                return 'on_time'
            if 'ontime' in sl or 'on_time' in sl or 'on-time' in sl:
                return 'on_time'
            if 'abs' in sl:
                return 'absent'
            return sl.replace(' ', '_')

        records_by_date = {}
        for r in rows:
            d = r['date']
            status = _normalize_status(r['status'])
            chk = r['check_in_time']
            if d not in records_by_date:
                records_by_date[d] = {'date': d, 'status': status, 'checkInTime': chk}
            else:
                existing = records_by_date[d]
                if existing.get('checkInTime') is None and chk is not None:
                    records_by_date[d] = {'date': d, 'status': status, 'checkInTime': chk}
                elif existing.get('checkInTime') is not None and chk is not None:
                    try:
                        if str(chk) < str(existing.get('checkInTime')):
                            records_by_date[d] = {'date': d, 'status': status, 'checkInTime': chk}
                    except Exception:
                        pass

        # Get canonical school days for the month
        try:
            cur.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
            sd_rows = cur.fetchall()
            school_days = [r['date'] for r in sd_rows]
        except Exception:
            from calendar import monthrange as _mr
            ld = _mr(start_date.year, start_date.month)[1]
            school_days = []
            for day_num in range(1, ld + 1):
                d = date(start_date.year, start_date.month, day_num)
                if d.weekday() >= 5:
                    continue
                school_days.append(d.isoformat())

        attendance_history = []
        for d in school_days:
            rec = records_by_date.get(d)
            if rec and rec.get('status') in ('on_time', 'late'):
                attendance_history.append({'date': d, 'status': rec.get('status'), 'checkInTime': rec.get('checkInTime')})
            else:
                attendance_history.append({'date': d, 'status': 'absent', 'checkInTime': None})

        conn_att.close()
        return JSONResponse({"success": True, "attendanceHistory": attendance_history})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get("/api/students/{student_id}/attendance/trend")
async def api_get_student_attendance_trend(student_id: int, month: Optional[str] = Query(None)):
    try:
        if not month:
            raise HTTPException(status_code=400, detail="month query parameter required in YYYY-MM format")
        student = flask_app.get_student_by_id(student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        # Build daily points for the month from attendanceHistory
        try:
            year = int(month.split('-')[0])
            mon = int(month.split('-')[1])
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid month format; expected YYYY-MM")

        # Filter student's attendance history
        hist = student.get('attendanceHistory', [])
        # Compute days in month
        import calendar
        days_in_month = calendar.monthrange(year, mon)[1]

        points = []
        for d in range(1, days_in_month + 1):
            label = f"{year}-{str(mon).zfill(2)}-{str(d).zfill(2)}"
            records = [r for r in hist if r.get('date') == label]
            on_time = 0
            late = 0
            absent = 0
            arrival_ts = None
            arrival_local = None
            arrival_minutes = None
            if records:
                for r in records:
                    if r.get('status') == 'on time':
                        on_time += 1
                    elif r.get('status') == 'late':
                        late += 1
                    if not arrival_ts and r.get('checkInTime'):
                        try:
                            from datetime import datetime
                            dobj = datetime.fromisoformat(r.get('checkInTime'))
                            arrival_ts = int(dobj.timestamp())
                            arrival_local = dobj.strftime('%H:%M')
                            arrival_minutes = dobj.hour * 60 + dobj.minute
                        except Exception:
                            pass
                absent = 0
            else:
                # Mark weekdays as absent by default
                import datetime as _dt
                dow = _dt.date(year, mon, d).weekday()
                absent = 1 if (dow >= 0 and dow <= 4) else 0
            points.append({"label": label, "date": label, "on_time": on_time, "late": late, "absent": absent, "arrival_ts": arrival_ts, "arrival_local": arrival_local, "arrival_minutes": arrival_minutes})

        return JSONResponse({"success": True, "points": points})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# Combined ASGI app: route `/api` to FastAPI app, everything else to existing Flask/Socket.IO ASGI app
class CombinedApp:
    def __init__(self, api_app, legacy_app):
        self.api_app = api_app
        self.legacy_app = legacy_app

    async def __call__(self, scope, receive, send):
        path = scope.get('path', '')
        if path.startswith('/api') or path.startswith('/_next') or path.startswith('/static'):
            await self.api_app(scope, receive, send)
        else:
            await self.legacy_app(scope, receive, send)


# Export ASGI application expected by uvicorn
from typing import Optional, Type
WSGIMiddleware: Optional[Type] = None
try:
    from starlette.middleware.wsgi import WSGIMiddleware as _WSGIMiddleware
    WSGIMiddleware = _WSGIMiddleware
except Exception:
    # Leave WSGIMiddleware as None when import fails
    pass

# Prefer the Flask-side ASGI adapter if provided; otherwise wrap the
# legacy Flask WSGI app with Starlette's WSGI middleware so the combined
# ASGI app still serves the legacy routes (note: websocket support
# requires the Flask-side ASGI adapter / python-socketio AsyncServer).
legacy_app = getattr(flask_app, 'asgi_app', None)
if legacy_app is None:
    if WSGIMiddleware is not None:
        legacy_app = WSGIMiddleware(flask_app.app)
    else:
        # Last-resort: try to use the Flask app's WSGI callable directly
        legacy_app = flask_app.app

app = CombinedApp(fastapi_app, legacy_app)
