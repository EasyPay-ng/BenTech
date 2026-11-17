const fs = require('fs');
const path = require('path');
const CSS = require('path').join(__dirname, '..', 'extensions/vibe-shift/themes') + '/';
const fails = [];
const check = (n, c, x) => { if (!c) fails.push(n + (x ? ' :: ' + x : '')); };

for (const file of fs.readdirSync(CSS)) {
  const css = fs.readFileSync(CSS + file, 'utf8');
  // brace balance
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  check(file + ': braces balanced', open === close, open + ' vs ' + close);
  // no stray comments
  check(file + ': no unterminated comment', !/\/\*(?:(?!\*\/)[\s\S])*$/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
  // no empty rule bodies
  check(file + ': no empty rules', !/{\s*}/.test(css));
  // custom props used are declared (best effort)
  const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !declared.has(v) && v !== '--vibeshift-intensity');
  check(file + ': css vars declared', missing.length === 0, missing.join(','));
  // reduced motion honoured where animation is used
  if (/@keyframes/.test(css)) check(file + ': reduced-motion block', /prefers-reduced-motion/.test(css));
  // hex colours valid
  const bad = [...css.matchAll(/#([0-9a-fA-F]+)\b/g)].filter((m) => ![3, 4, 6, 8].includes(m[1].length));
  check(file + ': hex colours valid', bad.length === 0, bad.map((b) => b[0]).join(','));
}

// the demo pages must load the real themes and exist
const DEMO = require('path').join(__dirname, '..', 'extensions/vibe-shift/demo') + '/';
for (const [page, theme] of [['wikipedia.html', 'wikipedia-terminal.css'], ['x.html', 'vaporwave-dream.css']]) {
  const html = fs.readFileSync(DEMO + page, 'utf8');
  check(page + ': links real theme', html.includes('../themes/' + theme));
  check(page + ': theme file resolves', fs.existsSync(path.join(DEMO, '../themes/' + theme)));
}

console.log(fails.length ? 'FAILURES:\n - ' + fails.join('\n - ') : 'css + demo: all checks passed');
process.exit(fails.length ? 1 : 0);
