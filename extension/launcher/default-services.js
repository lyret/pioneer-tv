// Default services shown by the launcher when no daemon config is available
// (design work on a laptop). On the Pi the daemon's config.toml wins.
// `{query}` in search_url is replaced with the URL-encoded search string.
window.PioneerTV = window.PioneerTV || {};
window.PioneerTV.defaultServices = [
  {
    id: 'cineasterna',
    name: 'Cineasterna',
    tagline: 'Film från biblioteket',
    url: 'https://www.cineasterna.se/',
    search_url: 'https://www.cineasterna.se/sv/search?q={query}',
    color: '#b5122b',
    glyph: 'C',
  },
  {
    id: 'svtplay',
    name: 'SVT Play',
    tagline: 'Serier, nyheter och dokumentärer',
    url: 'https://www.svtplay.se/',
    search_url: 'https://www.svtplay.se/sok?q={query}',
    color: '#1f7a4d',
    glyph: 'S',
  },
  {
    id: 'plex',
    name: 'Plex',
    tagline: 'Egna filmer och serier',
    url: 'http://plex.local:32400/web',
    search_url: 'http://plex.local:32400/web/index.html#!/search?query={query}',
    color: '#c98a12',
    glyph: 'P',
  },
];
