=== WordSocket ===
Contributors: wpsignal
Tags: realtime, websocket, collaboration, events, woocommerce
Requires at least: 6.7
Tested up to: 7.1
Stable tag: 0.21.0
Requires PHP: 8.2
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

WebSocket relay for WordPress. Realtime events plus a Yjs sync provider for Gutenberg real-time collaboration. No polling, no custom server.

== Description ==

WordSocket sends realtime events from your WordPress site to connected browsers.
When content changes: a post is published, a comment is approved, an option is updated: the plugin pushes the event to subscribers instantly via WebSocket (with SSE fallback).

When real-time collaboration is available (currently via the Gutenberg plugin, ahead of its arrival in WordPress core), WordSocket also registers as a WebSocket-based Yjs sync provider for realtime collaborative editing in the block editor, replacing the default HTTP polling transport with a low-latency WebSocket connection.

WPSignal is an independent service and is not affiliated with or endorsed by the WordPress project.

**Features:**

* One-click automatic connection via the WPSignal dashboard (no API key required)
* Manual connection via API key for advanced setups
* Disconnect button with inline confirmation: the site is archived on the server, its usage history is kept, and reconnecting the same URL restores it
* WebSocket-first with automatic SSE fallback
* Per-site JWT signing secrets: each site's connection tokens are cryptographically isolated
* AES-256-GCM encrypted event payloads: the WPSignal relay receives ciphertext only and never has access to plaintext message content
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
5. When real-time collaboration is available on the site, the block editor uses the same WebSocket connection for collaborative editing with no extra configuration.

= Real-Time Collaboration =

WordSocket ships a WebSocket sync provider for the block editor's real-time collaboration feature. Three things need to be true for it to activate:

1. **The Gutenberg plugin is active.** Real-time collaboration was removed from WordPress core before the 7.0 release; until it ships in core, the feature is only available through the Gutenberg plugin.
2. **Real-time collaboration is enabled** under **Gutenberg > Experiments > Enable real-time collaboration** (Gutenberg 23.8 and later; earlier versions used Settings > Writing).
3. **The site is connected to WPSignal**, since the provider shares the plugin's WebSocket connection.

The WordSocket Settings tab shows a "Gutenberg detected" badge when the feature is available on your site. Once active, everything collaboration syncs travels over the WebSocket instead of HTTP polling: document updates, cursors and presence, and collaborative notes. If the connection drops, the provider reconnects with increasing delays; after repeated failures the editor shows its standard "connection lost" dialog, and documents re-sync when the connection returns. If a site's credentials are revoked, the editor reports an authentication error instead of retrying forever. The site editor does not use sync providers (core disables collaboration there). Disabling the provider from the Settings tab restores WordPress HTTP polling for all editors.

= Third-Party Service =

This plugin connects to the **WPSignal service** at api.wpsignal.io for the following operations:

* **Site registration**: when you connect in the admin (via the automatic one-click flow or by entering an API key manually), the plugin registers your site with the server and receives credentials.
* **Event publishing**: when a trigger fires (e.g. a post is saved), the plugin sends an encrypted, HMAC-signed HTTP request to the server.
* **Realtime connections**: logged-in users' browsers connect to the server via WebSocket or SSE to receive events.

Event payloads are AES-256-GCM encrypted before leaving WordPress. The WPSignal server relays ciphertext and never has access to plaintext message content. Data is delivered in realtime and is **not persisted** on the server.

* [Terms of Service](https://wpsignal.io/terms)
* [Privacy Policy](https://wpsignal.io/privacy)

= Setup =

https://www.youtube.com/watch?v=yS1roK49HEQ

= Showcase =

Below are a few examples showcasing the possibilities with WP Signal + WordSocket. Repository https://github.com/wpsignal/wordsocket-examples

**Living Posts - Interactivity API** 

https://www.youtube.com/watch?v=2F6zqQrrDXk

Source code: https://github.com/wpsignal/wordsocket-examples

**Bidirectional Realtime Chat Plugin**

https://www.youtube.com/watch?v=vpKjs5kYnvI&t

**Realtime Poker Plugin** 

https://www.youtube.com/watch?v=FVvpITS29oI

== Installation ==

1. Upload the `wordsocket` folder to `/wp-content/plugins/`, or install directly from the WordPress plugin directory.
2. Activate the plugin through the "Plugins" menu in WordPress.
3. Go to **WordSocket > Settings** and open the **Connect** tab.
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

During registration: your site URL and name. During normal operation: AES-256-GCM encrypted event payloads (the server never sees plaintext content). When real-time collaboration is enabled, Yjs document updates (binary diffs of block editor content) are also relayed. All data is delivered in realtime and is not stored on the server. See our [Privacy Policy](https://wpsignal.io/privacy) for full details.

= Are my event payloads private? =

Event payloads are encrypted with AES-256-GCM before leaving WordPress. The encryption key is derived from your WordPress salts and site key using HKDF-SHA256, and is never sent to the WPSignal server. This means the relay cannot read your message content. Note: all logged-in users on the same site share the same derived key. Per-user message privacy is out of scope for the current version.

= Why is real-time collaboration unavailable on my site? =

Real-time collaboration was removed from WordPress core before the 7.0 release and currently ships with the Gutenberg plugin as an experiment. Install and activate Gutenberg, then turn on Gutenberg > Experiments > "Enable real-time collaboration". The WordSocket Settings tab shows a "Gutenberg detected" badge when the feature is available, and the sync provider activates automatically once collaboration is enabled. Post types without custom-fields support are excluded by Gutenberg itself.

= Does this work for logged-out visitors? =

The built-in client script and the token endpoint (`/wp-json/wpsignal/v1/token`) are limited to logged-in users by default. To open them to all visitors, return true from the `wpsignal_allow_client` filter:

`add_filter( 'wpsignal_allow_client', '__return_true' );`

Tokens minted for visitors carry user ID 0 and are scoped to your site, so keep in mind that anyone can then subscribe to your site's public channels and publish over the WebSocket.

= What happens when I disconnect? =

The plugin tells the WPSignal server to archive the site, then deletes the stored credentials (site key, secrets, and the API key if you connected manually). Your usage history stays on the server, and connecting the same site URL again restores the site with fresh secrets. On a manual connection you will need to paste the API key again. If the server cannot be reached, nothing is deleted and you can retry.

= Why was my connection refused? =

The WPSignal dashboard refuses to authorize a site when your plan's site limit is reached (the message names the site to disconnect first), when your account email is not yet verified, or when the account has been deactivated. The Connect tab shows the exact reason returned by the server.

= How do extensions plug in? =

An extension is a separate plugin built on WordSocket (WooCommerce, Live Blog, and Chat are on the way). Its settings appear on the WordSocket settings page under the Extensions tab, which also lists what is available. Developers: register on `wpsignal_loaded` with `WPS::instance()->extensions()->register()`, enqueue a settings script on the `wordsocket_settings_enqueue` action with `wpsignal-settings` as a dependency, and render `window.wordsocket.ExtensionPanel` from a plugin registered with `wp.plugins.registerPlugin( slug, { scope: 'wordsocket', render } )`.

= Can I make a channel private? =

Yes. Reserve a namespace on `wpsignal_loaded`: `WPS::instance()->channels()->reserve( 'orders', 'manage_woocommerce' )` (a capability, or a callable receiving the user ID). The relay then refuses subscribe and publish frames on that namespace from anyone else. Once any namespace is reserved, tokens list channels explicitly instead of allowing every channel of the site, so register each channel you subscribe to through the `wpsignal_token_channels` filter. Payload encryption is site-wide and is not a privacy boundary between users; the channel gate is.

= Why did events stop? =

Each plan has a monthly message quota. When it is reached the server answers publishes with "quota exceeded" and the plugin pauses publishing until the first day of the next month (UTC). The Connect tab on the WordSocket settings page shows this, as well as rejected credentials (disconnect and connect again) and an unreachable server, and clears the warning as soon as the server answers again. There is no admin notice.

= What happens if WebSocket is unavailable? =

The client falls back to SSE for receiving events. `window.WPS.subscribe()` and `window.WPS.unsubscribe()` work on SSE connections: channel changes are tracked and applied immediately via a lightweight SSE reconnect (50 ms debounce). For collaborative editing, the plugin detects the fallback and emits a "not synced" status so WordPress can surface the appropriate indicator. You can also disable the collaboration provider entirely from the **WordSocket Settings tab** to restore WordPress HTTP polling for all editors.

== Screenshots ==

1. Connect tab (Automatic): one-click connection flow. Log in to your WPSignal dashboard and authorize the site with a single button.
2. Connect tab (Manual): paste your API key directly for setups where the automatic flow is unavailable.
3. Connect tab (Automatic): post authentication and green banner is displayed with the words "Connected".
4. Triggers tab: no-code trigger builder. Map WordPress action hooks to realtime events with channel and event name fields.
5. Explorer tab (disconnected): Event Log, Publish Test Event form, and Token Inspector panels ready to connect.
6. Explorer tab (connected): live Event Log showing an active WebSocket connection and an incoming encrypted event, with a test event published successfully.

== Changelog ==

= 0.21.1 =
* Changed: releases are published to WordPress.org by the GitHub release workflow after a successful build, instead of by hand

= 0.21.0 =
* New: Extensions tab on the settings page listing available extensions, plus an API for extension plugins to render their settings there (`window.wordsocket`, `wordsocket_settings_enqueue`, `WPS::instance()->extensions()`)
* New: private channel namespaces: `WPS::instance()->channels()->reserve( $namespace, $capability )` gates a channel at the token level; once any namespace is reserved, tokens list channels explicitly
* Changed: requires PHP 8.2
* Fixed: with the relay unreachable, the SSE fallback let the browser reconnect every few seconds forever; after three misses the client's own backoff takes over
* Fixed: the client is no longer loaded while the server rejects the site's credentials (regenerated key, deleted site), so a dead connection does not retry until someone reconnects
* Changed: the publish-failure admin notice added in 0.20.0 is gone; the Connect tab is the one place that reports a failing connection, and it clears as soon as the server answers again

= 0.20.1 =
* Fixed: a site whose credentials were revoked on the server (API key regenerated in the dashboard) re-minted tokens in a tight loop instead of stopping with authentication-failed; retry state now resets only once a connection has stayed open
* Fixed: Disconnect was refused after the dashboard API key had been regenerated, leaving the site stuck with dead credentials; a rejected key now clears the local copy like a forgotten site

= 0.20.0 =
* Security: the token endpoint (/wpsignal/v1/token) now requires a logged-in user by default; sites that serve visitors opt in with the wpsignal_allow_client filter
* New: publish failures are visible: an admin notice (Dashboard and WordSocket screens) and the Connect tab report a reached monthly quota, rejected credentials, or an unreachable server
* New: reconnects use exponential backoff with jitter (1s doubling to a 60s cap) instead of fixed delays, for the WebSocket, token fetch, and token refresh
* New: the relay now closes refused sockets with application codes; a revoked token re-mints once and then reports authentication-failed in the editor instead of retrying forever
* New: window.WPS.onStateChange() and window.WPS.state expose the connection state, last error, and next retry
* Improved: real-time collaboration matches Gutenberg 23.9: the editor's connection lost dialog appears after repeated failed reconnects, providers are not registered where core disables collaboration (site editor), and updates over 1 MiB report document-size-limit-exceeded
* Improved: instructions and docs point to Gutenberg > Experiments > Enable real-time collaboration
* Fixed: a failed manual connection left the Save button stuck in the busy state
* Fixed: SSE fallback connections reported as connected after the stream died
* Fixed: disconnect kept local credentials when the server refused, instead of pretending it succeeded; the confirmation explains that history is kept
* Fixed: the trigger Remove control is a real button, reachable by keyboard and screen readers
* Fixed: debug logging respected the wrong flag and was never silent on production sites
* Fixed: the settings endpoint no longer returns the full API key
* Fixed: quota throttling and the last publish error are cleared on connect, disconnect, and uninstall
* Improved: dashboard links follow the configured server URL; typos and untranslated strings

= 0.19.0 =
* New: real-time collaboration re-enabled via Gutenberg detection: the Yjs provider activates when wp_is_collaboration_enabled() reports RTC available and enabled, with a Gutenberg detected badge in the Settings tab
* Fixed: collection-level sync providers (collaborative notes) crashed on the missing awareness instance, breaking notes realtime
* Fixed: idle sessions stopped syncing: awareness keepalive renewals are now relayed (update event instead of change) and doc updates are no longer gated on peer presence
* New: stale-socket watchdog force-reconnects zombie connections after sleep or background suspension, and a 30s state-vector resync heals dropped frames
* Improved: sync status contract matches Gutenberg 23.7: typed connection error codes and a truthful auto-retry countdown in the editor disconnect dialog


= 0.18.1 =
* Security fixes


= 0.18.0 =
* Pluggable WS/SSE transports with window.WPS.status
* Frictionless reconnection and persistent channel subscriptions
* WPSignalEvent, client debug helpers, and isDebug config rename


= 0.17.0 =
* Prevent connection attempts when no auth


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

= 0.21.0 =
Adds the Extensions tab and the extension API, private channel namespaces for plugin developers, and now requires PHP 8.2.

= 0.20.1 =
Fixes a reconnect loop after credentials are revoked on the server and a Disconnect that could not complete after regenerating the dashboard API key.

= 0.20.0 =
Security: the token endpoint now requires a logged-in user by default (use the wpsignal_allow_client filter for public sites). Publish failures are now visible in wp-admin and reconnects back off with jitter.

= 0.19.0 =
New: real-time collaboration re-enabled via Gutenberg detection: the Yjs provider activates when wp_is_collaboration_enabled() reports RTC available and enabled, with a Gutenberg detected badge in the Settings tab

= 0.18.1 =
Security fixes

= 0.18.0 =
Pluggable WS/SSE transports with window.WPS.status

= 0.17.0 =
Prevent connection attempts when no auth

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
Adds one-click automatic connection, a Disconnect button, and per-site JWT secrets. No configuration changes required for existing connections. To use the automatic flow on a new site, go to WordSocket > Settings, open the Connect tab and choose Automatic.

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
