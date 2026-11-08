/*
 * The WordPress REST requests the client makes.
 * - `restUrl()` builds a route from one PHP printed, pretty permalinks or `?rest_route=`.
 * - `wpFetch()` and `wpPost()` send the nonce the page printed while one is held.
 * - A 403 `rest_cookie_invalid_nonce` renews the nonce through `admin-ajax.php?action=rest-nonce`
 *   and sends the request once more; a guest, whom admin-ajax answers `0`, sends it with no nonce.
 * - A renewal is kept for the tab, so a later page printing the refused nonce holds the renewed one.
 */

import { wpsDebug } from "./index";
import { isRecord, stored } from "./storage";

/** The refused nonce and what replaced it, kept for this tab. */
interface Renewal {
  refused: string;
  fresh?: string;
}

const renewed = stored<Renewal | null>(
  "session",
  "wordsocket-nonce",
  () => null,
  (value): value is Renewal | null =>
    value === null || (isRecord(value) && typeof value.refused === "string"),
);

let nonce: string | undefined;
let refused = false;
let ajaxUrl: string | undefined;
let renewal: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * `base` with `path` appended to its route and `params` set on its query.
 *
 * @since 0.31.0
 */
export function restUrl(
  base: string,
  path = "",
  params: Record<string, string> = {},
): string {
  const url = new URL(base, window.location.href);
  const route = url.searchParams.get("rest_route");
  if (route !== null) {
    url.searchParams.set("rest_route", route.replace(/\/$/, "") + path);
  } else {
    url.pathname = url.pathname.replace(/\/$/, "") + path;
  }
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return url.href;
}

/**
 * Hold the nonce the page printed, or the one that replaced it when this tab saw it refused, and the admin-ajax URL a renewal asks.
 *
 * @since 0.31.0
 */
export function holdNonce(
  printed: string | undefined,
  printedAjaxUrl: string | undefined,
): void {
  const past = printed ? renewed.read() : null;
  refused = !!past && past.refused === printed;
  nonce = refused ? past?.fresh : printed || undefined;
  ajaxUrl = printedAjaxUrl || undefined;
}

/**
 * Whether the nonce the page printed is one this tab saw refused, so nothing else the page printed was this visitor's either.
 *
 * @since 0.31.0
 */
export function printedNonceRefused(): boolean {
  return refused;
}

/**
 * The nonce currently held, if any.
 *
 * @since 0.31.0
 */
export function currentNonce(): string | undefined {
  return nonce;
}

/**
 * Call `fn` after each renewal; a renewal means the nonce the page printed was not this visitor's.
 *
 * @since 0.31.0
 */
export function onNonceRenewed(fn: () => void): void {
  listeners.add(fn);
}

/** Ask admin-ajax for the visitor's nonce, once at a time; a guest's answer clears the nonce. */
function renewNonce(refused: string): Promise<void> {
  renewal ??= (async () => {
    let fresh: string | undefined;
    if (ajaxUrl) {
      try {
        const url = new URL(ajaxUrl, window.location.href);
        url.searchParams.set("action", "rest-nonce");
        const res = await fetch(url.href, { credentials: "same-origin" });
        const text = (await res.text()).trim();
        if (res.ok && /^[a-f0-9]{10}$/.test(text)) fresh = text;
      } catch {
        fresh = undefined;
      }
    }
    wpsDebug("REST nonce refused; renewed", { renewed: !!fresh });
    nonce = fresh;
    renewed.write({ refused, fresh });
    listeners.forEach((fn) => fn());
  })().finally(() => {
    renewal = null;
  });
  return renewal;
}

/** Whether a response is core refusing the nonce; the body is read from a copy. */
async function refusedNonce(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body: unknown = await res.clone().json();
    return isRecord(body) && body.code === "rest_cookie_invalid_nonce";
  } catch {
    return false;
  }
}

/**
 * A REST request with the held nonce, sent once more with a renewed one when core refuses it.
 *
 * @since 0.31.0
 */
export async function wpFetch(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const send = () =>
    fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...init.headers,
        ...(nonce ? { "X-WP-Nonce": nonce } : {}),
      },
    });
  const sent = nonce;
  const res = await send();
  if (!sent || !(await refusedNonce(res))) return res;
  /* Another request may have renewed it meanwhile; renew only while the refused one is still held. */
  if (nonce === sent) await renewNonce(sent);
  return send();
}

/**
 * A JSON `POST` through `wpFetch`, with no body when `body` is undefined.
 *
 * @since 0.31.0
 */
export function wpPost(
  url: string,
  body?: unknown,
  keepalive = false,
): Promise<Response> {
  return wpFetch(url, {
    method: "POST",
    keepalive,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
