=== Signal ===
Contributors: worldhouse
Tags: realtime, websocket, push, events, sse
Requires at least: 6.2
Tested up to: 6.9
Stable tag: 0.2.0
Requires PHP: 7.4
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Signal is the official WordPress plugin for WP Signal (wpsignal.io), a third-party WebSocket/SSE delivery service.

== Description ==

Signal sends realtime events from your WordPress site to connected browsers.  
When content changes: a post is published, a comment is approved, an option is updated: the plugin pushes the event to subscribers instantly via WebSocket (with SSE fallback).

WP Signal is an independent service and is not affiliated with or endorsed by the WordPress project.

**Features:**

* WebSocket-first with automatic SSE fallback
* Built-in triggers for post updates and custom post types
* Custom trigger builder: map any WordPress action hook to a realtime event
* Public JavaScript API (`window.WPS`) for themes and plugins to share the connection
* Admin monitor page with live event log, publish form, and token inspector
* Short-lived JWTs (5 min) with automatic refresh

**How it works:**

1. Install the plugin and connect to the WPSignal service.
2. When content changes in WordPress, the plugin publishes an HMAC-signed event to the WPSignal server.
3. The server pushes the event to all browsers subscribed to that channel.
4. Your theme or plugin listens for `wpsignal:*` DOM events and reacts in realtime.

= Third-Party Service =

This plugin connects to the **WPSignal service** at [api.wpsignal.io](https://api.wpsignal.io) (or a self-hosted server if configured) for the following operations:

* **Site registration**: when you click "Connect to WPSignal" in the admin, the plugin registers your site with the server and receives credentials.
* **Event publishing**: when a trigger fires (e.g. a post is saved), the plugin sends an HMAC-signed HTTP request to the server.
* **Realtime connections**: logged-in users' browsers connect to the server via WebSocket or SSE to receive events.

Data sent to the service includes your site URL, site name, event payloads, and connection tokens. Event payloads are delivered in realtime and are **not persisted** on the server.

* [Terms of Service](https://wpsignal.io/terms)
* [Privacy Policy](https://wpsignal.io/privacy)

== Installation ==

1. Upload the `wpsignal` folder to `/wp-content/plugins/`, or install directly from the WordPress plugin directory.
2. Activate the plugin through the "Plugins" menu in WordPress.
3. Go to **WPSignal > Settings** and enter your WPSignal server URL and API key.
4. Click **Connect to WPSignal**: the plugin registers with the server and saves credentials automatically.

To get an API key, create a free account at [wpsignal.io](https://wpsignal.io).

== Frequently Asked Questions ==

= What is WPSignal? =

WPSignal is a realtime event delivery service for WordPress. It pushes events from your site to connected browsers the moment they happen, without polling.

= Do I need a wpsignal.io account? =

Yes. The plugin requires a WPSignal server to relay events. You can use the hosted service at wpsignal.io (free account available) or run your own server.

= What data is sent to the WPSignal server? =

During registration: your site URL and name. During normal operation: event payloads (channel, event name, and data you define in triggers). Event payloads are delivered to subscribers in realtime and are not stored on the server. See our [Privacy Policy](https://wpsignal.io/privacy) for full details.

= Can I use this with a self-hosted server? =

Yes. Enter your server URL in **WPSignal > Settings** instead of the default `api.wpsignal.io`.

= Does this work for logged-out visitors? =

The built-in client script loads for logged-in users by default. You can enqueue the script for all visitors by adding `wpsignal` as a dependency to your own script.

== Screenshots ==

1. Settings page: connection configuration and custom trigger management.
2. Monitor page: live event log, publish form, and token inspector.

== Changelog ==

= 0.2.0 =
* New: Custom trigger builder: register triggers from the admin UI without code.
* New: Settings page rebuilt as a React app with Connection and Triggers tabs.
* New: Monitor (Kitchen Sink) admin page with 5 interactive panels.
* New: Public JavaScript API (`window.WPS`): subscribe, publish, event listeners.
* New: `WPS::trigger()` fluent builder and `WPS::publish()` facade methods.
* New: Support for self-hosted servers (configurable server URL).
* Improved: OOP architecture with PSR-4 autoloading under the `WPSignal` namespace.
* Improved: TypeScript source with `@wordpress/scripts` build pipeline.

= 0.1.0 =
* Initial release.

== Upgrade Notice ==

= 0.2.0 =
Major update with new admin UI, custom triggers, and public JS API. Existing installations will continue to work: no configuration changes required.
