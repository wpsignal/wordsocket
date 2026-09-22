/**
 * WPSignalYjsProvider
 *
 * A Yjs sync provider that relays binary Yjs updates over WPSignal's
 * WebSocket connection. Uses only the `window.WPS` public API.
 *
 * Provider creator signature (PR #72183 / @wordpress/sync):
 *   (options: ProviderCreatorOptions) => Promise<ProviderCreatorResult>
 *
 * where ProviderCreatorOptions = { objectType, objectId, ydoc, awareness }
 * and   ProviderCreatorResult  = { destroy(): void; on(event, handler): void }
 *
 * ## Sync protocol
 *
 * All binary frames carry a 1-byte message type prefix:
 *
 *   MSG_SYNC_STEP_1 (0x01) + Y.encodeStateVector(ydoc)
 *     > Sent on connect and as a reciprocal when a peer's SYNC_STEP_1 arrives.
 *       Asks peers to send back any updates we are missing.
 *
 *   MSG_SYNC_STEP_2 (0x02) + Yjs v1 update bytes
 *     > Response to a SYNC_STEP_1. Carries the diff the requester lacks.
 *       Applied with Y.applyUpdate (same as MSG_UPDATE).
 *
 *   MSG_UPDATE (0x03) + Yjs v1 update bytes
 *     > Incremental update broadcast when the local ydoc changes.
 *
 *   MSG_AWARENESS (0x04) + y-protocols awareness bytes
 *     > Sent when local awareness state changes (cursor, user info).
 *       Applied with applyAwarenessUpdate so peers see collaborator badges.
 *       Sent with null state on destroy so we are removed from collaborator list.
 *
 * The bidirectional SYNC_STEP_1 <-> SYNC_STEP_2 handshake ensures both tabs
 * converge to the same ydoc state (same winning Yjs nested-type instances)
 * before any further editing, which is required for observeDeep to fire on
 * the receiving side.
 */

/**
 * Internal dependencies: the editor's Yjs instance, which arrives with the
 * provider options (Gutenberg 23.9+) or as the `wp.sync.Y` global before that.
 */
import * as Y from "./yjs-runtime";
import { resolveYjs, setYjs } from "./yjs-runtime";

/**
 * External dependencies.
 */
import {
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";

/**
 * Types.
 */
import type { Awareness } from "y-protocols/awareness";

/**
 * Internal dependencies.
 */
import { wpsDebug } from "./utils";

function debug(
  title: string,
  data: any = null,
  type: "log" | "error" | "warn" = "log",
) {
  wpsDebug(title, data, type, true, "Yjs");
}

// Message type constants (1-byte prefix).
const MSG_SYNC_STEP_1 = 0x01;
const MSG_SYNC_STEP_2 = 0x02;
const MSG_UPDATE = 0x03;
const MSG_AWARENESS = 0x04;

/**
 * Minimum ms between outbound SYNC_STEP_1 sends. Prevents the server's
 * own-frame echo from triggering an infinite exchange loop.
 */
const SYNC_STEP_1_COOLDOWN_MS = 2000;

/**
 * After this many consecutive failed reconnects the status is reported with
 * `backgroundRetriesFailed`, which is what makes the editor show its
 * "connection lost" dialog instead of only a toolbar indicator. With the
 * client's backoff (1s, 2s, 4s, 8s, 16s...) this is roughly half a minute.
 */
const BACKGROUND_RETRIES_BEFORE_DIALOG = 5;

/**
 * Largest encoded update the provider will relay. Mirrors core's HTTP polling
 * limit (MAX_ENCODED_UPDATE_SIZE_IN_BYTES) and stays under the relay's 2 MiB
 * WebSocket frame cap. Exceeding it reports `document-size-limit-exceeded`,
 * which core treats as "collaboration unsupported for this session".
 */
const MAX_UPDATE_SIZE_BYTES = 1024 * 1024;

/**
 * How often to re-run the SYNC_STEP_1 handshake on a live connection. The
 * relay drops frames under backpressure (64-message queue per connection)
 * rather than buffering unboundedly, so a periodic state-vector exchange is
 * the mechanism that guarantees eventual convergence after any lost frame
 * (y-websocket's resyncInterval serves the same purpose).
 */
const RESYNC_INTERVAL_MS = 30000;

/**
 * Mirrors @wordpress/sync's ConnectionError, which is locked behind
 * privateApis and cannot be imported. The editor matches on `code` by value
 * to pick the disconnect dialog copy.
 */
class WPSConnectionError extends Error {
  readonly code: SyncConnectionErrorCode;

  constructor(code: SyncConnectionErrorCode, message: string) {
    super(message);
    this.name = "ConnectionError";
    this.code = code;
  }
}

/**
 * WPSignalYjsProvider class.
 */
class WPSignalYjsProvider implements ProviderCreatorResult {
  /** The channel name for this provider. */
  private readonly channel: string;
  /** The Yjs document instance. */
  private readonly ydoc: YDoc;
  /** The Awareness instance. Absent for collection-level providers (e.g. the comments/notes collection). */
  private readonly awareness?: Awareness;
  /** The array of unsubscribe functions. */
  private readonly unsubscribers: Array<() => void> = [];
  /** The set of status handlers. */
  private readonly statusHandlers = new Set<StatusHandler>();

  /** The array of pending updates buffered while disconnected, flushed on reconnect. */
  private pendingUpdates: Uint8Array[] = [];

  /** Whether we are currently applying a remote update — suppresses local re-broadcast. */
  private applyingRemote = false;

  /**
   * Timestamp (ms) of the most recent SYNC_STEP_1 we sent. Rate-limits
   * reciprocal SYNC_STEP_1 replies to break server-echo loops.
   */
  private lastSyncStep1SentAt = 0;

  private currentStatus: SyncConnectionStatus = { status: "connecting" };

  constructor({
    objectType,
    objectId,
    ydoc,
    awareness,
  }: ProviderCreatorOptions) {
    const prefix = window.wpSignalYjsConfig?.channelPrefix ?? "yjs:";
    const id = objectId !== null ? String(objectId) : "collection";
    this.channel = `${prefix}${objectType}:${id}`;
    this.ydoc = ydoc;
    // Core hands over a real y-protocols Awareness (its own copy of the class);
    // the ambient type only declares the subset core promises, so widen here.
    this.awareness = awareness as Awareness | undefined;
    debug("provider created", { channel: this.channel });
    this.init();
  }

  /** Register a status handler. Fires immediately with the current status. */
  on(_event: "status", handler: StatusHandler): void {
    this.statusHandlers.add(handler);
    handler(this.currentStatus);
  }

  /** Broadcast a null awareness state then tear down all listeners and subscriptions. */
  destroy(): void {
    if (this.awareness) {
      /*
       * Synchronously fires the awareness 'update' listener, which broadcasts
       * the removal to peers; must happen before the listeners are detached
       * below.
       */
      this.awareness.setLocalState(null);
    }

    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers.length = 0;
    window.WPS?.unsubscribe([this.channel]);
  }

  /** Send a SYNC_STEP_1 frame carrying our current state vector. Records the send time for cooldown. */
  private sendSyncStep1(wps: WPSApi): void {
    const sv = Y.encodeStateVector(this.ydoc);
    wps.publishBinary(this.channel, this.frame(MSG_SYNC_STEP_1, sv));
    this.lastSyncStep1SentAt = Date.now();
  }

  /** Prepend a 1-byte message type to `data` to form a binary frame. */
  private frame(type: number, data: Uint8Array): Uint8Array {
    const msg = new Uint8Array(1 + data.length);
    msg[0] = type;
    msg.set(data, 1);
    return msg;
  }

  /** Update the stored status and notify all registered handlers. */
  /**
   * True when `update` may be relayed. Otherwise reports the size error once
   * and stops syncing this document; the editor keeps working locally and
   * shows why collaboration is off.
   */
  private withinSizeLimit(update: Uint8Array): boolean {
    if (update.byteLength <= MAX_UPDATE_SIZE_BYTES) return true;
    if (this.currentStatus.error?.code !== "document-size-limit-exceeded") {
      debug("update too large to relay", { channel: this.channel, bytes: update.byteLength }, "error");
      this.emitStatus({
        status: "disconnected",
        error: new WPSConnectionError(
          "document-size-limit-exceeded",
          "The document is too large to sync in real time.",
        ),
      });
    }
    return false;
  }

  private emitStatus(status: SyncConnectionStatus): void {
    this.currentStatus = status;
    this.statusHandlers.forEach((fn) => fn(status));
  }

  /**
   * Returns true if at least one remote peer is present in awareness.
   * Without an awareness instance (collection-level providers) peers cannot
   * be detected, so always broadcast.
   */
  private hasPeers(): boolean {
    const awareness = this.awareness;
    if (!awareness) {
      return true;
    }
    return [...awareness.getStates().keys()].some(
      (id) => id !== awareness.clientID,
    );
  }

  /** Subscribe to the channel and wire up ydoc, awareness, and connection listeners. */
  private init(): void {
    const wps = window.WPS;
    if (!wps) {
      debug(
        "window.WPS is not available.",
        "real-time collaboration is disabled.",
        "error",
      );
      this.emitStatus({
        status: "disconnected",
        error: new WPSConnectionError(
          "unknown-error",
          "The WordSocket client is not available on this page.",
        ),
      });
      return;
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (this.applyingRemote || origin === this) return;

      /*
       * No peers-present gate here: the awareness view of who is in the room
       * can be stale (states expire after 30s without renewal), and an update
       * suppressed on that basis is dropped permanently, silently diverging
       * the docs. Solo editing costs one small echo frame per update, which
       * is the price of correctness (y-websocket broadcasts unconditionally
       * for the same reason).
       */
      if (wps.connected) {
        if (!this.withinSizeLimit(update)) return;
        wps.publishBinary(this.channel, this.frame(MSG_UPDATE, update));
        debug("outbound update", {
          channel: this.channel,
          bytes: update.length,
        });
      } else {
        this.pendingUpdates.push(update);
      }
    };
    this.ydoc.on("update", onUpdate);
    this.unsubscribers.push(() => this.ydoc.off("update", onUpdate));

    const awareness = this.awareness;
    if (awareness) {
      const onAwarenessUpdate: AwarenessChangeHandler = (
        { added, updated, removed },
        origin,
      ) => {
        if (origin === "wpsignal") {
          return;
        }
        const changed = [...added, ...updated, ...removed];
        if (changed.length === 0 || !wps.connected) {
          return;
        }
        const encoded = encodeAwarenessUpdate(awareness, changed);
        wps.publishBinary(this.channel, this.frame(MSG_AWARENESS, encoded));
      };
      /*
       * 'update', NOT 'change': y-protocols re-announces the local state with
       * an unchanged payload every ~15s, and peers purge any client not
       * renewed within 30s. Those keepalive renewals fire only the 'update'
       * event; listening to 'change' drops them, so idle clients vanish from
       * peers' awareness and anything gated on presence breaks. No peers gate
       * here either: renewals are exactly what re-establishes presence after
       * both sides have purged each other.
       */
      awareness.on("update", onAwarenessUpdate);
      this.unsubscribers.push(() =>
        awareness.off("update", onAwarenessUpdate),
      );
    }

    // Incoming binary frames from peers.
    const offBinary = wps.onBinaryMessage((channel, data) => {
      if (channel !== this.channel || data.length < 1) {
        return;
      }

      const msgType = data[0];
      const payload = data.subarray(1);

      switch (msgType) {
        case MSG_SYNC_STEP_1: {
          // Reply with what the peer is missing from our doc.
          const missing = Y.encodeStateAsUpdate(this.ydoc, payload);
          wps.publishBinary(this.channel, this.frame(MSG_SYNC_STEP_2, missing));
          debug("SYNC_STEP_1 received > SYNC_STEP_2 sent", {
            channel,
            theirSvBytes: payload.length,
            diffBytes: missing.length,
          });

          /**
           * Send our own SYNC_STEP_1 so the peer can reply with what WE
           * are missing. Without this, sync is one-directional: the peer
           * gets our state but we never learn what the peer has that we lack.
           *
           * Rate-limited: the server echoes frames back to the sender, so
           * a recently-sent SYNC_STEP_1 arriving here is our own echo, not
           * a genuine new peer.
           */
          if (Date.now() - this.lastSyncStep1SentAt > SYNC_STEP_1_COOLDOWN_MS) {
            this.sendSyncStep1(wps);
            debug("reciprocal SYNC_STEP_1 sent", {
              channel,
            });
          }
          break;
        }

        case MSG_SYNC_STEP_2:
        case MSG_UPDATE: {
          const svBefore = Y.encodeStateVector(this.ydoc);
          this.applyingRemote = true;
          try {
            Y.applyUpdate(this.ydoc, payload, "wpsignal");
          } catch (err) {
            debug("applyUpdate failed", {
              channel,
              type: msgType === MSG_SYNC_STEP_2 ? "SYNC_STEP_2" : "UPDATE",
              bytes: payload.length,
              err,
            });
          } finally {
            this.applyingRemote = false;
          }
          const svAfter = Y.encodeStateVector(this.ydoc);
          const noop =
            svBefore.length === svAfter.length &&
            svBefore.every((b, i) => b === svAfter[i]);
          debug("inbound update applied", {
            channel,
            type: msgType === MSG_SYNC_STEP_2 ? "SYNC_STEP_2" : "UPDATE",
            bytes: payload.length,
            ydocChanged: !noop,
          });
          break;
        }

        case MSG_AWARENESS: {
          if (!awareness) {
            break;
          }
          const hadPeers = this.hasPeers();
          applyAwarenessUpdate(awareness, payload, "wpsignal");
          if (!hadPeers && this.hasPeers()) {
            const localUpdate = encodeAwarenessUpdate(awareness, [
              awareness.clientID,
            ]);
            wps.publishBinary(this.channel, this.frame(MSG_AWARENESS, localUpdate));
          }
          debug("inbound awareness applied", {
            channel,
            bytes: payload.length,
          });
          break;
        }
      }
    });
    this.unsubscribers.push(offBinary);

    // Periodic resync: converges the docs even after relayed frames are lost.
    const resyncTimer = setInterval(() => {
      if (wps.connected) {
        this.sendSyncStep1(wps);
      }
    }, RESYNC_INTERVAL_MS);
    this.unsubscribers.push(() => clearInterval(resyncTimer));

    // Connection state changes. `onStateChange` carries the reason and the
    // retry schedule; the sync work below only cares about the edge.
    let wasConnected = wps.connected;
    const offConnection = wps.onStateChange((state) => {
      this.emitStatus(statusFromState(state));
      const connected = state.connected;
      if (connected === wasConnected) return;
      wasConnected = connected;

      if (connected) {
        /**
         * Re-subscribe before sending SYNC_STEP_1.
         */
        wps.subscribe([this.channel]);
        this.sendSyncStep1(wps);
        debug("connect SYNC_STEP_1 sent", { channel: this.channel });

        // Announce our presence to peers so collaborator badges appear.
        if (awareness) {
          const awarenessUpdate = encodeAwarenessUpdate(awareness, [
            awareness.clientID,
          ]);
          wps.publishBinary(
            this.channel,
            this.frame(MSG_AWARENESS, awarenessUpdate),
          );
        }

        for (const update of this.pendingUpdates.splice(0)) {
          if (!this.withinSizeLimit(update)) break;
          wps.publishBinary(this.channel, this.frame(MSG_UPDATE, update));
          debug("outbound update", {
            channel: this.channel,
            bytes: update.length,
          });
        }
      } else {
        // Capture full state so we can re-sync from scratch on reconnect.
        const snapshot = Y.encodeStateAsUpdate(this.ydoc);
        this.pendingUpdates.push(snapshot);
        debug("pending updates", {
          channel: this.channel,
          bytes: snapshot.length,
        });
      }
    });
    this.unsubscribers.push(offConnection);

    if (wps.connected) {
      wps.subscribe([this.channel]);
      this.sendSyncStep1(wps);
      debug("connect SYNC_STEP_1 sent", { channel: this.channel });
      if (awareness) {
        const awarenessUpdate = encodeAwarenessUpdate(awareness, [
          awareness.clientID,
        ]);
        wps.publishBinary(
          this.channel,
          this.frame(MSG_AWARENESS, awarenessUpdate),
        );
      }
    }

    this.emitStatus({ status: wps.connected ? "connected" : "connecting" });
  }
}

/**
 * Provider creator function registered with WordPress via the `sync.providers`
 * filter. Async per the @wordpress/sync contract.
 *
 * If the WPSignal client has fallen back to SSE (WebSocket unavailable), we
 * cannot relay Yjs updates — SSE is receive-only. In that case we return a
 * no-op provider that emits `disconnected` so WordPress can surface its own
 * "not synced" UI, rather than silently dropping all outgoing updates.
 *
 * If transport is still `null` (client is connecting), we proceed normally:
 * the provider's `onStateChange` handler will initiate sync once the
 * WebSocket opens, or `publishBinary` will surface the error if SSE wins the
 * race.
 */
/**
 * Error code used for the SSE-fallback no-op provider. It is one of core's
 * codes (so the editor never crashes on it), and the boot script tells the
 * editor it is handled so core's generic dialog stays closed.
 */
export const SSE_FALLBACK_ERROR_CODE: SyncConnectionErrorCode = "unknown-error";

/** Map the WordSocket client's connection state onto core's status payload. */
function statusFromState(state: WPSConnectionState): SyncConnectionStatus {
  if (state.connected) {
    return { status: "connected" };
  }
  const error = state.error
    ? new WPSConnectionError(state.error.code, state.error.message)
    : undefined;
  if (state.retryInMs === undefined) {
    // No retry scheduled: either still connecting, or the client gave up.
    return error ? { status: "disconnected", error } : { status: "connecting" };
  }
  return {
    status: "disconnected",
    error,
    willAutoRetryInMs: state.retryInMs,
    consecutiveFailures: state.failures,
    backgroundRetriesFailed: state.failures >= BACKGROUND_RETRIES_BEFORE_DIALOG,
  };
}

export async function wpsignalProviderCreator(
  options: ProviderCreatorOptions,
): Promise<ProviderCreatorResult> {
  const yjs = resolveYjs(options.Y);
  if (!yjs) {
    debug(
      "No Yjs instance",
      "the editor passed none and wp.sync.Y is gone; real-time collaboration is unavailable through WordSocket.",
      "error",
    );
    return {
      destroy() {},
      on(_event: "status", handler: StatusHandler) {
        handler({
          status: "disconnected",
          error: new WPSConnectionError(
            "protocol-mismatch",
            "WordSocket could not obtain the editor's Yjs instance.",
          ),
        });
      },
    };
  }
  setYjs(yjs);

  if (window.WPS?.transport === "sse") {
    debug(
      "WebSocket unavailable",
      "real-time collaboration is disabled. Reload the page to retry the WebSocket connection",
      "error",
    );
    return {
      destroy() {},
      on(_event: "status", handler: StatusHandler) {
        handler({
          status: "disconnected",
          error: new WPSConnectionError(
            SSE_FALLBACK_ERROR_CODE,
            "WebSocket is unavailable; the WordSocket client fell back to SSE, which cannot relay collaboration updates.",
          ),
        });
      },
    };
  }
  return new WPSignalYjsProvider(options);
}
