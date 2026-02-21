# WPSignal WordPress Plugin

> **Note:** This `README.md` is for GitHub. The WordPress.org plugin listing uses [`readme.txt`](readme.txt).

Sends realtime events from WordPress to browsers via [api.wpsignal.io](https://api.wpsignal.io). Connects via WebSocket (SSE fallback) and exposes a public JS API for other plugins to share the connection.

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

### Listening for events in the browser

For logged-in users, the plugin connects via WebSocket (SSE fallback) and dispatches DOM events:

```js
document.addEventListener('wpsignal:post.updated', function (e) {
    console.log('Post updated!', e.detail.data);
});
```

### Public JS API (`window.WPS`)

The client script exposes `window.WPS` so any theme or plugin can share the WebSocket connection. Add `'wpsignal'` as a script dependency to ensure it loads first.

| Method | Returns | Description |
|---|---|---|
| `WPS.subscribe( channels )` | `void` | Subscribe to additional channels. Queued if not yet connected. |
| `WPS.unsubscribe( channels )` | `void` | Unsubscribe from channels (or remove from pending queue). |
| `WPS.publish( channel, event, data? )` | `void` | Send a message via WebSocket. Warns and no-ops on SSE. |
| `WPS.on( event, handler )` | `() => void` | Listen for a specific event name. Returns unsubscribe fn. |
| `WPS.onMessage( handler )` | `() => void` | Catch-all listener for all incoming messages. Returns unsubscribe fn. |
| `WPS.connected` | `boolean` | Whether the connection is currently open (read-only). |
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

// Catch-all listener
const unsub = window.WPS.onMessage((event, data, channel) => {
    console.log(event, data, channel);
});

// Check connection state
console.log(window.WPS.connected);

// React to connection changes
const unsub2 = window.WPS.onConnectionChange((connected) => {
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
| `GET /wp-json/wpsignal/v1/settings` | Admin (`manage_options`) | Get connection settings |
| `POST /wp-json/wpsignal/v1/settings` | Admin (`manage_options`) | Save connection settings |
| `GET /wp-json/wpsignal/v1/triggers` | Admin (`manage_options`) | Get saved custom triggers |
| `POST /wp-json/wpsignal/v1/triggers` | Admin (`manage_options`) | Save custom triggers |

## Admin pages

- **Settings**: React app with two tabs: Connection (server URL, API key, connect button, status) and Triggers (custom trigger CRUD).
- **Monitor**: Five test panels: connection status, registered triggers, live event log, publish form, token inspector.

## Build

TypeScript sources in `src/` are built with `@wordpress/scripts` using a custom webpack config with three entry points:

```bash
npm install
npm run build   # Production build -> build/
npm run start   # Watch mode
```

Entry points: `client.ts`, `settings/index.tsx`, `kitchen-sink.ts`.

## Source files

### PHP (`includes/`)

| File | Purpose |
|---|---|
| `class-wps.php` | Singleton facade: `WPS::trigger()`, `WPS::publish()`, `WPS::instance()` |
| `class-wpsignal-config.php` | Centralizes `get_option('wpsignal_*')` calls |
| `class-wpsignal-publisher.php` | HMAC-signed HTTP POST to `/publish` |
| `class-wpsignal-token.php` | JWT minting + REST routes (`/token`, `/connect`, `/publish`, `/settings`) |
| `class-wpsignal-trigger.php` | Fluent trigger builder |
| `class-wpsignal-trigger-registry.php` | Stores triggers, wires WordPress hooks, registers defaults |
| `class-wpsignal-custom-triggers.php` | Loads custom triggers from `wp_options` |
| `class-wpsignal-triggers-rest.php` | REST controller for custom triggers CRUD |
| `class-wpsignal-admin-page.php` | Settings page (React mount), menu registration |
| `class-wpsignal-kitchen-sink-page.php` | Monitor admin page (5 panels) |
| `class-wpsignal-client.php` | Frontend script enqueue for logged-in users |
| `autoload.php` | PSR-4 autoloader for `WPSignal\` namespace |

### TypeScript (`src/`)

| File | Purpose |
|---|---|
| `client.ts` | WebSocket client with SSE fallback, exposes `window.WPS` API |
| `kitchen-sink.ts` | Monitor page interactivity |
| `settings/` | React app for the Settings page (Connection + Triggers tabs) |
| `types/globals.d.ts` | Global type declarations for localized data |

## Security

| Browser (public) | Server (trusted) | WP (trusted) |
|---|---|---|
| Never sees site_secret | Verifies HMAC on every publish | Stores keys in wp_options |
| Only gets short-lived JWT (5 min) | Verifies JWT on every WS/SSE connect | Only mints tokens for logged-in users |
| Channel access restricted by JWT | Rejects stale timestamps (60s) | Publish proxy keeps secret server-side |
