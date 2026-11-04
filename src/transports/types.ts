/**
 * A transport's name.
 *
 * @since 0.18.0
 */
export type WPSTransportName = "ws" | "sse";

/**
 * A transport's connection status.
 *
 * @since 0.18.0
 */
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

/**
 * A message a transport received.
 *
 * @since 0.18.0
 */
export type WPSTransportMessage = {
  event: string;
  channel: string;
  data: Record<string, unknown>;
};

/**
 * What a transport reports when it closes.
 *
 * @since 0.18.0
 */
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

/**
 * The callbacks a transport reports to.
 *
 * @since 0.18.0
 */
export type WPSTransportCallbacks = {
  onOpen: () => void;
  onMessage: (message: WPSTransportMessage) => void;
  onBinaryMessage: (channel: string, data: Uint8Array) => void;
  onClose: (event: WPSTransportCloseEvent) => void;
  onError: (error: unknown) => void;
};

/**
 * What a transport needs to connect.
 *
 * @since 0.18.0
 */
export type WPSTransportConnectOptions = {
  token: string;
  channels: string[];
};

/**
 * A connection to the relay over one protocol.
 *
 * @since 0.18.0
 */
export interface WPSTransport {
  readonly name: WPSTransportName;
  readonly canPublish: boolean;
  readonly canPublishBinary: boolean;

  connect(options: WPSTransportConnectOptions): void;
  subscribe(channels: string[]): void;
  unsubscribe(channels: string[]): void;
  publish(channel: string, event: string, data: Record<string, unknown>): void;
  publishBinary(channel: string, data: Uint8Array): void;
  /** Enter/update connection-scoped presence on a channel, or leave it with
   *  `null`. The membership is also dropped automatically when the socket
   *  closes. No-op on transports (SSE) that cannot send. */
  setPresence(channel: string, state: Record<string, unknown> | null): void;
  refreshAuth(token: string): boolean;
  close(): void;
  getStatus(): WPSTransportStatus;
}
