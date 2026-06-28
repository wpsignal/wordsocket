import { wpsDebug } from ".";

type WPSClientDebugStatus = {
  connected: boolean;
  transport: "ws" | "sse" | null;
  wsReadyState: number | null;
  reconnectPending: boolean;
  suppressed: boolean;
};

type WPSClientDebugOptions = {
  status: () => WPSClientDebugStatus;
  drop: () => void;
  wake: () => void;
};

/**
 * Exposes console helpers for exercising the WordSocket sleep and wake path.
 */
export default class WPSClientDebug {
  private readonly getStatus: () => WPSClientDebugStatus;
  private readonly dropClient: () => void;
  private readonly wakeClient: () => void;

  constructor({ status, drop, wake }: WPSClientDebugOptions) {
    this.getStatus = status;
    this.dropClient = drop;
    this.wakeClient = wake;
    (window as unknown as { wpsTest?: unknown }).wpsTest = {
      status: this.status,
      drop: this.drop,
      wake: this.wake,
      cycle: this.cycle,
    };
    wpsDebug(
      "[WPSClientDebug] Test helpers ready: wpsTest.status() | .drop() | .wake() | .cycle()",
      null,
      "log",
      true,
    );
  }

  public readonly status = () => {
    const snapshot = this.getStatus();
    wpsDebug("[WPSClientDebug] status", snapshot, "log", true);
    return snapshot;
  };

  public readonly drop = () => {
    wpsDebug("[WPSClientDebug] Simulating connection drop (sleep)...");
    this.dropClient();
  };

  public readonly wake = () => {
    wpsDebug("[WPSClientDebug] Simulating wake (visibility + online)...");
    this.wakeClient();
  };

  public readonly cycle = (ms = 1500) => {
    this.drop();
    setTimeout(this.wake, ms);
  };
}
