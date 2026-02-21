=== Signal ===
Contributors: worldhouse
Tags: realtime, websocket, push, events, collaboration
Requires at least: 6.2
Tested up to: 6.9
Stable tag: 0.4.0
Requires PHP: 7.4
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Signal is the official WordPress plugin for WP Signal (wpsignal.io), a third-party WebSocket/SSE delivery service.

== Description ==

Signal sends realtime events from your WordPress site to connected browsers.
When content changes: a post is published, a comment is approved, an option is updated: the plugin pushes the event to subscribers instantly via WebSocket (with SSE fallback).

On WordPress 7.0+, Signal also registers as a WebSocket-based Yjs sync provider for real-time collaborative editing in the block editor, replacing the default HTTP polling transport with a low-latency WebSocket connection.

WP Signal is an independent service and is not affiliated with or endorsed by the WordPress project.

**Features:**

* WebSocket-first with automatic SSE fallback
* AES-256-GCM encrypted event payloads: the WPSignal relay receives ciphertext only and never has access to plaintext message content
* Real-time collaborative editing in the block editor (WordPress 7.0+, via Yjs sync provider)
* Admin toggle to disable the collaboration provider and fall back to WordPress HTTP polling
* Built-in triggers for post updates and custom post types
* Custom trigger builder: map any WordPress action hook to a realtime event
* Public JavaScript API (`window.WPS`) for themes and plugins to share the connection
* Extensible connection token: `wpsignal_token_channels` and `wpsignal_token_channel_prefixes` filters let other plugins add channels and namespace permissions to the JWT without modifying core
* Admin monitor page with live event log, publish form, and token inspector
* Short-lived JWTs (5 min) with automatic refresh

**How it works:**

1. Install the plugin and connect to the WPSignal service.
2. When content changes in WordPress, the plugin encrypts and publishes an HMAC-signed event to the WPSignal server.
3. The server pushes the ciphertext to all browsers subscribed to that channel.
4. The browser decrypts the payload and dispatches `wpsignal:*` DOM events. The relay never sees plaintext content.
5. On WordPress 7.0+, the block editor uses the same WebSocket connection for collaborative editing with no extra configuration.

= Third-Party Service =

This plugin connects to the **WPSignal service** at [api.wpsignal.io](https://api.wpsignal.io) for the following operations:

* **Site registration**: when you click "Connect to WPSignal" in the admin, the plugin registers your site with the server and receives credentials.
* **Event publishing**: when a trigger fires (e.g. a post is saved), the plugin sends an encrypted, HMAC-signed HTTP request to the server.
* **Realtime connections**: logged-in users' browsers connect to the server via WebSocket or SSE to receive events.
* **Collaborative editing**: on WordPress 7.0+, Yjs document updates are relayed over the same WebSocket connection.

Event payloads are AES-256-GCM encrypted before leaving WordPress. The WPSignal server relays ciphertext and never has access to plaintext message content. Data is delivered in realtime and is **not persisted** on the server.

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

During registration: your site URL and name. During normal operation: AES-256-GCM encrypted event payloads (the server never sees plaintext content). On WordPress 7.0+, Yjs document updates (binary diffs of block editor content) are also relayed. All data is delivered in realtime and is not stored on the server. See our [Privacy Policy](https://wpsignal.io/privacy) for full details.

= Are my event payloads private? =

Event payloads are encrypted with AES-256-GCM before leaving WordPress. The encryption key is derived from your WordPress salts and site key using HKDF-SHA256, and is never sent to the WPSignal server. This means the relay cannot read your message content. Note: all logged-in users on the same site share the same derived key. Per-user message privacy is out of scope for the current version.

= Can I use this with a self-hosted server? =

Yes. Enter your server URL in **WPSignal > Settings** instead of the default `api.wpsignal.io`.

= Does this work for logged-out visitors? =

The built-in client script loads for logged-in users by default. You can enqueue the script for all visitors by adding `wpsignal` as a dependency to your own script.

= What happens if WebSocket is unavailable? =

The client falls back to SSE for receiving events. `window.WPS.subscribe()` and `window.WPS.unsubscribe()` work on SSE connections: channel changes are tracked and applied immediately via a lightweight SSE reconnect (50 ms debounce). For collaborative editing, the plugin detects the fallback and emits a "not synced" status so WordPress can surface the appropriate indicator. You can also disable the collaboration provider entirely from **WPSignal > Settings > Connection** to restore WordPress HTTP polling for all editors.

= Does collaborative editing require WordPress 7.0? =

Yes. The Yjs sync provider integration requires WordPress 7.0 or later. The plugin detects the WordPress version and only registers the provider when `@wordpress/sync` is available.

== Screenshots ==

1. Settings page: connection configuration, real-time collaboration toggle, and custom trigger management.
2. Monitor page: live event log, publish form, and token inspector.

== Changelog ==

= 0.5.0 =
* New: `wpsignal_token_channels` filter: plugins can append channels to the initial auto-subscribe list in the minted JWT.
* New: `wpsignal_token_channel_prefixes` filter: plugins can add channel-prefix permissions to the JWT `allowed_channel_prefixes` claim, enabling server-enforced access to custom channel namespaces.
* Improved: `window.WPS.subscribe()` and `window.WPS.unsubscribe()` now work on SSE connections. Channel changes are tracked in a persistent set and applied immediately via a debounced SSE reconnect, so plugins that call these methods do not need to know the current transport.
* Developer: `forceSSE` config flag available for testing the SSE transport without browser tooling.

= 0.4.0 =
* New: AES-256-GCM encrypted event payloads. The WPSignal relay receives and forwards ciphertext only: plaintext message content never leaves WordPress.
* New: Encryption key derived from WordPress salts and site key via HKDF-SHA256. Key is never transmitted to the WPSignal server.
* New: `wpsignal_encryption_seed` filter for plugins and themes to supply custom key material.
* New: `SubtleCrypto` decryption in the browser client: events are dispatched only after successful decryption.

= 0.3.0 =
* New: Real-time collaborative editing in the block editor (WordPress 7.0+) via Yjs WebSocket sync provider.
* New: `publishBinary()` and `onBinaryMessage()` methods on `window.WPS` for binary WebSocket frames.
* New: `transport` property on `window.WPS` exposes the current connection type (`'ws'`, `'sse'`, or `null`).
* New: Admin toggle in Settings to enable or disable the real-time collaboration provider independently.
* Improved: Collaboration provider emits `disconnected` status when WebSocket is unavailable, allowing WordPress to show its "not synced" indicator.

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

= 0.5.0 =
Adds PHP filters for extending JWT channel access and fixes `subscribe()`/`unsubscribe()` on SSE connections. No configuration changes required.

= 0.4.0 =
Adds relay-blind AES-256-GCM encryption for all event payloads. No configuration required: encryption is automatic after connecting. The WPSignal relay never has access to plaintext message content.

= 0.3.0 =
Adds real-time collaborative editing support for WordPress 7.0+. No configuration changes required: the collaboration provider is enabled by default and can be toggled from WPSignal > Settings.

= 0.2.0 =
Major update with new admin UI, custom triggers, and public JS API. Existing installations will continue to work: no configuration changes required.
