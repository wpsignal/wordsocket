/**
 * WordPress dependencies.
 */
import { useCallback, useRef, useState } from "@wordpress/element";
import { useDispatch } from "@wordpress/data";
import { store as noticesStore } from "@wordpress/notices";
import { __ } from "@wordpress/i18n";

/** Pending toasts are held open until their task settles; each gets its own id. */
let sequence = 0;

function text<T>(
  value: string | ((input: T) => string) | undefined,
  input: T,
): string | undefined {
  return typeof value === "function" ? value(input) : value;
}

/** The message an error carries, if any: `Error`, an apiFetch error object, or a string. */
function messageOf(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" && message ? message : undefined;
  }
  return undefined;
}

/**
 * Run an async task and report each phase as a toast (an optional held pending one, then success or
 * error), tracking `phase` for the caller's UI and answering with the outcome instead of throwing.
 * Options and the task are read fresh on every run, so closures are never stale; also published as
 * `window.wordsocket.useTask`.
 */
export function useTask<Args extends unknown[], Result>(
  task: (...args: Args) => Promise<Result>,
  options: WordSocketTaskOptions<Args, Result> = {},
): WordSocketTask<Args, Result> {
  const [phase, setPhase] = useState<WordSocketTaskPhase>("idle");
  const [error, setError] = useState<unknown>(null);
  const { createNotice, removeNotice } = useDispatch(noticesStore);

  const latest = useRef({ task, options });
  latest.current = { task, options };
  const current = useRef(0);

  const run = useCallback(
    async (...args: Args): Promise<WordSocketTaskOutcome<Result>> => {
      const { task: fn, options: opts } = latest.current;
      const id = ++sequence;
      current.current = id;
      const pendingId = `wordsocket-task-${id}`;
      const isLatest = () => current.current === id;

      setPhase("pending");
      setError(null);
      if (opts.pending) {
        createNotice("info", opts.pending, {
          id: pendingId,
          type: "snackbar",
          explicitDismiss: true,
        });
      }

      let outcome: WordSocketTaskOutcome<Result>;
      try {
        outcome = { ok: true, value: await fn(...args) };
      } catch (caught) {
        outcome = { ok: false, error: caught };
      }

      if (opts.pending) removeNotice(pendingId);

      if (outcome.ok) {
        if (isLatest()) setPhase("success");
        const message = text(opts.success, outcome.value);
        /* The id is the message, so three quick saves show one "Rules saved." rather than a stack. */
        if (message)
          createNotice("success", message, {
            type: "snackbar",
            id: `wordsocket-success:${message}`,
          });
        opts.onSuccess?.(outcome.value, ...args);
      } else {
        if (isLatest()) {
          setPhase("error");
          setError(outcome.error);
        }
        const message =
          typeof opts.error === "function"
            ? opts.error(outcome.error)
            : messageOf(outcome.error) ||
              opts.error ||
              __("Something went wrong.", "wordsocket");
        createNotice("error", message, {
          type: "snackbar",
          id: `wordsocket-error:${message}`,
        });
        opts.onError?.(outcome.error, ...args);
      }
      opts.onSettled?.(outcome, ...args);
      return outcome;
    },
    [createNotice, removeNotice],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  return { run, phase, isPending: phase === "pending", error, reset };
}
