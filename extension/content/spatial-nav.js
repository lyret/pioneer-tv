// Pioneer TV spatial navigation.
//
// Turns arrow keys into TV-style focus movement between links, buttons and
// inputs on any page. Geometric: from the focused element's box, pick the
// candidate in the pressed direction whose box is nearest, preferring ones
// that overlap on the cross axis. Works on pages that never planned for it.
window.PioneerTV = window.PioneerTV || {};
(function (M) {
  const FOCUSABLE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'video', 'audio',
    '[tabindex]:not([tabindex="-1"])', '[role="button"]', '[role="link"]',
    '[role="menuitem"]', '[role="option"]', '[role="tab"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]', '[role="slider"]', '[contenteditable="true"]',
  ].join(',');
  const TEXT_INPUT = /^(text|search|email|url|number|password|tel)$/;
  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const FOCUS_CLASS = 'pioneertv-focus';

  const nav = {
    enabled: true,
    current: null,
    // Layers (keyboard, menu) that take over the arrow keys while open.
    captured: null,

    isTextField(el) {
      if (!el) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === 'TEXTAREA') return true;
      return el.tagName === 'INPUT' && TEXT_INPUT.test(el.type || 'text');
    },

    isVisible(el) {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) return false;
      if (el.closest('[aria-hidden="true"], [inert], [data-pioneertv-overlay]')) return false;
      if (r.bottom < -window.innerHeight || r.top > window.innerHeight * 2) return false; // far off screen
      if (r.right < 0 || r.left > window.innerWidth) return false;
      return true;
    },

    candidates() {
      const out = [];
      for (const el of document.querySelectorAll(FOCUSABLE)) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        if (!this.isVisible(el)) continue;
        // Skip elements wrapped by another focusable (icon inside a button).
        const parent = el.parentElement && el.parentElement.closest(FOCUSABLE);
        if (parent && el.tagName !== 'INPUT' && this.rectContains(parent.getBoundingClientRect(), el.getBoundingClientRect())) continue;
        out.push(el);
      }
      return out;
    },

    rectContains(a, b) { return b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1; },

    // Best next element in direction from rect `from`.
    pick(from, dir, list) {
      let best = null, bestScore = Infinity;
      const fcx = (from.left + from.right) / 2, fcy = (from.top + from.bottom) / 2;
      for (const el of list) {
        const r = el.getBoundingClientRect();
        let main, cross;
        if (dir === 'left') { main = from.left - r.right; cross = this.gap(r.top, r.bottom, from.top, from.bottom); }
        else if (dir === 'right') { main = r.left - from.right; cross = this.gap(r.top, r.bottom, from.top, from.bottom); }
        else if (dir === 'up') { main = from.top - r.bottom; cross = this.gap(r.left, r.right, from.left, from.right); }
        else { main = r.top - from.bottom; cross = this.gap(r.left, r.right, from.left, from.right); }
        // Allow slight overlap on the main axis (rows of cards with padding).
        if (main < -Math.min(from.width, from.height, r.width, r.height) * 0.4) continue;
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        const centerDrift = (dir === 'left' || dir === 'right') ? Math.abs(cy - fcy) : Math.abs(cx - fcx);
        const score = Math.max(main, 0) * 1.0 + cross * 3.0 + centerDrift * 0.4;
        if (score < bestScore) { bestScore = score; best = el; }
      }
      return best;
    },

    gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); },

    focus(el, opts = {}) {
      if (!el) return;
      const prev = this.current;
      if (prev && prev !== el) prev.classList.remove(FOCUS_CLASS);
      this.current = el;
      el.classList.add(FOCUS_CLASS);
      if (!el.hasAttribute('tabindex') && !el.matches('a[href],button,input,select,textarea,summary,video,audio,[contenteditable="true"]')) {
        el.setAttribute('tabindex', '-1');
      }
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      if (opts.scroll !== false) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      M.bridge && M.bridge.emit('nav:focus', el);
    },

    move(dir) {
      const list = this.candidates();
      if (!list.length) return false;
      let cur = this.current && this.isVisible(this.current) ? this.current : document.activeElement;
      if (!cur || cur === document.body || !this.isVisible(cur)) {
        this.focus(this.initial(list));
        return true;
      }
      const next = this.pick(cur.getBoundingClientRect(), dir, list.filter((e) => e !== cur));
      if (next) { this.focus(next); return true; }
      // Nothing that way: scroll so lazy-loaded rows appear, then try again.
      if (dir === 'down' || dir === 'up') {
        window.scrollBy({ top: (dir === 'down' ? 1 : -1) * window.innerHeight * 0.6, behavior: 'auto' });
        setTimeout(() => {
          const again = this.pick(cur.getBoundingClientRect(), dir, this.candidates().filter((e) => e !== cur));
          if (again) this.focus(again);
        }, 120);
      }
      return false;
    },

    initial(list) {
      const marked = document.querySelector('[data-pioneertv-initial], [autofocus]');
      if (marked && this.isVisible(marked)) return marked;
      // Top-most element that is inside the viewport, tie-break left-most.
      let best = null, bs = Infinity;
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const s = r.top * 2 + r.left;
        if (s < bs) { bs = s; best = el; }
      }
      return best || list[0];
    },

    // Enter on div-based "buttons" that only react to click.
    activate(el) {
      if (!el) return false;
      if (el.matches('a[href],button,input,select,textarea,summary')) return false;
      el.click();
      return true;
    },

    onKeyDown(e) {
      if (!this.enabled || !e.isTrusted) return; // synthetic events come from our own keyboard
      if (this.captured) { this.captured.onKeyDown(e); return; }
      const active = document.activeElement;
      const dir = DIRS[e.key];
      if (dir) {
        if (this.isTextField(active) && (dir === 'left' || dir === 'right')) return; // caret movement
        if (active && (active.tagName === 'VIDEO' || active.tagName === 'AUDIO' || active.type === 'range' || active.getAttribute('role') === 'slider')) {
          if (dir === 'left' || dir === 'right') return; // seek / slider
        }
        if (active && active.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.move(dir);
        return;
      }
      if (e.key === 'Enter') {
        if (this.isTextField(active)) {
          if (M.bridge && M.bridge.autoKeyboard() && M.keyboard && !M.keyboard.isOpen()) {
            e.preventDefault(); e.stopImmediatePropagation();
            M.keyboard.open(active);
          }
          return;
        }
        if (this.activate(active)) { e.preventDefault(); e.stopImmediatePropagation(); }
        return;
      }
      if (e.key === 'Escape' && this.isTextField(active)) {
        active.blur();
      }
    },

    init() {
      window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
      document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (el === this.current || !(el instanceof Element)) return;
        if (this.current) this.current.classList.remove(FOCUS_CLASS);
        this.current = el;
        el.classList.add(FOCUS_CLASS);
      });
      // Real pointer (right stick) clicks: keep our ring on the clicked thing.
      document.addEventListener('click', (e) => {
        if (M.bridge && M.bridge.autoKeyboard() && this.isTextField(e.target) && M.keyboard && !M.keyboard.isOpen()) M.keyboard.open(e.target);
      }, true);
    },
  };

  M.nav = nav;
})(window.PioneerTV);
