/*
 * The rule JSON shared by the engine, the settings app and the broadcast; the server validates it
 * and the browser checks the shape again.
 */

export interface RuleCondition {
  condition: string;
  op: string;
  value?: unknown;
}

export interface RuleGroup {
  all?: RuleNode[];
  any?: RuleNode[];
}

export type RuleNode = RuleCondition | RuleGroup;

/** An action is its key plus its params, flat: `{ action: "show", presentation: {...} }`. */
export type RuleAction = { action: string } & Record<string, unknown>;

/** The moment's own attention behaviour: fired on a hidden tab, flash the title until the return. */
export interface RuleAttention {
  enabled: boolean;
  title: string;
}

/** How often a moment shows: repeatedly, at most once per page view, once per visit (the journey) or once per visitor. */
export type RuleFrequency = "always" | "page" | "visit" | "visitor";
export const FREQUENCIES: RuleFrequency[] = [
  "always",
  "page",
  "visit",
  "visitor",
];

/* The server's limits (`Rules::MAX_AFTER`, `Rules::MAX_TEXT`), so the builder and the engine agree with it. */
/** The longest an action may wait, in seconds. */
export const MAX_AFTER = 3600;
/** The longest a prompt's text or a text param gets. */
export const MAX_TEXT = 500;

export interface Rule {
  /** 8 hex, or a slug for a rule an extension ships. */
  id: string;
  name: string;
  enabled: boolean;
  frequency: RuleFrequency;
  /**
   * Bumped by the server on every save of this rule; the edge state is keyed `id:rev`, so an edit
   * re-arms.
   */
  rev: number;
  /** The extension that shipped it through `wpsignal_default_rules`, if any. */
  source?: string;
  attention?: RuleAttention;
  conditions: RuleGroup;
  actions: RuleAction[];
}

/** Show's `presentation`: how to show it, a synced pattern id or 0, and the text (with placeholders) used when there is none. */
export interface RulePresentation {
  type: string;
  pattern: number;
  text: string;
}

export function isGroup(node: RuleNode): node is RuleGroup {
  return "all" in node || "any" in node;
}
