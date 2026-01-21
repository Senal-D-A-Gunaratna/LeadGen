
import type { PrefectRole } from './types';

// Static lists (authoritative for new-student registration and profile editing)
export const GRADES: string[] = [
	"6",
	"7",
	"8",
	"9",
	"10",
	"11",
	"12",
	"13",
];

export const PREFECT_ROLES: PrefectRole[] = [
		"Head Prefect",
		"Deputy Head Prefect",
		"Super Senior Prefect",
		"Senior Prefect",
		"Junior Prefect",
];

export const CLASSES: string[] = [
		"Nena",
		"Guna",
		"Edi",
		"Bala",
		"Suru",
		"Viru",
		"Diri",
];

// Dynamic/runtime filter arrays — populated at runtime from the server/store.
// These are intentionally empty here and should be managed by the app state
// (e.g., populated via websocket responses into the store). Exporting these
// references allows simple access during gradual migration if needed.
export const AVAILABLE_GRADES: string[] = [];
export const AVAILABLE_CLASSES: string[] = [];
export const AVAILABLE_ROLES: string[] = [];

// Note: Use `GRADES`, `CLASSES`, `PREFECT_ROLES` for registration/profile
// forms. Use the store-provided dynamic arrays for runtime filtering UI.
