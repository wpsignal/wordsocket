/*
 * `WPS.presence.track( channel, options )`: who is on the site and where they
 * went, with no heartbeat and no job.
 *
 * - Opens this page's journey step (PHP seeds the page's kind and id).
 * - Enters relay presence on the channel as `{ v, n, j, ...state }`: the
 *   visitor id, the journey id, the journey, the plugin's own fields.
 * - Reports the visit to WordPress, and the leave on `pagehide`.
 * - Keeps the journey honest: `away` on `visibilitychange`, a fresh step and
 *   visit when the page returns from the back/forward cache, a new journey
 *   (old one reported once more) when the visitor returns after the gap.
 * - WordSocket stores none of it: the visit and leave routes hand each report
 *   to the `wpsignal_visitor_visit` and `wpsignal_visitor_leave` actions.
 * - Proven in `examples/wordsocket-presence-lab` (Phase 60 stage 1) before it
 *   moved here; the lab's eight Playwright cases are its tests.
 */

import { createJourney, type Journey } from "./journey";
import { sendReport } from "./report";
import { visitorId } from "../utils/identity";

/** The client the tracker drives: presence only, so a test can stand one in. */
export interface PresenceClient {
  setPresence(channel: string, state: Record<string, unknown> | null): void;
}

export interface TrackOptions {
  /** The plugin's own fields, carried in presence state and in every report (ShopSocket's cart id). */
  state?: Record<string, unknown>;
  /** Whether to report visits and leaves to WordPress. Default true; false for a live-only board. */
  report?: boolean;
}

export interface PresenceTracker {
  /** This browser's visitor id, the same `WPS.visitorId()` gives. */
  readonly visitor: string;
  /** This visit's journey id. */
  journeyId(): string;
  /** The journey so far, the open step's time included. */
  journey(): string;
  /** Replace the plugin's fields: presence is announced again at once. */
  update(state: Record<string, unknown>): void;
  /** Called after every change to the journey (a step, away, back, a new visit). Returns the unsubscribe. */
  onChange(handler: (journey: string, journeyId: string) => void): () => void;
  /** Leave presence and stop listening. The journey in storage is kept. */
  stop(): void;
}

export function createTracker(
  client: PresenceClient,
  config: WpSignalPresenceConfig | undefined,
  nonce: string | undefined,
  channel: string,
  options: TrackOptions = {},
): PresenceTracker {
  const journey: Journey = createJourney();
  const v = visitorId();
  /*
   * No step from PHP (an admin page, a page cached before this version) is
   * still a tracked page, just one nobody can name.
   */
  const kind = config?.kind ?? "other";
  const id = config?.id ?? 0;
  const report = options.report !== false && !!config;
  let state = options.state ?? {};
  let stopped = false;
  const handlers = new Set<(journey: string, journeyId: string) => void>();

  const announce = () => {
    if (stopped) return;
    client.setPresence(channel, { ...state, v, n: journey.id(), j: journey.current() });
    const current = journey.current();
    handlers.forEach((fn) => fn(current, journey.id()));
  };

  const send = (url: string | undefined, n: string, j: string, keepalive: boolean) => {
    if (!report || !url) return;
    const body = { v, n, journey: j, ...(Object.keys(state).length ? { data: state } : {}) };
    sendReport(url, body, nonce, keepalive);
  };
  const visit = () => send(config?.visitUrl, journey.id(), journey.current(), false);

  const onVisibility = () => {
    if (stopped) return;
    if (document.hidden) {
      journey.away();
    } else {
      /*
       * Back after the gap: the old visit is over, and this return is the
       * first step of a new one.
       */
      const ended = journey.back();
      if (ended) {
        send(config?.leaveUrl, ended.n, ended.journey, false);
        visit();
      }
    }
    announce();
  };
  const onPageHide = () => {
    if (stopped) return;
    send(config?.leaveUrl, journey.id(), journey.close(), true);
  };
  // Restored from the back/forward cache: the page is live again.
  const onPageShow = (event: PageTransitionEvent) => {
    if (stopped || !event.persisted) return;
    journey.step(kind, id);
    announce();
    visit();
  };

  journey.step(kind, id);
  announce();
  visit();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  return {
    visitor: v,
    journeyId: () => journey.id(),
    journey: () => journey.current(),
    update(next) {
      state = next;
      announce();
    },
    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      handlers.clear();
      client.setPresence(channel, null);
    },
  };
}
