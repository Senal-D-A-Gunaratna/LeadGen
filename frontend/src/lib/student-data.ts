
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

// Backwards-compatible aliases: components that import `GRADES`, `CLASSES`,
// and `PREFECT_ROLES` can continue to use those names — they'll reference the
// runtime arrays and thus will be populated via WebSocket. This preserves the
// strict WebSocket-only transfer while avoiding mass component rewrites.
export const GRADES = AVAILABLE_GRADES;
export const CLASSES = AVAILABLE_CLASSES;
export const PREFECT_ROLES: PrefectRole[] = AVAILABLE_ROLES as PrefectRole[];

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
	} catch (err) {
		// If store import fails for any reason, do nothing — components will
		// gracefully handle empty arrays until runtime initialization completes.
	}
}
