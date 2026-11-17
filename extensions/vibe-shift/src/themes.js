/* ===========================================================
   VIBE SHIFT :: theme registry
   Each theme = one CSS file + a tiny optional behaviour hook.
   Adding a new reskin means adding one entry + one CSS file.
   =========================================================== */
(function () {
  const THEMES = {
    'wikipedia-terminal': {
      label: 'Terminal',
      tagline: 'Green phosphor, scanlines, cat ./article',
      sites: ['en.wikipedia.org', '*.wikipedia.org'],
      matches: [/\.wikipedia\.org$/],
      css: 'themes/wikipedia-terminal.css',
      swatch: ['#7dffb0', '#04120a'],
      hud: false,
      behaviors: ['typewriter-title']
    },
    'vaporwave-dream': {
      label: 'Vaporwave Dream',
      tagline: 'Sunset grid, pastel glass, dreamy type',
      sites: ['x.com', 'twitter.com'],
      matches: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
      css: 'themes/vaporwave-dream.css',
      swatch: ['#ff6ec7', '#120826'],
      hud: true,
      behaviors: ['hud', 'spa-navigation']
    }
  };

  // Which theme suits this host? First match wins.
  function detectTheme(hostname, pathname) {
    for (const [id, theme] of Object.entries(THEMES)) {
      if (theme.matches.some((re) => re.test(hostname))) {
        // Wikipedia's main portal gets the terminal too; everything does.
        return id;
      }
    }
    return null;
  }

  window.__VIBE_SHIFT__ = { THEMES, detectTheme };
})();
