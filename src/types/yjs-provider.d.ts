/** Subset of the y-protocols Awareness API used by the provider. */
interface Awareness {
  clientID: number;
  on(event: "change" | "update", handler: AwarenessChangeHandler): void;
  off(event: "change" | "update", handler: AwarenessChangeHandler): void;
  setLocalState(state: Record<string, unknown> | null): void;
}

/** Fired when awareness state changes — carries added, updated, and removed client IDs. */
type AwarenessChangeHandler = (
  changes: { added: number[]; updated: number[]; removed: number[] },
  origin: unknown,
) => void;

/** Options passed by @wordpress/sync when creating a provider instance. */
interface ProviderCreatorOptions {
  objectType: string;
  /** null for collection-level providers (WordPress 7.0 Beta 2+). */
  objectId: string | number | null;
  ydoc: YDoc;
  /**
   * Absent when the sync config defines no createAwareness, which is the case
   * for collection-level providers (e.g. the comments/notes collection).
   */
  awareness?: Awareness;
}

/** Contract @wordpress/sync expects every provider to satisfy. */
interface ProviderCreatorResult {
  destroy(): void;
  on(event: "status", handler: StatusHandler): void;
}

/** Connection state reported to @wordpress/sync via the `status` event. */
type SyncStatus = "connected" | "connecting" | "disconnected";

/**
 * Error codes recognized by the editor's disconnect dialog
 * (packages/editor sync-error-messages). Unknown codes fall back to the
 * "unknown-error" copy. "document-size-limit-exceeded" additionally disables
 * collaboration for the session (core-data collaborationSupported reducer).
 */
type SyncConnectionErrorCode =
  | "authentication-failed"
  | "connection-expired"
  | "connection-limit-exceeded"
  | "document-size-limit-exceeded"
  | "protocol-mismatch"
  | "unknown-error";

/**
 * Status payload delivered via the `status` event and stored by core-data's
 * setSyncConnectionStatus. `canManuallyRetry` is deliberately not supported:
 * the editor's Retry button calls wp.sync privateApis retrySyncConnection(),
 * which only retries core's HTTP polling manager and never reaches
 * third-party providers.
 */
interface SyncConnectionStatus {
  status: SyncStatus;
  /** Error whose `code` selects the editor's disconnect dialog copy. */
  error?: Error & { code: SyncConnectionErrorCode };
  /** On a disconnected status, the editor shows an auto-retry countdown. */
  willAutoRetryInMs?: number;
}

/** Handler registered via `provider.on("status", handler)`. */
type StatusHandler = (status: SyncConnectionStatus) => void;

/** Structural interface for the Y.Doc methods this provider uses. */
interface YDoc {
  on(
    event: "update",
    handler: (update: Uint8Array, origin: unknown) => void,
  ): void;
  off(
    event: "update",
    handler: (update: Uint8Array, origin: unknown) => void,
  ): void;
}
