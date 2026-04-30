import sqlite3
from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Use the specified backup and the actual server database path
BACKUP_FILE = REPO_ROOT / 'servers' / 'backend' / 'backups' / 'students' / 'students-backup-2026-02-24T21-10-12.db'
TARGET_DB = REPO_ROOT / 'servers' / 'backend' / 'database' / 'students.db'

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

        # If backup is empty, look for an alternative backup file named 'students.db' in the same folder
        if len(rows) == 0:
            alt = BACKUP_FILE.with_name('students.db')
            if alt.exists() and alt != BACKUP_FILE:
                print('Primary backup is empty — switching to alternative backup:', alt)
                try:
                    src.close()
                except:
                    pass
                src = sqlite3.connect(str(alt))
                src.row_factory = sqlite3.Row
                src_cur = src.cursor()
                try:
                    src_cur.execute('SELECT * FROM students')
                    rows = src_cur.fetchall()
                except Exception as e:
                    print('No students table in alternative backup or read error:', e)
                    rows = []
                print(f'Found {len(rows)} students in alternative backup')

        # Ensure target has columns we expect
        dst_cur.execute("PRAGMA table_info(students)")
        table_info = dst_cur.fetchall()
        dst_cols = [r[1] for r in table_info]
        # map column types for basic coercion
        col_types = {r[1]: (r[2] or '').upper() for r in table_info}

        target_columns = [
            'student_id', 'name', 'grade', 'className', 'role', 'phone', 'whatsapp_no', 'email',
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
        def row_get(row, key):
            return row[key] if key in row.keys() else None

        for r in rows:
            # Map values from backup row by name, with simple type coercion
            vals = []
            for col in insert_cols:
                if col in r.keys():
                    val = r[col]
                else:
                    val = None

                # coerce based on destination column type
                ctype = col_types.get(col, '')
                if val is None or (isinstance(val, str) and val == ''):
                    coerced = None
                elif 'INT' in ctype:
                    try:
                        coerced = int(val)
                    except Exception:
                        coerced = None
                elif 'REAL' in ctype or 'FLOA' in ctype or 'DOUB' in ctype:
                    try:
                        coerced = float(val)
                    except Exception:
                        coerced = None
                else:
                    # keep as-is (text/blob)
                    coerced = val

                vals.append(coerced)

            try:
                dst_cur.execute(insert_sql, vals)
                inserted += 1
            except Exception as e:
                ident = row_get(r, 'student_id') or row_get(r, 'id') or '<unknown>'
                print('Failed to insert row id', ident, 'error:', repr(e))

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
