/*
 * WordSocket client: WebSocket with SSE fallback, dispatching `wpsignal:<event>` DOM events and
 * exposing the public `window.WPS` API. Enqueue with `'wpsignal'` as a script dependency.
 */

import { wpsDebug } from "./utils";
import { onChannel, uuid, visitorId, isCrawler } from "./utils/identity";
import { createTracker } from "./presence/track";
import { createAttention } from "./attention/attention";
import { createRecovery } from "./recovery/recovery";
import { createRulesApi } from "./rules";
import "./recovery/recovery.css";
import { Backoff } from "./utils/backoff";
import { isRecord, stored } from "./utils/storage";
import { createDecryptor, type Decryptor } from "./utils/crypto";
import { relayEndpoints } from "./utils/relay";
import WPSClientDebug from "./utils/client-debug";
import WPSignalEvent from "./event";
import { SseTransport, WebSocketTransport } from "./transports";
import type {
  WPSTransport,
  WPSTransportCloseEvent,
  WPSTransportMessage,
  WPSTransportName,
  WPSTransportStatus,
} from "./transports";

if (window.wpSignalConfig?.isDebug) {
  window.wpsDebug ??= wpsDebug;
}

/**
 * Application close codes sent by the relay when it refuses or ends a
 * WebSocket session (4000-4999 are reserved for applications by RFC 6455).
 */
const CLOSE_INVALID_TOKEN = 4001;

/** A minted token with its channels and expiry, as the token route answers. */
interface TokenData {
  token: string;
  channels: string[];
  exp: number;
}

/** The guest token this tab holds, reused across pages while it has TOKEN_REUSE_MARGIN_S left. */
const tokenStore = stored<TokenData | null>(
  "session",
  "wordsocket-token",
  () => null,
  (value): value is TokenData =>
    isRecord(value) &&
    typeof value.token === "string" &&
    Array.isArray(value.channels) &&
    typeof value.exp === "number",
);
const TOKEN_REUSE_MARGIN_S = 30;
const CLOSE_SITE_NOT_FOUND = 4003;
const CLOSE_CONNECTION_LIMIT = 4029;

/**
 * A socket that stays open this long counts as established, and only then is
 * the retry state (backoff, one-time re-mint) reset.
 */
const STABLE_CONNECTION_MS = 3000;

/**
 * An open socket silent for longer than this (two missed 20 s server pings plus slack) is a zombie
 * left by a sleep, so it is reconnected.
 */
const STALE_CONNECTION_TIMEOUT_MS = 45000;

/** How often the watchdog samples transport liveness while connected. */
const STALE_CHECK_INTERVAL_MS = 10000;

export class WPSignalClient implements WPSApi {
  private readonly config: WpSignalConfig;
  /** Relay endpoints from PHP; the transports append the token. */
  private readonly endpoints: WpSignalEndpoints;

  private activeTransport: WPSTransport | null = null;
  private transportName: WPSTransportName | null = null;
  private static ssePublishWarned = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityListenerAttached = false;
  private _connected = false;
  /**
   * Debug only: skips the automatic reconnect so `window.wpsTest.drop()` can mimic a
   * dead-after-sleep socket until `wake()`.
   */
  private debugSuppressReconnect = false;

  private readonly messageHandlers = new Set<WPSMessageHandler>();
  private readonly eventHandlers = new Map<string, Set<WPSEventHandler>>();
  private readonly connectionHandlers = new Set<(c: boolean) => void>();
  private readonly stateHandlers = new Set<(s: WPSConnectionState) => void>();
  private readonly binaryHandlers = new Set<WPSBinaryHandler>();

  /**
   * Retry schedule shared by every path that re-enters `init()`, reset on a successful open.
   */
  private readonly backoff = new Backoff();
  /** Last connection error, kept until the next successful open. */
  private lastError: WPSConnectionError | null = null;
  /** Delay of the reconnect currently scheduled, for `onStateChange` consumers. */
  private retryInMs: number | null = null;
  /**
   * One fresh token is minted after a 4001 before giving up: the JWT may
   * simply have expired while the tab slept. A second 4001 is terminal.
   */
  private remintedAfterAuthFailure = false;
  /** Set once a terminal error stops all automatic retries. */
  private halted = false;
  /** Pending "connection is established" check, see STABLE_CONNECTION_MS. */
  private stableTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The channels the client wants subscribed, replayed to every new transport so a restart never
   * loses them.
   */
  private readonly subscribedChannels = new Set<string>();

  /**
   * Presence held per channel, re-sent on every reconnect; `null` leaves and stops the replay.
   */
  private readonly desiredPresence = new Map<string, Record<string, unknown>>();

  /** Cached AES-256-GCM decryptor; built once and reused for every message. */
  private decryptorPromise: Promise<Decryptor | null> | null = null;

  /**
   * Visitor tracking over presence (0.30).
   */
  readonly presence: WPSPresenceApi = {
    track: (channel, options) =>
      createTracker(
        this,
        this.config.presence,
        this.config.nonce,
        channel,
        options,
      ),
  };

  /** Where the visitor's attention is (0.31): `page`, `window` or `hidden`. */
  readonly attention: WPSAttentionApi = createAttention();

  /** The surfaces a prompt reaches the visitor through (0.31). */
  readonly recovery: WPSRecoveryApi = createRecovery(this.attention);

  /**
   * The rules engine and the registration API for plugins (0.31); built in the constructor, since
   * it reads the config.
   */
  readonly rules: WPSRulesApi;

  constructor(config: WpSignalConfig) {
    this.config = config;
    this.endpoints = relayEndpoints(config);
    this.rules = createRulesApi(this, config, this.attention, this.recovery);
  }

  /**
   * Subscribe to one or more channels; the set is replayed on every reconnect, so a subscription
   * made while connecting is never dropped.
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

  /**
   * Enter or update connection-scoped presence on a channel, re-sent on reconnect; `null` leaves at
   * once. A no-op on SSE.
   */
  setPresence(channel: string, state: Record<string, unknown> | null): void {
    if (state === null) {
      this.desiredPresence.delete(channel);
    } else {
      this.desiredPresence.set(channel, state);
    }
    if (this.activeTransport?.getStatus().connected) {
      this.activeTransport.setPresence(channel, state);
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
   * Register a handler for incoming binary WebSocket frames (Yjs updates); returns an unsubscribe
   * function.
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
  get status(): WPSStatus {
    return {
      ...(this.activeTransport?.getStatus() ?? this.emptyStatus()),
      lastError: this.lastError,
      failures: this.backoff.failures,
    };
  }

  /**
   * A version-4 UUID that also works on plain HTTP pages, where `crypto.randomUUID` does not exist.
   */
  uuid(): string {
    return uuid();
  }

  /**
   * This browser's stable id, shared by every tab and extension on the site. Names a browser, not a
   * person.
   */
  visitorId(): string {
    return visitorId();
  }

  /**
   * Whether `channel` is `expected`, allowing the qualified `site:{id}:` spelling. Check it before
   * trusting an event.
   */
  onChannel(channel: string, expected: string): boolean {
    return onChannel(channel, expected);
  }

  /** Current connection state as seen by `onStateChange` handlers. */
  get state(): WPSConnectionState {
    return {
      connected: this._connected,
      transport: this.transportName,
      error: this.lastError ?? undefined,
      retryInMs: this.retryInMs ?? undefined,
      failures: this.backoff.failures,
    };
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

  /**
   * Like `onConnectionChange` but with the full state (why it is down, the scheduled retry, failed
   * attempts), firing on every change. Returns an unsubscribe function.
   */
  onStateChange(handler: (s: WPSConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /**
   * Initialise the client: obtain a token and open a transport connection.
   *
   * @since 0.31.0 Returns before connecting for a crawler.
   */
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
    /*
     * A crawler rendering the page is nobody to deliver to: no socket, no presence, no visitor
     * counted on the site or the plan. The tracker and the rules engine check the same way.
     */
    if (isCrawler()) {
      wpsDebug("Crawler detected; not connecting", navigator.userAgent);
      return;
    }
    /*
     * A prerendered page runs scripts before anyone looks at it, so connecting waits until the
     * document is activated.
     */
    const doc = document as Document & { prerendering?: boolean };
    if (doc.prerendering) {
      document.addEventListener("prerenderingchange", () => this.start(), {
        once: true,
      });
      return;
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
    /*
     * Close cleanly when the page goes away, or a page parked in the back/forward cache keeps its
     * socket and the site's count climbs; a restored page reconnects on `pageshow`.
     */
    window.addEventListener("pagehide", () => this.cleanup());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) this.init();
    });
    this.startWatchdog();
  }

  /**
   * A socket that reports OPEN but has received nothing for STALE_CONNECTION_TIMEOUT_MS was dropped
   * by the server during a sleep, and no close event will arrive for minutes.
   */
  private isStale(): boolean {
    const status = this.activeTransport?.getStatus();
    if (
      !status ||
      status.name !== "ws" ||
      !status.connected ||
      status.lastMessageAt === null
    ) {
      return false;
    }
    return Date.now() - status.lastMessageAt > STALE_CONNECTION_TIMEOUT_MS;
  }

  /**
   * Periodically force-reconnect zombie sockets; background tabs clamp the interval to about a
   * minute, and the visibility handler covers the return at once.
   */
  private startWatchdog(): void {
    if (this.watchdogTimer !== null) return;
    this.watchdogTimer = setInterval(() => {
      if (this.debugSuppressReconnect) return;
      if (this.isStale()) {
        this.forceReconnect("Stale connection detected by watchdog");
      }
    }, STALE_CHECK_INTERVAL_MS);
  }

  /** Tear down the current transport and start a fresh connection now. */
  private forceReconnect(reason: string): void {
    wpsDebug(`${reason}, reconnecting...`);
    this.reInit();
  }

  /**
   * Reconnect now rather than at the scheduled retry; a no-op when already connected, mid-handshake
   * or with an `init()` in flight.
   */
  private handleReconnect(): void {
    if (this._connected) {
      /*
       * A zombie socket still reports connected; verify liveness before
       * trusting it.
       */
      if (this.isStale()) {
        this.forceReconnect("Stale connection detected on wake");
      }
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
    this.forceReconnect("Visibility/network restored");
  }

  /**
   * Cleanup the client and initialize a new connection.
   */
  private reInit(): void {
    this.cleanup();
    this.init();
  }

  /**
   * Obtain a token and open a transport. Retries after 30s if the token fetch fails.
   *
   * @since 0.31.0 A guest tab reuses the token it holds across pages.
   */
  private init(): void {
    this.attachVisibilityListeners();

    const now = Math.floor(Date.now() / 1000);
    const printed: TokenData | null =
      this.config.token && this.config.channels && this.config.exp
        ? {
            token: this.config.token,
            channels: this.config.channels,
            exp: this.config.exp,
          }
        : null;
    delete this.config.token;
    delete this.config.channels;
    delete this.config.exp;
    /*
     * A logged-in page prints a fresh token. A guest page may come from a page cache with the token
     * minted when it was cached, so the token this tab fetched earlier comes first, then a printed
     * one that has not expired, then the route.
     */
    const remembered = this.config.nonce ? null : tokenStore.read();
    let tokenPromise: Promise<TokenData>;
    if (this.config.nonce && printed) {
      tokenPromise = Promise.resolve(printed);
    } else if (remembered && remembered.exp - now > TOKEN_REUSE_MARGIN_S) {
      tokenPromise = Promise.resolve(remembered);
    } else if (printed && printed.exp > now) {
      tokenPromise = Promise.resolve(printed);
    } else {
      tokenPromise = this.fetchToken();
    }

    tokenPromise
      .then((data) => {
        this.rememberToken(data);
        wpsDebug(
          "Token obtained",
          { expiresAt: new Date(data.exp * 1000).toISOString() },
          "log",
          true,
        );
        this.scheduleRefresh(data.exp);

        if (this.webSocketPossible()) {
          this.connectWebSocketTransport(data.token, data.channels);
        } else {
          this.connectSseTransport(data.token, data.channels);
        }
      })
      .catch((err: unknown) => {
        wpsDebug("Token fetch failed", err, "warn");
        if (isAuthStatus(err)) {
          /*
           * The REST endpoint refused us (logged out, or public clients
           * disabled): retrying cannot help until the page reloads.
           */
          this.halt("authentication-failed", "Token request was refused");
          return;
        }
        this.scheduleRetry(() => this.init(), "unknown-error", messageOf(err));
      });
  }

  private connectWebSocketTransport(token: string, channels: string[]): void {
    channels.forEach((ch) => this.subscribedChannels.add(ch));
    const transport = new WebSocketTransport(this.endpoints.ws, {
      onOpen: () => {
        /*
         * Subscribe before announcing the connection, since `onConnectionChange` handlers publish
         * at once and replies only arrive after the subscriptions are processed.
         */
        this.replaySubscriptions();
        this.setConnected(true);
      },
      onMessage: (message) => this.handleTransportMessage(message),
      onBinaryMessage: (channel, data) => {
        this.binaryHandlers.forEach((handler) => handler(channel, data));
      },
      onClose: (event) => this.handleWebSocketClose(event, token, channels),
      onError: () => undefined,
    });
    this.activateTransport(transport);
    transport.connect({ token, channels });
  }

  private handleWebSocketClose(
    { code, reason, wasOpen }: WPSTransportCloseEvent,
    token: string,
    channels: string[],
  ): void {
    this.setConnected(false);
    switch (code) {
      case CLOSE_INVALID_TOKEN:
        tokenStore.write(null);
        if (!this.remintedAfterAuthFailure) {
          this.remintedAfterAuthFailure = true;
          wpsDebug(
            "Token rejected, minting a fresh one",
            reason ?? null,
            "warn",
          );
          this.reInit();
        } else {
          this.halt(
            "authentication-failed",
            reason ?? "Token rejected by the relay",
          );
        }
        return;
      case CLOSE_SITE_NOT_FOUND:
        this.halt(
          "authentication-failed",
          reason ?? "Site is no longer registered",
        );
        return;
      case CLOSE_CONNECTION_LIMIT:
        this.scheduleRetry(
          () => {
            this.reInit();
          },
          "connection-limit-exceeded",
          reason ?? "Connection limit reached for this site",
        );
        return;
    }
    if (!wasOpen) {
      this.fallbackToSse(token, channels);
    } else if (this.debugSuppressReconnect) {
      wpsDebug("[debug] Auto-reconnect suppressed (simulated sleep)");
    } else {
      this.scheduleRetry(
        () => {
          this.reInit();
        },
        "unknown-error",
        reason ?? (code ? `WebSocket closed (${code})` : "WebSocket closed"),
      );
    }
  }

  private connectSseTransport(token: string, channels: string[]): void {
    channels.forEach((ch) => this.subscribedChannels.add(ch));
    const transport = new SseTransport(this.endpoints.sse, {
      onOpen: () => {
        this.replaySubscriptions();
        this.setConnected(true);
        this.probeWebSocket(token, channels);
      },
      onMessage: (message) => this.handleTransportMessage(message),
      onBinaryMessage: () => undefined,
      onClose: ({ transient, wasOpen }) => {
        this.setConnected(false);
        if (transient) {
          return; // EventSource retries on its own and will call onOpen.
        }
        /*
         * The browser closed the stream for good (typically a rejected
         * token): mint a fresh token and reconnect on the shared schedule.
         */
        this.scheduleRetry(
          () => {
            this.reInit();
          },
          "unknown-error",
          wasOpen ? "Event stream closed" : "Event stream could not be opened",
        );
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

  /** Whether WebSocket is worth trying on this page at all. */
  private webSocketPossible(): boolean {
    return typeof WebSocket !== "undefined" && !this.config.forceSSE;
  }

  /**
   * The fallback stream just opened, so the relay is reachable: try the socket once now, which
   * moves the client back the moment a relay restart ends.
   */
  private probeWebSocket(token: string, channels: string[]): void {
    const stream = this.activeTransport;
    if (
      this.halted ||
      !this.webSocketPossible() ||
      !stream ||
      stream.name !== "sse"
    )
      return;
    const socket: WebSocketTransport = new WebSocketTransport(
      this.endpoints.ws,
      {
        onOpen: () => {
          if (this.activeTransport !== stream) {
            socket.close(); // the stream moved on while the socket was opening
            return;
          }
          stream.close();
          this.activateTransport(socket);
          this.replaySubscriptions();
          wpsDebug("Back on WebSocket");
          this.emitState();
        },
        onMessage: (message) => this.handleTransportMessage(message),
        onBinaryMessage: (channel, data) => {
          this.binaryHandlers.forEach((handler) => handler(channel, data));
        },
        onClose: (event) => {
          if (this.activeTransport !== socket) return; // never took over: the stream carries on
          this.handleWebSocketClose(event, token, channels);
        },
        onError: () => undefined,
      },
    );
    socket.connect({ token, channels });
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
    if (this.stableTimer !== null) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    if (value) {
      this.lastError = null;
      this.retryInMs = null;
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        this.backoff.reset();
        this.remintedAfterAuthFailure = false;
        this.emitState();
      }, STABLE_CONNECTION_MS);
    }
    this.connectionHandlers.forEach((fn) => fn(value));
    this.emitState();
  }

  private emitState(): void {
    const state = this.state;
    this.stateHandlers.forEach((fn) => fn(state));
  }

  /**
   * Schedule `action` after the next backoff delay, recording why; every automatic retry goes
   * through here so the countdown consumers see one schedule.
   */
  private scheduleRetry(
    action: () => void,
    code: WPSConnectionErrorCode,
    message: string,
  ): void {
    if (this.halted) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = this.backoff.next();
    this.lastError = { code, message };
    this.retryInMs = delay;
    wpsDebug(
      `Retrying in ${Math.round(delay / 1000)}s`,
      { code, message, failures: this.backoff.failures },
      "warn",
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.retryInMs = null;
      action();
    }, delay);
    this.emitState();
  }

  /** Stop retrying entirely: only a page reload (or `start()`) can recover. */
  private halt(code: WPSConnectionErrorCode, message: string): void {
    this.halted = true;
    this.cleanup();
    this.lastError = { code, message };
    this.retryInMs = null;
    wpsDebug("Giving up on the connection", { code, message }, "error");
    this.emitState();
  }

  /*
   * Mint a fresh token, channel list, and expiry from the REST endpoint. The
   * nonce is only printed for logged-in visitors.
   */
  private async fetchToken(): Promise<TokenData> {
    const res = await fetch(this.config.restUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.nonce ? { "X-WP-Nonce": this.config.nonce } : {}),
      },
    });
    if (!res.ok) {
      throw new TokenRequestError(res.status);
    }
    const data = (await res.json()) as TokenData;
    this.rememberToken(data);
    return data;
  }

  /** Keep a guest token for this tab's next page; a logged-in page prints its own. */
  private rememberToken(data: TokenData): void {
    if (!this.config.nonce) tokenStore.write(data);
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
   * Schedule a token refresh at 80% of its lifetime (at least 10 s): in place over an open
   * WebSocket, otherwise by reconnecting.
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
          /*
           * A WebSocket takes the new token in place; SSE cannot, so the refresh reconnects and
           * prefers WebSocket, which brings presence and publishing back after the outage.
           */
          if (!this.activeTransport?.refreshAuth(data.token)) {
            this.reInit();
          }
          this.scheduleRefresh(data.exp);
        })
        .catch((err: unknown) => {
          wpsDebug("Token refresh failed", err, "warn");
          if (isAuthStatus(err)) {
            this.halt("authentication-failed", "Token refresh was refused");
            return;
          }
          // Keep the current socket while it lasts; try to refresh again later.
          this.scheduleRetry(
            () => {
              this.reInit();
            },
            "unknown-error",
            messageOf(err),
          );
        });
    }, refreshAt);
  }

  /**
   * Subscribe the active transport to every wanted channel, on each reconnect, fallback and
   * token-refresh reconnect.
   */
  private replaySubscriptions(): void {
    if (!this.activeTransport?.getStatus().connected) return;
    if (this.subscribedChannels.size) {
      this.activeTransport.subscribe([...this.subscribedChannels]);
    }
    this.desiredPresence.forEach((state, channel) => {
      this.activeTransport?.setPresence(channel, state);
    });
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
        } else {
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

  private emptyStatus(): WPSTransportStatus {
    return {
      name: null,
      connected: false,
      readyState: null,
      canPublish: false,
      canPublishBinary: false,
      lastMessageAt: null,
    };
  }

  /**
   * Build the AES-256-GCM decryptor from `wpSignalConfig.encryptionKey` once: SubtleCrypto where
   * available, a pure-JS cipher on plain HTTP. `null` when no key is configured.
   */
  private getDecryptor(): Promise<Decryptor | null> {
    if (!this.decryptorPromise) {
      const b64 = this.config.encryptionKey;
      this.decryptorPromise = b64
        ? createDecryptor(
            Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
          ).catch(() => null)
        : Promise.resolve(null);
    }
    return this.decryptorPromise;
  }

  /**
   * Decrypt a payload from the PHP Publisher (`IV[12] || ciphertext[N] || auth-tag[16]`, base64),
   * returning `{ event, data }` or `null`.
   */
  private async decryptMessage(
    p: string,
  ): Promise<{ event: string; data: Record<string, unknown> } | null> {
    const decrypt = await this.getDecryptor();
    if (!decrypt) return null;
    try {
      const plain = await decrypt(
        Uint8Array.from(atob(p), (c) => c.charCodeAt(0)),
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

/** Thrown by `fetchToken` so callers can tell a refusal from a network blip. */
class TokenRequestError extends Error {
  constructor(readonly status: number) {
    super(`WordSocket: token request failed (${status})`);
    this.name = "TokenRequestError";
  }
}

function isAuthStatus(err: unknown): boolean {
  return (
    err instanceof TokenRequestError &&
    (err.status === 401 || err.status === 403)
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
