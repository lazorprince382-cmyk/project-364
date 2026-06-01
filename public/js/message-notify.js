/**
 * Staff message alerts: header bell, short chime, browser desktop notification.
 */
(function () {
  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [660, 880].forEach(function (freq, i) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g);
        g.connect(ctx.destination);
        const t0 = ctx.currentTime + i * 0.08;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.start(t0);
        o.stop(t0 + 0.2);
      });
    } catch (_) {}
  }

  function desktopNotify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const o = {};
      if (typeof body === 'string' && body) o.body = body.slice(0, 240);
      new Notification(title, o);
    } catch (_) {}
  }

  function bell(text) {
    if (window.__oceanDashboard && typeof window.__oceanDashboard.addNotification === 'function') {
      window.__oceanDashboard.addNotification(text);
      return;
    }
    if (window.__oceanSkill && typeof window.__oceanSkill.addNotification === 'function') {
      window.__oceanSkill.addNotification(text);
    }
  }

  function requestPermissionFromGesture() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    try {
      Notification.requestPermission();
    } catch (_) {}
  }

  function attachPanelAskOnce(panelId) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    const panel = document.getElementById(panelId);
    if (!panel || panel.dataset.oceanNotifyAskBound) return;
    panel.dataset.oceanNotifyAskBound = '1';
    panel.addEventListener(
      'pointerdown',
      function () {
        requestPermissionFromGesture();
      },
      { once: true }
    );
  }

  window.OceanMessageNotify = {
    playChime: playChime,
    bell: bell,
    requestPermissionFromGesture: requestPermissionFromGesture,
    attachPanelAskOnce: attachPanelAskOnce,

    notifyIncoming: function (summary, detail) {
      bell(summary);
      playChime();
      desktopNotify(
        (typeof window !== 'undefined' && window.OCEAN_SCHOOL_NAME
          ? window.OCEAN_SCHOOL_NAME
          : 'THE OCEAN OF KNOWLEDGE SCHOOL') + ' — New staff message',
        detail || summary
      );
    },
  };
})();
