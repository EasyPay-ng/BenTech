/* ===========================================================
   VIBE SHIFT :: popup controller
   Reads/writes one settings object in chrome.storage.sync and
   renders a row per theme defined in src/themes.js.
   =========================================================== */
const STORAGE_KEY = 'vibeshift:settings';
const DEFAULTS = { enabled: {}, intensity: 0.8, hud: true };

// Keep in sync with src/themes.js (content scripts can't share a module
// with the popup in MV3 without a bundler, so the registry is duplicated
// in the most boring way possible on purpose).
const THEMES = [
  {
    id: 'wikipedia-terminal',
    label: 'Terminal',
    sub: 'Wikipedia as a green-phosphor TTY',
    sites: 'wikipedia.org',
    matches: [/\.wikipedia\.org$/],
    swatch: ['#7dffb0', '#04120a'],
    glyph: '$'
  },
  {
    id: 'vaporwave-dream',
    label: 'Vaporwave Dream',
    sub: 'X / Twitter as a sunset boulevard',
    sites: 'x.com · twitter.com',
    matches: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
    swatch: ['#ff6ec7', '#120826'],
    glyph: '◢'
  }
];

const el = {
  themes: document.getElementById('themes'),
  intensity: document.getElementById('intensity'),
  intensityOut: document.getElementById('intensityOut'),
  hud: document.getElementById('hud'),
  status: document.getElementById('status')
};

let settings = { ...DEFAULTS };

const load = () =>
  new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (data) => {
      resolve({ ...DEFAULTS, ...(data[STORAGE_KEY] || {}) });
    });
  });

const save = () =>
  new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: settings }, resolve);
  });

const hostTheme = (hostname) => {
  const h = hostname.replace(/^www\./, '');
  return THEMES.find((t) => t.matches.some((re) => re.test(h))) || null;
};

function setStatus(text) {
  el.status.textContent = text;
}

function render(activeTab) {
  const here = activeTab ? hostTheme(new URL(activeTab.url).hostname) : null;
  el.themes.textContent = '';

  THEMES.forEach((theme) => {
    const on = settings.enabled[theme.id] !== false;
    const isHere = here && here.id === theme.id;

    const row = document.createElement('div');
    row.className = 'theme' + (isHere ? ' here' : '');

    if (isHere) {
      const chip = document.createElement('span');
      chip.className = 'here-chip';
      chip.textContent = on ? 'live on this tab' : 'off here';
      row.appendChild(chip);
    }

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = `linear-gradient(140deg, ${theme.swatch[0]}, ${theme.swatch[1]})`;
    swatch.style.color = theme.swatch[0];
    swatch.textContent = theme.glyph;

    const copy = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'theme-name';
    name.textContent = theme.label;
    const sub = document.createElement('div');
    sub.className = 'theme-sub';
    sub.textContent = theme.sub;
    const sites = document.createElement('div');
    sites.className = 'theme-sites';
    sites.textContent = theme.sites;
    copy.append(name, sub, sites);

    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = on;
    input.setAttribute('aria-label', `Toggle ${theme.label} theme`);
    input.addEventListener('change', async () => {
      settings.enabled[theme.id] = input.checked;
      await save();
      setStatus(input.checked ? 'injected' : 'ejected');
      if (activeTab) {
        chrome.tabs.reload(activeTab.id);
      } else {
        render(activeTab);
      }
    });
    const track = document.createElement('span');
    track.className = 'track';
    toggle.append(input, track);

    row.append(swatch, copy, toggle);
    el.themes.appendChild(row);
  });

  if (!here) {
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.innerHTML =
      'No neon here yet. Open <strong>wikipedia.org</strong> or <strong>x.com</strong> ' +
      'to see a theme in the wild. Toggles still save for later.';
    el.themes.appendChild(notice);
  }
}

async function init() {
  settings = await load();

  el.intensity.value = String(settings.intensity);
  el.intensityOut.textContent = Math.round(settings.intensity * 100) + '%';
  el.hud.checked = settings.hud !== false;

  el.intensity.addEventListener('input', () => {
    settings.intensity = Number(el.intensity.value);
    el.intensityOut.textContent = Math.round(settings.intensity * 100) + '%';
  });
  el.intensity.addEventListener('change', async () => {
    await save();
    setStatus('intensity ' + Math.round(settings.intensity * 100) + '%');
  });

  el.hud.addEventListener('change', async () => {
    settings.hud = el.hud.checked;
    await save();
    setStatus(settings.hud ? 'hud on' : 'hud off');
  });

  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs && tabs[0];
  } catch (e) {
    /* tabs permission not requested; popup still works as a settings page */
  }

  render(activeTab);
  setStatus(activeTab && hostTheme(new URL(activeTab.url).hostname) ? 'theme detected' : 'ready');
}

init();
