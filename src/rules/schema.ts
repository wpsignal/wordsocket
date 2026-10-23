/*
 * The shape check run on the seed and on every `rules.updated` frame, since `events` is only as
 * trusted as the site's channel grants; a malformed set is dropped whole.
 */

import {
  FREQUENCIES,
  MAX_AFTER,
  isGroup,
  type Rule,
  type RuleNode,
} from "./types";

export const MAX_RULES = 50;
export const MAX_CONDITIONS = 20;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countNode(node: unknown, budget: { left: number }): boolean {
  if (!isRecord(node)) return false;
  if ("all" in node || "any" in node) {
    const list =
      (node as { all?: unknown }).all ?? (node as { any?: unknown }).any;
    /*
     * An empty group is always true for `all` and never for `any`, so the server refuses it; refuse
     * it here too.
     */
    if (!Array.isArray(list) || list.length === 0) return false;
    return list.every((child) => countNode(child, budget));
  }
  if (
    typeof node.condition !== "string" ||
    !KEY.test(node.condition) ||
    typeof node.op !== "string" ||
    !KEY.test(node.op)
  )
    return false;
  budget.left -= 1;
  return budget.left >= 0;
}

export function validateRule(value: unknown): value is Rule {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !ID.test(value.id)) return false;
  if (typeof value.name !== "string" || value.name.length > 120) return false;
  if (typeof value.enabled !== "boolean") return false;
  if (!(FREQUENCIES as unknown[]).includes(value.frequency)) return false;
  if (
    value.attention !== undefined &&
    (!isRecord(value.attention) ||
      typeof value.attention.enabled !== "boolean" ||
      typeof value.attention.title !== "string" ||
      value.attention.title.length > 80)
  )
    return false;
  if (
    typeof value.rev !== "number" ||
    !Number.isInteger(value.rev) ||
    value.rev < 0
  )
    return false;
  if (
    !isRecord(value.conditions) ||
    !countNode(value.conditions as RuleNode, { left: MAX_CONDITIONS })
  )
    return false;
  if (!isGroup(value.conditions as RuleNode)) return false;
  if (
    !Array.isArray(value.actions) ||
    value.actions.length === 0 ||
    value.actions.length > 10
  )
    return false;
  return value.actions.every(
    (a) =>
      isRecord(a) &&
      typeof a.action === "string" &&
      KEY.test(a.action) &&
      (a.after === undefined ||
        (typeof a.after === "number" && a.after >= 0 && a.after <= MAX_AFTER)),
  );
}

export function validateRules(value: unknown): value is Rule[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RULES &&
    value.every(validateRule)
  );
}
