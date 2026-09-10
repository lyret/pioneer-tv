// Pioneer TV service illustrations: ink line art with a halftone fill in the
// service colour. Keyed by service id; anything unknown gets the ticket.
// A service with a `logo` URL in its config uses that image instead.
window.PioneerTV = window.PioneerTV || {};
(function (P) {
  const INK = '#2b2419';
  const PAPER = '#f4edda';

  function wrap(id, color, body) {
    const pid = `dither-${id}-${color.replace('#', '')}`;
    return `<svg class="art-svg" viewBox="0 0 160 104" width="100%" height="100%" aria-hidden="true">
      <defs>
        <pattern id="${pid}" width="4" height="4" patternUnits="userSpaceOnUse" shape-rendering="crispEdges">
          <rect width="4" height="4" fill="${PAPER}"/>
          <rect width="2" height="2" fill="${color}"/>
          <rect x="2" y="2" width="2" height="2" fill="${color}"/>
        </pattern>
      </defs>
      <g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        ${body.replace(/FILL/g, `url(#${pid})`).replace(/PAPER/g, PAPER).replace(/INK/g, INK).replace(/COLOR/g, color)}
      </g>
    </svg>`;
  }

  const ART = {
    // Film reel with a strip running out to the right.
    cineasterna: (c) => wrap('cineasterna', c, `
      <g transform="rotate(-14 100 70)">
        <rect x="88" y="60" width="72" height="24" fill="PAPER" stroke-width="2.5"/>
        <g fill="INK" stroke="none">
          <rect x="94" y="63" width="6" height="4"/><rect x="106" y="63" width="6" height="4"/><rect x="118" y="63" width="6" height="4"/><rect x="130" y="63" width="6" height="4"/><rect x="142" y="63" width="6" height="4"/>
          <rect x="94" y="77" width="6" height="4"/><rect x="106" y="77" width="6" height="4"/><rect x="118" y="77" width="6" height="4"/><rect x="130" y="77" width="6" height="4"/><rect x="142" y="77" width="6" height="4"/>
        </g>
        <line x1="88" y1="72" x2="160" y2="72" stroke-width="1.5" stroke-dasharray="3 3"/>
      </g>
      <circle cx="58" cy="52" r="36" fill="FILL"/>
      <circle cx="58" cy="52" r="9" fill="PAPER"/>
      <circle cx="58" cy="28" r="7" fill="PAPER" stroke-width="2.5"/>
      <circle cx="58" cy="76" r="7" fill="PAPER" stroke-width="2.5"/>
      <circle cx="34" cy="52" r="7" fill="PAPER" stroke-width="2.5"/>
      <circle cx="82" cy="52" r="7" fill="PAPER" stroke-width="2.5"/>
    `),

    // A small television with rabbit ears and a play mark on the screen.
    svtplay: (c) => wrap('svtplay', c, `
      <line x1="80" y1="30" x2="60" y2="8"/>
      <line x1="80" y1="30" x2="102" y2="8"/>
      <circle cx="60" cy="8" r="3" fill="INK" stroke="none"/>
      <circle cx="102" cy="8" r="3" fill="INK" stroke="none"/>
      <rect x="28" y="30" width="108" height="62" rx="8" fill="PAPER"/>
      <rect x="38" y="38" width="70" height="46" rx="4" fill="FILL" stroke-width="2.5"/>
      <polygon points="64,50 64,72 84,61" fill="PAPER" stroke-width="2.5"/>
      <circle cx="122" cy="50" r="5" fill="PAPER" stroke-width="2.5"/>
      <circle cx="122" cy="66" r="5" fill="PAPER" stroke-width="2.5"/>
      <line x1="118" y1="80" x2="126" y2="80" stroke-width="2.5"/>
      <line x1="48" y1="92" x2="42" y2="100"/>
      <line x1="116" y1="92" x2="122" y2="100"/>
    `),

    // A shelf of your own films and series, one case leaning.
    plex: (c) => wrap('plex', c, `
      <rect x="30" y="44" width="14" height="42" fill="FILL" stroke-width="2.5"/>
      <rect x="48" y="34" width="12" height="52" fill="PAPER" stroke-width="2.5"/>
      <rect x="64" y="48" width="16" height="38" fill="FILL" stroke-width="2.5"/>
      <rect x="84" y="38" width="10" height="48" fill="PAPER" stroke-width="2.5"/>
      <rect x="100" y="40" width="12" height="46" fill="FILL" stroke-width="2.5" transform="rotate(14 106 86)"/>
      <line x1="34" y1="54" x2="40" y2="54" stroke-width="2"/><line x1="34" y1="60" x2="40" y2="60" stroke-width="2"/>
      <line x1="51" y1="44" x2="57" y2="44" stroke-width="2"/><line x1="51" y1="50" x2="57" y2="50" stroke-width="2"/>
      <line x1="87" y1="48" x2="91" y2="48" stroke-width="2"/><line x1="87" y1="54" x2="91" y2="54" stroke-width="2"/>
      <rect x="20" y="86" width="120" height="6" fill="INK" stroke="none"/>
      <line x1="30" y1="92" x2="30" y2="100"/>
      <line x1="130" y1="92" x2="130" y2="100"/>
    `),

    // Default: a ticket stub.
    default: (c) => wrap('ticket', c, `
      <g transform="rotate(-8 80 52)">
        <path d="M30 32 H130 a6 6 0 0 1 6 6 v8 a8 8 0 0 0 0 16 v8 a6 6 0 0 1 -6 6 H30 a6 6 0 0 1 -6 -6 v-8 a8 8 0 0 0 0 -16 v-8 a6 6 0 0 1 6 -6 z" fill="FILL"/>
        <line x1="98" y1="34" x2="98" y2="74" stroke-dasharray="4 4" stroke-width="2"/>
        <rect x="38" y="44" width="44" height="6" fill="PAPER" stroke="none"/>
        <rect x="38" y="56" width="30" height="6" fill="PAPER" stroke="none"/>
      </g>
    `),
  };

  P.art = {
    html(id, color) {
      const fn = ART[id] || ART.default;
      return fn(color || INK);
    },
    has(id) { return !!ART[id]; },
  };
})(window.PioneerTV);
