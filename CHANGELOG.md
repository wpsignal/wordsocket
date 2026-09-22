**0.25.0** - Events are encrypted on plain HTTP sites too: where SubtleCrypto is unavailable the client decrypts with a bundled AES-256-GCM implementation (`@noble/ciphers`), so the relay reads ciphertext on every site rather than only HTTPS ones. Also fixes the Explorer tab on plain HTTP sites, which chose `ws://` from the page's scheme instead of the relay's and failed with close 1006. And fixes the Plugins screen, where extension rows sorted to the top of the list instead of under WordSocket, because their renamed titles began with markup.

**0.24.1** - Hide future slot fill.

**0.24.0** - Extensions now sit with WordSocket on the Plugins screen: an extension's row is renamed "WordSocket: <name>", which is what that screen sorts by, and indented under it, so the family stays together however many plugins a site has. Only plugins that asked are touched: an extension either names its plugin file when it registers (`file` in `WPS::extensions()->register()`) or declares `Requires Plugins: wordsocket` in its header. The `wordsocket_nested_plugin_rows` filter picks the rows, and an empty array leaves every name alone.

**0.23.0** - Three helpers on `window.WPS` so extensions stop writing their own: `WPS.uuid()`, a v4 UUID that also works on plain HTTP pages (where `crypto.randomUUID` does not exist); `WPS.visitorId()`, a stable per-browser id shared by every tab and extension on the site, for counting people rather than sockets; and `WPS.onChannel( channel, expected )`, the check that an event arrived on the channel it claims, bare or `site:{id}:` qualified.

**0.22.0** - `GET /wpsignal/v1/stats` (and `Publisher::stats()`): browsers connected to the site right now and the plan's connection limit, for extension dashboards. New client API `WPS.setPresence()` for connection-scoped presence (who is here right now), with `wps.presence` join/leave/sync events; `setPresence( channel, null )` leaves at once and the relay drops a member the instant its socket closes. A client that fell back to SSE (as happens during a relay restart) tries the socket again the moment the stream opens (the relay is reachable again by then) and otherwise at its next token refresh, so presence and publishing come back without a page reload. Over SSE every event now arrives with its channel (the relay sends one frame per message for 0.22 tokens), where before only four fixed event names and encrypted payloads got through. Tokens now carry a protocol version (`v: 2`) and `allowed_publish_prefixes` next to the subscribe prefixes: once a namespace is reserved, a browser may publish (messages, binary, presence) only where a reservation's publish grant or the `wpsignal_token_publish_prefixes` filter allows; `Channels::reserve()` takes that grant as a third argument. Fixed: reserving a namespace (as every extension does) switched real-time collaboration off, because the provider's `yjs:` channels were on neither list; strict-mode tokens for users who can edit posts now carry `yjs:` for reading and writing.

**0.21.1** - Releases publish to WordPress.org from the GitHub workflow after a successful build; `npm run release` is the single local step.

**0.21.0** - Extensions tab and extension API (`window.wordsocket`, `wordsocket_settings_enqueue`, `WPS::extensions()`), private channel namespaces (`WPS::channels()->reserve()`), PHP 8.2 minimum.

**0.20.1** - Fixes a re-mint loop when a site's credentials are revoked on the server (retry state now resets only after a stable connection) and a Disconnect that was refused after the dashboard API key was regenerated.

**0.20.0** - Security: the token endpoint requires a logged-in user by default. Publish failures surface as admin notices, reconnects back off with jitter, the relay closes refused sockets with application codes (revoked tokens report authentication-failed), and the collaboration provider matches Gutenberg 23.9 (connection lost dialog, experiment gating, 1 MiB update cap).

**0.19.0** - New: real-time collaboration re-enabled via Gutenberg detection: the Yjs provider activates when wp_is_collaboration_enabled() reports RTC available and enabled, with a Gutenberg detected badge in the Settings tab.

**0.18.1** - Security fixes.

**0.18.0**
* Pluggable WS/SSE transports with window.WPS.status
* Frictionless reconnection and persistent channel subscriptions
* WPSignalEvent, client debug helpers, and isDebug config rename

**0.17.0** - Prevent connection attempts when no auth.

**0.16.0** - Remove rtc functionality and added feedback form.

**0.15.1** - Fixed: skip Yjs update and awareness messages when no peers are connected.

**0.15.0** - Fixed: real-time sync on remote server — channel subscribed after SYNC_STEP_1 sent.

**0.14.0** - Revamp admin ui, moved explorer to settings app.

**0.13.2** - remove self-hosted text.

**0.13.1** - Updated screenshots.

**0.13.0** - Exclude BETA.md from plugin build.

**0.12.0** - feat: skeleton preloader for app.feat: disable automatic authentication for non-ssl.fix: disable encryption when on non-ssl.

**0.9.0** - Fix: non-ssl default to manual authentication.

**0.8.0** - Fixes for, WordPress v7 beta 6, changes to option key for rtc.
**0.7.0** — Automatic one-click connection, disconnect button, per-site JWT secrets.
**0.6.0** — Yjs fixes for WP 7 beta 5.
**0.5.0** — JWT channel filters, SSE subscribe/unsubscribe support.
**0.4.0** — AES-256-GCM encrypted payloads.
**0.3.0** — Real-time collaborative editing (WordPress 7.0+, Yjs).
**0.2.0** — Custom trigger builder, Explorer page, public JS API.