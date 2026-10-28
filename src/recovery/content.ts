/*
 * What a prompt shows, as a DOM node: `{ text }` with `{key.path}` placeholders inserted as text,
 * `{ node }` as given, or `{ pattern }` rendered by WordPress with the text as fallback.
 */

export interface PromptContent {
  text?: string;
  node?: Node;
  /** A `wp_block` post id, 0 for none. */
  pattern?: number;
}

export type PromptContext = Record<string, unknown>;

const PLACEHOLDER = /\{([a-z_][\w.]*)\}/gi;

/** A dotted path read from the context, '' when any step is missing. */
function lookup(ctx: PromptContext, path: string): string {
  let value: unknown = ctx;
  for (const key of path.split(".")) {
    if (
      value === null ||
      typeof value !== "object" ||
      !(key in (value as object))
    )
      return "";
    value = (value as Record<string, unknown>)[key];
  }
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? "" : String(value);
}

/** The built-in context every prompt may name. */
export function baseContext(): PromptContext {
  return {
    page: { title: document.title },
    site: { name: window.wpSignalConfig?.siteName ?? "" },
  };
}

/** Fill a text's placeholders from the context. */
export function fillText(text: string, ctx: PromptContext = {}): string {
  const merged = { ...baseContext(), ...ctx };
  return text.replace(PLACEHOLDER, (_, path: string) => lookup(merged, path));
}

export function resolveContent(
  content: PromptContent,
  ctx: PromptContext = {},
  pattern?: Node | null,
): Node {
  if (content.node) return content.node;
  if (pattern) return pattern;
  const p = document.createElement("p");
  p.className = "wordsocket-prompt__text";
  p.textContent = fillText(content.text ?? "", ctx);
  return p;
}
