/*
 * One action as a chip that reads like the conditions: "[Show] [banner at the top] with [this text |
 * this pattern] [the pattern]", every registered param inline, Show's text on its own line of the
 * chip. An action is `{ action, ...params }`, so the params sit beside the key.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { Badge, Stack, SwitchControl, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { RuleAction } from "../../../rules/types";
import { newAction, type ActionSpec } from "../model";
import { Choice, ValueControl } from "../ValueControl";
import { useRules } from "../context";
import { HelpToolTip } from "../../HelpToolTip";
import { PresentationChoices, PresentationText } from "./Presentation";
import { RemoveButton } from "./RemoveButton";

export function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  onChange(next: RuleAction): void;
  onRemove(): void;
}) {
  const { vocabulary, kinds } = useRules();
  const spec: ActionSpec | undefined = vocabulary.actions.find(
    (a) => a.key === action.action,
  );
  const setParam = (name: string, value: unknown) =>
    onChange({ ...action, [name]: value });
  const params = Object.entries(spec?.params ?? {}).filter(
    ([, param]) => !param.when || Boolean(action[param.when]),
  );
  return (
    <Stack
      direction="row"
      gap="sm"
      align="center"
      wrap="wrap"
      className="wpsignal-rule-item wpsignal-rule-action"
      data-action={action.action}
    >
      {spec?.description && <HelpToolTip hint={spec.description} />}
      {/* Choosing another action starts it with that action's default params. */}
      <Choice
        label={__("Action", "wordsocket")}
        hideLabel
        value={action.action}
        options={vocabulary.actions.map((a) => ({
          value: a.key,
          label: a.label,
        }))}
        onChange={(key) => onChange(newAction(vocabulary, kinds, key))}
      />
      {params.map(([name, param]) =>
        param.type === "presentation" ? (
          <PresentationChoices
            key={name}
            value={action[name]}
            options={param.options}
            onChange={(value) => setParam(name, value)}
          />
        ) : param.type === "boolean" ? (
          <SwitchControl
            key={name}
            label={param.label}
            checked={Boolean(action[name] ?? param.default)}
            onCheckedChange={(value) => setParam(name, value)}
          />
        ) : (
          /* The words and the control wrap as one: "after [20] s" never splits across lines. */
          <Stack key={name} direction="row" gap="sm" align="center">
            {param.prefix && <Text>{param.prefix}</Text>}
            <ValueControl
              type={param.type}
              label={param.label}
              inline
              value={action[name]}
              options={param.options}
              onChange={(value) => setParam(name, value)}
            />
            {param.suffix && <Text>{param.suffix}</Text>}
          </Stack>
        ),
      )}
      {spec?.live && (
        <Badge intent="informational">{__("live", "wordsocket")}</Badge>
      )}
      <RemoveButton
        label={sprintf(
          /* translators: %s: the action's label */ __(
            'Remove the "%s" action',
            "wordsocket",
          ),
          spec?.label ?? action.action,
        )}
        onClick={onRemove}
      />
      {params.map(([name, param]) =>
        param.type === "presentation" ? (
          <PresentationText
            key={name}
            value={action[name]}
            onChange={(value) => setParam(name, value)}
          />
        ) : null,
      )}
    </Stack>
  );
}
