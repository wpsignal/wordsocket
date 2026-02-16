# WPSignal WordPress Plugin

Sends realtime events from WordPress to browsers via [wpsignal.io](https://wpsignal.io).

When someone edits a post in wp-admin, every connected browser knows about it instantly — no page refresh needed.

## How it fits together

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  Your WordPress Site            wpsignal-server         Browser      │
│  ───────────────────            ───────────────         ───────      │
│                                                                      │
│  ┌──────────────────┐                                                │
│  │ WPSignal Plugin   │                                               │
│  │                   │                                               │
│  │ 1. save_post hook │──POST /publish──▶  Routes event              │
│  │    fires          │   (HMAC signed)    to subscribers             │
│  │                   │                        │                      │
│  │ 2. REST endpoint  │                        │                      │
│  │    /wpsignal/v1/  │                        ▼                      │
│  │    token          │               Pushes via SSE ──▶ client.js   │
│  │    │              │                                   receives   │
│  │    └──JWT──▶ Browser fetches token,                  the event   │
│  │              then connects to SSE                     and logs   │
│  └──────────────────┘                                   it / fires │
│                                                          a DOM     │
│                                                          event     │
└──────────────────────────────────────────────────────────────────────┘
```

**What each piece does:**

| Piece | Role |
|---|---|
| `wpsignal.php` | Main plugin file. Hooks into `save_post`, enqueues the JS client. |
| `includes/publish.php` | `wpsignal_publish()` — sends events to the server with HMAC signing. |
| `includes/rest.php` | REST endpoint that mints a short-lived JWT so the browser can connect. |
| `includes/admin.php` | Settings page (Settings > WPSignal) for base URL, site key, site secret. |
| `assets/client.js` | Browser script that fetches a token, opens SSE, and listens for events. |

## Installation

### 1. Copy the plugin

```bash
cp -r wp-plugin /path/to/wordpress/wp-content/plugins/wpsignal
```

### 2. Activate

Go to **Plugins > Installed Plugins** in wp-admin and activate **WPSignal**.

### 3. Configure

Go to **Settings > WPSignal** and fill in:

| Field | What to enter | Example (local dev) |
|---|---|---|
| **Base URL** | The wpsignal server URL | `http://localhost:3001` |
| **Site Key** | Must match `DEV_SITE_KEY` in server `.env` | `dev_key_change_me` |
| **Site Secret** | Must match `DEV_SITE_SECRET` in server `.env` | `dev_secret_change_me_at_least_32_chars` |

### 4. Add the JWT secret

Add this line to your `wp-config.php` (before `/* That's all, stop editing! */`):

```php
define( 'WPSIGNAL_JWT_SECRET', 'jwt_secret_change_me_at_least_32_chars' );
```

This **must** match the `JWT_SECRET` in the server's `.env` file.

```
┌──────────────────────────────────────────────────────────────────┐
│              Secrets that must match on both sides                │
│                                                                  │
│  Server .env                  WordPress                          │
│  ──────────                   ─────────                          │
│  DEV_SITE_KEY        ◄──────► Settings > WPSignal > Site Key     │
│  DEV_SITE_SECRET     ◄──────► Settings > WPSignal > Site Secret  │
│  JWT_SECRET          ◄──────► WPSIGNAL_JWT_SECRET in wp-config   │
└──────────────────────────────────────────────────────────────────┘
```

## How it works

### Publishing events (server-side, PHP)

When a post is saved (created or updated), the plugin automatically publishes a `post.updated` event to the wpsignal server.

The signing flow (handled automatically by `wpsignal_publish()`):

```
┌───────────────────────────────────────────────────────────────┐
│  wpsignal_publish('events', 'post.updated', $data)            │
│                                                               │
│  1. JSON-encode the body                                      │
│  2. Get current timestamp in milliseconds                     │
│  3. Compute HMAC-SHA256(body + "." + timestamp, site_secret)  │
│  4. POST to {base_url}/publish with headers:                  │
│       X-WP-Signal-Key:  {site_key}                            │
│       X-WP-Signal-Ts:   {timestamp}                           │
│       X-WP-Signal-Sign: {signature}                           │
│  5. Server verifies signature → broadcasts to SSE clients     │
└───────────────────────────────────────────────────────────────┘
```

You can also publish custom events from your theme or other plugins:

```php
// Example: notify when a comment is posted
wpsignal_publish( 'events', 'comment.created', array(
    'comment_id' => $comment_id,
    'post_id'    => $post_id,
    'author'     => $author_name,
) );

// Example: notify when a user logs in
wpsignal_publish( 'events', 'user.login', array(
    'user_id'    => $user->ID,
    'user_login' => $user->user_login,
) );
```

### Receiving events (browser-side, JavaScript)

For logged-in users, the plugin automatically loads `client.js` which:

```
┌──────────────────────────────────────────────────────────────┐
│                    client.js lifecycle                        │
│                                                              │
│  1. Page loads                                               │
│       │                                                      │
│       ▼                                                      │
│  2. POST /wp-json/wpsignal/v1/token                          │
│     (authenticated with WP nonce)                            │
│       │                                                      │
│       ▼                                                      │
│  3. Receives JWT + recommended channels                      │
│       │                                                      │
│       ▼                                                      │
│  4. Opens EventSource to:                                    │
│     {base_url}/sse?token={jwt}&channels={channels}           │
│       │                                                      │
│       ▼                                                      │
│  5. Listens for events, logs to console, dispatches          │
│     DOM CustomEvents (e.g. "wpsignal:post.updated")          │
│       │                                                      │
│       ▼                                                      │
│  6. At 80% of token TTL → closes connection,                 │
│     fetches new token, reconnects                            │
└──────────────────────────────────────────────────────────────┘
```

### Listening for events in your theme or custom JS

```js
// React to post updates
document.addEventListener('wpsignal:post.updated', function (e) {
    console.log('Post updated!', e.detail);
    // e.detail.data.post_id
    // e.detail.data.post_title
    // e.detail.data.permalink
});

// You can listen for any event type you publish
document.addEventListener('wpsignal:comment.created', function (e) {
    console.log('New comment!', e.detail);
});
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

**2. Make sure secrets match**

Check that your WP plugin settings (Settings > WPSignal) and `wp-config.php` constant match the server `.env`. See the "Secrets that must match" diagram above.

**3. Open your site in a browser**

- Log in to WordPress.
- Navigate to any front-end page.
- Open the browser console (F12 or Cmd+Option+J).

You should see:

```
[WPSignal] Token obtained, expires at 2026-02-10T05:30:00.000Z
[WPSignal] SSE connected
```

**4. Edit a post**

- Open wp-admin in another tab.
- Edit any post and click **Update**.

**5. Check the console**

Back in the browser console, you should see:

```
[WPSignal] post.updated {channel: "events", data: {post_id: 42, post_title: "My Post", ...}}
```

That's it — the event traveled from WordPress through the server to your browser in realtime.

## File structure

```
wpsignal/
├── wpsignal.php              Main plugin file
│                              - Registers save_post hook
│                              - Enqueues client.js for logged-in users
│
├── includes/
│   ├── admin.php             Settings page (Settings > WPSignal)
│   │                          - base_url, site_key, site_secret fields
│   │
│   ├── publish.php           wpsignal_publish() helper
│   │                          - JSON body + HMAC signing + wp_remote_post
│   │
│   └── rest.php              REST API: POST /wp-json/wpsignal/v1/token
│                              - Mints HS256 JWT for logged-in users
│                              - Returns token + recommended channels
│
└── assets/
    └── client.js             Browser SSE client
                               - Fetches token from WP REST
                               - Opens EventSource connection
                               - Dispatches DOM CustomEvents
```

## Security

```
┌──────────────────────────────────────────────────────────────────┐
│                      Security boundaries                         │
│                                                                  │
│  Browser (public)           Server (trusted)      WP (trusted)   │
│  ─────────────────          ────────────────      ────────────   │
│                                                                  │
│  - Never sees site_secret   - Verifies HMAC      - Stores keys  │
│  - Only gets short-lived      on every publish      securely in  │
│    JWT (5 min expiry)       - Verifies JWT on       wp_options   │
│  - Can only subscribe to      every SSE connect   - Only mints   │
│    channels allowed by      - Rejects stale         tokens for   │
│    the JWT                    timestamps (60s)      logged-in    │
│  - Cannot publish events    - Rate limits per       users        │
│    (server→client only)       site key                           │
└──────────────────────────────────────────────────────────────────┘
```

- The site secret is **never** exposed to the browser.
- SSE connections require a short-lived JWT (5-minute expiry).
- Publish requests require HMAC-SHA256 with a fresh timestamp (60s replay window).
- The token REST endpoint requires an authenticated WordPress session (cookie + nonce).
- V1 is server-to-client only — browsers cannot publish events.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Console shows "token request failed (401)" | Not logged in, or nonce expired | Log in to WordPress, refresh the page |
| Console shows "token request failed (500)" | JWT secret not configured | Add `WPSIGNAL_JWT_SECRET` to `wp-config.php` |
| SSE connects but no events arrive | Secrets don't match between WP and server | Compare all three values in the diagram above |
| "WPSignal is not configured" in error log | Plugin settings are empty | Go to Settings > WPSignal and fill in all fields |
| Events publish but browser doesn't receive | Channel mismatch or token expired | Check browser console for errors; refresh to get new token |
