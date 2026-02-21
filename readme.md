# WPSignal WordPress Plugin

> **Note:** This `README.md` is for GitHub. The WordPress.org plugin listing uses [`readme.txt`](readme.txt).

Sends realtime events from WordPress to browsers via [api.wpsignal.io](https://api.wpsignal.io). Connects via WebSocket (SSE fallback) and exposes a public JS API for other plugins to share the connection. On WordPress 7.0+, also registers as a WebSocket-based Yjs sync provider for real-time collaborative editing.

## Installation

```bash
cd /path/to/wordpress/wp-content/plugins
git clone git@github.com:wpsignal/wp-signal.git
```

```bash
wp plugin activate wp-signal
```

## Configuration

Go to **WPSignal > Settings** and fill in:

| Field | Description |
|---|---|
| **Server URL** | The wpsignal server URL (e.g. [https://api.wpsignal.io](https://api.wpsignal.io)) |
| **API Key** | Your API key from the wpsignal.io dashboard |

Then click **Connect to WPSignal**. The plugin registers with the server and saves the site key, publish secret, and JWT secret automatically.

The **Enable real-time collaboration provider** toggle (on by default) controls whether WPSignal registers as the Yjs sync provider in the block editor. Disable it to fall back to WordPress HTTP polling if WebSocket connections are unavailable.

## Real-Time Collaboration (WordPress 7.0+)

On WordPress 7.0+, the plugin registers a Yjs sync provider via the `sync.providers` filter. This replaces the default HTTP polling transport with WPSignal's WebSocket binary relay, enabling low-latency collaborative editing.

The provider uses a three-message sync protocol:

| Message | Purpose |
|---|---|
| `SYNC_STEP_1` | Broadcasts the local state vector; asks peers to send back what is missing |
| `SYNC_STEP_2` | Replies with the diff the requesting peer lacks |
| `MSG_UPDATE` | Incremental update broadcast on every local ydoc change |

If WebSocket is unavailable the provider emits `disconnected` so WordPress shows its "not synced" indicator. Use the admin toggle to restore HTTP polling.

## Developer API

### Registering custom triggers

Map any WordPress action hook to a WPSignal event using the builder pattern:

```php
use WPSignal\WPS;

add_action( 'wpsignal_loaded', function () {
    WPS::trigger( 'comment.created' )
        ->on( 'wp_insert_comment', 10, 2 )
        ->channel( 'events' )
        ->data( function ( $comment_id, $comment ) {
            return [
                'comment_id' => $comment_id,
                'post_id'    => $comment->comment_post_ID,
                'author'     => $comment->comment_author,
            ];
        } )
        ->when( function ( $comment_id, $comment ) {
            return (int) $comment->comment_approved === 1;
        } )
        ->register();
} );
```

#### Builder methods

| Method | Required | Description |
|---|---|---|
| `->on( $hook, $priority, $args )` | yes | WordPress action hook to listen on. Priority defaults to 10, args to 1. |
| `->channel( $name )` | no | Channel to publish on. Defaults to `"events"`. |
| `->data( callable )` | no | Callback receiving hook args, returns an associative array. |
| `->when( callable )` | no | Callback receiving hook args. Return `false` to skip publishing. |
| `->register()` | yes | Wires the hook and adds the trigger to the registry. |

### Publishing events directly

```php
WPS::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
```

### Extending the connection token

Two filters let plugins add channels and channel-prefix permissions to the JWT that is minted for each logged-in user. Use these when your plugin needs browsers to subscribe to channels outside the default `site:{site_id}:` namespace.

**`wpsignal_token_channels`** appends channels to the initial auto-subscribe list:

```php
add_filter( 'wpsignal_token_channels', function ( array $channels, int $user_id, string $site_id ): array {
    // Subscribe each user to their own private channel on connect.
    $channels[] = 'my-plugin.user.' . $user_id;
    return $channels;
}, 10, 3 );
```

**`wpsignal_token_channel_prefixes`** adds entries to the JWT `allowed_channel_prefixes` claim, which the server uses to enforce which channels a client may subscribe to:

```php
add_filter( 'wpsignal_token_channel_prefixes', function ( array $prefixes, int $user_id, string $site_id ): array {
    // Allow the browser to subscribe to any channel in the my-plugin.user.* namespace.
    $prefixes[] = 'my-plugin.user.';
    return $prefixes;
}, 10, 3 );
```

Both filters receive `$user_id` (the current logged-in user) and `$site_id` (the normalized site identifier) as extra arguments.

### Listening for events in the browser

For logged-in users, the plugin connects via WebSocket (SSE fallback) and dispatches DOM events:

```js
document.addEventListener('wpsignal:post.updated', function (e) {
    console.log('Post updated!', e.detail.data);
});
```

### Public JS API (`window.WPS`)

The client script exposes `window.WPS` so any theme or plugin can share the WebSocket connection. Add `'wpsignal'` as a script dependency to ensure it loads first.

| Method / Property | Returns | Description |
|---|---|---|
| `WPS.subscribe( channels )` | `void` | Subscribe to additional channels. On WebSocket, sends immediately. On SSE, adds to the tracked channel set and reconnects with the updated list. Queued if not yet connected. |
| `WPS.unsubscribe( channels )` | `void` | Unsubscribe from channels. On WebSocket, sends immediately. On SSE, removes from the tracked set and reconnects. |
| `WPS.publish( channel, event, data? )` | `void` | Send a JSON message via WebSocket. No-op on SSE. |
| `WPS.publishBinary( channel, data )` | `void` | Send a raw binary frame via WebSocket. No-op on SSE. |
| `WPS.on( event, handler )` | `() => void` | Listen for a specific event name. Returns unsubscribe fn. |
| `WPS.onMessage( handler )` | `() => void` | Catch-all listener for all incoming messages. Returns unsubscribe fn. |
| `WPS.onBinaryMessage( handler )` | `() => void` | Listen for incoming binary frames. Returns unsubscribe fn. |
| `WPS.connected` | `boolean` | Whether the connection is currently open (read-only). |
| `WPS.transport` | `'ws' \| 'sse' \| null` | Current transport layer, or null while connecting (read-only). |
| `WPS.onConnectionChange( handler )` | `() => void` | Listen for connect/disconnect. Returns unsubscribe fn. |

```js
// Subscribe to a channel
window.WPS.subscribe(['my-channel']);

// Listen for a specific event
const off = window.WPS.on('post.updated', (data, channel) => {
    console.log('Post updated!', data);
});

// Publish a message through the WebSocket
window.WPS.publish('my-channel', 'my.event', { key: 'value' });

// Send a binary frame
window.WPS.publishBinary('my-channel', new Uint8Array([1, 2, 3]));

// Receive binary frames
const offBin = window.WPS.onBinaryMessage((channel, data) => {
    console.log('Binary frame on', channel, data);
});

// Check connection state and transport
console.log(window.WPS.connected, window.WPS.transport);

// React to connection changes
const unsub = window.WPS.onConnectionChange((connected) => {
    console.log('Connected:', connected);
});

// Unsubscribe from a channel
window.WPS.unsubscribe(['my-channel']);
```

## REST endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /wp-json/wpsignal/v1/token` | Logged-in user | Mint a 5-minute connection JWT |
| `POST /wp-json/wpsignal/v1/connect` | Admin (`manage_options`) | Register site with WPSignal server |
| `POST /wp-json/wpsignal/v1/publish` | Admin (`manage_options`) | Publish proxy (HMAC handled server-side) |
| `GET /wp-json/wpsignal/v1/settings` | Admin (`manage_options`) | Get connection settings (includes `yjs_provider_enabled`) |
| `POST /wp-json/wpsignal/v1/settings` | Admin (`manage_options`) | Save connection settings (accepts `yjs_provider_enabled`) |
| `GET /wp-json/wpsignal/v1/triggers` | Admin (`manage_options`) | Get saved custom triggers |
| `POST /wp-json/wpsignal/v1/triggers` | Admin (`manage_options`) | Save custom triggers |

## Admin pages

- **Settings**: React app with two tabs: Connection (server URL, API key, RTC provider toggle, connect button, status) and Triggers (custom trigger CRUD).
- **Monitor**: Five test panels: connection status, registered triggers, live event log, publish form, token inspector.

## Build

TypeScript sources in `src/` are built with `@wordpress/scripts` using a custom webpack config:

```bash
npm install
npm run build   # Production build -> build/
npm run start   # Watch mode
```

Entry points: `client.ts`, `settings/index.tsx`, `monitor.ts`, `yjs-provider-boot.ts`.

## Encryption

Event payloads are AES-256-GCM encrypted by PHP before leaving WordPress. The WPSignal relay receives and forwards ciphertext only.

**Key derivation:** HKDF-SHA256 over WordPress salts (`AUTH_KEY . SECURE_AUTH_KEY`) with the site key as salt. The derived key is passed to the browser as `wpSignalConfig.encryptionKey` (base64). It is never sent to the WPSignal server.

**Scope:** Relay-blind encryption — the relay cannot read message content. All logged-in users on the same site share the same derived key. Per-user message privacy (ECDH key pairs per session) is a future phase.

### Overriding the encryption seed

```php
add_filter( 'wpsignal_encryption_seed', function ( $default_seed ) {
    return 'my-application-specific-secret';
} );
```

Useful when you need a stable seed that is independent of WordPress salts (e.g. multisite, key rotation). The seed is used server-side only and is never transmitted.

## Testing SSE fallback

To force the client to use SSE instead of WebSocket (useful for verifying SSE-path behaviour without browser tooling), add this to `wp-config.php` or a must-use plugin:

```php
define( 'WPSIGNAL_FORCE_SSE', true );
```

The client will skip the WebSocket upgrade and connect via SSE only. Remove the constant to restore normal WebSocket-first behaviour.

Alternatively, block the WebSocket URL in Chrome DevTools: open the **Network** panel, right-click the `ws://...` request, and choose **Block request URL**.

## Security

| Browser (public) | Server (trusted) | WP (trusted) |
|---|---|---|
| Never sees site_secret | Verifies HMAC on every publish | Stores keys in wp_options |
| Only gets short-lived JWT (5 min) | Verifies JWT on every WS/SSE connect | Only mints tokens for logged-in users |
| Channel access restricted by JWT | Rejects stale timestamps (60s) | Publish proxy keeps secret server-side |
| Decrypts payloads with SubtleCrypto | Relay never handles key material | Encryption key derived from WP salts |
