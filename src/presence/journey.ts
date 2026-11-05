/*
 * A visitor's journey: `kind:id:s` steps (the time in whole seconds) joined by `>`, the closed steps kept in `sessionStorage`
 * so the string follows the visitor through the tab and dies with it. One journey is one visit, a
 * new one starts after JOURNEY_GAP_MS, and the format is a contract with PHP and every extension
 * (root `CLAUDE.md`).
 *
 * - A live tab holds a Web Lock named after its journey, let go on `pagehide` and taken again on a
 *   restore, so a tab that starts with a copy of another tab's storage finds the journey held and
 *   begins one of its own.
 */

import { uuid } from "../utils/identity";

/**
 * The `sessionStorage` key the journey is kept under.
 *
 * @since 0.30.0
 */
export const JOURNEY_KEY = "wordsocket-journey";
/**
 * Most steps a journey keeps; older steps drop off the front.
 *
 * @since 0.30.0
 */
export const MAX_STEPS = 50;
/**
 * The kind of a step spent with the tab hidden.
 *
 * @since 0.30.0
 */
export const AWAY = "away";
/**
 * The character between a journey's steps.
 *
 * @since 0.30.0
 */
export const SEPARATOR = ">";
/**
 * Longest pause between arrivals that is still the same visit.
 *
 * @since 0.30.0
 */
export const JOURNEY_GAP_MS = 30 * 60_000;
/**
 * The Web Lock a live tab holds on its journey: this prefix and the journey id.
 *
 * @since 0.31.0
 */
export const LOCK_PREFIX = "wordsocket-journey:";

const STEP = /^[a-z_]+:\d+:\d+$/;

/*
 * A tab close fires `visibilitychange` just before `pagehide`, which would end every closed tab in
 * a few milliseconds of `away`.
 */
const UNLOAD_AWAY_MS = 1000;

interface OpenStep {
  kind: string;
  id: number;
  since: number;
}

/** What `sessionStorage` holds: the journey id, its closed steps, the last arrival, and `e`, the page (`kind:id`) an extension's end was heard on. */
interface Stored {
  n: string;
  j: string;
  at: number;
  e?: string;
}

/**
 * A finished journey, handed back when a new one replaces it.
 *
 * @since 0.30.0
 */
export interface EndedJourney {
  n: string;
  journey: string;
}

/**
 * This tab's journey: its id, its steps and the open step's clock.
 *
 * @since 0.30.0
 */
export interface Journey {
  /** This journey's id, a version 4 UUID. */
  id(): string;
  /** The journey with the open step's elapsed time included. */
  current(): string;
  /** Close the open step, store, and return the journey. For `pagehide`. */
  close(): string;
  /**
   * Close whatever is open and open a step for this page, its clock starting at `since` (now when
   * omitted); a new journey begins when the gap had passed or an extension ended the journey and
   * this is another page, and the journey left that way is returned.
   *
   * @since 0.31.0 Returns the ended journey this step left, null otherwise.
   */
  step(kind: string, id: number, since?: number): EndedJourney | null;
  /**
   * Whether a journey with steps is under way on this page: not left for another page after an
   * extension ended it, and the gap not passed.
   *
   * @since 0.31.0 Takes the page, since an ended journey goes on only on its own page.
   */
  continuing(kind: string, id: number): boolean;
  /** The tab was hidden: close the page step, open `away`. */
  away(): void;
  /**
   * The tab is visible again: close `away` and reopen the page step, returning the old journey when
   * the away outlasted the gap.
   */
  back(): EndedJourney | null;
  /**
   * An extension ended this journey: it goes on while the visitor stays on this page, and the next
   * other page begins a new one.
   *
   * @since 0.31.0
   */
  end(): void;
  /**
   * Take the lock on this journey, resolving true when it is this tab's; when another tab holds
   * it, this tab inherited a copy of its storage, so a new journey begins and false is resolved.
   *
   * @since 0.31.0
   */
  claim(): Promise<boolean>;
  /**
   * Let the lock go, for `pagehide`, so a cached page holds nothing.
   *
   * @since 0.31.0
   */
  release(): void;
}

function locks(): LockManager | null {
  try {
    return navigator.locks ?? null;
  } catch {
    return null;
  }
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
    if (
      typeof parsed.n !== "string" ||
      typeof parsed.j !== "string" ||
      typeof parsed.at !== "number"
    )
      return null;
    return {
      n: parsed.n,
      j: parsed.j,
      at: parsed.at,
      ...(typeof parsed.e === "string" ? { e: parsed.e } : {}),
    };
  } catch {
    return null;
  }
}

function parse(journey: string): string[] {
  return journey === ""
    ? []
    : journey.split(SEPARATOR).filter((s) => STEP.test(s));
}

/** A step as the string spells it, the elapsed milliseconds as whole seconds. */
function format(kind: string, id: number, ms: number): string {
  return `${kind}:${Math.max(0, Math.floor(id))}:${Math.max(
    0,
    Math.round(ms / 1000),
  )}`;
}

/**
 * Create the journey for this tab, continuing the stored one when it is within the gap.
 *
 * @since 0.30.0
 */
export function createJourney(
  store: Storage | null = storage(),
  now: () => number = () => Date.now(),
): Journey {
  const stored = load(store);
  let n = stored?.n ?? uuid();
  let closed = stored ? parse(stored.j) : [];
  // The last arrival: a page opened or a hidden tab returned to.
  let at = stored?.at ?? now();
  let open: OpenStep | null = null;
  let page: { kind: string; id: number } | null = null;
  /* The page an extension's end was heard on, `kind:id`; null while the journey is live. */
  let endedOn: string | null = stored?.e ?? null;

  /*
   * The stored record is the one source for the last arrival.
   */
  const lastArrival = () => load(store)?.at ?? at;

  const commit = (arrival: number = lastArrival()) => {
    try {
      store?.setItem(
        JOURNEY_KEY,
        JSON.stringify({
          n,
          j: closed.join(SEPARATOR),
          at: arrival,
          ...(endedOn !== null ? { e: endedOn } : {}),
        } satisfies Stored),
      );
    } catch {
      // Storage blocked: the journey lasts for this page only.
    }
  };

  // Close the open step into the list, keeping the newest MAX_STEPS.
  const finish = () => {
    if (!open) return;
    closed.push(format(open.kind, open.id, now() - open.since));
    if (closed.length > MAX_STEPS)
      closed = closed.slice(closed.length - MAX_STEPS);
    open = null;
    commit();
  };

  const gapPassed = () => now() - lastArrival() > JOURNEY_GAP_MS;
  /* Whether this page is another than the one an extension's end was heard on. */
  const leaves = (kind: string, id: number) =>
    endedOn !== null && endedOn !== `${kind}:${id}`;

  // A new visit: new id, no steps. The caller has dealt with the old one.
  const renew = () => {
    n = uuid();
    closed = [];
    open = null;
    endedOn = null;
  };

  /* The journey id the held lock names, and what lets it go. */
  let held: string | null = null;
  let letGo: (() => void) | null = null;
  const release = () => {
    letGo?.();
    letGo = null;
    held = null;
  };
  /* Ask for the lock on `id`; true unless another page holds it or locks are not available. */
  const hold = (id: string): Promise<boolean> => {
    release();
    held = id;
    const manager = locks();
    if (!manager) return Promise.resolve(true);
    return new Promise((resolve) => {
      manager
        .request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise<void>((done) => {
            letGo = done;
          });
        })
        .catch(() => resolve(true));
    });
  };

  const arrive = (kind: string, id: number, since?: number) => {
    page = { kind, id };
    at = now();
    open = { kind, id, since: since ?? at };
    commit(at);
    if (held !== n) void hold(n);
  };

  const current = () => {
    const steps = open
      ? [...closed, format(open.kind, open.id, now() - open.since)]
      : closed;
    return steps.join(SEPARATOR);
  };

  return {
    id() {
      return n;
    },
    current,
    close() {
      if (open?.kind === AWAY && now() - open.since < UNLOAD_AWAY_MS) {
        open = null;
      }
      finish();
      return closed.join(SEPARATOR);
    },
    step(kind, id, since) {
      /*
       * A page opened after the gap, or another page after an extension ended the journey, is a
       * new visit.
       */
      const stale = gapPassed();
      const left = leaves(kind, id);
      const before = left && !stale ? { n, journey: current() } : null;
      if (left || stale) renew();
      else finish();
      arrive(kind, id, since);
      return before;
    },
    continuing(kind, id) {
      return closed.length > 0 && !leaves(kind, id) && !gapPassed();
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
    end() {
      if (endedOn !== null || !page) return;
      endedOn = `${page.kind}:${page.id}`;
      commit();
    },
    async claim() {
      if (await hold(n)) return true;
      // Another live tab owns this journey: this tab begins its own.
      renew();
      at = now();
      commit(at);
      void hold(n);
      return false;
    },
    release,
  };
}
