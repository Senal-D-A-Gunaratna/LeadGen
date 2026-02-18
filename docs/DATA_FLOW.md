**Data Flow (HTTP snapshots + WebSocket notifications)**

Overview

- Purpose: provide server-authoritative HTTP snapshots for filtered lists while using WebSocket notifications to keep the UI responsive with minimal traffic.
- High-level pattern: UI controls → zustand store → HTTP snapshot fetch (`GET /api/students`) → backend DB → backend emits WebSocket `data_changed` → clients refresh or upsert as needed.

Sequence (typical search / filter request)

1. User updates filters or search in the UI.
2. The UI store (e.g., `useStudentStore`) triggers `fetchAndSetStudents()` / `refreshCurrentView()`.
3. The frontend calls `servers/frontend/src/lib/api-client.ts::getFilteredStudents(filters)` which issues `GET /api/students?...` to fetch a server-provided snapshot.
4. The backend reads the DB and returns a JSON snapshot `{ students: [...] }`.
5. The frontend replaces or merges the local list while preserving UI state (filters, selection).

Realtime updates (WebSocket role)

- WebSocket is used for lightweight notifications and small RPCs. The central socket is initialized in `servers/frontend/src/app/page.tsx`.
- The backend emits a `data_changed` event after any DB-write. Payloads typically include a `type` (for example `students` or `attendance`) and optional IDs such as `studentId` or `affectedIds`.
- Client behavior:
  - If a single `studentId` is provided, the client may call `GET /api/students/:id` and upsert that record.
  - Otherwise, the client performs a debounced `refreshCurrentView()` which refetches the current snapshot.

Why HTTP snapshots?

- Server-side filtering/search reduces client-side divergence.
- Snapshots are simpler and more consistent for complex filters and paged views.

Conflict resolution and staleness

- The backend attaches server timestamps to records; clients treat the server timestamp as authoritative (last-write-wins) when merging.
- Full snapshots are server-authoritative — when in doubt the UI replaces local state with the snapshot.

Backend endpoints (representative)

- `GET /api/students` — filtered snapshot; query params: `date`, `searchQuery`, `statusFilter`, `gradeFilter`, `classFilter`, `roleFilter`.
- `GET /api/students/:id` — single student profile.
- `POST /api/save-attendance` — save attendance records.
- `POST /api/add-student` — add new student.
- `PUT /api/students/:id` — update student.
- `DELETE /api/students/:id` — remove student.

WebSocket events (examples)

- `data_changed` — emitted after DB writes: `{ type, affectedIds?, studentId? }`.
- `authenticate`, `scan_student` and other small RPCs are used for authentication and peripheral actions.

Key frontend files

- `servers/frontend/src/app/page.tsx` — central WebSocket init and visibility handling.
- `servers/frontend/src/lib/api-client.ts` — HTTP client functions like `getFilteredStudents`.
- `servers/frontend/src/hooks/use-student-store.ts` — store actions for fetching and applying snapshots/upserts.

Testing & verification

- Start backend and frontend (see `docs/QUICKSTART.md`).
- Modify a student (via API or UI) and verify clients receive `data_changed` and update appropriately (single-id upsert or debounced snapshot refresh).

Notes

- This file documents the intended flow — it purposely avoids duplicating setup/install instructions. See `docs/QUICKSTART.md` for those steps.
