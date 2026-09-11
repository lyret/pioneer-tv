// Pioneer TV log viewer: a paper sheet over the current page showing journal
// output from the daemon's /api/logs. Left/Right switch unit, Up/Down scroll,
// A refreshes, B closes.
window.PioneerTV = window.PioneerTV || {};
(function (M) {
  const UNITS = [
    ['pioneer-tv-daemon', 'Daemon'],
    ['pioneer-tv-weston', 'Skärm'],
    ['chromium', 'Chromium'],
    ['pioneer-tv-update', 'Uppdatering'],
    ['bluetooth', 'Bluetooth'],
    ['NetworkManager', 'Nätverk'],
    ['tailscaled', 'Tailscale'],
    ['cec', 'CEC'],
  ];

  const logs = {
    root: null, pre: null, tabs: [], index: 0, timer: null,

    isOpen() { return !!(this.root && this.root.isConnected); },
    toggle() { this.isOpen() ? this.close() : this.open(); },

    open(unitIndex = this.index) {
      if (this.isOpen()) this.close();
      if (M.hud && M.hud.menu.isOpen()) M.hud.menu.close();
      this.index = unitIndex;
      const root = document.createElement('div');
      root.className = 'pioneertv-logs';
      root.setAttribute('data-pioneertv-overlay', '');
      const sheet = document.createElement('div');
      sheet.className = 'pioneertv-logs-sheet';
      const head = document.createElement('div');
      head.className = 'pioneertv-logs-head';
      const title = document.createElement('div');
      title.className = 'pioneertv-logs-title';
      title.textContent = 'Loggar';
      head.appendChild(title);
      const tabs = document.createElement('div');
      tabs.className = 'pioneertv-logs-tabs';
      this.tabs = UNITS.map(([unit, label], i) => {
        const t = document.createElement('span');
        t.className = 'pioneertv-logs-tab';
        t.textContent = label;
        t.addEventListener('click', () => { this.index = i; this.refresh(); });
        tabs.appendChild(t);
        return t;
      });
      head.appendChild(tabs);
      sheet.appendChild(head);
      const pre = document.createElement('pre');
      pre.className = 'pioneertv-logs-body';
      sheet.appendChild(pre);
      const hint = document.createElement('div');
      hint.className = 'pioneertv-keyhint';
      hint.innerHTML = `${M.icons.html('arrowLeft')} ${M.icons.html('arrowRight')} enhet · ${M.icons.html('arrowUp')} ${M.icons.html('arrowDown')} bläddra · A uppdatera · B stäng`;
      sheet.appendChild(hint);
      root.appendChild(sheet);
      document.documentElement.appendChild(root);
      this.root = root;
      this.pre = pre;
      M.nav.captured = this;
      this.refresh();
    },

    close() {
      clearTimeout(this.timer);
      if (this.root) this.root.remove();
      this.root = null;
      if (M.nav.captured === this) M.nav.captured = null;
    },

    async refresh() {
      clearTimeout(this.timer);
      this.tabs.forEach((t, i) => t.classList.toggle('pioneertv-logs-tab-active', i === this.index));
      const unit = UNITS[this.index][0];
      this.pre.textContent = 'Hämtar…';
      try {
        const text = await M.bridge.api('GET', unit === 'cec' ? '/api/cec/trace' : `/api/logs?unit=${encodeURIComponent(unit)}&lines=200`);
        if (!this.isOpen() || UNITS[this.index][0] !== unit) return;
        this.pre.textContent = text || '(tomt)';
      } catch (e) {
        if (!this.isOpen()) return;
        this.pre.textContent = `Kunde inte hämta loggen: ${e.message}\n\nDaemonen svarar inte på http://127.0.0.1:8765.`;
      }
      this.pre.scrollTop = this.pre.scrollHeight;
      // Follow the daemon log live; the others on demand.
      if (unit === 'pioneer-tv-daemon' || unit === 'cec') this.timer = setTimeout(() => this.refresh(), unit === 'cec' ? 2000 : 5000);
    },

    onKeyDown(e) {
      const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'PageUp', 'PageDown'];
      if (!handled.includes(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const step = this.pre.clientHeight * 0.6;
      switch (e.key) {
        case 'ArrowLeft': this.index = (this.index - 1 + UNITS.length) % UNITS.length; this.refresh(); break;
        case 'ArrowRight': this.index = (this.index + 1) % UNITS.length; this.refresh(); break;
        case 'ArrowUp': case 'PageUp': this.pre.scrollTop -= step; break;
        case 'ArrowDown': case 'PageDown': this.pre.scrollTop += step; break;
        case 'Enter': this.refresh(); break;
        case 'Escape': this.close(); break;
      }
    },
  };

  M.logs = logs;
})(window.PioneerTV);
