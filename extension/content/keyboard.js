// Pioneer TV on-screen keyboard.
//
// A bottom sheet driven by the d-pad. It never takes focus itself: the target
// field keeps focus and its caret, and we write into it in a way React-style
// controlled inputs notice.
window.PioneerTV = window.PioneerTV || {};
(function (M) {
  const LAYERS = {
    letters: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'å'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
      [{ k: 'shift', label: '⇧', w: 1.5 }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', { k: 'backspace', label: '⌫', w: 1.5 }],
      [{ k: 'layer:symbols', label: '?123', w: 2 }, { k: 'space', label: 'mellanslag', w: 6 }, { k: 'left', label: '‹', w: 1 }, { k: 'right', label: '›', w: 1 }, { k: 'done', label: 'Sök', w: 2, accent: true }],
    ],
    symbols: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '='],
      ['@', '#', '&', '_', '-', '+', '(', ')', '/', "'", '"'],
      [{ k: 'shift', label: '⇧', w: 1.5 }, '!', '?', ':', ';', '*', '%', '$', '€', '~', { k: 'backspace', label: '⌫', w: 1.5 }],
      [{ k: 'layer:letters', label: 'ABC', w: 2 }, { k: 'space', label: 'mellanslag', w: 6 }, { k: 'left', label: '‹', w: 1 }, { k: 'right', label: '›', w: 1 }, { k: 'done', label: 'Sök', w: 2, accent: true }],
    ],
  };

  const kb = {
    root: null, target: null, layer: 'letters', shift: false, row: 0, col: 0, buttons: [],

    isOpen() { return !!(this.root && this.root.isConnected); },

    open(target) {
      if (!target) return;
      if (this.isOpen()) this.close();
      this.target = target;
      this.layer = 'letters';
      this.shift = false;
      this.build();
      this.row = 1; this.col = 0;
      this.highlight();
      M.nav.captured = this;
      document.documentElement.classList.add('pioneertv-keyboard-open');
      try { this.target.scrollIntoView({ block: 'start' }); } catch {}
      M.bridge && M.bridge.emit('keyboard:open');
    },

    close() {
      if (this.root) this.root.remove();
      this.root = null;
      if (M.nav.captured === this) M.nav.captured = null;
      document.documentElement.classList.remove('pioneertv-keyboard-open');
      M.bridge && M.bridge.emit('keyboard:close');
    },

    toggle() {
      if (this.isOpen()) return this.close();
      const active = document.activeElement;
      if (M.nav.isTextField(active)) return this.open(active);
      const first = document.querySelector('input[type="search"], input[type="text"], textarea');
      if (first) { M.nav.focus(first); this.open(first); }
      else M.hud && M.hud.toast('Inget textfält på sidan', '⌨');
    },

    build() {
      const root = document.createElement('div');
      root.className = 'pioneertv-keyboard';
      root.setAttribute('data-pioneertv-overlay', '');
      root.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field
      const rows = LAYERS[this.layer];
      this.buttons = rows.map((row, ri) => row.map((key, ci) => {
        const def = typeof key === 'string' ? { k: key, label: key, w: 1 } : key;
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.className = 'pioneertv-key' + (def.accent ? ' pioneertv-key-accent' : '');
        b.style.flexGrow = String(def.w || 1);
        b.style.flexBasis = '0';
        b.textContent = this.displayLabel(def);
        b.dataset.key = def.k;
        b.addEventListener('click', () => { this.row = ri; this.col = ci; this.highlight(); this.press(def); });
        return { def, el: b };
      }));
      for (const row of this.buttons) {
        const r = document.createElement('div');
        r.className = 'pioneertv-keyrow';
        for (const { el } of row) r.appendChild(el);
        root.appendChild(r);
      }
      const hint = document.createElement('div');
      hint.className = 'pioneertv-keyhint';
      hint.textContent = 'A: skriv   B: stäng   Y: tangentbord';
      root.appendChild(hint);
      document.documentElement.appendChild(root);
      this.root = root;
    },

    displayLabel(def) {
      if (def.k.length === 1 && /[a-zåäö]/i.test(def.k)) return this.shift ? def.k.toUpperCase() : def.k;
      return def.label;
    },

    refreshLabels() {
      for (const row of this.buttons) for (const { def, el } of row) el.textContent = this.displayLabel(def);
    },

    highlight() {
      for (const row of this.buttons) for (const { el } of row) el.classList.remove('pioneertv-key-active');
      const row = this.buttons[this.row];
      this.col = Math.max(0, Math.min(this.col, row.length - 1));
      row[this.col].el.classList.add('pioneertv-key-active');
    },

    // Move between rows by horizontal position so wide keys line up.
    moveRow(delta) {
      const from = this.buttons[this.row][this.col].el.getBoundingClientRect();
      const cx = (from.left + from.right) / 2;
      const nr = (this.row + delta + this.buttons.length) % this.buttons.length;
      let best = 0, bd = Infinity;
      this.buttons[nr].forEach(({ el }, i) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs((r.left + r.right) / 2 - cx);
        if (d < bd) { bd = d; best = i; }
      });
      this.row = nr; this.col = best;
      this.highlight();
    },

    onKeyDown(e) {
      const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
      if (!handled.includes(e.key)) return; // real keyboard keys type into the field directly
      e.preventDefault(); e.stopImmediatePropagation();
      switch (e.key) {
        case 'ArrowUp': this.moveRow(-1); break;
        case 'ArrowDown': this.moveRow(1); break;
        case 'ArrowLeft': this.col = (this.col - 1 + this.buttons[this.row].length) % this.buttons[this.row].length; this.highlight(); break;
        case 'ArrowRight': this.col = (this.col + 1) % this.buttons[this.row].length; this.highlight(); break;
        case 'Enter': this.press(this.buttons[this.row][this.col].def); break;
        case 'Escape': this.close(); break;
      }
    },

    press(def) {
      const k = def.k;
      if (k === 'shift') { this.shift = !this.shift; this.refreshLabels(); return; }
      if (k.startsWith('layer:')) { this.layer = k.slice(6); const r = this.row, c = this.col; this.root.remove(); this.build(); this.row = r; this.col = c; this.highlight(); return; }
      if (k === 'backspace') return this.backspace();
      if (k === 'space') return this.insert(' ');
      if (k === 'left' || k === 'right') return this.moveCaret(k === 'left' ? -1 : 1);
      if (k === 'done') return this.done();
      let ch = k;
      if (this.shift && ch.length === 1) { ch = ch.toUpperCase(); this.shift = false; this.refreshLabels(); }
      this.insert(ch);
    },

    // ------------------------------------------------------------- editing
    setValue(el, value, caret, inputType, data) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      try { el.setSelectionRange(caret, caret); } catch {}
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
    },

    insert(text) {
      const el = this.target;
      if (!el || !el.isConnected) return this.close();
      if (el.isContentEditable) { el.focus(); document.execCommand('insertText', false, text); return; }
      let s = el.selectionStart, e = el.selectionEnd;
      if (s == null) { s = e = el.value.length; }
      this.setValue(el, el.value.slice(0, s) + text + el.value.slice(e), s + text.length, 'insertText', text);
    },

    backspace() {
      const el = this.target;
      if (!el || !el.isConnected) return this.close();
      if (el.isContentEditable) { el.focus(); document.execCommand('delete'); return; }
      let s = el.selectionStart, e = el.selectionEnd;
      if (s == null) { s = e = el.value.length; }
      if (s === e && s > 0) s -= 1;
      this.setValue(el, el.value.slice(0, s) + el.value.slice(e), s, 'deleteContentBackward', null);
    },

    moveCaret(delta) {
      const el = this.target;
      if (!el || el.selectionStart == null) return;
      const p = Math.max(0, Math.min(el.value.length, el.selectionStart + delta));
      try { el.setSelectionRange(p, p); } catch {}
    },

    done() {
      const el = this.target;
      this.close();
      if (!el) return;
      el.focus();
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      const down = new KeyboardEvent('keydown', opts);
      el.dispatchEvent(down);
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      if (!down.defaultPrevented && el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
    },
  };

  M.keyboard = kb;
})(window.PioneerTV);
