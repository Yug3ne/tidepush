import { useSyncExternalStore } from "react";
import { formatDate, formatDateTime, formatRelative } from "../lib/format";

const noop = () => () => {};

/**
 * False while server-rendering and hydrating, true right after. Unlike an
 * effect, React re-renders with the new value without a hydration mismatch.
 */
export const useHydrated = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

/** The server's rendering of a time: the same text on the server and in the first client render. */
const utc = (iso: string, withTime: boolean) => {
  const d = new Date(iso);
  return withTime ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : d.toISOString().slice(0, 10);
};

/**
 * A time, in the viewer's time zone. Server-rendered HTML can't know that
 * zone, so it shows UTC until the page hydrates, then the local form.
 */
export function LocalTime({ iso, mode = "relative" }: { iso: string; mode?: "relative" | "date" | "datetime" }) {
  const hydrated = useHydrated();
  const text = !hydrated
    ? utc(iso, mode !== "date")
    : mode === "relative"
      ? formatRelative(iso)
      : mode === "date"
        ? formatDate(iso)
        : formatDateTime(iso);
  return (
    <time dateTime={iso} title={hydrated ? formatDateTime(iso) : utc(iso, true)}>
      {text}
    </time>
  );
}
