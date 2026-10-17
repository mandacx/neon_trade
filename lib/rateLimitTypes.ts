// Constants shared by the rate-limit settings API (lib/rateLimitConfig.ts, server) and the admin editor
// (components/admin/RateLimitsEditor.tsx, client). Kept dependency-free so the client bundle doesn't pull in the database client.

/** Smallest and largest limit (requests per window) an admin may set. */
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 10_000;
