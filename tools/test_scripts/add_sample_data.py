#!/usr/bin/env python3
"""
Script to add sample student data to the database.
Run this from the project root: python add_sample_data.py
"""

import sys
from pathlib import Path
import sqlite3
from datetime import datetime, date, timedelta

# Add the servers directory to path so we can import the backend modules
repo_root = Path(__file__).resolve().parent
sys.path.insert(0, str(repo_root / 'servers' / 'backend' / 'src'))

from database import get_db_connection, init_database

# Sample students data
SAMPLE_STUDENTS = [
    ('Alice Johnson', 10, 'A', 'prefect', 'alice@school.com', '1234567890', '1234567890'),
    ('Bob Smith', 10, 'B', None, 'bob@school.com', '0987654321', '0987654321'),
    ('Charlie Brown', 11, 'A', None, 'charlie@school.com', '1111111111', '1111111111'),
    ('Diana Prince', 11, 'C', 'class-rep', 'diana@school.com', '2222222222', '2222222222'),
    ('Ethan Hunt', 9, 'A', None, 'ethan@school.com', '3333333333', '3333333333'),
    ('Fiona Apple', 9, 'B', None, 'fiona@school.com', '4444444444', '4444444444'),
    ('George Miller', 12, 'A', 'head-boy', 'george@school.com', '5555555555', '5555555555'),
    ('Hannah Montana', 12, 'B', None, 'hannah@school.com', '6666666666', '6666666666'),
    ('Ian McKellen', 10, 'C', None, 'ian@school.com', '7777777777', '7777777777'),
    ('Julia Roberts', 11, 'A', None, 'julia@school.com', '8888888888', '8888888888'),
]

def add_sample_students():
    """Add sample student data to the database"""
    try:
        conn = get_db_connection('students')
        cursor = conn.cursor()
        
        # Clear existing data
        cursor.execute('DELETE FROM students')
        cursor.execute('DELETE FROM sqlite_sequence')
        
        # Insert sample students
        for i, (name, grade, classname, role, email, phone, whatsapp) in enumerate(SAMPLE_STUDENTS, start=1):
            cursor.execute('''
                INSERT INTO students 
                (student_id, name, grade, className, role, email, phone, whatsapp_no, 
                 fingerprint1, fingerprint2, fingerprint3, fingerprint4, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                i,
                name,
                grade,
                classname,
                role,
                email,
                phone,
                whatsapp,
                f'fp1_{i}',
                f'fp2_{i}',
                f'fp3_{i}',
                f'fp4_{i}',
                datetime.utcnow().isoformat() + 'Z',
                datetime.utcnow().isoformat() + 'Z'
            ))
        
        conn.commit()
        print(f'✓ Added {len(SAMPLE_STUDENTS)} sample students')
        
        # Add some sample attendance records for today
        conn_attendance = get_db_connection('attendance')
        cursor_attendance = conn_attendance.cursor()
        
        today = date.today().isoformat()
        is_weekend = date.today().weekday() >= 5
        
        if not is_weekend:
            # Add attendance records for a few students
            for i in range(1, min(6, len(SAMPLE_STUDENTS) + 1)):
                status = 'on time' if i % 2 == 0 else 'late'
                cursor_attendance.execute('''
                    INSERT OR REPLACE INTO attendance_records 
                    (student_id, date, status, check_in_time)
                    VALUES (?, ?, ?, ?)
                ''', (i, today, status, datetime.now().isoformat() + 'Z'))
            
            conn_attendance.commit()
            print(f'✓ Added sample attendance records for {today}')
        
        conn.close()
        conn_attendance.close()
        
        return True
        
    except Exception as e:
        print(f'✗ Error adding sample data: {e}')
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    print('Adding sample student data to the database...')
    if add_sample_students():
        print('\n✓ Database populated successfully!')
        print('  - Reload the frontend to see the students')
        sys.exit(0)
    else:
        print('\n✗ Failed to populate database')
        sys.exit(1)
