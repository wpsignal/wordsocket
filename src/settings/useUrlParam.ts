/*
 * The settings page's routing: query parameters on the admin URL, so a view can be linked to and
 * survives a refresh. One writer for every parameter, and one `popstate` listener.
 * - `tab` is the tab (`AppSettings.tsx`, `replaceState`); a tab adds its own, such as `moment` on
 *   the Moments tab, pushed so Back and Forward step through moments.
 * - `useUrlParam( name )` is `useState` backed by the URL for a component that owns one parameter;
 *   it follows Back and Forward too.
 * - Back and Forward pass through the navigation guard (`setNavigateGuard`, installed by
 *   `UnsavedChangesProvider`): declining pushes the URL that was left back on.
 */

/**
 * WordPress dependencies.
 */
import { useCallback, useEffect, useState } from "@wordpress/element";

type Leave = () => void;
type Guard = (leave: Leave, stay: Leave) => void;

/* The URL as last accepted, so a declined Back or Forward can be undone. */
let current = window.location.href;
let guard: Guard = (leave) => leave();
const listeners = new Set<() => void>();

window.addEventListener("popstate", () => {
  const previous = current;
  guard(
    () => {
      current = window.location.href;
      listeners.forEach((fn) => fn());
    },
    () => window.history.pushState(window.history.state, "", previous),
  );
});

/** Install the check every Back and Forward goes through; `stay` undoes the step. */
export function setNavigateGuard(next: Guard | null): void {
  guard = next ?? ((leave) => leave());
}

/** Called after an accepted Back or Forward. Returns the unsubscribe. */
export function onNavigate(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The parameter's current value, or null. */
export function readUrlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function commit(url: URL, push: boolean): void {
  if (url.href === window.location.href) return;
  if (push) window.history.pushState(null, "", url.href);
  else window.history.replaceState(window.history.state, "", url.href);
  current = url.href;
}

/** Set or, with null, remove the parameter; `push` makes it a history entry. */
export function writeUrlParam(
  name: string,
  value: string | null,
  { push = false } = {},
): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  commit(url, push);
}

/** Drop every parameter but `keep`, as a tab switch does with the old tab's own. */
export function clearUrlParams(keep: string[]): void {
  const url = new URL(window.location.href);
  Array.from(url.searchParams.keys())
    .filter((key) => !keep.includes(key))
    .forEach((key) => url.searchParams.delete(key));
  commit(url, false);
}

/** State that starts from the URL parameter, writes every change back and follows Back and Forward; a call may override `push`. */
export function useUrlParam(
  name: string,
  { push = false } = {},
): [
  string | null,
  (value: string | null, options?: { push?: boolean }) => void,
] {
  const [value, setValue] = useState(() => readUrlParam(name));
  useEffect(() => onNavigate(() => setValue(readUrlParam(name))), [name]);
  const set = useCallback(
    (next: string | null, options?: { push?: boolean }) => {
      writeUrlParam(name, next, { push: options?.push ?? push });
      setValue(next);
    },
    [name, push],
  );
  return [value, set];
}
