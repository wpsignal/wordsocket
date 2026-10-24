/*
 * `WPS.presence.track( channel, options )`: enters relay presence as `{ v, n, j, ...state }`,
 * announces again on every journey change, and reports visits and leaves to WordPress, which stores
 * none of it. The lab in `examples/wordsocket-presence-lab` is its test.
 */

import { pageJourney } from "./page-journey";
import { sendReport, type ReportAnswer } from "./report";
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
  /**
   * Called with what WordPress answered each visit report (`ok` plus the fields of the
   * `wpsignal_visitor_visit_response` filter), so a plugin reads its own state without a request
   * of its own; the latest answer is replayed to a late subscriber, and null means none is coming
   * (the tracker does not report, or the report failed). Returns the unsubscribe.
   */
  onVisit(handler: (answer: ReportAnswer | null) => void): () => void;
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
  const visitHandlers = new Set<(answer: ReportAnswer | null) => void>();
  /* The newest visit answer, undefined until the first report settles, so a late subscriber gets it. */
  let lastVisit: ReportAnswer | null | undefined;

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
  ): Promise<ReportAnswer | null> => {
    if (!report || !url) return Promise.resolve(null);
    const body = {
      v,
      n,
      journey: j,
      ...(Object.keys(state).length ? { data: state } : {}),
    };
    return sendReport(url, body, nonce, keepalive);
  };
  const visit = () => {
    void send(config?.visitUrl, journey.id(), journey.current(), false).then(
      (answer) => {
        if (stopped) return;
        lastVisit = answer;
        visitHandlers.forEach((fn) => fn(answer));
      },
    );
  };

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
    onVisit(handler) {
      visitHandlers.add(handler);
      if (!report) handler(null);
      else if (lastVisit !== undefined) handler(lastVisit);
      return () => {
        visitHandlers.delete(handler);
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      off();
      handlers.clear();
      visitHandlers.clear();
      client.setPresence(channel, null);
    },
  };
}
