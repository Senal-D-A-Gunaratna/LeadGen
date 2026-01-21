import type { PrefectRole } from './types';

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

// Static filters are the authoritative lists used for new-student registration and
// profile editing. Runtime filter lists (for UI filtering) should be sourced
// from the server/store and are separate from these static values.
