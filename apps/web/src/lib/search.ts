/**
 * Search-param validation for routes. Plain functions instead of a schema
 * library: these run in the browser, and every kilobyte there counts.
 */
export type RawSearch = Record<string, unknown>;

/** A non-empty string param, or undefined. */
export const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
