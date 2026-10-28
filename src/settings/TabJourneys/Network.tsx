/*
 * "Where journeys go": a layered network. Columns are step positions plus the outcome, rows are page kinds,
 * a node's radius is the journeys through it, an edge's width the transitions along it. A journey lights
 * only while hovered, a dot with a trail running it from first step to outcome and bouncing each step it
 * passes; a node lights the edges the journeys through it took, each by how many of them took it.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "@wordpress/element";
import { IconButton, RadioGroupControl, Stack, Text } from "@wordpress/ui";
import { chevronLeft, chevronRight } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import { Choice } from "../TabRules/ValueControl";
import {
  ChartFrame,
  RowLabels,
  TableView,
  reducedMotion,
  useChart,
  type Tip,
} from "./chart";
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

type Focus =
  | { on: "node"; key: string }
  | { on: "journey"; index: number }
  | null;

/** Room before the first column, inside the drawing; the row labels sit outside it. */
const LEFT = 40;
const RIGHT = 150;
const TOP = 40;
const BOTTOM = 14;
const ROW_H = 58;
/** The narrowest a step column goes before the chart scrolls sideways. */
const MIN_COL_W = 60;
/** How long the pulse takes to cross one column, the distance between neighbouring steps. */
const STEP_MS = 75;
/** The edges lit while no node is hovered. */
const NO_EDGES = new Map<string, number>();

/** A run of edges as one continuous path: one `M`, then each curve, so a dash runs it unbroken. */
function joined(edges: NetEdge[]): string {
  return edges
    .map((e, k) => {
      const seg = curve(e.a, e.b);
      return k === 0 ? seg : seg.slice(seg.indexOf("C"));
    })
    .join("");
}

/** The trail behind the dot, in pixels along the path. */
const TRAIL_PX = 48;
/** How long a step bounces when the dot passes it. */
const BOUNCE_MS = 360;
const EDGE_MIN = [1, 2, 5, 10, 25, 50];
/** The fewest pages a journey must have opened, as the radio group offers them. */
const PAGE_MIN = [1, 2, 3, 5];
/** The select item that means no filter. */
const ANY = "*";

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
        <text
          key={c}
          x={LEFT + ((W - LEFT - RIGHT) * c) / columns}
          y={18}
          textAnchor="middle"
          className="is-strong"
        >
          {header(c)}
        </text>
      ))}
    </g>
  );
});

/** The transitions, as grey curves, the lit ones dark by how many of the focused node's journeys took them. */
const Edges = memo(function Edges({
  edges,
  maxEdge,
  lit,
}: {
  edges: NetEdge[];
  maxEdge: number;
  lit: Map<string, number>;
}) {
  const maxLit = Math.max(1, ...lit.values());
  return (
    <g>
      {edges.map((e) => {
        const on = lit.get(e.key);
        return (
          <path
            key={e.key}
            className={`wpsignal-net__edge${on ? " is-on" : ""}`}
            d={curve(e.a, e.b)}
            strokeWidth={1.2 + (6 * e.count) / maxEdge}
            strokeOpacity={0.07 + (0.28 * e.count) / maxEdge}
            style={
              on ? { strokeOpacity: 0.25 + (0.65 * on) / maxLit } : undefined
            }
          />
        );
      })}
    </g>
  );
});

/** One journey's path and what its tooltip says. */
interface JourneyPath {
  index: number;
  d: string;
  title: string;
  line: string;
}

/**
 * The journeys, invisible until one is hovered; re-rendered only when the layout changes.
 */
const Journeys = memo(function Journeys({
  items,
  tip,
  onFocus,
}: {
  items: JourneyPath[];
  tip: Tip;
  onFocus: (index: number | null) => void;
}) {
  return (
    <g>
      {items.map((j) => (
        <path
          key={j.index}
          className="wpsignal-net__journey"
          d={j.d}
          onMouseEnter={() => onFocus(j.index)}
          onMouseMove={(evt) => tip.show(evt, j.title, [j.line], true)}
          onMouseLeave={() => {
            onFocus(null);
            tip.hide();
          }}
        />
      ))}
    </g>
  );
});

/**
 * Where the network's page sits in the window's journeys.
 *
 * @since 0.31.0
 */
export interface Pager {
  /** The page shown, 1 the newest. */
  page: number;
  pages: number;
  /** Journeys to a page. */
  size: number;
  /** The days the page spans, as a label. */
  range: string;
  loading: boolean;
  error: boolean;
  onPage: (page: number) => void;
}

/** The count of journeys drawn, and the pager when the window holds more than one page. */
function Count({ shown, listed, total, pager }: { shown: number; listed: number; total: number; pager: Pager }) {
  const n = (v: number) => v.toLocaleString();
  const from = (pager.page - 1) * pager.size + 1;
  return (
    <Stack direction="row" gap="md" align="center" justify="space-between" wrap="wrap">
      <Text variant="body-sm" className="wpsignal-muted">
        {pager.error
          ? __("That page of journeys could not be loaded.", "wordsocket")
          : sprintf(
              /* translators: 1: journeys drawn, 2: journeys on this page */
              _n("Showing %1$s of %2$s journey.", "Showing %1$s of %2$s journeys.", listed, "wordsocket"),
              n(shown),
              n(listed),
            )}
      </Text>
      {pager.pages > 1 && (
        <Stack direction="row" gap="xs" align="center" className="wpsignal-net__pager">
          <IconButton
            variant="minimal"
            size="compact"
            tone="neutral"
            icon={chevronLeft}
            label={__("Newer journeys", "wordsocket")}
            disabled={pager.page <= 1 || pager.loading}
            onClick={() => pager.onPage(pager.page - 1)}
          />
          <Text variant="body-sm" className="wpsignal-muted" aria-live="polite">
            {sprintf(
              /* translators: 1: first journey on the page, 2: last journey on the page, 3: journeys in the window */
              __("%1$s\u2013%2$s of %3$s", "wordsocket"),
              n(from),
              n(Math.min(total, from + pager.size - 1)),
              n(total),
            ) + (pager.range ? ` \u00b7 ${pager.range}` : "")}
          </Text>
          <IconButton
            variant="minimal"
            size="compact"
            tone="neutral"
            icon={chevronRight}
            label={__("Older journeys", "wordsocket")}
            disabled={pager.page >= pager.pages || pager.loading}
            onClick={() => pager.onPage(pager.page + 1)}
          />
        </Stack>
      )}
    </Stack>
  );
}

/**
 * The network with its filters.
 *
 * @since 0.31.0
 */
export function Network({
  journeys,
  filters,
  onFilters,
  pager,
  total,
  outcomes,
  kinds,
}: {
  journeys: VisualJourney[];
  filters: NetworkFilters;
  onFilters: (filters: NetworkFilters) => void;
  pager: Pager;
  /** Journeys in the window, listed or not. */
  total: number;
  outcomes: Outcomes;
  kinds: Kinds;
}) {
  const { plotRef, tipRef, width, tip } = useChart();
  const [focus, setFocus] = useState<Focus>(null);
  const nodeEls = useRef(new Map<string, SVGCircleElement>());
  const pulse = useRef<SVGCircleElement>(null);
  const lit = useRef<SVGPathElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const measure = useRef<SVGPathElement>(null);

  const allKinds = useMemo(
    () =>
      orderKinds(journeys.flatMap((j) => j.steps.map((s) => s.kind))).filter(
        (k) => k !== "away",
      ),
    [journeys],
  );
  const shown = useMemo(
    () => applyFilters(journeys, filters),
    [journeys, filters],
  );
  const rows = useMemo(
    () =>
      orderKinds(
        shown.flatMap((j) =>
          j.steps.slice(0, NETWORK_STEPS).map((s) => s.kind),
        ),
      ),
    [shown],
  );
  const { columns } = columnsFor(shown);
  const W = Math.max(width, LEFT + RIGHT + MIN_COL_W * columns);
  const H = TOP + Math.max(1, rows.length) * ROW_H + BOTTOM;
  const layout = useMemo(
    () =>
      layoutNetwork(
        shown,
        {
          colX: (col) => LEFT + ((W - LEFT - RIGHT) * col) / columns,
          rowY: (kind) => TOP + rows.indexOf(kind) * ROW_H + ROW_H / 2,
          outcomeY: (_outcome, index, of) =>
            TOP + ((index + 0.5) * Math.max(1, rows.length) * ROW_H) / of,
        },
        rows,
        outcomes,
      ),
    [shown, rows, W, columns, outcomes],
  );
  const rMax = columns > 10 ? 18 : 22;
  const radius = (n: NetNode) =>
    Math.max(5, rMax * Math.sqrt(n.count / layout.maxNode));

  /* What the focus lights: the hovered journey, or the edges of every journey through the hovered node. */
  const litEdges = useMemo(() => {
    if (focus?.on !== "node") return NO_EDGES;
    const edges = new Map<string, number>();
    shown.forEach((j) => {
      const chain = layout.chains.get(j.index);
      if (!chain?.nodes.some((n) => n.key === focus.key)) return;
      chain.edges.forEach((e) => edges.set(e.key, (edges.get(e.key) ?? 0) + 1));
    });
    return edges;
  }, [focus, shown, layout]);
  const labels = useMemo(
    () =>
      new Map(
        shown.map((j) => [
          j.index,
          {
            title: `${stepCount(j.steps.length)} \u00b7 ${outcomeLabel(
              j.outcome,
              outcomes,
            ).toLowerCase()}`,
            line: describeSteps(j.steps, kinds),
          },
        ]),
      ),
    [shown, outcomes, kinds],
  );
  const items = useMemo<JourneyPath[]>(
    () =>
      shown.flatMap((j) => {
        const chain = layout.chains.get(j.index);
        const label = labels.get(j.index);
        if (!chain || chain.edges.length === 0 || !label) return [];
        return { index: j.index, d: joined(chain.edges), ...label };
      }),
    [shown, layout, labels],
  );
  const focusJourney = useCallback(
    (index: number | null) =>
      setFocus(index === null ? null : { on: "journey", index }),
    [],
  );

  /*
   * The hovered journey is drawn by one lit path (the journey paths themselves are wide, invisible
   * hit areas), and the pulse runs it from first step to outcome at a constant speed until the
   * pointer leaves: a dot, a trail behind it (a dash of the same path, offset to end at the dot),
   * and a bounce on each step as the dot reaches it.
   */
  useEffect(() => {
    const dot = pulse.current;
    const line = lit.current;
    const tail = trail.current;
    const ruler = measure.current;
    if (!dot || !line || !tail || !ruler) return undefined;
    const hide = () => {
      dot.setAttribute("opacity", "0");
      line.setAttribute("opacity", "0");
      tail.setAttribute("opacity", "0");
    };
    if (!focus || focus.on !== "journey") {
      hide();
      return undefined;
    }
    const chain = layout.chains.get(focus.index);
    if (!chain || chain.edges.length === 0) return undefined;
    const d = joined(chain.edges);
    line.setAttribute("d", d);
    line.setAttribute("opacity", "1");
    if (reducedMotion()) return () => hide();
    tail.setAttribute("d", d);
    const length = tail.getTotalLength();
    if (length === 0) return () => hide();
    /* Where each step sits along the path: the length of the curves before it. */
    const stops = chain.nodes.map((_, k) => {
      if (k === 0) return 0;
      ruler.setAttribute("d", joined(chain.edges.slice(0, k)));
      return ruler.getTotalLength();
    });
    tail.setAttribute("stroke-dasharray", `${TRAIL_PX} ${length}`);
    /* A constant speed: one column's width per STEP_MS, so a long hop to the outcome takes its time. */
    const speed = (W - LEFT - RIGHT) / columns / STEP_MS;
    const duration = length / speed;
    const started = performance.now();
    let frame = 0;
    let next = 0;
    let lap = 0;
    const bounce = (key: string) => {
      const el = nodeEls.current.get(key);
      if (!el) return;
      el.classList.remove("is-bounce");
      void el.getBoundingClientRect();
      el.classList.add("is-bounce");
      window.setTimeout(() => el.classList.remove("is-bounce"), BOUNCE_MS);
    };
    const tick = (now: number) => {
      /* A frame's timestamp can precede the effect's start: never run backwards. */
      const elapsed = Math.max(0, now - started);
      const thisLap = Math.floor(elapsed / duration);
      if (thisLap !== lap) {
        lap = thisLap;
        next = 0;
      }
      const pos = (elapsed % duration) * speed;
      while (next < stops.length && pos >= stops[next] - 0.5) {
        bounce(chain.nodes[next].key);
        next += 1;
      }
      const pt = tail.getPointAtLength(pos);
      dot.setAttribute("transform", `translate(${pt.x},${pt.y})`);
      dot.setAttribute("opacity", "1");
      tail.setAttribute("stroke-dashoffset", String(TRAIL_PX - pos));
      tail.setAttribute("opacity", "1");
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      hide();
    };
  }, [focus, layout, W, columns]);

  const longer = layout.longer;
  const header = useMemo(
    () => (c: number) => {
      if (c === columns) return __("Outcome", "wordsocket");
      const more = c === columns - 1 && longer ? "+" : "";
      /* translators: %s: a step number */
      if (columns <= 10)
        return sprintf(__("Step %s", "wordsocket"), `${c + 1}${more}`);
      return c === 0
        ? sprintf(__("Step %s", "wordsocket"), "1")
        : `${c + 1}${more}`;
    },
    [columns, longer],
  );
  const nodeTitle = (n: NetNode) =>
    n.col === columns
      ? outcomeLabel(n.kind, outcomes)
      : /* translators: 1: the step number, 2: the page kind */
        sprintf(
          __("Step %1$d \u00b7 %2$s", "wordsocket"),
          n.col + 1,
          kindLabel(n.kind, kinds),
        );
  const nodeLine = (n: NetNode) =>
    sprintf(
      /* translators: 1: journeys through this node, 2: how many of them ended well */
      _n(
        "%1$d journey through here, %2$d ended well",
        "%1$d journeys through here, %2$d ended well",
        n.count,
        "wordsocket",
      ),
      n.count,
      n.won,
    );

  return (
    <Stack direction="column" gap="sm" className={pager.loading ? "is-loading" : undefined}>
      <Stack
        direction="row"
        gap="lg"
        wrap="wrap"
        align="end"
        className="wpsignal-chart__filters"
      >
        <Choice
          label={__("Outcome", "wordsocket")}
          value={filters.outcome || ANY}
          options={[
            { value: ANY, label: __("All", "wordsocket") },
            ...outcomeKeys(outcomes, journeys).map((o) => ({
              value: o,
              label: outcomeLabel(o, outcomes),
            })),
          ]}
          onChange={(value) =>
            onFilters({ ...filters, outcome: value === ANY ? "" : value })
          }
        />
        <Choice
          label={__("Passed through", "wordsocket")}
          value={filters.through || ANY}
          options={[
            { value: ANY, label: __("Any page", "wordsocket") },
            ...allKinds.map((k) => ({ value: k, label: kindLabel(k, kinds) })),
          ]}
          onChange={(value) =>
            onFilters({ ...filters, through: value === ANY ? "" : value })
          }
        />
        <Choice
          label={__("Paths taken by at least", "wordsocket")}
          value={String(filters.min)}
          options={EDGE_MIN.map((n) => ({
            value: String(n),
            label:
              n === 1
                ? __("1 journey (every path)", "wordsocket")
                : /* translators: %d: journeys */ sprintf(
                    __("%d journeys", "wordsocket"),
                    n,
                  ),
          }))}
          onChange={(value) =>
            onFilters({ ...filters, min: Number(value) || 1 })
          }
        />
      </Stack>
      <RadioGroupControl
        className="wpsignal-chart__radios"
        label={__("Pages opened", "wordsocket")}
        value={String(filters.pages)}
        onValueChange={(value) =>
          onFilters({ ...filters, pages: Number(value) || 1 })
        }
        items={PAGE_MIN.map((n) => ({
          value: String(n),
          label:
            n === 1
              ? __("Any number", "wordsocket")
              : /* translators: %d: pages */ sprintf(
                  __("%d or more", "wordsocket"),
                  n,
                ),
        }))}
      />
      <Count shown={shown.length} listed={journeys.length} total={total} pager={pager} />
      {shown.length === 0 ? (
        <Text variant="body-sm" className="wpsignal-muted">
          {__("No journeys match.", "wordsocket")}
        </Text>
      ) : (
        <ChartFrame
          plotRef={plotRef}
          tipRef={tipRef}
          labels={
            <RowLabels
              className="wpsignal-net__labels"
              labels={rows.map((kind) => kindLabel(kind, kinds))}
              vars={{
                "--wpsignal-top": `${TOP}px`,
                "--wpsignal-row": `${ROW_H}px`,
                "--wpsignal-rows": rows.length,
              }}
            />
          }
          table={
            <TableView
              head={[
                __("Step", "wordsocket"),
                __("Page", "wordsocket"),
                __("Journeys", "wordsocket"),
                __("Ended well", "wordsocket"),
              ]}
              rows={[...layout.nodes]
                .sort((a, b) => a.col - b.col || b.count - a.count)
                .map((n) => [
                  n.col === columns
                    ? __("Outcome", "wordsocket")
                    : String(n.col + 1),
                  n.col === columns
                    ? outcomeLabel(n.kind, outcomes)
                    : kindLabel(n.kind, kinds),
                  n.count,
                  n.won,
                ])}
            />
          }
        >
          <svg
            className="wpsignal-net"
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={__(
              "Journeys as paths through a network of step positions and page kinds, ending in their outcome",
              "wordsocket",
            )}
          >
            <Headers columns={columns} W={W} header={header} />
            <Edges
              edges={layout.edges}
              maxEdge={layout.maxEdge}
              lit={litEdges}
            />
            <Journeys items={items} tip={tip} onFocus={focusJourney} />
            <path ref={measure} className="wpsignal-net__ruler" />
            <path ref={lit} className="wpsignal-net__lit" opacity={0} />
            <path ref={trail} className="wpsignal-net__trail" opacity={0} />
            <circle
              ref={pulse}
              className="wpsignal-net__pulse"
              r={2.5}
              opacity={0}
            />
            <g>
              {layout.nodes.map((n) => (
                <g key={n.key}>
                  <circle
                    ref={(el) => {
                      if (el) nodeEls.current.set(n.key, el);
                      else nodeEls.current.delete(n.key);
                    }}
                    className="wpsignal-net__node"
                    cx={n.x}
                    cy={n.y}
                    r={radius(n)}
                    fill={
                      n.col === columns
                        ? outcomeColor(n.kind, outcomes)
                        : kindColor(n.kind)
                    }
                    onMouseEnter={() => setFocus({ on: "node", key: n.key })}
                    onMouseMove={(evt) =>
                      tip.show(evt, nodeTitle(n), [nodeLine(n)])
                    }
                    onMouseLeave={() => {
                      setFocus(null);
                      tip.hide();
                    }}
                  />
                  {n.col === columns && (
                    <text
                      x={n.x + radius(n) + 10}
                      y={n.y}
                      dy="0.35em"
                      className="is-strong"
                    >
                      {`${outcomeLabel(n.kind, outcomes)} ${n.count}`}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        </ChartFrame>
      )}
    </Stack>
  );
}
