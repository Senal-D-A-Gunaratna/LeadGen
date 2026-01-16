"""
Flask backend application with WebSocket support.
Handles all API endpoints and real-time updates via WebSocket.
"""
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect
import sqlite3
import json
from datetime import datetime, date
from pathlib import Path
import os
from typing import Dict, List, Optional
from database import get_db_connection, init_database, migrate_json_to_sqlite, DatabaseContext
import csv
import io
import base64
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
CORS(app, resources={r"/*": {"origins": "*"}})
# Use threading mode instead of eventlet (eventlet incompatible with Python 3.14)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Password file path
PASSWORDS_JSON_PATH = Path(__file__).parent.parent / 'backend' / 'data' / 'passwords.json'

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
authenticated_sessions = {}

# Broadcast data changes to all connected clients
def broadcast_data_change(event_type: str, data: dict = None):
    """Broadcast data changes to all authenticated WebSocket clients."""
    socketio.emit('data_changed', {
        'type': event_type,
        'data': data or {}
    }, namespace='/')

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
    cursor_attendance.execute('''
        SELECT date, status FROM attendance_records
        WHERE student_id = ?
        ORDER BY date DESC
    ''', (student_id,))
    
    history = [{'date': r['date'], 'status': r['status']} for r in cursor_attendance.fetchall()]
    conn_attendance.close()
    
    # Get today's status
    today = date.today().isoformat()
    today_record = next((h for h in history if h['date'] == today), None)
    
    student['fingerprints'] = fingerprints
    student['contact'] = {
        'email': student['email'],
        'phone': student['phone']
    }
    student['attendanceHistory'] = history
    student['status'] = today_record['status'] if today_record else 'absent'
    student['hasScannedToday'] = today_record is not None and today_record['status'] != 'absent'
    
    # Remove SQLite-specific fields
    for key in ['fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4', 'email', 'phone']:
        student.pop(key, None)
    
    conn_students.close()
    return student

def get_all_students_with_history(target_date: Optional[str] = None) -> List[Dict]:
    """Get all students with their attendance history for a specific date."""
    if not target_date:
        target_date = date.today().isoformat()
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    cursor_students.execute('SELECT * FROM students ORDER BY name')
    students_data = cursor_students.fetchall()
    
    # Get all attendance records in one query for efficiency
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    cursor_attendance.execute('''
        SELECT student_id, date, status FROM attendance_records
        ORDER BY student_id, date DESC
    ''')
    attendance_records = cursor_attendance.fetchall()
    conn_attendance.close()
    
    # Group attendance by student_id
    attendance_by_student = {}
    for record in attendance_records:
        student_id = record['student_id']
        if student_id not in attendance_by_student:
            attendance_by_student[student_id] = []
        attendance_by_student[student_id].append({
            'date': record['date'],
            'status': record['status']
        })
    
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
        
        # Get attendance history for this student
        history = attendance_by_student.get(student_id, [])
        
        # Get status for target date
        date_record = next((h for h in history if h['date'] == target_date), None)
        
        student['fingerprints'] = fingerprints_by_student.get(student_id, [''] * 4)
        student['contact'] = {
            'email': student['email'],
            'phone': student['phone']
        }
        student['attendanceHistory'] = history
        student['status'] = date_record['status'] if date_record else 'absent'
        student['hasScannedToday'] = date_record is not None and date_record['status'] != 'absent'
        
        # Remove SQLite-specific fields
        for key in ['fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4', 'email', 'phone', 'created_at', 'updated_at']:
            student.pop(key, None)
        
        students.append(student)
    
    conn_students.close()
    return students

def get_attendance_summary(student: Dict, all_students: List[Dict]) -> Dict:
    """Calculate attendance summary for a student."""
    from datetime import datetime as dt
    from calendar import day_name
    
    # Get all unique school days (weekdays where at least one student has a record)
    school_days = set()
    for s in all_students:
        for record in s.get('attendanceHistory', []):
            try:
                record_date = dt.fromisoformat(record['date'] + 'T00:00:00')
                day_of_week = record_date.weekday()
                if 0 < day_of_week < 6:  # Monday to Friday
                    school_days.add(record['date'])
            except:
                pass
    
    total_school_days = len(school_days)
    
    if total_school_days == 0:
        return {
            'totalSchoolDays': 0,
            'presentDays': 0,
            'absentDays': 0,
            'onTimeDays': 0,
            'lateDays': 0,
            'presencePercentage': 0,
            'absencePercentage': 0,
            'onTimePercentage': 0,
            'latePercentage': 0
        }
    
    # Filter student records to school days only
    student_records = [r for r in student.get('attendanceHistory', []) if r['date'] in school_days]
    
    on_time_days = len([r for r in student_records if r['status'] == 'on time'])
    late_days = len([r for r in student_records if r['status'] == 'late'])
    present_days = on_time_days + late_days
    absent_days = total_school_days - present_days
    
    presence_percentage = round((present_days / total_school_days) * 100) if total_school_days > 0 else 0
    absence_percentage = 100 - presence_percentage
    on_time_percentage = round((on_time_days / present_days) * 100) if present_days > 0 else 0
    late_percentage = round((late_days / present_days) * 100) if present_days > 0 else 0
    
    return {
        'totalSchoolDays': total_school_days,
        'presentDays': present_days,
        'absentDays': absent_days,
        'onTimeDays': on_time_days,
        'lateDays': late_days,
        'presencePercentage': presence_percentage,
        'absencePercentage': absence_percentage,
        'onTimePercentage': on_time_percentage,
        'latePercentage': late_percentage
    }

# ==================== WEBSOCKET HANDLERS ====================

@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection."""
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection."""
    if request.sid in authenticated_sessions:
        del authenticated_sessions[request.sid]
    print(f'Client disconnected: {request.sid}')

@socketio.on('authenticate')
def handle_authentication(data):
    """Handle authentication via WebSocket."""
    role = data.get('role')
    password = data.get('password')
    
    if not role or not password:
        emit('auth_response', {'success': False, 'message': 'Missing role or password'})
        return
    
    if validate_password(role, password):
        authenticated_sessions[request.sid] = role
        emit('auth_response', {'success': True, 'role': role, 'message': 'Authentication successful'})
        
        # Log authentication
        conn_logs = get_db_connection('logs')
        cursor_logs = conn_logs.cursor()
        cursor_logs.execute('''
            INSERT INTO auth_logs (timestamp, message)
            VALUES (?, ?)
        ''', (datetime.now().isoformat(), f'User signed in as: {role}'))
        conn_logs.commit()
        conn_logs.close()
    else:
        emit('auth_response', {'success': False, 'message': 'Invalid credentials'})

@socketio.on('scan_student')
def handle_scan(data):
    """Handle student scan via WebSocket."""
    if request.sid not in authenticated_sessions:
        emit('scan_response', {'success': False, 'message': 'Not authenticated'})
        return
    
    fingerprint = data.get('fingerprint')
    if not fingerprint:
        emit('scan_response', {'success': False, 'message': 'Missing fingerprint'})
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
        emit('scan_response', {'success': False, 'message': 'Student not found'})
        return
    
    student = dict(row)
    student_id = student['id']
    today = date.today().isoformat()
    conn_students.close()
    
    # Check if already scanned today (in attendance database)
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    cursor_attendance.execute('''
        SELECT status FROM attendance_records
        WHERE student_id = ? AND date = ?
    ''', (student_id, today))
    
    existing = cursor_attendance.fetchone()
    if existing and existing['status'] != 'absent':
        # Already scanned, just update last scan time
        conn_attendance.close()
        student_data = get_student_by_id(student_id)
        emit('scan_response', {'success': True, 'student': student_data, 'alreadyScanned': True})
        broadcast_data_change('scan', {'studentId': student_id})
        return
    
    # Determine status based on time
    now = datetime.now()
    on_time_cutoff = datetime(now.year, now.month, now.day, 7, 20, 0)
    status = 'on time' if now < on_time_cutoff else 'late'
    
    # Update or insert attendance record
    cursor_attendance.execute('''
        INSERT OR REPLACE INTO attendance_records (student_id, date, status, updated_at)
        VALUES (?, ?, ?, ?)
    ''', (student_id, today, status, datetime.now().isoformat()))
    
    conn_attendance.commit()
    conn_attendance.close()
    
    student_data = get_student_by_id(student_id)
    emit('scan_response', {'success': True, 'student': student_data})
    broadcast_data_change('scan', {'studentId': student_id})

# ==================== REST API ENDPOINTS ====================

@app.route('/api/get-filtered-students', methods=['POST'])
def get_filtered_students():
    """Get filtered students matching criteria."""
    filters = request.json or {}
    target_date = filters.get('date') or date.today().isoformat()
    
    all_students = get_all_students_with_history(target_date)
    
    # Apply filters
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
        filtered = [s for s in filtered if 
                   query in s['name'].lower() or 
                   query in s['contact']['phone'].lower()]
    
    # Sort by name
    filtered.sort(key=lambda x: x['name'])
    
    return jsonify(filtered)

@app.route('/api/get-student-by-id/<int:student_id>', methods=['GET'])
def get_student_by_id_endpoint(student_id):
    """Get a single student by ID."""
    student = get_student_by_id(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404
    return jsonify(student)

@app.route('/api/save-attendance', methods=['POST'])
def save_attendance():
    """Save attendance records for students."""
    students = request.json or []
    
    conn_attendance = get_db_connection('attendance')
    cursor_attendance = conn_attendance.cursor()
    
    for student in students:
        student_id = student['id']
        for record in student.get('attendanceHistory', []):
            cursor_attendance.execute('''
                INSERT OR REPLACE INTO attendance_records (student_id, date, status, updated_at)
                VALUES (?, ?, ?, ?)
            ''', (student_id, record['date'], record['status'], datetime.now().isoformat()))
    
    conn_attendance.commit()
    conn_attendance.close()
    
    broadcast_data_change('attendance_updated')
    return jsonify({'success': True})

@app.route('/api/add-student', methods=['POST'])
def add_student():
    """Add a new student."""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    # Get next ID
    cursor_students.execute('SELECT MAX(id) FROM students')
    max_id = cursor_students.fetchone()[0] or 0
    next_id = max_id + 1
    
    fingerprints = data.get('fingerprints', ['', '', '', ''])
    
    cursor_students.execute('''
        INSERT INTO students (id, name, grade, className, role, email, phone,
                            fingerprint1, fingerprint2, fingerprint3, fingerprint4,
                            specialRoles, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        next_id,
        data['name'],
        data['grade'],
        data['className'],
        data.get('role'),
        data['contact']['email'],
        data['contact']['phone'],
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
    return jsonify(student)

@app.route('/api/remove-student/<int:student_id>', methods=['DELETE'])
def remove_student(student_id):
    """Remove a student."""
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
    return jsonify({'success': True})

@app.route('/api/update-student/<int:student_id>', methods=['PUT'])
def update_student(student_id):
    """Update a student's information."""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    conn_students = get_db_connection('students')
    cursor_students = conn_students.cursor()
    
    # Get existing student
    cursor_students.execute('SELECT * FROM students WHERE id = ?', (student_id,))
    existing = cursor_students.fetchone()
    if not existing:
        conn_students.close()
        return jsonify({'error': 'Student not found'}), 404
    
    existing_dict = dict(existing)
    
    # Update fields
    name = data.get('name', existing_dict['name'])
    grade = data.get('grade', existing_dict['grade'])
    className = data.get('className', existing_dict['className'])
    role = data.get('role', existing_dict['role'])
    email = data.get('contact', {}).get('email', existing_dict['email'])
    phone = data.get('contact', {}).get('phone', existing_dict['phone'])
    specialRoles = data.get('specialRoles', existing_dict.get('specialRoles', ''))
    notes = data.get('notes', existing_dict.get('notes', ''))
    
    fingerprints = data.get('fingerprints')
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
    if 'role' in data and data['role'] is None:
        role = None
    
    cursor_students.execute('''
        UPDATE students
        SET name = ?, grade = ?, className = ?, role = ?, email = ?, phone = ?,
            fingerprint1 = ?, fingerprint2 = ?, fingerprint3 = ?, fingerprint4 = ?,
            specialRoles = ?, notes = ?, updated_at = ?
        WHERE id = ?
    ''', (
        name, grade, className, role, email, phone,
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
    return jsonify(student)

@app.route('/api/validate-password', methods=['POST'])
def validate_password_endpoint():
    """Validate a password for a role."""
    data = request.json
    role = data.get('role')
    password = data.get('password')
    
    if not role or not password:
        return jsonify({'valid': False})
    
    try:
        valid = validate_password(role, password)
        return jsonify({'valid': valid})
    except Exception as e:
        print(f"Error validating password: {e}")
        return jsonify({'valid': False})

@app.route('/api/update-passwords', methods=['POST'])
def update_passwords():
    """Update passwords for roles."""
    data = request.json
    passwords_to_update = data.get('passwords', {})
    authorizer_role = data.get('authorizerRole')
    authorizer_password = data.get('authorizerPassword')
    
    # Validate authorizer
    if not validate_password(authorizer_role, authorizer_password):
        return jsonify({'error': 'Unauthorized'}), 401
    
    # Update passwords
    current_passwords = get_passwords()
    for role, new_password in passwords_to_update.items():
        if role in ['admin', 'moderator', 'dev']:
            current_passwords[role] = new_password
    
    save_passwords(current_passwords)
    
    broadcast_data_change('passwords_updated')
    return jsonify({'success': True})

@app.route('/api/get-current-time', methods=['GET'])
def get_current_time():
    """Get current server time."""
    return jsonify({'time': datetime.now().isoformat()})

# Import additional endpoints
from api_endpoints import register_endpoints

# Register all additional endpoints with helper functions
register_endpoints(app, socketio, {
    'get_all_students_with_history': get_all_students_with_history,
    'get_student_by_id': get_student_by_id,
    'get_attendance_summary': get_attendance_summary,
    'broadcast_data_change': broadcast_data_change
})

if __name__ == '__main__':
    init_database()
    migrate_json_to_sqlite()
    print("Flask backend starting on http://0.0.0.0:5000")
    print("WebSocket support enabled (using threading mode)")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)

