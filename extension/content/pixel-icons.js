// Pioneer TV pixel icons: 8x8 bitmaps rendered as crisp inline SVG.
// Usage: PioneerTV.icons.svg('wifi') → <svg> element; PioneerTV.icons.html('wifi') → string.
window.PioneerTV = window.PioneerTV || {};
(function (P) {
  const BITMAPS = {
    wifi: [
      '..XXXX..',
      '.X....X.',
      'X.XXXX.X',
      '.X....X.',
      '..XXXX..',
      '.X....X.',
      '...XX...',
      '...XX...'],
    ethernet: [
      '..XXXX..',
      '..X..X..',
      'XXXXXXXX',
      'X......X',
      'X.XXXX.X',
      'X.X..X.X',
      'X.X..X.X',
      'XXXXXXXX'],
    link: [
      '..XXX...',
      '.X...X..',
      'X.....X.',
      'X..X..X.',
      '.X.X.X..',
      '..XXX...',
      '...X....',
      '...X....'],
    gamepad: [
      '........',
      '.XXXXXX.',
      'XXXXXXXX',
      'X.XXXX.X',
      'XXXXXXXX',
      'XX.XX.XX',
      'XX....XX',
      '.X....X.'],
    temp: [
      '...XX...',
      '..X..X..',
      '..X.XX..',
      '..X..X..',
      '..X.XX..',
      '.X....X.',
      '.X.XX.X.',
      '..XXXX..'],
    home: [
      '...XX...',
      '..XXXX..',
      '.XXXXXX.',
      'XXXXXXXX',
      '.XXXXXX.',
      '.XX..XX.',
      '.XX..XX.',
      '.XX..XX.'],
    gear: [
      '..X..X..',
      '.XXXXXX.',
      'XXX..XXX',
      '.X....X.',
      '.X....X.',
      'XXX..XXX',
      '.XXXXXX.',
      '..X..X..'],
    keyboard: [
      '........',
      'XXXXXXXX',
      'X.X.X.XX',
      'XXXXXXXX',
      'XX.X.X.X',
      'XXXXXXXX',
      'X.XXXX.X',
      'XXXXXXXX'],
    back: [
      '...X....',
      '..XX....',
      '.XXXXXXX',
      'XXXXXXXX',
      '.XXXXXXX',
      '..XX....',
      '...X....',
      '........'],
    reload: [
      '..XXXX..',
      '.X....X.',
      'X......X',
      '.......X',
      '....X..X',
      '....XX.X',
      '....XXXX',
      '........'],
    power: [
      '...XX...',
      '.X.XX.X.',
      'X..XX..X',
      'X..XX..X',
      'X......X',
      'X......X',
      '.X....X.',
      '..XXXX..'],
    search: [
      '..XXX...',
      '.X...X..',
      'X.....X.',
      'X.....X.',
      'X.....X.',
      '.X...XX.',
      '..XXX.XX',
      '.......X'],
    menu: [
      '........',
      'XXXXXXXX',
      '........',
      'XXXXXXXX',
      '........',
      'XXXXXXXX',
      '........',
      '........'],
    volume: [
      '...X..X.',
      '..XX.X.X',
      'XXXX.X.X',
      'XXXX.X.X',
      'XXXX.X.X',
      '..XX.X.X',
      '...X..X.',
      '........'],
    mute: [
      '...X....',
      '..XX.X.X',
      'XXXX..X.',
      'XXXX..X.',
      'XXXX.X.X',
      '..XX....',
      '...X....',
      '........'],
    tv: [
      'X......X',
      '.X....X.',
      'XXXXXXXX',
      'X......X',
      'X......X',
      'X......X',
      'XXXXXXXX',
      '..X..X..'],
    check: [
      '........',
      '.......X',
      '......XX',
      'X....XX.',
      'XX..XX..',
      '.XXXX...',
      '..XX....',
      '........'],
    info: [
      '..XXXX..',
      '.X....X.',
      'X..XX..X',
      'X......X',
      'X..XX..X',
      'X..XX..X',
      '.X....X.',
      '..XXXX..'],
    shift: [
      '...XX...',
      '..XXXX..',
      '.XXXXXX.',
      'XXXXXXXX',
      '..XXXX..',
      '..XXXX..',
      '..XXXX..',
      '........'],
    backspace: [
      '........',
      '..XXXXXX',
      '.X.....X',
      'X.X.X..X',
      'X..X...X',
      'X.X.X..X',
      '.X.....X',
      '..XXXXXX'],
    dot: [
      '........',
      '........',
      '...XX...',
      '..XXXX..',
      '..XXXX..',
      '...XX...',
      '........',
      '........'],
    arrowUp: ['...X....', '..XXX...', '.XXXXX..', 'XXXXXXX.', '...X....', '...X....', '...X....', '........'],
    arrowDown: ['...X....', '...X....', '...X....', 'XXXXXXX.', '.XXXXX..', '..XXX...', '...X....', '........'],
    arrowLeft: ['...X....', '..XX....', '.XXXXXX.', 'XXXXXXX.', '.XXXXXX.', '..XX....', '...X....', '........'],
    arrowRight: ['....X...', '....XX..', '.XXXXXX.', '.XXXXXXX', '.XXXXXX.', '....XX..', '....X...', '........'],
  };

  const cache = {};

  function path(name) {
    if (cache[name]) return cache[name];
    const rows = BITMAPS[name] || BITMAPS.dot;
    let d = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === 'X') d += `M${x} ${y}h1v1h-1z`;
    });
    return (cache[name] = d);
  }

  function html(name, cls = '') {
    return `<svg class="pioneertv-icon ${cls}" viewBox="0 0 8 8" width="1em" height="1em" aria-hidden="true" shape-rendering="crispEdges"><path d="${path(name)}" fill="currentColor"/></svg>`;
  }

  function svg(name, cls = '') {
    const tpl = document.createElement('template');
    tpl.innerHTML = html(name, cls);
    return tpl.content.firstElementChild;
  }

  P.icons = { html, svg, names: Object.keys(BITMAPS) };
})(window.PioneerTV);
