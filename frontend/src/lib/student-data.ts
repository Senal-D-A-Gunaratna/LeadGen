
// Runtime filter arrays — populated at runtime from the server via WebSocket.
// The authoritative values are provided by the backend. Frontend code should
// read these arrays (or listen for `static_filters_update`) and avoid embedding
// canonical lists here to ensure a single source-of-truth.
export const AVAILABLE_GRADES: string[] = [];
export const AVAILABLE_CLASSES: string[] = [];
export const AVAILABLE_ROLES: string[] = [];
