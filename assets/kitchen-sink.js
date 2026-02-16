/**
 * WPSignal Kitchen Sink — interactive admin demo page.
 */
(function () {
  'use strict';

  var cfg = window.wpSignalKitchenSink;
  if (!cfg) return;

  var ws = null;
  var expiryInterval = null;

  // -- Helpers --------------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  function appendLog(text, color) {
    var log = $('wpsignal-ks-event-log');
    if (!log) return;
    var line = document.createElement('div');
    line.style.color = color || '#c3c4c7';
    line.textContent = new Date().toLocaleTimeString() + '  ' + text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function clearLog() {
    var log = $('wpsignal-ks-event-log');
    if (log) log.innerHTML = '';
  }

  function restPost(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': cfg.nonce,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // -- 1. Test Connection ---------------------------------------------------

  var testBtn = $('wpsignal-ks-test-connection');
  var testStatus = $('wpsignal-ks-test-status');

  if (testBtn) {
    testBtn.addEventListener('click', function () {
      testStatus.textContent = 'Testing...';
      testStatus.style.color = '';

      var url = cfg.baseUrl.replace(/\/+$/, '') + '/healthz';
      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          testStatus.style.color = '#46b450';
          testStatus.textContent =
            'OK — ' +
            data.active_connections +
            ' connections, ' +
            data.published_messages +
            ' published';
        })
        .catch(function (err) {
          testStatus.style.color = '#dc3232';
          testStatus.textContent = 'Failed: ' + err.message;
        });
    });
  }

  // -- 3. Live Event Log (WebSocket) ----------------------------------------

  var connectBtn = $('wpsignal-ks-connect');
  var disconnectBtn = $('wpsignal-ks-disconnect');
  var wsStatus = $('wpsignal-ks-ws-status');

  function setWsStatus(text, color) {
    if (wsStatus) {
      wsStatus.textContent = text;
      wsStatus.style.color = color || '';
    }
  }

  function connectWs() {
    if (!cfg.configured) {
      setWsStatus('Not configured', '#dc3232');
      return;
    }

    var channels = ($('wpsignal-ks-channels') || {}).value || 'events';
    clearLog();
    appendLog('Fetching token...', '#72aee6');

    restPost(cfg.tokenUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('Token request failed: HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var token = data.token;
        var baseUrl = cfg.baseUrl.replace(/\/+$/, '');
        var wsProto = baseUrl.indexOf('https') === 0 ? 'wss' : 'ws';
        var wsUrl =
          wsProto +
          '://' +
          baseUrl.replace(/^https?:\/\//, '') +
          '/ws?token=' +
          encodeURIComponent(token);

        appendLog('Connecting to WebSocket...', '#72aee6');
        ws = new WebSocket(wsUrl);

        ws.addEventListener('open', function () {
          setWsStatus('Connected', '#46b450');
          appendLog('Connected', '#46b450');
          connectBtn.disabled = true;
          disconnectBtn.disabled = false;

          var channelList = channels.split(',').map(function (c) {
            return c.trim();
          });
          ws.send(JSON.stringify({ type: 'subscribe', channels: channelList }));
          appendLog('Subscribing to: ' + channelList.join(', '), '#72aee6');
        });

        ws.addEventListener('message', function (e) {
          try {
            var msg = JSON.parse(e.data);
            switch (msg.type) {
              case 'message':
                appendLog(
                  '[' + msg.channel + '] ' + msg.event + ': ' + JSON.stringify(msg.data),
                  '#00e676'
                );
                break;
              case 'subscribed':
                appendLog('Subscribed to: ' + (msg.channels || []).join(', '), '#72aee6');
                break;
              case 'unsubscribed':
                appendLog('Unsubscribed from: ' + (msg.channels || []).join(', '), '#ffb74d');
                break;
              case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
              case 'error':
                appendLog('Error: ' + msg.code + ' — ' + msg.message, '#dc3232');
                break;
              default:
                appendLog(JSON.stringify(msg), '#c3c4c7');
            }
          } catch (err) {
            appendLog('Parse error: ' + err.message, '#dc3232');
          }
        });

        ws.addEventListener('close', function (e) {
          setWsStatus('Disconnected (code=' + e.code + ')', '#dc3232');
          appendLog('Disconnected (code=' + e.code + ')', '#ffb74d');
          connectBtn.disabled = false;
          disconnectBtn.disabled = true;
          ws = null;
        });

        ws.addEventListener('error', function () {
          appendLog('WebSocket error', '#dc3232');
        });
      })
      .catch(function (err) {
        setWsStatus('Error', '#dc3232');
        appendLog('Error: ' + err.message, '#dc3232');
      });
  }

  function disconnectWs() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  if (connectBtn) connectBtn.addEventListener('click', connectWs);
  if (disconnectBtn) disconnectBtn.addEventListener('click', disconnectWs);

  // -- 4. Publish Test Event ------------------------------------------------

  var publishBtn = $('wpsignal-ks-publish');
  var pubStatus = $('wpsignal-ks-pub-status');

  if (publishBtn) {
    publishBtn.addEventListener('click', function () {
      var channel = ($('wpsignal-ks-pub-channel') || {}).value || 'events';
      var event = ($('wpsignal-ks-pub-event') || {}).value || 'test.event';
      var dataStr = ($('wpsignal-ks-pub-data') || {}).value || '{}';

      var data;
      try {
        data = JSON.parse(dataStr);
      } catch (err) {
        pubStatus.textContent = 'Invalid JSON: ' + err.message;
        pubStatus.style.color = '#dc3232';
        return;
      }

      pubStatus.textContent = 'Publishing...';
      pubStatus.style.color = '';

      restPost(cfg.publishUrl, { channel: channel, event: event, data: data })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function () {
          pubStatus.textContent = 'Published!';
          pubStatus.style.color = '#46b450';
        })
        .catch(function (err) {
          pubStatus.textContent = 'Failed: ' + err.message;
          pubStatus.style.color = '#dc3232';
        });
    });
  }

  // -- 5. Token Inspector ---------------------------------------------------

  var mintBtn = $('wpsignal-ks-mint-token');

  if (mintBtn) {
    mintBtn.addEventListener('click', function () {
      restPost(cfg.tokenUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var display = $('wpsignal-ks-token-display');
          var rawEl = $('wpsignal-ks-token-raw');
          var claimsEl = $('wpsignal-ks-token-claims');
          var expiryEl = $('wpsignal-ks-token-expiry');

          if (display) display.style.display = 'block';
          if (rawEl) rawEl.value = data.token;

          // Decode JWT payload (middle segment).
          try {
            var parts = data.token.split('.');
            var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (claimsEl) claimsEl.textContent = JSON.stringify(payload, null, 2);

            // Expiry countdown.
            if (expiryInterval) clearInterval(expiryInterval);
            function updateExpiry() {
              var remaining = payload.exp - Math.floor(Date.now() / 1000);
              if (expiryEl) {
                if (remaining > 0) {
                  var mins = Math.floor(remaining / 60);
                  var secs = remaining % 60;
                  expiryEl.textContent =
                    'Expires in: ' + mins + 'm ' + secs + 's';
                  expiryEl.style.color = remaining < 60 ? '#dc3232' : '#46b450';
                } else {
                  expiryEl.textContent = 'Expired';
                  expiryEl.style.color = '#dc3232';
                  clearInterval(expiryInterval);
                }
              }
            }
            updateExpiry();
            expiryInterval = setInterval(updateExpiry, 1000);
          } catch (err) {
            if (claimsEl) claimsEl.textContent = 'Failed to decode: ' + err.message;
          }
        })
        .catch(function (err) {
          var display = $('wpsignal-ks-token-display');
          if (display) display.style.display = 'block';
          var claimsEl = $('wpsignal-ks-token-claims');
          if (claimsEl) claimsEl.textContent = 'Error: ' + err.message;
        });
    });
  }
})();
