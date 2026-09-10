// Pioneer TV launcher page logic.
(function (M) {
  const b = M.bridge;
  M.launcherUrl = location.href;

  const $ = (id) => document.getElementById(id);
  const tilesEl = $('tiles');
  const searchInput = $('search');
  const targetsSection = $('search-targets');
  const targetsEl = $('targets');
  const clock = $('clock');

  let services = M.defaultServices;

  function render() {
    tilesEl.innerHTML = '';
    for (const s of services) {
      const a = document.createElement('a');
      a.className = 'tile pioneertv-card';
      a.href = s.url;
      a.style.setProperty('--tile-color', s.color || '#444');
      a.dataset.service = s.id;
      const band = document.createElement('span'); band.className = 'band'; a.appendChild(band);
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = (s.glyph || s.name[0]).toUpperCase();
      a.appendChild(glyph);
      if (s.logo) { const img = document.createElement('img'); img.className = 'logo'; img.src = s.logo; img.alt = ''; a.appendChild(img); }
      const name = document.createElement('div'); name.className = 'name'; name.textContent = s.name; a.appendChild(name);
      const tag = document.createElement('div'); tag.className = 'tagline'; tag.textContent = s.tagline || ''; a.appendChild(tag);
      const index = document.createElement('span'); index.className = 'index'; index.textContent = `0${tilesEl.children.length + 1}`; a.appendChild(index);
      a.addEventListener('click', (e) => { e.preventDefault(); open(s.url); });
      tilesEl.appendChild(a);
    }
  }

  function open(url) {
    document.body.style.transition = 'opacity 180ms';
    document.body.style.opacity = '0';
    setTimeout(() => b.navigate(url), 160);
  }

  function showTargets(query) {
    $('targets-query').textContent = query;
    targetsEl.innerHTML = '';
    for (const s of services) {
      if (!s.search_url) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'target pioneertv-card';
      btn.style.setProperty('--target-color', s.color || '#444');
      btn.textContent = s.name;
      btn.addEventListener('click', () => open(s.search_url.replace('{query}', encodeURIComponent(query))));
      targetsEl.appendChild(btn);
    }
    targetsSection.hidden = false;
    M.nav.focus(targetsEl.firstElementChild);
  }

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) showTargets(q);
  });
  searchInput.addEventListener('input', () => { if (!searchInput.value.trim()) targetsSection.hidden = true; });

  $('btn-menu').addEventListener('click', () => M.hud.menu.toggle());
  $('btn-tv').addEventListener('click', () => {
    if (b.state.daemonConnected) b.cec('tv_off');
    else M.hud.toast('Ingen daemon: skulle stänga av TV:n', '⏻');
  });

  function tick() {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const h = d.getHours();
    $('greeting').textContent = (h < 5 ? 'God natt' : h < 10 ? 'God morgon' : h < 18 ? 'God dag' : 'God kväll') + '.';
    const date = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('dateline').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }
  tick();
  setInterval(tick, 15000);

  // Pixel icons for the static bits of the page.
  const icons = M.icons;
  $('search-icon').appendChild(icons.svg('search'));
  document.querySelectorAll('[data-icon]').forEach((el) => el.appendChild(icons.svg(el.dataset.icon)));
  $('pill-wifi').appendChild(icons.svg('wifi'));
  $('pill-tailscale').appendChild(icons.svg('link'));
  $('pill-gamepad').appendChild(icons.svg('gamepad'));
  $('pill-daemon').appendChild(icons.svg('dot'));

  b.on('state', (s) => {
    $('pill-daemon').classList.toggle('on', s.daemonConnected);
    if (s.config && Array.isArray(s.config.services) && s.config.services.length) {
      services = s.config.services;
      render();
    }
  });
  b.on('gamepad', (e) => $('pill-gamepad').classList.toggle('on', !!e.connected));

  function applyStatus(s) {
    if (!s) return;
    const w = s.wifi || {}, t = s.tailscale || {};
    const eth = (s.interfaces || []).find((i) => i.name.startsWith('e') && i.addresses.length);
    const wifi = $('pill-wifi');
    wifi.replaceChildren(icons.svg(w.state === 'connected' ? 'wifi' : eth ? 'ethernet' : 'wifi'));
    wifi.classList.toggle('on', w.state === 'connected' || !!eth);
    wifi.title = w.state === 'connected' ? `${w.ssid} ${w.signal != null ? w.signal + '%' : ''}` : eth ? `Ethernet ${eth.addresses[0]}` : 'Inget nätverk';
    const ts = $('pill-tailscale');
    ts.classList.toggle('on', t.state === 'running');
    ts.classList.toggle('warn', t.state === 'running' && t.plex_online === false);
    ts.title = t.state === 'running' ? `Tailscale ${(t.ips || [])[0] || ''}${t.plex_online != null ? (t.plex_online ? ', Plex online' : ', Plex offline') : ''}` : `Tailscale ${t.state || 'okänd'}`;
    $('pill-gamepad').classList.toggle('on', (s.gamepads || []).length > 0);
  }
  b.on('state', (s) => applyStatus(s.status));

  render();
  // Land on the first tile, not the search field, so Enter does not pop the keyboard.
  requestAnimationFrame(() => M.nav.focus(tilesEl.firstElementChild, { scroll: false }));
})(window.PioneerTV);
