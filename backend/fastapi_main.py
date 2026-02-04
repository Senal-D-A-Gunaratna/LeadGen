from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import traceback
import sqlite3
import time
from datetime import datetime

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
        return JSONResponse({"success": True, "student": student})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


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
