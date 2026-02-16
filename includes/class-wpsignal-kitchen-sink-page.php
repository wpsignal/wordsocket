<?php
/**
 * WPSignal\Kitchen_Sink_Page — interactive admin demo page.
 *
 * Renders a full-page admin view at WPSignal > Kitchen Sink with five panels
 * for testing and inspecting all plugin features:
 *
 *   1. Connection Status — configured badge, site_key, "Test Connection" button
 *   2. Registered Triggers — table of all triggers (event, hook, channel, condition)
 *   3. Live Event Log — WebSocket connect/disconnect, channel subscribe, scrolling log
 *   4. Publish Test Event — form (channel, event name, JSON data) via REST proxy
 *   5. Token Inspector — mint button, decoded JWT claims, expiry countdown
 *
 * The page enqueues `kitchen-sink.js` which handles all client-side interactivity.
 * Publishing goes through the PHP REST endpoint (POST /wpsignal/v1/publish)
 * so the HMAC site secret never reaches the browser.
 *
 * @package WPSignal
 */

 namespace WPSignal;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kitchen_Sink_Page {

	/** @var Config Configuration accessor. */
	private $config;

	/**
	 * @param Config $config Configuration accessor.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Render the Kitchen Sink admin page.
	 *
	 * Called as the callback for the "Kitchen Sink" submenu page.
	 * Requires `manage_options` capability.
	 *
	 * @return void
	 */
	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$this->enqueue_assets();

		$triggers = WPS::instance()->trigger_registry()->all();

		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'WPSignal Kitchen Sink', 'wpsignal' ); ?></h1>

			<?php $this->render_connection_status(); ?>
			<?php $this->render_triggers_table( $triggers ); ?>
			<?php $this->render_event_log(); ?>
			<?php $this->render_publish_form(); ?>
			<?php $this->render_token_inspector(); ?>
		</div>
		<?php
	}

	/**
	 * Enqueue the kitchen-sink.js script and localize configuration.
	 *
	 * Passes baseUrl, siteKey, REST URLs, nonce, and configured status
	 * to the JavaScript via `wpSignalKitchenSink`.
	 *
	 * @return void
	 */
	private function enqueue_assets() {
		wp_enqueue_script(
			'wpsignal-kitchen-sink',
			URL . 'assets/kitchen-sink.js',
			array(),
			VERSION,
			true
		);

		wp_localize_script( 'wpsignal-kitchen-sink', 'wpSignalKitchenSink', array(
			'baseUrl'    => esc_url( $this->config->base_url() ),
			'siteKey'    => $this->config->site_key(),
			'restUrl'    => rest_url( 'wpsignal/v1/' ),
			'tokenUrl'   => rest_url( 'wpsignal/v1/token' ),
			'publishUrl' => rest_url( 'wpsignal/v1/publish' ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'configured' => $this->config->is_configured(),
		) );
	}

	/**
	 * Render Panel 1: Connection Status.
	 *
	 * Shows configured/not-configured badge, server URL, site key,
	 * and a "Test Connection" button that pings /healthz.
	 *
	 * @return void
	 */
	private function render_connection_status() {
		$configured = $this->config->is_configured();
		$site_key   = $this->config->site_key();
		$base_url   = $this->config->base_url();
		?>
		<div class="card" style="max-width:100%;">
			<h2><?php esc_html_e( 'Connection Status', 'wpsignal' ); ?></h2>

			<p>
				<?php if ( $configured ) : ?>
					<span class="dashicons dashicons-yes-alt" style="color:#46b450;"></span>
					<strong><?php esc_html_e( 'Configured', 'wpsignal' ); ?></strong>
				<?php else : ?>
					<span class="dashicons dashicons-dismiss" style="color:#dc3232;"></span>
					<strong><?php esc_html_e( 'Not Configured', 'wpsignal' ); ?></strong>
					&mdash; <?php esc_html_e( 'Go to Settings to connect.', 'wpsignal' ); ?>
				<?php endif; ?>
			</p>

			<?php if ( $configured ) : ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Server URL', 'wpsignal' ); ?></th>
						<td><code><?php echo esc_html( $base_url ); ?></code></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Site Key', 'wpsignal' ); ?></th>
						<td><code><?php echo esc_html( $site_key ); ?></code></td>
					</tr>
				</table>

				<p>
					<button type="button" id="wpsignal-ks-test-connection" class="button">
						<?php esc_html_e( 'Test Connection', 'wpsignal' ); ?>
					</button>
					<span id="wpsignal-ks-test-status" style="margin-left:10px;"></span>
				</p>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Render Panel 2: Registered Triggers table.
	 *
	 * Displays all triggers from the registry in a WordPress admin table
	 * with columns: Event, Hook, Priority, Args, Channel, Condition.
	 *
	 * @param Trigger[] $triggers Array of registered triggers.
	 * @return void
	 */
	private function render_triggers_table( $triggers ) {
		?>
		<div class="card" style="max-width:100%;margin-top:20px;">
			<h2><?php esc_html_e( 'Registered Triggers', 'wpsignal' ); ?></h2>

			<?php if ( empty( $triggers ) ) : ?>
				<p><?php esc_html_e( 'No triggers registered.', 'wpsignal' ); ?></p>
			<?php else : ?>
				<table class="widefat striped">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Event', 'wpsignal' ); ?></th>
							<th><?php esc_html_e( 'Hook', 'wpsignal' ); ?></th>
							<th><?php esc_html_e( 'Priority', 'wpsignal' ); ?></th>
							<th><?php esc_html_e( 'Args', 'wpsignal' ); ?></th>
							<th><?php esc_html_e( 'Channel', 'wpsignal' ); ?></th>
							<th><?php esc_html_e( 'Condition', 'wpsignal' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $triggers as $trigger ) : ?>
							<tr>
								<td><code><?php echo esc_html( $trigger->get_event() ); ?></code></td>
								<td><code><?php echo esc_html( $trigger->get_hook() ); ?></code></td>
								<td><?php echo esc_html( $trigger->get_priority() ); ?></td>
								<td><?php echo esc_html( $trigger->get_accepted_args() ); ?></td>
								<td><code><?php echo esc_html( $trigger->get_channel() ); ?></code></td>
								<td><?php echo $trigger->has_condition() ? '&#10003;' : '&mdash;'; ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Render Panel 3: Live Event Log.
	 *
	 * Provides channel input, connect/disconnect buttons, and a scrolling
	 * monospace event log. All interactivity handled by kitchen-sink.js.
	 *
	 * @return void
	 */
	private function render_event_log() {
		?>
		<div class="card" style="max-width:100%;margin-top:20px;">
			<h2><?php esc_html_e( 'Live Event Log', 'wpsignal' ); ?></h2>

			<p>
				<label for="wpsignal-ks-channels">
					<?php esc_html_e( 'Channels (comma-separated):', 'wpsignal' ); ?>
				</label>
				<input type="text" id="wpsignal-ks-channels" value="events" class="regular-text" />
			</p>

			<p>
				<button type="button" id="wpsignal-ks-connect" class="button button-primary">
					<?php esc_html_e( 'Connect', 'wpsignal' ); ?>
				</button>
				<button type="button" id="wpsignal-ks-disconnect" class="button" disabled>
					<?php esc_html_e( 'Disconnect', 'wpsignal' ); ?>
				</button>
				<span id="wpsignal-ks-ws-status" style="margin-left:10px;"></span>
			</p>

			<div id="wpsignal-ks-event-log" style="max-height:300px;overflow-y:auto;background:#1d2327;color:#c3c4c7;padding:10px;font-family:monospace;font-size:13px;border-radius:4px;">
				<div style="color:#72aee6;"><?php esc_html_e( 'Waiting for connection...', 'wpsignal' ); ?></div>
			</div>
		</div>
		<?php
	}

	/**
	 * Render Panel 4: Publish Test Event form.
	 *
	 * Form with channel, event name, and JSON data fields. Publishes via
	 * the REST proxy (POST /wpsignal/v1/publish) so the site secret stays
	 * server-side. Handled by kitchen-sink.js.
	 *
	 * @return void
	 */
	private function render_publish_form() {
		?>
		<div class="card" style="max-width:100%;margin-top:20px;">
			<h2><?php esc_html_e( 'Publish Test Event', 'wpsignal' ); ?></h2>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="wpsignal-ks-pub-channel"><?php esc_html_e( 'Channel', 'wpsignal' ); ?></label></th>
					<td><input type="text" id="wpsignal-ks-pub-channel" value="events" class="regular-text" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="wpsignal-ks-pub-event"><?php esc_html_e( 'Event Name', 'wpsignal' ); ?></label></th>
					<td><input type="text" id="wpsignal-ks-pub-event" value="test.event" class="regular-text" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="wpsignal-ks-pub-data"><?php esc_html_e( 'JSON Data', 'wpsignal' ); ?></label></th>
					<td><textarea id="wpsignal-ks-pub-data" class="large-text" rows="4">{"message": "Hello from Kitchen Sink!"}</textarea></td>
				</tr>
			</table>

			<p>
				<button type="button" id="wpsignal-ks-publish" class="button button-primary">
					<?php esc_html_e( 'Publish Event', 'wpsignal' ); ?>
				</button>
				<span id="wpsignal-ks-pub-status" style="margin-left:10px;"></span>
			</p>
		</div>
		<?php
	}

	/**
	 * Render Panel 5: Token Inspector.
	 *
	 * "Mint Token" button, raw token display, decoded JWT claims, and
	 * live expiry countdown. Handled by kitchen-sink.js.
	 *
	 * @return void
	 */
	private function render_token_inspector() {
		?>
		<div class="card" style="max-width:100%;margin-top:20px;">
			<h2><?php esc_html_e( 'Token Inspector', 'wpsignal' ); ?></h2>

			<p>
				<button type="button" id="wpsignal-ks-mint-token" class="button">
					<?php esc_html_e( 'Mint Token', 'wpsignal' ); ?>
				</button>
			</p>

			<div id="wpsignal-ks-token-display" style="display:none;">
				<h3><?php esc_html_e( 'Raw Token', 'wpsignal' ); ?></h3>
				<textarea id="wpsignal-ks-token-raw" class="large-text" rows="3" readonly></textarea>

				<h3><?php esc_html_e( 'Decoded Claims', 'wpsignal' ); ?></h3>
				<pre id="wpsignal-ks-token-claims" style="background:#f0f0f1;padding:10px;overflow-x:auto;"></pre>

				<p id="wpsignal-ks-token-expiry"></p>
			</div>
		</div>
		<?php
	}
}
