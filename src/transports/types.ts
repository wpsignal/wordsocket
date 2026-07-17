export type WPSTransportName = "ws" | "sse";

export type WPSTransportStatus = {
  name: WPSTransportName | null;
  connected: boolean;
  readyState: number | null;
  canPublish: boolean;
  canPublishBinary: boolean;
};

export type WPSTransportMessage = {
  event: string;
  channel: string;
  data: Record<string, unknown>;
};

export type WPSTransportCloseEvent = {
  code?: number;
  wasOpen: boolean;
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
