// Pioneer TV HUD: toasts and the quick menu (Start button).
window.PioneerTV = window.PioneerTV || {};
(function (M) {
  const hud = {
    toastEl: null, toastTimer: null,

    toast(text, icon = '', ms = 1800) {
      if (!this.toastEl) {
        this.toastEl = document.createElement('div');
        this.toastEl.className = 'pioneertv-toast pioneertv-card';
        this.toastEl.setAttribute('data-pioneertv-overlay', '');
        document.documentElement.appendChild(this.toastEl);
      }
      this.toastEl.innerHTML = '';
      if (icon) { const i = document.createElement('span'); i.className = 'pioneertv-toast-icon'; i.appendChild(M.icons.svg(M.icons.names.includes(icon) ? icon : 'info')); this.toastEl.appendChild(i); }
      const t = document.createElement('span'); t.textContent = text; this.toastEl.appendChild(t);
      this.toastEl.classList.add('pioneertv-toast-show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toastEl.classList.remove('pioneertv-toast-show'), ms);
    },

    menu: {
      root: null, index: 0, items: [],
      isOpen() { return !!(this.root && this.root.isConnected); },
      toggle() { this.isOpen() ? this.close() : this.open(); },
      open() {
        if (M.keyboard && M.keyboard.isOpen()) M.keyboard.close();
        const b = M.bridge;
        const tv = b && b.state.daemonConnected;
        this.items = [
          { label: 'Hem', icon: 'home', run: () => b.home() },
          { label: 'Inställningar', icon: 'gear', run: () => b.settings() },
          { label: 'Tangentbord', icon: 'keyboard', run: () => M.keyboard.toggle() },
          { label: 'Tillbaka', icon: 'back', run: () => (b.available ? b.send({ type: 'back' }) : history.back()) },
          { label: 'Ladda om sidan', icon: 'reload', run: () => location.reload() },
          { label: 'Volym +', icon: 'volume', run: () => b.cec('volume_up'), keep: true, disabled: !tv },
          { label: 'Volym −', icon: 'mute', run: () => b.cec('volume_down'), keep: true, disabled: !tv },
          { label: 'Stäng av TV', icon: 'power', run: () => b.cec('tv_off'), disabled: !tv },
        ];
        const root = document.createElement('div');
        root.className = 'pioneertv-menu';
        root.setAttribute('data-pioneertv-overlay', '');
        const panel = document.createElement('div');
        panel.className = 'pioneertv-menu-panel';
        const title = document.createElement('div');
        title.className = 'pioneertv-menu-title';
        title.textContent = 'PIONEER TV';
        panel.appendChild(title);
        panel.appendChild(this.statusBlock(b.state.status, tv));
        this.items.forEach((it, i) => {
          const el = document.createElement('div');
          el.className = 'pioneertv-menu-item' + (it.disabled ? ' pioneertv-menu-disabled' : '');
          el.innerHTML = `<span class="pioneertv-menu-icon">${M.icons.html(it.icon)}</span><span>${it.label}</span>`;
          el.addEventListener('click', () => { this.index = i; this.activate(); });
          it.el = el;
          panel.appendChild(el);
        });
        const hint = document.createElement('div');
        hint.className = 'pioneertv-keyhint';
        hint.textContent = 'A välj · B stäng';
        panel.appendChild(hint);
        root.appendChild(panel);
        document.documentElement.appendChild(root);
        this.root = root;
        this.index = 0;
        this.highlight();
        M.nav.captured = this;
      },
      close() {
        if (this.root) this.root.remove();
        this.root = null;
        if (M.nav.captured === this) M.nav.captured = null;
      },
      // Compact status rows at the top of the menu: Wi-Fi, Tailscale, pads, temperature.
      statusBlock(s, connected) {
        const box = document.createElement('div');
        box.className = 'pioneertv-menu-status';
        const row = (cls, icon, text) => {
          const r = document.createElement('div');
          r.className = 'pioneertv-menu-statusrow';
          r.innerHTML = `<span class="pioneertv-menu-dot ${cls}"></span><span class="pioneertv-menu-icon">${M.icons.html(icon)}</span><span></span>`;
          r.lastElementChild.textContent = text;
          box.appendChild(r);
        };
        if (!connected || !s) { row('bad', 'dot', connected ? 'Väntar på status…' : 'Ingen daemon (designläge)'); return box; }
        const w = s.wifi || {}, t = s.tailscale || {}, sys = s.system || {};
        const eth = (s.interfaces || []).find((i) => i.name.startsWith('e') && i.addresses.length);
        if (w.state === 'connected') row('ok', 'wifi', `${w.ssid}${w.signal != null ? ` ${w.signal}%` : ''}`);
        else if (eth) row('ok', 'ethernet', `Ethernet ${eth.addresses[0]}`);
        else row('bad', 'wifi', 'Inget nätverk');
        if (t.state === 'running') row(t.plex_online === false ? 'warn' : 'ok', 'link', `Tailscale${t.plex_online != null ? (t.plex_online ? ' · Plex online' : ' · Plex offline') : ''}`);
        else row(t.installed ? 'warn' : 'bad', 'link', t.installed ? `Tailscale ${t.state}` : 'Tailscale saknas');
        const pads = s.gamepads || [];
        row(pads.length ? 'ok' : 'warn', 'gamepad', pads.length ? pads.map((p) => p.name + (p.battery != null ? ` ${p.battery}%` : '')).join(', ') : 'Ingen handkontroll');
        row(sys.throttled_now ? 'bad' : sys.throttled_ever ? 'warn' : 'ok', 'temp', `${sys.temp_c != null ? sys.temp_c + ' °C' : '–'}${sys.throttled_now ? ' · underspänning' : ''}`);
        return box;
      },
      highlight() { this.items.forEach((it, i) => it.el.classList.toggle('pioneertv-menu-active', i === this.index)); },
      activate() {
        const it = this.items[this.index];
        if (!it || it.disabled) return;
        if (!it.keep) this.close();
        it.run();
      },
      onKeyDown(e) {
        const handled = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'];
        if (!handled.includes(e.key)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key === 'ArrowUp') { this.index = (this.index - 1 + this.items.length) % this.items.length; this.highlight(); }
        else if (e.key === 'ArrowDown') { this.index = (this.index + 1) % this.items.length; this.highlight(); }
        else if (e.key === 'Enter') this.activate();
        else this.close();
      },
    },
  };

  M.hud = hud;
})(window.PioneerTV);
