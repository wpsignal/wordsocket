/*
 * The presentations a prompt can take (`modal`, `banner`, `bar`, `toast`, `panel`) and the registry
 * extensions add to; a mount owns its markup and answers `open` and `close`. Markup is
 * `wordsocket-prompt` prefixed and themed through `--wordsocket-prompt-*` in `recovery.css`.
 */

export interface PromptMount {
  open(node: Node): void;
  close(): void;
}

export type PresentationMount = (
  root: HTMLElement,
  close: () => void,
) => PromptMount;

const TOAST_MS = 8_000;

const registry = new Map<string, PresentationMount>();

/** Register a presentation under a key, replacing any earlier one. */
export function registerPresentation(
  key: string,
  mount: PresentationMount,
): void {
  registry.set(key, mount);
}

/** The mount for a key, falling back to the banner for an unknown one. */
export function presentationFor(key: string): PresentationMount {
  return registry.get(key) ?? registry.get("banner")!;
}

/** The layer every prompt mounts into, created on first use. */
export function promptLayer(): HTMLElement {
  let layer = document.getElementById("wordsocket-prompts");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "wordsocket-prompts";
    document.body.appendChild(layer);
  }
  return layer;
}

function closeButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wordsocket-prompt__close";
  button.setAttribute("aria-label", label);
  button.textContent = "×";
  button.addEventListener("click", onClick);
  return button;
}

/** A box with the content slot and a close button, shared by every built-in but the dialog. */
function box(kind: string, root: HTMLElement, close: () => void): PromptMount {
  const el = document.createElement("div");
  el.className = `wordsocket-prompt wordsocket-prompt--${kind}`;
  el.setAttribute("role", kind === "panel" ? "dialog" : "status");
  const body = document.createElement("div");
  body.className = "wordsocket-prompt__body";
  el.append(body, closeButton("Dismiss", close));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    open(node) {
      body.replaceChildren(node);
      root.appendChild(el);
      requestAnimationFrame(() => el.classList.add("is-open"));
      if (
        kind === "toast" &&
        !el.querySelector("form, input, textarea, select")
      ) {
        /* A toast into a hidden tab would close unseen, so its clock starts once the tab is visible. */
        const arm = () => {
          if (document.hidden) {
            document.addEventListener("visibilitychange", arm, { once: true });
            return;
          }
          timer = setTimeout(close, TOAST_MS);
        };
        arm();
      }
    },
    close() {
      clearTimeout(timer);
      el.classList.remove("is-open");
      el.remove();
    },
  };
}

registerPresentation("banner", (root, close) => box("banner", root, close));
registerPresentation("bar", (root, close) => box("bar", root, close));
registerPresentation("toast", (root, close) => box("toast", root, close));
registerPresentation("panel", (root, close) => box("panel", root, close));

registerPresentation("modal", (root, close) => {
  const dialog = document.createElement("dialog");
  dialog.className = "wordsocket-prompt wordsocket-prompt--modal";
  const body = document.createElement("div");
  body.className = "wordsocket-prompt__body";
  dialog.append(body, closeButton("Close", close));
  /*
   * Escape fires `cancel` before `close`, so closing on `cancel` keeps the state in step with the
   * screen; the button and a backdrop click call `close` too.
   */
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  return {
    open(node) {
      body.replaceChildren(node);
      root.appendChild(dialog);
      document.body.classList.add("wordsocket-prompt-open");
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
    close() {
      document.body.classList.remove("wordsocket-prompt-open");
      // `removeEventListener` first: `dialog.close()` fires `close` again.
      dialog.removeEventListener("close", close);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
});
