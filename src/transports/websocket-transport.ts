import { wpsDebug } from "../utils";
import {
  WPSTransport,
  WPSTransportCallbacks,
  WPSTransportConnectOptions,
  WPSTransportStatus,
} from "./types";

export class WebSocketTransport implements WPSTransport {
  public readonly name = "ws" as const;
  public readonly canPublish = true;
  public readonly canPublishBinary = true;

  private ws: WebSocket | null = null;
  private didOpen = false;
  private isClosing = false;

  constructor(
    private readonly baseUrl: string,
    private readonly callbacks: WPSTransportCallbacks,
  ) {}

  connect({ token }: WPSTransportConnectOptions): void {
    this.didOpen = false;
    this.isClosing = false;
    this.ws = new WebSocket(this.wsUrl(token));
    this.ws.binaryType = "arraybuffer";

    this.ws.addEventListener("open", () => {
      this.didOpen = true;
      wpsDebug("WebSocket connected");
      // Channel subscriptions are driven by the client, which replays the full
      // authoritative set on open. The WS transport does not self-subscribe.
      this.callbacks.onOpen();
    });

    this.ws.addEventListener("message", (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryFrame(new Uint8Array(event.data));
        return;
      }
      this.handleTextFrame(event.data);
    });

    this.ws.addEventListener("close", (event: CloseEvent) => {
      wpsDebug(`WebSocket closed (code=${event.code})`);
      this.ws = null;
      if (this.isClosing) {
        this.isClosing = false;
        return;
      }
      this.callbacks.onClose({ code: event.code, wasOpen: this.didOpen });
    });

    this.ws.addEventListener("error", (event) => {
      wpsDebug("WebSocket error", null, "warn");
      this.callbacks.onError(event);
    });
  }

  subscribe(channels: string[]): void {
    this.sendJson({ type: "subscribe", channels });
  }

  unsubscribe(channels: string[]): void {
    this.sendJson({ type: "unsubscribe", channels });
  }

  publish(
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): void {
    this.sendJson({ type: "message", channel, event, data });
  }

  publishBinary(channel: string, data: Uint8Array): void {
    if (!this.isOpen()) return;
    const channelBytes = new TextEncoder().encode(channel);
    const frame = new Uint8Array(2 + channelBytes.length + data.length);
    frame[0] = (channelBytes.length >> 8) & 0xff;
    frame[1] = channelBytes.length & 0xff;
    frame.set(channelBytes, 2);
    frame.set(data, 2 + channelBytes.length);
    this.ws?.send(frame);
  }

  refreshAuth(token: string): boolean {
    if (!this.isOpen()) return false;
    this.sendJson({ type: "auth", token });
    return true;
  }

  close(): void {
    this.isClosing = true;
    this.ws?.close();
    this.ws = null;
  }

  getStatus(): WPSTransportStatus {
    return {
      name: this.name,
      connected: this.isOpen(),
      readyState: this.ws?.readyState ?? null,
      canPublish: this.canPublish,
      canPublishBinary: this.canPublishBinary,
    };
  }

  private wsUrl(token: string): string {
    const wsProto = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = this.baseUrl.replace(/^https?:\/\//, "");
    return `${wsProto}://${wsHost}/ws?token=${encodeURIComponent(token)}`;
  }

  private isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (!this.isOpen()) return;
    this.ws?.send(JSON.stringify(payload));
  }

  private handleTextFrame(data: string): void {
    try {
      const message = JSON.parse(data);
      switch (message.type) {
        case "message":
          this.callbacks.onMessage({
            event: message.event,
            channel: message.channel,
            data: message.data ?? {},
          });
          break;
        case "ping":
          this.sendJson({ type: "pong" });
          break;
        case "subscribed":
          wpsDebug("Subscribed to", message.channels);
          break;
        case "unsubscribed":
          wpsDebug("Unsubscribed from", message.channels);
          break;
        case "auth_ok":
          wpsDebug(
            "Auth refreshed, expires at",
            new Date(message.exp * 1000).toISOString(),
          );
          break;
        case "error":
          wpsDebug("Server error:", message.code, message.message);
          break;
      }
    } catch (err) {
      wpsDebug("Failed to parse WS message", err, "error");
    }
  }

  private handleBinaryFrame(buf: Uint8Array): void {
    if (buf.length < 2) return;
    const channelLen = (buf[0] << 8) | buf[1];
    if (buf.length < 2 + channelLen) return;
    const channel = new TextDecoder().decode(buf.slice(2, 2 + channelLen));
    const payload = buf.slice(2 + channelLen);
    this.callbacks.onBinaryMessage(channel, payload);
  }
}
