/**
 * WPSignal Client
 *
 * Prefers WebSocket for bidirectional communication, falls back to SSE.
 * Dispatches `wpsignal:<event>` DOM custom events regardless of transport.
 *
 * Exposes `window.WPS`: the public JS API so any theme or plugin can
 * subscribe/unsubscribe channels, publish messages, and listen for events
 * on the shared connection. Enqueue with `'wpsignal'` as a script dependency.
 */

import { wpsDebug } from "./utils";

class WPSignalClient implements WPSApi {
  private readonly config: WpSignalConfig;
  private readonly baseUrl: string;

  // --- Transport state ---
  private _transport: "ws" | "sse" | null = null;
  private static ssePublishWarned = false;
  private ws: WebSocket | null = null;
  private sseReader: EventSource | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  // --- Handler registries ---
  private readonly messageHandlers = new Set<WPSMessageHandler>();
  private readonly eventHandlers = new Map<string, Set<WPSEventHandler>>();
  private readonly connectionHandlers = new Set<(c: boolean) => void>();
  private readonly binaryHandlers = new Set<WPSBinaryHandler>();

  /** Channels requested by external consumers (queued until WS is open). */
  private readonly pendingSubscriptions: string[] = [];

  // --- Decryption ---
  /** Cached import of the AES-256-GCM key; resolved once and reused for every message. */
  private cryptoKeyPromise: Promise<CryptoKey | null> | null = null;

  constructor(config: WpSignalConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  // ---------------------------------------------------------------------------
  // Public API (WPSApi)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to one or more channels.
   * If the WebSocket is not yet open, the channels are queued and sent on connect.
   */
  subscribe(channels: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", channels }));
    } else {
      this.pendingSubscriptions.push(...channels);
    }
  }

  /**
   * Unsubscribe from one or more channels.
   * If the WebSocket is not open, channels are removed from the pending queue.
   */
  unsubscribe(channels: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", channels }));
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
          "[WPSignal] WebSocket connection failed",
          "real-time collaboration is unavailable SSE is receive-only so Yjs updates cannot reach peers. Reload the page to retry WebSocket, or deregister the WPSignal Yjs provider to restore HTTP polling.",
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

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Initialise the client: obtain a token and open a transport connection. */
  start(): void {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }
  }

  // ---------------------------------------------------------------------------
  // Connection management (private)
  // ---------------------------------------------------------------------------

  private init(): void {
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
          "[WPSignal] Token obtained",
          { expiresAt: new Date(data.exp * 1000).toISOString() },
          "log",
          true,
        );
        this.scheduleRefresh(data.exp);

        if (typeof WebSocket !== "undefined") {
          this.connectWebSocket(data.token, data.channels);
        } else {
          this.connectSSE(data.token, data.channels);
        }
      })
      .catch((err) => {
        wpsDebug("[WPSignal] Token fetch failed", err, "error");
        setTimeout(() => this.init(), 30000);
      });
  }

  private connectWebSocket(token: string, channels: string[]): void {
    const wsProto = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = this.baseUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProto}://${wsHost}/ws?token=${encodeURIComponent(
      token,
    )}`;

    let didFallback = false;
    let didOpen = false;

    const fallbackToSSE = (): void => {
      if (didFallback) return;
      didFallback = true;
      this.ws = null;
      wpsDebug("[WPSignal] Falling back to SSE", "SSE is receive-only so Yjs updates cannot reach peers. Reload the page to retry WebSocket, or deregister the WPSignal Yjs provider to restore HTTP polling.", "log");
      this.connectSSE(token, channels);
    };

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";
    this._transport = "ws";

    this.ws.addEventListener("open", () => {
      didOpen = true;
      this.setConnected(true);
      wpsDebug("[WPSignal] WebSocket connected");
      this.ws!.send(JSON.stringify({ type: "subscribe", channels }));
      this.flushPendingSubscriptions();
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
                } else {
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
            wpsDebug("Auth refreshed, expires at", new Date(msg.exp * 1000).toISOString());
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
      } else {
        wpsDebug("Reconnecting in 5s...");
        setTimeout(() => {
          this.cleanup();
          this.init();
        }, 5000);
      }
    });

    this.ws.addEventListener("error", () => {
      wpsDebug("WebSocket error", null, "warn");
    });
  }

  private connectSSE(token: string, channels: string[]): void {
    this._transport = "sse";
    this.setConnected(true);
    const url = `${this.baseUrl}/sse?token=${encodeURIComponent(
      token,
    )}&channels=${encodeURIComponent(channels.join(","))}`;
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
            } else {
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

  private cleanup(): void {
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

  // ---------------------------------------------------------------------------
  // Utilities (private)
  // ---------------------------------------------------------------------------

  private setConnected(value: boolean): void {
    this._connected = value;
    this.connectionHandlers.forEach((fn) => fn(value));
  }

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
      throw new Error(`WPSignal: token request failed (${res.status})`);
    }
    return res.json();
  }

  private dispatchEvent(
    eventName: string,
    channel: string,
    data: Record<string, unknown>,
  ): void {
    wpsDebug(eventName, data);
    document.dispatchEvent(
      new CustomEvent(`wpsignal:${eventName}`, {
        detail: { channel, data },
      }),
    );
    this.messageHandlers.forEach((fn) => fn(eventName, data, channel));
    this.eventHandlers.get(eventName)?.forEach((fn) => fn(data, channel));
  }

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

  // ---------------------------------------------------------------------------
  // Decryption (private)
  // ---------------------------------------------------------------------------

  /**
   * Import the AES-256-GCM key from `wpSignalConfig.encryptionKey` (base64).
   * The result is cached: the key is imported once and reused for every message.
   * Returns `null` if no key is configured or SubtleCrypto is unavailable.
   */
  private getCryptoKey(): Promise<CryptoKey | null> {
    if (!this.cryptoKeyPromise) {
      const b64 = this.config.encryptionKey;
      if (!b64 || typeof crypto === "undefined" || !crypto.subtle) {
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

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config = window.wpSignalConfig;
if (config?.baseUrl && config?.restUrl) {
  const client = new WPSignalClient(config);
  window.WPS = client;
  client.start();
}
