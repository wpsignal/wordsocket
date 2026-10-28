/*
 * One guarded accessor per web storage key, shared by the rules engine, the recovery store, the
 * pattern cache and the chime.
 * - A read parses the JSON and falls back when the store is blocked, the key is empty or it holds
 *   something of another shape.
 * - A write swallows a blocked store, so the value lasts for this page only.
 */

export interface Stored<T> {
  read(): T;
  write(value: T): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A key in `localStorage` or `sessionStorage` holding a `T`; `fallback` makes a fresh default and `valid` tells a `T` from anything else. */
export function stored<T>(
  area: "local" | "session",
  key: string,
  fallback: () => T,
  valid: (value: unknown) => value is T,
): Stored<T> {
  const store = () =>
    area === "local" ? window.localStorage : window.sessionStorage;
  return {
    read() {
      try {
        const raw = store().getItem(key);
        if (raw === null) return fallback();
        const parsed: unknown = JSON.parse(raw);
        return valid(parsed) ? parsed : fallback();
      } catch {
        return fallback();
      }
    },
    write(value) {
      try {
        store().setItem(key, JSON.stringify(value));
      } catch {
        /* Storage blocked: the value lasts for this page only. */
      }
    },
  };
}
