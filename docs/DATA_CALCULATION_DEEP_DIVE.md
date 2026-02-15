# Student Profile Dialog - Data Calculation Deep Dive (Rewritten, old-style)

## Overview
This file preserves the original structure and level of detail from the previous deep-dive but is updated to match the new frontend/backend design. Where implementation changed, clear "(placeholder)" markers are left for maintainers to insert concrete file paths, function names, and code excerpts.

Use this document to:
- Capture the authoritative calculation rules and data flows.
- Provide exact file/line references and small code excerpts (fill the placeholders).
- Give a reproducible verification example that matches production behavior.

## 1. Data Display (Frontend UI)

### Location
`(placeholder)`: insert the component path(s) that render the Student Profile Dialog and the Attendance Statistics (example: `servers/frontend/src/components/dashboard/student-profile-dialog.tsx`).

### What's Displayed
- **Overall Presence**: Percentage of canonical school days the student was present (on time + late).
- **On Time**: Count and percentage.
- **Late**: Count and percentage.
- **Absent**: Count and percentage.

Example UI snippet (replace):
```
Overall Presence: 66.7%
├─ On Time: 2 days (33.3%)
├─ Late: 2 days (33.3%)
└─ Absent: 2 days (33.3%)
```

### State Management
`(placeholder)`: describe how the component obtains the summary (store lookup, props, API call). Include the store hook file and the cache shape (e.g., `Map<studentId, summary>`).

Code excerpt to include (replace with real snippet):
```tsx
// from student-profile-dialog.tsx
const [attendanceStats, setAttendanceStats] = useState(null);
useEffect(() => {
  // store lookup -> fallback fetch -> set state
}, [studentId]);
```

---

## 2. API Client Layer (Frontend)

### Location
`(placeholder)`: API client file used by the UI (example: `servers/frontend/src/lib/api-client.ts`).

### Purpose
Describe whether the client uses WebSocket or HTTP, timeouts, error shapes, and any retry logic. Provide exact function signatures.

Example (replace with current):
```ts
export async function getStudentSummary(studentId: number) {
  return transportClient.getStudentSummary(studentId);
}
```

---

## 3. Transport Layer (WebSocket / REST)

### Protocol (placeholder)
Document the actual transport and event/route names. If WebSocket, list emitted event names and response event names; if REST, list routes and HTTP verbs.

Example (fill in):
- Emit: `get_student_summary` → `{ studentId }`
- Response: `get_student_summary_response` → `{ success, summary, message }`
- Timeout: 15s (confirm)

---

## 4. Backend Endpoint / Handler

### Location
`(placeholder)`: backend file handling summary requests (e.g., `servers/backend/api_endpoints.py`).

### Flow (template)
1. Receive request (event or HTTP) with `studentId`.
2. Validate `studentId`, fetch student record.
3. Retrieve attendance source (raw rows or aggregates).
4. Compute or fetch summary.
5. Return/emit summary to client.

Include function/route signature and a short code excerpt here.

---

## 5. Core Calculation Logic

### Location
`(placeholder)`: canonical calculation function or aggregation job (example: `servers/backend/app.py`).

### Calculation steps (confirm and document)
1. Determine canonical school days (source: business calendar table or derived from attendance rows).
2. Filter student records to canonical school days.
3. Count `on time` and `late` days; sum as `present`.
4. Decide policy for missing records (absent vs ignored).
5. Compute percentages using the agreed denominator and apply rounding.

### Rules to confirm
- School-day definition: Mon–Fri vs calendar/holidays.
- Percentages denominator: total canonical school days vs days with activity.
- Missing-records policy: count as absent or not.
- Rounding: number of decimal places.

---

## 6. Data Source: Attendance History

### Where records live
`(placeholder)`: DB and table (e.g., SQLite `attendance` table). Include columns: `date`, `status`, `arrival_time`, `student_id`.

### Record format
- `date`: `YYYY-MM-DD`
- `status`: canonical values (e.g., `on time`, `late`, `absent`)
- `arrival_time`: optional

---

## 7. Calculation Example (replace with verified data)
Provide a concrete example using the production rules and data. Example template:

Input rows (example):
- 2025-12-19: on time
- 2025-12-22: late
- 2025-12-23: absent

Expected summary (example):
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

## 8. Key Calculation Rules (record definitively)
- Weekday vs calendar-driven school days
- Percentage basis
- Missing-records policy
- Rounding/precision

---

## 9. Caching & Frontend Store

Describe cache location, shape, invalidation triggers, and event listeners (placeholders for file links).

---

## 10. Real-time Updates

List events and expected client behavior (update cache, refetch, or no-op). Provide event names and handler locations.

---

## 11. Data Flow Diagram

Recreate the original flow diagram but confirm event/route names and handler locations.

UI → Store lookup → API client → Transport → Backend handler → Calculation/Aggregate → Response → Store update → UI

---

## 12. Performance Considerations

Discuss on-demand vs precomputed summaries, server-side caching of canonical school days, and large-dataset strategies.

---

## 13. Error Handling

Document frontend and backend error handling patterns (placeholders for exact messages/codes).

---

## 14. Response Shape (authoritative)
Confirm and record the backend response object and the frontend mapping to UI fields.

Example shape (verify & replace):
```json
{
  "totalSchoolDays": 0,
  "presentDays": 0,
  "absentDays": 0,
  "onTimeDays": 0,
  "lateDays": 0,
  "presencePercentage": 0.0,
  "absencePercentage": 0.0,
  "onTimePercentage": 0.0,
  "latePercentage": 0.0
}
```

Frontend mapping example:
- `onTimeCount` ← `onTimeDays`
- `lateCount` ← `lateDays`
- `absentCount` ← `absentDays`
- `overallPercentage` ← `presencePercentage`

---

## 15. Files Reference (fill with exact links)

- Student profile UI: `(placeholder)`
- API client: `(placeholder)`
- Transport client: `(placeholder)`
- Backend handlers: `(placeholder)`
- Calculation/aggregates: `(placeholder)`

---

## Summary & Next Steps
1. Replace placeholders with concrete file paths and code excerpts.
2. Confirm the canonical rules and record them here.
3. Add a verified example from production/dev data.

If you want, I can scan the repo and auto-populate the placeholders with file links and short excerpts — would you like me to do that now?

Document last updated: draft — update with author/date after verification.

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
│  Displays: Overall Presence, On Time, Late, Absent          │
└──────────────┬──────────────────────────────────────────────┘
               │ student.id + fetch on open
               ↓
┌──────────────────────────────────────────────────────────────┐
│  useStudentStore (Zustand)                                   │
│  studentSummaries: Map<studentId, SummaryData>               │
│  (Checks cache first)                                        │
└──────┬───────────────────────────────┬───────────────────────┘
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
                         │                                         │
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
