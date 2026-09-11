/**
 * Exponential backoff with jitter for reconnect and retry timers.
 *
 * Every failed attempt doubles the ceiling (1s, 2s, 4s, ...) up to `cap`; the
 * actual delay is drawn from the upper half of that window so a fleet of
 * clients recovering from the same outage does not retry in lockstep, while
 * the countdown shown to users still means something. `reset()` after a
 * successful connection returns to the first step.
 */
export class Backoff {
  private attempts = 0;
  private lastDelay = 0;

  constructor(
    private readonly baseMs = 1000,
    private readonly capMs = 60000,
    private readonly factor = 2,
  ) {}

  /** Failed attempts since the last reset. */
  get failures(): number {
    return this.attempts;
  }

  /** The delay most recently handed out by `next()`, in ms. */
  get currentDelay(): number {
    return this.lastDelay;
  }

  /** Register a failure and return the delay to wait before the next attempt. */
  next(): number {
    const ceiling = Math.min(this.capMs, this.baseMs * this.factor ** this.attempts);
    this.attempts += 1;
    this.lastDelay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
    return this.lastDelay;
  }

  reset(): void {
    this.attempts = 0;
    this.lastDelay = 0;
  }
}
