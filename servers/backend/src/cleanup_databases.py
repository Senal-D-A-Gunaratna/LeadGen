#!/usr/bin/env python3
"""
Database cleanup script to remove misplaced tables and fix database structure.
WARNING: This script will remove tables that shouldn't exist in each database.
"""
import sqlite3
from pathlib import Path
from .database import STUDENTS_DB_PATH, ATTENDANCE_DB_PATH, LOGS_DB_PATH

def cleanup_database(db_path: Path, db_name: str, keep_tables: list, remove_tables: list):
    """Remove unwanted tables from a database."""
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        all_tables = [row[0] for row in cursor.fetchall()]
        
        removed = []
        for table in all_tables:
            if table in remove_tables:
                print(f"   Removing table '{table}' from {db_name}...")
                cursor.execute(f'DROP TABLE IF EXISTS {table}')
                removed.append(table)
        
        conn.commit()
        conn.close()
        
        if removed:
            print(f"✅ {db_name}: Removed {len(removed)} table(s): {', '.join(removed)}")
        else:
            print(f"✅ {db_name}: No tables to remove")
        
        return removed
        
    except Exception as e:
        print(f"❌ {db_name}: Error during cleanup: {e}")
        return []

def main():
    print("=" * 60)
    print("DATABASE CLEANUP")
    print("=" * 60)
    print()
    print("This script will remove tables that shouldn't exist in each database.")
    print()
    
    # Cleanup students.db - should only have: students, backups, student_fingerprints_id,
    # student_backup_sets, student_backup_items
    print("Cleaning students.db...")
    cleanup_database(
        STUDENTS_DB_PATH, 
        'students.db',
        keep_tables=['students', 'backups', 'student_fingerprints_id',
                     'student_backup_sets', 'student_backup_items'],
        remove_tables=['attendance_records', 'passwords', 'action_logs', 'auth_logs', 'student_fingerprints']
    )
    print()
    
    # Cleanup attendance.db - should only have: attendance_records, backups,
    # attendance_backup_sets, attendance_backup_items
    print("Cleaning attendance.db...")
    cleanup_database(
        ATTENDANCE_DB_PATH,
        'attendance.db',
        keep_tables=['attendance_records', 'backups',
                     'attendance_backup_sets', 'attendance_backup_items'],
        remove_tables=['students', 'passwords', 'action_logs', 'auth_logs']
    )
    print()
    
    # Cleanup logs.db - should only have: action_logs, auth_logs
    print("Cleaning logs.db...")
    cleanup_database(
        LOGS_DB_PATH,
        'logs.db',
        keep_tables=['action_logs', 'auth_logs'],
        remove_tables=['students', 'attendance_records', 'passwords', 'backups']
    )
    print()
    
    print("=" * 60)
    print("CLEANUP COMPLETE")
    print("=" * 60)
    print("\n✅ Database cleanup finished!")
    print("\nRun 'python check_integrity.py' to verify the cleanup.")

if __name__ == '__main__':
    main()

