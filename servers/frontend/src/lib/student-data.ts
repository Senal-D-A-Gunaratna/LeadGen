
// Runtime filter arrays — populated at runtime from the server via WebSocket.
// The authoritative values are provided by the backend. Frontend code should
// read these arrays (or listen for `static_filters_update`) and avoid embedding
// canonical lists here to ensure a single source-of-truth.
import type { PrefectRole } from './types';

// Runtime filter arrays — populated at runtime from the server via WebSocket.
// The authoritative values are provided by the backend. Frontend code should
// read these arrays (or listen for `static_filters_update`) and avoid embedding
// canonical lists here to ensure a single source-of-truth.
export const AVAILABLE_GRADES: string[] = [];
export const AVAILABLE_CLASSES: string[] = [];
export const AVAILABLE_ROLES: string[] = [];

// Static (backend-configured) filter arrays — populated once from the
// backend `get_static_filters` request. These are the canonical, static
// lists (grades/classes/prefect roles) and should be used by components
// that expect the configuration-provided values.
export const STATIC_GRADES: string[] = [];
export const STATIC_CLASSES: string[] = [];
export const STATIC_ROLES: PrefectRole[] = [];

// Backwards-compatible aliases: components that import `GRADES`, `CLASSES`,
// and `PREFECT_ROLES` can continue to use those names — they'll reference the
// runtime arrays and thus will be populated via WebSocket. This preserves the
// strict WebSocket-only transfer while avoiding mass component rewrites.
// Backwards-compatible aliases (deprecated): keep these names so existing
// import sites don't break. They point to the static/config-backed lists
// rather than the runtime `AVAILABLE_*` arrays.
export const GRADES = STATIC_GRADES;
export const CLASSES = STATIC_CLASSES;
export const PREFECT_ROLES: PrefectRole[] = STATIC_ROLES as PrefectRole[];

// Keep exported arrays in-sync with the central store so existing importers
// that reference `GRADES`, `CLASSES`, or `PREFECT_ROLES` see updates when
// the WebSocket populates filters at runtime.
if (typeof window !== 'undefined') {
	try {
		// Import here to avoid server-side imports causing React/DOM issues
		// and to avoid circular import problems during module initialization.
		// We use `getState` and `subscribe` (Zustand) to update exported arrays in-place.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { useStudentStore } = require('@/hooks/use-student-store');

		// Initialize with current store values (if any)
		try {
			const s = useStudentStore.getState();
			if (s.availableGrades && s.availableGrades.length) {
				AVAILABLE_GRADES.splice(0, AVAILABLE_GRADES.length, ...s.availableGrades);
			}
			if (s.availableClasses && s.availableClasses.length) {
				AVAILABLE_CLASSES.splice(0, AVAILABLE_CLASSES.length, ...s.availableClasses);
			}
			if (s.availableRoles && s.availableRoles.length) {
				AVAILABLE_ROLES.splice(0, AVAILABLE_ROLES.length, ...s.availableRoles);
			}
		} catch (err) {
			// noop
		}

		// Subscribe to changes and copy values into exported arrays in-place
		try {
			useStudentStore.subscribe((state: any) => state.availableGrades, (grades: string[]) => {
				AVAILABLE_GRADES.splice(0, AVAILABLE_GRADES.length, ...(grades || []));
			});
			useStudentStore.subscribe((state: any) => state.availableClasses, (classes: string[]) => {
				AVAILABLE_CLASSES.splice(0, AVAILABLE_CLASSES.length, ...(classes || []));
			});
			useStudentStore.subscribe((state: any) => state.availableRoles, (roles: string[]) => {
				AVAILABLE_ROLES.splice(0, AVAILABLE_ROLES.length, ...(roles || []));
			});
		} catch (err) {
			// noop
		}

		// Populate static/config-backed lists once from the backend via WebSocket.
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { wsClient } = require('@/lib/websocket-client');
			wsClient.getStaticFilters().then((resp: { grades?: string[]; classes?: string[]; roles?: string[] }) => {
				if (resp) {
					if (resp.grades && resp.grades.length) {
						STATIC_GRADES.splice(0, STATIC_GRADES.length, ...resp.grades);
					}
					if (resp.classes && resp.classes.length) {
						STATIC_CLASSES.splice(0, STATIC_CLASSES.length, ...resp.classes);
					}
					if (resp.roles && resp.roles.length) {
						STATIC_ROLES.splice(0, STATIC_ROLES.length, ...(resp.roles as PrefectRole[]));
					}
					// Also populate DB-derived dynamic lists if provided by the same response
					// (backend returns both canonical lists and available* in get_static_filters_response)
					// Update module-level AVAILABLE_* arrays in-place so existing importers see values.
					// Then seed the store's available* via its action to keep the reactive source in-sync.
					const anyResp: any = resp as any;
					if (anyResp.availableGrades && anyResp.availableGrades.length) {
						AVAILABLE_GRADES.splice(0, AVAILABLE_GRADES.length, ...anyResp.availableGrades);
					}
					if (anyResp.availableClasses && anyResp.availableClasses.length) {
						AVAILABLE_CLASSES.splice(0, AVAILABLE_CLASSES.length, ...anyResp.availableClasses);
					}
					if (anyResp.availableRoles && anyResp.availableRoles.length) {
						AVAILABLE_ROLES.splice(0, AVAILABLE_ROLES.length, ...(anyResp.availableRoles as string[]));
					}
					try {
						const sstate = useStudentStore.getState();
						if (sstate && sstate.actions && typeof sstate.actions.setFilterOptions === 'function') {
							sstate.actions.setFilterOptions({ grades: anyResp.availableGrades || [], classes: anyResp.availableClasses || [], roles: anyResp.availableRoles || [] });
						}
					} catch (e) {
						// noop
					}
				}
			}).catch(() => {
				// noop
			});
		} catch (err) {
			// noop
		}
	} catch (err) {
		// If store import fails for any reason, do nothing — components will
		// gracefully handle empty arrays until runtime initialization completes.
	}
}
