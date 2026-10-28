/*
 * The tab title as a surface: alternate the page title with a message while hidden and restore it
 * the instant the tab is visible. One flasher serves every caller: the original title is captured
 * once, the newest text is the one shown, and the title is restored when the last caller stops, so
 * two moments flashing at once cannot leave each other's text behind. Hidden tabs throttle timers,
 * so the beat is approximate.
 */

const BEAT_MS = 1_500;

export interface TitleFlash {
  stop(): void;
}

const active = new Map<symbol, string>();
let original = "";
let showing = false;
let timer: ReturnType<typeof setInterval> | undefined;

function current(): string {
  return Array.from(active.values()).pop() ?? original;
}

function tick(): void {
  showing = !showing;
  document.title = showing ? current() : original;
}

function onVisible(): void {
  if (!document.hidden) stopAll();
}

function stopAll(): void {
  active.clear();
  if (timer === undefined) return;
  clearInterval(timer);
  timer = undefined;
  document.removeEventListener("visibilitychange", onVisible);
  document.title = original;
}

export function flashTitle(text: string): TitleFlash {
  const id = Symbol(text);
  if (timer === undefined) {
    original = document.title;
    showing = false;
    document.addEventListener("visibilitychange", onVisible);
    timer = setInterval(tick, BEAT_MS);
  }
  active.set(id, text);
  if (!showing) tick();
  return {
    stop() {
      if (!active.delete(id)) return;
      if (active.size === 0) stopAll();
      else if (showing) document.title = current();
    },
  };
}
