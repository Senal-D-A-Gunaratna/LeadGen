**Data Flow (HTTP snapshots + WebSocket notifications)**

Overview
- Purpose: ensure stable, server-authoritative snapshots for queries (filters & search) while keeping UI live and lightweight via WebSocket notifications.
- High-level pattern: UI controls -> zustand store -> HTTP snapshot fetch (/api/students) -> backend DB -> backend emits WebSocket `data_changed` notifications -> clients fetch incremental or full snapshots as needed.

Sequence (typical search / filter request)
1. User types a search or toggles filters in the UI (search box, grade/class/status, date picker).
2. UI calls the store action (e.g. `setSearchQuery`, `setGradeFilter`) which updates `useStudentStore` state.
3. The UI dispatches `fetchAndSetStudents()` / `refreshCurrentView()` (store action) which:
   - reads current filters from the store
   - calls `frontend/src/lib/api-client.ts::getFilteredStudents(filters)`
   - that function issues an HTTP GET to `/api/students?date=...&searchQuery=...&gradeFilter=...` (server snapshot)
4. The Flask backend `/api/students` builds the query, reads DB, and returns a JSON snapshot `{ students: [...] }`.
5. Frontend replaces the local `students`/`fullRoster` with the returned snapshot while preserving UI state (filters, selectedStudent, activeTab).

Realtime updates (WebSocket role)
- WebSocket is used only for notifications and small RPCs (non-snapshot ops). The single, central socket is owned by `frontend/src/app/page.tsx`.
- Backend emits a `data_changed` event when DB-affecting operations occur. Payloads may include `type` (e.g. `students`, `attendance`) and `affectedIds` or `studentId` when available.
- Central handler behavior:
  - If payload targets a single `studentId`, client calls `GET /api/students/:id` and upserts that student into the store via `applyRealtimeUpdate` (last-write-wins using server timestamp).
  - Otherwise, the handler triggers a debounced `refreshCurrentView()` which refetches the current filtered snapshot from `/api/students` and replaces the store.

Why HTTP snapshots?
- Consistency: server-side filtering/search avoids divergence caused by partial client-side state.
- Stability: snapshots are simpler to reason about for UI components and eliminate complex incremental merge bugs.

Conflict resolution and staleness
- Incremental upserts use server timestamps attached to records. Client merges prefer the server timestamp (last-write-wins).
- Full snapshot is server-authoritative — on doubt, refreshCurrentView replaces client state.
- Visibility policy: no automatic refresh on tab visibility. The app only refreshes in response to `data_changed` or user actions; the store clears lightweight caches on `hidden` to reduce memory footprint.

Backend endpoints
- `GET /api/students` — returns filtered snapshot; query params: `date`, `searchQuery`, `statusFilter`, `gradeFilter`, `classFilter`, `roleFilter`.
- `GET /api/students/:id` — returns a full single-student profile.
- Other existing endpoints (backups, downloads) remain as before; snapshots should be the single source for student listing.

WebSocket events (examples)
- `data_changed` — notified after any DB-write (payload: `{ type: string, affectedIds?: number[], studentId?: number }`).
- `connection`, `connection_count`, and smaller RPCs for non-snapshot operations (create backup, validate password, saveAttendance, updateStudent) continue to use the Socket client.

Key files & actions (frontend)
- `frontend/src/app/page.tsx` — central WS + visibility handling and debounced data_changed handler.
- `frontend/src/lib/api-client.ts` — `getFilteredStudents()` and `getStudentById()` use HTTP.
- `frontend/src/hooks/use-student-store.ts` — `fetchAndSetStudents()`, `refreshCurrentView()`, `applyRealtimeUpdate()` implement snapshot fetch + merge logic.
- `frontend/src/app/actions.ts` — action wrappers used by UI components.

Testing & verification notes
- Smoke test: run backend, start frontend dev server, change a student record in backend or via UI and verify:
  - clients receive `data_changed` over WS
  - if `studentId` present, client upserts that student without full refresh
  - for broader changes client performs debounced snapshot refresh and UI updates with filters preserved

Docs & follow-ups
- This file documents the expected flow; update `docs/QUICKSTART.md` to reflect runtime startup order (start backend first, then frontend) and note that WS connect is centralized in `frontend/src/app/page.tsx`.
 - This file documents the expected flow; update `docs/QUICKSTART.md` to reflect runtime startup order (start backend first, then frontend) and note that WS connect is centralized in `frontend/src/app/page.tsx`.

 - Note: Centralized WebSocket notifications plus HTTP snapshots reduce UI flicker and prevent visibility-triggered reloads; socket snapshot RPCs are deprecated and kept only for compatibility during migration.
