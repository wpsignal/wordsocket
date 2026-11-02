/*
 * The outbox: the last known state of each journey this browser reports, in `localStorage`, so a
 * journey whose end WordPress never heard (a crash, a killed phone, a lost connection) is reported
 * once the visitor is back and the journey can no longer continue.
 *
 * - `hold()` on every journey change and on a heartbeat while the page is visible.
 * - `due()` is what to send: entries older than the gap, a trailing away capped at it, dated by `ago`.
 * - `drop()` once WordPress acknowledged a leave for the journey.
 */

import { AWAY, JOURNEY_GAP_MS, SEPARATOR } from "./journey";

export const OUTBOX_KEY = "wordsocket-outbox";
/** How often a visible page rewrites its entry. */
export const OUTBOX_HEARTBEAT_MS = 15_000;
/** How long after load the due journeys are sent. */
export const OUTBOX_FLUSH_DELAY_MS = 5000;
/** Entries older than this are dropped unsent. */
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const MAX_ENTRIES = 20;

/**
 * A held journey.
 *
 * @since 0.31.0
 */
export interface OutboxEntry {
  /** The journey id. */
  n: string;
  /** The journey as last known, the open step's time included. */
  j: string;
  /** When `j` was true, epoch milliseconds. */
  at: number;
  /** The plugin's fields at the time. */
  data?: Record<string, unknown>;
}

/**
 * A held journey as the leave to send for it.
 *
 * @since 0.31.0
 */
export interface DueJourney {
  n: string;
  journey: string;
  data?: Record<string, unknown>;
  /** Whole seconds since the journey ended. */
  ago: number;
}

export interface Outbox {
  hold(entry: OutboxEntry): void;
  drop(n: string): void;
  /** The held journeys that can no longer continue, oldest first. */
  due(now?: number): DueJourney[];
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is OutboxEntry {
  const e = value as Partial<OutboxEntry> | null;
  return (
    !!e &&
    typeof e.n === "string" &&
    typeof e.j === "string" &&
    typeof e.at === "number"
  );
}

/** A journey's last step replaced by `away` at the gap when it ended hidden; `ago` set to match. */
function ended(entry: OutboxEntry, now: number): DueJourney {
  const steps = entry.j === "" ? [] : entry.j.split(SEPARATOR);
  const last = steps[steps.length - 1] ?? "";
  let journey = entry.j;
  let ago = Math.floor((now - entry.at) / 1000);
  if (last.startsWith(`${AWAY}:`)) {
    steps[steps.length - 1] = `${AWAY}:0:${JOURNEY_GAP_MS / 1000}`;
    journey = steps.join(SEPARATOR);
    ago = Math.max(0, ago - JOURNEY_GAP_MS / 1000);
  }
  return {
    n: entry.n,
    journey,
    ...(entry.data ? { data: entry.data } : {}),
    ago,
  };
}

/**
 * The outbox in `localStorage`, a no-op when storage is blocked.
 *
 * @since 0.31.0
 */
export function createOutbox(
  store: Storage | null = storage(),
  now: () => number = () => Date.now(),
): Outbox {
  const read = (): OutboxEntry[] => {
    try {
      const raw = store?.getItem(OUTBOX_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const floor = now() - MAX_AGE_MS;
      return parsed.filter((e) => isEntry(e) && e.at >= floor);
    } catch {
      return [];
    }
  };
  const write = (entries: OutboxEntry[]) => {
    try {
      const kept = entries
        .sort((a, b) => a.at - b.at)
        .slice(-MAX_ENTRIES);
      if (kept.length === 0) store?.removeItem(OUTBOX_KEY);
      else store?.setItem(OUTBOX_KEY, JSON.stringify(kept));
    } catch {
      // Storage blocked or full: the journey is only as safe as its live reports.
    }
  };
  return {
    hold(entry) {
      write([...read().filter((e) => e.n !== entry.n), entry]);
    },
    drop(n) {
      write(read().filter((e) => e.n !== n));
    },
    due(at = now()) {
      return read()
        .filter((e) => at - e.at > JOURNEY_GAP_MS)
        .map((e) => ended(e, at));
    },
  };
}

let flushClaimed = false;

/**
 * Whether this call is the page's one flush; the first tracker on a page takes it.
 *
 * @since 0.31.0
 */
export function claimFlush(): boolean {
  if (flushClaimed) return false;
  flushClaimed = true;
  return true;
}
