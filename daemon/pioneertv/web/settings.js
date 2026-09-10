// Pioneer TV settings page. Vanilla JS, talks to /api/*. Open with ?mock=1 to
// design without a daemon.
(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const mainHost = $('#main');
  let generation = 0;
  const MOCK = new URLSearchParams(location.search).has('mock');
  let toastTimer;

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined) el.append(c.nodeType ? c : String(c));
    return el;
  }

  // ---------------------------------------------------------------- API
  async function api(method, path, body) {
    if (MOCK) return mock(method, path, body);
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.message) || (data && data.error) || `${res.status}`);
    return data;
  }

  function mock(method, path, body) {
    const wait = (v, ms = 250) => new Promise((r) => setTimeout(() => r(v), ms));
    if (path === '/api/status') return wait({
      wifi: { available: true, device: 'wlan0', state: 'connected', ssid: 'Lyresten', signal: 72 },
      tailscale: { installed: true, state: 'running', ips: ['100.101.102.103'], dns_name: 'pioneer-tv.tail1234.ts.net', plex_online: true,
        peers: [{ host: 'plex', online: true }, { host: 'laptop', online: true }, { host: 'phone', online: false }] },
      interfaces: [{ name: 'eth0', up: true, addresses: ['192.168.1.40'] }, { name: 'wlan0', up: true, addresses: ['192.168.1.41'] }],
      system: { hostname: 'pioneer-tv', temp_c: 54.3, throttled: 0, throttled_now: false, throttled_ever: false, mem_total_mb: 921, mem_available_mb: 380, uptime_s: 86400 * 3 + 3600, load1: 0.8, disk: { total_mb: 29000, free_mb: 21000 } },
      gamepads: [{ name: 'Wireless Controller', battery: 65 }, { name: '8BitDo Pro 2', battery: null }],
      keyboard_present: false,
      cec: { enabled: true, phys_addr: '1.0.0.0', tv_power: 'on' },
      version: '0.1.0', page: 'https://www.svtplay.se/',
    });
    if (path === '/api/settings' && method === 'GET') return wait({
      sections: [
        { id: 'controls', title: 'Kontroller', fields: [
          { path: 'mouse.max_speed', type: 'number', label: 'Pekarhastighet', min: 200, max: 3000, step: 100, unit: 'px/s', value: 1100 },
          { path: 'gamepad.long_press_ms', type: 'number', label: 'Långtryck', min: 300, max: 2000, step: 100, unit: 'ms', value: 800 },
          { path: 'ui.auto_keyboard', type: 'bool', label: 'Öppna skärmtangentbordet automatiskt', value: true } ] },
        { id: 'tv', title: 'TV', fields: [
          { path: 'cec.enabled', type: 'bool', label: 'HDMI-CEC', value: true },
          { path: 'cec.osd_name', type: 'text', label: 'Namn som TV:n visar', value: 'Pioneer TV', maxlength: 14 } ] },
        { id: 'remote', title: 'Fjärråtkomst', fields: [
          { path: 'remote.token', type: 'text', label: 'Åtkomstnyckel', secret: true, value: '', is_set: false } ] },
      ],
      services: [
        { id: 'cineasterna', name: 'Cineasterna', tagline: 'Film från biblioteket', url: 'https://www.cineasterna.se/', search_url: 'https://www.cineasterna.se/sv/search?q={query}', color: '#b5122b', glyph: 'C' },
        { id: 'svtplay', name: 'SVT Play', tagline: 'Serier', url: 'https://www.svtplay.se/', search_url: 'https://www.svtplay.se/sok?q={query}', color: '#1f7a4d', glyph: 'S' },
        { id: 'plex', name: 'Plex', tagline: 'Egna filmer', url: 'http://plex.local:32400/web', color: '#c98a12', glyph: 'P' } ],
      service_fields: ['id', 'name', 'tagline', 'url', 'search_url', 'color', 'glyph', 'logo'],
    });
    if (path.startsWith('/api/wifi/networks')) return wait([
      { ssid: 'Lyresten', signal: 72, security: 'WPA2', active: true }, { ssid: 'Grannen', signal: 40, security: 'WPA2', active: false }, { ssid: 'Cafe', signal: 25, security: '', active: false } ], 900);
    if (path.startsWith('/api/bluetooth')) return wait([
      { mac: 'AA:BB:CC:DD:EE:01', name: 'Wireless Controller', connected: true, paired: true, trusted: true, battery: 65, icon: 'input-gaming' },
      { mac: 'AA:BB:CC:DD:EE:02', name: '8BitDo Pro 2', connected: false, paired: true, trusted: true, battery: null, icon: 'input-gaming' },
      { mac: 'AA:BB:CC:DD:EE:03', name: 'Xbox Wireless Controller', connected: false, paired: false, trusted: false, battery: null, icon: 'input-gaming' } ], path.includes('scan') ? 2000 : 300);
    if (path === '/api/logs') return wait('2026-09-10T07:00:01 pioneertv INFO pioneertv 0.1.0\n2026-09-10T07:00:02 pioneertv.cec INFO CEC registered as playback device\n');
    return wait({ ok: true, message: 'mock' });
  }

  // ---------------------------------------------------------------- helpers
  const bars = (sig) => sig == null ? '' : '####'.slice(0, Math.max(1, Math.round(sig / 25))).padEnd(4, '.');
  const icon = (name) => (window.PioneerTV && PioneerTV.icons) ? h('span', { class: 'item-icon' }, PioneerTV.icons.svg(name)) : h('span', { class: 'item-icon' }, '·');
  const dot = (cls) => h('span', { class: `dot ${cls}` });
  const fmtUptime = (s) => s == null ? '–' : (s >= 86400 ? `${Math.floor(s / 86400)} d ` : '') + `${Math.floor((s % 86400) / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  const kv = (pairs) => h('dl', { class: 'kv' }, pairs.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

  function confirmBtn(label, cls, fn) {
    let armed = false;
    const b = h('button', { class: cls, onclick: async () => {
      if (!armed) { armed = true; b.textContent = `${label} – tryck igen`; setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
      armed = false; b.textContent = label; await fn();
    } }, label);
    return b;
  }

  // ---------------------------------------------------------------- views
  const views = {
    async status(show) {
      const s = await api('GET', '/api/status');
      const w = s.wifi, t = s.tailscale, sys = s.system;
      const eth = (s.interfaces || []).find((i) => i.name.startsWith('e'));
      const wifiState = w.state === 'connected' ? 'ok' : w.available ? 'warn' : 'bad';
      const tsState = t.state === 'running' ? 'ok' : t.installed ? 'warn' : 'bad';
      show(
        h('h1', {}, 'Status'),
        h('div', { class: 'cards' },
          h('div', { class: 'card pioneertv-card' }, h('h3', {}, 'Nätverk'),
            h('div', { class: 'big' }, dot(wifiState), w.state === 'connected' ? `${w.ssid} ` : w.available ? 'Wi-Fi ej ansluten' : 'Ingen Wi-Fi', w.signal != null ? h('span', { class: 'bars muted' }, ` ${bars(w.signal)} ${w.signal}%`) : ''),
            kv([['Ethernet', eth && eth.addresses.length ? `${eth.addresses.join(', ')}` : 'ej ansluten'], ['Wi-Fi IP', ((s.interfaces || []).find((i) => i.name.startsWith('w')) || { addresses: [] }).addresses.join(', ') || '–']])),
          h('div', { class: 'card pioneertv-card' }, h('h3', {}, 'Tailscale'),
            h('div', { class: 'big' }, dot(tsState), t.state === 'running' ? 'Ansluten' : t.installed ? `Tailscale ${t.state}` : 'Ej installerat'),
            kv([['IP', (t.ips || []).join(', ') || '–'], ['Namn', t.dns_name || '–'], ['Plex', t.plex_online == null ? 'okänd (ingen peer med det namnet)' : t.plex_online ? h('span', {}, dot('ok'), 'online') : h('span', {}, dot('bad'), 'offline')], ['Peers', `${(t.peers || []).filter((p) => p.online).length} av ${(t.peers || []).length} online`]]),
            t.installed && t.state !== 'running' ? h('div', { class: 'actions' }, h('button', { class: 'small', onclick: () => sysAction('tailscale_up') }, 'Starta Tailscale')) : ''),
          h('div', { class: 'card pioneertv-card' }, h('h3', {}, 'TV (HDMI-CEC)'),
            h('div', { class: 'big' }, dot(s.cec.enabled ? (s.cec.tv_power === 'on' ? 'ok' : 'warn') : 'bad'), s.cec.enabled ? (s.cec.tv_power === 'on' ? 'TV på' : s.cec.tv_power ? `TV ${s.cec.tv_power}` : 'TV okänd') : 'CEC av'),
            kv([['Fysisk adress', s.cec.phys_addr || '–']]),
            h('div', { class: 'actions' },
              h('button', { class: 'small', onclick: () => cec('tv_on') }, 'TV på'),
              h('button', { class: 'small', onclick: () => cec('tv_off') }, 'TV av'),
              h('button', { class: 'small', onclick: () => cec('volume_up') }, 'Vol +'),
              h('button', { class: 'small', onclick: () => cec('volume_down') }, 'Vol −'))),
          h('div', { class: 'card pioneertv-card' }, h('h3', {}, 'Handkontroller'),
            s.gamepads.length ? h('div', { class: 'list' }, s.gamepads.map((g) => h('div', { class: 'item pioneertv-card-flat' }, icon('gamepad'), h('div', { class: 'grow' }, h('div', { class: 'name' }, g.name), h('div', { class: 'sub' }, g.battery != null ? `Batteri ${g.battery}%` : ''))))) : h('p', { class: 'muted' }, 'Ingen ansluten'),
            s.keyboard_present ? h('p', { class: 'muted' }, icon('keyboard'), ' Fysiskt tangentbord anslutet') : ''),
          h('div', { class: 'card pioneertv-card' }, h('h3', {}, 'System'),
            h('div', { class: 'big' }, dot(sys.throttled_now ? 'bad' : sys.throttled_ever ? 'warn' : 'ok'), sys.temp_c != null ? `${sys.temp_c} °C` : sys.hostname),
            kv([['Ström', sys.throttled == null ? 'okänd' : sys.throttled_now ? 'underspänning / strypt nu' : sys.throttled_ever ? 'har strypts sedan start' : 'ok'],
              ['Minne', sys.mem_total_mb ? `${sys.mem_available_mb} MB ledigt av ${sys.mem_total_mb}` : '–'],
              ['Last', sys.load1 != null ? sys.load1.toFixed(2) : '–'], ['Upptid', fmtUptime(sys.uptime_s)],
              ['Disk', sys.disk && sys.disk.total_mb ? `${Math.round(sys.disk.free_mb / 1024)} GB ledigt` : '–'],
              ['Visar', s.page || '–']])),
        ),
      );
    },

    async wifi(show) {
      show(h('h1', {}, 'Wi-Fi'), h('p', { class: 'muted spin' }, 'Söker nätverk…'));
      const nets = await api('GET', '/api/wifi/networks?rescan=1');
      const list = h('div', { class: 'list' });
      for (const n of nets) {
        const item = h('div', { class: 'item pioneertv-card' });
        const connectForm = h('div', { class: 'inline-form' });
        connectForm.hidden = true;
        const pw = h('input', { type: 'password', placeholder: 'Lösenord' });
        const connect = async () => {
          btn.disabled = true; btn.textContent = 'Ansluter…';
          try { const r = await api('POST', '/api/wifi/connect', { ssid: n.ssid, password: pw.value }); toast(r.ok ? `Ansluten till ${n.ssid}` : r.message); views.wifi(); }
          catch (e) { toast(`Misslyckades: ${e.message}`); btn.disabled = false; btn.textContent = 'Anslut'; }
        };
        pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
        connectForm.append(pw, h('button', { class: 'primary small', onclick: connect }, 'Anslut'));
        const btn = h('button', { class: 'small' + (n.active ? '' : ' primary'), onclick: () => {
          if (n.active) return;
          if (!n.security) return connect();
          connectForm.hidden = !connectForm.hidden;
          if (!connectForm.hidden) pw.focus();
        } }, n.active ? 'Ansluten' : 'Anslut');
        item.append(
          h('span', { class: 'bars' }, bars(n.signal)),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, n.ssid), h('div', { class: 'sub' }, `${n.signal}% · ${n.security || 'öppet'}`), connectForm),
          btn,
          n.active ? h('button', { class: 'small danger', onclick: async () => { await api('POST', '/api/wifi/forget', { ssid: n.ssid }); toast('Glömt'); views.wifi(); } }, 'Glöm') : '',
        );
        list.append(item);
      }
      show(h('h1', {}, 'Wi-Fi'), h('div', { class: 'actions' }, h('button', { onclick: () => views.wifi() }, 'Sök igen')), list.childElementCount ? list : h('p', { class: 'muted' }, 'Inga nätverk hittades (Ethernet är ändå att föredra för strömning).'));
    },

    async gamepads(show) {
      const draw = (devices, scanning) => {
        const list = h('div', { class: 'list' });
        for (const d of devices) {
          const state = d.connected ? 'Ansluten' : d.paired ? 'Parad, ej ansluten' : 'Ny enhet';
          list.append(h('div', { class: 'item pioneertv-card' },
            icon(d.icon === 'input-gaming' ? 'gamepad' : 'link'),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, d.name), h('div', { class: 'sub' }, `${state} · ${d.mac}${d.battery != null ? ` · batteri ${d.battery}%` : ''}`)),
            !d.paired ? h('button', { class: 'primary small', onclick: () => bt('pair', d, 'Parar…') }, 'Para') : '',
            d.paired && !d.connected ? h('button', { class: 'primary small', onclick: () => bt('connect', d, 'Ansluter…') }, 'Anslut') : '',
            d.connected ? h('button', { class: 'small', onclick: () => bt('disconnect', d) }, 'Koppla från') : '',
            d.paired ? confirmBtn('Ta bort', 'small danger', () => bt('remove', d)) : '',
          ));
        }
        show(
          h('h1', {}, 'Handkontroller'),
          h('p', { class: 'muted' }, 'Sätt kontrollen i parningsläge (PS: håll Share + PS. Xbox: håll parningsknappen. 8BitDo: håll Select), sök sedan.'),
          h('div', { class: 'actions' }, h('button', { class: 'primary' + (scanning ? ' spin' : ''), disabled: scanning ? '' : null, onclick: scan }, scanning ? 'Söker (8 s)…' : 'Sök efter enheter')),
          list.childElementCount ? list : h('p', { class: 'muted' }, 'Inga Bluetooth-enheter kända.'),
        );
      };
      const scan = async () => { draw(await api('GET', '/api/bluetooth/devices'), true); draw(await api('POST', '/api/bluetooth/scan', { seconds: 8 }), false); };
      const bt = async (action, d, busy) => {
        if (busy) toast(`${busy} ${d.name}`);
        try { const r = await api('POST', `/api/bluetooth/${action}`, { mac: d.mac }); toast(r.ok ? 'Klart' : r.message); }
        catch (e) { toast(`Misslyckades: ${e.message}`); }
        draw(await api('GET', '/api/bluetooth/devices'), false);
      };
      draw(await api('GET', '/api/bluetooth/devices'), false);
    },

    async services(show) {
      const s = await api('GET', '/api/settings');
      const services = s.services.map((x) => ({ ...x }));
      const fields = s.service_fields;
      const labels = { id: 'Id', name: 'Namn', tagline: 'Undertext', url: 'Startsida', search_url: 'Sök-URL ({query})', color: 'Färg (#hex)', glyph: 'Bokstav', logo: 'Logotyp-URL' };
      const wrap = h('div');
      const draw = () => {
        wrap.replaceChildren(...services.map((svc, i) => h('div', { class: 'service pioneertv-card', style: `--service-color:${svc.color || '#444'}` },
          fields.map((f) => h('div', {}, h('label', {}, labels[f] || f), h('input', { type: 'text', value: svc[f] || '', oninput: (e) => { svc[f] = e.target.value; if (f === 'color') e.target.closest('.service').style.setProperty('--service-color', svc.color); } }))),
          h('div', { class: 'svc-actions' },
            h('button', { class: 'small', disabled: i === 0 ? '' : null, onclick: () => { services.splice(i - 1, 0, services.splice(i, 1)[0]); draw(); } }, '▲'),
            h('button', { class: 'small', disabled: i === services.length - 1 ? '' : null, onclick: () => { services.splice(i + 1, 0, services.splice(i, 1)[0]); draw(); } }, '▼'),
            h('button', { class: 'small danger', onclick: () => { services.splice(i, 1); draw(); } }, 'Ta bort')),
        )));
      };
      draw();
      show(
        h('h1', {}, 'Tjänster'),
        h('p', { class: 'muted' }, 'Rutorna på startsidan. Ordningen här är ordningen på skärmen.'),
        wrap,
        h('div', { class: 'actions' },
          h('button', { onclick: () => { services.push({ name: '', url: 'https://', color: '#3a86ff', glyph: '' }); draw(); } }, '+ Lägg till'),
          h('button', { class: 'primary', onclick: async () => { try { await api('PUT', '/api/settings', { services }); toast('Sparat'); } catch (e) { toast(`Misslyckades: ${e.message}`); } } }, 'Spara')),
      );
    },

    async controls(show) { return schemaView(show, 'controls', 'Kontroller', h('p', { class: 'muted' }, 'Fullständig knappmappning finns i /etc/pioneer-tv/config.toml.')); },
    async tv(show) {
      return schemaView(show, 'tv', 'TV', h('div', { class: 'actions' },
        h('button', { onclick: () => cec('tv_on') }, 'TV på'), h('button', { onclick: () => cec('tv_off') }, 'TV av'),
        h('button', { onclick: () => cec('volume_up') }, 'Volym +'), h('button', { onclick: () => cec('volume_down') }, 'Volym −'),
        h('button', { onclick: () => cec('active_source') }, 'Byt till Pi-ingången')));
    },
    async remote(show) {
      const s = await api('GET', '/api/status');
      const t = s.tailscale;
      const url = t.dns_name ? `https://${t.dns_name}/` : (t.ips || [])[0] ? `http://${t.ips[0]}:8765/` : null;
      return schemaView(show, 'remote', 'Fjärråtkomst', h('div', {},
        h('h2', {}, 'Via Tailscale'),
        h('p', {}, 'Enklast: kör på Pi:n ', h('code', {}, 'sudo tailscale serve --bg 8765'), '. Då nås den här sidan från alla dina Tailscale-enheter på ', url ? h('a', { href: url }, url) : 'Pi:ns Tailscale-adress', ' utan öppna portar. Åtkomstnyckeln behövs bara om du binder daemonen till 0.0.0.0 i config.toml.'),
        h('h2', {}, 'Tangentbord'),
        h('p', { class: 'muted' }, 'Ett USB-tangentbord fungerar direkt; när ett är anslutet öppnas inte skärmtangentbordet automatiskt.')));
    },

    async system(show) {
      const logs = h('pre', { class: 'log' }, 'Hämtar…');
      const unit = h('select', { onchange: () => loadLogs() }, ['pioneer-tv-daemon', 'pioneer-tv-weston', 'bluetooth', 'NetworkManager', 'tailscaled'].map((u) => h('option', { value: u }, u)));
      const loadLogs = async () => { logs.textContent = await api('GET', `/api/logs?unit=${unit.value}&lines=150`); logs.scrollTop = logs.scrollHeight; };
      show(
        h('h1', {}, 'System'),
        h('div', { class: 'actions' },
          h('button', { onclick: () => sysAction('restart_ui') }, 'Starta om Chromium'),
          h('button', { onclick: () => sysAction('restart_daemon') }, 'Starta om daemon'),
          h('button', { onclick: () => sysAction('update') }, 'Uppdatera från git'),
          confirmBtn('Starta om Pi', 'danger', () => sysAction('reboot')),
          confirmBtn('Stäng av Pi', 'danger', () => sysAction('shutdown'))),
        h('h2', {}, 'Loggar'),
        h('div', { class: 'actions' }, unit, h('button', { class: 'small', onclick: loadLogs }, 'Uppdatera')),
        logs,
      );
      loadLogs();
    },
  };

  async function schemaView(show, id, title, extra) {
    const s = await api('GET', '/api/settings');
    const section = s.sections.find((x) => x.id === id);
    const values = {};
    const form = h('div');
    for (const f of section.fields) {
      let control;
      if (f.type === 'bool') {
        control = h('button', { class: 'toggle', role: 'switch', 'aria-checked': String(!!f.value), onclick: (e) => { const v = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', String(v)); values[f.path] = v; } });
      } else if (f.type === 'number') {
        const num = h('input', { type: 'number', min: f.min, max: f.max, step: f.step, value: f.value, oninput: (e) => { values[f.path] = Number(e.target.value); } });
        control = h('div', {}, num, f.unit ? h('span', { class: 'hint' }, ` ${f.unit}`) : '');
      } else {
        control = h('input', { type: f.secret ? 'password' : 'text', value: f.value ?? '', maxlength: f.maxlength, placeholder: f.secret && f.is_set ? '•••••••• (satt)' : '', oninput: (e) => { values[f.path] = e.target.value; } });
      }
      form.append(h('div', { class: 'field' }, h('label', {}, f.label), control));
    }
    show(
      h('h1', {}, title), form,
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: async () => { try { await api('PUT', '/api/settings', { values }); toast('Sparat'); } catch (e) { toast(`Misslyckades: ${e.message}`); } } }, 'Spara')),
      extra || '',
    );
  }

  async function cec(command) { try { await api('POST', '/api/cec', { command }); toast(`CEC: ${command}`); } catch (e) { toast(`CEC misslyckades: ${e.message}`); } }
  async function sysAction(action) { toast('Kör…'); try { const r = await api('POST', '/api/system', { action }); toast(r.ok ? 'Klart' : r.message); } catch (e) { toast(`Misslyckades: ${e.message}`); } }

  // ---------------------------------------------------------------- routing
  function route() {
    const view = (location.hash || '#status').slice(1);
    for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.view === view);
    // Each route renders into its own element, so a slow view from an earlier
    // route can never overwrite the current one.
    const gen = ++generation;
    const el = h('div');
    mainHost.replaceChildren(el);
    const show = (...children) => { if (gen === generation) el.replaceChildren(...children); };
    (views[view] || views.status)(show).catch((e) => { show(h('h1', {}, 'Fel'), h('p', {}, e.message)); });
  }
  window.addEventListener('hashchange', route);
  route();
  api('GET', '/api/status').then((s) => { $('#foot').textContent = `Maskinrepubliken · ${s.system.hostname} · v${s.version}${MOCK ? ' · mock' : ''}`; }).catch(() => {});
})();
