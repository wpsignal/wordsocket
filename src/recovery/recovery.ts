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
  type CloseReason,
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
  /** The action showing it, reported with what the visitor does to the prompt. */
  action?: string;
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
  /**
   * Called each time a prompt closes, with the moment (`id:rev`) and action that showed it, and
   * `dismissed` when the visitor closed it (a toast's clock and a takeback pass no reason).
   *
   * @since 0.31.0 Receives the moment, the reason and the action.
   */
  onClose(
    handler: (rule?: string, reason?: CloseReason, action?: string) => void,
  ): () => void;
  /**
   * Called each time a prompt opens, with the moment (`id:rev`) and action that showed it, if any. Returns the unsubscribe.
   *
   * @since 0.31.0 Receives the action.
   */
  onShow(handler: (rule?: string, action?: string) => void): () => void;
  /**
   * Called on a click on a link or button inside a prompt, with the moment and action that showed it.
   *
   * @since 0.31.0
   */
  onClick(handler: (rule?: string, action?: string) => void): () => void;
}

/**
 * The recovery API: prompts, the title flash, the badge and the chime.
 *
 * @since 0.31.0 Closes carry the moment, the reason and the action; `onClick()`.
 */
export function createRecovery(attention: Attention): Recovery {
  const open = new Map<PromptMount, ShowOptions>();
  const closeHandlers = new Set<
    (rule?: string, reason?: CloseReason, action?: string) => void
  >();
  const showHandlers = new Set<(rule?: string, action?: string) => void>();
  const clickHandlers = new Set<(rule?: string, action?: string) => void>();

  const closeOne = (mount: PromptMount, reason?: CloseReason) => {
    const shownBy = open.get(mount);
    if (!shownBy || !open.delete(mount)) return;
    mount.close();
    closeHandlers.forEach((fn) => fn(shownBy.rule, reason, shownBy.action));
  };

  /* The content, with clicks on links and buttons inside it reported. */
  const clickable = (node: Node, options: ShowOptions): Node => {
    let el: Element;
    if (node instanceof Element) {
      el = node;
    } else {
      el = document.createElement("div");
      el.appendChild(node);
    }
    el.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (!target?.closest?.("a, button, input[type=submit], [role=button]"))
        return;
      clickHandlers.forEach((fn) => fn(options.rule, options.action));
    });
    return el;
  };

  return {
    get open() {
      return open.size > 0;
    },
    get shownBy() {
      const keys = Array.from(open.values())
        .map((shownBy) => shownBy.rule)
        .filter((key): key is string => typeof key === "string");
      return Array.from(new Set(keys));
    },
    close(rule) {
      Array.from(open.entries())
        .filter(([, shownBy]) => rule === undefined || shownBy.rule === rule)
        .forEach(([mount]) => closeOne(mount));
    },
    show(content, presentation, options = {}) {
      /* The mount's own close button closes that prompt alone; `mount` is assigned before any can fire. */
      let mount: PromptMount | null = null;
      mount = presentationFor(presentation)(promptLayer(), (reason) => {
        if (mount) closeOne(mount, reason);
      });
      open.set(mount, options);
      mount.open(
        clickable(
          resolveContent(content, options.context, options.pattern),
          options,
        ),
      );
      showHandlers.forEach((fn) => fn(options.rule, options.action));
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
    onClick(handler) {
      clickHandlers.add(handler);
      return () => {
        clickHandlers.delete(handler);
      };
    },
  };
}
