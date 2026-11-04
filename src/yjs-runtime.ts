/*
 * The editor's Yjs instance, held for whatever needs it.
 */

/** The part of the Yjs module surface this plugin and y-protocols use. */
interface YjsModule {
  encodeStateVector(doc: YDoc): Uint8Array;
  encodeStateAsUpdate(
    doc: YDoc,
    encodedTargetStateVector?: Uint8Array,
  ): Uint8Array;
  applyUpdate(doc: YDoc, update: Uint8Array, transactionOrigin?: unknown): void;
}

let instance: YjsModule | null = null;

/**
 * The instance passed by the editor, or the global on Gutenberg before 23.9.
 *
 * @since 0.26.0
 */
export function resolveYjs(passed?: YjsModule): YjsModule | null {
  return (
    passed ??
    (window as { wp?: { sync?: { Y?: YjsModule } } }).wp?.sync?.Y ??
    null
  );
}

/**
 * Hold the editor's instance for the rest of the module graph.
 *
 * @since 0.26.0
 */
export function setYjs(y: YjsModule): void {
  instance = y;
}

function yjs(): YjsModule {
  if (!instance) {
    throw new Error(
      "WordSocket: the editor's Yjs instance was never provided.",
    );
  }
  return instance;
}

/**
 * Encode a doc's state vector.
 *
 * @since 0.26.0
 */
export function encodeStateVector(doc: YDoc): Uint8Array {
  return yjs().encodeStateVector(doc);
}

/**
 * Encode a doc's state as an update, relative to a target state vector when given.
 *
 * @since 0.26.0
 */
export function encodeStateAsUpdate(
  doc: YDoc,
  encodedTargetStateVector?: Uint8Array,
): Uint8Array {
  return yjs().encodeStateAsUpdate(doc, encodedTargetStateVector);
}

/**
 * Apply an update to a doc.
 *
 * @since 0.26.0
 */
export function applyUpdate(
  doc: YDoc,
  update: Uint8Array,
  transactionOrigin?: unknown,
): void {
  yjs().applyUpdate(doc, update, transactionOrigin);
}

export type { YjsModule };
