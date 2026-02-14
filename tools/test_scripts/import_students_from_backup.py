import sqlite3
from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKUP_FILE = REPO_ROOT / 'backend' / 'backups' / 'students' / 'students-backup-2026-01-04T23-26-56.db'
TARGET_DB = REPO_ROOT / 'backend' / 'data' / 'students.db'

def main():
    if not BACKUP_FILE.exists():
        print('Backup file not found:', BACKUP_FILE)
        sys.exit(1)
    if not TARGET_DB.exists():
        print('Target DB not found:', TARGET_DB)
        sys.exit(1)

    # Make a safety copy of the target DB
    shutil.copy2(TARGET_DB, TARGET_DB.with_suffix('.db.bak'))
    print('Created backup:', TARGET_DB.with_suffix('.db.bak'))

    src = sqlite3.connect(str(BACKUP_FILE))
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(str(TARGET_DB))
    dst.row_factory = sqlite3.Row

    try:
        src_cur = src.cursor()
        dst_cur = dst.cursor()

        # Read rows from source students table if present
        try:
            src_cur.execute('SELECT * FROM students')
            rows = src_cur.fetchall()
        except Exception as e:
            print('No students table in backup or read error:', e)
            rows = []

        print(f'Found {len(rows)} students in backup')

        # Ensure target has columns we expect
        dst_cur.execute("PRAGMA table_info(students)")
        dst_cols = [r[1] for r in dst_cur.fetchall()]

        target_columns = [
            'id', 'name', 'grade', 'className', 'role', 'phone', 'whatsapp_no', 'email',
            'specialRoles', 'notes',
            'fingerprint1', 'fingerprint2', 'fingerprint3', 'fingerprint4',
            'created_at', 'updated_at'
        ]
        insert_cols = [c for c in target_columns if c in dst_cols]

        if not insert_cols:
            print('No matching target columns found; aborting')
            return

        placeholders = ','.join(['?'] * len(insert_cols))
        insert_sql = f"INSERT OR REPLACE INTO students ({', '.join(insert_cols)}) VALUES ({placeholders})"

        inserted = 0
        for r in rows:
            # Map values from backup row by name, providing defaults
            vals = []
            for col in insert_cols:
                if col in r.keys():
                    vals.append(r[col])
                else:
                    # default values
                    if col in ('id', 'grade'):
                        vals.append(0)
                    else:
                        vals.append('')
            try:
                dst_cur.execute(insert_sql, vals)
                inserted += 1
            except Exception as e:
                print('Failed to insert row id', r.get('id'), 'error:', e)

        dst.commit()
        print('Inserted/updated', inserted, 'rows into', TARGET_DB)

    finally:
        try:
            src.close()
        except:
            pass
        try:
            dst.close()
        except:
            pass

if __name__ == '__main__':
    main()
