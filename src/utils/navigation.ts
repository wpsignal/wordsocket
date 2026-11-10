/*
 * Whether this page is navigating within the site: the Navigation API's `navigate` event names every
 * navigation the page starts and every history traversal, cleared again when one is aborted or has
 * not committed within NAVIGATION_MS; a typed URL, a bookmark and a tab close name nothing, which is
 * what tells a leave from a navigation.
 *
 * - Without the Navigation API, a same-site link click or form submit counts for NAVIGATION_MS.
 */

/** How long a navigation counts once started: a commit ends the page, an abort or a download does not. */
const NAVIGATION_MS = 30_000;

/**
 * What the page knows about a navigation under way.
 *
 * @since 0.32.0
 */
export interface NavigationWatch {
  /** Whether a same-site, cross-document navigation has started and not been aborted. */
  navigating(): boolean;
  /** Called with true as a same-site, cross-document navigation starts and false when it is called off. Returns the unsubscribe function. */
  onNavigate(handler: (navigating: boolean) => void): () => void;
}

/** Whether a URL points at this site. */
export function sameSite(href: string): boolean {
  try {
    return (
      new URL(href, window.location.href).origin === window.location.origin
    );
  } catch {
    return false;
  }
}

let instance: NavigationWatch | null = null;

/**
 * The one navigation watch of this page.
 *
 * @since 0.32.0
 */
export function watchNavigation(): NavigationWatch {
  if (instance) return instance;
  const handlers = new Set<(navigating: boolean) => void>();
  let pending = false;
  let expiry: ReturnType<typeof setTimeout> | null = null;
  const set = (value: boolean) => {
    if (value === pending) return;
    pending = value;
    if (expiry !== null) clearTimeout(expiry);
    expiry = value ? setTimeout(() => set(false), NAVIGATION_MS) : null;
    handlers.forEach((fn) => fn(value));
  };

  if (window.navigation) {
    window.navigation.addEventListener("navigate", (e) => {
      if (e.destination.sameDocument || e.downloadRequest !== null) return;
      if (!sameSite(e.destination.url)) {
        set(false);
        return;
      }
      e.signal.addEventListener("abort", () => set(false));
      set(true);
    });
  } else {
    document.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download"))
        return;
      const target = link.getAttribute("target");
      if (target && target !== "_self") return;
      if (sameSite(link.href)) set(true);
    });
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const target = form.getAttribute("target");
      if (target && target !== "_self") return;
      if (sameSite(form.action || window.location.href)) set(true);
    });
  }
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) set(false);
  });

  instance = {
    navigating: () => pending,
    onNavigate(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  return instance;
}
