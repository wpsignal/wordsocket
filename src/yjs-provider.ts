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
 * WordPress dependencies.
 */
import { Y } from "@wordpress/sync";

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
 * WPSignalYjsProvider class.
 */
class WPSignalYjsProvider implements ProviderCreatorResult {
  /** The channel name for this provider. */
  private readonly channel: string;
  /** The Yjs document instance. */
  private readonly ydoc: YDoc;
  /** The Awareness instance. */
  private readonly awareness: Awareness;
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

  private currentStatus: SyncStatus = "connecting";

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
    this.awareness = awareness;
    debug("provider created", { channel: this.channel });
    this.init();
  }

  /** Register a status handler. Fires immediately with the current status. */
  on(_event: "status", handler: StatusHandler): void {
    this.statusHandlers.add(handler);
    handler({ status: this.currentStatus });
  }

  /** Broadcast a null awareness state then tear down all listeners and subscriptions. */
  destroy(): void {
    this.awareness.setLocalState(null);
    const nullUpdate = encodeAwarenessUpdate(this.awareness, [
      this.awareness.clientID,
    ]);
    window.WPS?.publishBinary(
      this.channel,
      this.frame(MSG_AWARENESS, nullUpdate),
    );

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
  private emitStatus(status: SyncStatus): void {
    this.currentStatus = status;
    this.statusHandlers.forEach((fn) => fn({ status }));
  }

  /** Returns true if at least one remote peer is present in awareness. */
  private hasPeers(): boolean {
    return [...this.awareness.getStates().keys()].some(
      (id) => id !== this.awareness.clientID,
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
      return;
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (this.applyingRemote || origin === this) return;
      if (!this.hasPeers()) return;

      if (wps.connected) {
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

    const onAwarenessChange: AwarenessChangeHandler = (
      { added, updated, removed },
      origin,
    ) => {
      if (origin === "wpsignal") {
        return;
      }
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0 || !wps.connected || !this.hasPeers()) {
        return;
      }
      const encoded = encodeAwarenessUpdate(this.awareness, changed);
      wps.publishBinary(this.channel, this.frame(MSG_AWARENESS, encoded));
    };
    this.awareness.on("change", onAwarenessChange);
    this.unsubscribers.push(() =>
      this.awareness.off("change", onAwarenessChange),
    );

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
           * gets our stste but we never learn what the peer has that we lack.
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
          const hadPeers = this.hasPeers();
          applyAwarenessUpdate(this.awareness, payload, "wpsignal");
          if (!hadPeers && this.hasPeers()) {
            const localUpdate = encodeAwarenessUpdate(this.awareness, [
              this.awareness.clientID,
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

    // Connection state changes.
    const offConnection = wps.onConnectionChange((connected) => {
      this.emitStatus(connected ? "connected" : "disconnected");

      if (connected) {
        /**
         * Re-subscribe before sending SYNC_STEP_1.
         */
        wps.subscribe([this.channel]);
        this.sendSyncStep1(wps);
        debug("connect SYNC_STEP_1 sent", { channel: this.channel });

        // Announce our presence to peers so collaborator badges appear.
        const awarenessUpdate = encodeAwarenessUpdate(this.awareness, [
          this.awareness.clientID,
        ]);
        wps.publishBinary(
          this.channel,
          this.frame(MSG_AWARENESS, awarenessUpdate),
        );

        for (const update of this.pendingUpdates.splice(0)) {
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
      const awarenessUpdate = encodeAwarenessUpdate(this.awareness, [
        this.awareness.clientID,
      ]);
      wps.publishBinary(
        this.channel,
        this.frame(MSG_AWARENESS, awarenessUpdate),
      );
    }

    this.emitStatus(wps.connected ? "connected" : "connecting");
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
 * the provider's `onConnectionChange` handler will initiate sync once the
 * WebSocket opens, or `publishBinary` will surface the error if SSE wins the
 * race.
 */
export async function wpsignalProviderCreator(
  options: ProviderCreatorOptions,
): Promise<ProviderCreatorResult> {
  if (window.WPS?.transport === "sse") {
    debug(
      "WebSocket unavailable",
      "real-time collaboration is disabled. Reload the page to retry the WebSocket connection",
      "error",
    );
    return {
      destroy() {},
      on(_event: "status", handler: StatusHandler) {
        handler({ status: "disconnected" });
      },
    };
  }
  return new WPSignalYjsProvider(options);
}
