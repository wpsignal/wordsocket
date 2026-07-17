/**
 * WPSignalEvent is a custom event class that extends the CustomEvent class.
 * Provides convenience properties for the channel and data of the event.
 */
export default class WPSignalEvent<
  T = Record<string, unknown>,
> extends CustomEvent<{ channel: string; data: T }> {
  /**
   * Create a new WPSignalEvent.
   *
   * @param eventName - The name of the event.
   * @param detail - The detail of the event.
   */
  constructor(eventName: string, detail: { channel: string; data: T }) {
    super(eventName, { detail });
  }

  /**
   * Get the channel of the event.
   */
  get channel(): string {
    return this.detail.channel;
  }

  /**
   * Get the data of the event.
   */
  get data(): T {
    return this.detail.data;
  }
}
