/*
 * The rules engine: evaluates enabled rules in the browser on load, journey, attention and context
 * changes and on a tick while a timed condition is in use (a second for the two page clocks, a
 * minute for the hour and the weekday), and fires on a false-to-true edge kept per tab in
 * `sessionStorage` keyed `id:rev`. Once per visitor lives in `localStorage`, once per visit in
 * `sessionStorage` under the journey id; a moment that leaves the set is taken back, and `replay()`
 * runs a rule over stored journeys.
 */

import type { Attention } from "../attention/attention";
import type { PageJourney } from "../presence/page-journey";
import { readStore, writeStore, type Recovery } from "../recovery/recovery";
import { AWAY, SEPARATOR } from "../presence/journey";
import { deviceOf } from "../attention/attention";
import { visitorId } from "../utils/identity";
import { isRecord, stored } from "../utils/storage";
import type {
  Firing,
  FiringKind,
  HistoryJourney,
  Registry,
  RuleContext,
} from "./registry";
import { isGroup, MAX_AFTER, type Rule, type RuleNode } from "./types";
import {
  DEFAULT_TITLE,
  SECOND_CONDITIONS,
  TIMED_CONDITIONS,
} from "./vocabulary";

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

export interface EngineDeps {
  registry: Registry;
  recovery: Recovery;
  attention: Attention;
  page: PageJourney | null;
  siteName: string;
  /** Kinds that are taxonomy archives, from `wpSignalConfig.rules.taxonomies`. */
  taxonomies: string[];
  /** The site's IANA timezone or "+02:00" offset, from `wpSignalConfig.rules.timezone`. */
  timezone: string;
  /** Called after the actions of a firing ran, for `onFire` and the report. */
  report: (firing: Firing, ctx: RuleContext) => void;
}

interface Step {
  kind: string;
  id: number;
  ms: number;
}

function parseSteps(journey: string): Step[] {
  if (journey === "") return [];
  return journey.split(SEPARATOR).map((s) => {
    const [kind, id, ms] = s.split(":");
    return { kind, id: Number(id) || 0, ms: Number(ms) || 0 };
  });
}

/** The journey part of a context, from the steps so far. */
export function journeyContext(
  steps: Step[],
  current: string,
): RuleContext["journey"] {
  const kinds: Record<string, number> = {};
  let visitTime = 0;
  let returned = 0;
  let pagesViewed = 0;
  steps.forEach((step, i) => {
    if (step.kind === AWAY) {
      // An away that was returned from: a step follows it.
      if (i < steps.length - 1) returned += 1;
      return;
    }
    pagesViewed += 1;
    visitTime += step.ms;
    kinds[step.kind] = (kinds[step.kind] ?? 0) + 1;
  });
  return {
    current,
    pagesViewed,
    visitTime: Math.round(visitTime / 1000),
    returned,
    kinds,
  };
}

/** Seconds on the page: the open step's time, or the last page step's when the tab is away. */
function dwellOf(steps: Step[]): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind !== AWAY) return Math.round(steps[i].ms / 1000);
  }
  return 0;
}

/** The edge state of every rule in this tab, by `id:rev`. */
const edgeStore = stored<Record<string, boolean>>(
  "session",
  "wordsocket-rules-state",
  () => ({}),
  (value): value is Record<string, boolean> => isRecord(value),
);

interface VisitFlags {
  visit: string;
  keys: Record<string, number>;
}

/** Once-per-visit flags, keyed `id:rev`, tied to the journey they were set in. */
const visitStore = stored<VisitFlags>(
  "session",
  "wordsocket-rules-visit",
  () => ({ visit: "", keys: {} }),
  (value): value is VisitFlags =>
    isRecord(value) && typeof value.visit === "string" && isRecord(value.keys),
);

/** The once-per-visit flags of `journeyId`; another journey's are an empty set. */
function readVisit(journeyId: string): VisitFlags {
  const flags = visitStore.read();
  return flags.visit === journeyId ? flags : { visit: journeyId, keys: {} };
}

/** Drops the flags of rules present in `revs` under another revision; an absent rule keeps its flags. */
function pruneFlags<T>(
  flags: Record<string, T>,
  revs: Map<string, number>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(flags).filter(([key]) => {
      const at = key.lastIndexOf(":");
      const rev = revs.get(key.slice(0, at));
      return rev === undefined || String(rev) === key.slice(at + 1);
    }),
  );
}

/**
 * Whether this is the visitor's first journey, remembered by journey id so a reload within the
 * visit still says new.
 */
function isNewVisitor(journeyId: string): boolean {
  const store = readStore() as { visit?: string };
  if (!store.visit) {
    writeStore((s) => {
      (s as { visit?: string }).visit = journeyId;
    });
    return true;
  }
  return store.visit === journeyId;
}

export interface Engine {
  setRules(rules: Rule[], version: number): void;
  readonly rules: Rule[];
  readonly version: number;
  evaluate(reason: string): void;
  replay(
    rule: Rule,
    journeys: HistoryJourney[],
  ): {
    count: number;
    fired: Array<{ index: number; step: number }>;
    unanswerable: string[];
  };
  stop(): void;
}

/**
 * The engine over the registry, the recovery surfaces and the page journey.
 *
 * @since 0.31.0 Reports what the visitor did with a prompt.
 */
export function createEngine(deps: EngineDeps): Engine {
  const { registry, recovery, attention, page } = deps;
  const taxonomies = new Set(deps.taxonomies);
  let rules: Rule[] = [];
  let version = 0;
  let edge = edgeStore.read();
  /* Whether this is the visitor's first journey, read from storage once per journey rather than per tick. */
  let newVisitor: { journey: string; isNew: boolean } | null = null;
  const isNew = (journeyId: string): boolean => {
    if (newVisitor?.journey !== journeyId)
      newVisitor = { journey: journeyId, isNew: isNewVisitor(journeyId) };
    return newVisitor.isNew;
  };
  /* Moments shown on this page view, by `id:rev`: in memory, since a new page view starts clean. */
  const pageClaims = new Set<string>();
  /* Flashes in flight, by `id:rev`, so a changed or gone moment can call its flash off. */
  const pending = new Map<string, () => void>();
  /* Actions waiting out their `after`, by `id:rev`; called off when the moment turns false or goes. */
  const delayed = new Map<string, Set<() => void>>();
  const cancelDelayed = (key: string) => {
    delayed.get(key)?.forEach((cancel) => cancel());
    delayed.delete(key);
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const offs: Array<() => void> = [];

  const test = (node: RuleNode, ctx: RuleContext): boolean => {
    if (isGroup(node)) {
      if (node.all) return node.all.every((child) => test(child, ctx));
      if (node.any) return node.any.some((child) => test(child, ctx));
      return false;
    }
    const fn = registry.conditions.get(node.condition);
    return fn ? fn(ctx, node) : false;
  };

  /** Condition keys a rule names that nobody registered. */
  const missing = (node: RuleNode, out: Set<string>): Set<string> => {
    if (isGroup(node))
      (node.all ?? node.any ?? []).forEach((child) => missing(child, out));
    else if (!registry.conditions.has(node.condition)) out.add(node.condition);
    return out;
  };
  /* Per rule, until the set or the registry changes, rather than a walk and a Set per rule per tick. */
  const missingByKey = new Map<string, Set<string>>();
  const missingOf = (rule: Rule): Set<string> => {
    const key = `${rule.id}:${rule.rev}`;
    let keys = missingByKey.get(key);
    if (!keys) {
      keys = missing(rule.conditions, new Set());
      missingByKey.set(key, keys);
    }
    return keys;
  };

  const uses = (node: RuleNode, keys: Set<string>): boolean =>
    isGroup(node)
      ? (node.all ?? node.any ?? []).some((child) => uses(child, keys))
      : keys.has(node.condition);

  const buildContext = (): RuleContext | null => {
    if (!page) return null;
    const current = page.journey.current();
    const steps = parseSteps(current);
    const ctx: RuleContext = {
      page: {
        kind: page.kind,
        id: page.id,
        title: document.title,
        dwell: dwellOf(steps),
        hidden: attention.hiddenAt
          ? Math.round((Date.now() - attention.hiddenAt) / 1000)
          : 0,
        taxonomy: taxonomies.has(page.kind),
      },
      journey: journeyContext(steps, current),
      attention: { state: attention.state },
      clock: clockAt(new Date(), deps.timezone),
      visitor: {
        id: visitorId(),
        isNew: isNew(page.journey.id()),
        loggedIn: document.body.classList.contains("logged-in"),
        device: deviceOf(),
      },
      site: { name: deps.siteName },
    };
    registry.contexts.forEach((read, key) => {
      try {
        ctx[key] = read();
      } catch {
        ctx[key] = undefined;
      }
    });
    return ctx;
  };

  /*
   * Whether the moment has had its showing: keyed by id and revision, like the edge state, so an
   * edited rule is a new message and shows again.
   */
  const spent = (rule: Rule, key: string): boolean => {
    if (rule.frequency === "page") return pageClaims.has(key);
    if (rule.frequency === "visitor") return Boolean(readStore().once?.[key]);
    if (rule.frequency === "visit" && page)
      return Boolean(readVisit(page.journey.id()).keys[key]);
    return false;
  };

  const fire = (rule: Rule, ctx: RuleContext, stepIndex: number) => {
    if (spent(rule, `${rule.id}:${rule.rev}`)) return;
    runActions(rule, ctx, stepIndex);
  };

  /*
   * The flash: a prompt opening into a hidden tab, for a moment with the switch on, starts the
   * title flashing and marks the icon until the return. It hangs on the prompt itself, so it keeps
   * to the action's delay, and a moment with nothing to show flashes nothing.
   */
  const flashFor = (key: string, rule: Rule) => {
    if (pending.has(key)) return;
    const flash = recovery.flashTitle(rule.attention?.title || DEFAULT_TITLE);
    void recovery.badge();
    const cancel = () => {
      off();
      pending.delete(key);
      flash.stop();
      recovery.clearBadge();
    };
    /* Over the instant the tab is visible again, focused or not: the title restored itself by then. */
    const off = attention.on((state, previous) => {
      if (previous === "hidden" && state !== "hidden") cancel();
    });
    pending.set(key, cancel);
  };
  offs.push(
    recovery.onShow((key) => {
      if (!key || attention.state !== "hidden") return;
      const rule = rules.find((r) => `${r.id}:${r.rev}` === key);
      if (rule?.attention?.enabled) flashFor(key, rule);
    }),
  );

  /* Reports what the visitor did with a prompt: returned to the tab, dismissed it, clicked inside it. */
  const afterShow = (
    key: string | undefined,
    action: string | undefined,
    kind: FiringKind,
  ) => {
    if (!key || !page) return;
    const rule = rules.find((r) => `${r.id}:${r.rev}` === key);
    const ctx = rule ? buildContext() : null;
    if (!rule || !ctx) return;
    const steps = parseSteps(page.journey.current());
    const stepIndex = Math.max(0, steps.length - 1);
    deps.report(
      {
        rule: rule.id,
        action: action ?? "show",
        step: stepIndex,
        ms: steps[stepIndex]?.ms ?? 0,
        kind,
      },
      ctx,
    );
  };
  const awaitingReturn = new Map<string, string | undefined>();
  offs.push(
    recovery.onShow((key, action) => {
      if (key && attention.state === "hidden") awaitingReturn.set(key, action);
    }),
    attention.on((state, previous) => {
      if (previous !== "hidden" || state === "hidden") return;
      awaitingReturn.forEach((action, key) =>
        afterShow(key, action, "returned"),
      );
      awaitingReturn.clear();
    }),
    recovery.onClose((key, reason, action) => {
      if (reason === "dismissed") afterShow(key, action, "dismissed");
    }),
    recovery.onClick((key, action) => afterShow(key, action, "clicked")),
  );

  const runActions = (rule: Rule, ctx: RuleContext, stepIndex: number) => {
    const key = `${rule.id}:${rule.rev}`;
    /*
     * The once flag is written by the first action that actually runs, not at the firing: a wait
     * called off before it ran must not have spent the one showing. The same first action closes
     * what this moment still has on screen from an earlier firing, so a moment that fires again
     * replaces its prompts instead of stacking them.
     */
    let claimed = false;
    const claim = () => {
      if (claimed) return;
      claimed = true;
      recovery.close(key);
      if (rule.frequency === "page") {
        pageClaims.add(key);
      } else if (rule.frequency === "visitor") {
        writeStore((s) => {
          s.once = { ...(s.once ?? {}), [key]: Date.now() };
        });
      } else if (rule.frequency === "visit" && page) {
        const flags = readVisit(page.journey.id());
        flags.keys[key] = Date.now();
        visitStore.write(flags);
      }
    };
    rule.actions.forEach((action) => {
      const run = registry.actions.get(action.action);
      if (!run) return;
      /* `after` is the engine's: seconds to wait, counted from here, never handed to the action. */
      const { action: _key, after, ...params } = action;
      const perform = () => {
        claim();
        try {
          void run(ctx, params, recovery, rule);
        } catch {
          // One action's failure must not stop the next.
        }
        /* The step's elapsed ms, as the journey records it. */
        const ms = page
          ? parseSteps(page.journey.current())[stepIndex]?.ms ?? 0
          : 0;
        deps.report(
          { rule: rule.id, action: action.action, step: stepIndex, ms },
          ctx,
        );
      };
      const seconds = Math.min(MAX_AFTER, Number(after));
      if (!(seconds > 0)) return perform();
      const waits = delayed.get(key) ?? new Set<() => void>();
      const timer = setTimeout(() => {
        waits.delete(cancel);
        perform();
      }, seconds * 1000);
      const cancel = () => {
        clearTimeout(timer);
        waits.delete(cancel);
      };
      waits.add(cancel);
      delayed.set(key, waits);
    });
  };

  /* `returning` marks the evaluation the return from a hidden tab triggers: its false edge (time hidden back to 0) is not a cancel. */
  const evaluate = (returning = false) => {
    if (stopped || rules.length === 0) return;
    const ctx = buildContext();
    if (!ctx) return;
    const stepIndex = Math.max(0, parseSteps(ctx.journey.current).length - 1);
    let changed = false;
    rules.forEach((rule) => {
      if (!rule.enabled || missingOf(rule).size > 0) return;
      const key = `${rule.id}:${rule.rev}`;
      const now = test(rule.conditions, ctx);
      const was = edge[key];
      if (was !== undefined && !was && now) fire(rule, ctx, stepIndex);
      if (was && !now && !returning) {
        cancelDelayed(key);
        pending.get(key)?.();
      }
      if (was !== now) {
        edge[key] = now;
        changed = true;
      }
    });
    if (changed) edgeStore.write(edge);
  };

  /* Seconds matter to the two page clocks; the hour and the weekday turn once a minute at most. */
  const retime = () => {
    clearInterval(timer);
    timer = undefined;
    if (!page || stopped) return;
    const live = rules.filter((rule) => rule.enabled);
    if (live.some((rule) => uses(rule.conditions, SECOND_CONDITIONS))) {
      timer = setInterval(() => evaluate(), SECOND_MS);
    } else if (live.some((rule) => uses(rule.conditions, TIMED_CONDITIONS))) {
      timer = setInterval(() => evaluate(), MINUTE_MS);
    }
  };

  if (page) {
    offs.push(
      page.onChange((event) => {
        /* A step is a page view: a load, or a back/forward-cache restore. */
        if (event.type === "step") pageClaims.clear();
        if (event.type !== "close") evaluate();
      }),
    );
    offs.push(
      attention.on((state, previous) =>
        evaluate(previous === "hidden" && state !== "hidden"),
      ),
    );
    const onContext = () => evaluate();
    registry.contextHandlers.add(onContext);
    offs.push(() => registry.contextHandlers.delete(onContext));
  }

  return {
    get rules() {
      return rules;
    },
    get version() {
      return version;
    },
    setRules(next, nextVersion) {
      rules = next;
      version = nextVersion;
      /*
       * A moment that changed or went away is taken back: its edge state and once flags are
       * dropped, a flash it has waiting is called off, and what it put on screen is closed.
       */
      const live = new Set(next.map((r) => `${r.id}:${r.rev}`));
      const gone = (key: string) => !live.has(key);
      edge = Object.fromEntries(
        Object.entries(edge).filter(([key]) => live.has(key)),
      );
      edgeStore.write(edge);
      missingByKey.clear();
      /*
       * Once flags go only when their rule is still here under a newer revision (an edit re-arms);
       * a rule that is absent may be paused, and a pause must not show a once-only moment again.
       */
      const revs = new Map(next.map((r) => [r.id, r.rev]));
      writeStore((s) => {
        s.once = pruneFlags(s.once ?? {}, revs);
      });
      if (page) {
        const flags = readVisit(page.journey.id());
        flags.keys = pruneFlags(flags.keys, revs);
        visitStore.write(flags);
      }
      Array.from(pageClaims)
        .filter(gone)
        .forEach((key) => pageClaims.delete(key));
      Array.from(pending.keys())
        .filter(gone)
        .forEach((key) => pending.get(key)?.());
      Array.from(delayed.keys()).filter(gone).forEach(cancelDelayed);
      recovery.shownBy.filter(gone).forEach((key) => recovery.close(key));
      retime();
      evaluate();
    },
    evaluate(reason) {
      /* A condition registered after the set arrived may answer a rule that was unanswerable. */
      if (reason === "registered") missingByKey.clear();
      evaluate();
    },
    replay(rule, journeys) {
      const unanswerable = [...missing(rule.conditions, new Set())];
      const fired: Array<{ index: number; step: number }> = [];
      journeys.forEach((entry, index) => {
        const steps = parseSteps(entry.journey);
        const started = entry.started_at ? Date.parse(entry.started_at) : NaN;
        let elapsed = 0;
        let lastPage: Step | null = null;
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const away = step.kind === AWAY;
          if (!away) lastPage = step;
          const at = Number.isNaN(started) ? null : new Date(started + elapsed);
          const ctx: RuleContext = {
            page: {
              kind: lastPage?.kind ?? "other",
              id: lastPage?.id ?? 0,
              title: "",
              dwell: Math.round((lastPage?.ms ?? 0) / 1000),
              hidden: away ? Math.round(step.ms / 1000) : 0,
              taxonomy: taxonomies.has(lastPage?.kind ?? ""),
            },
            journey: journeyContext(
              steps.slice(0, i + 1),
              steps
                .slice(0, i + 1)
                .map((s) => `${s.kind}:${s.id}:${s.ms}`)
                .join(SEPARATOR),
            ),
            attention: { state: away ? "hidden" : "page" },
            clock: at
              ? clockAt(at, deps.timezone)
              : { hour: -1, minute: -1, weekday: -1, siteHour: -1 },
            visitor: {
              id: "",
              isNew: true,
              loggedIn: false,
              device: "desktop",
            },
            site: { name: deps.siteName },
            ...(entry.context ?? {}),
          };
          if (test(rule.conditions, ctx)) {
            fired.push({ index, step: i });
            break;
          }
          elapsed += step.ms;
        }
      });
      return { count: fired.length, fired, unanswerable };
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      offs.forEach((off) => off());
      Array.from(delayed.keys()).forEach(cancelDelayed);
      Array.from(pending.values()).forEach((cancel) => cancel());
    },
  };
}

/** The visitor's clock plus the hour on the site's clock, from an IANA zone name or a "+02:00" offset. */
function clockAt(at: Date, timezone: string): RuleContext["clock"] {
  return {
    hour: at.getHours(),
    minute: at.getMinutes(),
    weekday: at.getDay(),
    siteHour: siteHourOf(at, timezone),
  };
}

function siteHourOf(at: Date, timezone: string): number {
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (offset) {
    const minutes =
      (offset[1] === "-" ? -1 : 1) *
      (Number(offset[2]) * 60 + Number(offset[3]));
    const total = at.getUTCHours() * 60 + at.getUTCMinutes() + minutes;
    return Math.floor((((total % 1440) + 1440) % 1440) / 60);
  }
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      hour: "numeric",
      hour12: false,
    }).format(at);
    return Number(hour) % 24;
  } catch {
    return -1;
  }
}
