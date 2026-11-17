const fs = require('fs');
const { JSDOM } = require('jsdom');
const ROOT = require('path').join(__dirname, '..', 'projects/mood-lamp/simulator') + '/';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/projects/mood-lamp/simulator/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// pull in the two local scripts (they'd normally be <script src>)
window.eval(fs.readFileSync(ROOT + 'palettes.js', 'utf8'));
window.eval(fs.readFileSync(ROOT + 'lamp.js', 'utf8'));

setTimeout(() => {
  const $ = (id) => window.document.getElementById(id);
  const fails = [];
  const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + extra : '')); };

  check('palette rendered', $('outPalette').textContent === 'dusk', $('outPalette').textContent);
  check('source is clock', $('outSource').textContent === 'time of day', $('outSource').textContent);
  check('clock 19:00', $('outClock').textContent === '19:00', $('outClock').textContent);
  check('brightness 120', $('outBrightness').textContent === '120 / 255', $('outBrightness').textContent);
  check('7 palette rows', window.document.querySelectorAll('.prow').length === 7);
  check('5 mood chips + clear', window.document.querySelectorAll('.chip').length === 6);
  check('dusk swatch matches json',
    window.document.querySelectorAll('.prow')[4].querySelectorAll('.swatches i')[1].style.background.includes('255, 95, 158'),
    window.document.querySelectorAll('.prow')[4].querySelectorAll('.swatches i')[1].style.background);

  // --- time of day drives palette ---
  const clock = $('clock');
  clock.value = String(3 * 60);          // 03:00 -> night + sleep guard
  clock.dispatchEvent(new window.Event('input'));
  check('03:00 -> night', $('outPalette').textContent === 'night', $('outPalette').textContent);
  check('sleep guard clamps to 20', $('outBrightness').textContent === '20 / 255', $('outBrightness').textContent);

  clock.value = String(12 * 60);         // noon -> focus
  clock.dispatchEvent(new window.Event('input'));
  check('12:00 -> focus', $('outPalette').textContent === 'focus', $('outPalette').textContent);
  check('focus bri 215', $('outBrightness').textContent === '215 / 255', $('outBrightness').textContent);

  // --- calendar overrides clock ---
  $('sendInput').value = 'Design sync with Tunde at 9';
  $('sendMinutes').value = '30';
  $('sendForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  check('calendar wins', $('outSource').textContent.startsWith('calendar: meeting'), $('outSource').textContent);
  check('meeting -> focus palette', $('outPalette').textContent === 'focus', $('outPalette').textContent);
  check('meeting bri 190', $('outBrightness').textContent === '190 / 255', $('outBrightness').textContent);

  // --- unmatched text is ignored, not guessed ---
  $('sendInput').value = 'asdkjhasd qwpoeiru';
  $('sendForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  check('unknown mood ignored', $('outPalette').textContent === 'focus' && $('log').textContent.includes('matched no mood keyword'));

  // --- clear calendar -> clock resumes ---
  [...window.document.querySelectorAll('.chip')].find(c => c.textContent === 'clear').click();
  check('clear -> clock', $('outSource').textContent === 'time of day', $('outSource').textContent);

  // --- tap cycles palette and locks ---
  const lamp = $('lamp');
  lamp.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  lamp.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
  check('tap -> next palette', $('outPalette').textContent === 'golden', $('outPalette').textContent);
  check('tap locks source', $('outSource').textContent === 'touch', $('outSource').textContent);

  // --- double tap -> party (dusk, 255) ---
  lamp.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  lamp.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
  check('double tap -> dusk', $('outPalette').textContent === 'dusk', $('outPalette').textContent);
  check('double tap full blast', $('outBrightness').textContent === '255 / 255', $('outBrightness').textContent);

  // --- palette row click previews ---
  window.document.querySelectorAll('.prow')[1].click();
  check('row click previews morning', $('outPalette').textContent === 'morning', $('outPalette').textContent);

  // --- log is populated and bounded ---
  check('log has entries', $('log').children.length > 0 && $('log').children.length <= 40, String($('log').children.length));

  if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log(' - ' + f)); process.exit(1); }
  console.log('lamp simulator: all checks passed (' + $('log').children.length + ' log lines)');
  process.exit(0);
}, 400);
