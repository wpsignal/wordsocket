import { wpsDebug } from "../utils";
import {
  WPSTransport,
  WPSTransportCallbacks,
  WPSTransportConnectOptions,
  WPSTransportStatus,
} from "./types";

const SSE_EVENT_TYPES = [
  "post.updated",
  "post.created",
  "post.deleted",
  "comment.created",
];

export class SseTransport implements WPSTransport {
  public readonly name = "sse" as const;
  public readonly canPublish = false;
  public readonly canPublishBinary = false;

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
      this.callbacks.onOpen();
    });

    source.addEventListener("error", (event) => {
      wpsDebug("SSE error", event, "error");
      this.callbacks.onError(event);
    });

    SSE_EVENT_TYPES.forEach((eventType) => {
      source.addEventListener(eventType, (event: Event) => {
        try {
          this.callbacks.onMessage({
            event: eventType,
            channel: "",
            data: JSON.parse((event as MessageEvent).data),
          });
        } catch (err) {
          wpsDebug("Failed to parse SSE data", err, "error");
        }
      });
    });

    source.addEventListener("encrypted", (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        this.callbacks.onMessage({
          event: "encrypted",
          channel: "",
          data: payload.data ?? payload,
        });
      } catch (err) {
        wpsDebug("Failed to parse encrypted SSE data", err, "error");
      }
    });

    source.addEventListener("message", (event: MessageEvent) => {
      wpsDebug("SSE message", event.data);
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
