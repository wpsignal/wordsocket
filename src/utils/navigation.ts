/**
 * Same-site navigation watcher.
 *
 * - Records a same-site link click or form submit, the one moment a page knows it is moving on rather than closing or reloading.
 * - `watchNavigation()` returns a function answering with the destination while such a record is under 5 s old.
 */

const FRESH_MS = 5000;

/**
 * Where a navigation is headed and the post it names: `post` in the URL's query, `post_ID` or `post` in a form, 0 for none.
 *
 * @since 0.32.0
 */
export interface Destination {
  url: URL;
  postId: number;
}

/** A URL within this site that is not the current document, or null. */
function within(href: string | null): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return null;
    const sameDocument = url.href.includes("#") && url.href.split("#")[0] === location.href.split("#")[0];
    return sameDocument ? null : url;
  } catch {
    return null;
  }
}

/**
 * Watch same-site link clicks and form submits; the returned function gives the destination while one happened within the last 5 s.
 *
 * @since 0.32.0
 */
export function watchNavigation(): () => Destination | null {
  let at = 0;
  let destination: Destination | null = null;
  const record = (url: URL | null, postId = 0): void => {
    if (!url) return;
    at = Date.now();
    destination = { url, postId: postId || Number(url.searchParams.get("post")) || 0 };
  };
  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link && !link.getAttribute("target") && !link.hasAttribute("download")) record(within(link.getAttribute("href")));
    },
    true,
  );
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || form.getAttribute("target")) return;
      const data = new FormData(form);
      record(within(form.getAttribute("action") || location.href), Number(data.get("post_ID") ?? data.get("post")) || 0);
    },
    true,
  );
  return () => (destination && Date.now() - at <= FRESH_MS ? destination : null);
}
