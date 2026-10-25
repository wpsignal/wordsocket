/*
 * The one journey of this page, driven through the lifecycle (load, away and back, `pagehide`, a
 * back/forward-cache return) and shared by the presence tracker and the rules engine. One instance
 * per page, so there is one `sessionStorage` writer per tab.
 */

import { createJourney, type EndedJourney, type Journey } from "./journey";

export type JourneyEventType = "step" | "away" | "back" | "close";

export interface JourneyEvent {
  type: JourneyEventType;
  /** On `step`: whether the gap had passed and this step began a new journey. */
  renewed?: boolean;
  /** On `back` after the gap: the journey that ended, to report once more. */
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

export interface PageJourney {
  readonly journey: Journey;
  readonly kind: string;
  readonly id: number;
  onChange(handler: (event: JourneyEvent) => void): () => void;
}

let instance: PageJourney | null = null;

/**
 * The one journey of this page.
 *
 * @since 0.30.0
 * @since 0.31.0 A `close` says whether a same-site navigation caused it.
 */
export function pageJourney(): PageJourney {
  if (instance) return instance;
  const config = window.wpSignalConfig?.presence;
  const kind = config?.kind ?? "other";
  const id = config?.id ?? 0;
  const journey = createJourney();
  const handlers = new Set<(event: JourneyEvent) => void>();
  const emit = (event: JourneyEvent) => handlers.forEach((fn) => fn(event));

  emit({ type: "step", renewed: journey.step(kind, id) });

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
    if (document.hidden) {
      journey.away();
      emit({ type: "away" });
    } else {
      const ended = journey.back();
      emit({ type: "back", ended: ended ?? undefined });
    }
  });
  window.addEventListener("pagehide", () => {
    emit({
      type: "close",
      closed: journey.close(),
      navigating: Date.now() - navigatedAt < NAVIGATION_MS,
    });
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    navigatedAt = 0;
    emit({ type: "step", renewed: journey.step(kind, id) });
  });

  instance = {
    journey,
    kind,
    id,
    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  return instance;
}
