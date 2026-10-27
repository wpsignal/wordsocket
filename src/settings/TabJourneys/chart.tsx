/*
 * Pieces every visual shares: the Chart and Table tabs, the tooltip the marks drive, the plot's width and
 * weekday names.
 */

/**
 * WordPress dependencies.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import {
  DataViews,
  filterSortAndPaginate,
  type Field,
  type View,
} from "@wordpress/dataviews";
import { Tabs } from "@wordpress/ui";

/**
 * External dependencies.
 */
import type { CSSProperties, ReactNode, RefObject } from "react";

/**
 * A pointer position, as a mouse event carries it.
 *
 * @since 0.31.0
 */
export interface Pointer {
  clientX: number;
  clientY: number;
}

/**
 * The tooltip of one chart: shown at the pointer with a title and lines, hidden on leave.
 *
 * @since 0.31.0
 */
export interface Tip {
  show(at: Pointer, title: string, lines: string[], wide?: boolean): void;
  hide(): void;
}

/**
 * The plot's ref callback and its current width (measured once per animation frame, following the
 * element through the Chart tab's unmounts), the tooltip's ref, and the tooltip, one object for the hook's
 * life, which writes the DOM itself.
 *
 * @since 0.31.0
 */
export function useChart(fallback = 900) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef(0);

  const plotRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    cancelAnimationFrame(frame.current);
    if (!el) return;
    const measure = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const next = el.clientWidth;
        if (next > 0)
          setWidth((current) => (current === next ? current : next));
      });
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const tip = useMemo<Tip>(() => {
    /* What the tooltip shows and its measured size, so a move with the same content only repositions it. */
    let shown = "";
    let w = 0;
    let h = 0;
    return {
      show(at, title, lines, wide = false) {
        const el = tipRef.current;
        if (!el) return;
        const key = `${wide ? 1 : 0}\n${title}\n${lines.join("\n")}`;
        if (key !== shown || !el.classList.contains("is-shown")) {
          const strong = document.createElement("strong");
          strong.textContent = title;
          el.replaceChildren(
            strong,
            ...lines.map((line) => {
              const span = document.createElement("span");
              span.textContent = line;
              return span;
            }),
          );
          el.classList.toggle("is-wide", wide);
          el.classList.add("is-shown");
          ({ width: w, height: h } = el.getBoundingClientRect());
          shown = key;
        }
        const margin = 8;
        const x = Math.min(
          window.innerWidth - w / 2 - margin,
          Math.max(w / 2 + margin, at.clientX),
        );
        const below = at.clientY - h - 10 < margin;
        el.classList.toggle("is-below", below);
        el.style.left = `${x}px`;
        el.style.top = `${at.clientY}px`;
      },
      hide() {
        tipRef.current?.classList.remove("is-shown");
      },
    };
  }, []);
  return { plotRef, tipRef, width, tip };
}

/**
 * The row labels beside a drawing, pinned to the left while it scrolls sideways: a grid whose rows the
 * chart names through custom properties (`--wpsignal-top`, `--wpsignal-row`, `--wpsignal-rows`), so each
 * label falls into its row and the column takes the width its longest label needs.
 *
 * @since 0.31.0
 */
export function RowLabels({
  labels,
  className,
  vars,
}: {
  labels: string[];
  className: string;
  vars: Record<string, string | number>;
}) {
  return (
    <div
      className={`wpsignal-chart__labels ${className}`}
      style={vars as CSSProperties}
      aria-hidden="true"
    >
      {labels.map((label, i) => (
        <span key={`${i}:${label}`}>{label}</span>
      ))}
    </div>
  );
}

/**
 * A visual's two tabs: the chart (the row labels, the plot measured for the drawing's width, the tooltip)
 * and its figures as a table.
 *
 * @since 0.31.0
 */
export function ChartFrame({
  plotRef,
  tipRef,
  labels,
  table,
  children,
}: {
  plotRef: (el: HTMLDivElement | null) => void;
  tipRef: RefObject<HTMLDivElement>;
  labels?: ReactNode;
  table: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tabs.Root defaultValue="chart" className="wpsignal-chart-tabs">
      <Tabs.List
        variant="minimal"
        aria-label={__("Chart or table", "wordsocket")}
      >
        <Tabs.Tab value="chart">{__("Chart", "wordsocket")}</Tabs.Tab>
        <Tabs.Tab value="table">{__("Table", "wordsocket")}</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="chart" tabIndex={-1}>
        <div className="wpsignal-chart">
          {labels}
          <div className="wpsignal-chart__plot" ref={plotRef}>
            {children}
          </div>
          <div
            className="wpsignal-chart__tip"
            ref={tipRef}
            aria-hidden="true"
          />
        </div>
      </Tabs.Panel>
      <Tabs.Panel value="table" tabIndex={-1} className="wpsignal-chart__table">
        {table}
      </Tabs.Panel>
    </Tabs.Root>
  );
}

/** One row of a chart's table: `id`, then one value per column. */
export type TableRow = Record<string, string | number>;

/** Rows a page of a table holds. */
const PER_PAGE = 50;

/**
 * The chart's figures as a DataViews table, for the Table tab: the first column names the row, every
 * column sorts, and pages hold PER_PAGE rows.
 *
 * @since 0.31.0
 */
export function TableView({
  head,
  rows,
}: {
  head: string[];
  rows: Array<Array<string | number>>;
}) {
  const ids = useMemo(() => head.map((_, i) => `c${i}`), [head]);
  const items = useMemo(
    () =>
      rows.map(
        (row, i) =>
          ({
            id: String(i),
            ...Object.fromEntries(row.map((cell, k) => [ids[k], cell])),
          }) as TableRow,
      ),
    [rows, ids],
  );
  const fields = useMemo<Field<TableRow>[]>(
    () =>
      head.map((label, i) => ({
        id: ids[i],
        label,
        type:
          i === 0 || rows.some((row) => typeof row[i] !== "number")
            ? "text"
            : "integer",
        enableSorting: true,
        enableHiding: i !== 0,
        getValue: ({ item }) => item[ids[i]],
      })),
    [head, ids, rows],
  );
  const [view, setView] = useState<View>({
    type: "table",
    fields: ids.slice(1),
    titleField: ids[0],
    page: 1,
    perPage: PER_PAGE,
    search: "",
    filters: [],
    layout: { density: "compact" },
  });
  const { data, paginationInfo } = useMemo(
    () => filterSortAndPaginate(items, view, fields),
    [items, view, fields],
  );
  return (
    <DataViews<TableRow>
      data={data}
      fields={fields}
      view={view}
      onChangeView={setView}
      paginationInfo={paginationInfo}
      getItemId={(item) => String(item.id)}
      defaultLayouts={{ table: {} }}
      search={false}
    />
  );
}

/**
 * A weekday's name in the browser's language; 0 is Sunday.
 *
 * @since 0.31.0
 */
export function weekdayName(
  w: number,
  style: "short" | "long" = "short",
): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(undefined, { weekday: style }).format(
    new Date(2023, 0, 1 + (((w % 7) + 7) % 7)),
  );
}

/**
 * "09:00", or "09:41" with minutes.
 *
 * @since 0.31.0
 */
export function clock(hour: number, minute = 0): string {
  return `${String(hour % 24).padStart(2, "0")}:${String(minute % 60).padStart(
    2,
    "0",
  )}`;
}

/**
 * A local date (`YYYY-MM-DD`) as "Sat 24 Oct" or "24 Oct".
 *
 * @since 0.31.0
 */
export function dayLabel(date: string, weekday = true): string {
  const at = new Date(`${date}T00:00:00`);
  if (Number.isNaN(at.getTime())) return date;
  return new Intl.DateTimeFormat(
    undefined,
    weekday
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short" },
  ).format(at);
}

/**
 * Whether the browser asks for reduced motion.
 *
 * @since 0.31.0
 */
export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
