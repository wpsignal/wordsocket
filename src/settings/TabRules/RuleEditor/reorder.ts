/*
 * Reordering within one group: the pure move, and the one drag in flight (HTML5 drag data is
 * unreadable until the drop, so the source is remembered here for the targets to check).
 */

export interface Dragging {
  group: string;
  index: number;
}

let current: Dragging | null = null;

export function dragging(): Dragging | null {
  return current;
}

export function setDragging(next: Dragging | null): void {
  current = next;
}

/** `items` with the item at `from` moved so that it sits at `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const bounded = Math.max(0, Math.min(items.length - 1, to));
  if (from === bounded) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(bounded, 0, moved);
  return next;
}

/** The index an item dropped on `index`'s `side` lands at, once the source at `from` is lifted out. */
export function dropIndex(
  from: number,
  index: number,
  side: "before" | "after",
): number {
  const target = side === "after" ? index + 1 : index;
  return from < target ? target - 1 : target;
}
