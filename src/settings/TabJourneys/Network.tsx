/*
 * "Where journeys go": a layered network. Columns are step positions plus the outcome, rows are page kinds,
 * a node's radius is the journeys through it, an edge's width the transitions along it. A journey lights
 * only while hovered, a pulse running it from first step to outcome; a node lights every journey through it.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { memo, useEffect, useMemo, useRef, useState } from "@wordpress/element";
import { Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { Choice } from "../TabRules/ValueControl";
import { ChartFrame, RowLabels, TableView, labelColumnWidth, reducedMotion, useChart } from "./chart";
import {
  applyFilters,
  columnsFor,
  curve,
  describeSteps,
  kindColor,
  kindLabel,
  layoutNetwork,
  NETWORK_STEPS,
  orderKinds,
  outcomeColor,
  outcomeKeys,
  outcomeLabel,
  stepCount,
  type Kinds,
  type NetEdge,
  type NetNode,
  type NetworkFilters,
  type Outcomes,
  type VisualJourney,
} from "./journeys";

type Focus = { on: "node"; key: string } | { on: "journey"; index: number } | null;

/** Room before the first column, inside the drawing; the row labels sit outside it. */
const LEFT = 40;
const RIGHT = 150;
const TOP = 40;
const BOTTOM = 14;
const ROW_H = 58;
/** The narrowest a step column goes before the chart scrolls sideways. */
const MIN_COL_W = 60;
/** Pixels the pulse travels per millisecond. */
const PULSE_SPEED = 0.4;
const PULSE_MIN_MS = 1600;
const EDGE_MIN = [1, 2, 5, 10, 25, 50];
/** The select item that means no filter. */
const ANY = "*";

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The column headers; re-rendered only when the layout changes. */
const Headers = memo(function Headers({
  columns,
  W,
  header,
}: {
  columns: number;
  W: number;
  header: (c: number) => string;
}) {
  return (
    <g>
      {Array.from({ length: columns + 1 }, (_, c) => (
        <text key={c} x={LEFT + ((W - LEFT - RIGHT) * c) / columns} y={18} textAnchor="middle" className="is-strong">
          {header(c)}
        </text>
      ))}
    </g>
  );
});

/** The transitions, as grey curves; re-rendered only when the layout changes. */
const Edges = memo(function Edges({ edges, maxEdge }: { edges: NetEdge[]; maxEdge: number }) {
  return (
    <g>
      {edges.map((e) => (
        <path
          key={e.key}
          className="wpsignal-net__edge"
          d={curve(e.a, e.b)}
          strokeWidth={1.2 + (6 * e.count) / maxEdge}
          strokeOpacity={0.07 + (0.28 * e.count) / maxEdge}
        />
      ))}
    </g>
  );
});

/**
 * The network with its filters and count line.
 *
 * @since 0.31.0
 */
export function Network({
  journeys,
  filters,
  onFilters,
  total,
  outcomes,
  kinds,
}: {
  journeys: VisualJourney[];
  filters: NetworkFilters;
  onFilters: (filters: NetworkFilters) => void;
  /** Journeys in the window, listed or not. */
  total: number;
  outcomes: Outcomes;
  kinds: Kinds;
}) {
  const { frameRef, tipRef, width, tip } = useChart();
  const [focus, setFocus] = useState<Focus>(null);
  const paths = useRef(new Map<number, SVGPathElement>());
  const pulse = useRef<SVGCircleElement>(null);

  const allKinds = useMemo(
    () => orderKinds(journeys.flatMap((j) => j.steps.map((s) => s.kind))).filter((k) => k !== "away"),
    [journeys],
  );
  const shown = useMemo(() => applyFilters(journeys, filters), [journeys, filters]);
  const rows = useMemo(
    () => orderKinds(shown.flatMap((j) => j.steps.slice(0, NETWORK_STEPS).map((s) => s.kind))),
    [shown],
  );
  const { columns } = columnsFor(shown);
  const rowLabels = rows.map((kind, i) => ({ y: TOP + i * ROW_H + ROW_H / 2, text: kindLabel(kind, kinds) }));
  const labelW = labelColumnWidth(rowLabels.map((l) => l.text));
  const W = Math.max(width - labelW, LEFT + RIGHT + MIN_COL_W * columns);
  const H = TOP + Math.max(1, rows.length) * ROW_H + BOTTOM;
  const layout = useMemo(
    () =>
      layoutNetwork(
        shown,
        {
          colX: (col) => LEFT + ((W - LEFT - RIGHT) * col) / columns,
          rowY: (kind) => TOP + rows.indexOf(kind) * ROW_H + ROW_H / 2,
          outcomeY: (_outcome, index, of) => TOP + ((index + 0.5) * Math.max(1, rows.length) * ROW_H) / of,
        },
        rows,
        outcomes,
      ),
    [shown, rows, W, columns, outcomes],
  );
  const rMax = columns > 10 ? 18 : 22;
  const radius = (n: NetNode) => Math.max(5, rMax * Math.sqrt(n.count / layout.maxNode));

  /* Which journeys are lit, each fainter the more there are. */
  const lit = useMemo(() => {
    if (!focus) return { set: new Set<number>(), opacity: 0.9 };
    if (focus.on === "journey") return { set: new Set([focus.index]), opacity: 0.9 };
    const through = shown
      .filter((j) => layout.chains.get(j.index)?.nodes.some((n) => n.key === focus.key))
      .map((j) => j.index);
    return {
      set: new Set(through),
      opacity: Math.max(0.1, Math.min(0.9, 2.8 / Math.sqrt(Math.max(1, through.length)))),
    };
  }, [focus, shown, layout]);

  /* The pulse runs the lit journey from first step to outcome at a constant speed until the pointer leaves. */
  useEffect(() => {
    const dot = pulse.current;
    if (!dot) return undefined;
    if (!focus || focus.on !== "journey" || reducedMotion()) {
      dot.setAttribute("opacity", "0");
      return undefined;
    }
    const path = paths.current.get(focus.index);
    if (!path) return undefined;
    const length = path.getTotalLength();
    if (length === 0) return undefined;
    const duration = Math.max(PULSE_MIN_MS, length / PULSE_SPEED);
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = easeInOut(((now - started) % duration) / duration);
      const pt = path.getPointAtLength(t * length);
      dot.setAttribute("transform", `translate(${pt.x},${pt.y})`);
      dot.setAttribute("opacity", "1");
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      dot.setAttribute("opacity", "0");
    };
  }, [focus]);

  const hovered = focus?.on === "journey" ? shown.find((j) => j.index === focus.index) : undefined;
  const count =
    shown.length === journeys.length
      ? /* translators: %d: how many journeys the network draws */
        sprintf(_n("All %d journeys", "All %d journeys", journeys.length, "wordsocket"), journeys.length)
      : /* translators: 1: journeys the filters keep, 2: journeys loaded */
        sprintf(__("%1$d of %2$d journeys", "wordsocket"), shown.length, journeys.length);
  const cap =
    total > journeys.length
      ? " " +
        /* translators: 1: journeys loaded, 2: journeys in the window */
        sprintf(__("(the newest %1$d of %2$d in the last 28 days)", "wordsocket"), journeys.length, total)
      : "";
  const note = hovered
    ? `${stepCount(hovered.steps.length)} \u00b7 ${describeSteps(hovered.steps, kinds)} \u00b7 ${outcomeLabel(hovered.outcome, outcomes).toLowerCase()}`
    : count + cap;

  const longer = layout.longer;
  const header = useMemo(
    () => (c: number) => {
      if (c === columns) return __("Outcome", "wordsocket");
      const more = c === columns - 1 && longer ? "+" : "";
      /* translators: %s: a step number */
      if (columns <= 10) return sprintf(__("Step %s", "wordsocket"), `${c + 1}${more}`);
      return c === 0 ? sprintf(__("Step %s", "wordsocket"), "1") : `${c + 1}${more}`;
    },
    [columns, longer],
  );
  const nodeTitle = (n: NetNode) =>
    n.col === columns
      ? outcomeLabel(n.kind, outcomes)
      : /* translators: 1: the step number, 2: the page kind */
        sprintf(__("Step %1$d \u00b7 %2$s", "wordsocket"), n.col + 1, kindLabel(n.kind, kinds));
  const nodeLine = (n: NetNode) =>
    sprintf(
      /* translators: 1: journeys through this node, 2: how many of them ended well */
      _n("%1$d journey through here, %2$d ended well", "%1$d journeys through here, %2$d ended well", n.count, "wordsocket"),
      n.count,
      n.won,
    );

  return (
    <Stack direction="column" gap="sm">
      <Stack direction="row" gap="lg" wrap="wrap" align="end" justify="stretch" className="wpsignal-chart__filters">
        <Choice
          style={{ width: "100%" }}
          label={__("Outcome", "wordsocket")}
          value={filters.outcome || ANY}
          options={[
            { value: ANY, label: __("All", "wordsocket") },
            ...outcomeKeys(outcomes, journeys).map((o) => ({ value: o, label: outcomeLabel(o, outcomes) })),
          ]}
          onChange={(value) => onFilters({ ...filters, outcome: value === ANY ? "" : value })}
        />
        <Choice
          label={__("Passed through", "wordsocket")}
          value={filters.through || ANY}
          options={[
            { value: ANY, label: __("Any page", "wordsocket") },
            ...allKinds.map((k) => ({ value: k, label: kindLabel(k, kinds) })),
          ]}
          onChange={(value) => onFilters({ ...filters, through: value === ANY ? "" : value })}
        />
        <Choice
          label={__("Least journeys per edge", "wordsocket")}
          value={String(filters.min)}
          options={EDGE_MIN.map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(value) => onFilters({ ...filters, min: Number(value) || 1 })}
        />
      </Stack>
      <Text variant="body-sm" className="wpsignal-muted wpsignal-chart__note" render={<p aria-live="polite" />}>
        {note}
      </Text>
      {shown.length === 0 ? (
        <Text variant="body-sm" className="wpsignal-muted">
          {__("No journeys match.", "wordsocket")}
        </Text>
      ) : (
        <ChartFrame frameRef={frameRef} tipRef={tipRef}>
          <RowLabels labels={rowLabels} width={labelW} height={H} />
          <svg
            className={`wpsignal-net${focus ? " is-focus" : ""}`}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={__("Journeys as paths through a network of step positions and page kinds, ending in their outcome", "wordsocket")}
          >
            <Headers columns={columns} W={W} header={header} />
            <Edges edges={layout.edges} maxEdge={layout.maxEdge} />
            <g>
              {shown.map((j) => {
                const chain = layout.chains.get(j.index);
                if (!chain || chain.edges.length === 0) return null;
                const on = lit.set.has(j.index);
                return (
                  <path
                    key={j.index}
                    ref={(el) => {
                      if (el) paths.current.set(j.index, el);
                      else paths.current.delete(j.index);
                    }}
                    className={`wpsignal-net__journey${on ? " is-on" : ""}`}
                    style={on ? { opacity: lit.opacity } : undefined}
                    d={chain.edges.map((e) => curve(e.a, e.b)).join("")}
                    onMouseEnter={() => setFocus({ on: "journey", index: j.index })}
                    onMouseMove={(evt) =>
                      tip.show(
                        evt,
                        `${stepCount(j.steps.length)} \u00b7 ${outcomeLabel(j.outcome, outcomes).toLowerCase()}`,
                        [describeSteps(j.steps, kinds)],
                        true,
                      )
                    }
                    onMouseLeave={() => {
                      setFocus(null);
                      tip.hide();
                    }}
                  />
                );
              })}
            </g>
            <circle ref={pulse} className="wpsignal-net__pulse" r={6} opacity={0} />
            <g>
              {layout.nodes.map((n) => (
                <g key={n.key}>
                  <circle
                    className="wpsignal-net__node"
                    cx={n.x}
                    cy={n.y}
                    r={radius(n)}
                    fill={n.col === columns ? outcomeColor(n.kind, outcomes) : kindColor(n.kind)}
                    onMouseEnter={() => setFocus({ on: "node", key: n.key })}
                    onMouseMove={(evt) => tip.show(evt, nodeTitle(n), [nodeLine(n)])}
                    onMouseLeave={() => {
                      setFocus(null);
                      tip.hide();
                    }}
                  />
                  {n.col === columns && (
                    <text x={n.x + radius(n) + 10} y={n.y} dy="0.35em" className="is-strong">
                      {`${outcomeLabel(n.kind, outcomes)} ${n.count}`}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        </ChartFrame>
      )}
      <TableView
        caption={__("Journeys through each step position and page kind", "wordsocket")}
        head={[__("Step", "wordsocket"), __("Page", "wordsocket"), __("Journeys", "wordsocket"), __("Ended well", "wordsocket")]}
        rows={[...layout.nodes]
          .sort((a, b) => a.col - b.col || b.count - a.count)
          .map((n) => [
            n.col === columns ? __("Outcome", "wordsocket") : String(n.col + 1),
            n.col === columns ? outcomeLabel(n.kind, outcomes) : kindLabel(n.kind, kinds),
            n.count,
            n.won,
          ])}
      />
    </Stack>
  );
}
