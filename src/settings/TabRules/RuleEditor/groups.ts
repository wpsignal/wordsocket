/*
 * The shape of a condition group as the builder edits it: which kind it is, its items, and a group
 * rebuilt around new items.
 */

/**
 * Internal dependencies.
 */
import type { RuleGroup, RuleNode } from "../../../rules/types";

/**
 * A group's mode: every condition or any.
 *
 * @since 0.31.0
 */
export type Mode = "all" | "any";

/**
 * A group's mode, `all` or `any`.
 *
 * @since 0.31.0
 */
export function modeOf(group: RuleGroup): Mode {
  return group.any && !group.all ? "any" : "all";
}

/**
 * A group's items.
 *
 * @since 0.31.0
 */
export function itemsOf(group: RuleGroup): RuleNode[] {
  return group[modeOf(group)] ?? [];
}

/**
 * A group of `mode` holding `items`.
 *
 * @since 0.31.0
 */
export function withItems(mode: Mode, items: RuleNode[]): RuleGroup {
  return mode === "all" ? { all: items } : { any: items };
}
