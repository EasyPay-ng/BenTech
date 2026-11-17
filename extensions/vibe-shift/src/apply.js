/* ===========================================================
   VIBE SHIFT :: content-script bootstrap
   Runs at document_start, decides whether a theme applies to
   this page, injects the stylesheet, then hands off to the
   theme's optional behaviours.
   =========================================================== */
(function () {
  'use strict';

  const registry = window.__VIBE_SHIFT__;
  if (!registry) return;

  const STORAGE_KEY = 'vibeshift:settings';
  const DEFAULTS = { enabled: {}, intensity: 0.8, hud: true };

  const host = location.hostname.replace(/^www\./, '');
  const themeId = registry.detectTheme(host, location.pathname);
  if (!themeId) return;

  const theme = registry.THEMES[themeId];
  const isTopFrame = window.top === window;

  /* ---------- 1. read settings, then apply ---------- */
  const getSettings = () =>
    new Promise((resolve) => {
      try {
        chrome.storage.sync.get(STORAGE_KEY, (data) => {
          resolve(Object.assign({}, DEFAULTS, data[STORAGE_KEY] || {}));
        });
      } catch (e) {
        resolve(DEFAULTS);
      }
    });

  const injectCss = () => {
    if (document.querySelector('link[data-vibeshift]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL(theme.css);
    link.dataset.vibeshift = themeId;
    (document.head || document.documentElement).appendChild(link);
  };

  const removeCss = () => {
    document.querySelectorAll('link[data-vibeshift]').forEach((n) => n.remove());
    document.documentElement.style.removeProperty('--vibeshift-intensity');
    document.querySelectorAll('.vibeshift-hud, .vibeshift-overlay').forEach((n) => n.remove());
  };

  const apply = (settings, { remember = true } = {}) => {
    const on = settings.enabled[themeId] !== false; // default: on for matching sites
    if (on) {
      document.documentElement.style.setProperty('--vibeshift-intensity', settings.intensity);
      injectCss();
      runBehaviors(settings);
    } else {
      removeCss();
    }
    if (remember) rememberVibe(settings, on);
  };

  /* ---------- 2. theme behaviours ---------- */
  const behaviours = {
    hud(settings) {
      if (settings.hud === false || !isTopFrame) return;
      if (document.querySelector('.vibeshift-hud')) return;
      const el = document.createElement('div');
      el.className = 'vibeshift-hud';
      el.innerHTML =
        '<span class="vs-dot"></span>' +
        '<span class="vs-wave"><i></i><i></i><i></i><i></i><i></i></span>' +
        '<span>vibe :: ' + theme.label.toLowerCase() + '</span>';
      const mount = () => document.body && document.body.appendChild(el);
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount, { once: true });
    },

    'typewriter-title'() {
      if (!isTopFrame) return;
      const run = () => {
        const h1 = document.querySelector('#firstHeading, .firstHeading');
        if (!h1 || h1.dataset.vsTyped) return;
        const text = h1.textContent;
        h1.dataset.vsTyped = '1';
        h1.textContent = '';
        let i = 0;
        const tick = () => {
          if (i > text.length) return;
          h1.textContent = text.slice(0, i);
          i += 1;
          // fast enough not to annoy, slow enough to feel like a TTY
          setTimeout(tick, i < 4 ? 90 : 22);
        };
        tick();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
    },

    'spa-navigation'() {
      // X/Twitter never reloads the page, so re-run our behaviours
      // whenever the timeline swaps content in.
      let last = location.pathname;
      const observer = new MutationObserver(() => {
        if (location.pathname === last) return;
        last = location.pathname;
        apply(lastSettings, { remember: false });
      });
      const start = () => observer.observe(document.body, { childList: true, subtree: true });
      if (document.body) start();
      else document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  };

  let lastSettings = DEFAULTS;
  let started = false;

  function runBehaviors(settings) {
    lastSettings = settings;
    if (started) return;
    started = true;
    (theme.behaviors || []).forEach((name) => {
      const fn = behaviours[name];
      if (fn) {
        try {
          fn(settings);
        } catch (e) {
          console.warn('[vibe-shift] behaviour failed:', name, e);
        }
      }
    });
  }

  /* ---------- 3. keep the popup in sync ---------- */
  function rememberVibe(settings, on) {
    if (window.top !== window) return;
    window.dispatchEvent(
      new CustomEvent('vibeshift:state', { detail: { themeId, on, settings } })
    );
  }

  // The popup writes through chrome.storage; react live, no reload needed.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[STORAGE_KEY]) return;
      const next = Object.assign({}, DEFAULTS, changes[STORAGE_KEY].newValue || {});
      const wasOn = lastSettings.enabled[themeId] !== false;
      const nowOn = next.enabled[themeId] !== false;
      lastSettings = next;
      document.documentElement.style.setProperty('--vibeshift-intensity', next.intensity);
      if (wasOn && !nowOn) {
        removeCss();
      } else if (!wasOn && nowOn) {
        started = false; // let behaviours re-mount cleanly
        apply(next, { remember: false });
      } else if (nowOn) {
        runBehaviors(next);
      }
    });
  } catch (e) {
    /* storage unavailable in this context; theme still applies */
  }

  getSettings().then((settings) => apply(settings));
})();
