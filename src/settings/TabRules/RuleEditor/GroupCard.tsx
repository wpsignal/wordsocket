/*
 * One group as a card: the header sentence picks all or any, each item sits in a slot with its join
 * word and a grip. A nested group is always the other kind to its parent, states its kind and offers
 * no further nesting. Items reorder within their group only: by dragging the grip (the slots are
 * the drop targets, the side of the slot under the pointer decides before or after) or by the
 * arrow keys on a focused grip. Rows are keyed by the item, not its position, so a move carries a
 * row's uncommitted draft with the item it belongs to.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useEffect, useId, useRef, useState } from "@wordpress/element";
import type { DragEvent, ReactNode } from "react";
import { Button, Card, Icon, Stack, Text, Tooltip } from "@wordpress/ui";
import { info } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import type { RuleGroup, RuleNode } from "../../../rules/types";
import { isGroup } from "../../../rules/types";
import { newCondition } from "../model";
import { Choice } from "../ValueControl";
import { useRules } from "../context";
import { ConditionRow } from "./ConditionRow";
import { MoveHandle } from "./MoveHandle";
import { RemoveButton } from "./RemoveButton";
import { itemsOf, modeOf, withItems, type Mode } from "./groups";
import { dragging, dropIndex, moveItem } from "./reorder";
import { HelpToolTip } from "../../HelpToolTip";

export function GroupCard({
  group,
  depth,
  hint,
  handle,
  onChange,
  onRemove,
}: {
  group: RuleGroup;
  depth: number;
  hint?: string;
  handle?: ReactNode;
  onChange(next: RuleGroup): void;
  onRemove?(): void;
}) {
  const { vocabulary, kinds } = useRules();
  const mode = modeOf(group);
  const items = itemsOf(group);
  const other: Mode = mode === "all" ? "any" : "all";
  const set = (next: RuleNode[]) => onChange(withItems(mode, next));
  /* A key per item object; an edit's new object inherits the key, so the row stays mounted. */
  const ids = useRef(new WeakMap<RuleNode, number>());
  const nextId = useRef(0);
  const keyOf = (node: RuleNode) => {
    let id = ids.current.get(node);
    if (id === undefined) {
      id = ++nextId.current;
      ids.current.set(node, id);
    }
    return id;
  };
  const replaceAt = (index: number, node: RuleNode) => {
    ids.current.set(node, keyOf(items[index]));
    set(items.map((n, i) => (i === index ? node : n)));
  };
  /*
   * After a removal the row that had focus is gone, so focus moves to this group's "Add a
   * condition" once React has rendered.
   */
  const addRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      addRef.current?.focus();
    }
  });
  const removeAt = (index: number) => {
    refocus.current = true;
    set(items.filter((_, i) => i !== index));
  };
  /*
   * Reordering. A keyboard move re-renders the grip under a new slot, so focus is put back on it
   * by its position once React has rendered. The drag source lives in `reorder.ts`; a slot only
   * reacts to a drag from this group.
   */
  const gid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<number | null>(null);
  const [over, setOver] = useState<{
    index: number;
    side: "before" | "after";
  } | null>(null);
  const [lifted, setLifted] = useState<number | null>(null);
  useEffect(() => {
    if (focusAfterMove.current === null) return;
    const to = focusAfterMove.current;
    focusAfterMove.current = null;
    rootRef.current
      ?.querySelector<HTMLElement>(
        `[data-handle-group="${gid}"][data-handle-index="${to}"]`,
      )
      ?.focus();
  });
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    focusAfterMove.current = to;
    set(moveItem(items, from, to));
  };
  const sideOf = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  };
  const slotProps = (index: number) => ({
    onDragOver(event: DragEvent<HTMLDivElement>) {
      const source = dragging();
      if (!source || source.group !== gid || source.index === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const side = sideOf(event);
      if (over?.index !== index || over.side !== side) setOver({ index, side });
    },
    onDragLeave(event: DragEvent<HTMLDivElement>) {
      if (event.currentTarget.contains(event.relatedTarget as Node | null))
        return;
      if (over?.index === index) setOver(null);
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      const source = dragging();
      setOver(null);
      if (!source || source.group !== gid) return;
      event.preventDefault();
      moveTo(source.index, dropIndex(source.index, index, sideOf(event)));
    },
  });
  const labelOf = (node: RuleNode) =>
    isGroup(node)
      ? __("the group", "wordsocket")
      : vocabulary.conditions.find((c) => c.key === node.condition)?.label ??
        node.condition;
  /*
   * Switching the kind flips every nested group to the new opposite, so a group never matches its
   * parent (which would merely flatten).
   */
  const switchMode = (next: Mode) =>
    onChange(
      withItems(
        next,
        items.map((node) =>
          isGroup(node)
            ? withItems(next === "all" ? "any" : "all", itemsOf(node))
            : node,
        ),
      ),
    );
  const join =
    mode === "all" ? __("and", "wordsocket") : __("or", "wordsocket");
  const modeLabel =
    mode === "all"
      ? __("all of these", "wordsocket")
      : __("any of these", "wordsocket");

  return (
    <Card.Root
      ref={rootRef}
      className="wpsignal-rule-group"
      data-mode={mode}
      data-depth={depth}
    >
      <Card.Header>
        <Stack direction="row" gap="sm" align="flex-start">
          <Stack direction="column" gap="xs" className="wpsignal-rule-item">
            <Stack direction="row" gap="sm" align="center" wrap="wrap">
              {handle}
              {depth === 0 ? (
                <>
                  <Text variant="heading-sm">
                    {__("The moment", "wordsocket")}
                  </Text>
                  <Choice
                    label={__("Match", "wordsocket")}
                    hideLabel
                    value={mode}
                    options={[
                      { value: "all", label: __("all of these", "wordsocket") },
                      { value: "any", label: __("any of these", "wordsocket") },
                    ]}
                    onChange={(next) => switchMode(next as Mode)}
                  />
                </>
              ) : (
                <Text
                  variant="heading-sm"
                  className="wpsignal-rule-group__mode"
                >
                  {modeLabel}
                </Text>
              )}
              <Text>{__("are true", "wordsocket")}</Text>
              {hint && <HelpToolTip hint={hint} />}
            </Stack>
          </Stack>
          {onRemove && (
            <RemoveButton
              label={__("Remove this group", "wordsocket")}
              onClick={onRemove}
            />
          )}
        </Stack>
      </Card.Header>
      <Card.Content>
        <Stack direction="row" gap="md" wrap="wrap">
          {items.map((node, index) => {
            const slotId = `${gid}-${index}`;
            const grip = (
              <MoveHandle
                label={labelOf(node)}
                group={gid}
                index={index}
                count={items.length}
                elementId={slotId}
                onMove={(to) => moveTo(index, to)}
                onDragState={(active) => setLifted(active ? index : null)}
              />
            );
            return (
              <div
                key={keyOf(node)}
                id={slotId}
                className="wpsignal-rule-slot"
                data-drop={over?.index === index ? over.side : undefined}
                data-lifted={lifted === index ? "1" : undefined}
                {...slotProps(index)}
              >
                <Stack
                  direction="row"
                  gap="md"
                  align={isGroup(node) ? "flex-start" : "center"}
                >
                  <Text variant="body-sm" className="wpsignal-rule-join">
                    {index ? join : ""}
                  </Text>
                  <div className="wpsignal-rule-item">
                    {isGroup(node) ? (
                      <GroupCard
                        group={node}
                        depth={depth + 1}
                        handle={grip}
                        onChange={(next) =>
                          itemsOf(next).length === 0
                            ? removeAt(index)
                            : replaceAt(index, next)
                        }
                        onRemove={() => removeAt(index)}
                      />
                    ) : (
                      <ConditionRow
                        condition={node}
                        handle={grip}
                        onChange={(next) => replaceAt(index, next)}
                        onRemove={() => removeAt(index)}
                      />
                    )}
                  </div>
                </Stack>
              </div>
            );
          })}
          {items.length === 0 && (
            <Text variant="body-sm" className="wpsignal-muted">
              {__("No conditions yet.", "wordsocket")}
            </Text>
          )}
          <Stack
            direction="row"
            gap="lg"
            style={{ flexBasis: "100%" }}
            wrap="wrap"
            className="wpsignal-rule-adders"
          >
            <Button
              ref={addRef}
              variant="minimal"
              onClick={() => set([...items, newCondition(vocabulary, kinds)])}
            >
              {__("+ Add a condition", "wordsocket")}
            </Button>
            {depth === 0 && (
              <Button
                variant="minimal"
                onClick={() =>
                  set([
                    ...items,
                    withItems(other, [newCondition(vocabulary, kinds)]),
                  ])
                }
              >
                {__("+ Add a group", "wordsocket")}
              </Button>
            )}
          </Stack>
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}
