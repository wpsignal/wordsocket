import { wpsDebug } from "../utils";
import {
  WPSTransport,
  WPSTransportCallbacks,
  WPSTransportConnectOptions,
  WPSTransportStatus,
} from "./types";

/**
 * How many browser-driven EventSource reconnects in a row are tolerated
 * before the transport gives up and hands the decision back to the client.
 * The browser retries every few seconds with no backoff and no cap; after
 * this many misses the client's own schedule (exponential, 60 s cap, retrying
 * WebSocket first) takes over, so an unreachable relay is not polled forever.
 */
const MAX_BROWSER_RETRIES = 3;

export class SseTransport implements WPSTransport {
  public readonly name = "sse" as const;
  public readonly canPublish = false;
  public readonly canPublishBinary = false;

  private didOpen = false;
  /** Consecutive browser reconnects since the last successful open. */
  private browserRetries = 0;
  private source: EventSource | null = null;
  private token: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly channels = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly callbacks: WPSTransportCallbacks,
  ) {}

  connect({ token, channels }: WPSTransportConnectOptions): void {
    this.token = token;
    channels.forEach((channel) => this.channels.add(channel));

    const url = `${this.baseUrl}/sse?token=${encodeURIComponent(token)}&channels=${encodeURIComponent([...this.channels].join(","))}`;
    const source = new EventSource(url);
    this.source = source;

    source.addEventListener("open", () => {
      wpsDebug("SSE connected");
      this.didOpen = true;
      this.browserRetries = 0;
      this.callbacks.onOpen();
    });

    source.addEventListener("error", (event) => {
      this.callbacks.onError(event);
      if (source.readyState === EventSource.CLOSED) {
        /*
         * The browser gave up (for example a 401 or 404 on the stream URL):
         * no automatic retry will follow, so the client must decide.
         */
        wpsDebug("SSE closed by the browser", null, "warn");
        this.source = null;
        this.callbacks.onClose({ wasOpen: this.didOpen });
        return;
      }
      /*
       * CONNECTING: EventSource retries by itself and fires "open" again,
       * every few seconds, forever. Allow a few of those (a blip), then stop
       * it and let the client back off properly.
       */
      this.browserRetries += 1;
      if (this.browserRetries >= MAX_BROWSER_RETRIES) {
        wpsDebug(`SSE unreachable after ${this.browserRetries} browser retries, handing over to the client`, null, "warn");
        source.close();
        this.source = null;
        this.callbacks.onClose({ wasOpen: this.didOpen });
        return;
      }
      if (this.browserRetries === 1) {
        wpsDebug("SSE dropped, browser is reconnecting", null, "log");
      }
      this.callbacks.onClose({ wasOpen: this.didOpen, transient: true });
    });

    /*
     * The relay sends one unnamed frame per message with the event name inside
     * (`{ event, channel, data }`), so every event reaches this transport with
     * its channel, encrypted ones included; the client decrypts those.
     */
    source.addEventListener("message", (event: MessageEvent) => {
      try {
        const frame = JSON.parse(event.data) as { event?: unknown; channel?: unknown; data?: unknown };
        if (typeof frame.event !== "string") {
          wpsDebug("SSE frame without an event name", event.data, "warn");
          return;
        }
        this.callbacks.onMessage({
          event: frame.event,
          channel: typeof frame.channel === "string" ? frame.channel : "",
          data: (frame.data ?? {}) as Record<string, unknown>,
        });
      } catch (err) {
        wpsDebug("Failed to parse SSE frame", err, "error");
      }
    });
  }

  subscribe(channels: string[]): void {
    const changed = channels.some((channel) => !this.channels.has(channel));
    channels.forEach((channel) => this.channels.add(channel));
    if (changed) this.scheduleReconnect();
  }

  unsubscribe(channels: string[]): void {
    const changed = channels.some((channel) => this.channels.delete(channel));
    if (changed) this.scheduleReconnect();
  }

  setPresence(): void {
    // SSE cannot send; presence requires the WebSocket transport.
  }

  publish(): void {
    // SSE is receive-only.
  }

  publishBinary(): void {
    // SSE is receive-only.
  }

  refreshAuth(): boolean {
    return false;
  }

  close(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
  }

  getStatus(): WPSTransportStatus {
    return {
      name: this.name,
      connected: this.source?.readyState === EventSource.OPEN,
      readyState: this.source?.readyState ?? null,
      canPublish: this.canPublish,
      canPublishBinary: this.canPublishBinary,
      // SSE has no server keepalive to watchdog; EventSource auto-reconnects.
      lastMessageAt: null,
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || !this.token) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const token = this.token;
      if (!token) return;
      this.source?.close();
      this.source = null;
      this.connect({ token, channels: [] });
    }, 50);
  }
}
