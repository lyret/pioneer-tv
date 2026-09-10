// Pioneer TV content entry point: wires bridge events to the overlays.
(function (M) {
  if (window.top !== window) return; // main frame only
  if (M._started) return;
  M._started = true;

  M.bridge.init();
  M.nav.init();

  const b = M.bridge;
  b.on('keyboard', () => M.keyboard.toggle());
  b.on('menu', () => M.hud.menu.toggle());
  b.on('escape', () => {
    if (M.hud.menu.isOpen()) M.hud.menu.close();
    else if (M.keyboard.isOpen()) M.keyboard.close();
  });
  b.on('volume', (e) => M.hud.toast(e.direction === 'up' ? 'Volym +' : e.direction === 'down' ? 'Volym −' : 'Ljud av', e.direction === 'mute' ? 'mute' : 'volume'));
  b.on('gamepad', (e) => M.hud.toast(e.connected ? `Handkontroll ansluten` : 'Handkontroll frånkopplad', 'gamepad'));
  b.on('tv', (e) => {
    if (e.power === 'standby') {
      document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch {} });
      M.hud.toast('TV i standby, paus', 'power');
    } else if (e.power === 'on') M.hud.toast('TV på', 'power');
  });
  b.on('status', () => {
    const s = b.state;
    M.hud.toast(`${s.daemonConnected ? 'Daemon ansluten' : 'Ingen daemon'} · ${location.hostname || 'launcher'}`, 'info');
  });
  b.on('toast', (e) => M.hud.toast(e.text, e.icon || ''));
  b.on('keyboard_present', (e) => {
    b.state.physicalKeyboard = !!e.present;
    M.hud.toast(e.present ? 'Tangentbord anslutet' : 'Tangentbord frånkopplat', 'keyboard');
  });

  b.on('state', (s) => document.documentElement.classList.toggle('pioneertv-tv', !!s.tvMode));

  // Escape closes overlays before it reaches the page.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (M.hud.menu.isOpen() || M.keyboard.isOpen()) return; // captured layers handle it
  }, true);
})(window.PioneerTV);
