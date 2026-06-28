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
import { SseTransport, WebSocketTransport } from "./transports";
import type {
  WPSTransport,
  WPSTransportMessage,
  WPSTransportName,
  WPSTransportStatus,
} from "./transports";

window.wpsDebug ??= wpsDebug;

export class WPSignalClient implements WPSApi {
  private readonly config: WpSignalConfig;
  private readonly baseUrl: string;

  private activeTransport: WPSTransport | null = null;
  private transportName: WPSTransportName | null = null;
  private static ssePublishWarned = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityListenerAttached = false;
  private _connected = false;
  /** Debug-only: when true the WS close handler skips the automatic 5s reconnect,
   * letting `window.wpsTest.drop()` mimic a dead-after-sleep socket until `wake()`. */
  private debugSuppressReconnect = false;

  private readonly messageHandlers = new Set<WPSMessageHandler>();
  private readonly eventHandlers = new Map<string, Set<WPSEventHandler>>();
  private readonly connectionHandlers = new Set<(c: boolean) => void>();
  private readonly binaryHandlers = new Set<WPSBinaryHandler>();

  /**
   * Authoritative set of channels the client wants subscribed. Persists across
   * reconnects, fallbacks, and token refreshes, and is replayed to every new
   * transport on open so subscriptions are never lost when a transport restarts.
   */
  private readonly subscribedChannels = new Set<string>();

  /** Cached import of the AES-256-GCM key; resolved once and reused for every message. */
  private cryptoKeyPromise: Promise<CryptoKey | null> | null = null;
  /** True when SubtleCrypto is unavailable (HTTP context); suppresses per-message warnings. */
  private noSubtleCrypto = false;

  constructor(config: WpSignalConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  /**
   * Subscribe to one or more channels. Channels are tracked in an authoritative
   * set and forwarded to the active transport when connected; either way they
   * are replayed on every (re)connect, so a subscription made while connecting
   * (or while on a transport that later restarts) is never dropped.
   */
  subscribe(channels: string[]): void {
    const added = channels.filter((ch) => !this.subscribedChannels.has(ch));
    if (!added.length) return;
    added.forEach((ch) => this.subscribedChannels.add(ch));
    if (this.activeTransport?.getStatus().connected) {
      this.activeTransport.subscribe(added);
    }
  }

  /** Unsubscribe from one or more channels and stop replaying them on reconnect. */
  unsubscribe(channels: string[]): void {
    const removed = channels.filter((ch) => this.subscribedChannels.delete(ch));
    if (!removed.length) {
      return;
    }
    if (this.activeTransport?.getStatus().connected) {
      this.activeTransport.unsubscribe(removed);
    }
  }

  /** Send a raw binary frame when the active transport supports it. */
  publishBinary(channel: string, data: Uint8Array): void {
    if (this.activeTransport && !this.activeTransport.canPublishBinary) {
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
    this.activeTransport?.publishBinary(channel, data);
  }

  /** Publish a message when the active transport supports it. */
  publish(
    channel: string,
    event: string,
    data: Record<string, unknown> = {},
  ): void {
    if (!this.activeTransport?.canPublish) return;
    this.activeTransport.publish(channel, event, data);
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
    return this.transportName;
  }

  /** Current connection and transport capabilities. */
  get status(): WPSTransportStatus {
    return this.activeTransport?.getStatus() ?? this.emptyStatus();
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
          transport: this.transportName,
          transportStatus: this.status,
          reconnectPending: this.reconnectTimer !== null,
          suppressed: this.debugSuppressReconnect,
        }),
        drop: () => {
          this.debugSuppressReconnect = true;
          if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.activeTransport?.close();
          this.setConnected(false);
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
      if (document.visibilityState === "visible") {
        this.handleReconnect();
      }
    });
    window.addEventListener("online", () => this.handleReconnect());
  }

  /**
   * Reconnect immediately rather than waiting for the scheduled retry. No-ops if
   * already connected, mid-handshake, or if an init() is already in flight.
   */
  private handleReconnect(): void {
    if (this._connected) {
      return;
    }
    // init() is already in flight (cleanup ran but token fetch hasn't resolved yet).
    if (this.activeTransport === null && this.reconnectTimer === null) {
      return;
    }
    // Don't interrupt a WS handshake in progress; let it open or fall back naturally.
    if (
      this.activeTransport?.name === "ws" &&
      this.activeTransport.getStatus().readyState === WebSocket.CONNECTING
    ) {
      return;
    }
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
          this.connectWebSocketTransport(data.token, data.channels);
        } else {
          this.connectSseTransport(data.token, data.channels);
        }
      })
      .catch((err) => {
        wpsDebug("Token fetch failed", err, "error");
        setTimeout(() => this.init(), 30000);
      });
  }

  private connectWebSocketTransport(token: string, channels: string[]): void {
    channels.forEach((ch) => this.subscribedChannels.add(ch));
    const transport = new WebSocketTransport(this.baseUrl, {
      onOpen: () => {
        this.setConnected(true);
        this.replaySubscriptions();
      },
      onMessage: (message) => this.handleTransportMessage(message),
      onBinaryMessage: (channel, data) => {
        this.binaryHandlers.forEach((handler) => handler(channel, data));
      },
      onClose: ({ wasOpen }) => {
        this.setConnected(false);
        if (!wasOpen) {
          this.fallbackToSse(token, channels);
        } else if (this.debugSuppressReconnect) {
          wpsDebug("[debug] Auto-reconnect suppressed (simulated sleep)");
        } else {
          this.scheduleReconnect();
        }
      },
      onError: () => undefined,
    });
    this.activateTransport(transport);
    transport.connect({ token, channels });
  }

  private connectSseTransport(token: string, channels: string[]): void {
    channels.forEach((ch) => this.subscribedChannels.add(ch));
    const transport = new SseTransport(this.baseUrl, {
      onOpen: () => {
        this.setConnected(true);
        this.replaySubscriptions();
      },
      onMessage: (message) => this.handleTransportMessage(message),
      onBinaryMessage: () => undefined,
      onClose: () => {
        this.setConnected(false);
      },
      onError: () => undefined,
    });
    this.activateTransport(transport);
    // SSE subscribes via the connection URL, so seed it with the full set.
    transport.connect({ token, channels: [...this.subscribedChannels] });
  }

  private activateTransport(transport: WPSTransport): void {
    this.activeTransport = transport;
    this.transportName = transport.name;
  }

  private fallbackToSse(token: string, channels: string[]): void {
    wpsDebug(
      "Falling back to SSE",
      "WebSocket connection failed; using SSE (receive-only). Features requiring bidirectional communication are unavailable.",
      "log",
    );
    this.activeTransport = null;
    this.transportName = null;
    this.connectSseTransport(token, channels);
  }

  /** Tear down the active transport and timers. */
  private cleanup(): void {
    this.debugSuppressReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.activeTransport?.close();
    this.activeTransport = null;
    this.transportName = null;
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
          if (!this.activeTransport?.refreshAuth(data.token)) {
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

  /**
   * Subscribe the active transport to every channel the client wants. Called on
   * each (re)connect so subscriptions survive transport restarts, SSE fallback,
   * and the token-refresh reconnect.
   */
  private replaySubscriptions(): void {
    if (!this.subscribedChannels.size) return;
    if (!this.activeTransport?.getStatus().connected) return;
    this.activeTransport.subscribe([...this.subscribedChannels]);
  }

  private handleTransportMessage(message: WPSTransportMessage): void {
    if (
      message.event === "encrypted" &&
      message.data?.v === 1 &&
      typeof message.data?.p === "string"
    ) {
      this.decryptMessage(message.data.p).then((plain) => {
        if (plain) {
          this.dispatchEvent(plain.event, message.channel, plain.data ?? {});
        } else if (!this.noSubtleCrypto) {
          wpsDebug(
            "Could not decrypt message on channel",
            message.channel,
            "warn",
          );
        }
      });
      return;
    }
    this.dispatchEvent(message.event, message.channel, message.data ?? {});
  }

  private scheduleReconnect(): void {
    wpsDebug("Reconnecting in 5s...");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.cleanup();
      this.init();
    }, 5000);
  }

  private emptyStatus(): WPSTransportStatus {
    return {
      name: null,
      connected: false,
      readyState: null,
      canPublish: false,
      canPublishBinary: false,
    };
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
