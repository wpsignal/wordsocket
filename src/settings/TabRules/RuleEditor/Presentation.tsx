/*
 * Show's `presentation` param as it reads in the Then chip: "[banner at the top] with [this text |
 * this pattern] [the pattern]", the picker right beside the choice that calls for it, and the
 * textarea on the chip's own line. `pattern` 0 is the text; choosing "this pattern" starts on the
 * first synced pattern, so the saved value is never a pattern that is not there.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { Stack, Text, TextareaControl } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { MAX_TEXT, type RulePresentation } from "../../../rules/types";
import { presentationOf } from "../../../rules/vocabulary";
import { Choice } from "../ValueControl";
import { useRules } from "../context";

/** The inline pieces: how to show it, then "with", then text or pattern, with the pattern picker beside its choice. */
export function PresentationChoices({
  value,
  options,
  onChange,
}: {
  value: unknown;
  options: Record<string, string>;
  onChange(next: RulePresentation): void;
}) {
  const { patterns } = useRules();
  const v = presentationOf(value);
  return (
    <>
      <Choice
        label={__("Show as", "wordsocket")}
        hideLabel
        value={v.type}
        options={Object.entries(options).map(([value, label]) => ({
          value,
          label,
        }))}
        onChange={(type) => onChange({ ...v, type })}
      />
      {/* "with", the choice and its picker wrap as one, so the picker is never a line away from its choice. */}
      <Stack direction="row" gap="sm" align="center">
        <Text>{__("with", "wordsocket")}</Text>
        <Choice
          label={__("Content", "wordsocket")}
          hideLabel
          value={v.pattern ? "pattern" : "text"}
          options={[
            { value: "text", label: __("this text", "wordsocket") },
            {
              value: "pattern",
              label: patterns.length
                ? __("this pattern", "wordsocket")
                : __("this pattern (none synced yet)", "wordsocket"),
            },
          ]}
          onChange={(mode) =>
            onChange({
              ...v,
              pattern: mode === "pattern" ? patterns[0]?.id ?? 0 : 0,
            })
          }
        />
        {v.pattern > 0 && (
          <Choice
            label={__("Pattern", "wordsocket")}
            hideLabel
            value={String(v.pattern)}
            options={patterns.map((p) => ({
              value: String(p.id),
              label: p.title,
            }))}
            onChange={(pattern) => onChange({ ...v, pattern: Number(pattern) })}
          />
        )}
      </Stack>
    </>
  );
}

/** The chip's own line: the text while "this text" is chosen; nothing while a pattern is. */
export function PresentationText({
  value,
  onChange,
}: {
  value: unknown;
  onChange(next: RulePresentation): void;
}) {
  const v = presentationOf(value);
  if (v.pattern) return null;
  return (
    <TextareaControl
      className="wpsignal-rule-fill"
      label={__("Text", "wordsocket")}
      hideLabelFromVision
      maxLength={MAX_TEXT}
      placeholder={__(
        "What to show. {page.title} and {site.name} are filled in.",
        "wordsocket",
      )}
      rows={2}
      value={v.text}
      onValueChange={(text) => onChange({ ...v, text })}
    />
  );
}
