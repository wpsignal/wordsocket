/*
 * Where the visitor's attention is, as far as the browser can tell: `page` (visible and focused),
 * `window` (visible, window unfocused, desktop only) or `hidden` (tab not visible, which always
 * wins). A blur whose active element is an iframe stays `page`, since checkout payment fields are
 * cross-origin iframes.
 */

export type AttentionState = "page" | "window" | "hidden";

export interface Attention {
  readonly state: AttentionState;
  /** When the tab became hidden (ms since the epoch), null while it is visible. */
  readonly hiddenAt: number | null;
  /** Called on every change with the new state. Returns the unsubscribe. */
  on(
    handler: (state: AttentionState, previous: AttentionState) => void,
  ): () => void;
}

/** Whether the primary input is a mouse or trackpad (it can hover and point finely), where window focus is trustworthy. */
export function hasPointer(): boolean {
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

/** A guess at the device: a hovering fine pointer is a desktop; otherwise the width says phone or tablet. */
export function deviceOf(): "desktop" | "tablet" | "mobile" {
  if (hasPointer()) return "desktop";
  return window.innerWidth < 768 ? "mobile" : "tablet";
}

export function createAttention(): Attention {
  let state: AttentionState = document.hidden ? "hidden" : "page";
  let hiddenAt: number | null = document.hidden ? Date.now() : null;
  // Whether the window is unfocused, remembered so a return from hidden lands on the right state.
  let unfocused = false;
  const handlers = new Set<
    (state: AttentionState, previous: AttentionState) => void
  >();

  const set = (next: AttentionState) => {
    if (next === state) return;
    const previous = state;
    state = next;
    hiddenAt = next === "hidden" ? Date.now() : null;
    handlers.forEach((fn) => fn(next, previous));
  };
  const settle = () => {
    if (document.hidden) set("hidden");
    else set(unfocused && hasPointer() ? "window" : "page");
  };

  document.addEventListener("visibilitychange", settle);
  window.addEventListener("blur", () => {
    // Focus went into a frame on this page, not to another window.
    if (document.activeElement?.tagName === "IFRAME") return;
    unfocused = true;
    settle();
  });
  window.addEventListener("focus", () => {
    unfocused = false;
    settle();
  });

  return {
    get state() {
      return state;
    },
    get hiddenAt() {
      return hiddenAt;
    },
    on(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
