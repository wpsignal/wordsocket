/**
 * WordPress dependencies.
 */
import { useSelect, useDispatch } from "@wordpress/data";
import { store as noticesStore } from "@wordpress/notices";
import { SnackbarList } from "@wordpress/components";

/** Toasts shown at once; older ones wait their turn, as in the block editor. */
const MAX_VISIBLE = 3;

/**
 * The toasts: every tab dispatches to core's `core/notices` store with `type: "snackbar"` and this
 * one list shows them, each dismissing itself after ten seconds. Core styles every snackbar alike;
 * the status class is ours.
 */
export function Snackbars() {
  const notices = useSelect(
    (select) =>
      select(noticesStore)
        .getNotices()
        .filter((notice) => notice.type === "snackbar")
        .slice(-MAX_VISIBLE)
        .map((notice) => ({ ...notice, className: `is-${notice.status}` })),
    [],
  );
  const { removeNotice } = useDispatch(noticesStore);

  return (
    <SnackbarList
      className="wpsignal-snackbars"
      notices={notices}
      onRemove={removeNotice}
    />
  );
}
