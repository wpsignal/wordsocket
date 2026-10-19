/*
 * A visitor's journey: one string of `kind:id:ms` steps joined by `>`.
 *
 * - A step is a state and how long it lasted: a page (`product:123:3000`) or
 *   being away (`away:0:22000`, the tab hidden). One step is open at a time;
 *   it closes when the next opens or the page is left.
 * - The closed steps live in `sessionStorage`, so the string follows the
 *   visitor from page to page and dies with the tab.
 * - One journey is one visit, with an id of its own. A new one (new id, empty
 *   string) starts when the visitor arrives more than JOURNEY_GAP_MS after the
 *   last arrival. Opening a page or returning to a hidden tab are arrivals;
 *   closing a step is not.
 * - The visitor id (`visitorId()`, `localStorage`) outlives every journey, so
 *   the visits of one browser group under it.
 * - Ids only: a step never carries a URL, a slug or anything a person typed.
 * - The format is a contract with PHP (`Presence::JOURNEY_PATTERN`) and with
 *   every extension that stores journeys; root `CLAUDE.md` has it.
 */

import { uuid } from "../utils/identity";

export const JOURNEY_KEY = "wordsocket-journey";
export const MAX_STEPS = 50;
export const AWAY = "away";
export const SEPARATOR = ">";
/** Longest pause between arrivals that is still the same visit. */
export const JOURNEY_GAP_MS = 30 * 60_000;

const STEP = /^[a-z_]+:\d+:\d+$/;

/*
 * A tab close fires `visibilitychange` (hidden) a moment before `pagehide`,
 * so without this every closed tab would end in an `away` of a few
 * milliseconds that nobody chose.
 */
const UNLOAD_AWAY_MS = 1000;

interface OpenStep {
  kind: string;
  id: number;
  since: number;
}

/** What `sessionStorage` holds: the journey id, its closed steps, the last arrival. */
interface Stored {
  n: string;
  j: string;
  at: number;
}

/** A finished journey, handed back when a new one replaces it. */
export interface EndedJourney {
  n: string;
  journey: string;
}

export interface Journey {
  /** This journey's id, a version 4 UUID. */
  id(): string;
  /** The journey with the open step's elapsed time included. */
  current(): string;
  /** Close the open step, store, and return the journey. For `pagehide`. */
  close(): string;
  /** Close whatever is open and open a step for this page; true when the gap had passed and a new journey begins. */
  step(kind: string, id: number): boolean;
  /** The tab was hidden: close the page step, open `away`. */
  away(): void;
  /** The tab is visible again: close `away` and reopen the page step. Returns the old journey when the away outlasted the gap and a new one began. */
  back(): EndedJourney | null;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function load(store: Storage | null): Stored | null {
  try {
    const raw = store?.getItem(JOURNEY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.n !== "string" || typeof parsed.j !== "string" || typeof parsed.at !== "number") return null;
    return { n: parsed.n, j: parsed.j, at: parsed.at };
  } catch {
    return null;
  }
}

function parse(journey: string): string[] {
  return journey === "" ? [] : journey.split(SEPARATOR).filter((s) => STEP.test(s));
}

function format(kind: string, id: number, ms: number): string {
  return `${kind}:${Math.max(0, Math.floor(id))}:${Math.max(0, Math.round(ms))}`;
}

export function createJourney(store: Storage | null = storage(), now: () => number = () => Date.now()): Journey {
  const stored = load(store);
  let n = stored?.n ?? uuid();
  let closed = stored ? parse(stored.j) : [];
  // The last arrival: a page opened or a hidden tab returned to.
  let at = stored?.at ?? now();
  let open: OpenStep | null = null;
  let page: { kind: string; id: number } | null = null;

  /*
   * The stored record is the one source for the last arrival.
   */
  const lastArrival = () => load(store)?.at ?? at;

  const commit = (arrival: number = lastArrival()) => {
    try {
      store?.setItem(JOURNEY_KEY, JSON.stringify({ n, j: closed.join(SEPARATOR), at: arrival } satisfies Stored));
    } catch {
      // Storage blocked: the journey lasts for this page only.
    }
  };

  // Close the open step into the list, keeping the newest MAX_STEPS.
  const finish = () => {
    if (!open) return;
    closed.push(format(open.kind, open.id, now() - open.since));
    if (closed.length > MAX_STEPS) closed = closed.slice(closed.length - MAX_STEPS);
    open = null;
    commit();
  };

  const gapPassed = () => now() - lastArrival() > JOURNEY_GAP_MS;

  // A new visit: new id, no steps. The caller has dealt with the old one.
  const renew = () => {
    n = uuid();
    closed = [];
    open = null;
  };

  const arrive = (kind: string, id: number) => {
    page = { kind, id };
    at = now();
    open = { kind, id, since: at };
    commit(at);
  };

  return {
    id() {
      return n;
    },
    current() {
      const steps = open ? [...closed, format(open.kind, open.id, now() - open.since)] : closed;
      return steps.join(SEPARATOR);
    },
    close() {
      if (open?.kind === AWAY && now() - open.since < UNLOAD_AWAY_MS) {
        open = null;
      }
      finish();
      return closed.join(SEPARATOR);
    },
    step(kind, id) {
      /*
       * A page opened after the gap is a new visit.
       */
      const renewed = gapPassed();
      if (renewed) renew();
      else finish();
      arrive(kind, id);
      return renewed;
    },
    away() {
      if (!open || open.kind === AWAY) return;
      finish();
      open = { kind: AWAY, id: 0, since: now() };
    },
    back() {
      if (open?.kind !== AWAY || !page) return null;
      if (!gapPassed()) {
        finish();
        open = { ...page, since: now() };
        at = open.since;
        commit(at);
        return null;
      }
      // Away longer than the gap: the old visit ended when the away reached it.
      const ended: EndedJourney = {
        n,
        journey: [...closed, format(AWAY, 0, JOURNEY_GAP_MS)].join(SEPARATOR),
      };
      renew();
      arrive(page.kind, page.id);
      return ended;
    },
  };
}
