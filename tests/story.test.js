const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = require('path').join(__dirname, '..', 'projects/infinite-story') + '/';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:8080/',
  pretendToBeVisual: true,
  runScripts: 'outside-only'
});
const { window } = dom;

const fails = [];
const check = (n, c, x) => { if (!c) fails.push(n + (x ? ' :: ' + x : '')); };

let chatCalls = [];
let mode = 'ok';

window.fetch = async (url, opts) => {
  if (String(url).endsWith('/api/tags')) {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => ({ models: [{ name: 'llama3.1:8b' }, { name: 'mistral:7b' }] }) };
  }
  if (String(url).endsWith('/api/chat')) {
    const body = JSON.parse(opts.body);
    chatCalls.push(body);
    const n = chatCalls.length;
    const beat = {
      id: 'beat-' + n,
      title: 'Scene ' + n + ' of the market',
      prose: 'You step into the rain-market and the price boards turn to face you. ' +
             'Paragraph two keeps a detail nobody else could have: the smell of wet ledger paper.',
      choices: [
        { id: 'pay', label: 'Pay with a memory', tension: 'up' },
        { id: 'wait', label: 'Wait for the rain to stop', tension: 'down' },
        { id: 'ask', label: 'Ask who is buying', tension: 'hold' }
      ]
    };
    return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(beat) } }) };
  }
  throw new Error('unexpected url ' + url);
};

window.eval(fs.readFileSync(ROOT + 'js/ollama.js', 'utf8'));
window.eval(fs.readFileSync(ROOT + 'js/engine.js', 'utf8'));
window.eval(fs.readFileSync(ROOT + 'js/app.js', 'utf8'));

const $ = (id) => window.document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(300);
  check('model discovered via proxy', $('status').textContent.includes('model ready'), $('status').textContent);
  check('model list populated', $('modelSelect').options.length === 2, String($('modelSelect').options.length));
  check('prefers llama3.1', $('modelSelect').value === 'llama3.1:8b', $('modelSelect').value);
  check('begin enabled', $('startBtn').disabled === false);

  // ---- begin a story ----
  $('startBtn').click();
  await wait(400);
  check('one chat call', chatCalls.length === 1, String(chatCalls.length));
  check('system prompt mentions tension', /Tension right now/.test(chatCalls[0].messages[0].content));
  check('format json requested', chatCalls[0].format === 'json');
  check('beat rendered', window.document.querySelectorAll('.beat').length === 1);
  check('beat is current', window.document.querySelector('.beat.current') !== null);
  check('3 choices rendered', window.document.querySelectorAll('#choices .choice').length === 3);
  check('turn counter 2', $('turnNum').textContent === '1', $('turnNum').textContent);
  check('tension starts 2', $('tensionNum').textContent === '2', $('tensionNum').textContent);
  check('title rendered', window.document.querySelector('.beat-head h2').textContent.includes('Scene 1'));

  // ---- pick a choice (tension up) ----
  window.document.querySelectorAll('#choices .choice')[0].click();
  await wait(400);
  check('second chat call', chatCalls.length === 2, String(chatCalls.length));
  check('choice fed to model', /Pay with a memory/.test(JSON.stringify(chatCalls[1].messages)));
  check('tension rose to 4', $('tensionNum').textContent === '4', $('tensionNum').textContent);
  check('two beats on the path', window.document.querySelectorAll('.beat').length === 2);
  check('previous beat recorded the choice', window.document.querySelector('.beat-taken em').textContent === 'Pay with a memory');
  check('older beat not current', window.document.querySelectorAll('.beat')[0].classList.contains('current') === false);

  // ---- keyboard shortcut ----
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }));
  await wait(400);
  check('keyboard choice works', chatCalls.length === 3, String(chatCalls.length));
  check('tension fell to 2', $('tensionNum').textContent === '2', $('tensionNum').textContent);

  // ---- retell this beat ----
  const before = window.document.querySelectorAll('.beat').length;
  $('rerollBtn').click();
  await wait(400);
  check('reroll called model again', chatCalls.length === 4, String(chatCalls.length));
  check('reroll did not grow the path', window.document.querySelectorAll('.beat').length === before,
        before + ' -> ' + window.document.querySelectorAll('.beat').length);

  // ---- exports ----
  $('openStudio').click();
  await wait(100);
  check('studio opened', $('overlay').classList.contains('open'));
  const pres = [...window.document.querySelectorAll('.studio-code pre')].map((p) => p.textContent);
  check('ink export has knots', /=== knot_1_/.test(pres[0]), pres[0].slice(0, 80));
  check('ink export has choices', /^[+*] \[/m.test(pres[0]));
  check('twine export has passages', /^:: /m.test(pres[1]));
  check('studio path listed', window.document.querySelectorAll('.studio-path li').length === 3);

  // ---- save / load round trip through the engine ----
  const s = window.StoryEngine.createSession('test seed', 'ghosts');
  const beat = { id: 'a', title: 'A', prose: 'x'.repeat(60), choices: [{ id: 'c1', label: 'Go', tension: 'up' }], turn: 1 };
  window.StoryEngine.commitBeat(s, beat);
  window.StoryEngine.choose(s, s.scenes.a.choices[0]);
  s.scenes.a.choices[0].id = 'go';
  s.scenes.a.chosenId = 'go';
  s.scenes.a.chosenLabel = 'Go';
  s.order.push('b');
  s.scenes.b = { id: 'b', title: 'B', prose: 'y'.repeat(60), choices: [{ id: 'end', label: 'End', tension: 'down' }], turn: 2 };
  s.currentId = 'b';
  const rt = window.StoryEngine.fromSave(JSON.parse(JSON.stringify(window.StoryEngine.toSave(s))));
  check('save round trip keeps order', rt.order.join() === 'a,b', rt.order.join());
  check('save round trip keeps prose', rt.scenes.b.prose.length === 60);

  // ---- ink/twine link correctness ----
  const ink = window.StoryEngine.toInk(s);
  check('ink links to next knot', /-> knot_2_b/.test(ink), ink);
  const tw = window.StoryEngine.toTwine(s);
  check('twee has two passages', tw.twee.split(':: ').length === 3, String(tw.twee.split(':: ').length));

  // ---- error paths ----
  mode = 'down';
  const bad = await window.Ollama.discover();
  check('discover fails cleanly when ollama down', bad.ok === false);

  // ---- validation guards ----
  const tiny = window.StoryEngine.createSession('x', 'none');
  let threw = false;
  try { await window.StoryEngine.nextBeat(tiny, {}); } catch (e) { threw = true; }
  check('bad beat surfaces as error', threw);

  if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log(' - ' + f)); process.exit(1); }
  console.log('story app: all checks passed (' + chatCalls.length + ' model calls)');
  process.exit(0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
