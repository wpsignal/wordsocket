/*
 * Unsaved changes: a form reports whether it is dirty, and every way of leaving it asks first.
 * - `useUnsavedChanges( dirty )` in the form: a `beforeunload` prompt while dirty (refresh, close,
 *   the admin menu) and the flag the in-app guards read.
 * - `useLeaveGuard()` for a Back or Cancel control: `guard( leave )` runs `leave` at once when
 *   nothing is dirty, else after the "Discard changes?" dialog is confirmed.
 * - `UnsavedChangesProvider` at the app root owns the flag and the one dialog, guards the tab list
 *   the same way (a click or arrow key on another tab), and is the navigation guard Back and
 *   Forward go through (`useUrlParam.ts`).
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
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

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

const TAB_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End"];

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

  /*
   * TabPanel selects on its own, so the tab list is guarded one step earlier: a click or a key
   * on a tab that is not the current one is swallowed and replayed after the confirm.
   */
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>(
      '[role="tab"]',
    );
    if (!tab || !dirty.current || tab.getAttribute("aria-selected") === "true")
      return;
    event.preventDefault();
    event.stopPropagation();
    guard(() => tab.click());
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>(
      '[role="tab"]',
    );
    if (!tab || !dirty.current || !TAB_KEYS.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    /* The key's own target, worked out here since the list will not see the key: wrapping like the list does. */
    const tabs = Array.from(
      tab.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
    ).filter((t) => t.getAttribute("aria-disabled") !== "true");
    const at = tabs.indexOf(tab);
    const target = {
      ArrowLeft: tabs[(at - 1 + tabs.length) % tabs.length],
      ArrowRight: tabs[(at + 1) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    }[event.key];
    if (target && target !== tab) guard(() => target.click());
  };

  return (
    <GuardContext.Provider value={value}>
      <div onClickCapture={onClickCapture} onKeyDownCapture={onKeyDownCapture}>
        {children}
      </div>
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

/** Report whether the form is dirty; while it is, leaving the page prompts. */
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

/** `guard( leave )`: run `leave` now, or once the visitor agrees to discard their changes. */
export function useLeaveGuard(): Guard["guard"] {
  return useContext(GuardContext).guard;
}
