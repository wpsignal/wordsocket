/*
 * One value control per value type for the condition rows and action params, all `@wordpress/ui`;
 * `Choice` maps the rule JSON's string values to the `{ value, label }` items the select wants.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import {
  CheckboxControl,
  InputControl,
  SelectControl,
  Stack,
  Text,
} from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { OptionGroup, ValueType } from "./model";
import { weekdayName } from "./model";
import { useRules } from "./context";
import {
  PresentationChoices,
  PresentationText,
} from "./RuleEditor/Presentation";

export interface PatternOption {
  id: number;
  title: string;
}

interface Props {
  type: ValueType;
  value: unknown;
  options: Record<string, string>;
  /** A select's options under headings; `options` is the same set flat. */
  groups?: OptionGroup[];
  label?: string;
  /** In a chip: the label stays for assistive technology, the control reads as part of the sentence. */
  inline?: boolean;
  onChange(value: unknown): void;
}

interface Option {
  value: string;
  label: string;
}

const HOURS: Option[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${h}:00`,
}));

/** A select over string values; the label is visible unless `hideLabel`, and `groups` puts the options under headings. */
export function Choice({
  label,
  hideLabel,
  description,
  value,
  options,
  groups,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  description?: string;
  value: string;
  options: Option[];
  groups?: OptionGroup[];
  onChange(value: string): void;
}) {
  /*
   * A value the options lack (a gone pattern, an unregistered kind) stays visible and named instead
   * of a blank trigger.
   */
  const items = options.some((o) => o.value === value)
    ? options
    : [
        ...options,
        {
          value,
          label: `${value || __("(empty)", "wordsocket")} (${__(
            "unavailable",
            "wordsocket",
          )})`,
        },
      ];
  /*
   * Grouped, the items render as children under group labels, each `Item` holding the same object
   * `items` does, since the select matches values by identity; an item no group names (the
   * unavailable fallback) follows the groups.
   */
  const grouped = (groups ?? []).filter((g) => Object.keys(g.options).length);
  const inGroups = new Set(grouped.flatMap((g) => Object.keys(g.options)));
  const itemOf = (v: string) => items.find((o) => o.value === v);
  const renderItem = (item: Option) => (
    <SelectControl.Item key={item.value} value={item} label={item.label}>
      <SelectControl.ItemLabel>{item.label}</SelectControl.ItemLabel>
    </SelectControl.Item>
  );
  return (
    <SelectControl
      label={label}
      hideLabelFromVision={hideLabel}
      description={description}
      items={items}
      value={items.find((o) => o.value === value) ?? null}
      onValueChange={(item) => {
        if (item && item.value !== null) onChange(item.value);
      }}
      popupWidth="content"
    >
      {grouped.length > 0
        ? [
            ...grouped.map((g) => (
              <SelectControl.Group key={g.label}>
                <SelectControl.GroupLabel>{g.label}</SelectControl.GroupLabel>
                {Object.keys(g.options)
                  .map(itemOf)
                  .filter((o): o is Option => Boolean(o))
                  .map(renderItem)}
              </SelectControl.Group>
            )),
            ...items.filter((o) => !inGroups.has(o.value)).map(renderItem),
          ]
        : undefined}
    </SelectControl>
  );
}

/**
 * A number field that keeps the typed draft, so clearing it does not snap to 0, and commits only a
 * finite number at or above `min`.
 */
function NumberField({
  label,
  hideLabel,
  min,
  value,
  onChange,
}: {
  label: string;
  hideLabel: boolean;
  min: number;
  value: unknown;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => {
    if (Number(draft) !== value) setDraft(String(value ?? ""));
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- a value from outside (another row's props after a removal) replaces the draft; the draft's own commits do not. */
  }, [value]);
  return (
    <InputControl
      className="wpsignal-rule-number"
      type="number"
      min={min}
      label={label}
      hideLabelFromVision={hideLabel}
      value={draft}
      onValueChange={(v) => {
        setDraft(v);
        const n = Number(v);
        if (v.trim() !== "" && Number.isFinite(n)) onChange(Math.max(min, n));
      }}
    />
  );
}

const entries = (options: Record<string, string>): Option[] =>
  Object.entries(options).map(([value, label]) => ({ value, label }));

export function ValueControl({
  type,
  value,
  options,
  groups,
  label,
  inline,
  onChange,
}: Props) {
  const { kinds, kindGroups } = useRules();
  const hidden = inline || !label;
  switch (type) {
    case "none":
      return null;
    case "number":
    case "id":
      return (
        <NumberField
          min={type === "id" ? 1 : 0}
          label={label ?? __("Value", "wordsocket")}
          hideLabel={hidden}
          value={value}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <InputControl
          label={label ?? __("Text", "wordsocket")}
          hideLabelFromVision={hidden}
          value={String(value ?? "")}
          onValueChange={onChange}
        />
      );
    case "boolean":
      return (
        <Choice
          label={label ?? __("Value", "wordsocket")}
          hideLabel={hidden}
          value={value ? "1" : "0"}
          options={[
            { value: "1", label: __("yes", "wordsocket") },
            { value: "0", label: __("no", "wordsocket") },
          ]}
          onChange={(v) => onChange(v === "1")}
        />
      );
    case "select":
      return (
        <Choice
          label={label ?? __("Value", "wordsocket")}
          hideLabel={hidden}
          value={String(value ?? "")}
          options={entries(options)}
          groups={groups}
          onChange={onChange}
        />
      );
    case "kind":
      return (
        <Choice
          label={label ?? __("Page kind", "wordsocket")}
          hideLabel={hidden}
          value={String(value ?? "")}
          options={entries(kinds)}
          groups={kindGroups}
          onChange={onChange}
        />
      );
    case "hours": {
      const v = (value ?? { from: 9, to: 17 }) as { from: number; to: number };
      return (
        <Stack direction="row" gap="sm" align="center" wrap="wrap">
          <Choice
            label={__("From", "wordsocket")}
            hideLabel
            value={String(v.from)}
            options={HOURS}
            onChange={(from) => onChange({ ...v, from: Number(from) })}
          />
          <Text>{__("and", "wordsocket")}</Text>
          <Choice
            label={__("To", "wordsocket")}
            hideLabel
            value={String(v.to)}
            options={HOURS.map((h) => ({ ...h, label: `${h.value}:59` }))}
            onChange={(to) => onChange({ ...v, to: Number(to) })}
          />
        </Stack>
      );
    }
    case "weekdays": {
      const days = Array.isArray(value) ? value.map(Number) : [];
      return (
        <Stack direction="row" gap="sm" align="center" wrap="wrap">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <CheckboxControl
              key={day}
              label={weekdayName(day).slice(0, 3)}
              checked={days.includes(day)}
              onCheckedChange={(on) =>
                onChange(
                  on
                    ? [...days.filter((d) => d !== day), day]
                    : days.filter((d) => d !== day),
                )
              }
            />
          ))}
        </Stack>
      );
    }
    case "presentation":
      return (
        <Stack direction="row" gap="sm" align="center" wrap="wrap">
          <PresentationChoices
            value={value}
            options={options}
            onChange={onChange}
          />
          <PresentationText value={value} onChange={onChange} />
        </Stack>
      );
    default:
      return null;
  }
}
