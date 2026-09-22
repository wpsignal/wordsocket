/*
 * The editor's Yjs instance, held for whatever needs it.
 *
 * Gutenberg used to expose Yjs as the global `wp.sync.Y`. Since Gutenberg
 * 23.9 (WordPress/gutenberg#82621) it passes the instance to the provider
 * creator as `options.Y`, and WordPress/gutenberg#81999 removes the global
 * altogether: `wp.sync` is not in WordPress core, so the plugin is dropping it
 * to match. `resolveYjs()` takes whichever of the two a site offers, and
 * `setYjs()` stores it before the provider runs.
 *
 * Everything reads it back through the forwarding functions below, at call
 * time rather than at import time, because the instance only arrives when the
 * editor creates a provider. Webpack also resolves the bare `yjs` specifier to
 * this module (see webpack.config.js), so the bundled y-protocols shares the
 * editor's copy: a second copy of Yjs has its own class identities and would
 * sync nothing.
 */

/** The part of the Yjs module surface this plugin and y-protocols use. */
interface YjsModule {
  encodeStateVector(doc: YDoc): Uint8Array;
  encodeStateAsUpdate(doc: YDoc, encodedTargetStateVector?: Uint8Array): Uint8Array;
  applyUpdate(doc: YDoc, update: Uint8Array, transactionOrigin?: unknown): void;
}

let instance: YjsModule | null = null;

/** The instance passed by the editor, or the global on Gutenberg before 23.9. */
export function resolveYjs(passed?: YjsModule): YjsModule | null {
  return passed ?? (window as { wp?: { sync?: { Y?: YjsModule } } }).wp?.sync?.Y ?? null;
}

/** Hold the editor's instance for the rest of the module graph. */
export function setYjs(y: YjsModule): void {
  instance = y;
}

function yjs(): YjsModule {
  if (!instance) {
    throw new Error("WordSocket: the editor's Yjs instance was never provided.");
  }
  return instance;
}

export function encodeStateVector(doc: YDoc): Uint8Array {
  return yjs().encodeStateVector(doc);
}

export function encodeStateAsUpdate(doc: YDoc, encodedTargetStateVector?: Uint8Array): Uint8Array {
  return yjs().encodeStateAsUpdate(doc, encodedTargetStateVector);
}

export function applyUpdate(doc: YDoc, update: Uint8Array, transactionOrigin?: unknown): void {
  yjs().applyUpdate(doc, update, transactionOrigin);
}

export type { YjsModule };
