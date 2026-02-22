from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the existing ASGI app (Socket.IO + Flask wrapped earlier).
# Prefer the fully-qualified package import so static checkers (mypy)
# can resolve the module; fall back to relative import for different
# run contexts.
app.mount("/", flask_app_module.asgi_app)
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
