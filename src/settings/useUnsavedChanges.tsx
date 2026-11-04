/*
 * Unsaved changes: a form reports whether it is dirty, and every way of leaving it asks first.
 * - `useUnsavedChanges( dirty )` in the form: a `beforeunload` prompt while dirty (refresh, close,
 *   the admin menu) and the flag the in-app guards read.
 * - `useLeaveGuard()` for a Back or Cancel control: `guard( leave )` runs `leave` at once when
 *   nothing is dirty, else after the "Discard changes?" dialog is confirmed.
 * - `UnsavedChangesProvider` at the app root owns the flag and the one dialog, and is the navigation
 *   guard Back and Forward go through (`useUrlParam.ts`); the tab list asks `useLeaveGuard()` before
 *   it switches.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "@wordpress/element";
import { AlertDialog } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { setNavigateGuard } from "./useUrlParam";

/**
 * External dependencies.
 */
import type { ReactNode } from "react";

type Leave = () => void;

interface Guard {
  dirty: { current: boolean };
  /** Run `leave` now or after the dialog is confirmed; `stay` runs when it is declined. */
  guard(leave: Leave, stay?: Leave): void;
}

const GuardContext = createContext<Guard>({
  dirty: { current: false },
  guard: (leave) => leave(),
});

/**
 * Owns the dirty flag and the discard dialog for the app.
 *
 * @since 0.31.0
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  const pending = useRef<{ leave: Leave; stay?: Leave } | null>(null);
  const [asking, setAsking] = useState(false);
  const guard = useCallback((leave: Leave, stay?: Leave) => {
    if (!dirty.current) return leave();
    pending.current = { leave, stay };
    setAsking(true);
  }, []);
  const value = useMemo(() => ({ dirty, guard }), [guard]);
  useEffect(() => {
    setNavigateGuard(guard);
    return () => setNavigateGuard(null);
  }, [guard]);
  /* The dialog settles once: confirm leaves, any other close stays. */
  const settle = (confirmed: boolean) => {
    const choice = pending.current;
    pending.current = null;
    setAsking(false);
    if (!choice) return;
    if (confirmed) {
      dirty.current = false;
      choice.leave();
    } else {
      choice.stay?.();
    }
  };

  return (
    <GuardContext.Provider value={value}>
      {children}
      <AlertDialog.Root
        open={asking}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
        onConfirm={() => {
          settle(true);
          return { close: true };
        }}
      >
        <AlertDialog.Popup
          intent="irreversible"
          title={__("Discard changes?", "wordsocket")}
          description={__(
            "What you changed here has not been saved and will be lost.",
            "wordsocket",
          )}
          confirmButtonText={__("Discard", "wordsocket")}
        />
      </AlertDialog.Root>
    </GuardContext.Provider>
  );
}

/**
 * Report whether the form is dirty; while it is, leaving the page prompts.
 *
 * @since 0.31.0
 */
export function useUnsavedChanges(isDirty: boolean): void {
  const { dirty } = useContext(GuardContext);
  useEffect(() => {
    dirty.current = isDirty;
    if (!isDirty) return;
    const prompt = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Chrome needs the value too.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prompt);
    return () => {
      dirty.current = false;
      window.removeEventListener("beforeunload", prompt);
    };
  }, [dirty, isDirty]);
}

/**
 * `guard( leave )`: run `leave` now, or once the visitor agrees to discard their changes.
 *
 * @since 0.31.0
 */
export function useLeaveGuard(): Guard["guard"] {
  return useContext(GuardContext).guard;
}
