/*
 * "How the weeks are going": small multiples over the window's days (visits, then one series per outcome
 * the site registered with one, and the journeys left with a ref when an extension named it), each a faint
 * daily line under its 7-day average.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { memo } from "@wordpress/element";
import { Stack } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { JourneyVisuals } from "../types";
import { ChartFrame, dayLabel, TableView, useChart } from "./chart";
import { rolling, ticks, type Outcomes } from "./journeys";

type Day = JourneyVisuals["days"][number];

const LEFT = 52;
const RIGHT = 84;
const TOP = 12;
const MULTIPLE_H = 124;
const GAP = 38;
const BOTTOM = 34;
const AVERAGE_DAYS = 7;
/** How far the fade under the average reaches, in pixels, and the strips it is drawn in. */
const FADE_PX = 56;
const FADE_STRIPS = 28;

/**
 * A fade of constant depth under a line: copies of the line, each a strip lower and fainter, so the
 * fade follows the line wherever it goes.
 */
function FadeBand({ d, clip }: { d: string; clip: string }) {
  const strip = FADE_PX / FADE_STRIPS;
  return (
    <g className="wpsignal-trend__fade" clipPath={`url(#${clip})`}>
      {Array.from({ length: FADE_STRIPS }, (_, k) => (
        <path
          key={k}
          d={d}
          transform={`translate(0 ${(k + 0.5) * strip})`}
          strokeWidth={strip + 0.5}
          strokeOpacity={1 - k / FADE_STRIPS}
        />
      ))}
    </g>
  );
}

/**
 * The trends; re-rendered only when its figures or its width change.
 *
 * @since 0.31.0
 */
export const Trends = memo(function Trends({
  days,
  outcomes,
  refInfo,
}: {
  days: Day[];
  outcomes: Outcomes;
  /** What a journey's ref is, when an extension said. */
  refInfo: JourneyVisuals["ref"];
}) {
  const { plotRef, tipRef, width, tip } = useChart();
  const DAYS = days.length;
  const W = Math.max(640, width);

  /* The series: visits, then each outcome that asked for one, then the journeys left with a ref. */
  const measures = (() => {
    const list: Array<{ key: string; label: string; values: number[] }> = [
      {
        key: "visits",
        label: __("Visits a day", "wordsocket"),
        values: days.map((d) => d.visits),
      },
    ];
    Object.entries(outcomes).forEach(([key, outcome]) => {
      if (outcome.series)
        list.push({
          key,
          label: outcome.series,
          values: days.map((d) => d.outcomes[key] ?? 0),
        });
    });
    if (refInfo?.left_series)
      list.push({
        key: "left_ref",
        label: refInfo.left_series,
        values: days.map((d) => d.left_ref),
      });
    return list.map((m) => {
      const avg = rolling(m.values, AVERAGE_DAYS);
      const scale = ticks(Math.max(...m.values, 1), 3);
      return { ...m, avg, ticks: scale, max: scale[scale.length - 1] };
    });
  })();
  const plotBottom = TOP + measures.length * (MULTIPLE_H + GAP) - GAP;
  const H = plotBottom + BOTTOM;
  const x = (d: number) => LEFT + ((W - LEFT - RIGHT) * d) / DAYS;

  const weekday = (date: string) => new Date(`${date}T00:00:00`).getDay();
  const line = (points: Array<[number, number]>) =>
    points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`).join("");

  const dayTip = (evt: { clientX: number; clientY: number }, d: number) => {
    const row = days[d];
    tip.show(evt, dayLabel(row.date), [
      measures
        .map((m) => `${m.values[d]} ${m.label.toLowerCase()}`)
        .join(" \u00b7 "),
      /* translators: %s: the weekly average of visits */
      sprintf(
        __("weekly average %s visits", "wordsocket"),
        measures[0].avg[d].toFixed(1),
      ),
    ]);
  };
  return (
    <Stack direction="column" gap="sm">
      <ul className="wpsignal-chart__legend">
        <li>
          <span className="wpsignal-chart__swatch is-line is-raw" />
          {__("Daily", "wordsocket")}
        </li>
        <li>
          <span className="wpsignal-chart__swatch is-line" />
          {__("Weekly average", "wordsocket")}
        </li>
      </ul>
      <ChartFrame
        plotRef={plotRef}
        tipRef={tipRef}
        table={
          <TableView
            head={[__("Day", "wordsocket"), ...measures.map((m) => m.label)]}
            rows={days.map((d, i) => [
              dayLabel(d.date),
              ...measures.map((m) => m.values[i]),
            ])}
          />
        }
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={__(
            "Daily visits and how they ended over four weeks",
            "wordsocket",
          )}
          onMouseMove={(evt) => {
            const box = evt.currentTarget.getBoundingClientRect();
            const mx = ((evt.clientX - box.left) / box.width) * W;
            if (mx < LEFT || mx > W - RIGHT) {
              tip.hide();
              return;
            }
            dayTip(
              evt,
              Math.min(
                DAYS - 1,
                Math.max(
                  0,
                  Math.floor(((mx - LEFT) / (W - LEFT - RIGHT)) * DAYS),
                ),
              ),
            );
          }}
          onMouseLeave={() => tip.hide()}
        >
          <defs>
            {measures.map((m, i) => {
              const top = TOP + i * (MULTIPLE_H + GAP);
              return (
                <clipPath key={m.key} id={`wpsignal-trend-clip-${i}`}>
                  <rect x={0} y={top} width={W} height={MULTIPLE_H} />
                </clipPath>
              );
            })}
          </defs>
          <g>
            {days.map((d, i) =>
              [0, 6].includes(weekday(d.date)) ? (
                <rect
                  key={d.date}
                  className="wpsignal-trend__weekend"
                  x={x(i)}
                  width={x(i + 1) - x(i)}
                  y={TOP - 4}
                  height={plotBottom - TOP + 4}
                />
              ) : null,
            )}
            {days.map((d, i) =>
              i % 7 === 0 ? (
                <g key={d.date}>
                  <line
                    className="wpsignal-chart__rule"
                    x1={x(i)}
                    x2={x(i)}
                    y1={TOP - 4}
                    y2={plotBottom}
                  />
                  <text x={x(i) + 4} y={H - 10}>
                    {dayLabel(d.date, false)}
                  </text>
                </g>
              ) : null,
            )}
          </g>
          {measures.map((m, i) => {
            const y0 = TOP + i * (MULTIPLE_H + GAP);
            const y = (v: number) =>
              y0 + MULTIPLE_H - ((MULTIPLE_H - 18) * v) / m.max;
            const last = m.avg[DAYS - 1] ?? 0;
            return (
              <g key={m.key}>
                {m.ticks.map((t) => (
                  <g key={t}>
                    <line
                      className="wpsignal-chart__grid"
                      x1={LEFT}
                      x2={W - RIGHT}
                      y1={y(t)}
                      y2={y(t)}
                    />
                    <text
                      x={LEFT - 10}
                      y={y(t)}
                      dy="0.35em"
                      textAnchor="end"
                      className="is-num"
                    >
                      {t}
                    </text>
                  </g>
                ))}
                <text x={LEFT} y={y0 + 2} className="is-strong">
                  {m.label}
                </text>
                <FadeBand
                  d={line(m.avg.map((v, k) => [x(k + 0.5), y(v)]))}
                  clip={`wpsignal-trend-clip-${i}`}
                />
                <path
                  className="wpsignal-trend__raw"
                  d={line(m.values.map((v, k) => [x(k + 0.5), y(v)]))}
                />
                <path
                  className="wpsignal-trend__avg"
                  d={line(m.avg.map((v, k) => [x(k + 0.5), y(v)]))}
                />
                <text
                  x={x(DAYS - 0.5) + 8}
                  y={y(last) - 7}
                  dy="0.35em"
                  className="is-num is-strong"
                >
                  {last.toFixed(1)}
                </text>
                <text
                  x={x(DAYS - 0.5) + 8}
                  y={y(last) + 8}
                  dy="0.35em"
                  className="is-muted"
                >
                  {__("Weekly avg", "wordsocket")}
                </text>
              </g>
            );
          })}
        </svg>
      </ChartFrame>
    </Stack>
  );
});
