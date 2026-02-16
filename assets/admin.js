(function () {
  'use strict';

  var btn = document.getElementById('wpsignal-connect-btn');
  var status = document.getElementById('wpsignal-connect-status');

  if (!btn) return;

  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'Connecting\u2026';
    status.innerHTML = '';

    fetch(wpSignalAdmin.connectUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': wpSignalAdmin.nonce,
      },
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          var msg = result.data.message || 'Connected!';
          status.innerHTML = '<span style="color:#46b450;">' + msg + '</span>';
          setTimeout(function () {
            location.reload();
          }, 1200);
        } else {
          var err = result.data.message || 'Unknown error';
          status.innerHTML = '<span style="color:#dc3232;">' + err + '</span>';
          btn.disabled = false;
          btn.textContent = 'Connect to WPSignal';
        }
      })
      .catch(function () {
        status.innerHTML =
          '<span style="color:#dc3232;">Connection failed.</span>';
        btn.disabled = false;
        btn.textContent = 'Connect to WPSignal';
      });
  });
})();
