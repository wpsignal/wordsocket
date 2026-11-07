/*
 * A notice the user can close for good: the ids closed live in their user meta, printed into the
 * settings config so nothing paints before it is hidden, and saved through the REST API on close.
 */

/**
 * WordPress dependencies.
 */
import { useState } from "@wordpress/element";
import { Notice } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { saveDismissedNotices } from "./api";

/* The ids closed, shared by every notice on the page and seeded from the printed config. */
const dismissed = new Set<string>(window.wpsignalSettings?.dismissed ?? []);

/**
 * The notice, gone once closed and not back on the next visit; `actions` are its buttons, `Notice.ActionButton`s.
 *
 * @since 0.31.0
 * @since 0.31.0 Takes `actions`.
 */
export function DismissibleNotice({
  id,
  title,
  intent = "warning",
  actions,
  children,
}: {
  id: string;
  title: string;
  intent?: React.ComponentProps<typeof Notice.Root>["intent"];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(() => dismissed.has(id));
  if (hidden) return null;
  const close = () => {
    dismissed.add(id);
    setHidden(true);
    void saveDismissedNotices([...dismissed]).catch(() => undefined);
  };
  return (
    <Notice.Root intent={intent}>
      <Notice.Title>{title}</Notice.Title>
      <Notice.Description>{children}</Notice.Description>
      {actions && <Notice.Actions>{actions}</Notice.Actions>}
      <Notice.CloseIconButton onClick={close} />
    </Notice.Root>
  );
}
