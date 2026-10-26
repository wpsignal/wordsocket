/*
 * Pieces every visual shares: the chart frame with the tooltip its marks drive, the frame's width, weekday
 * names, and the "As a table" view under a chart.
 */

/**
 * WordPress dependencies.
 */
import { useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies.
 */
import type { ReactNode, RefObject } from "react";

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
 * The frame refs, its current width (measured once per animation frame) and its tooltip, which writes the DOM itself.
 *
 * @since 0.31.0
 */
export function useChart(fallback = 900) {
  const frameRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = el.clientWidth || fallback;
        setWidth((current) => (current === next ? current : next));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fallback]);

  /* Fixed to the viewport, so no scrolling frame clips it: above the pointer, below when there is no room, kept inside the window sideways. */
  const tip: Tip = {
    show(at, title, lines, wide = false) {
      const el = tipRef.current;
      if (!el) return;
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
      const { width: w, height: h } = el.getBoundingClientRect();
      const margin = 8;
      const x = Math.min(window.innerWidth - w / 2 - margin, Math.max(w / 2 + margin, at.clientX));
      const below = at.clientY - h - 10 < margin;
      el.classList.toggle("is-below", below);
      el.style.left = `${x}px`;
      el.style.top = `${at.clientY}px`;
    },
    hide() {
      tipRef.current?.classList.remove("is-shown");
    },
  };
  return { frameRef, tipRef, width, tip };
}

/** The width a column of row labels needs, from the longest label. */
export function labelColumnWidth(labels: string[]): number {
  const longest = labels.reduce((n, label) => Math.max(n, label.length), 0);
  return Math.min(260, Math.max(72, 20 + Math.ceil(longest * 7.2)));
}

/**
 * The row labels of a chart, beside the drawing and pinned to the left while it scrolls sideways.
 *
 * @since 0.31.0
 */
export function RowLabels({ labels, width, height }: { labels: Array<{ y: number; text: string }>; width: number; height: number }) {
  return (
    <div className="wpsignal-chart__labels" style={{ width, height }} aria-hidden="true">
      {labels.map((label) => (
        <span key={`${label.text}:${label.y}`} style={{ top: label.y }}>
          {label.text}
        </span>
      ))}
    </div>
  );
}

/**
 * The scrolling frame a chart draws in, with its tooltip element.
 *
 * @since 0.31.0
 */
export function ChartFrame({
  frameRef,
  tipRef,
  children,
}: {
  frameRef: RefObject<HTMLDivElement>;
  tipRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className="wpsignal-chart" ref={frameRef}>
      {children}
      <div className="wpsignal-chart__tip" ref={tipRef} aria-hidden="true" />
    </div>
  );
}

/**
 * The chart's figures as a table, folded under it.
 *
 * @since 0.31.0
 */
export function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="wpsignal-chart__table">
      <summary>{__("As a table", "wordsocket")}</summary>
      <table>
        <caption className="screen-reader-text">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, k) =>
                k === 0 ? (
                  <th key={k} scope="row">
                    {String(cell)}
                  </th>
                ) : (
                  <td key={k}>{String(cell)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * A weekday's name in the browser's language; 0 is Sunday.
 *
 * @since 0.31.0
 */
export function weekdayName(w: number, style: "short" | "long" = "short"): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(undefined, { weekday: style }).format(new Date(2023, 0, 1 + (((w % 7) + 7) % 7)));
}

/**
 * "09:00", or "09:41" with minutes.
 *
 * @since 0.31.0
 */
export function clock(hour: number, minute = 0): string {
  return `${String(hour % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
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
    weekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" },
  ).format(at);
}

/**
 * Whether the browser asks for reduced motion.
 *
 * @since 0.31.0
 */
export function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
