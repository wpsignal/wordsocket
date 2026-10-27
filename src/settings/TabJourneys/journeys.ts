/*
 * The journey visuals' shared pieces: `kind:id:ms` journeys parsed, the page kinds with their labels and
 * colours, the outcomes as the site registered them, the network's filters and its step-position layout,
 * and the small number helpers the charts share.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import type { JourneyRow, JourneyVisuals } from "../types";

/**
 * An outcome key as the site registered it: `open`, `left`, or an extension's.
 *
 * @since 0.31.0
 */
export type Outcome = string;

/**
 * The outcomes a site knows, keyed, in registration order.
 *
 * @since 0.31.0
 */
export type Outcomes = JourneyVisuals["outcomes"];

/**
 * Page kind labels by key.
 *
 * @since 0.31.0
 */
export type Kinds = Record<string, string>;

/**
 * @since 0.31.0
 */
export interface Step {
  kind: string;
  id: number;
  ms: number;
}

/**
 * One journey as the visuals route lists it, parsed.
 *
 * @since 0.31.0
 */
export interface VisualJourney {
  index: number;
  steps: Step[];
  outcome: Outcome;
  hasRef: boolean;
  value: number;
  /** Its day in the window, 0 the oldest, -1 outside. */
  day: number;
  /** Minute of its local day. */
  minute: number;
  startedAt: string;
}

/**
 * The step positions the network draws; a longer journey jumps to its outcome from the last one.
 *
 * @since 0.31.0
 */
export const NETWORK_STEPS = 12;

/** The page kinds in row order; any other kind follows, alphabetically. */
const KIND_ORDER = [
  "home",
  "shop",
  "category",
  "product",
  "cart",
  "checkout",
  "thanks",
  "search",
  "page",
  "post",
  "archive",
  "other",
  "admin",
  "away",
];

/* The eight categorical hues by page kind; every other kind and an unregistered outcome are grey. */
const KIND_COLOR: Record<string, string> = {
  home: "#2a78d6",
  category: "#eb6834",
  product: "#1baf7a",
  cart: "#eda100",
  checkout: "#e87ba4",
  thanks: "#008300",
  shop: "#6250d6",
  page: "#e34948",
  post: "#6250d6",
  away: "#b8b6ac",
};
const GREY = "#8c8f94";

/**
 * The hue of a step kind.
 *
 * @since 0.31.0
 */
export function kindColor(kind: string): string {
  return KIND_COLOR[kind] ?? GREY;
}

/**
 * The hue of an outcome, grey for one the site never registered.
 *
 * @since 0.31.0
 */
export function outcomeColor(outcome: Outcome, outcomes: Outcomes): string {
  return outcomes[outcome]?.color ?? GREY;
}

/**
 * An outcome as a word, its key when the site never registered it.
 *
 * @since 0.31.0
 */
export function outcomeLabel(outcome: Outcome, outcomes: Outcomes): string {
  return outcomes[outcome]?.label || outcome;
}

/**
 * The outcome keys in order: the registered ones, then any the journeys carry.
 *
 * @since 0.31.0
 */
export function outcomeKeys(outcomes: Outcomes, journeys: VisualJourney[]): Outcome[] {
  const keys = Object.keys(outcomes);
  journeys.forEach((j) => {
    if (!keys.includes(j.outcome)) keys.push(j.outcome);
  });
  return keys;
}

/**
 * A step kind as a word: the site's label, "Away", or the key with its underscores as spaces.
 *
 * @since 0.31.0
 */
export function kindLabel(kind: string, kinds: Kinds): string {
  if (kind === "away") return __("Away", "wordsocket");
  if (kinds[kind]) return kinds[kind];
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The kinds in row order: the known ones first as listed, the rest alphabetically.
 *
 * @since 0.31.0
 */
export function orderKinds(kinds: Iterable<string>): string[] {
  const set = new Set(kinds);
  const known = KIND_ORDER.filter((k) => set.has(k));
  const rest = [...set].filter((k) => !KIND_ORDER.includes(k)).sort();
  return [...known, ...rest];
}

/**
 * `kind:id:ms` steps joined by `>`, parsed; a malformed step is skipped.
 *
 * @since 0.31.0
 */
export function parseJourney(raw: string): Step[] {
  if (!raw) return [];
  const steps: Step[] = [];
  for (const part of raw.split(">")) {
    const [kind, id, ms] = part.split(":");
    if (!kind || !/^[a-z_]+$/.test(kind)) continue;
    steps.push({ kind, id: Number(id) || 0, ms: Math.max(0, Number(ms) || 0) });
  }
  return steps;
}

/**
 * The route's journeys, parsed, in the order given (newest first).
 *
 * @since 0.31.0
 */
export function parseJourneys(rows: JourneyRow[]): VisualJourney[] {
  return rows.map((row, index) => ({
    index,
    steps: parseJourney(row.journey),
    outcome: row.outcome || "open",
    hasRef: Boolean(row.has_ref),
    value: Number(row.value) || 0,
    day: Number.isInteger(row.day) ? row.day : -1,
    minute: Number(row.minute) || 0,
    startedAt: row.started_at,
  }));
}

/**
 * @since 0.31.0
 */
export interface NetworkFilters {
  /** An outcome, or every outcome. */
  outcome: Outcome | "";
  /** A kind the journey must pass through, or any. */
  through: string;
  /** The least journeys a transition needs for its journeys to be drawn. */
  min: number;
  /** The fewest pages a journey must have opened to be drawn. */
  pages: number;
}

/**
 * @since 0.31.0
 */
export const DEFAULT_FILTERS: NetworkFilters = { outcome: "", through: "", min: 1, pages: 1 };

/** The transitions a journey makes, keyed by step position, as the network draws them. */
function edgeKeys(j: VisualJourney): string[] {
  const steps = j.steps.slice(0, NETWORK_STEPS);
  return steps.map((s, i) => `${i}:${s.kind}>${steps[i + 1] ? steps[i + 1].kind : `out:${j.outcome}`}`);
}

/**
 * The journeys the filters keep.
 *
 * @since 0.31.0
 */
export function applyFilters(journeys: VisualJourney[], f: NetworkFilters): VisualJourney[] {
  let shown = journeys.filter(
    (j) =>
      (!f.outcome || j.outcome === f.outcome) &&
      (!f.through || j.steps.some((s) => s.kind === f.through)) &&
      (f.pages <= 1 || j.steps.filter((s) => s.kind !== "away").length >= f.pages),
  );
  if (f.min > 1) {
    const keys = new Map(shown.map((j) => [j.index, edgeKeys(j)]));
    const counts = new Map<string, number>();
    keys.forEach((list) => list.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1)));
    shown = shown.filter((j) => (keys.get(j.index) ?? []).every((k) => (counts.get(k) ?? 0) >= f.min));
  }
  return shown;
}

/**
 * @since 0.31.0
 */
export interface NetNode {
  key: string;
  /** The step position, or `columns` for an outcome. */
  col: number;
  kind: string;
  count: number;
  /** Journeys through here that ended in an outcome other than `open` or `left`. */
  won: number;
  x: number;
  y: number;
}

/**
 * @since 0.31.0
 */
export interface NetEdge {
  key: string;
  a: NetNode;
  b: NetNode;
  count: number;
}

/**
 * @since 0.31.0
 */
export interface NetLayout {
  /** Step positions drawn. */
  columns: number;
  /** Whether a journey ran past the last column. */
  longer: boolean;
  rows: string[];
  nodes: NetNode[];
  edges: NetEdge[];
  maxEdge: number;
  maxNode: number;
  /** Each journey's nodes and edges, by its index in the input. */
  chains: Map<number, { nodes: NetNode[]; edges: NetEdge[] }>;
}

/**
 * @since 0.31.0
 */
export interface NetGeometry {
  colX: (col: number) => number;
  rowY: (kind: string) => number;
  outcomeY: (outcome: Outcome, index: number, of: number) => number;
}

/**
 * Whether an outcome is a win for the site: anything an extension registered beyond open and left.
 *
 * @since 0.31.0
 */
export function isWin(outcome: Outcome): boolean {
  return outcome !== "open" && outcome !== "left";
}

/**
 * The step columns the network draws for these journeys, and whether any journey runs past them.
 *
 * @since 0.31.0
 */
export function columnsFor(journeys: VisualJourney[]): { columns: number; longer: boolean } {
  const longest = journeys.reduce((n, j) => Math.max(n, j.steps.length), 0);
  return { columns: Math.min(NETWORK_STEPS, Math.max(1, longest)), longer: longest > NETWORK_STEPS };
}

/**
 * Aggregate journeys into one node per step position and kind, an edge per transition, plus each journey's
 * chain through them.
 *
 * @since 0.31.0
 */
export function layoutNetwork(journeys: VisualJourney[], geometry: NetGeometry, rows: string[], known: Outcomes): NetLayout {
  const { columns, longer } = columnsFor(journeys);
  const outcomes = outcomeKeys(known, journeys).filter((o) => journeys.some((j) => j.outcome === o));
  const nodes = new Map<string, NetNode>();
  const edges = new Map<string, NetEdge>();
  const nodeAt = (col: number, kind: string): NetNode => {
    const key = `${col}:${kind}`;
    let node = nodes.get(key);
    if (!node) {
      const y = col === columns ? geometry.outcomeY(kind, outcomes.indexOf(kind), outcomes.length) : geometry.rowY(kind);
      node = { key, col, kind, count: 0, won: 0, x: geometry.colX(col), y };
      nodes.set(key, node);
    }
    return node;
  };
  const link = (a: NetNode, b: NetNode): NetEdge => {
    const key = `${a.key}>${b.key}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = { key, a, b, count: 0 };
      edges.set(key, edge);
    }
    edge.count += 1;
    return edge;
  };
  const chains = new Map<number, { nodes: NetNode[]; edges: NetEdge[] }>();
  journeys.forEach((j) => {
    const chain = j.steps.slice(0, columns).map((s, i) => nodeAt(i, s.kind));
    chain.push(nodeAt(columns, j.outcome));
    chain.forEach((n) => {
      n.count += 1;
      if (isWin(j.outcome)) n.won += 1;
    });
    chains.set(j.index, { nodes: chain, edges: chain.slice(1).map((b, i) => link(chain[i], b)) });
  });
  const all = [...nodes.values()];
  const allEdges = [...edges.values()];
  return {
    columns,
    longer,
    rows,
    nodes: all,
    edges: allEdges,
    maxEdge: allEdges.reduce((n, e) => Math.max(n, e.count), 1),
    maxNode: all.reduce((n, node) => Math.max(n, node.count), 1),
    chains,
  };
}

/**
 * A cubic curve from one node to the next.
 *
 * @since 0.31.0
 */
export function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  return `M${a.x},${a.y}C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
}

/**
 * Milliseconds as "48 s", "2.5 min" or "1.2 h".
 *
 * @since 0.31.0
 */
export function duration(ms: number): string {
  /* translators: %s: hours, one decimal */
  if (ms >= 3_600_000) return sprintf(__("%s h", "wordsocket"), (ms / 3_600_000).toFixed(1));
  /* translators: %s: minutes, one decimal */
  if (ms >= 60_000) return sprintf(__("%s min", "wordsocket"), (ms / 60_000).toFixed(1));
  /* translators: %s: seconds */
  return sprintf(__("%s s", "wordsocket"), (ms / 1000).toFixed(ms < 10_000 ? 1 : 0));
}

/**
 * A journey's steps as one line: "home › product 1927 2.1 min › cart 48 s".
 *
 * @since 0.31.0
 */
export function describeSteps(steps: Step[], kinds: Kinds): string {
  return steps.map((s) => `${kindLabel(s.kind, kinds).toLowerCase()}${s.id ? ` ${s.id}` : ""} ${duration(s.ms)}`).join(" › ");
}

/**
 * "3 steps".
 *
 * @since 0.31.0
 */
export function stepCount(n: number): string {
  /* translators: %d: how many steps a journey has */
  return sprintf(_n("%d step", "%d steps", n, "wordsocket"), n);
}

/**
 * Clean axis ticks from zero to at least `max`, about `count` of them.
 *
 * @since 0.31.0
 */
export function ticks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * The mean of the last `width` values up to each index.
 *
 * @since 0.31.0
 */
export function rolling(values: number[], width: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - width + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

/**
 * The median, 0 of nothing.
 *
 * @since 0.31.0
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
