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
}

export interface PageJourney {
  readonly journey: Journey;
  readonly kind: string;
  readonly id: number;
  onChange(handler: (event: JourneyEvent) => void): () => void;
}

let instance: PageJourney | null = null;

export function pageJourney(): PageJourney {
  if (instance) return instance;
  const config = window.wpSignalConfig?.presence;
  const kind = config?.kind ?? "other";
  const id = config?.id ?? 0;
  const journey = createJourney();
  const handlers = new Set<(event: JourneyEvent) => void>();
  const emit = (event: JourneyEvent) => handlers.forEach((fn) => fn(event));

  emit({ type: "step", renewed: journey.step(kind, id) });

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
    emit({ type: "close", closed: journey.close() });
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted)
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
