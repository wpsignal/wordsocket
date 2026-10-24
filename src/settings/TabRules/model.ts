/*
 * The vocabulary as `GET /wpsignal/v1/rules` describes it, with the helpers the tab shares:
 * defaults, the summary sentence, the id generator.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleGroup,
  RuleNode,
} from "../../rules/types";
import { isGroup } from "../../rules/types";
import type { PatternOption } from "./ValueControl";

export type ValueType =
  | "none"
  | "number"
  | "text"
  | "boolean"
  | "select"
  | "kind"
  | "id"
  | "hours"
  | "weekdays"
  | "presentation";

export interface ConditionSpec {
  key: string;
  label: string;
  description: string;
  operators: Array<{ key: string; label: string }>;
  value: ValueType;
  options: Record<string, string>;
  /** A select's options in named groups; `options` is the same set flat. */
  groups?: OptionGroup[];
  source: string;
}

export interface OptionGroup {
  label: string;
  options: Record<string, string>;
}

export interface ParamSpec {
  type: ValueType;
  label: string;
  options: Record<string, string>;
  default: unknown;
  /** Shown only while this boolean param of the same action is on. */
  when?: string;
  /** Words around the control in the chip ("after" [20] "s"). */
  prefix?: string;
  suffix?: string;
}

export interface ActionSpec {
  key: string;
  label: string;
  description: string;
  params: Record<string, ParamSpec>;
  live: boolean;
  source: string;
}

export interface ContextSpec {
  key: string;
  label: string;
  placeholders: Record<string, string>;
  source: string;
}

export interface Vocabulary {
  conditions: ConditionSpec[];
  actions: ActionSpec[];
  contexts: ContextSpec[];
}

/** A rule as the listing returns it: the saved shape plus the keys nothing registered. */
export interface ListedRule extends Rule {
  unavailable?: string[];
}

export interface RulesListing {
  version: number;
  rules: ListedRule[];
  removed: string[];
  vocabulary: Vocabulary;
  kinds: Record<string, string>;
  /** The same kinds under the headings the selects show. */
  kindGroups: OptionGroup[];
}

/** An 8-hex id, from WordSocket's generator when the client is on the page. */
export function newId(): string {
  const uuid = window.WPS?.uuid?.();
  if (uuid) return uuid.replace(/-/g, "").slice(0, 8);
  const bytes = new Uint8Array(4);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A sensible first value for a type, so a new row is valid as it appears. */
export function defaultValue(
  type: ValueType,
  options: Record<string, string>,
  kinds: Record<string, string>,
): unknown {
  switch (type) {
    case "number":
      return 1;
    case "id":
      return 1;
    case "text":
      return "";
    case "boolean":
      return true;
    case "select":
      return Object.keys(options)[0] ?? "";
    case "kind":
      return kinds.post ? "post" : Object.keys(kinds)[0] ?? "other";
    case "hours":
      return { from: 9, to: 17 };
    case "weekdays":
      return [1, 2, 3, 4, 5];
    case "presentation":
      return {
        type: Object.keys(options)[0] ?? "banner",
        pattern: 0,
        text: "",
      };
    default:
      return null;
  }
}

export function newCondition(
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
): RuleCondition {
  const spec = vocabulary.conditions[0];
  return {
    condition: spec?.key ?? "page_kind",
    op: spec?.operators[0]?.key ?? "is",
    value: spec ? defaultValue(spec.value, spec.options, kinds) : "post",
  };
}

export function newAction(
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
  key?: string,
): RuleAction {
  const spec =
    vocabulary.actions.find((a) => a.key === (key ?? "show")) ??
    vocabulary.actions[0];
  const action: RuleAction = { action: spec?.key ?? "show" };
  Object.entries(spec?.params ?? {}).forEach(([name, param]) => {
    action[name] =
      param.default ?? defaultValue(param.type, param.options, kinds);
  });
  return action;
}

export function newRule(
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
): Rule {
  return {
    id: newId(),
    name: "",
    enabled: false,
    frequency: "visit",
    rev: 0,
    attention: { enabled: false, title: "" },
    conditions: { all: [newCondition(vocabulary, kinds)] },
    actions: [newAction(vocabulary, kinds)],
  };
}

const WEEKDAYS = [
  __("Sunday", "wordsocket"),
  __("Monday", "wordsocket"),
  __("Tuesday", "wordsocket"),
  __("Wednesday", "wordsocket"),
  __("Thursday", "wordsocket"),
  __("Friday", "wordsocket"),
  __("Saturday", "wordsocket"),
];

export function weekdayName(day: number): string {
  return WEEKDAYS[day] ?? String(day);
}

/** A value in words, for the summary sentence. */
export function describeValue(
  type: ValueType,
  value: unknown,
  options: Record<string, string>,
  kinds: Record<string, string>,
): string {
  switch (type) {
    case "none":
      return "";
    case "boolean":
      return value ? __("yes", "wordsocket") : __("no", "wordsocket");
    case "select":
      return options[String(value)] ?? String(value ?? "");
    case "presentation": {
      const v = (value ?? {}) as { type?: string };
      return options[String(v.type ?? value)] ?? String(v.type ?? "");
    }
    case "kind":
      return kinds[String(value)] ?? String(value ?? "");
    case "hours": {
      const v = (value ?? {}) as { from?: number; to?: number };
      /* translators: 1: hour from, 2: hour to */
      return sprintf(
        __("%1$d:00 and %2$d:59", "wordsocket"),
        v.from ?? 0,
        v.to ?? 23,
      );
    }
    case "weekdays":
      return (Array.isArray(value) ? value : [])
        .map((d) => weekdayName(Number(d)))
        .join(", ");
    default:
      return String(value ?? "");
  }
}

function describeCondition(
  c: RuleCondition,
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
): string {
  const spec = vocabulary.conditions.find((s) => s.key === c.condition);
  if (!spec) return `${c.condition} ${c.op}`;
  // A lone operator is folded into the label ("Visitor is"), so it is not spoken twice.
  const op =
    spec.operators.length > 1
      ? spec.operators.find((o) => o.key === c.op)?.label ?? c.op
      : "";
  return [
    spec.label.toLowerCase(),
    op,
    describeValue(spec.value, c.value, spec.options, kinds),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A node in words; a nested group with more than one member is parenthesised, the top group never
 * is.
 */
function describeNode(
  node: RuleNode,
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
  nested = false,
): string {
  if (!isGroup(node)) return describeCondition(node, vocabulary, kinds);
  const list = node.all ?? node.any ?? [];
  const joiner = node.all
    ? __(" and ", "wordsocket")
    : __(" or ", "wordsocket");
  const inner = list
    .map((child) => describeNode(child, vocabulary, kinds, true))
    .join(joiner);
  return nested && list.length > 1 ? `(${inner})` : inner;
}

const EXCERPT = 60;

/** The first words of a prompt's text, for the summary sentence. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT
    ? `${flat.slice(0, EXCERPT - 1).trimEnd()}…`
    : flat;
}

/**
 * An action in words: its label, how it shows, the pattern by title (or id) or the text it shows
 * instead, and its delay. A param the action lacks is skipped, so an extension's action reads as
 * its label alone.
 */
function describeAction(
  a: RuleAction,
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
  patterns: PatternOption[],
): string {
  const spec = vocabulary.actions.find((s) => s.key === a.action);
  if (!spec) return a.action;
  const parts = [spec.label];
  const presentation = spec.params.presentation;
  if (presentation) {
    parts.push(
      describeValue(
        "presentation",
        a.presentation,
        presentation.options,
        kinds,
      ),
    );
    const shown = (a.presentation ?? {}) as { pattern?: number; text?: string };
    if (shown.pattern) {
      const title = patterns.find((p) => p.id === shown.pattern)?.title;
      parts.push(
        title
          ? /* translators: %s: the synced pattern's title */
            sprintf(__('with the pattern "%s"', "wordsocket"), title)
          : /* translators: %d: the synced pattern's id */
            sprintf(__("with pattern #%d", "wordsocket"), shown.pattern),
      );
    } else if (shown.text?.trim()) {
      /* translators: %s: the first words of the prompt's text */
      parts.push(sprintf(__('saying "%s"', "wordsocket"), excerpt(shown.text)));
    }
  }
  const after = Number(a.after);
  if (after > 0) {
    /* translators: %d: seconds */
    parts.push(sprintf(__("after %d s", "wordsocket"), after));
  }
  return parts.join(" ");
}

/**
 * "If page is Post and time on page while visible at least 30, then Show banner saying "Still
 * there?" after 20 s, flashing the tab title while hidden." The frequency is the card's badge, not
 * part of the sentence.
 */
export function summarize(
  rule: Rule,
  vocabulary: Vocabulary,
  kinds: Record<string, string>,
  patterns: PatternOption[] = [],
): string {
  const when = describeNode(rule.conditions as RuleGroup, vocabulary, kinds);
  const then =
    rule.actions
      .map((a) => describeAction(a, vocabulary, kinds, patterns))
      .join(", ") +
    (rule.attention?.enabled
      ? __(", flashing the tab title while hidden", "wordsocket")
      : "");
  /* translators: 1: the conditions in words, 2: the actions in words */
  return sprintf(__("If %1$s, then %2$s.", "wordsocket"), when, then);
}

/** The condition keys a rule names that the vocabulary lacks (a deactivated extension). */
export function unavailableKeys(rule: ListedRule): string[] {
  return rule.unavailable ?? [];
}
