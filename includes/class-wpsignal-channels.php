<?php
/**
 * Channel namespaces and the prefixes a connection token may subscribe to.
 *
 * @package WPSignal
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Decides which channel prefixes go into a connection JWT.
 *
 * The relay refuses subscribe and publish frames outside the token's
 * `allowed_channel_prefixes`, so this is where a site-private channel is
 * gated. Encryption does not help: the payload key is site-wide.
 *
 * With no reservations every token carries the site wildcard, as it always
 * has. Once any plugin reserves a namespace, tokens switch to an explicit list:
 * the default `events` channel, every channel registered through the
 * `wpsignal_token_channels` filter, and each reserved namespace the user
 * qualifies for.
 *
 * @usage: reserve a staff-only namespace on `wpsignal_loaded`:
 * ```php
 *     WPS::instance()->channels()->reserve( 'woo:orders', 'manage_woocommerce' );
 *     // or per user:
 *     WPS::instance()->channels()->reserve( 'woo:customer', fn( $user_id ) => $user_id > 0 );
 * ```
 */
class Channels {

	/**
	 * Reserved namespaces: normalised namespace (trailing colon) => capability or callable.
	 *
	 * @var array<string, string|callable>
	 */
	private array $reservations = array();

	/**
	 * Reserve a namespace for users with a capability, or for whom a callable returns true.
	 *
	 * @param string          $ns    Namespace such as `woo:orders` (no `site:` prefix). A trailing colon is implied.
	 * @param string|callable $grant Capability name, or `callable( int $user_id ): bool`.
	 * @return void
	 */
	public function reserve( string $ns, string|callable $grant ): void {
		$ns = trim( (string) $ns, ': ' );
		if ( '' === $ns || 'events' === $ns ) {
			return;
		}
		$this->reservations[ $ns . ':' ] = $grant;
	}

	/**
	 * Reserved namespaces with their grants.
	 *
	 * @return array<string, string|callable>
	 */
	public function reservations(): array {
		return $this->reservations;
	}

	/**
	 * Whether any namespace is reserved (strict mode).
	 *
	 * @return bool
	 */
	public function is_strict(): bool {
		return ! empty( $this->reservations );
	}

	/**
	 * Prefixes for a token.
	 *
	 * @param int      $user_id  User the token is minted for (0 for visitors).
	 * @param string   $site_id  Hashed site identifier used in channel names.
	 * @param string[] $channels Channels the client auto-subscribes to (after the `wpsignal_token_channels` filter).
	 * @return string[]
	 */
	public function allowed_prefixes( int $user_id, string $site_id, array $channels ): array {
		$site_prefix = 'site:' . $site_id . ':';
		if ( ! $this->is_strict() ) {
			return array( $site_prefix );
		}

		$prefixes = array( $site_prefix . 'events' );
		foreach ( $channels as $channel ) {
			$channel = (string) $channel;
			if ( '' === $channel ) {
				continue;
			}
			// Plugins may pass a bare name or the full site-scoped form.
			$prefixes[] = str_starts_with( $channel, $site_prefix ) ? $channel : $site_prefix . $channel;
		}
		foreach ( $this->reservations as $ns => $grant ) {
			if ( $this->granted( $grant, $user_id ) ) {
				$prefixes[] = $site_prefix . $ns;
			}
		}

		return array_values( array_unique( $prefixes ) );
	}

	/**
	 * Whether a grant applies to a user.
	 *
	 * @param string|callable $grant   Capability or callable.
	 * @param int             $user_id User ID, 0 for visitors.
	 * @return bool
	 */
	private function granted( string|callable $grant, int $user_id ): bool {
		if ( is_callable( $grant ) ) {
			return (bool) call_user_func( $grant, $user_id );
		}
		return $user_id > 0 && user_can( $user_id, $grant );
	}
}
