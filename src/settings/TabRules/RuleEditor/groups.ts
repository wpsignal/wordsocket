/*
 * The shape of a condition group as the builder edits it: which kind it is, its items, and a group
 * rebuilt around new items.
 */

/**
 * Internal dependencies.
 */
import type { RuleGroup, RuleNode } from "../../../rules/types";

export type Mode = "all" | "any";

export function modeOf(group: RuleGroup): Mode {
  return group.any && !group.all ? "any" : "all";
}

export function itemsOf(group: RuleGroup): RuleNode[] {
  return group[modeOf(group)] ?? [];
}

export function withItems(mode: Mode, items: RuleNode[]): RuleGroup {
  return mode === "all" ? { all: items } : { any: items };
}
