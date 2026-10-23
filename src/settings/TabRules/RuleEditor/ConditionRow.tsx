/*
 * One condition: the condition select, its operator when it has more than one, and its value.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import type { ReactNode } from "react";
import { Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { RuleCondition } from "../../../rules/types";
import { defaultValue, type ConditionSpec } from "../model";
import { Choice, ValueControl } from "../ValueControl";
import { useRules } from "../context";
import { RemoveButton } from "./RemoveButton";
import { HelpToolTip } from "../../HelpToolTip";

export function ConditionRow({
  condition,
  handle,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  handle?: ReactNode;
  onChange(next: RuleCondition): void;
  onRemove(): void;
}) {
  const { vocabulary, kinds } = useRules();
  const spec: ConditionSpec | undefined = vocabulary.conditions.find(
    (c) => c.key === condition.condition,
  );
  const pick = (key: string) => {
    const next = vocabulary.conditions.find((c) => c.key === key);
    if (!next) return;
    onChange({
      condition: key,
      op: next.operators[0]?.key ?? "is",
      value: defaultValue(next.value, next.options, kinds),
    });
  };
  return (
    <Stack
      direction="column"
      gap="xs"
      className="wpsignal-rule-condition"
      data-condition={condition.condition}
    >
      <Stack direction="row" gap="sm" align="flex-start">
        <Stack
          direction="row"
          gap="sm"
          align="center"
          wrap="wrap"
          className="wpsignal-rule-item wpsignal-rule-condition-item"
        >
          {handle}
          {spec?.description && <HelpToolTip hint={spec.description} />}
          <Choice
            label={__("Condition", "wordsocket")}
            hideLabel
            value={condition.condition}
            options={[
              ...vocabulary.conditions.map((c) => ({
                value: c.key,
                label: c.label,
              })),
              ...(spec
                ? []
                : [
                    {
                      value: condition.condition,
                      label: `${condition.condition} (${__(
                        "unavailable",
                        "wordsocket",
                      )})`,
                    },
                  ]),
            ]}
            onChange={pick}
          />
          {spec && spec.operators.length > 1 && (
            <Choice
              label={__("Operator", "wordsocket")}
              hideLabel
              value={condition.op}
              options={spec.operators.map((o) => ({
                value: o.key,
                label: o.label,
              }))}
              onChange={(op) => onChange({ ...condition, op })}
            />
          )}
          {spec && (
            <ValueControl
              type={spec.value}
              value={condition.value}
              options={spec.options}
              onChange={(value) => onChange({ ...condition, value })}
            />
          )}
          <RemoveButton
            label={sprintf(
              /* translators: %s: the condition's label */ __(
                'Remove the "%s" condition',
                "wordsocket",
              ),
              spec?.label ?? condition.condition,
            )}
            onClick={onRemove}
          />
        </Stack>
      </Stack>
    </Stack>
  );
}
