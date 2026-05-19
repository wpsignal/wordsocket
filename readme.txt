=== WordSocket ===
Contributors: wpsignal
Tags: realtime, websocket, collaboration, events, woocommerce
Requires at least: 6.2
Tested up to: 7.0
Stable tag: 0.16.0
Requires PHP: 7.4
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

WebSocket relay for WordPress. Realtime events plus a Yjs sync provider for WordPress 7.0 collaborative editing. No polling, no custom server.

== Description ==

WordSocket sends realtime events from your WordPress site to connected browsers.
When content changes: a post is published, a comment is approved, an option is updated: the plugin pushes the event to subscribers instantly via WebSocket (with SSE fallback).

On WordPress 7.0+, WordSocket also registers as a WebSocket-based Yjs sync provider for real-time collaborative editing in the block editor, replacing the default HTTP polling transport with a low-latency WebSocket connection.

WPSignal is an independent service and is not affiliated with or endorsed by the WordPress project.

**Features:**

* One-click automatic connection via the WPSignal dashboard (no API key required)
* Manual connection via API key for advanced setups
* Disconnect button with inline confirmation, removes the site from the server immediately
* WebSocket-first with automatic SSE fallback
* Per-site JWT signing secrets: each site's connection tokens are cryptographically isolated
* AES-256-GCM encrypted event payloads: the WPSignal relay receives ciphertext only and never has access to plaintext message content
* Real-time collaborative editing in the block editor (WordPress 7.0+, via Yjs sync provider)
* Admin toggle to disable the collaboration provider and fall back to WordPress HTTP polling
* Built-in triggers for post updates and custom post types
* Custom trigger builder: map any WordPress action hook to a realtime event
* Public JavaScript API (`window.WPS`) for themes and plugins to share the connection
* Extensible connection token: `wpsignal_token_channels` and `wpsignal_token_channel_prefixes` filters let other plugins add channels and namespace permissions to the JWT without modifying core
* Admin explorer page with live event log, publish form, and token inspector
* Short-lived JWTs (5 min) with automatic refresh

**How it works:**

1. Install the plugin and connect to the WPSignal service.
2. When content changes in WordPress, the plugin encrypts and publishes an HMAC-signed event to the WPSignal server.
3. The server pushes the ciphertext to all browsers subscribed to that channel.
4. The browser decrypts the payload and dispatches `wpsignal:*` DOM events. The relay never sees plaintext content.
5. On WordPress 7.0+, the block editor uses the same WebSocket connection for collaborative editing with no extra configuration.

= Third-Party Service =

This plugin connects to the **WPSignal service** at api.wpsignal.io for the following operations:

* **Site registration**: when you connect in the admin (via the automatic one-click flow or by entering an API key manually), the plugin registers your site with the server and receives credentials.
* **Event publishing**: when a trigger fires (e.g. a post is saved), the plugin sends an encrypted, HMAC-signed HTTP request to the server.
* **Realtime connections**: logged-in users' browsers connect to the server via WebSocket or SSE to receive events.
* **Collaborative editing**: on WordPress 7.0+, Yjs document updates are relayed over the same WebSocket connection.

Event payloads are AES-256-GCM encrypted before leaving WordPress. The WPSignal server relays ciphertext and never has access to plaintext message content. Data is delivered in realtime and is **not persisted** on the server.

* [Terms of Service](https://wpsignal.io/terms)
* [Privacy Policy](https://wpsignal.io/privacy)

== Installation ==

1. Upload the `wordsocket` folder to `/wp-content/plugins/`, or install directly from the WordPress plugin directory.
2. Activate the plugin through the "Plugins" menu in WordPress.
3. Go to **WordSocket > Settings > Connection**.
4. Choose a connection method:
   * **Automatic (recommended):** Click **Connect with WPSignal**. You will be redirected to the WPSignal dashboard to authorize the connection. No API key entry required.
   * **Manual:** Switch to the Manual tab, paste your API key, and click **Save Settings**.
5. The plugin registers with the server and saves credentials automatically.

To create an account, visit [wpsignal.io](https://wpsignal.io).

== Open Source ==

[https://github.com/wpsignal/wordsocket](https://github.com/wpsignal/wordsocket)

== Frequently Asked Questions ==

= What is WPSignal? =

WPSignal is a realtime event delivery service for WordPress. It pushes events from your site to connected browsers the moment they happen, without polling.

= Do I need a wpsignal.io account? =

Yes. The plugin requires a WPSignal account to relay events. Create a free account at wpsignal.io.

= What data is sent to the WPSignal server? =

During registration: your site URL and name. During normal operation: AES-256-GCM encrypted event payloads (the server never sees plaintext content). On WordPress 7.0+, Yjs document updates (binary diffs of block editor content) are also relayed. All data is delivered in realtime and is not stored on the server. See our [Privacy Policy](https://wpsignal.io/privacy) for full details.

= Are my event payloads private? =

Event payloads are encrypted with AES-256-GCM before leaving WordPress. The encryption key is derived from your WordPress salts and site key using HKDF-SHA256, and is never sent to the WPSignal server. This means the relay cannot read your message content. Note: all logged-in users on the same site share the same derived key. Per-user message privacy is out of scope for the current version.

= Does this work for logged-out visitors? =

The built-in client script loads for logged-in users by default. You can enqueue the script for all visitors by adding `wpsignal` as a dependency to your own script.

= What happens if WebSocket is unavailable? =

The client falls back to SSE for receiving events. `window.WPS.subscribe()` and `window.WPS.unsubscribe()` work on SSE connections: channel changes are tracked and applied immediately via a lightweight SSE reconnect (50 ms debounce). For collaborative editing, the plugin detects the fallback and emits a "not synced" status so WordPress can surface the appropriate indicator. You can also disable the collaboration provider entirely from **WordSocket > Settings > Connection** to restore WordPress HTTP polling for all editors.

= Does collaborative editing require WordPress 7.0? =

Yes. The Yjs sync provider integration requires WordPress 7.0 or later. The plugin detects the WordPress version and only registers the provider when `@wordpress/sync` is available.

== Screenshots ==

1. Connect tab (Automatic): one-click connection flow — log in to your WPSignal dashboard and authorize the site with a single button.
2. Connect tab (Manual): paste your API key directly for setups where the automatic flow is unavailable.
3. Connect tab (Automatic): post authentication and green banner is displayed with the words "Connected".
4. Settings tab: toggle to register WordSocket as the Yjs sync provider for real-time collaborative editing in the block editor.
5. Triggers tab: no-code trigger builder — map WordPress action hooks to realtime events with channel and event name fields.
6. Explorer tab (disconnected): Event Log, Publish Test Event form, and Token Inspector panels ready to connect.
7. Explorer tab (connected): live Event Log showing an active WebSocket connection and an incoming encrypted event, with a test event published successfully.

== Changelog ==

= 0.16.0 =
* Remove rtc functionality and added feedback form


= 0.15.1 =
* Fixed: skip Yjs update and awareness messages when no peers are connected


= 0.15.0 =
* Fixed: real-time sync on remote server — channel subscribed after SYNC_STEP_1 sent


= 0.14.0 =
* Revamp admin ui, moved explorer to settings app


= 0.13.2 =
* remove self-hosted text


= 0.13.1 =
* Updated screenshots

= 0.13.0 =
* Exclude BETA.md from plugin build

= 0.12.0 =
* feat: skeleton preloader for app.feat: disable automatic authentication for non-ssl.fix: disable encryption when on non-ssl.

= 0.9.0 =
* Fix: non-ssl default to manual authentication

= 0.8.0 =
* Improved: Connections UI. Reduced connections from 2 to 1 on connections page.
* Fix: option key change for RTC enabled.

= 0.7.0 =
* New: Automatic connection flow. Admins can connect via the WPSignal dashboard with a single click, without entering an API key. Uses a CSRF-protected OAuth-style code exchange.
* New: Disconnect button in the Connection tab. Removes the site from the WPSignal server and clears all local credentials, with inline confirmation before proceeding.
* New: Per-site JWT signing secrets. Each site's connection tokens are now signed with a unique secret, isolating sites cryptographically and eliminating cross-site token forgery risk.
* Improved: Connection tab redesigned with Automatic and Manual sub-tabs to clearly separate the two connection methods.
* Improved: Disconnect works correctly regardless of how the site was connected: API key authentication for manual connections, publish-secret authentication for automatic connections.

= 0.6.0 =
* New: Plugin renamed to "WordSocket" to comply with WordPress.org plugin directory guidelines.
* Improved: Settings Connection tab revamped: server URL field removed, flow simplified to API Key entry and a single Connect action.
* Improved: API key validated client-side before attempting connection.
* Improved: Connection tab now surfaces WordPress real-time collaboration (RTC) availability and WP version compatibility, with clearer, more descriptive warnings when collaborative editing is unavailable.
* Improved: PHP documentation blocks updated across all core classes for better tooling and doc parser support.
* Developer: `.pot` language file added (`eventra-for-wpsignal.pot`).

= 0.5.1 =
* Fixed: WordPress 7.0 Beta 2 compatibility for the Yjs sync provider. Collection-level providers (e.g. collaborative notes) receive a null `objectId`; the provider now maps this to a shared `"collection"` channel suffix so all peers join the same channel.
* Fixed: `ProviderCreatorOptions` type updated to accept `objectId: string | number | null`, matching the Beta 2 provider creator API.

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
* New: Explorer (Kitchen Sink) admin page with 5 interactive panels.
* New: Public JavaScript API (`window.WPS`): subscribe, publish, event listeners.
* New: `WPS::trigger()` fluent builder and `WPS::publish()` facade methods.
* New: Support for self-hosted servers (configurable server URL).
* Improved: OOP architecture with PSR-4 autoloading under the `WPSignal` namespace.
* Improved: TypeScript source with `@wordpress/scripts` build pipeline.

= 0.1.0 =
* Initial release.

== Upgrade Notice ==

= 0.16.0 =
Remove rtc functionality and added feedback form

= 0.15.1 =
Fixed: skip Yjs update and awareness messages when no peers are connected

= 0.15.0 =
Fixed: real-time sync on remote server — channel subscribed after SYNC_STEP_1 sent

= 0.14.0 =
Revamp admin ui, moved explorer to settings app

= 0.13.2 =
remove self-hosted text

= 0.13.1 =
Updated screenshots

= 0.13.0 =
Exclude BETA.md from plugin build

= 0.12.0 =
feat: skeleton preloader for app.feat: disable automatic authentication for non-ssl.fix: disable encryption when on non-ssl.

= 0.11.0 =
feat: skeleton preloader for app.feat: disable automatic authentication for non-ssl.fix: disable encryption when on non-ssl.

= 0.10.0 =
feat: skeleton preloader for app.
feat: disable automatic authentication for non-ssl.
fix: disable encryption when on non-ssl.

= 0.9.0 =
Fix: non-ssl default to manual authentication

= 0.7.0 =
Adds one-click automatic connection, a Disconnect button, and per-site JWT secrets. No configuration changes required for existing connections. To use the automatic flow on a new site, go to WordSocket > Settings > Connection > Automatic.

= 0.6.0 =
Simplified settings UI: the Server URL field has been removed. Re-enter your API Key and click Connect if your site does not show as connected after upgrading.

= 0.5.1 =
Fixes Yjs provider compatibility with WordPress 7.0 Beta 2, including collection-level sync (collaborative notes). No configuration changes required.

= 0.5.0 =
Adds PHP filters for extending JWT channel access and fixes `subscribe()`/`unsubscribe()` on SSE connections. No configuration changes required.

= 0.4.0 =
Adds relay-blind AES-256-GCM encryption for all event payloads. No configuration required: encryption is automatic after connecting. The WPSignal relay never has access to plaintext message content.

= 0.3.0 =
Adds real-time collaborative editing support for WordPress 7.0+. No configuration changes required: the collaboration provider is enabled by default and can be toggled from WordSocket > Settings.

= 0.2.0 =
Major update with new admin UI, custom triggers, and public JS API. Existing installations will continue to work: no configuration changes required.
