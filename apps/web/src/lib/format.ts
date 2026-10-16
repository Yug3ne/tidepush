const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
// Numbers are rendered on the server too, so use one locale everywhere (dates use <LocalTime>).
const integer = new Intl.NumberFormat("en-US");

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
export const formatInt = (n: number) => integer.format(n);

export function formatCompact(n: number) {
  return new Intl.NumberFormat("en-US", {
    notation: n >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "in 2 days", "just now". */
export function formatRelative(iso: string, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatPercent(part: number, total: number) {
  if (!total) return "–";
  const pct = (part / total) * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

export const shortId = (id: string, n = 8) => id.slice(0, n);

export const platformLabel = (p: string) => (p === "ios" ? "iOS" : p === "android" ? "Android" : p);

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}
