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