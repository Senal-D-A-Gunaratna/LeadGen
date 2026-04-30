#!/usr/bin/env python3
"""
Database integrity check and cleanup script.
Checks for corruption, misplaced tables, and data consistency.
"""
import sqlite3
from pathlib import Path
from .database import STUDENTS_DB_PATH, ATTENDANCE_DB_PATH, LOGS_DB_PATH

def check_database_integrity(db_path: Path, db_name: str):
    """Check database integrity and return issues."""
    issues = []
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        
        # Check integrity
        cursor.execute('PRAGMA integrity_check')
        result = cursor.fetchone()
        if result[0] != 'ok':
            issues.append(f"❌ {db_name}: Database integrity check failed: {result[0]}")
        else:
            print(f"✅ {db_name}: Database integrity OK")
        
        # Check tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = [row[0] for row in cursor.fetchall()]
        
        # Expected tables for each database
        expected_tables = {
            'students.db': ['students', 'backups', 'student_fingerprints_id',
                            'student_backup_sets', 'student_backup_items'],
            'attendance.db': ['attendance_records', 'backups',
                              'attendance_backup_sets', 'attendance_backup_items'],
            'logs.db': ['action_logs', 'auth_logs']
        }
        
        expected = set(expected_tables.get(db_name, []))
        actual = set(tables)
        
        # Check for unexpected tables
        unexpected = actual - expected
        if unexpected:
            issues.append(f"⚠️  {db_name}: Unexpected tables found: {unexpected}")
        
        # Check for missing tables
        missing = expected - actual
        if missing:
            issues.append(f"⚠️  {db_name}: Missing expected tables: {missing}")
        
        # Check for passwords table (shouldn't exist)
        if 'passwords' in tables:
            issues.append(f"❌ {db_name}: 'passwords' table found (should not exist - using JSON only)")
        
        # Count records
        for table in tables:
            try:
                cursor.execute(f'SELECT COUNT(*) FROM {table}')
                count = cursor.fetchone()[0]
                print(f"   - {table}: {count} records")
            except:
                pass
        
        conn.close()
        return issues
        
    except Exception as e:
        return [f"❌ {db_name}: Error checking database: {e}"]

def main():
    print("=" * 60)
    print("DATABASE INTEGRITY CHECK")
    print("=" * 60)
    print()
    
    all_issues = []
    
    # Check each database
    all_issues.extend(check_database_integrity(STUDENTS_DB_PATH, 'students.db'))
    print()
    all_issues.extend(check_database_integrity(ATTENDANCE_DB_PATH, 'attendance.db'))
    print()
    all_issues.extend(check_database_integrity(LOGS_DB_PATH, 'logs.db'))
    print()
    
    # Check passwords.json
    passwords_path = Path(__file__).resolve().parents[1] / 'database' / 'passwords.json'
    if passwords_path.exists():
        print(f"✅ passwords.json: File exists")
        try:
            import json
            with open(passwords_path, 'r') as f:
                passwords = json.load(f)
                print(f"   - Roles: {', '.join(passwords.keys())}")
        except Exception as e:
            all_issues.append(f"❌ passwords.json: Error reading file: {e}")
    else:
        all_issues.append(f"⚠️  passwords.json: File not found (will be created on first use)")
    
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if all_issues:
        print(f"\n❌ Found {len(all_issues)} issue(s):\n")
        for issue in all_issues:
            print(f"  {issue}")
        print("\n⚠️  Action required: Run cleanup script to fix issues")
    else:
        print("\n✅ No issues found! All databases are healthy.")
    
    return len(all_issues)

if __name__ == '__main__':
    exit(main())

