<?php
/**
 * The last publish failure.
 *
 * The publisher runs inside WordPress actions with no user in front of it, so
 * a failed publish (quota reached, credentials rejected, server unreachable)
 * would otherwise be invisible. This class keeps the last failure in one
 * option; the WordSocket settings page shows it in the Connect tab, and the
 * settings probe (`Token::check_connection()`) clears it as soon as the server
 * answers again. There is deliberately no admin notice.
 *
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Records the last publish failure.
 */
class Notices {

	/**
	 * Option holding the last failure: array{code, message, time, until}.
	 */
	const OPTION = 'wpsignal_last_publish_error';

	/**
	 * Minimum seconds between writes for the same error code, so a burst of
	 * failed triggers does not hammer wp_options.
	 */
	const WRITE_INTERVAL = 300;

	/**
	 * Server error codes that mean this site's credentials are no longer valid
	 * (deleted site, regenerated key, deactivated account). Shared by the
	 * settings check, the disconnect handler, and the client enqueue.
	 */
	const REJECTED_CODES = array(
		'unknown_site_key',
		'invalid_token',
		'site_not_found',
		'account_deactivated',
		'invalid_api_key',
	);

	/**
	 * Whether the last recorded failure says the server no longer accepts
	 * this site's credentials. Cleared by a successful publish, a connect, or
	 * a disconnect.
	 *
	 * @return bool
	 */
	public static function credentials_rejected(): bool {
		$last = self::last();
		return null !== $last && in_array( $last['code'], self::REJECTED_CODES, true );
	}

	/**
	 * Record a publish failure.
	 *
	 * @param string   $code    Error code from the server (e.g. quota_exceeded, unauthorized) or `unreachable`.
	 * @param string   $message Human-readable detail.
	 * @param int|null $until   Unix timestamp until which publishing is paused, if known.
	 * @return void
	 */
	public static function record( $code, $message, $until = null ) {
		$current = get_option( self::OPTION, array() );
		if (
			is_array( $current )
			&& isset( $current['code'], $current['time'] )
			&& $current['code'] === $code
			&& ( time() - (int) $current['time'] ) < self::WRITE_INTERVAL
		) {
			return;
		}
		update_option(
			self::OPTION,
			array(
				'code'    => sanitize_key( $code ),
				'message' => sanitize_text_field( $message ),
				'time'    => time(),
				'until'   => $until ? (int) $until : 0,
			),
			false
		);
	}

	/**
	 * Forget the last failure unless it is a quota pause, which a reachability
	 * probe cannot see and which ends on its own at the end of the month.
	 *
	 * @return void
	 */
	public static function clear_transient(): void {
		$last = self::last();
		if ( null !== $last && 'quota_exceeded' === $last['code'] && (int) $last['until'] > time() ) {
			return;
		}
		self::clear();
	}

	/**
	 * Forget the last failure (successful publish, connect, or disconnect).
	 *
	 * @return void
	 */
	public static function clear() {
		// get_option() is served from the options cache, so this costs nothing
		// on the common path (no stored failure) and stays correct in long
		// running processes such as WP-CLI and the test suite.
		if ( false !== get_option( self::OPTION, false ) ) {
			delete_option( self::OPTION );
		}
	}

	/**
	 * The last failure, or null.
	 *
	 * @return array|null
	 */
	public static function last() {
		$error = get_option( self::OPTION, null );
		return is_array( $error ) && isset( $error['code'] ) ? $error : null;
	}

	/**
	 * Copy for a failure, keyed by what the administrator can do about it.
	 *
	 * @param array $error Stored failure.
	 * @return string
	 */
	public static function describe( $error ) {
		switch ( $error['code'] ) {
			case 'quota_exceeded':
				$until = ! empty( $error['until'] )
					? wp_date( get_option( 'date_format' ), (int) $error['until'] )
					: __( 'the start of next month', 'wordsocket' );
				return sprintf(
					/* translators: %s: date */
					__( 'This site reached its monthly message quota; publishing resumes on %s. Upgrade the plan in the WPSignal dashboard to resume sooner.', 'wordsocket' ),
					$until
				);
			case 'unauthorized':
			case 'invalid_signature':
			case 'unknown_site_key':
			case 'site_not_found':
			case 'invalid_token':
				return __( 'The WPSignal server rejected this site\'s credentials. Disconnect and connect again.', 'wordsocket' );
			case 'unreachable':
				return __( 'The WPSignal server could not be reached.', 'wordsocket' );
			default:
				return __( 'The WPSignal server refused the last publish.', 'wordsocket' );
		}
	}
}
