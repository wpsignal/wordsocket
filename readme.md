<a href="https://wpsignal.io/wordsocket" target="_blank"><img src="https://wpsignal.io/gh-banner.jpg"></a>

# WordSocket

[![WordPress.org version](https://img.shields.io/wordpress/plugin/v/wordsocket?label=wordpress.org&color=21759b)](https://wordpress.org/plugins/wordsocket/)
[![Downloads](https://img.shields.io/wordpress/plugin/dt/wordsocket?color=21759b)](https://wordpress.org/plugins/wordsocket/advanced/)
[![Tested up to](https://img.shields.io/wordpress/plugin/tested/wordsocket?color=21759b)](https://wordpress.org/plugins/wordsocket/)
[![Requires PHP](https://img.shields.io/wordpress/plugin/required-php/wordsocket)](https://wordpress.org/plugins/wordsocket/)
[![Build](https://img.shields.io/github/actions/workflow/status/wpsignal/wordsocket/release.yml)](https://github.com/wpsignal/wordsocket/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/wpsignal/wordsocket)](LICENSE.md)

The official WordPress plugin for [WPSignal](https://wpsignal.io). WordSocket enables developers to connect their site to a secure WebSocket relay.

Events are published over one WebSocket per browser, with an SSE fallback, and their contents are AES-256-GCM encrypted before they leave WordPress with a key derived from the site's own salts, so the relay carries ciphertext it cannot read. WordSocket also registers a Yjs sync provider, so Gutenberg's real-time collaboration runs over the same connection instead of HTTP polling.

## Install:

### WP.org:

The easiest way is to download is <a href="https://wordpress.org/plugins/wordsocket" target="_blank">wordpress.org/plugins/wordsocket</a>.

### WP CLI:

```bash
wp plugin install wordsocket --activate
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
const on = WPS.on( 'comment.posted', (comment: Comment) => {
    // Do cool things with the new `comment`
});
```

## Documentation

Full documentation, API reference, and guides are at <a href="https://wpsignal.io/docs" target="_blank">wpsignal.io/docs</a>.

## Extensions

Plugins built on WordSocket, each one installed alongside it and rendering its own panel on WordSocket's Extensions tab. Source for all of them: [wpsignal/wordsocket-extensions](https://github.com/wpsignal/wordsocket-extensions).

| Extension | What it does |
|-----------|--------------|
| [ShopSocket](https://wpsignal.io/extensions/shopsocket) | A live orders board for WooCommerce teams, and live stock on product pages. [On WordPress.org](https://wordpress.org/plugins/shopsocket/). |

Building your own is [documented here](https://wpsignal.io/docs): register it with `WPS::extensions()->register()`, reserve a channel namespace, and share the connection WordSocket already holds.

## Showcase

Example plugins built on WordSocket, made to read rather than to install: [wpsignal/wordsocket-examples](https://github.com/wpsignal/wordsocket-examples).

## Changelog

Full changelog can be viewed in [CHANGELOG.md](https://github.com/wpsignal/wordsocket/blob/main/CHANGELOG.md)

## License

GPL-2.0-or-later
