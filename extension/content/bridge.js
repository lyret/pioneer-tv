// Magic TV bridge: the only place that touches chrome.* APIs.
//
// Every other script works without an extension context so the launcher and
// overlays can be opened as plain files while designing.
window.MagicTV = window.MagicTV || {};
(function (M) {
  const listeners = {};
  const hasExt = !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
  const params = new URLSearchParams(location.search);

  const bridge = {
    available: hasExt,
    state: {
      daemonConnected: false,
      config: null,
      // "TV mode" turns on the behaviours that only make sense with a gamepad
      // (auto keyboard, big focus ring). Forced with ?tv=1 when designing.
      tvMode: params.has('tv'),
    },

    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    emit(name, data) { (listeners[name] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },

    // Messages to the background worker (and via it, the daemon).
    send(msg) { if (hasExt) chrome.runtime.sendMessage(msg).catch(() => {}); },
    daemon(payload) { this.send({ type: 'daemon', payload }); },
    cec(command) { this.daemon({ type: 'cec', command }); },
    navigate(url) {
      if (hasExt) this.send({ type: 'navigate', url });
      else location.href = url;
    },
    home() {
      if (hasExt) this.send({ type: 'home' });
      else location.href = M.launcherUrl || '../launcher/index.html';
    },

    init() {
      if (!hasExt) { this.emit('state', this.state); return; }
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'state') this._applyState(msg);
        else if (msg.type === 'event') this.emit(msg.name, msg);
      });
      chrome.runtime.sendMessage({ type: 'getState' }).then((s) => s && this._applyState(s)).catch(() => {});
    },

    _applyState(s) {
      this.state.daemonConnected = !!s.daemonConnected;
      this.state.config = s.config || null;
      if (this.state.daemonConnected) this.state.tvMode = true;
      this.emit('state', this.state);
    },
  };

  M.bridge = bridge;
})(window.MagicTV);
