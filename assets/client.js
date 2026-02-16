/**
 * WPSignal Client
 *
 * Prefers WebSocket for bidirectional communication, falls back to SSE.
 * Dispatches `wpsignal:<event>` DOM custom events regardless of transport.
 */
(function () {
  'use strict';

  var config = window.wpSignalConfig;
  if (!config || !config.baseUrl || !config.restUrl) {
    return;
  }

  var baseUrl = config.baseUrl.replace(/\/+$/, '');
  var transport = null; // 'ws' | 'sse'
  var ws = null;
  var sseReader = null;
  var refreshTimer = null;
  var currentToken = null;
  var currentChannels = null;

  /**
   * Fetch a connection token from WordPress.
   */
  function fetchToken() {
    return fetch(config.restUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': config.nonce,
      },
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('WPSignal: token request failed (' + res.status + ')');
      }
      return res.json();
    });
  }

  /**
   * Dispatch a DOM custom event for a received message.
   */
  function dispatchEvent(eventName, payload) {
    console.log('[WPSignal] ' + eventName, payload);

    document.dispatchEvent(
      new CustomEvent('wpsignal:' + eventName, { detail: payload })
    );
  }

  /**
   * Schedule token refresh at 80% of TTL.
   */
  function scheduleRefresh(exp) {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    var ttl = (exp - Math.floor(Date.now() / 1000)) * 1000;
    var refreshAt = Math.max(ttl * 0.8, 10000);
    refreshTimer = setTimeout(function () {
      console.log('[WPSignal] Refreshing token...');
      fetchToken()
        .then(function (data) {
          currentToken = data.token;
          if (transport === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
            // Refresh over existing WebSocket — no reconnect needed.
            ws.send(JSON.stringify({ type: 'auth', token: data.token }));
          } else {
            // SSE: must reconnect with new token.
            cleanup();
            init();
          }
          scheduleRefresh(data.exp);
        })
        .catch(function (err) {
          console.error('[WPSignal] Token refresh failed', err);
          setTimeout(function () { cleanup(); init(); }, 5000);
        });
    }, refreshAt);
  }

  /**
   * Connect via WebSocket.
   */
  function connectWebSocket(token, channels) {
    var wsProto = baseUrl.indexOf('https') === 0 ? 'wss' : 'ws';
    var wsUrl =
      wsProto +
      '://' +
      baseUrl.replace(/^https?:\/\//, '') +
      '/ws?token=' +
      encodeURIComponent(token);

    var didFallback = false;
    var didOpen = false;

    function fallbackToSSE() {
      if (didFallback) return;
      didFallback = true;
      ws = null;
      console.log('[WPSignal] Falling back to SSE');
      connectSSE(token, channels);
    }

    ws = new WebSocket(wsUrl);
    transport = 'ws';

    ws.addEventListener('open', function () {
      didOpen = true;
      console.log('[WPSignal] WebSocket connected');
      ws.send(JSON.stringify({ type: 'subscribe', channels: channels }));
    });

    ws.addEventListener('message', function (e) {
      try {
        var msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'message':
            dispatchEvent(msg.event, {
              channel: msg.channel,
              data: msg.data,
            });
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'subscribed':
            console.log('[WPSignal] Subscribed to', msg.channels);
            break;
          case 'unsubscribed':
            console.log('[WPSignal] Unsubscribed from', msg.channels);
            break;
          case 'auth_ok':
            console.log(
              '[WPSignal] Auth refreshed, expires at',
              new Date(msg.exp * 1000).toISOString()
            );
            break;
          case 'error':
            console.warn('[WPSignal] Server error:', msg.code, msg.message);
            break;
        }
      } catch (err) {
        console.warn('[WPSignal] Failed to parse WS message', err);
      }
    });

    ws.addEventListener('close', function (e) {
      console.log('[WPSignal] WebSocket closed (code=' + e.code + ')');
      ws = null;
      if (!didOpen) {
        // Never connected — fall back to SSE.
        fallbackToSSE();
      } else {
        // Was connected but lost connection — reconnect after a delay.
        console.log('[WPSignal] Reconnecting in 5s...');
        setTimeout(function () { cleanup(); init(); }, 5000);
      }
    });

    ws.addEventListener('error', function () {
      console.warn('[WPSignal] WebSocket error');
      // error always fires before close; let close handler do the fallback.
    });
  }

  /**
   * Connect via SSE (fallback).
   */
  function connectSSE(token, channels) {
    transport = 'sse';
    var url =
      baseUrl +
      '/sse?token=' +
      encodeURIComponent(token) +
      '&channels=' +
      encodeURIComponent(channels.join(','));

    var source = new EventSource(url);
    sseReader = source;

    source.addEventListener('open', function () {
      console.log('[WPSignal] SSE connected');
    });

    source.addEventListener('error', function (e) {
      console.warn('[WPSignal] SSE error', e);
    });

    // Listen for known WordPress event types.
    var eventTypes = ['post.updated', 'post.created', 'post.deleted', 'comment.created'];
    eventTypes.forEach(function (eventType) {
      source.addEventListener(eventType, function (e) {
        try {
          var payload = JSON.parse(e.data);
          dispatchEvent(eventType, payload);
        } catch (err) {
          console.warn('[WPSignal] Failed to parse SSE data', err);
        }
      });
    });

    // Generic catch-all.
    source.addEventListener('message', function (e) {
      console.log('[WPSignal] SSE message', e.data);
    });
  }

  /**
   * Clean up all connections and timers.
   */
  function cleanup() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    if (sseReader) {
      sseReader.close();
      sseReader = null;
    }
    transport = null;
  }

  /**
   * Initialize: get token, then connect (WebSocket first, SSE fallback).
   */
  function init() {
    fetchToken()
      .then(function (data) {
        console.log(
          '[WPSignal] Token obtained, expires at',
          new Date(data.exp * 1000).toISOString()
        );
        currentToken = data.token;
        currentChannels = data.channels;

        scheduleRefresh(data.exp);

        // Try WebSocket first.
        if (typeof WebSocket !== 'undefined') {
          connectWebSocket(data.token, data.channels);
        } else {
          connectSSE(data.token, data.channels);
        }
      })
      .catch(function (err) {
        console.error('[WPSignal]', err);
        setTimeout(init, 30000);
      });
  }

  // Start when DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
