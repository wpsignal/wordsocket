<?php
/**
 * Admin notices for publish failures.
 *
 * The publisher runs inside WordPress actions with no user in front of it, so
 * a failed publish (quota reached, credentials rejected, server unreachable)
 * would otherwise be invisible on production sites. This class keeps the last
 * failure in one option and shows it to administrators on the WordSocket and
 * Dashboard screens until the next successful publish, connect, or disconnect.
 *
 * @package WordSocket
 */

namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Records and renders the last publish failure.
 */
class Notices {

	/**
	 * Option holding the last failure: array{code, message, time, until}.
	 */
	const OPTION = 'wpsignal_last_publish_error';

	/**
	 * User meta storing the `time` of the failure the user dismissed.
	 */
	const DISMISSED_META = 'wpsignal_dismissed_publish_error';

	/**
	 * Minimum seconds between writes for the same error code, so a burst of
	 * failed triggers does not hammer wp_options.
	 */
	const WRITE_INTERVAL = 300;

	/**
	 * Admin screens that show the notice.
	 *
	 * @var string[]
	 */
	const SCREENS = array( 'dashboard', 'toplevel_page_wordsocket' );

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function boot() {
		add_action( 'admin_notices', array( $this, 'render' ) );
		add_action( 'wp_ajax_wpsignal_dismiss_publish_error', array( $this, 'handle_dismiss' ) );
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
	 * Forget the last failure (successful publish, connect, or disconnect).
	 *
	 * @return void
	 */
	public static function clear() {
		static $cleared = false;
		if ( $cleared ) {
			return;
		}
		$cleared = true;
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
					__( 'Publishing is paused until %s because this site reached its monthly message quota. Upgrade the plan in the WPSignal dashboard to resume sooner.', 'wordsocket' ),
					$until
				);
			case 'unauthorized':
			case 'invalid_signature':
			case 'unknown_site_key':
			case 'site_not_found':
			case 'invalid_token':
				return __( 'The WPSignal server rejected this site\'s credentials, so events are not being delivered. Disconnect and connect again from the WordSocket settings.', 'wordsocket' );
			case 'unreachable':
				return sprintf(
					/* translators: %s: error detail */
					__( 'Could not reach the WPSignal server (%s), so events are not being delivered.', 'wordsocket' ),
					$error['message']
				);
			default:
				return sprintf(
					/* translators: %s: error detail */
					__( 'Publishing to WPSignal failed: %s', 'wordsocket' ),
					$error['message']
				);
		}
	}

	/**
	 * Print the notice on the Dashboard and WordSocket screens.
	 *
	 * @return void
	 */
	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$screen = get_current_screen();
		if ( ! $screen || ! in_array( $screen->id, self::SCREENS, true ) ) {
			return;
		}
		$error = self::last();
		if ( ! $error ) {
			return;
		}
		if ( (int) get_user_meta( get_current_user_id(), self::DISMISSED_META, true ) === (int) $error['time'] ) {
			return;
		}
		$nonce = wp_create_nonce( 'wpsignal_dismiss_publish_error' );
		?>
		<div class="notice notice-warning is-dismissible wpsignal-publish-error" data-time="<?php echo esc_attr( (string) $error['time'] ); ?>" data-nonce="<?php echo esc_attr( $nonce ); ?>">
			<p>
				<strong><?php esc_html_e( 'WordSocket:', 'wordsocket' ); ?></strong>
				<?php echo esc_html( self::describe( $error ) ); ?>
				<?php if ( 'toplevel_page_wordsocket' !== $screen->id ) : ?>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=wordsocket' ) ); ?>"><?php esc_html_e( 'Open WordSocket settings', 'wordsocket' ); ?></a>
				<?php endif; ?>
			</p>
		</div>
		<script>
			document.addEventListener( 'click', function ( event ) {
				var button = event.target.closest( '.wpsignal-publish-error .notice-dismiss' );
				if ( ! button ) {
					return;
				}
				var notice = button.closest( '.wpsignal-publish-error' );
				var body   = new URLSearchParams( {
					action: 'wpsignal_dismiss_publish_error',
					time: notice.dataset.time,
					_ajax_nonce: notice.dataset.nonce
				} );
				fetch( ajaxurl, { method: 'POST', credentials: 'same-origin', body: body } );
			} );
		</script>
		<?php
	}

	/**
	 * Remember that the current user dismissed the current failure.
	 *
	 * @return void
	 */
	public function handle_dismiss() {
		check_ajax_referer( 'wpsignal_dismiss_publish_error' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}
		$time = isset( $_POST['time'] ) ? absint( wp_unslash( $_POST['time'] ) ) : 0;
		update_user_meta( get_current_user_id(), self::DISMISSED_META, $time );
		wp_send_json_success();
	}
}
