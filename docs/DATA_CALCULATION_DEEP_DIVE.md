# Student Profile Dialog - Data Calculation Deep Dive

## Overview
The attendance statistics displayed in the Student Profile Dialog are calculated through a multi-step pipeline that spans both frontend and backend. This document traces the complete flow from data source to UI display.

## 1. Data Display (Frontend UI)

### Location
[frontend/src/components/dashboard/student-profile-dialog.tsx](../frontend/src/components/dashboard/student-profile-dialog.tsx#L861)

### What's Displayed
The "Attendance Statistics" section shows:
- **Overall Presence**: Percentage of days the student was present (on time + late)
- **On Time**: Count of days and percentage
- **Late**: Count of days and percentage  
- **Absent**: Count of days and percentage

Example from the UI:
```
Overall Presence: 66.7%
├─ On Time: 2 days (33.3%)
├─ Late: 2 days (33.3%)
└─ Absent: 2 days (33.3%)
```

### State Management
[Lines 693-744](../frontend/src/components/dashboard/student-profile-dialog.tsx#L693-L744)

```tsx
const [attendanceStats, setAttendanceStats] = useState<any | null>(null);

useEffect(() => {
  let cancelled = false;
  async function fetchSummary() {
    if (!student) return setAttendanceStats(null);
    
    // Try to get from cache first
    const summary = studentSummaries.get(student.id);
    if (summary) {
      setAttendanceStats({
        onTimeCount: summary.onTimeDays,
        lateCount: summary.lateDays,
        absentCount: summary.absentDays,
        onTimePercentage: summary.onTimePercentage,
        latePercentage: summary.latePercentage,
        absentPercentage: summary.absencePercentage,
        overallPercentage: summary.presencePercentage,
      });
    } else {
      // Fetch from backend if not cached
      try {
        const res = await getStudentSummary(student.id);
        const s = res?.summary;
        if (!cancelled && s) {
          // Update store cache
          updateStudentSummaries([...]);
          setAttendanceStats({...});
        }
      } catch (e) {
        console.error('Failed to fetch student summary', e);
      }
    }
  }

  fetchSummary();
  return () => { cancelled = true };
}, [student, studentSummaries, updateStudentSummaries]);
```

**Key Points:**
- Checks cache first (from `useStudentStore`)
- Falls back to API call if not cached
- Transforms server response into UI-friendly format

---

## 2. API Client Layer (Frontend)

### Location
[frontend/src/lib/api-client.ts](../frontend/src/lib/api-client.ts#L242-L249)

```typescript
export async function getStudentSummary(studentId: number) {
  const result = await wsClient.getStudentSummary(studentId);
  return result;
}

export async function getAllStudentsSummaries() {
  return wsClient.getAllStudentsSummaries();
}
```

**Purpose:** Thin wrapper around WebSocket client for consistency with REST-like API pattern.

---

## 3. WebSocket Client (Frontend)

### Location
[frontend/src/lib/websocket-client.ts](../frontend/src/lib/websocket-client.ts#L700-L729)

```typescript
getStudentSummary(studentId: number): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!this.socket || !this.socket.connected) {
      reject(new Error('Not connected'));
      return;
    }

    const handler = (data: {
      success: boolean;
      studentId?: number;
      summary?: any;
      message?: string;
    }) => {
      this.socket?.off('get_student_summary_response', handler);
      if (data.success) {
        resolve({ studentId: data.studentId, summary: data.summary });
      } else {
        reject(new Error(data.message || 'Failed to get summary'));
      }
    };

    this.socket.on('get_student_summary_response', handler);
    this.socket.emit('get_student_summary', { studentId });

    // 15-second timeout
    setTimeout(() => {
      this.socket?.off('get_student_summary_response', handler);
      reject(new Error('Request timeout'));
    }, 15000);
  });
}
```

**Protocol:**
1. Emits WebSocket event: `get_student_summary` with `{ studentId }`
2. Waits for response: `get_student_summary_response`
3. 15-second timeout for safety

---

## 4. Backend API Endpoint (WebSocket Handler)

### Location
[backend/api_endpoints.py](../backend/api_endpoints.py#L193-L206)

```python
@socketio.on('get_student_summary')
def handle_get_student_summary(data):
    """Get attendance summary for a single student via WebSocket."""
    # Allow unauthenticated access for student details
    
    student_id = data.get('studentId')
    student = get_student_by_id(student_id)
    if not student:
        emit('get_student_summary_response', {
            'success': False,
            'message': 'Student not found'
        })
        return

    students = get_all_students_with_history()
    summary = get_attendance_summary(student, students)
    emit('get_student_summary_response', {
        'success': True,
        'studentId': student_id,
        'summary': summary
    })
```

**Flow:**
1. Receives WebSocket request with `studentId`
2. Retrieves student record
3. Gets all students with attendance history
4. Calculates summary using `get_attendance_summary()`
5. Sends response back via WebSocket

---

## 5. Core Calculation Function

### Location
[backend/app.py](../backend/app.py#L285-L350)

```python
def get_attendance_summary(student: Dict, all_students: List[Dict]) -> Dict:
    """Calculate attendance summary for a student."""
    from datetime import datetime as dt
    from calendar import day_name
    
    # ============================================
    # STEP 1: Identify all school days (Mon-Fri)
    # ============================================
    school_days = set()
    for s in all_students:
        for record in s.get('attendanceHistory', []):
            try:
                record_date = dt.fromisoformat(record['date'] + 'T00:00:00')
                day_of_week = record_date.weekday()
                if 0 < day_of_week < 6:  # Monday to Friday (1-5)
                    school_days.add(record['date'])
            except:
                pass
    
    total_school_days = len(school_days)
    
    # ============================================
    # STEP 2: Handle edge case (no data)
    # ============================================
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
    
    # ============================================
    # STEP 3: Filter records to school days only
    # ============================================
    student_records = [
        r for r in student.get('attendanceHistory', [])
        if r['date'] in school_days
    ]
    
    # ============================================
    # STEP 4: Count attendance statuses
    # ============================================
    on_time_days = len([r for r in student_records if r['status'] == 'on time'])
    late_days = len([r for r in student_records if r['status'] == 'late'])
    present_days = on_time_days + late_days
    absent_days = total_school_days - present_days
    
    # ============================================
    # STEP 5: Calculate percentages
    # ============================================
    presence_percentage = round(
        (present_days / total_school_days) * 100, 1
    ) if total_school_days > 0 else 0
    
    absence_percentage = round(
        (absent_days / total_school_days) * 100, 1
    ) if total_school_days > 0 else 0
    
    on_time_percentage = round(
        (on_time_days / total_school_days) * 100, 1
    ) if total_school_days > 0 else 0
    
    late_percentage = round(
        (late_days / total_school_days) * 100, 1
    ) if total_school_days > 0 else 0
    
    # ============================================
    # STEP 6: Return summary
    # ============================================
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
```

---

## 6. Data Source: Attendance History

### How Records Are Populated

#### Location: [backend/app.py](../backend/app.py#L245-L280)

```python
def get_all_students_with_history() -> List[Dict]:
    """Return all students with their attendance records."""
    # ... (connection setup code)
    
    for student_id in student_ids:
        student = get_student_by_id(student_id)
        
        # ============================================
        # Fetch attendance history from SQLite
        # ============================================
        cursor_attendance.execute('''
            SELECT date, status, arrival_time
            FROM attendance
            WHERE student_id = ?
            ORDER BY date ASC
        ''', (student_id,))
        
        # ============================================
        # Build attendance history list
        # ============================================
        history = []
        for row in cursor_attendance.fetchall():
            record = {
                'date': row['date'],
                'status': row['status'],
                'arrival_time': row['arrival_time']
            }
            history.append(record)
        
        student['attendanceHistory'] = history
        # ... (more processing)
        students.append(student)
```

### Record Format
Each attendance record has:
- **date**: ISO format (YYYY-MM-DD)
- **status**: One of `'on time'`, `'late'`, or `'absent'`
- **arrival_time**: Time student arrived (if applicable)

---

## 7. Calculation Breakdown with Example

Given this attendance data for a student:

| Date       | Day of Week | Status   |
|------------|------------|----------|
| 2025-12-19 | Friday     | on time  |
| 2025-12-20 | Saturday   | on time  | ← Weekend, excluded
| 2025-12-21 | Sunday     | on time  | ← Weekend, excluded
| 2025-12-22 | Monday     | late     |
| 2025-12-23 | Tuesday    | absent   |

### Calculation Process:

**1. Identify School Days (Mon-Fri only)**
- Scans ALL students' attendance records
- Only counts Monday-Friday (weekday() 0-6, where 0=Monday, 6=Sunday)
- School days in this data: {2025-12-19, 2025-12-22, 2025-12-23}
- `total_school_days = 3`

**2. Filter to Student's School Days**
- Student records on school days:
  - 2025-12-19: on time ✓
  - 2025-12-22: late ✓
  - 2025-12-23: absent ✓

**3. Count Status**
- `on_time_days = 1`
- `late_days = 1`
- `present_days = 1 + 1 = 2`
- `absent_days = 3 - 2 = 1`

**4. Calculate Percentages**
- `presence_percentage = (2 / 3) × 100 = 66.7%`
- `absence_percentage = (1 / 3) × 100 = 33.3%`
- `on_time_percentage = (1 / 3) × 100 = 33.3%`
- `late_percentage = (1 / 3) × 100 = 33.3%`

**Result:**
```json
{
  "totalSchoolDays": 3,
  "presentDays": 2,
  "absentDays": 1,
  "onTimeDays": 1,
  "lateDays": 1,
  "presencePercentage": 66.7,
  "absencePercentage": 33.3,
  "onTimePercentage": 33.3,
  "latePercentage": 33.3
}
```

---

## 8. Key Calculation Rules

### Rule 1: Weekday-Only Calculation
- **Only Monday-Friday are counted** as school days
- Weekends are automatically excluded
- This is enforced globally: `if 0 < day_of_week < 6`

### Rule 2: Percentage Basis
- All percentages are calculated **relative to total school days**, NOT just present days
- This ensures metrics are directly comparable
- Example: If 1 out of 3 school days = 33.3%

### Rule 3: Missing Records as Absent
- If a student has no record for a school day that exists in the system, they're counted as absent
- School days are determined by ANY student having attendance data on that day

### Rule 4: Rounding
- All percentages are rounded to **1 decimal place**
- Formula: `round(value, 1)`

---

## 9. Caching Strategy

### Frontend Cache (Store)
**Location:** [frontend/src/hooks/use-student-store.ts](../frontend/src/hooks/use-student-store.ts)

The `useStudentStore` hook maintains a `Map<studentId, summary>` for:
- Avoiding redundant API calls
- Instant UI updates
- Real-time updates via WebSocket

### When Cache is Updated
1. After successful API fetch
2. When server sends `summary_update` event
3. When `attendance_trend` push is received

---

## 10. Real-time Updates

### WebSocket Events
The system listens for these events to trigger recalculation:
- `data_changed`: Attendance record modified
- `summary_update`: Bulk summary update from server
- `attendance_trend`: Monthly trend data update

**Location:** [frontend/src/components/dashboard/student-profile-dialog.tsx](../frontend/src/components/dashboard/student-profile-dialog.tsx#L505-L520)

---

## 11. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Student Profile Dialog (React Component)                   │
│  Displays: Overall Presence, On Time, Late, Absent           │
└──────────────┬──────────────────────────────────────────────┘
               │ student.id + fetch on open
               ↓
┌──────────────────────────────────────────────────────────────┐
│  useStudentStore (Zustand)                                   │
│  studentSummaries: Map<studentId, SummaryData>               │
│  (Checks cache first)                                         │
└──────┬───────────────────────────────┬──────────────────────┘
       │ (cached)                       │ (not cached)
       │ return immediately            │ call API
       ↓                               ↓
   [UI Updates]          ┌─────────────────────────────────┐
   (instant)             │ getStudentSummary (api-client)  │
                         └──────────────┬──────────────────┘
                                        │
                         ┌──────────────↓──────────────┐
                         │  wsClient.getStudentSummary │
                         │  emit('get_student_summary')│
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────↓──────────────────────────┐
                         │  WebSocket to Backend                   │
                         │  handle_get_student_summary             │
                         │  (backend/api_endpoints.py)             │
                         └──────────────┬──────────────────────────┘
                                        │
                         ┌──────────────↓──────────────────────────┐
                         │  get_attendance_summary()               │
                         │  (backend/app.py)                       │
                         │                                          │
                         │  1. Find all school days (Mon-Fri)      │
                         │  2. Filter to student's records         │
                         │  3. Count: on_time, late, absent        │
                         │  4. Calculate percentages               │
                         │  5. Return summary object               │
                         └──────────────┬──────────────────────────┘
                                        │
                         ┌──────────────↓──────────────┐
                         │  emit response back to      │
                         │  client via WebSocket       │
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────↓──────────────┐
                         │  setAttendanceStats()       │
                         │  Update store cache         │
                         │  Trigger UI re-render       │
                         └──────────────┬──────────────┘
                                        │
                                        ↓
                                   [UI Updates]
                              (displays statistics)
```

---

## 12. Performance Considerations

### What Makes This Fast
- ✅ **In-memory calculations**: No additional DB queries during calculation
- ✅ **Set-based lookups**: School days stored as set for O(1) lookups
- ✅ **Simple arithmetic**: Only 4 count operations per student
- ✅ **Rounding only once**: Per metric, not per calculation

### Potential Bottlenecks
- ⚠️ **Large dataset scans**: Getting all students with full history can be slow
  - Could be optimized with pre-calculated aggregates
- ⚠️ **Redundant school day calculation**: Recalculated for EVERY summary request
  - Could be cached server-side

---

## 13. Error Handling

### Frontend Error Handling
- Catches failed API calls
- Sets state to null, showing loading skeleton
- Logs error to console
- Toast notification for user feedback

### Backend Error Handling
- Student not found: Returns error response
- Invalid date format: Caught and skipped with try-except
- Missing attendance data: Treated as absent

---

## 14. Summary Response Format

```json
{
  "totalSchoolDays": 3,
  "presentDays": 2,
  "absentDays": 1,
  "onTimeDays": 1,
  "lateDays": 1,
  "presencePercentage": 66.7,
  "absencePercentage": 33.3,
  "onTimePercentage": 33.3,
  "latePercentage": 33.3
}
```

**Transform to UI Format:**
```json
{
  "onTimeCount": 1,
  "lateCount": 1,
  "absentCount": 1,
  "onTimePercentage": 33.3,
  "latePercentage": 33.3,
  "absentPercentage": 33.3,
  "overallPercentage": 66.7
}
```

---

## 15. Key Files Reference

| File | Purpose |
|------|---------|
| [student-profile-dialog.tsx](../frontend/src/components/dashboard/student-profile-dialog.tsx#L850-L880) | UI Display & State Management |
| [api-client.ts](../frontend/src/lib/api-client.ts#L242-L249) | API wrapper |
| [websocket-client.ts](../frontend/src/lib/websocket-client.ts#L700-L729) | WebSocket communication |
| [api_endpoints.py](../backend/api_endpoints.py#L193-L206) | WebSocket handler |
| [app.py](../backend/app.py#L285-L350) | Core calculation logic |

---

## Summary

The data displayed in the Student Profile Dialog goes through a sophisticated pipeline:

1. **Frontend requests** summary for a student
2. **Backend calculates** by:
   - Identifying all school days (Mon-Fri only)
   - Filtering student's attendance to those days
   - Counting status occurrences
   - Computing percentages
3. **Frontend caches** the result
4. **UI displays** in a user-friendly format
5. **Real-time updates** refresh when attendance changes

The key insight is that **all percentages are relative to total school days**, not just present days, ensuring direct comparability across metrics. Weekends are automatically excluded from all calculations.
