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
# Student Profile Dialog - Data Calculation Deep Dive

## Overview

This document describes how student attendance summaries are produced and surfaced to the UI. It preserves decision rules, points to the canonical files to change, and leaves a small set of placeholders for exact code excerpts that should be filled in during a follow-up pass.

Where practical, the file references below point to the current workspace layout under `servers/frontend` and `servers/backend`.

## 1. Data Display (Frontend UI)

### Location
Likely location: `servers/frontend/src/components/dashboard/student-profile-dialog.tsx` (component that renders the profile and attendance summary).

### What's displayed
- Overall presence: percentage of canonical school days the student was present (on time + late).
- On time: count and percentage.
- Late: count and percentage.
- Absent: count and percentage.

### State flow
- The dialog reads from `useStudentStore` (Zustand). On mount it looks up a cached summary and falls back to `GET /api/students/:id` if missing.

## 2. API client layer (frontend)

Location: `servers/frontend/src/lib/api-client.ts`.

Primary behavior: HTTP for snapshots (`GET /api/students`, `GET /api/students/:id`), small WebSocket RPCs for peripheral operations. Errors are surfaced as standard HTTP error shapes; retry logic is minimal and left to callers.

## 3. Transport layer

- HTTP: snapshots and single-record fetches (`GET /api/students`, `GET /api/students/:id`).
- WebSocket: lightweight notifications initialized in `servers/frontend/src/app/page.tsx`. Important events: `data_changed`, `authenticate`, `scan_student`.

## 4. Backend handler

Likely code locations: `servers/backend/api_endpoints.py` and `servers/backend/app.py` (or `fastapi_app.py`/`fastapi_main.py` depending on which entrypoint is used in your deployment).

Flow:
1. Validate input (studentId, filters).
2. Query the appropriate DB (see `servers/backend/data/` files).
3. Compute aggregates or return precomputed results.
4. Return JSON snapshot or single-record response.

## 5. Core calculation logic

Canonical steps:
1. Determine canonical school days for the requested range (business-calendar or derived from attendance rows).
2. Filter attendance rows to those canonical days.
3. Count on-time and late entries; sum as present; remaining canonical days are absent.
4. Percentages use canonical school days as the denominator unless a different policy is configured.

Policy decisions to confirm:
- School-day definition (Mon–Fri vs calendar with holidays).
- Whether missing rows count as absent.
- Rounding/precision rules.

## 6. Data source: attendance history

Primary storage: SQLite DB `servers/backend/data/attendance.db` with a table like `attendance_records` containing columns such as `date`, `status`, `arrival_time`, and `student_id`.

## 7. Calculation example

Provide a verified example after confirming the policy above. Example template:

```json
{
  "totalSchoolDays": 3,
  "onTimeDays": 1,
  "lateDays": 1,
  "absentDays": 1,
  "presencePercentage": 66.67
}
```

## 8. Key rules

- Weekday vs calendar-driven school days
- Percentages denominated on canonical days
- Missing-records policy (absent vs ignored)

## 9. Caching & frontend store

Location: `servers/frontend/src/hooks/use-student-store.ts`.

Cache shape: Map keyed by `studentId` storing computed summaries. Cache is invalidated by `data_changed` events or explicit refreshes.

## 10. Real-time updates

WebSocket events of interest:
- `data_changed`: triggers upsert or refresh depending on payload (single id vs bulk)
- `summary_update`, `attendance_trend`: used for bulk/analytic updates when available

## 11. Data flow diagram

UI → `useStudentStore` → `api-client` (HTTP GET snapshot) → backend handler → DB / calculation → JSON snapshot → store update → UI

## 12. Performance considerations

- Use on-demand snapshots for filtered lists; precompute per-student summaries if a single-student report is expensive.
- Cache canonical school days server-side to avoid recomputing date sets.

## 13. Error handling

- Backend: return clear HTTP error codes and messages for invalid input.
- Frontend: show concise messages and allow retry for network errors.

## 14. Response shape (recommended)

Canonical response for a student summary:

```json
{
  "studentId": 123,
  "totalSchoolDays": 180,
  "onTimeDays": 150,
  "lateDays": 10,
  "absentDays": 20,
  "presencePercentage": 88.89
}
```

## 15. File references (suggested)

- Student profile UI: `servers/frontend/src/components/dashboard/student-profile-dialog.tsx`
- API client: `servers/frontend/src/lib/api-client.ts`
- Transport (WS): `servers/frontend/src/lib/websocket-client.ts` or `servers/frontend/src/app/page.tsx`
- Backend handlers: `servers/backend/api_endpoints.py`, `servers/backend/app.py` or `servers/backend/fastapi_app.py`
- Calculation/aggregates: `servers/backend/*` (search for attendance aggregation helpers)

## Next steps

If you want, I can scan the repository and populate the remaining placeholders with exact file snippets and line links. The next pass would (optionally) insert short code excerpts and confirm the precise endpoints used by the running backend.

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
