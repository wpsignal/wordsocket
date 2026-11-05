/**
 * The stub extension's browser halves for the rules engine (WordSocket 0.31):
 * a context the test flips, a condition reading it, and an action that
 * records the firing. Plain JavaScript, no build step.
 */
( function ( WPS ) {
	if ( ! WPS || ! WPS.rules ) {
		return;
	}
	window.__stubFlag = false;
	window.__stubFired = [];
	// The test sets window.__stubFlag and calls window.__stubTouch() to re-evaluate.
	window.__stubTouch = WPS.rules.context( 'stub', function () {
		return { flag: Boolean( window.__stubFlag ) };
	} );
	WPS.rules.condition( 'stub_flag', function ( ctx, condition ) {
		var flag = ctx.stub && ctx.stub.flag;
		return condition.op === 'is' ? flag === Boolean( condition.value ) : false;
	} );
	WPS.rules.action( 'stub_log', function ( ctx, params ) {
		window.__stubFired.push( { page: ctx.page, params: params } );
	} );
} )( window.WPS );
