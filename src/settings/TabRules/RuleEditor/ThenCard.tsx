/*
 * The Then card: the moment's actions, "Add an action", and the moment's options.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useRef } from "@wordpress/element";
import { Button, Card, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import type { Rule } from "../../../rules/types";
import { newAction } from "../model";
import { useRules } from "../context";
import { ActionRow } from "./ActionRow";
import { MomentOptions } from "./MomentOptions";

export function ThenCard({
  rule,
  onChange,
}: {
  rule: Rule;
  onChange(next: Rule): void;
}) {
  const { vocabulary, kinds } = useRules();
  /* After a removal focus moves to "Add an action" once React has rendered. */
  const addRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      addRef.current?.focus();
    }
  });
  return (
    <Card.Root className="wpsignal-rule-then">
      <Card.Header>
        <Text variant="heading-sm">{__("Then", "wordsocket")}</Text>
      </Card.Header>
      <Card.Content>
        <Stack direction="column" gap="lg">
          {rule.actions.map((action, index) => (
            <ActionRow
              key={index}
              action={action}
              onChange={(next) =>
                onChange({
                  ...rule,
                  actions: rule.actions.map((a, i) => (i === index ? next : a)),
                })
              }
              onRemove={() => {
                refocus.current = true;
                onChange({
                  ...rule,
                  actions: rule.actions.filter((_, i) => i !== index),
                });
              }}
            />
          ))}
          {rule.actions.length === 0 && (
            <Text variant="body-sm" className="wpsignal-muted">
              {__("Nothing happens yet.", "wordsocket")}
            </Text>
          )}
          <Stack direction="row" gap="lg" wrap="wrap">
            <Button
              ref={addRef}
              variant="minimal"
              onClick={() =>
                onChange({
                  ...rule,
                  actions: [...rule.actions, newAction(vocabulary, kinds)],
                })
              }
            >
              {__("+ Add an action", "wordsocket")}
            </Button>
          </Stack>
          <MomentOptions rule={rule} onChange={onChange} />
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}
