# WPSignal WordPress Plugin

Sends realtime events from WordPress to browsers via [wpsignal.io](https://wpsignal.io).

When someone edits a post in wp-admin, every connected browser knows about it instantly — no page refresh needed. Register custom triggers for any WordPress hook with a fluent PHP API.

## How it fits together

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  Your WordPress Site            wpsignal-server         Browser      │
│  ───────────────────            ───────────────         ───────      │
│                                                                      │
│  ┌───────────────────┐                                               │
│  │ WPSignal Plugin   │                                               │
│  │                   │                                               │
│  │ 1. Trigger fires  │──POST /publish──▶  Routes event               │
│  │    (save_post,    │   (HMAC signed)    to subscribers             │
│  │     custom hooks) │                        │                      │
│  │                   │                        │                      │
│  │ 2. REST endpoint  │                        ▼                      │
│  │    /wpsignal/v1/  │               Pushes via WS/SSE──▶ client.js  │
│  │    token          │                                   receives    │
│  │    │              │                                   the event   │
│  │    └──JWT──▶ Browser fetches token,                   and fires   │
│  │              then connects via WebSocket               a DOM      │
│  │              (SSE fallback)                            event      │
│  └───────────────────┘                                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Copy the plugin

```bash
cp -r wp-plugin /path/to/wordpress/wp-content/plugins/wpsignal
```

### 2. Activate

Go to **Plugins > Installed Plugins** in wp-admin and activate **WPSignal**.

### 3. Configure

Go to **WPSignal > Settings** and fill in:

| Field | What to enter | Example (local dev) |
|---|---|---|
| **Server URL** | The wpsignal server URL | `http://localhost:3001` |
| **API Key** | Your API key from the wpsignal.io dashboard | `abc123...` |

Then click **Connect to WPSignal**. The plugin registers with the server and saves the site key, publish secret, and JWT secret automatically.

#### Manual setup (alternative)

If you prefer manual configuration, you can also define the JWT secret in `wp-config.php`:

```php
define( 'WPSIGNAL_JWT_SECRET', 'your_jwt_secret_here' );
```

This must match the `JWT_SECRET` in the server's `.env` file.

## Developer API

### Registering custom triggers

Map any WordPress action hook to a WPSignal event using the builder pattern:

```php
add_action( 'wpsignal_loaded', function () {
    // Comment notification
    WPSignal::trigger( 'comment.created' )
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

    // User login (minimal — no condition, default channel)
    WPSignal::trigger( 'user.login' )
        ->on( 'wp_login', 10, 2 )
        ->data( function ( $user_login, $user ) {
            return [ 'user_id' => $user->ID, 'login' => $user_login ];
        } )
        ->register();

    // WooCommerce order (cross-plugin, custom channel)
    WPSignal::trigger( 'order.completed' )
        ->on( 'woocommerce_order_status_completed' )
        ->channel( 'orders' )
        ->data( function ( $order_id ) {
            $order = wc_get_order( $order_id );
            return [ 'order_id' => $order_id, 'total' => $order->get_total() ];
        } )
        ->register();
} );
```

#### Builder methods

| Method | Required | Description |
|---|---|---|
| `->on( $hook, $priority, $args )` | yes | WordPress action hook to listen on. Priority defaults to 10, args to 1. |
| `->channel( $name )` | no | Channel to publish on. Defaults to `"events"`. |
| `->data( callable )` | no | Callback that receives hook args and returns an associative array. |
| `->when( callable )` | no | Callback that receives hook args. Return `false` to skip publishing. |
| `->register()` | yes | Wires the hook and adds the trigger to the registry. |

### Publishing events directly

You can publish without a hook:

```php
WPSignal::publish( 'events', 'custom.event', [ 'key' => 'value' ] );
```

The legacy function `wpsignal_publish()` still works for backward compatibility.

### Listening for events in the browser

For logged-in users, the plugin automatically connects via WebSocket (SSE fallback) and dispatches DOM events:

```js
document.addEventListener('wpsignal:post.updated', function (e) {
    console.log('Post updated!', e.detail);
    // e.detail.data.post_id
    // e.detail.data.post_title
    // e.detail.data.permalink
});

document.addEventListener('wpsignal:comment.created', function (e) {
    console.log('New comment!', e.detail);
});
```

## Kitchen Sink

The **WPSignal > Kitchen Sink** admin page provides five panels for testing:

1. **Connection Status** — configured badge, site key, "Test Connection" button (pings `/healthz`)
2. **Registered Triggers** — table of all triggers (event, hook, channel, has condition)
3. **Live Event Log** — connect via WebSocket, subscribe to channels, see events scroll in realtime
4. **Publish Test Event** — form (channel, event name, JSON data) that publishes via REST proxy
5. **Token Inspector** — mint a JWT, view decoded claims, watch the expiry countdown

## Architecture

```
wp-plugin/
├── wpsignal.php                       Bootstrap: constants, autoloader, boot()
│
├── includes/
│   ├── autoload.php                   PSR-4-style autoloader for WPSignal_* classes
│   ├── class-wpsignal.php             Singleton facade: WPSignal::trigger(), ::publish()
│   ├── class-wpsignal-config.php      wp_options accessor (base_url, site_key, etc.)
│   ├── class-wpsignal-publisher.php   HMAC-signed HTTP POST to /publish
│   ├── class-wpsignal-token.php       JWT minting + REST routes (/token, /connect, /publish)
│   ├── class-wpsignal-trigger.php     Fluent trigger builder
│   ├── class-wpsignal-trigger-registry.php  Registry: stores triggers, wires hooks
│   ├── class-wpsignal-admin.php       Settings page + WPSignal admin menu
│   ├── class-wpsignal-kitchen-sink.php  Kitchen Sink demo page
│   ├── class-wpsignal-client.php      Frontend client.js enqueue
│   ├── publish.php                    Backward-compat wrapper: wpsignal_publish()
│   ├── rest.php                       Backward-compat wrappers: wpsignal_get_jwt_secret()
│   └── admin.php                      Backward-compat stub
│
└── assets/
    ├── client.js                      WebSocket-first browser client (SSE fallback)
    ├── admin.js                       "Connect to WPSignal" button handler
    └── kitchen-sink.js                Kitchen Sink page interactivity
```

### Boot sequence

```
wpsignal.php
  → require autoload.php
  → require publish.php, rest.php, admin.php (backward-compat wrappers)
  → WPSignal::instance()->boot()
      → instantiate Config, Publisher, Token, TriggerRegistry, Client, Admin
      → TriggerRegistry->register_defaults() (save_post trigger)
      → do_action('wpsignal_loaded') (signal for third-party registration)
      → hook rest_api_init → Token->register_routes()
      → Client->init()
      → Admin->init() (if is_admin)
```

### REST endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /wp-json/wpsignal/v1/token` | Logged-in user | Mint a 5-minute connection JWT |
| `POST /wp-json/wpsignal/v1/connect` | Admin (`manage_options`) | Register site with WPSignal server |
| `POST /wp-json/wpsignal/v1/publish` | Admin (`manage_options`) | Publish proxy (HMAC handled server-side) |

### Built-in trigger

The plugin registers one default trigger:

| Event | Hook | Priority | Channel | Condition |
|---|---|---|---|---|
| `post.updated` | `save_post` | 20 | `events` | Published posts only (skips autosaves, revisions) |

## Security

```
┌──────────────────────────────────────────────────────────────────┐
│                      Security boundaries                         │
│                                                                  │
│  Browser (public)           Server (trusted)      WP (trusted)   │
│  ─────────────────          ────────────────      ────────────   │
│                                                                  │
│  - Never sees site_secret   - Verifies HMAC      - Stores keys   │
│  - Only gets short-lived      on every publish      securely in  │
│    JWT (5 min expiry)       - Verifies JWT on       wp_options   │
│  - Can only subscribe to      every WS/SSE        - Only mints   │
│    channels allowed by        connect               tokens for   │
│    the JWT                  - Rejects stale         logged-in    │
│  - Cannot publish events      timestamps (60s)      users        │
│    directly (uses REST      - Rate limits per     - Publish      │
│    proxy for Kitchen Sink)    site key              proxy keeps  │
│                                                     secret       │
│                                                     server-side  │
└──────────────────────────────────────────────────────────────────┘
```

## Testing end-to-end

### What you need running

```
┌──────────────────────────────────────────┐
│  1. wpsignal-server  (cargo run)         │
│  2. WordPress site   (with plugin)       │
│  3. Browser          (logged in to WP)   │
└──────────────────────────────────────────┘
```

### Step-by-step

**1. Start the Rust server**

```bash
cd server
cargo run
```

**2. Connect the plugin**

Go to **WPSignal > Settings**, enter the server URL and API key, save, then click **Connect to WPSignal**.

**3. Open your site in a browser**

- Log in to WordPress.
- Navigate to any front-end page.
- Open the browser console (F12 or Cmd+Option+J).

You should see:

```
[WPSignal] Token obtained, expires at 2026-02-10T05:30:00.000Z
[WPSignal] WebSocket connected
[WPSignal] Subscribed to ["site:...:events"]
```

**4. Edit a post**

- Open wp-admin in another tab.
- Edit any post and click **Update**.

**5. Check the console**

```
[WPSignal] post.updated {channel: "events", data: {post_id: 42, post_title: "My Post", ...}}
```

**6. Try the Kitchen Sink**

Go to **WPSignal > Kitchen Sink** to connect via WebSocket, publish test events, and inspect tokens — all from the admin.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Console shows "token request failed (401)" | Not logged in, or nonce expired | Log in to WordPress, refresh the page |
| Console shows "token request failed (500)" | JWT secret not configured | Click "Connect to WPSignal" in settings, or add `WPSIGNAL_JWT_SECRET` to `wp-config.php` |
| WebSocket connects but no events arrive | Plugin not configured or channel mismatch | Check WPSignal > Kitchen Sink > Connection Status |
| "WPSignal is not configured" in error log | Plugin settings are empty | Go to WPSignal > Settings and connect |
| Events publish but browser doesn't receive | Token expired or wrong channels | Check browser console for errors; client auto-refreshes tokens at 80% TTL |
