# WordSocket Beta Test Brief

This is early beta software. Feedback on real-world behaviour is more valuable than polish.

## What it does

WordSocket is a WordPress plugin that publishes realtime events from your site to connected browsers via WebSocket (SSE fallback). No polling. When content changes (post saved, comment approved, option updated, etc.), subscribed browsers are notified instantly via `wpsignal:*` DOM CustomEvents on `document`.

On WordPress 7.0+, it also registers as a WebSocket-backed Yjs sync provider for real-time collaborative editing in the block editor, replacing the default HTTP polling transport.

**Security model:** Event payloads are AES-256-GCM encrypted before leaving WordPress. The WPSignal relay never sees plaintext content. Encryption requires HTTPS; on HTTP the plugin falls back to plaintext delivery automatically.

---

## Requirements

- WordPress 6.2+ (PHP 7.4+)
- WordPress 7.0+ for RTC/collaborative editing
- A free WPSignal account
- Two browser tabs with DevTools open

---

## Install

### Via WP CLI (fastest)

```bash
wp plugin install https://github.com/wpsignal/wordsocket/releases/download/v0.12.0/wordsocket.zip --activate
```

### Manually

Download `wordsocket.zip` from [github.com/wpsignal/wordsocket/releases](https://github.com/wpsignal/wordsocket/releases), upload via **Plugins > Add New > Upload Plugin**, and activate.

---

## Create an account

Sign up at [api.wpsignal.io/dashboard/signup](https://api.wpsignal.io/dashboard/signup).

---

## Connect

Go to **WordSocket > Settings > Connection**.

**Automatic (recommended):** Click **Connect with WPSignal**. You are redirected to the WPSignal dashboard to authorize. No API key required.

**Manual:** Switch to the Manual tab, paste your API key, and click Save. Use this if your server cannot reach the WPSignal dashboard for the OAuth callback.

After connecting, credentials are stored automatically in `wp_options`.

---

## Enable debug logging

Console output is gated behind `WP_ENVIRONMENT_TYPE`. Add to `wp-config.php`:

```php
define( 'WP_ENVIRONMENT_TYPE', 'local' );
```

Without this, `[WordSocket]` logs are suppressed in the browser. Errors and warnings always surface regardless.

To test the SSE transport without browser tooling, set before the client script runs:

```js
window.wpSignalConfig.forceSSE = true;
```

---

## What to test

### 1. Connection

Go to **WordSocket > Explorer**. Verify the status shows **Connected** and the transport is `ws` (or `sse` if WebSocket is blocked).

In the browser console (with debug logging enabled):

```
[WordSocket] Token obtained ...
[WordSocket] WebSocket connected
[WordSocket] Subscribed to [...]
```

Verify in the console:

```js
window.WPS.transport   // 'ws' or 'sse'
window.WPS.connected   // true
```

### 2. Built-in triggers

Open two browser tabs to the same site. In **Tab 2**, run in the console:

```js
document.addEventListener('wpsignal:post.updated', e => console.log('post.updated', e.detail));
document.addEventListener('wpsignal:post.created', e => console.log('post.created', e.detail));
document.addEventListener('wpsignal:comment.created', e => console.log('comment.created', e.detail));
```

In **Tab 1**, save or publish a post. Verify the event fires in Tab 2.

Using the JS API directly:

```js
WPS.on('post.updated', (data, channel) => console.log(data, channel));
// or catch all events:
WPS.onMessage((event, data, channel) => console.log(event, data, channel));
```

### 3. Custom triggers

Register a trigger in `functions.php` on `wpsignal_loaded`:

```php
add_action( 'wpsignal_loaded', function() {
    WPS::trigger( 'comment.approved' )
        ->on( 'wp_set_comment_status', 10, 2 )
        ->channel( 'events' )
        ->data( fn( $id, $status ) => [ 'comment_id' => $id, 'status' => $status ] )
        ->when( fn( $id, $status ) => $status === 'approve' )
        ->register();
} );
```

Or add via **WordSocket > Settings > Triggers**. Verify `wpsignal:comment.approved` fires in the browser.

Direct publish (no hook):

```php
WPS::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
```

### 4. Token refresh and connection longevity

JWTs are short-lived (5 min) and refresh at 80% TTL (roughly every 4 min). Leave a tab open for 10+ minutes and verify:

- No unexpected disconnects
- Console shows `[WordSocket] Auth refreshed, expires at ...`
- `window.WPS.connected` remains `true`

On WebSocket, token refresh is in-band (no reconnect). On SSE, the client fully reconnects.

### 5. SSE fallback

Block WebSocket connections in DevTools (Network > block `wss://api.wpsignal.io`), then reload.

Verify:

- Console shows `[WordSocket] Falling back to SSE`
- `window.WPS.transport === 'sse'`
- Built-in trigger events still fire

`subscribe()` and `unsubscribe()` work on SSE: channel changes trigger a debounced reconnect (50 ms).

### 6. Encryption (HTTPS only)

On an HTTPS site, events arrive encrypted on the wire (`{ event: "encrypted", data: { v: 1, p: "..." } }`, visible in DevTools > Network > WS frames) but dispatch as the original event name in the browser.

On HTTP, the plugin skips encryption. The console logs `[WordSocket] SubtleCrypto unavailable` once on load, and events dispatch as plaintext.

### 7. Real-time collaborative editing (WordPress 7.0+ only)

1. In **WP Admin > Settings > Writing**, enable Real-Time Collaboration
2. In **WordSocket > Settings > Connection**, verify the RTC toggle is visible and enabled
3. Open the block editor in two tabs under different logged-in users
4. Edit content in Tab 1, verify changes appear in Tab 2 in realtime
5. Disable the toggle and verify the block editor falls back to WordPress HTTP polling

### 8. Explorer page

Go to **WordSocket > Explorer**. Use the publish form to send a test event and verify it appears in the live log. Inspect the minted JWT in the token panel.

---

## JS API reference

```js
// Available as window.WPS once the client script loads

WPS.subscribe(['channel-name']);
WPS.unsubscribe(['channel-name']);

WPS.on('post.updated', (data, channel) => {});      // specific event
WPS.onMessage((event, data, channel) => {});         // all events
WPS.onBinaryMessage((channel, payload) => {});       // binary frames (Yjs)
WPS.onConnectionChange((connected) => {});           // connection state changes

WPS.publish('events', 'my.event', { key: 'value' }); // WS only
WPS.publishBinary('channel', uint8Array);             // WS only

WPS.connected;    // boolean
WPS.transport;    // 'ws' | 'sse' | null
```

---

## PHP API reference

```php
// Fluent trigger builder
WPS::trigger( 'event.name' )
    ->on( 'wp_action_hook', $priority, $accepted_args )
    ->channel( 'events' )
    ->data( fn( ...$args ) => [ 'key' => 'value' ] )
    ->when( fn( ...$args ) => true )
    ->register();

// Direct publish (no hook)
WPS::publish( 'events', 'event.name', [ 'key' => 'value' ] );
```

Register triggers on `wpsignal_loaded` or `init`.

---

## Feedback to capture

- Connection failures: include WordPress version, PHP version, hosting provider, and HTTP vs HTTPS
- Unexpected disconnects or failed token refreshes: include the `[WordSocket]` lines from the browser console
- Anything confusing or unclear in the admin UI
- Behavioural differences between WebSocket and SSE transports
- RTC sync issues: include WordPress version and whether the "not synced" indicator appeared

---

## Links

- Website: [wpsignal.io](https://wpsignal.io)
- Docs: [wpsignal.io/docs/getting-started](https://wpsignal.io/docs/getting-started/)
- Plugin repo: [github.com/wpsignal/wordsocket](https://github.com/wpsignal/wordsocket)
- Dashboard: [api.wpsignal.io/dashboard](https://api.wpsignal.io/dashboard)
