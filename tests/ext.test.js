const fs = require('fs');
const { JSDOM } = require('jsdom');
const EXT = require('path').join(__dirname, '..', 'extensions/vibe-shift') + '/';
const fails = [];
const check = (n, c, x) => { if (!c) fails.push(n + (x ? ' :: ' + x : '')); };

function boot(url, settings) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><h1 id="firstHeading">Makurdi</h1></body></html>',
    { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const listeners = [];
  dom.window.chrome = {
    runtime: { getURL: (p) => 'chrome-extension://abc/' + p },
    storage: {
      sync: { get: (k, cb) => cb({ 'vibeshift:settings': settings }) },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    }
  };
  dom.window.chrome.storage.sync.get = (k, cb) => cb(settings ? { 'vibeshift:settings': settings } : {});
  dom.window.eval(fs.readFileSync(EXT + 'src/themes.js', 'utf8'));
  dom.window.eval(fs.readFileSync(EXT + 'src/apply.js', 'utf8'));
  return { dom, listeners };
}

(async () => {
  // ---- registry ----
  const { dom: reg } = boot('https://en.wikipedia.org/wiki/Makurdi');
  const R = reg.window.__VIBE_SHIFT__;
  check('wikipedia detected', R.detectTheme('en.wikipedia.org') === 'wikipedia-terminal');
  check('www.wikipedia detected', R.detectTheme('www.wikipedia.org') === 'wikipedia-terminal');
  check('x.com detected', R.detectTheme('x.com') === 'vaporwave-dream');
  check('twitter detected', R.detectTheme('twitter.com') === 'vaporwave-dream');
  check('unknown site ignored', R.detectTheme('example.com') === null);
  check('not-a-fake-domain ignored', R.detectTheme('notx.com') === null);
  check('every theme points at real css', Object.values(R.THEMES).every((t) => fs.existsSync(EXT + t.css)));
  check('every behaviour exists in apply.js',
    Object.values(R.THEMES).every((t) => t.behaviors.length >= 1));

  // ---- wikipedia: css injected ----
  const { dom: wiki } = boot('https://en.wikipedia.org/wiki/Makurdi');
  await new Promise((r) => setTimeout(r, 60));
  const link = wiki.window.document.querySelector('link[data-vibeshift]');
  check('wikipedia injects theme css', link && link.dataset.vibeshift === 'wikipedia-terminal');
  check('css href points at full path', link && link.href === 'chrome-extension://abc/themes/wikipedia-terminal.css', link && link.href);
  check('intensity var set', wiki.window.document.documentElement.style.getPropertyValue('--vibeshift-intensity') === '0.8');
  check('no HUD on wikipedia', !wiki.window.document.querySelector('.vibeshift-hud'));
  check('typewriter ran on the title', wiki.window.document.getElementById('firstHeading').dataset.vsTyped === '1');

  // ---- x.com: css + HUD, and respects intensity ----
  const { dom: x } = boot('https://x.com/home', { enabled: {}, intensity: 0.35, hud: true });
  await new Promise((r) => setTimeout(r, 80));
  const xl = x.window.document.querySelector('link[data-vibeshift]');
  check('x injects vaporwave css', xl && xl.dataset.vibeshift === 'vaporwave-dream');
  check('x sets saved intensity', x.window.document.documentElement.style.getPropertyValue('--vibeshift-intensity') === '0.35',
    x.window.document.documentElement.style.getPropertyValue('--vibeshift-intensity'));
  const hud = x.window.document.querySelector('.vibeshift-hud');
  check('HUD mounted on x', !!hud);
  check('HUD labels the theme', hud && /vaporwave dream/.test(hud.textContent), hud && hud.textContent);

  // ---- HUD can be switched off ----
  const { dom: x2 } = boot('https://x.com/home', { enabled: {}, intensity: 1, hud: false });
  await new Promise((r) => setTimeout(r, 80));
  check('hud:false respected', !x2.window.document.querySelector('.vibeshift-hud'));

  // ---- per-theme opt out ----
  const { dom: off } = boot('https://en.wikipedia.org/wiki/Makurdi', { enabled: { 'wikipedia-terminal': false } });
  await new Promise((r) => setTimeout(r, 60));
  check('disabled theme does not inject', !off.window.document.querySelector('link[data-vibeshift]'));

  // ---- live toggle via storage.onChanged ----
  const { dom: live, listeners } = boot('https://en.wikipedia.org/wiki/Makurdi');
  await new Promise((r) => setTimeout(r, 60));
  check('live: on at start', !!live.window.document.querySelector('link[data-vibeshift]'));
  listeners.forEach((fn) => fn({ 'vibeshift:settings': { newValue: { enabled: { 'wikipedia-terminal': false }, intensity: 0.8, hud: true } } }, 'sync'));
  await new Promise((r) => setTimeout(r, 30));
  check('live: toggled off removes css', !live.window.document.querySelector('link[data-vibeshift]'));
  listeners.forEach((fn) => fn({ 'vibeshift:settings': { newValue: { enabled: {}, intensity: 0.5, hud: true } } }, 'sync'));
  await new Promise((r) => setTimeout(r, 60));
  check('live: toggled back on re-injects', !!live.window.document.querySelector('link[data-vibeshift]'));
  check('live: intensity updated', live.window.document.documentElement.style.getPropertyValue('--vibeshift-intensity') === '0.5');

  // ---- manifest sanity ----
  const m = JSON.parse(fs.readFileSync(EXT + 'manifest.json', 'utf8'));
  check('mv3', m.manifest_version === 3);
  check('no remote code / csp keeps defaults', !('content_security_policy' in m) || /script-src 'self'/.test(JSON.stringify(m.content_security_policy)));
  check('hosts cover themes', m.host_permissions.includes('https://*.wikipedia.org/*') && m.host_permissions.includes('https://*.x.com/*'));
  check('content script matches hosts', m.content_scripts[0].matches.length === 3);
  const declared = [m.action.default_popup, ...Object.values(m.icons), ...m.content_scripts[0].js];
  const globs = m.web_accessible_resources[0].resources.map((g) => g.replace('*.css', 'wikipedia-terminal.css'));
  check('all manifest files exist', [...declared, ...globs].every((f) => fs.existsSync(EXT + f)),
    JSON.stringify([...declared, ...globs].filter((f) => !fs.existsSync(EXT + f))));
  check('permissions are minimal', JSON.stringify(m.permissions.sort()) === JSON.stringify(['activeTab', 'storage']), JSON.stringify(m.permissions));
  check('css themes exist for both', fs.existsSync(EXT + 'themes/wikipedia-terminal.css') && fs.existsSync(EXT + 'themes/vaporwave-dream.css'));

  // ---- popup boots with a stubbed chrome ----
  const popupHtml = fs.readFileSync(EXT + 'src/popup.html', 'utf8').replace(/<script src="popup.js"><\/script>/, '');
  const pdom = new JSDOM(popupHtml, { url: 'chrome-extension://abc/src/popup.html', runScripts: 'outside-only', pretendToBeVisual: true });
  pdom.window.chrome = {
    storage: { sync: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } },
    tabs: { query: async () => [{ id: 7, url: 'https://x.com/home' }], reload: () => {} }
  };
  pdom.window.chrome.storage.sync.get = (k, cb) => cb({});
  pdom.window.eval(fs.readFileSync(EXT + 'src/popup.js', 'utf8'));
  await new Promise((r) => setTimeout(r, 80));
  const pd = pdom.window.document;
  check('popup renders both themes', pd.querySelectorAll('.theme').length === 2, String(pd.querySelectorAll('.theme').length));
  check('popup marks current tab theme', pd.querySelector('.theme.here .here-chip') !== null);
  const chip = pd.querySelector('.here-chip');
  check('popup chip says live', chip && /live on this tab/.test(chip.textContent));
  check('popup status', pd.getElementById('status').textContent !== '', pd.getElementById('status').textContent);
  check('toggles default on', [...pd.querySelectorAll('.switch input')].every((i) => i.checked));

  // ---- popup on a non-theme site ----
  const p2 = new JSDOM(popupHtml, { url: 'chrome-extension://abc/src/popup.html', runScripts: 'outside-only', pretendToBeVisual: true });
  p2.window.chrome = {
    storage: { sync: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } },
    tabs: { query: async () => [{ id: 7, url: 'https://example.com/' }], reload: () => {} }
  };
  p2.window.eval(fs.readFileSync(EXT + 'src/popup.js', 'utf8'));
  await new Promise((r) => setTimeout(r, 60));
  check('popup shows notice off-site', p2.window.document.querySelector('.notice') !== null);

  if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log(' - ' + f)); process.exit(1); }
  console.log('extension: all checks passed');
  process.exit(0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
