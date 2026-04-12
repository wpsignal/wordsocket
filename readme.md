# WordSocket

The official WordPress plugin for [WPSignal](https://wpsignal.io). WordSocket enables developers to connect their site to a secure WebSocket relay.

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
document.addEventListener( 'wpsignal:comment.posted', (e: CustomEvent<Comment>) => {
    console.log(e.detail);
});
```

## Documentation

Full documentation, API reference, and guides are at <a href="https://wpsignal.io/docs/getting-started" target="_blank">wpsignal.io/docs/getting-started</a>.

## Changelog

**0.14.0** - Revamp admin ui, moved explorer to settings app.

Full changelog can be viewed in [CHANGELOG.md](https://github.com/wpsignal/wordsocket/blob/main/CHANGELOG.md)

## License

GPL-2.0-or-later
