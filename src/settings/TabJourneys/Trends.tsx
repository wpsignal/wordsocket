/*
 * "How the weeks are going": small multiples over the window's days (visits, then one series per outcome
 * the site registered with one, and the journeys left with a ref when an extension named it), each a faint
 * daily line under its 7-day average, then every listed journey as a dot on its day, as high as its steps,
 * with the day's median through them.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { useMemo, useState } from "@wordpress/element";
import { Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { JourneyVisuals } from "../types";
import { ChartFrame, clock, dayLabel, TableView, useChart } from "./chart";
import {
  describeSteps,
  median,
  outcomeColor,
  outcomeKeys,
  outcomeLabel,
  rolling,
  stepCount,
  ticks,
  type Kinds,
  type Outcomes,
  type VisualJourney,
} from "./journeys";

type Day = JourneyVisuals["days"][number];

const LEFT = 52;
const RIGHT = 84;
const TOP = 12;
const MULTIPLE_H = 124;
const GAP = 38;
const DOTS_H = 270;
const BOTTOM = 34;
const AVERAGE_DAYS = 7;
/** The least the steps axis reaches. */
const STEPS_FLOOR = 10;

/**
 * The trends and the dots.
 *
 * @since 0.31.0
 */
export function Trends({
  days,
  journeys,
  total,
  outcomes,
  ref,
  kinds,
}: {
  days: Day[];
  journeys: VisualJourney[];
  total: number;
  outcomes: Outcomes;
  ref: JourneyVisuals["ref"];
  kinds: Kinds;
}) {
  const { frameRef, tipRef, width, tip } = useChart();
  const [hovered, setHovered] = useState<number | null>(null);
  const DAYS = days.length;
  const W = Math.max(640, width);

  /* The series: visits, then each outcome that asked for one, then the journeys left with a ref. */
  const measures = useMemo(() => {
    const list: Array<{ key: string; label: string; values: number[] }> = [
      { key: "visits", label: __("Visits a day", "wordsocket"), values: days.map((d) => d.visits) },
    ];
    Object.entries(outcomes).forEach(([key, outcome]) => {
      if (outcome.series) list.push({ key, label: outcome.series, values: days.map((d) => d.outcomes[key] ?? 0) });
    });
    if (ref?.left_series) list.push({ key: "left_ref", label: ref.left_series, values: days.map((d) => d.left_ref) });
    return list.map((m) => {
      const avg = rolling(m.values, AVERAGE_DAYS);
      const scale = ticks(Math.max(...m.values, 1), 3);
      return { ...m, avg, ticks: scale, max: scale[scale.length - 1] };
    });
  }, [days, outcomes, ref]);
  const dotsTop = TOP + measures.length * (MULTIPLE_H + GAP);
  const H = dotsTop + DOTS_H + BOTTOM;
  const x = (d: number) => LEFT + ((W - LEFT - RIGHT) * d) / DAYS;

  const dots = useMemo(() => journeys.filter((j) => j.day >= 0 && j.day < DAYS), [journeys, DAYS]);
  const medians = useMemo(
    () => days.map((_, d) => median(dots.filter((j) => j.day === d).map((j) => j.steps.length))),
    [days, dots],
  );
  /* The axis reaches the 95th percentile of steps; a dot above it sits on the top line. */
  const { longest, stepTicks, top } = useMemo(() => {
    const lengths = dots.map((j) => j.steps.length).sort((a, b) => a - b);
    const limit = Math.max(STEPS_FLOOR, (lengths[Math.floor(0.95 * (lengths.length - 1))] ?? 0) + 1);
    const scale = ticks(limit, 4).filter((t) => t > 0);
    return { longest: lengths[lengths.length - 1] ?? 0, stepTicks: scale, top: Math.max(limit, scale[scale.length - 1] ?? 1) };
  }, [dots]);
  const ySteps = (steps: number) => dotsTop + DOTS_H - ((DOTS_H - 18) * Math.min(steps, top)) / top;
  const weekday = (date: string) => new Date(`${date}T00:00:00`).getDay();
  const line = (points: Array<[number, number]>) => points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join("");

  const dayTip = (evt: { clientX: number; clientY: number }, d: number) => {
    const row = days[d];
    tip.show(evt, dayLabel(row.date), [
      measures.map((m) => `${m.values[d]} ${m.label.toLowerCase()}`).join(" \u00b7 "),
      /* translators: 1: the day's median steps per journey, 2: the 7-day average of visits */
      sprintf(__("median %1$s steps \u00b7 7-day average %2$s visits", "wordsocket"), String(medians[d]), measures[0].avg[d].toFixed(1)),
    ]);
  };
  const journeyTip = (evt: { clientX: number; clientY: number }, j: VisualJourney) =>
    tip.show(
      evt,
      `${dayLabel(days[j.day].date)} ${clock(Math.floor(j.minute / 60), j.minute % 60)} \u00b7 ${stepCount(j.steps.length)} \u00b7 ${outcomeLabel(j.outcome, outcomes).toLowerCase()}`,
      [describeSteps(j.steps, kinds)],
      true,
    );

  return (
    <Stack direction="column" gap="sm">
      <ul className="wpsignal-chart__legend">
        <li>
          <span className="wpsignal-chart__swatch is-line is-raw" />
          {__("Daily", "wordsocket")}
        </li>
        <li>
          <span className="wpsignal-chart__swatch is-line" />
          {__("7-day average, or the day's median", "wordsocket")}
        </li>
        {outcomeKeys(outcomes, dots)
          .filter((o) => dots.some((j) => j.outcome === o))
          .map((o) => (
            <li key={o}>
              <span className="wpsignal-chart__swatch is-dot" style={{ background: outcomeColor(o, outcomes) }} />
              {outcomeLabel(o, outcomes)}
            </li>
          ))}
      </ul>
      <ChartFrame frameRef={frameRef} tipRef={tipRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={__("Daily visits and outcomes over four weeks, with every journey as a dot", "wordsocket")}
          onMouseMove={(evt) => {
            if (hovered !== null) return;
            const box = evt.currentTarget.getBoundingClientRect();
            const mx = ((evt.clientX - box.left) / box.width) * W;
            if (mx < LEFT || mx > W - RIGHT) {
              tip.hide();
              return;
            }
            dayTip(evt, Math.min(DAYS - 1, Math.max(0, Math.floor(((mx - LEFT) / (W - LEFT - RIGHT)) * DAYS))));
          }}
          onMouseLeave={() => tip.hide()}
        >
          <defs>
            <linearGradient id="wpsignal-trend-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g>
            {days.map((d, i) =>
              [0, 6].includes(weekday(d.date)) ? (
                <rect key={d.date} className="wpsignal-trend__weekend" x={x(i)} width={x(i + 1) - x(i)} y={TOP - 4} height={dotsTop + DOTS_H - TOP + 4} />
              ) : null,
            )}
            {days.map((d, i) =>
              i % 7 === 0 ? (
                <g key={d.date}>
                  <line className="wpsignal-chart__rule" x1={x(i)} x2={x(i)} y1={TOP - 4} y2={dotsTop + DOTS_H} />
                  <text x={x(i) + 4} y={H - 10}>
                    {dayLabel(d.date, false)}
                  </text>
                </g>
              ) : null,
            )}
          </g>
          {measures.map((m, i) => {
            const y0 = TOP + i * (MULTIPLE_H + GAP);
            const y = (v: number) => y0 + MULTIPLE_H - ((MULTIPLE_H - 18) * v) / m.max;
            const last = m.avg[DAYS - 1] ?? 0;
            return (
              <g key={m.key}>
                {m.ticks.map((t) => (
                  <g key={t}>
                    <line className="wpsignal-chart__grid" x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} />
                    <text x={LEFT - 10} y={y(t)} dy="0.35em" textAnchor="end" className="is-num">
                      {t}
                    </text>
                  </g>
                ))}
                <text x={LEFT} y={y0 + 2} className="is-strong">
                  {m.label}
                </text>
                <path
                  className="wpsignal-trend__area"
                  d={`${line(m.avg.map((v, k) => [x(k + 0.5), y(v)]))}L${x(DAYS - 0.5)},${y(0)}L${x(0.5)},${y(0)}Z`}
                />
                <path className="wpsignal-trend__raw" d={line(m.values.map((v, k) => [x(k + 0.5), y(v)]))} />
                <path className="wpsignal-trend__avg" d={line(m.avg.map((v, k) => [x(k + 0.5), y(v)]))} />
                <text x={x(DAYS - 0.5) + 8} y={y(last) - 7} dy="0.35em" className="is-num is-strong">
                  {last.toFixed(1)}
                </text>
                <text x={x(DAYS - 0.5) + 8} y={y(last) + 8} dy="0.35em" className="is-muted">
                  {__("7-day avg", "wordsocket")}
                </text>
              </g>
            );
          })}
          <g>
            {stepTicks.map((t) => (
              <g key={t}>
                <line className="wpsignal-chart__grid" x1={LEFT} x2={W - RIGHT} y1={ySteps(t)} y2={ySteps(t)} />
                <text x={LEFT - 10} y={ySteps(t)} dy="0.35em" textAnchor="end" className="is-num">
                  {t === top && longest > top ? `${t}+` : t}
                </text>
              </g>
            ))}
            <text x={LEFT} y={dotsTop + 2} className="is-strong">
              {total > journeys.length
                ? /* translators: 1: journeys drawn as dots, 2: journeys in the window */
                  sprintf(__("Steps per journey, one dot each (the newest %1$d of %2$d), with the day's median", "wordsocket"), journeys.length, total)
                : __("Steps per journey, one dot each, with the day's median", "wordsocket")}
            </text>
            <path className="wpsignal-trend__avg" d={line(medians.map((v, k) => [x(k + 0.5), ySteps(v)]))} />
            {dots.map((j) => (
              <circle
                key={j.index}
                className={`wpsignal-trend__dot${hovered === j.index ? " is-on" : ""}`}
                cx={x(j.day + Math.min(0.98, Math.max(0.02, j.minute / 1440)))}
                cy={ySteps(j.steps.length)}
                r={hovered === j.index ? 7.5 : 4.5}
                fill={outcomeColor(j.outcome, outcomes)}
                onMouseEnter={(evt) => {
                  setHovered(j.index);
                  journeyTip(evt, j);
                }}
                onMouseMove={(evt) => {
                  evt.stopPropagation();
                  journeyTip(evt, j);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  tip.hide();
                }}
              />
            ))}
          </g>
        </svg>
      </ChartFrame>
      <TableView
        caption={__("Visits and outcomes per day", "wordsocket")}
        head={[__("Day", "wordsocket"), ...measures.map((m) => m.label), __("Median steps", "wordsocket")]}
        rows={days.map((d, i) => [dayLabel(d.date), ...measures.map((m) => m.values[i]), medians[i]])}
      />
    </Stack>
  );
}
