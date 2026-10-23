/*
 * The builder for one moment: the name, the If card of conditions, the Then card of actions and
 * options, the replay aside, Save and Cancel. Every control is driven by the vocabulary PHP sent,
 * so an extension's conditions and actions appear with no change here.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useRef, useState } from "@wordpress/element";
import { Button, Icon, Notice, Stack, Text } from "@wordpress/ui";
import { arrowDown } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import type { Rule } from "../../../rules/types";
import { ReplayPanel } from "../ReplayPanel";
import { useRules } from "../context";
import { useUnsavedChanges } from "../../useUnsavedChanges";
import { GroupCard } from "./GroupCard";
import { ThenCard } from "./ThenCard";
import { itemsOf } from "./groups";

interface Props {
  rule: Rule;
  saving: boolean;
  onSave(rule: Rule): void;
  onCancel(): void;
}

type Field = "name" | "conditions" | "actions";

export function RuleEditor({ rule: initial, saving, onSave, onCancel }: Props) {
  const { history } = useRules();
  const [rule, setRule] = useState<Rule>(initial);
  const [error, setError] = useState<{ field: Field; message: string } | null>(
    null,
  );
  const nameRef = useRef<HTMLInputElement>(null);
  /* Dirty is any difference from the rule the builder opened with; leaving then asks first. */
  useUnsavedChanges(JSON.stringify(rule) !== JSON.stringify(initial));
  const ifRef = useRef<HTMLDivElement>(null);
  const thenRef = useRef<HTMLDivElement>(null);

  /*
   * The message sits beside what is wrong and the page moves there, since Save may be a screen
   * below it.
   */
  const fail = (field: Field, message: string) => {
    setError({ field, message });
    if (field === "name") nameRef.current?.focus();
    const card = field === "conditions" ? ifRef.current : thenRef.current;
    if (field !== "name")
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const submit = () => {
    if (!rule.name.trim())
      return fail("name", __("Give the moment a name.", "wordsocket"));
    if (itemsOf(rule.conditions).length === 0)
      return fail(
        "conditions",
        __("A moment needs at least one condition.", "wordsocket"),
      );
    if (rule.actions.length === 0)
      return fail(
        "actions",
        __("A moment needs at least one action.", "wordsocket"),
      );
    setError(null);
    onSave({ ...rule, name: rule.name.trim() });
  };
  const problem = (field: Field) =>
    error?.field === field ? (
      <Notice.Root intent="error">
        <Notice.Description>{error.message}</Notice.Description>
      </Notice.Root>
    ) : null;

  return (
    <div
      className={
        "wpsignal-rule-editor" + (history.provider ? " has-replay" : "")
      }
      data-rule-id={rule.id}
    >
      <Stack direction="column" gap="xl" className="wpsignal-rule-editor__main">
        {/* The name is the heading, edited in place; a new moment starts there, an edit does not. */}
        <Text
          variant="heading-lg"
          render={<div className="wpsignal-rule-title" />}
        >
          <input
            ref={nameRef}
            type="text"
            name="rule_name"
            maxLength={120}
            autoFocus={initial.name.trim() === ""}
            aria-label={__("Name", "wordsocket")}
            placeholder={__("Name this moment", "wordsocket")}
            value={rule.name}
            onChange={(event) =>
              setRule({ ...rule, name: event.currentTarget.value })
            }
          />
        </Text>
        {problem("name")}

        <div ref={ifRef}>
          <GroupCard
            group={rule.conditions}
            depth={0}
            hint={__(
              "Checked in the visitor's browser on every page and on every change.",
              "wordsocket",
            )}
            onChange={(conditions) => setRule({ ...rule, conditions })}
          />
        </div>
        {problem("conditions")}

        <Stack direction="row" gap="sm" align="center" justify="center">
          <Icon icon={arrowDown} size={36} />
        </Stack>

        <div ref={thenRef}>
          <ThenCard rule={rule} onChange={setRule} />
        </div>
        {problem("actions")}
        <Stack direction="row" gap="sm" align="center">
          <Button
            variant="solid"
            tone="brand"
            onClick={submit}
            loading={saving}
            disabled={saving}
          >
            {__("Save moment", "wordsocket")}
          </Button>
          <Button variant="minimal" onClick={onCancel} disabled={saving}>
            {__("Cancel", "wordsocket")}
          </Button>
        </Stack>
      </Stack>

      <ReplayPanel rule={rule} />
    </div>
  );
}
