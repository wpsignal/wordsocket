/** Subset of the y-protocols Awareness API used by the provider. */
interface Awarendess {
  clientID: number;
  on(event: "change", handler: AwarenessChangeHandler): void;
  off(event: "change", handler: AwarenessChangeHandler): void;
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
  awareness: Awareness;
}

/** Contract @wordpress/sync expects every provider to satisfy. */
interface ProviderCreatorResult {
  destroy(): void;
  on(event: "status", handler: StatusHandler): void;
}

/** Connection state reported to @wordpress/sync via the `status` event. */
type SyncStatus = "connected" | "connecting" | "disconnected";

/** Handler registered via `provider.on("status", handler)`. */
type StatusHandler = (status: { status: SyncStatus }) => void;

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
