/*
 * The moment's own settings under its actions: the flash of the tab title (with its text) when the
 * moment fires on a hidden tab, and how often it shows (repeatedly, per page view, once per visit,
 * once per visitor).
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { Fragment } from "@wordpress/element";
import {
  InputControl,
  RadioGroupControl,
  Stack,
  SwitchControl,
  Text,
} from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { Rule, RuleAttention, RuleFrequency } from "../../../rules/types";

const OFF: RuleAttention = { enabled: false, title: "" };

export function MomentOptions({
  rule,
  onChange,
}: {
  rule: Rule;
  onChange(next: Rule): void;
}) {
  const attention = rule.attention ?? OFF;
  const setAttention = (patch: Partial<RuleAttention>) =>
    onChange({ ...rule, attention: { ...attention, ...patch } });
  return (
    <Fragment>
      <Text variant="heading-lg" render={<h3 />}>
        {__("When user is away", "wordsocket")}
      </Text>
      <Text variant="body-sm" render={<p />}>
        {__(
          "The visitor's browser is open but they are no longer viewing the site. Get their attention by flashing the tab title.",
          "wordsocket",
        )}
      </Text>
      <SwitchControl
        label={__("Flash the tab title?", "wordsocket")}
        checked={attention.enabled}
        onCheckedChange={(enabled) => setAttention({ enabled })}
      />
      {attention.enabled && (
        <Stack
          direction="row"
          gap="md"
          wrap="wrap"
          align="flex-start"
          className="wpsignal-rule-attention"
        >
          <InputControl
            label={__("Tab title while away", "wordsocket")}
            placeholder={__("Still there?", "wordsocket")}
            value={attention.title}
            onValueChange={(title) => setAttention({ title })}
            description={__(
              "Text to display in the tab title when the user is away.",
              "wordsocket",
            )}
          />
        </Stack>
      )}
      <Text variant="heading-lg" render={<h3 />}>
        {__("Other", "wordsocket")}
      </Text>
      {/* A moment that shows again replaces what it showed before, so no choice here stacks prompts. */}
      <RadioGroupControl
        label={__("How often", "wordsocket")}
        value={rule.frequency}
        onValueChange={(frequency) =>
          onChange({ ...rule, frequency: frequency as RuleFrequency })
        }
        items={[
          {
            value: "always",
            label: __("Repeatedly", "wordsocket"),
            description: __(
              "Each time its conditions become true after being false.",
              "wordsocket",
            ),
          },
          {
            value: "page",
            label: __("Per page view", "wordsocket"),
            description: __(
              "At most once on each page the visitor opens.",
              "wordsocket",
            ),
          },
          {
            value: "visit",
            label: __("Once per visit", "wordsocket"),
            description: __(
              "Once, until the tab is closed or the visitor has been away for 30 minutes.",
              "wordsocket",
            ),
          },
          {
            value: "visitor",
            label: __("Once per visitor", "wordsocket"),
            description: __(
              "Once in this browser, until the moment is edited.",
              "wordsocket",
            ),
          },
        ]}
      />
    </Fragment>
  );
}
