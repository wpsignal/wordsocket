/*
 * The one journey of this page, driven through the lifecycle (load, away and back, `pagehide`, a
 * back/forward-cache return) and shared by the presence tracker and the rules engine. One instance
 * per page, so there is one `sessionStorage` writer per tab.
 */

import { createJourney, type EndedJourney, type Journey } from "./journey";

/**
 * The events a page journey emits.
 *
 * @since 0.31.0
 */
export type JourneyEventType = "step" | "away" | "back" | "close";

/**
 * An event a page journey emits.
 *
 * @since 0.31.0
 */
export interface JourneyEvent {
  type: JourneyEventType;
  /**
   * On `back` after the gap, or on a `step` onto another page off a journey an extension ended:
   * the journey that ended, to report once more.
   *
   * @since 0.31.0 Set on a `step` as well.
   */
  ended?: EndedJourney;
  /** On `close`: the journey with its last step closed. */
  closed?: string;
  /**
   * On `close`: a same-site link or form just navigated this tab, so the next page's visit carries
   * the step.
   *
   * @since 0.31.0
   */
  navigating?: boolean;
}

/** How long after a same-site click or submit the `pagehide` that follows is taken as its result. */
const NAVIGATION_MS = 5000;

/** The events that say a person is here; a `pointermove` counts once the pointer has travelled. */
const ENGAGEMENT_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;
const POINTER_TRAVEL_PX = 4;

/** Call `onEngaged` once, on the first trusted interaction, then stop listening. */
function watchEngagement(onEngaged: () => void): void {
  let origin: { x: number; y: number } | null = null;
  const options = { capture: true, passive: true };
  const stop = () => {
    ENGAGEMENT_EVENTS.forEach((type) =>
      window.removeEventListener(type, engaged, options),
    );
    window.removeEventListener("pointermove", moved, options);
  };
  const engaged = (event: Event) => {
    if (!event.isTrusted) return;
    stop();
    onEngaged();
  };
  const moved = (event: PointerEvent) => {
    if (!event.isTrusted) return;
    origin ??= { x: event.clientX, y: event.clientY };
    if (
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >=
      POINTER_TRAVEL_PX
    )
      engaged(event);
  };
  ENGAGEMENT_EVENTS.forEach((type) =>
    window.addEventListener(type, engaged, options),
  );
  window.addEventListener("pointermove", moved, options);
}

/** Whether a URL points at this site. */
function sameSite(href: string): boolean {
  try {
    return (
      new URL(href, window.location.href).origin === window.location.origin
    );
  } catch {
    return false;
  }
}

/**
 * The journey as this page advances it.
 *
 * @since 0.31.0
 */
export interface PageJourney {
  readonly journey: Journey;
  readonly kind: string;
  readonly id: number;
  /**
   * Whether the journey has begun: at load when one is under way, otherwise on the visitor's first
   * interaction, before which no `step` has been emitted.
   *
   * @since 0.31.0
   */
  started(): boolean;
  onChange(handler: (event: JourneyEvent) => void): () => void;
}

let instance: PageJourney | null = null;

/**
 * The one journey of this page.
 *
 * @since 0.30.0
 * @since 0.31.0 A `close` says whether a same-site navigation caused it, a new journey begins on
 *               the visitor's first interaction rather than at load, a `step` onto another page off
 *               a journey an extension ended carries it as `ended`, the visibility change an
 *               unloading document fires is not an `away`, and a journey under way goes on only
 *               once this tab holds its lock.
 */
export function pageJourney(): PageJourney {
  if (instance) return instance;
  const config = window.wpSignalConfig?.presence;
  const kind = config?.kind ?? "other";
  const id = config?.id ?? 0;
  const journey = createJourney();
  const handlers = new Set<(event: JourneyEvent) => void>();
  const emit = (event: JourneyEvent) => handlers.forEach((fn) => fn(event));

  let started = false;
  /* Whether `pagehide` has run: a document unloading or parked in the back/forward cache is not away. */
  let unloaded = false;
  /* When the page was last shown, which a held first step's clock starts from; 0 while hidden. */
  let shownAt = document.hidden ? 0 : Date.now();
  const begin = (since?: number) => {
    started = true;
    emit({ type: "step", ended: journey.step(kind, id, since) ?? undefined });
  };
  const awaitEngagement = () =>
    watchEngagement(() => begin(shownAt || Date.now()));
  /*
   * A journey under way continues at load once this tab holds it. One another tab holds was copied
   * with the storage, whatever its steps, so this tab's own waits for the visitor's first
   * interaction, as a new one does.
   */
  const underWay = journey.continuing(kind, id);
  void journey.claim().then((own) => {
    if (unloaded) return;
    if (own && underWay) begin(shownAt || Date.now());
    else awaitEngagement();
  });

  /* The last same-site link click or form submit this tab saw, 0 when none. */
  let navigatedAt = 0;
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download"))
      return;
    const target = link.getAttribute("target");
    if (target && target !== "_self") return;
    if (sameSite(link.href)) navigatedAt = Date.now();
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
    const target = form.getAttribute("target");
    if (target && target !== "_self") return;
    if (sameSite(form.action || window.location.href)) navigatedAt = Date.now();
  });

  document.addEventListener("visibilitychange", () => {
    if (unloaded) return;
    if (!started) {
      if (!document.hidden) shownAt = Date.now();
      return;
    }
    if (document.hidden) {
      journey.away();
      emit({ type: "away" });
    } else {
      const ended = journey.back();
      emit({ type: "back", ended: ended ?? undefined });
    }
  });
  window.addEventListener("pagehide", () => {
    unloaded = true;
    journey.release();
    if (!started) return;
    emit({
      type: "close",
      closed: journey.close(),
      navigating: Date.now() - navigatedAt < NAVIGATION_MS,
    });
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    unloaded = false;
    navigatedAt = 0;
    if (!started) return;
    /* The restored page takes its lock again; a tab that took the journey meanwhile keeps it. */
    void journey.claim().then(() => {
      if (!unloaded) begin();
    });
  });

  instance = {
    journey,
    kind,
    id,
    started: () => started,
    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  return instance;
}
