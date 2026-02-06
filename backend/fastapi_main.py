from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import traceback
import sqlite3
import time
from datetime import datetime
from fastapi import Request
from fastapi.responses import StreamingResponse
import asyncio
import os
import json
import csv
import io
import shutil
from pathlib import Path
from database import get_db_connection, DatabaseContext, create_db_file_backup, recalculate_school_days, start_attendance_watcher, register_post_recalc_callback
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

# Import existing helpers from app.py
import app as flask_app

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


@fastapi_app.on_event('startup')
async def _startup_watchers():
    # Start background watcher for attendance DB changes
    try:
        start_attendance_watcher()
    except Exception:
        pass
    # Register callback so the ASGI/Flask app can broadcast updates when
    # attendance recalculation completes (useful for clients to refresh)
    try:
        def _on_recalc():
            try:
                # Use existing Flask app helper to broadcast a data_changed event
                flask_app.broadcast_data_change('attendance_db_changed', {})
            except Exception:
                pass
        register_post_recalc_callback(_on_recalc)
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
    try:
        student = flask_app.get_student_by_id(student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        # Also include authoritative attendance summary computed on the server
        try:
            all_students = flask_app.get_all_students_with_history()
            summary = flask_app.get_attendance_summary(student, all_students)
        except Exception:
            summary = None

        # Build an ordered student dict where `attendanceHistory` is last
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
            # Attendance Statistics placed before history
            'summary': summary,
            # Other metadata
            'status': student.get('status'),
            'hasScannedToday': student.get('hasScannedToday'),           
            'created_at': student.get('created_at'),
            'updated_at': student.get('updated_at'),
        }

        # Append attendanceHistory at the very end
        ordered_student['attendanceHistory'] = student.get('attendanceHistory', [])

        return JSONResponse({"success": True, "student": ordered_student})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@fastapi_app.get('/api/students/{student_id}/summary')
async def api_get_student_summary(student_id: int):
    """Return computed attendance summary for a student (uses server-side school_days).

    This endpoint provides an HTTP-first way for clients to obtain the
    authoritative attendance statistics for a student without relying on
    WebSocket RPCs.
    """
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
                            r['id'], r.get('name'), r.get('grade'), r.get('className'), r.get('role'),
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
    backups_root = Path(__file__).parent / 'backups'
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
            from api_endpoints import validate_password
            authorizer_valid = validate_password(header_role, header_pass)
        except Exception:
            authorizer_valid = False
    if isinstance(data, dict):
        body_role = data.get('authorizerRole')
        body_pass = data.get('authorizerPassword')
        if body_role and body_pass and not authorizer_valid:
            try:
                from api_endpoints import validate_password
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
        try:
            backups_root = Path(__file__).parent / 'backups'
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
            backups_root = Path(__file__).parent / 'backups'
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
        from api_endpoints import validate_password
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
        from api_endpoints import validate_password
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

    backups_root = Path(__file__).parent / 'backups'

    def _restore():
        try:
            if data_type == 'students':
                file_path = backups_root / 'students' / Path(filename).name
                if not file_path.exists():
                    return False, 'Backup file not found'
                main_db_path = Path(__file__).parent / 'data' / 'students.db'
                shutil.copy2(file_path, main_db_path)
                return True, None
            elif data_type == 'attendance':
                file_path = backups_root / 'attendance' / Path(filename).name
                if not file_path.exists():
                    return False, 'Backup file not found'
                main_db_path = Path(__file__).parent / 'data' / 'attendance.db'
                shutil.copy2(file_path, main_db_path)
                return True, None
            return False, 'Invalid dataType'
        except Exception as e:
            return False, str(e)

    ok, err = await asyncio.to_thread(_restore)
    if not ok:
        return JSONResponse({'success': False, 'message': err}, status_code=500)

    # After replacing the attendance DB file, recalculate derived school_days
    if data_type == 'attendance':
        try:
            await asyncio.to_thread(recalculate_school_days)
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


@fastapi_app.get('/api/download-detailed-attendance-history-csv')
async def download_detailed_attendance_history_csv():
    students = flask_app.get_all_students_with_history()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Student ID', 'Name', 'Date', 'Status'])
    for student in students:
        for record in student.get('attendanceHistory', []):
            writer.writerow([student['id'], student['name'], record['date'], record['status']])
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
    return StreamingResponse(io.BytesIO(output.getvalue().encode('utf-8')), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename=student-{student_id}-summary.csv'})


@fastapi_app.get('/api/download-student-data-pdf')
async def download_student_data_pdf():
    students = flask_app.get_all_students_with_history()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
    elements = []
    styles = getSampleStyleSheet()
    elements.append(Paragraph("All Student Data", styles['Title']))
    elements.append(Spacer(1, 12))
    data = [['ID', 'Name', 'Grade', 'Class', 'Role', 'Phone', 'Email', 'Special Roles', 'Notes']]
    for student in students:
        data.append([str(student['id']), student['name'], str(student['grade']), student['className'], student.get('role', 'N/A'), student['contact']['phone'], student['contact']['email'] or 'N/A', student.get('specialRoles', ''), student.get('notes', '')])
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
    elements = []
    styles = getSampleStyleSheet()
    elements.append(Paragraph("Attendance Summary", styles['Title']))
    elements.append(Spacer(1, 12))
    data = [['ID', 'Name', 'Grade', 'Class', 'Total Days', 'On Time', 'Late', 'Present', 'Absent', 'On Time %', 'Late %', 'Present %', 'Absent %']]
    for student in students:
        summary = flask_app.get_attendance_summary(student, students)
        data.append([str(student['id']), student['name'], str(student['grade']), student['className'], str(summary['totalSchoolDays']), str(summary['onTimeDays']), str(summary['lateDays']), str(summary['presentDays']), str(summary['absentDays']), f"{summary['onTimePercentage']}%", f"{summary['latePercentage']}%", f"{summary['presencePercentage']}%", f"{summary['absencePercentage']}%"])
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
    elements = []
    styles = getSampleStyleSheet()
    elements.append(Paragraph(student['name'], styles['Title']))
    elements.append(Paragraph(f"ID: {student['id']} | Grade: {student['grade']} | Class: {student['className']}", styles['Normal']))
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
        from database import DatabaseContext
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
        from database import DatabaseContext
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
        from database import get_db_connection
        conn_logs = get_db_connection('logs')
        cursor_logs = conn_logs.cursor()
        cursor_logs.execute('DELETE FROM auth_logs')
        cursor_logs.execute('INSERT INTO auth_logs (timestamp, message) VALUES (?, ?)', (datetime.now().isoformat(), f'[{role}] Cleared all auth logs.'))
        conn_logs.commit()
        conn_logs.close()
        return JSONResponse({'success': True})
    except Exception as e:
        return JSONResponse({'success': False, 'error': str(e)}, status_code=500)


@fastapi_app.get("/api/students/{student_id}/attendance")
async def api_get_student_attendance(student_id: int, month: Optional[str] = Query(None)):
    try:
        student = flask_app.get_student_by_id(student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        hist = student.get('attendanceHistory', [])
        if month:
            hist = [r for r in hist if isinstance(r.get('date'), str) and r.get('date').startswith(month)]
        return JSONResponse({"success": True, "attendanceHistory": hist})
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
app = CombinedApp(fastapi_app, flask_app.asgi_app)
