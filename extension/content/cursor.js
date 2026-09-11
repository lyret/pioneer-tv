// Pioneer TV virtual pointer.
//
// There is no Wayland pointer on the box: Weston 14 on the Pi 3 aborts the
// moment a client cursor reaches the hardware cursor plane. The daemon
// streams right-stick motion as "pointer" events instead, and this script
// draws a paper-style arrow, moves it, and delivers hover, clicks and
// edge-scrolling to whatever is under it. A (Enter) clicks while the pointer
// has been used within the last few seconds.
window.PioneerTV = window.PioneerTV || {};
(function (M) {
  const ARROW = '<svg viewBox="0 0 12 18" width="24" height="36" shape-rendering="crispEdges" aria-hidden="true">'
    + '<path fill="#f4edda" d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-5v1h1v1h1v1h1v1h1v1h-3v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v1h-1v1h-1v1h-1z"/>'
    + '<path fill="#2b2419" d="M1 1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-4v1h1v1h1v1h1v1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v1h-1v1h-1v1h-1z"/>'
    + '</svg>';
  const ACTIVE_MS = 5000;   // A clicks at the pointer this long after it last moved
  const EDGE = 28;          // px from the edge where the page scrolls
  const state = { x: 0, y: 0, lastMove: 0, hover: null, el: null, hideTimer: null, pressed: false, initialised: false };

  function ensure() {
    if (state.el && state.el.isConnected) return state.el;
    const el = document.createElement('div');
    el.className = 'pioneertv-cursor';
    el.setAttribute('data-pioneertv-overlay', '');
    el.innerHTML = ARROW;
    (document.documentElement || document.body).appendChild(el);
    state.el = el;
    if (!state.initialised) { state.x = Math.round(window.innerWidth / 2); state.y = Math.round(window.innerHeight / 2); state.initialised = true; }
    return el;
  }

  function draw() {
    const el = ensure();
    el.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
    el.classList.add('pioneertv-cursor-show');
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => el.classList.remove('pioneertv-cursor-show'), ACTIVE_MS);
  }

  function under() {
    const el = state.el;
    if (el) el.style.visibility = 'hidden';
    const t = document.elementFromPoint(state.x, state.y);
    if (el) el.style.visibility = '';
    return t;
  }

  function mouseInit(type, extra = {}) {
    return { bubbles: true, cancelable: true, composed: true, view: window, clientX: state.x, clientY: state.y, screenX: state.x, screenY: state.y, ...extra };
  }

  function fire(target, type, extra) {
    if (!target) return;
    const init = mouseInit(type, extra);
    if (window.PointerEvent && type.startsWith('mouse')) {
      target.dispatchEvent(new PointerEvent(type.replace('mouse', 'pointer'), { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    target.dispatchEvent(new MouseEvent(type, init));
  }

  function move(dx, dy) {
    ensure();
    state.x = Math.max(0, Math.min(window.innerWidth - 1, state.x + dx));
    state.y = Math.max(0, Math.min(window.innerHeight - 1, state.y + dy));
    state.lastMove = Date.now();
    draw();
    // Edge scrolling: pushing against the top or bottom moves the page.
    if (state.y >= window.innerHeight - EDGE && dy > 0) window.scrollBy(0, Math.max(8, dy * 3));
    else if (state.y <= EDGE && dy < 0) window.scrollBy(0, Math.min(-8, dy * 3));
    const t = under();
    if (t !== state.hover) {
      if (state.hover) { fire(state.hover, 'mouseout', { relatedTarget: t }); state.hover.classList && state.hover.classList.remove('pioneertv-hover'); }
      if (t) { fire(t, 'mouseover', { relatedTarget: state.hover }); fire(t, 'mouseenter'); }
      state.hover = t;
    }
    if (t) fire(t, 'mousemove');
  }

  function button(name, down) {
    const t = under();
    const which = name === 'right' ? 2 : 0;
    if (down) {
      state.pressed = true;
      ensure().classList.add('pioneertv-cursor-press');
      fire(t, 'mousedown', { button: which, buttons: which === 2 ? 2 : 1 });
      // Focus like a real click would, so typing and Enter go to the right place.
      const focusable = t && t.closest && t.closest('input, textarea, select, button, a[href], [tabindex], [contenteditable="true"]');
      if (focusable) { try { focusable.focus({ preventScroll: true }); } catch {} }
    } else {
      state.pressed = false;
      if (state.el) state.el.classList.remove('pioneertv-cursor-press');
      fire(t, 'mouseup', { button: which });
      if (which === 0) fire(t, 'click', { button: 0 });
      else fire(t, 'contextmenu', { button: 2 });
    }
  }

  M.cursor = {
    init() {
      const b = M.bridge;
      if (!b) return;
      b.on('pointer', (e) => move(Number(e.dx) || 0, Number(e.dy) || 0));
      b.on('pointer_button', (e) => button(e.button || 'left', !!e.down));
      // Also follow a real mouse, should one be attached (not on the Pi 3).
      window.addEventListener('mousemove', (e) => { if (e.isTrusted) { state.x = e.clientX; state.y = e.clientY; state.lastMove = Date.now(); draw(); } }, { capture: true, passive: true });
    },
    active() { return Date.now() - state.lastMove < ACTIVE_MS; },
    click() { button('left', true); setTimeout(() => button('left', false), 60); },
    position() { return { x: state.x, y: state.y }; },
  };
})(window.PioneerTV);
