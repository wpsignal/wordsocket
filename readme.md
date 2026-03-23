# WordSocket

The official WordPress plugin for [WPSignal](https://wpsignal.io). Publish realtime events from PHP when content changes, subscribe in the browser — no polling, no infrastructure to manage.

## Install:

### Release:

The easiest way is to download, and install, the latest version from [releases](https://github.com/wpsignal/wordsocket/releases).

### WP CLI:

```bash
wp plugin install https://github.com/wpsignal/wordsocket/releases/download/v0.11.0/wordsocket.zip
```

## Minimal example:

### Create a trigger:

```php
// Fire on any WordPress action hook
WPS::trigger( 'comment.posted' )
    ->on( 'wp_insert_comment', 10, 2 )
    ->channel( 'events' )
    ->data( fn( $id, $comment ) => [ 'author' => $comment->comment_author ] )
    ->register();
```

### Listen and act on trigger when it fires:

```ts
type Comment = {
  // ...
};
// Handle it in the browser
document.addEventListener( 'wpsignal:comment.posted', (e: CustomEvent<Comment>) => {
    console.log(e.detail);
});
```

## Documentation

Full documentation, API reference, and guides are at **[wpsignal.io/docs](https://wpsignal.io/docs/getting-started/)**.

### Building from source

```bash
npm install
npm run build
```

Source files are in `src/`. Compiled output lands in `build/`.

## Changelog

**0.11.0** - feat: skeleton preloader for app.feat: disable automatic authentication for non-ssl.fix: disable encryption when on non-ssl..

**0.10.0**:
feat: skeleton preloader for app.
feat: disable automatic authentication for non-ssl.
fix: disable encryption when on non-ssl.

**0.9.0** - Fix: non-ssl default to manual authentication.

**0.8.0** - Fixes for, WordPress v7 beta 6, changes to option key for rtc.
**0.7.0** — Automatic one-click connection, disconnect button, per-site JWT secrets.
**0.6.0** — Yjs fixes for WP 7 beta 5.
**0.5.0** — JWT channel filters, SSE subscribe/unsubscribe support.
**0.4.0** — AES-256-GCM encrypted payloads.
**0.3.0** — Real-time collaborative editing (WordPress 7.0+, Yjs).
**0.2.0** — Custom trigger builder, Explorer page, public JS API.

Full changelog in [readme.txt](readme.txt).

## License

GPL-2.0-or-later
