/**
 * WordPress dependencies.
 */
import { useSelect, useDispatch } from "@wordpress/data";
import { store as noticesStore } from "@wordpress/notices";
import { SnackbarList } from "@wordpress/components";

/** Toasts shown at once; older ones wait their turn, as in the block editor. */
const MAX_VISIBLE = 3;

/**
 * The "Settings saved." toasts. Any tab, WordSocket's own or an extension's,
 * dispatches to core's `core/notices` store with `type: "snackbar"`
 * (`createSuccessNotice`, `createErrorNotice`) and this list stacks them
 * bottom-left, each dismissing itself after ten seconds (a `useTask`
 * pending toast is held until its task settles). One list for the whole page,
 * so an extension needs no notice state of its own. Core styles every
 * snackbar the same; the status class (`is-error` is red) is ours.
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
