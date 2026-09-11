export type WPSTransportName = "ws" | "sse";

export type WPSTransportStatus = {
  name: WPSTransportName | null;
  connected: boolean;
  readyState: number | null;
  canPublish: boolean;
  canPublishBinary: boolean;
  /**
   * Timestamp (ms) of the last inbound frame, including server pings. Used to
   * detect zombie sockets that report OPEN after a sleep/background suspension
   * even though the server has already dropped the connection.
   */
  lastMessageAt: number | null;
};

export type WPSTransportMessage = {
  event: string;
  channel: string;
  data: Record<string, unknown>;
};

export type WPSTransportCloseEvent = {
  /** WebSocket close code, including the relay's application codes (4001, 4003, 4029). */
  code?: number;
  /** Close reason from the relay, when it sent one. */
  reason?: string;
  wasOpen: boolean;
  /**
   * The transport is retrying on its own (EventSource auto-reconnect) and
   * will call onOpen again if it succeeds; the client should not schedule
   * its own reconnect for this event.
   */
  transient?: boolean;
};

export type WPSTransportCallbacks = {
  onOpen: () => void;
  onMessage: (message: WPSTransportMessage) => void;
  onBinaryMessage: (channel: string, data: Uint8Array) => void;
  onClose: (event: WPSTransportCloseEvent) => void;
  onError: (error: unknown) => void;
};

export type WPSTransportConnectOptions = {
  token: string;
  channels: string[];
};

export interface WPSTransport {
  readonly name: WPSTransportName;
  readonly canPublish: boolean;
  readonly canPublishBinary: boolean;

  connect(options: WPSTransportConnectOptions): void;
  subscribe(channels: string[]): void;
  unsubscribe(channels: string[]): void;
  publish(channel: string, event: string, data: Record<string, unknown>): void;
  publishBinary(channel: string, data: Uint8Array): void;
  refreshAuth(token: string): boolean;
  close(): void;
  getStatus(): WPSTransportStatus;
}
