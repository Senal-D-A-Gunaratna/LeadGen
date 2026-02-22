from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the existing ASGI app (Socket.IO + Flask wrapped earlier).
# Prefer the fully-qualified package import so static checkers (mypy)
# can resolve the module; fall back to relative import for different
# run contexts.
try:
    from servers.backend import app as flask_app_module
except Exception:
    from . import app as flask_app_module


app = FastAPI(title="LeadGen Backend (FastAPI wrapper)")

# Allow the frontend to connect during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Mount the existing ASGI application (Socket.IO + Flask) at root.
# This preserves all existing HTTP endpoints and WebSocket behavior while
# allowing the process to be started via `uvicorn backend.fastapi_app:app`.
app.mount("/", flask_app_module.asgi_app)



@app.get("/api/attendance/trend")
async def attendance_trend(month: str | None = None,
                           start: str | None = None,
                           end: str | None = None,
                           grade: str = 'all',
                           classFilter: str | None = None,
                           roleFilter: str | None = None,
                           status: str = 'all'):
    """Compute per-day attendance points for the requested range.

    Query params:
      - month: YYYY-MM (preferred)
      - start, end: ISO dates
      - grade: grade number or 'all'
      - classFilter: class name or 'all'
      - roleFilter: role name or 'all' or 'none'
      - status: optional status scope (on_time/late/absent/all)

    This reuses the server-side student history helpers and returns
    a JSON payload { success: True, points: [{date, present, percent}, ...] }
    """
    from datetime import date, timedelta
    try:
        # Determine date range from month or start/end
        if month:
            try:
                sd = date.fromisoformat(f"{month}-01")
            except Exception:
                return {"success": False, "message": "Invalid month format (expected YYYY-MM)"}
            start_date = sd
            if sd.month == 12:
                next_mon = date(sd.year + 1, 1, 1)
            else:
                next_mon = date(sd.year, sd.month + 1, 1)
            end_date = next_mon - timedelta(days=1)
        else:
            start_date = date.fromisoformat(start) if start else None
            end_date = date.fromisoformat(end) if end else None
    except Exception:
        return {"success": False, "message": "Invalid date(s) provided"}

    # If not provided, derive sensible defaults (last ~30 days)
    if start_date is None or end_date is None:
        # Try to infer from attendance DB range
        try:
            cur = flask_app_module.get_db_connection('attendance').cursor()
            cur.execute('SELECT MIN(date) as min_date, MAX(date) as max_date FROM attendance_records')
            row = cur.fetchone()
            if row and row.get('min_date') and row.get('max_date'):
                if start_date is None:
                    start_date = date.fromisoformat(row['min_date'])
                if end_date is None:
                    end_date = date.fromisoformat(row['max_date'])
            else:
                end_date = date.today()
                start_date = end_date - timedelta(days=29)
        except Exception:
            end_date = date.today()
            start_date = end_date - timedelta(days=29)

    if start_date > end_date:
        start_date, end_date = end_date, start_date

    # Ensure school_days are available; fall back to weekdays
    try:
        cur_sd = flask_app_module.get_db_connection('attendance').cursor()
        cur_sd.execute('SELECT date FROM school_days WHERE date BETWEEN ? AND ? ORDER BY date ASC', (start_date.isoformat(), end_date.isoformat()))
        sd_rows = cur_sd.fetchall()
        school_dates = [r['date'] for r in sd_rows]
    except Exception:
        school_dates = []
        d = start_date
        while d <= end_date:
            if d.weekday() < 5:
                school_dates.append(d.isoformat())
            d = d + timedelta(days=1)

    # Load all students and apply filters using existing helper
    try:
        all_students = flask_app_module.get_all_students_with_history()
    except Exception:
        all_students = []

    def student_matches(s: dict) -> bool:
        if grade and grade != 'all':
            try:
                if int(s.get('grade') or -999) != int(grade):
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

    # Build points
    points = []
    for iso in school_dates:
        present_count = 0
        for s in filtered_students:
            found = next((r for r in s.get('attendanceHistory', []) if r.get('date') == iso), None)
            if found and found.get('status') != 'absent':
                present_count += 1
        percent = round((present_count / student_count) * 100, 1) if student_count > 0 else 0
        points.append({ 'date': iso, 'present': present_count, 'percent': percent })

    return { 'success': True, 'points': points }


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
