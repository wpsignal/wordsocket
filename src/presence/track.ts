/*
 * `WPS.presence.track( channel, options )`: enters relay presence as `{ v, n, j, ...state }`,
 * announces again on every journey change, and reports visits and leaves to WordPress, which stores
 * none of it. The lab in `examples/wordsocket-presence-lab` is its test.
 */

import { pageJourney } from "./page-journey";
import { sendReport } from "./report";
import { visitorId } from "../utils/identity";

/** The client the tracker drives: presence only, so a test can stand one in. */
export interface PresenceClient {
  setPresence(channel: string, state: Record<string, unknown> | null): void;
}

export interface TrackOptions {
  /**
   * The plugin's own fields, carried in presence state and in every report (ShopSocket's cart id).
   */
  state?: Record<string, unknown>;
  /**
   * Whether to report visits and leaves to WordPress. Default true; false for a live-only board.
   */
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
  /**
   * Called after every change to the journey (a step, away, back, a new visit). Returns the
   * unsubscribe.
   */
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
  const page = pageJourney();
  const { journey } = page;
  const v = visitorId();
  const report = options.report !== false && !!config;
  let state = options.state ?? {};
  let stopped = false;
  const handlers = new Set<(journey: string, journeyId: string) => void>();

  const announce = () => {
    if (stopped) return;
    client.setPresence(channel, {
      ...state,
      v,
      n: journey.id(),
      j: journey.current(),
    });
    const current = journey.current();
    handlers.forEach((fn) => fn(current, journey.id()));
  };

  const send = (
    url: string | undefined,
    n: string,
    j: string,
    keepalive: boolean,
  ) => {
    if (!report || !url) return;
    const body = {
      v,
      n,
      journey: j,
      ...(Object.keys(state).length ? { data: state } : {}),
    };
    sendReport(url, body, nonce, keepalive);
  };
  const visit = () =>
    send(config?.visitUrl, journey.id(), journey.current(), false);

  // The page's step has already been opened by `pageJourney()`: announce and report it.
  announce();
  visit();
  const off = page.onChange((event) => {
    if (stopped) return;
    switch (event.type) {
      case "step":
        announce();
        visit();
        break;
      case "away":
        announce();
        break;
      case "back":
        /*
         * Back after the gap: the old journey gets its leave with the away capped at the gap, and
         * this return is the first step of a new one.
         */
        if (event.ended) {
          send(config?.leaveUrl, event.ended.n, event.ended.journey, false);
          visit();
        }
        announce();
        break;
      case "close":
        send(
          config?.leaveUrl,
          journey.id(),
          event.closed ?? journey.current(),
          true,
        );
        break;
    }
  });

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
      off();
      handlers.clear();
      client.setPresence(channel, null);
    },
  };
}
