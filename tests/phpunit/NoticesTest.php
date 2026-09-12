<?php
/**
 * Notices: recording, throttling, copy, and clearing of the last publish failure.
 */

use WPSignal\Notices;

final class NoticesTest extends WordSocketTestCase {

	public function test_record_stores_the_failure_and_clear_removes_it(): void {
		$this->assertNull( Notices::last() );

		Notices::record( 'unreachable', 'cURL error 7' );
		$last = Notices::last();
		$this->assertSame( 'unreachable', $last['code'] );
		$this->assertSame( 'cURL error 7', $last['message'] );
		$this->assertEqualsWithDelta( time(), $last['time'], 2 );
		$this->assertSame( 0, $last['until'] );

		Notices::clear();
		$this->assertNull( Notices::last() );
		Notices::clear(); // idempotent, also after a previous clear in this process
		$this->assertNull( Notices::last() );
	}

	public function test_repeated_failures_with_the_same_code_are_written_once_per_interval(): void {
		Notices::record( 'unreachable', 'first' );
		Notices::record( 'unreachable', 'second' );
		$this->assertSame( 'first', Notices::last()['message'], 'same code inside the interval keeps the first write' );

		Notices::record( 'quota_exceeded', 'quota', time() + 3600 );
		$this->assertSame( 'quota_exceeded', Notices::last()['code'], 'a different code writes immediately' );
	}

	public function test_describe_gives_actionable_copy_per_failure_class(): void {
		$until = gmmktime( 0, 0, 0, 10, 1, 2026 );
		$quota = Notices::describe( array( 'code' => 'quota_exceeded', 'message' => 'x', 'time' => time(), 'until' => $until ) );
		$this->assertStringContainsString( 'quota', $quota );
		$this->assertStringContainsString( date_i18n( get_option( 'date_format' ), $until ), $quota );

		foreach ( array( 'unauthorized', 'invalid_signature', 'unknown_site_key', 'site_not_found', 'invalid_token' ) as $code ) {
			$this->assertStringContainsString( 'rejected', Notices::describe( array( 'code' => $code, 'message' => 'x', 'time' => time() ) ), $code );
		}

		$network = Notices::describe( array( 'code' => 'unreachable', 'message' => 'cURL error 7', 'time' => time() ) );
		$this->assertStringContainsString( 'Could not reach', $network );
		$this->assertStringContainsString( 'cURL error 7', $network );

		$other = Notices::describe( array( 'code' => 'http_500', 'message' => 'boom', 'time' => time() ) );
		$this->assertStringContainsString( 'boom', $other );
	}
}
