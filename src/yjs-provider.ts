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
 * The bidirectional SYNC_STEP_1 ↔ SYNC_STEP_2 handshake ensures both tabs
 * converge to the same ydoc state (same winning Yjs nested-type instances)
 * before any further editing, which is required for observeDeep to fire on
 * the receiving side.
 */

import { Y } from "@wordpress/sync";
import { wpsDebug } from "./utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderCreatorOptions {
  objectType: string;
  /** null for collection-level providers (WordPress 7.0 Beta 2+). */
  objectId: string | number | null;
  ydoc: YDoc;
  awareness: unknown;
}

interface ProviderCreatorResult {
  destroy(): void;
  on(event: "status", handler: StatusHandler): void;
}

type SyncStatus = "connected" | "connecting" | "disconnected";
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

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

const MSG_SYNC_STEP_1 = 0x01;
const MSG_SYNC_STEP_2 = 0x02;
const MSG_UPDATE = 0x03;

/**
 * Minimum ms between outbound SYNC_STEP_1 sends. Prevents the server's
 * own-frame echo from triggering an infinite exchange loop.
 */
const SYNC_STEP_1_COOLDOWN_MS = 2000;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class WPSignalYjsProvider implements ProviderCreatorResult {
  private readonly channel: string;
  private readonly ydoc: YDoc;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly statusHandlers = new Set<StatusHandler>();

  /** Yjs updates buffered while disconnected, flushed on reconnect. */
  private pendingUpdates: Uint8Array[] = [];

  /** True while applying a remote update — suppresses local re-broadcast. */
  private applyingRemote = false;

  /**
   * True after the first ydoc update event fires (applyPersistedCrdtDoc init).
   * Ensures SYNC_STEP_1 is sent exactly once via the onUpdate path when the
   * connection was already open before the doc was initialised.
   */
  private initialized = false;

  /**
   * Timestamp (ms) of the most recent SYNC_STEP_1 we sent. Rate-limits
   * reciprocal SYNC_STEP_1 replies to break server-echo loops.
   */
  private lastSyncStep1SentAt = 0;

  private currentStatus: SyncStatus = "connecting";

  constructor({ objectType, objectId, ydoc }: ProviderCreatorOptions) {
    // Use the server-localized prefix so the channel falls within the JWT's
    // allowed_channel_prefixes (e.g. `site:{site_id}:yjs:`).
    const prefix = window.wpSignalYjsConfig?.channelPrefix ?? "yjs:";
    // objectId is null for collection-level loads (e.g. collaborative notes).
    // Fall back to "collection" so all peers share the same channel for that
    // objectType rather than each getting an isolated "yjs:type:null" channel.
    const id = objectId !== null ? String(objectId) : "collection";
    this.channel = `${prefix}${objectType}:${id}`;
    this.ydoc = ydoc;
    this.init();
  }

  // -------------------------------------------------------------------------
  // Public API (ProviderCreatorResult)
  // -------------------------------------------------------------------------

  on(_event: "status", handler: StatusHandler): void {
    this.statusHandlers.add(handler);
    // Replay current status immediately. WordPress registers this handler
    // after the async creator resolves, so the status emitted during
    // construction would otherwise be missed.
    handler({ status: this.currentStatus });
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers.length = 0;
    window.WPS?.unsubscribe([this.channel]);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Encode our state vector and broadcast a SYNC_STEP_1 to the channel. */
  private sendSyncStep1(wps: WPSApi): void {
    const sv = Y.encodeStateVector(this.ydoc);
    wps.publishBinary(this.channel, this.frame(MSG_SYNC_STEP_1, sv));
    this.lastSyncStep1SentAt = Date.now();
  }

  /** Build a framed message: 1-byte type prefix + payload bytes. */
  private frame(type: number, data: Uint8Array): Uint8Array {
    const msg = new Uint8Array(1 + data.length);
    msg[0] = type;
    msg.set(data, 1);
    return msg;
  }

  private emitStatus(status: SyncStatus): void {
    this.currentStatus = status;
    this.statusHandlers.forEach((fn) => fn({ status }));
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  private init(): void {
    const wps = window.WPS;
    if (!wps) {
      wpsDebug(
        "window.WPS is not available.",
        "real-time collaboration is disabled.",
        "error",
        true,
        "Yjs",
      );
      return;
    }

    wps.subscribe([this.channel]);

    // Local ydoc changes > broadcast to peers.
    //
    // On the FIRST update (fired by applyPersistedCrdtDoc / applyChangesToCRDTDoc
    // in the sync manager), we broadcast SYNC_STEP_1 so peers can send back any
    // updates we are missing. This resolves the "initialization problem": each
    // tab creates independent nested Yjs types (Y.Array for blocks, Y.Text for
    // title, etc.) that conflict until a full state exchange forces Yjs to pick
    // one set of winners deterministically by clientID.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (this.applyingRemote || origin === this) return;

      if (wps.connected) {
        if (!this.initialized) {
          this.initialized = true;
          this.sendSyncStep1(wps);
          wpsDebug(
            "SYNC_STEP_1 sent",
            {
              channel: this.channel,
            },
            "log",
            true,
            "Yjs",
          );
        }
        wps.publishBinary(this.channel, this.frame(MSG_UPDATE, update));
        wpsDebug(
          "outbound update",
          {
            channel: this.channel,
            bytes: update.length,
          },
          "log",
          true,
          "Yjs",
        );
      } else {
        this.pendingUpdates.push(update);
      }
    };
    this.ydoc.on("update", onUpdate);
    this.unsubscribers.push(() => this.ydoc.off("update", onUpdate));

    // Incoming binary frames from peers.
    const offBinary = wps.onBinaryMessage((channel, data) => {
      if (channel !== this.channel || data.length < 1) return;

      const msgType = data[0];
      const payload = data.subarray(1);

      switch (msgType) {
        case MSG_SYNC_STEP_1: {
          // Reply with what the peer is missing from our doc.
          const missing = Y.encodeStateAsUpdate(this.ydoc, payload);
          wps.publishBinary(this.channel, this.frame(MSG_SYNC_STEP_2, missing));
          wpsDebug(
            "SYNC_STEP_1 received > SYNC_STEP_2 sent",
            {
              channel,
              theirSvBytes: payload.length,
              diffBytes: missing.length,
            },
            "log",
            true,
            "Yjs",
          );

          // Send our own SYNC_STEP_1 so the peer can reply with what WE
          // are missing. Without this, sync is one-directional: the peer
          // gets our state but we never learn what the peer has that we lack.
          //
          // Rate-limited: the server echoes frames back to the sender, so
          // a recently-sent SYNC_STEP_1 arriving here is our own echo, not
          // a genuine new peer.
          if (Date.now() - this.lastSyncStep1SentAt > SYNC_STEP_1_COOLDOWN_MS) {
            this.sendSyncStep1(wps);
            wpsDebug(
              "reciprocal SYNC_STEP_1 sent",
              {
                channel,
              },
              "log",
              true,
              "Yjs",
            );
          }
          break;
        }

        case MSG_SYNC_STEP_2:
        case MSG_UPDATE: {
          this.applyingRemote = true;
          try {
            Y.applyUpdate(this.ydoc, payload);
          } finally {
            this.applyingRemote = false;
          }
          wpsDebug(
            "inbound update applied",
            {
              channel,
              type: msgType === MSG_SYNC_STEP_2 ? "SYNC_STEP_2" : "UPDATE",
              bytes: payload.length,
            },
            "log",
            true,
            "Yjs",
          );
          break;
        }
      }
    });
    this.unsubscribers.push(offBinary);

    // Connection state changes.
    const offConnection = wps.onConnectionChange((connected) => {
      this.emitStatus(connected ? "connected" : "disconnected");

      if (connected) {
        // Always send SYNC_STEP_1 on connect or reconnect.
        //
        // applyPersistedCrdtDoc runs synchronously inside loadEntity()
        // before any async event can fire, so the ydoc is always
        // initialised by the time we reach here.
        this.sendSyncStep1(wps);
        this.initialized = true;
        wpsDebug(
          "connect SYNC_STEP_1 sent",
          {
            channel: this.channel,
          },
          "log",
          true,
          "Yjs",
        );

        for (const update of this.pendingUpdates.splice(0)) {
          wps.publishBinary(this.channel, this.frame(MSG_UPDATE, update));
          wpsDebug(
            "outbound update",
            {
              channel: this.channel,
              bytes: update.length,
            },
            "log",
            true,
            "Yjs",
          );
        }
      } else {
        // Capture full state so we can re-sync from scratch on reconnect.
        this.pendingUpdates.push(Y.encodeStateAsUpdate(this.ydoc));
        wpsDebug(
          "pending updates",
          {
            channel: this.channel,
            bytes: Y.encodeStateAsUpdate(this.ydoc).length,
          },
          "log",
          true,
          "Yjs",
        );
      }
    });
    this.unsubscribers.push(offConnection);

    this.emitStatus(wps.connected ? "connected" : "connecting");
  }
}

// ---------------------------------------------------------------------------
// Provider creator
// ---------------------------------------------------------------------------

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
    wpsDebug(
      "WebSocket unavailable",
      "real-time collaboration is disabled. Reload the page to retry the WebSocket connection",
      "error",
      true,
      "Yjs",
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
