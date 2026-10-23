/*
 * WordSocket's own conditions and actions, each key paired with a PHP registration in
 * `class-wpsignal-rules.php` that describes it to the builder.
 */

import type { Attention } from "../attention/attention";
import type { Recovery } from "../recovery/recovery";
import type { ActionRun, ConditionTest, RuleContext } from "./registry";
import type { Rule, RuleCondition, RulePresentation } from "./types";

const num = (value: unknown): number =>
  typeof value === "number" ? value : Number(value) || 0;
const str = (value: unknown): string =>
  typeof value === "string" ? value : String(value ?? "");

function compare(op: string, actual: number, wanted: number): boolean {
  if (op === "at_least") return actual >= wanted;
  if (op === "at_most") return actual <= wanted;
  return false;
}

function equals(op: string, actual: unknown, wanted: unknown): boolean {
  const same = String(actual) === String(wanted);
  if (op === "is") return same;
  if (op === "is_not") return !same;
  return false;
}

export const conditions: Record<string, ConditionTest> = {
  page_kind: (ctx, c) => equals(c.op, ctx.page.kind, c.value),
  page_id: (ctx, c) =>
    !ctx.page.taxonomy && equals(c.op, ctx.page.id, num(c.value)),
  term_id: (ctx, c) =>
    ctx.page.taxonomy && equals(c.op, ctx.page.id, num(c.value)),
  taxonomy: (ctx, c) =>
    ctx.page.taxonomy && equals(c.op, ctx.page.kind, c.value),
  dwell: (ctx, c) => compare(c.op, ctx.page.dwell, num(c.value)),
  time_hidden: (ctx, c) => compare(c.op, ctx.page.hidden, num(c.value)),
  pages_viewed: (ctx, c) =>
    compare(c.op, ctx.journey.pagesViewed, num(c.value)),
  visited: (ctx, c) => {
    const seen = (ctx.journey.kinds[str(c.value)] ?? 0) > 0;
    if (c.op === "includes") return seen;
    if (c.op === "excludes") return !seen;
    return false;
  },
  site_hour: (ctx, c) => hourBetween(c, ctx.clock.siteHour),
  hour: (ctx, c) => hourBetween(c, ctx.clock.hour),
  weekday: (ctx, c) =>
    c.op === "in" &&
    Array.isArray(c.value) &&
    c.value.map(num).includes(ctx.clock.weekday),
  visitor: (ctx, c) =>
    equals(c.op, ctx.visitor.isNew ? "new" : "returning", c.value),
  logged_in: (ctx, c) => equals(c.op, ctx.visitor.loggedIn, Boolean(c.value)),
  device: (ctx, c) => equals(c.op, ctx.visitor.device, c.value),
};

/** An hour against a `{ from, to }` range; a range across midnight (22 to 6) is allowed. */
function hourBetween(c: RuleCondition, h: number): boolean {
  if (c.op !== "between" || h < 0) return false;
  const range = (
    typeof c.value === "object" && c.value !== null ? c.value : {}
  ) as { from?: unknown; to?: unknown };
  const from = num(range.from);
  const to = num(range.to);
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
}

/** The conditions whose truth can change within a second: the two page clocks. */
export const SECOND_CONDITIONS = new Set(["dwell", "time_hidden"]);

/** Every condition whose truth changes with time alone, so the engine ticks while one is in use. */
export const TIMED_CONDITIONS = new Set([
  ...SECOND_CONDITIONS,
  "site_hour",
  "hour",
  "weekday",
]);

export interface ActionDeps {
  attention: Attention;
  loadPattern(id: number): Promise<Node | null>;
}

/** Show's `presentation` param, with a bare string read as the type alone. */
export function presentationOf(value: unknown): RulePresentation {
  if (typeof value === "string") return { type: value, pattern: 0, text: "" };
  const v = (typeof value === "object" && value !== null ? value : {}) as {
    type?: unknown;
    pattern?: unknown;
    text?: unknown;
  };
  return {
    type: str(v.type) || "banner",
    pattern: Math.max(0, Math.floor(num(v.pattern))),
    text: str(v.text),
  };
}

/** Show a rule's content; several moments, or several Shows in one, may be on screen together. */
async function showContent(
  deps: ActionDeps,
  recovery: Recovery,
  rule: Rule,
  params: Record<string, unknown>,
  ctx: RuleContext,
): Promise<boolean> {
  const shown = presentationOf(params.presentation);
  const pattern = shown.pattern ? await deps.loadPattern(shown.pattern) : null;
  return recovery.show({ text: shown.text }, shown.type, {
    rule: `${rule.id}:${rule.rev}`,
    context: ctx,
    pattern,
  });
}

/** The tab title a moment flashes when it names none. */
export const DEFAULT_TITLE = "Still there?";

export function actions(deps: ActionDeps): Record<string, ActionRun> {
  return {
    show: (ctx, params, recovery, rule) => {
      void showContent(deps, recovery, rule, params, ctx);
    },
  };
}
