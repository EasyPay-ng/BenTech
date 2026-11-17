const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = require('path').join(__dirname, '..', 'projects/infinite-story') + '/';
const BASE = 'http://127.0.0.1:8124';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const dom = new JSDOM(html, { url: BASE + '/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// node's real fetch, but relative URLs need resolving the way a browser would
window.fetch = (url, opts) => fetch(new URL(url, BASE).toString(), opts);
window.localStorage.clear();

window.eval(fs.readFileSync(ROOT + 'js/ollama.js', 'utf8'));
window.eval(fs.readFileSync(ROOT + 'js/engine.js', 'utf8'));
window.eval(fs.readFileSync(ROOT + 'js/app.js', 'utf8'));

const $ = (id) => window.document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (n, c, x) => { if (!c) fails.push(n + (x ? ' :: ' + x : '')); };

(async () => {
  await wait(500);
  check('connected through proxy', $('status').textContent.includes('model ready'), $('status').textContent);
  check('proxy base recorded', window.Ollama.base === 'http://127.0.0.1:8124/ollama' || window.Ollama.base === '/ollama',
        String(window.Ollama.base));

  $('startBtn').click();
  await wait(600);
  const beats = window.document.querySelectorAll('.beat');
  check('real http beat rendered', beats.length === 1, String(beats.length));
  check('fenced json survived parsing', /rain-market/.test(beats[0].textContent), beats[0].textContent.slice(0, 60));
  check('choices from http', window.document.querySelectorAll('.choice').length === 3);

  window.document.querySelectorAll('.choice')[2].click();
  await wait(600);
  check('second beat over http', window.document.querySelectorAll('.beat').length === 2);
  check('tension hold keeps 2', $('tensionNum').textContent === '2', $('tensionNum').textContent);
  check('choice label recorded', /Ask who is buying/.test(window.document.querySelectorAll('.beat-taken em')[0].textContent));

  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log(' - ' + f)); process.exit(1); }
  console.log('e2e over real http: all checks passed');
  process.exit(0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
