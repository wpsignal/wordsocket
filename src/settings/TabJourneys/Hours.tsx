/*
 * "When visitors are here": the week as a weekday-by-hour grid on the site's clock, coloured by minutes on the
 * site, visits, or an outcome the site registered, with every day added together in a strip underneath.
 */

/**
 * WordPress dependencies.
 */
import { __, _n, sprintf } from "@wordpress/i18n";
import { useMemo, useState } from "@wordpress/element";
import { Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { Choice } from "../TabRules/ValueControl";
import type { JourneyVisuals } from "../types";
import {
  ChartFrame,
  RowLabels,
  clock,
  TableView,
  useChart,
  weekdayName,
} from "./chart";
import { isWin, outcomeLabel, type Outcomes } from "./journeys";

type Cell = JourneyVisuals["hours"][number][number];

const RAMP = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
];
/** Room before the first hour, inside the drawing; the weekday labels sit outside it. */
const LEFT = 12;
const RIGHT = 16;
const TOP = 26;
const CELL_H = 36;
/** Space between cells, so a hovered cell's outline is not painted over by the next one. */
const CELL_GAP = 3;
const GAP_STRIP = 26;
const STRIP_H = 56;
const BOTTOM = 6;

/** A WordPress timezone as a word: a named zone as is, an offset as "UTC+02:00", none as "UTC". */
function timezoneLabel(timezone: string): string {
  if (!timezone || timezone === "+00:00") return "UTC";
  return /^[+-]\d\d:\d\d$/.test(timezone) ? `UTC${timezone}` : timezone;
}

/**
 * The grid, its measure select and the all-days strip.
 *
 * @since 0.31.0
 */
export function Hours({
  hours,
  weekStart,
  timezone,
  listed,
  total,
  outcomes,
}: {
  hours: JourneyVisuals["hours"];
  weekStart: number;
  timezone: string;
  /** Journeys whose time the minutes came from. */
  listed: number;
  total: number;
  outcomes: Outcomes;
}) {
  const { plotRef, tipRef, width, tip } = useChart();
  const [measure, setMeasure] = useState("minutes");
  const order = useMemo(
    () => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7),
    [weekStart],
  );
  const stripTop = TOP + 7 * CELL_H + GAP_STRIP;
  const H = stripTop + STRIP_H + BOTTOM;
  const W = Math.max(660, width);
  const cellW = (W - LEFT - RIGHT) / 24;
  /* The measures: minutes, visits, then each outcome that is a win for the site. */
  const measures = useMemo(() => {
    const list: Array<{
      key: string;
      label: string;
      of: (cell: Cell) => number;
    }> = [
      {
        key: "minutes",
        label: __("Minutes on the site", "wordsocket"),
        of: (c) => c.minutes,
      },
      { key: "visits", label: __("Visits", "wordsocket"), of: (c) => c.visits },
    ];
    Object.keys(outcomes)
      .filter(isWin)
      .forEach((key) =>
        list.push({
          key,
          label: outcomeLabel(key, outcomes),
          of: (c) => c.outcomes[key] ?? 0,
        }),
      );
    return list;
  }, [outcomes]);
  const current = measures.find((m) => m.key === measure) ?? measures[0];
  const cells = useMemo(
    () =>
      order.flatMap((w, row) =>
        (hours[w] ?? []).map((cell, h) => ({ w, row, h, cell })),
      ),
    [order, hours],
  );
  const max = cells.reduce((n, c) => Math.max(n, current.of(c.cell)), 0);
  const color = (v: number) =>
    RAMP[
      Math.min(
        RAMP.length - 1,
        Math.floor((v / Math.max(1, max)) * RAMP.length),
      )
    ];
  const byHour = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) =>
        hours.reduce((sum, row) => sum + (row[h] ? current.of(row[h]) : 0), 0),
      ),
    [hours, current],
  );
  const stripMax = Math.max(1, ...byHour);
  const yBar = (v: number) =>
    stripTop + STRIP_H - ((STRIP_H - 6) * v) / stripMax;
  const peak = byHour.reduce((best, v, h) => (v > byHour[best] ? h : best), 0);

  const words = (cell: Cell) => [
    /* translators: %d: minutes visitors spent on the site */
    sprintf(
      _n(
        "%d min on the site",
        "%d min on the site",
        cell.minutes,
        "wordsocket",
      ),
      cell.minutes,
    ),
    /* translators: %d: visits */
    sprintf(
      _n("%d visit", "%d visits", cell.visits, "wordsocket"),
      cell.visits,
    ),
    ...Object.keys(outcomes)
      .filter(isWin)
      .map(
        (key) =>
          `${cell.outcomes[key] ?? 0} ${outcomeLabel(
            key,
            outcomes,
          ).toLowerCase()}`,
      ),
  ];
  const amount = (v: number) =>
    current.key === "minutes"
      ? /* translators: %d: minutes */ sprintf(
          __("%d min", "wordsocket"),
          Math.round(v),
        )
      : String(Math.round(v));

  return (
    <Stack direction="column" gap="sm">
      <Stack
        direction="row"
        gap="lg"
        wrap="wrap"
        align="end"
        className="wpsignal-chart__filters"
      >
        <Choice
          label={__("Show", "wordsocket")}
          value={current.key}
          options={measures.map((m) => ({ value: m.key, label: m.label }))}
          onChange={setMeasure}
        />
        <span className="wpsignal-hours__ramp">
          <span>0</span>
          <span className="wpsignal-hours__steps">
            {RAMP.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span>
            {/* translators: %s: the most of the measure any hour holds */}
            {sprintf(__("%s in an hour", "wordsocket"), amount(max))}
          </span>
        </span>
      </Stack>
      <Text
        variant="body-sm"
        className="wpsignal-muted"
        render={<p />}
      >
        {/* translators: %s: the site's timezone */}
        {sprintf(
          __("Times are on the site's clock (%s).", "wordsocket"),
          timezoneLabel(timezone),
        )}
        {current.key === "minutes" && total > listed
          ? " " +
            /* translators: 1: journeys the minutes came from, 2: journeys in the window */
            sprintf(
              __(
                "Minutes come from the newest %1$d of %2$d journeys.",
                "wordsocket",
              ),
              listed,
              total,
            )
          : ""}
      </Text>
      <ChartFrame
        plotRef={plotRef}
        tipRef={tipRef}
        labels={
          <RowLabels
            className="wpsignal-hours__labels"
            labels={[
              ...order.map((w) => weekdayName(w)),
              __("All days", "wordsocket"),
            ]}
            vars={{
              "--wpsignal-top": `${TOP}px`,
              "--wpsignal-cell": `${CELL_H}px`,
              "--wpsignal-gap": `${GAP_STRIP}px`,
              "--wpsignal-strip": `${STRIP_H}px`,
            }}
          />
        }
        table={
          <TableView
            head={[
              __("Day", "wordsocket"),
              ...Array.from({ length: 24 }, (_, h) => clock(h)),
            ]}
            rows={order.map((w) => [
              weekdayName(w),
              ...Array.from({ length: 24 }, (_, h) =>
                Math.round(hours[w]?.[h] ? current.of(hours[w][h]) : 0),
              ),
            ])}
          />
        }
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={__("Presence by weekday and hour of day", "wordsocket")}
        >
          <g>
            {Array.from({ length: 8 }, (_, i) => i * 3).map((h) => (
              <text
                key={h}
                x={LEFT + h * cellW + 4}
                y={TOP - 9}
                className="is-num"
              >
                {clock(h)}
              </text>
            ))}
          </g>
          <g>
            {cells.map((c) => {
              const key = `${c.w}:${c.h}`;
              const v = current.of(c.cell);
              return (
                <rect
                  key={key}
                  className={`wpsignal-hours__cell${v > 0 ? "" : " is-empty"}`}
                  x={LEFT + c.h * cellW + CELL_GAP / 2}
                  y={TOP + c.row * CELL_H + CELL_GAP / 2}
                  width={Math.max(0, cellW - CELL_GAP)}
                  height={CELL_H - CELL_GAP}
                  rx={3}
                  fill={v > 0 ? color(v) : undefined}
                  onMouseMove={(evt) =>
                    tip.show(
                      evt,
                      /* translators: 1: the weekday, 2: the hour, 3: the hour after */
                      sprintf(
                        __("%1$s %2$s to %3$s", "wordsocket"),
                        weekdayName(c.w),
                        clock(c.h),
                        clock(c.h + 1),
                      ),
                      words(c.cell),
                    )
                  }
                  onMouseLeave={() => tip.hide()}
                />
              );
            })}
          </g>
          <g>
            {byHour.map((v, h) => (
              <rect
                key={h}
                className="wpsignal-hours__bar"
                x={LEFT + h * cellW + 2}
                width={Math.max(0, cellW - 4)}
                y={yBar(v)}
                height={Math.max(0, stripTop + STRIP_H - yBar(v))}
                rx={2}
                onMouseMove={(evt) =>
                  tip.show(
                    evt,
                    /* translators: 1: the hour, 2: the hour after */
                    sprintf(
                      __("%1$s to %2$s, all days", "wordsocket"),
                      clock(h),
                      clock(h + 1),
                    ),
                    [`${amount(v)} \u00b7 ${current.label.toLowerCase()}`],
                  )
                }
                onMouseLeave={() => tip.hide()}
              />
            ))}
            {byHour[peak] > 0 && (
              <text
                x={LEFT + peak * cellW + cellW / 2}
                y={yBar(byHour[peak]) - 6}
                textAnchor="middle"
                className="is-num"
              >
                {amount(byHour[peak])}
              </text>
            )}
          </g>
        </svg>
      </ChartFrame>
    </Stack>
  );
}
