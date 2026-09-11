// Pioneer TV software pointer: a paper-style arrow that follows the real
// mouse position. The system cursor is hidden everywhere (cursor.css) because
// Weston crashes on this GPU when a hardware cursor is shown. Hover and
// clicks are still native; only the picture is ours.
window.PioneerTV = window.PioneerTV || {};
(function (M) {
  const ARROW = '<svg viewBox="0 0 12 18" width="24" height="36" shape-rendering="crispEdges" aria-hidden="true">'
    + '<path fill="#f4edda" d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-5v1h1v1h1v1h1v1h1v1h-3v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v1h-1v1h-1v1h-1z"/>'
    + '<path fill="#2b2419" d="M1 1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-4v1h1v1h1v1h1v1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v1h-1v1h-1v1h-1z"/>'
    + '</svg>';
  let el = null, hideTimer = null;

  function ensure() {
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.className = 'pioneertv-cursor';
    el.setAttribute('data-pioneertv-overlay', '');
    el.innerHTML = ARROW;
    (document.documentElement || document.body).appendChild(el);
    return el;
  }

  function onMove(e) {
    const c = ensure();
    c.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    c.classList.add('pioneertv-cursor-show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => c.classList.remove('pioneertv-cursor-show'), 4000);
  }

  M.cursor = {
    init() {
      window.addEventListener('mousemove', onMove, { capture: true, passive: true });
      window.addEventListener('mousedown', () => { const c = ensure(); c.classList.add('pioneertv-cursor-press'); }, true);
      window.addEventListener('mouseup', () => { const c = ensure(); c.classList.remove('pioneertv-cursor-press'); }, true);
    },
  };
})(window.PioneerTV);
