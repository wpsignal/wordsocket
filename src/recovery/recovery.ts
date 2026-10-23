/*
 * `WPS.recovery`: the surfaces a rule's action reaches a visitor through: `show()` (as many prompts
 * as the moments ask for, each with its own close), `presentation()` for extensions, `flashTitle()`,
 * `badge()`, `sound()` and `onReturn()`. It stores nothing and fires nothing by itself; whether a
 * visitor sees a moment again is the engine's once flag alone, so a dismissal is not remembered.
 * Each prompt remembers the moment (`id:rev`) that showed it, so `close( key )` can take back what
 * a moment that has since changed or gone put on screen.
 */

import type { Attention } from "../attention/attention";
import {
  resolveContent,
  type PromptContent,
  type PromptContext,
} from "./content";
import { badgeFavicon, clearFavicon } from "./favicon";
import { playSound } from "./sound";
import {
  presentationFor,
  promptLayer,
  registerPresentation,
  type PresentationMount,
  type PromptMount,
} from "./surfaces";
import { flashTitle, type TitleFlash } from "./title";
import { isRecord, stored } from "../utils/storage";

interface RulesStore {
  once?: Record<string, number>;
}

/** The per-visitor record: once flags and the first journey, in `localStorage`, shared with the engine. */
const store = stored<RulesStore>(
  "local",
  "wordsocket-rules",
  () => ({}),
  (value): value is RulesStore => isRecord(value),
);

export function readStore(): RulesStore {
  return store.read();
}

export function writeStore(update: (store: RulesStore) => void): void {
  const current = store.read();
  update(current);
  store.write(current);
}

export interface ShowOptions {
  /** The rule showing this prompt, for whoever listens to closes. */
  rule?: string;
  /** Values for the content's placeholders. */
  context?: PromptContext;
  /** Rendered pattern markup, when the engine fetched one. */
  pattern?: Node | null;
}

export interface Recovery {
  show(
    content: PromptContent,
    presentation: string,
    options?: ShowOptions,
  ): boolean;
  presentation(key: string, mount: PresentationMount): void;
  flashTitle(text: string): TitleFlash;
  badge(): Promise<boolean>;
  clearBadge(): void;
  sound(): boolean;
  onReturn(handler: () => void): () => void;
  /** Whether any prompt is on screen right now. */
  readonly open: boolean;
  /** The moments (`id:rev`) with a prompt on screen. */
  readonly shownBy: string[];
  /** Close every prompt on screen, or only those a moment (`id:rev`) showed. */
  close(rule?: string): void;
  /** Called each time a prompt closes. Returns the unsubscribe. */
  onClose(handler: () => void): () => void;
  /** Called each time a prompt opens, with the moment (`id:rev`) that showed it, if any. Returns the unsubscribe. */
  onShow(handler: (rule?: string) => void): () => void;
}

export function createRecovery(attention: Attention): Recovery {
  const open = new Map<PromptMount, string | undefined>();
  const closeHandlers = new Set<() => void>();
  const showHandlers = new Set<(rule?: string) => void>();

  const closeOne = (mount: PromptMount) => {
    if (!open.delete(mount)) return;
    mount.close();
    closeHandlers.forEach((fn) => fn());
  };

  return {
    get open() {
      return open.size > 0;
    },
    get shownBy() {
      const keys = Array.from(open.values()).filter(
        (key): key is string => typeof key === "string",
      );
      return Array.from(new Set(keys));
    },
    close(rule) {
      Array.from(open.entries())
        .filter(([, shownBy]) => rule === undefined || shownBy === rule)
        .forEach(([mount]) => closeOne(mount));
    },
    show(content, presentation, options = {}) {
      /* The mount's own close button closes that prompt alone; `mount` is assigned before any can fire. */
      let mount: PromptMount | null = null;
      mount = presentationFor(presentation)(promptLayer(), () => {
        if (mount) closeOne(mount);
      });
      open.set(mount, options.rule);
      mount.open(resolveContent(content, options.context, options.pattern));
      showHandlers.forEach((fn) => fn(options.rule));
      return true;
    },
    presentation: registerPresentation,
    flashTitle,
    badge: badgeFavicon,
    clearBadge: clearFavicon,
    sound: playSound,
    onReturn(handler) {
      return attention.on((state, previous) => {
        if (state === "page" && previous !== "page") handler();
      });
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    onShow(handler) {
      showHandlers.add(handler);
      return () => {
        showHandlers.delete(handler);
      };
    },
  };
}
