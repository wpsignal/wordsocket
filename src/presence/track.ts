/*
 * `WPS.presence.track( channel, options )`: enters relay presence as `{ v, n, j, ...state }`,
 * announces again on every journey change, and reports visits and leaves to WordPress, which keeps
 * them while History is on. The lab in `examples/wordsocket-presence-lab` is its test.
 */

import { pageJourney } from "./page-journey";
import { sendReport, type ReportAnswer } from "./report";
import { isCrawler, visitorId } from "../utils/identity";

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
   * Whether to report visits and leaves to WordPress. Default true; false for a live-only board; a
   * function is read before each report, so a plugin can hold reports until they are worth storing
   * (ShopSocket: until the visitor has a cart). Presence is announced either way, and while the
   * site keeps journeys (`config.report`) every visitor reports whatever this says.
   */
  report?: boolean | (() => boolean);
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
   * Send the visit report again for the current journey, so a change the plugin saw (a cart
   * edited) reaches the row at once; `onVisit` handlers hear the answer. Nothing when not reporting.
   */
  report(): void;
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

/**
 * The tracker behind `WPS.presence.track()`.
 *
 * @since 0.30.0
 * @since 0.31.0 `report` may be a predicate, `onVisit()` hands out the visit answer, `report()` sends
 *               the visit again (coalesced, a failure not handed on), a journey WordPress answers as ended starts a new one, a same-site
 *               navigation sends no leave, a null channel enters no presence, and a site that keeps
 *               journeys reports every visitor.
 */
export function createTracker(
  client: PresenceClient,
  config: WpSignalPresenceConfig | undefined,
  nonce: string | undefined,
  channel: string | null,
  options: TrackOptions = {},
): PresenceTracker {
  const page = pageJourney();
  const { journey } = page;
  const v = visitorId();
  /* A crawler never reports; a site keeping journeys hears from everyone else. */
  const reporting = (): boolean =>
    !!config &&
    !isCrawler() &&
    (config.report === true ||
      (typeof options.report === "function"
        ? options.report()
        : options.report !== false));
  let state = options.state ?? {};
  let stopped = false;
  const handlers = new Set<(journey: string, journeyId: string) => void>();
  const visitHandlers = new Set<(answer: ReportAnswer | null) => void>();
  /* The newest visit answer, undefined until the first report settles, so a late subscriber gets it. */
  let lastVisit: ReportAnswer | null | undefined;

  const announce = () => {
    if (stopped) return;
    if (channel !== null) {
      client.setPresence(channel, {
        ...state,
        v,
        n: journey.id(),
        j: journey.current(),
      });
    }
    const current = journey.current();
    handlers.forEach((fn) => fn(current, journey.id()));
  };

  const send = (
    url: string | undefined,
    n: string,
    j: string,
    keepalive: boolean,
  ): Promise<ReportAnswer | null> => {
    if (!url || !reporting()) return Promise.resolve(null);
    const body = {
      v,
      n,
      journey: j,
      ...(Object.keys(state).length ? { data: state } : {}),
    };
    return sendReport(url, body, nonce, keepalive);
  };
  /* A `report()` while one is in flight queues exactly one more. */
  let inFlight = false;
  let queued = false;
  const visit = (requested = false) => {
    if (requested && inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    const n = journey.id();
    void send(config?.visitUrl, n, journey.current(), false).then((answer) => {
      inFlight = false;
      if (stopped) return;
      /*
       * WordPress says an extension ended this journey (an order placed): what the visitor does next
       * is a new visit, reported under a new id.
       */
      const ended = (answer?.journey as { ended?: boolean } | undefined)?.ended;
      if (ended && n === journey.id()) {
        journey.restart();
        announce();
        visit();
        return;
      }
      if (queued) {
        queued = false;
        visit(true);
        return;
      }
      /* A failed `report()` keeps the last answer: handlers hear only answers, never a retry's null. */
      if (requested && answer === null) return;
      lastVisit = answer;
      visitHandlers.forEach((fn) => fn(answer));
    });
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
        /* The next page's visit carries this step; the leave is for a tab that closes or goes elsewhere. */
        if (event.navigating) break;
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
    report() {
      if (!stopped) visit(true);
    },
    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onVisit(handler) {
      visitHandlers.add(handler);
      if (!reporting()) handler(null);
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
      if (channel !== null) client.setPresence(channel, null);
    },
  };
}
