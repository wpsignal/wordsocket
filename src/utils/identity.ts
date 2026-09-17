/**
 * Identity and trust helpers every extension ends up needing, kept here so
 * they are written once: an id generator that works on plain HTTP, a stable
 * per-browser visitor id, and the check that an event arrived on the channel
 * it claims.
 */

const VISITOR_KEY = "wordsocket-visitor";
let cachedVisitorId: string | null = null;

/*
 * A version-4 UUID. `crypto.randomUUID` only exists in secure contexts, so on a
 * plain http:// site (not localhost) it is built from `crypto.getRandomValues`,
 * which works everywhere; `Math.random` is the last resort for a browser with
 * no Web Crypto at all. These ids tell one browser or message from another,
 * they are not secrets, so that weakest path is still good enough.
 */
export function uuid(): string {
  const crypto = window.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/*
 * This browser's id, created and stored on first use and shared by every tab
 * and every extension on the site, so "people here" is counted the same way
 * everywhere. It names a browser, never a person: clearing storage makes a new
 * visitor, and when storage is blocked the id lasts for this page load only.
 */
export function visitorId(): string {
  if (cachedVisitorId) return cachedVisitorId;
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    cachedVisitorId = id;
  } catch {
    cachedVisitorId = uuid();
  }
  return cachedVisitorId;
}

/*
 * Whether an event arrived on the channel it is expected on. PHP registers
 * site-relative names (`woo:stock`) while a frame may carry the qualified one
 * (`site:{id}:woo:stock`). Any browser with a token may publish on a public
 * channel, so a handler that trusts an event by name alone can be fed one from
 * somewhere else: check the channel before acting on the data.
 */
export function onChannel(channel: string, expected: string): boolean {
  return channel === expected || channel.endsWith(`:${expected}`);
}
