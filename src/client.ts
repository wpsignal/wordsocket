/**
 * WordSocket Client
 *
 * Prefers WebSocket for bidirectional communication, falls back to SSE.
 * Dispatches `wpsignal:<event>` DOM custom events regardless of transport.
 *
 * Exposes `window.WPS`: the public JS API so any theme or plugin can
 * subscribe/unsubscribe channels, publish messages, and listen for events
 * on the shared connection. Enqueue with `'wpsignal'` as a script dependency.
 */

import { wpsDebug } from "./utils";
import WPSClientDebug from "./utils/client-debug";
import WPSignalEvent from "./event";

window.wpsDebug ??= wpsDebug;

export class WPSignalClient implements WPSApi {
  private readonly config: WpSignalConfig;
  private readonly baseUrl: string;

  private _transport: "ws" | "sse" | null = null;
  private static ssePublishWarned = false;
  private ws: WebSocket | null = null;
  private sseReader: EventSource | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityListenerAttached = false;
  private _connected = false;
  /** Debug-only: when true the WS close handler skips the automatic 5s reconnect,
   * letting `window.wpsTest.drop()` mimic a dead-after-sleep socket until `wake()`. */
  private debugSuppressReconnect = false;

  /** Token for the current SSE connection; retained so reconnects can reuse it when channels change. */
  private sseToken: string | null = null;
  /** All channels subscribed via SSE. Persists across reconnects so token refreshes don't lose subscriptions. */
  private readonly sseChannels = new Set<string>();
  /** Debounce handle for SSE reconnects triggered by subscribe/unsubscribe calls. */
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly messageHandlers = new Set<WPSMessageHandler>();
  private readonly eventHandlers = new Map<string, Set<WPSEventHandler>>();
  private readonly connectionHandlers = new Set<(c: boolean) => void>();
  private readonly binaryHandlers = new Set<WPSBinaryHandler>();

  /** Channels requested while transport is null; flushed to WS on open or merged into SSE URL on connect. */
  private readonly pendingSubscriptions: string[] = [];

  /** Cached import of the AES-256-GCM key; resolved once and reused for every message. */
  private cryptoKeyPromise: Promise<CryptoKey | null> | null = null;
  /** True when SubtleCrypto is unavailable (HTTP context); suppresses per-message warnings. */
  private noSubtleCrypto = false;

  constructor(config: WpSignalConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  /**
   * Subscribe to one or more channels.
   * On WebSocket, sends a subscribe frame immediately.
   * On SSE, adds channels to the tracked set and reconnects to pick them up.
   * Otherwise queues them until a connection opens.
   */
  subscribe(channels: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", channels }));
    } else if (this._transport === "sse") {
      const added = channels.filter((ch) => !this.sseChannels.has(ch));
      if (added.length > 0) {
        added.forEach((ch) => this.sseChannels.add(ch));
        this.scheduleSseReconnect();
      }
    } else {
      this.pendingSubscriptions.push(...channels);
    }
  }

  /**
   * Unsubscribe from one or more channels.
   * On WebSocket, sends an unsubscribe frame immediately.
   * On SSE, removes channels from the tracked set and reconnects.
   * Otherwise removes them from the pending queue.
   */
  unsubscribe(channels: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", channels }));
    } else if (this._transport === "sse") {
      const removed = channels.filter((ch) => this.sseChannels.delete(ch));
      if (removed.length > 0) {
        this.scheduleSseReconnect();
      }
    } else {
      for (const ch of channels) {
        const idx = this.pendingSubscriptions.indexOf(ch);
        if (idx !== -1) {
          this.pendingSubscriptions.splice(idx, 1);
        }
      }
    }
  }

  /**
   * Send a raw binary frame to the server over the WebSocket.
   * Frame format: 2-byte BE channel name length + channel bytes + payload.
   * No-ops on SSE (one-way transport) or when not connected.
   */
  publishBinary(channel: string, data: Uint8Array): void {
    if (this._transport === "sse") {
      if (!WPSignalClient.ssePublishWarned) {
        WPSignalClient.ssePublishWarned = true;
        wpsDebug(
          "WebSocket unavailable",
          "SSE is receive-only; binary frames cannot be sent. Reload to retry WebSocket.",
          "error",
        );
      }
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const channelBytes = new TextEncoder().encode(channel);
    const frame = new Uint8Array(2 + channelBytes.length + data.length);
    frame[0] = (channelBytes.length >> 8) & 0xff;
    frame[1] = channelBytes.length & 0xff;
    frame.set(channelBytes, 2);
    frame.set(data, 2 + channelBytes.length);
    this.ws.send(frame);
  }

  /**
   * Publish a message to a channel over the WebSocket connection.
   * No-op on SSE (one-way transport).
   */
  publish(
    channel: string,
    event: string,
    data: Record<string, unknown> = {},
  ): void {
    if (this._transport === "sse") return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "message", channel, event, data }));
    }
  }

  /**
   * Register a handler for a specific event name.
   * Returns an unsubscribe function.
   */
  on(event: string, handler: WPSEventHandler): () => void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.eventHandlers.delete(event);
      }
    };
  }

  /**
   * Register a catch-all handler that receives every event on any channel.
   * Returns an unsubscribe function.
   */
  onMessage(handler: WPSMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Register a handler for incoming binary WebSocket frames (e.g. Yjs updates).
   * Returns an unsubscribe function.
   */
  onBinaryMessage(handler: WPSBinaryHandler): () => void {
    this.binaryHandlers.add(handler);
    return () => {
      this.binaryHandlers.delete(handler);
    };
  }

  /** `true` when a transport connection is active. */
  get connected(): boolean {
    return this._connected;
  }

  /** Current transport layer, or null while still connecting. */
  get transport(): "ws" | "sse" | null {
    return this._transport;
  }

  /**
   * Register a handler that fires whenever the connection state changes.
   * Returns an unsubscribe function.
   */
  onConnectionChange(handler: (c: boolean) => void): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  /** Initialise the client: obtain a token and open a transport connection. */
  start(): void {
    if (this.config.isDebug) {
      new WPSClientDebug({
        status: () => ({
          connected: this._connected,
          transport: this._transport,
          wsReadyState: this.ws?.readyState ?? null,
          reconnectPending: this.reconnectTimer !== null,
          suppressed: this.debugSuppressReconnect,
        }),
        drop: () => {
          this.debugSuppressReconnect = true;
          if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          // Closing triggers the WS close handler, which honors debugSuppressReconnect.
          this.ws?.close();
          // SSE has no close handler that flips connection state, so do it here.
          if (this.sseReader) {
            this.sseReader.close();
            this.sseReader = null;
            this.setConnected(false);
          }
        },
        wake: () => {
          this.debugSuppressReconnect = false;
          window.dispatchEvent(new Event("online"));
          document.dispatchEvent(new Event("visibilitychange"));
        },
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }
  }

  /** Reconnect when the tab becomes visible or the network comes back online. */
  private attachVisibilityListeners(): void {
    if (this.visibilityListenerAttached) return;
    this.visibilityListenerAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible")
        this.handleReconnectIfNeeded();
    });
    window.addEventListener("online", () => this.handleReconnectIfNeeded());
  }

  /**
   * Reconnect immediately rather than waiting for the scheduled retry. No-ops if
   * already connected, mid-handshake, or if an init() is already in flight.
   */
  private handleReconnectIfNeeded(): void {
    if (this._connected) return;
    // init() is already in flight (cleanup ran but token fetch hasn't resolved yet).
    if (this._transport === null && this.reconnectTimer === null) return;
    // Don't interrupt a WS handshake in progress; let it open or fall back naturally.
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    wpsDebug("Reconnecting on visibility/network restore...");
    this.cleanup();
    this.init();
  }

  /**
   * Obtain a token (reused from config on first load, otherwise fetched) and
   * open a transport. Retries after 30s if the token fetch fails.
   */
  private init(): void {
    this.attachVisibilityListeners();

    let tokenPromise: Promise<{
      token: string;
      channels: string[];
      exp: number;
    }>;

    if (this.config.token && this.config.channels && this.config.exp) {
      tokenPromise = Promise.resolve({
        token: this.config.token,
        channels: this.config.channels,
        exp: this.config.exp,
      });
      delete this.config.token;
      delete this.config.channels;
      delete this.config.exp;
    } else {
      tokenPromise = this.fetchToken();
    }

    tokenPromise
      .then((data) => {
        wpsDebug(
          "Token obtained",
          { expiresAt: new Date(data.exp * 1000).toISOString() },
          "log",
          true,
        );
        this.scheduleRefresh(data.exp);

        if (typeof WebSocket !== "undefined" && !this.config.forceSSE) {
          this.connectWebSocket(data.token, data.channels);
        } else {
          this.connectSSE(data.token, data.channels);
        }
      })
      .catch((err) => {
        wpsDebug("Token fetch failed", err, "error");
        setTimeout(() => this.init(), 30000);
      });
  }

  /** Build the WebSocket URL, carrying the auth token as a query param. */
  private wsUrl(token: string, baseUrl: string): string {
    const wsProto = baseUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = baseUrl.replace(/^https?:\/\//, "");
    return `${wsProto}://${wsHost}/ws?token=${encodeURIComponent(token)}`;
  }

  /**
   * Open a WebSocket and wire up its handlers. Subscribes to `channels` on open;
   * falls back to SSE if the socket never opens, and schedules a reconnect if an
   * established socket later closes.
   */
  private connectWebSocket(token: string, channels: string[]): void {
    const wsUrl = this.wsUrl(token, this.baseUrl);

    let didFallback = false;
    let didOpen = false;

    const fallbackToSSE = (): void => {
      if (didFallback) return;
      didFallback = true;
      this.ws = null;
      wpsDebug(
        "Falling back to SSE",
        "WebSocket connection failed; using SSE (receive-only). Features requiring bidirectional communication are unavailable.",
        "log",
      );
      this.connectSSE(token, channels);
    };

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";
    this._transport = "ws";

    this.ws.addEventListener("open", () => {
      didOpen = true;
      wpsDebug("WebSocket connected");
      this.ws!.send(JSON.stringify({ type: "subscribe", channels }));
      this.flushPendingSubscriptions();
      this.setConnected(true);
    });

    this.ws.addEventListener("message", (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        this.handleBinaryFrame(new Uint8Array(e.data));
        return;
      }
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "message":
            if (
              msg.event === "encrypted" &&
              msg.data?.v === 1 &&
              typeof msg.data?.p === "string"
            ) {
              this.decryptMessage(msg.data.p as string).then((plain) => {
                if (plain) {
                  this.dispatchEvent(
                    plain.event,
                    msg.channel,
                    plain.data ?? {},
                  );
                } else if (!this.noSubtleCrypto) {
                  wpsDebug(
                    "Could not decrypt message on channel",
                    msg.channel,
                    "warn",
                  );
                }
              });
            } else {
              this.dispatchEvent(msg.event, msg.channel, msg.data ?? {});
            }
            break;
          case "ping":
            this.ws!.send(JSON.stringify({ type: "pong" }));
            break;
          case "subscribed":
            wpsDebug("Subscribed to", msg.channels);
            break;
          case "unsubscribed":
            wpsDebug("Unsubscribed from", msg.channels);
            break;
          case "auth_ok":
            wpsDebug(
              "Auth refreshed, expires at",
              new Date(msg.exp * 1000).toISOString(),
            );
            break;
          case "error":
            wpsDebug("Server error:", msg.code, msg.message);
            break;
        }
      } catch (err) {
        wpsDebug("Failed to parse WS message", err, "error");
      }
    });

    this.ws.addEventListener("close", (e: CloseEvent) => {
      wpsDebug(`WebSocket closed (code=${e.code})`);
      this.ws = null;
      this.setConnected(false);
      if (!didOpen) {
        fallbackToSSE();
      } else if (this.debugSuppressReconnect) {
        wpsDebug("[debug] Auto-reconnect suppressed (simulated sleep)");
      } else {
        wpsDebug("Reconnecting in 5s...");
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.cleanup();
          this.init();
        }, 5000);
      }
    });

    this.ws.addEventListener("error", () => {
      wpsDebug("WebSocket error", null, "warn");
    });
  }

  /**
   * Open an SSE connection.
   * Merges the provided channels with any pending subscriptions and the
   * persistent sseChannels set so reconnects never drop previously subscribed channels.
   */
  private connectSSE(token: string, channels: string[]): void {
    this.sseToken = token;

    // Absorb any channels queued before the connection was established.
    this.pendingSubscriptions
      .splice(0)
      .forEach((ch) => this.sseChannels.add(ch));
    channels.forEach((ch) => this.sseChannels.add(ch));

    this._transport = "sse";
    this.setConnected(true);

    const url = `${this.baseUrl}/sse?token=${encodeURIComponent(token)}&channels=${encodeURIComponent([...this.sseChannels].join(","))}`;
    const source = new EventSource(url);
    this.sseReader = source;

    source.addEventListener("open", () => {
      wpsDebug("SSE connected");
    });

    source.addEventListener("error", (e) => {
      wpsDebug("SSE error", e, "error");
    });

    const eventTypes = [
      "post.updated",
      "post.created",
      "post.deleted",
      "comment.created",
    ];
    eventTypes.forEach((eventType) => {
      source.addEventListener(eventType, (e: Event) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data);
          this.dispatchEvent(eventType, "", payload);
        } catch (err) {
          wpsDebug("Failed to parse SSE data", err, "error");
        }
      });
    });

    source.addEventListener("encrypted", (e: MessageEvent) => {
      try {
        const { data } = JSON.parse(e.data);
        if (data.v === 1 && typeof data.p === "string") {
          this.decryptMessage(data.p).then((plain) => {
            if (plain) {
              this.dispatchEvent(plain.event, "", plain.data ?? {});
            } else if (!this.noSubtleCrypto) {
              wpsDebug("Could not decrypt SSE message", null, "error");
            }
          });
        }
      } catch (err) {
        wpsDebug("Failed to parse encrypted SSE data", err, "error");
      }
    });

    source.addEventListener("message", (e: MessageEvent) => {
      wpsDebug("SSE message", e.data);
    });
  }

  /**
   * Tear down the active transport and timers. Retains sseToken and sseChannels
   * so the next connect restores all subscriptions automatically.
   */
  private cleanup(): void {
    this.debugSuppressReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sseReconnectTimer !== null) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.sseReader) {
      this.sseReader.close();
      this.sseReader = null;
    }
    this._transport = null;
    this.setConnected(false);
  }

  /** Update connection state, notifying handlers only when the value changes. */
  private setConnected(value: boolean): void {
    if (value === this._connected) return;
    this._connected = value;
    this.connectionHandlers.forEach((fn) => fn(value));
  }

  /** Mint a fresh token, channel list, and expiry from the REST endpoint. */
  private async fetchToken(): Promise<{
    token: string;
    channels: string[];
    exp: number;
  }> {
    const res = await fetch(this.config.restUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": this.config.nonce,
      },
    });
    if (!res.ok) {
      throw new Error(`WordSocket: token request failed (${res.status})`);
    }
    return res.json();
  }

  /**
   * Fan an incoming event out to DOM listeners (`wpsignal:<event>`), catch-all
   * message handlers, and per-event handlers.
   */
  private dispatchEvent(
    eventName: string,
    channel: string,
    data: Record<string, unknown>,
  ): void {
    wpsDebug(`${eventName}:${channel}`, data);
    document.dispatchEvent(
      new WPSignalEvent<Record<string, unknown>>(`wpsignal:${eventName}`, {
        channel,
        data,
      }),
    );
    this.messageHandlers.forEach((handler) =>
      handler(eventName, data, channel),
    );
    this.eventHandlers
      .get(eventName)
      ?.forEach((handler) => handler(data, channel));
  }

  /**
   * Schedule a token refresh at 80% of its lifetime (min 10s). Refreshes in
   * place over an open WebSocket, otherwise reconnects with the new token.
   */
  private scheduleRefresh(exp: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const ttl = (exp - Math.floor(Date.now() / 1000)) * 1000;
    const refreshAt = Math.max(ttl * 0.8, 10000);

    this.refreshTimer = setTimeout(() => {
      wpsDebug("Refreshing token...");
      this.fetchToken()
        .then((data) => {
          if (
            this._transport === "ws" &&
            this.ws?.readyState === WebSocket.OPEN
          ) {
            this.ws.send(JSON.stringify({ type: "auth", token: data.token }));
          } else {
            this.cleanup();
            this.init();
          }
          this.scheduleRefresh(data.exp);
        })
        .catch((err) => {
          wpsDebug("Token refresh failed", err, "error");
          setTimeout(() => {
            this.cleanup();
            this.init();
          }, 5000);
        });
    }, refreshAt);
  }

  /** Send any channels queued while the socket was still connecting. */
  private flushPendingSubscriptions(): void {
    if (
      this.pendingSubscriptions.length &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      this.ws.send(
        JSON.stringify({
          type: "subscribe",
          channels: this.pendingSubscriptions.splice(0),
        }),
      );
    }
  }

  /**
   * Debounced SSE reconnect used when subscribe/unsubscribe changes the channel set.
   * Batches rapid calls into a single reconnect after 50 ms.
   */
  private scheduleSseReconnect(): void {
    if (this.sseReconnectTimer !== null) return;
    this.sseReconnectTimer = setTimeout(() => {
      this.sseReconnectTimer = null;
      if (this._transport === "sse" && this.sseToken) {
        this.sseReader?.close();
        this.sseReader = null;
        this.connectSSE(this.sseToken, []);
      }
    }, 50);
  }

  /**
   * Parse a binary WebSocket frame and dispatch to registered binary handlers.
   * Wire format: [2-byte BE channel name length][channel bytes][raw payload].
   */
  private handleBinaryFrame(buf: Uint8Array): void {
    if (buf.length < 2) return;
    const channelLen = (buf[0] << 8) | buf[1];
    if (buf.length < 2 + channelLen) return;
    const channel = new TextDecoder().decode(buf.slice(2, 2 + channelLen));
    const payload = buf.slice(2 + channelLen);
    this.binaryHandlers.forEach((fn) => fn(channel, payload));
  }

  /**
   * Import the AES-256-GCM key from `wpSignalConfig.encryptionKey` (base64).
   * The result is cached: the key is imported once and reused for every message.
   * Returns `null` if no key is configured or SubtleCrypto is unavailable.
   */
  private getCryptoKey(): Promise<CryptoKey | null> {
    if (!this.cryptoKeyPromise) {
      const b64 = this.config.encryptionKey;
      if (!b64) {
        this.cryptoKeyPromise = Promise.resolve(null);
      } else if (typeof crypto === "undefined" || !crypto.subtle) {
        this.noSubtleCrypto = true;
        wpsDebug(
          "SubtleCrypto unavailable",
          "Encrypted messages cannot be decrypted on HTTP. Use HTTPS to enable decryption.",
          "warn",
        );
        this.cryptoKeyPromise = Promise.resolve(null);
      } else {
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        this.cryptoKeyPromise = crypto.subtle
          .importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"])
          .catch(() => null);
      }
    }
    return this.cryptoKeyPromise;
  }

  /**
   * Decrypt an encrypted message payload produced by the PHP Publisher.
   *
   * Wire format (base64-encoded): `IV[12] || ciphertext[N] || auth-tag[16]`
   * SubtleCrypto expects `ciphertext || tag` as the data argument, which is `buf[12:]`.
   *
   * Returns the parsed `{ event, data }` object, or `null` on failure.
   */
  private async decryptMessage(
    p: string,
  ): Promise<{ event: string; data: Record<string, unknown> } | null> {
    const key = await this.getCryptoKey();
    if (!key) return null;
    try {
      const buf = Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
      const iv = buf.slice(0, 12);
      const cipherWithTag = buf.slice(12);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        cipherWithTag,
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      wpsDebug("Decryption failed", null, "warn");
      return null;
    }
  }
}

const config = window.wpSignalConfig;
if (config?.baseUrl && config?.restUrl) {
  const client = new WPSignalClient(config);
  window.WPS = client;
  client.start();
}
