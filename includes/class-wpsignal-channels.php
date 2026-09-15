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
 * Reading and writing are granted separately. A reservation's grant covers
 * subscribing, and publishing too unless a second grant is given; in strict
 * mode a token may otherwise publish nowhere (`wpsignal_token_publish_prefixes`
 * adds to that list). Without reservations both stay the site wildcard.
 *
 * @usage: reserve a staff-only namespace on `wpsignal_loaded`:
 * ```php
 *     WPS::instance()->channels()->reserve( 'woo:orders', 'manage_woocommerce' );
 *     // or per user:
 *     WPS::instance()->channels()->reserve( 'woo:customer', fn( $user_id ) => $user_id > 0 );
 *     // staff read it, every visitor may write (presence) to it:
 *     WPS::instance()->channels()->reserve( 'woo:carts', 'manage_woocommerce', '__return_true' );
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
	 * Publish grants per reserved namespace, same keys as `$reservations`.
	 *
	 * @var array<string, string|callable>
	 */
	private array $publish_grants = array();

	/**
	 * Reserve a namespace for users with a capability, or for whom a callable returns true.
	 *
	 * @param string               $ns      Namespace such as `woo:orders` (no `site:` prefix). A trailing colon is implied.
	 * @param string|callable      $grant   Who may subscribe: a capability name, or `callable( int $user_id ): bool`.
	 * @param string|callable|null $publish Who may publish and enter presence; defaults to `$grant`.
	 * @return void
	 */
	public function reserve( string $ns, string|callable $grant, string|callable|null $publish = null ): void {
		$ns = trim( (string) $ns, ': ' );
		if ( '' === $ns || 'events' === $ns ) {
			return;
		}
		$this->reservations[ $ns . ':' ]   = $grant;
		$this->publish_grants[ $ns . ':' ] = $publish ?? $grant;
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
	 * Prefixes a token may publish on.
	 *
	 * Strict mode grants nothing by default: only reserved namespaces whose
	 * publish grant the user passes. Plugins add plain channels through the
	 * `wpsignal_token_publish_prefixes` filter.
	 *
	 * @param int    $user_id User the token is minted for (0 for visitors).
	 * @param string $site_id Hashed site identifier used in channel names.
	 * @return string[]
	 */
	public function allowed_publish_prefixes( int $user_id, string $site_id ): array {
		$site_prefix = 'site:' . $site_id . ':';
		if ( ! $this->is_strict() ) {
			return array( $site_prefix );
		}

		$prefixes = array();
		foreach ( $this->publish_grants as $ns => $grant ) {
			if ( $this->granted( $grant, $user_id ) ) {
				$prefixes[] = $site_prefix . $ns;
			}
		}
		return $prefixes;
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
