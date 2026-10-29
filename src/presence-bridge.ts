/**
 * Presence API bridge, the browser half.
 *
 * - Answers `presence-api.keepalive` with false from script evaluation, so Heartbeat never writes this tab's rows; flips to true only when the client halts.
 * - Joins relay presence on each room PHP printed, with `hidden: true` while the tab is hidden.
 * - Turns the site's `presence.room_changed` into `presence-api.roomChanged`, again after `recheck_in` ms when a row was left to lapse.
 * - Sends each post room's state once more with `leaving: true` when the page moves on within the site to somewhere other than that post, so the row ends at once instead of lapsing.
 */

import { watchNavigation } from "./utils/navigation";

interface WpHooks {
  addFilter(hookName: string, namespace: string, callback: (...args: unknown[]) => unknown): void;
  doAction(hookName: string, ...args: unknown[]): void;
}

const NAMESPACE = "wordsocket/presence-bridge";
const ROOMS_CHANNEL = "presence-rooms";

function hooksOf(): WpHooks | null {
  const wp = (window as Window & { wp?: { hooks?: WpHooks } }).wp;
  return wp?.hooks ?? null;
}

/**
 * Start the bridge for the rooms in `config`. Call before the client connects.
 *
 * @since 0.32.0
 */
export function startPresenceBridge(client: WPSApi, config: WpSignalPresenceApi): void {
  const hooks = hooksOf();
  let held = true;

  hooks?.addFilter("presence-api.keepalive", NAMESPACE, () => !held);

  client.onStateChange((state) => {
    // No retry scheduled behind an error is the client giving up: Heartbeat takes the rows back.
    if (!state.connected && state.error && state.retryInMs === undefined) {
      held = false;
    }
  });

  const announce = (): void => {
    const hidden = document.visibilityState === "hidden";
    for (const room of config.rooms) {
      client.setPresence(room.channel, hidden ? { ...room.state, hidden: true } : room.state);
    }
  };
  announce();
  document.addEventListener("visibilitychange", announce);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) announce();
  });

  // Moving on within the site marks each post room the destination does not name as left.
  const navigation = watchNavigation();
  window.addEventListener("pagehide", () => {
    const destination = navigation();
    if (!destination) return;
    for (const room of config.rooms) {
      if (room.post_id && room.post_id !== destination.postId) client.setPresence(room.channel, { ...room.state, leaving: true });
    }
  });

  const rechecks = new Map<string, ReturnType<typeof setTimeout>>();
  client.on("presence.room_changed", (data, channel) => {
    if (!hooks || !client.onChannel(channel, ROOMS_CHANNEL)) return;
    const room = String(data.room ?? "");
    hooks.doAction("presence-api.roomChanged", room);
    clearTimeout(rechecks.get(room));
    rechecks.delete(room);
    if (typeof data.recheck_in === "number") {
      rechecks.set(
        room,
        setTimeout(() => {
          rechecks.delete(room);
          hooks.doAction("presence-api.roomChanged", room);
        }, data.recheck_in + 1000),
      );
    }
  });
}
