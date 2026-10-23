/*
 * The grip at the start of a condition or a nested group: drag it with the mouse, or move the item
 * with the arrow keys while it has focus.
 */

/**
 * WordPress dependencies.
 */
import { __, sprintf } from "@wordpress/i18n";
import { speak } from "@wordpress/a11y";
import { Draggable } from "@wordpress/components";
import { IconButton } from "@wordpress/ui";
import { dragHandle } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import { setDragging } from "./reorder";

export function MoveHandle({
  label,
  group,
  index,
  count,
  elementId,
  onMove,
  onDragState,
}: {
  label: string;
  group: string;
  index: number;
  count: number;
  elementId: string;
  onMove(to: number): void;
  onDragState(active: boolean): void;
}) {
  const move = (to: number) => {
    const bounded = Math.max(0, Math.min(count - 1, to));
    if (bounded === index) return;
    onMove(bounded);
    speak(
      sprintf(
        /* translators: 1: the item's label, 2: its new position, 3: how many items there are */
        __("%1$s moved to position %2$d of %3$d.", "wordsocket"),
        label,
        bounded + 1,
        count,
      ),
    );
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    move(keys[event.key]);
  };
  return (
    <span className="wpsignal-rule-move">
      <Draggable
        elementId={elementId}
        transferData={{ group, index }}
        appendToOwnerDocument
        onDragStart={() => {
          setDragging({ group, index });
          onDragState(true);
        }}
        onDragEnd={() => {
          setDragging(null);
          onDragState(false);
        }}
      >
        {({ onDraggableStart, onDraggableEnd }) => (
          <IconButton
            className="wpsignal-rule-move__grip"
            variant="minimal"
            size="small"
            tone="neutral"
            icon={dragHandle}
            label={sprintf(
              /* translators: %s: the item's label */
              __("Move %s (drag, or use the arrow keys)", "wordsocket"),
              label,
            )}
            draggable
            onDragStart={onDraggableStart}
            onDragEnd={onDraggableEnd}
            onKeyDown={onKeyDown}
            data-handle-group={group}
            data-handle-index={index}
          />
        )}
      </Draggable>
    </span>
  );
}
