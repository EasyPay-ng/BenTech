#!/usr/bin/env bash
# Headless test suite for the three experiments.
#
#   ./tests/run.sh
#
# Needs: node (>=18), g++. The jsdom-based suites install jsdom into
# tests/ on first run; the e2e suite additionally needs the fake Ollama
# server + proxy below, which this script starts and stops for you.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
fail=0

say()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

command -v node >/dev/null || { echo "node is required"; exit 1; }

if [ ! -d tests/node_modules/jsdom ]; then
  say "installing jsdom (first run)"
  (cd tests && npm init -y >/dev/null 2>&1 && npm i jsdom --silent) || { echo "jsdom install failed"; exit 1; }
fi
export NODE_PATH="$ROOT/tests/node_modules"

say "static: css, demos, links"
node tests/css.test.js || fail=1
python3 - <<'PY' || fail=1
import os, re, sys
bad = []
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules')]
    for f in files:
        if not f.endswith('.html'):
            continue
        p = os.path.join(root, f)
        html = open(p, encoding='utf-8').read()
        for m in re.finditer(r'(?:href|src)="([^"#][^"]*)"', html):
            u = m.group(1)
            if u.startswith(('http', 'mailto:', 'data:', 'javascript:', '/')):
                continue
            t = os.path.normpath(os.path.join(root, u.split('?')[0]))
            if not os.path.exists(t):
                bad.append(f'{p} -> {u}')
print('  ok   every local href/src resolves' if not bad else '  FAIL ' + '; '.join(bad))
sys.exit(1 if bad else 0)
PY

say "firmware logic (host c++)"
if command -v g++ >/dev/null; then
  if g++ -std=c++11 -O2 -o /tmp/moodlamp_test projects/mood-lamp/tools/test_logic.cpp && /tmp/moodlamp_test >/tmp/moodlamp_test.log; then
    pass "$(tail -1 /tmp/moodlamp_test.log | sed 's/^ *//')"
  else
    bad "mood lamp decision logic"; cat /tmp/moodlamp_test.log
  fi
else
  printf '  skip g++ not installed\n'
fi

say "mood lamp simulator (jsdom)"
node tests/lamp.test.js && pass "simulator states, sleep guard, touch, calendar" || fail=1

say "vibe shift extension (jsdom)"
node tests/ext.test.js && pass "theme detection, injection, toggles, popup" || fail=1

say "infinite story engine (jsdom, stubbed ollama)"
node tests/story.test.js && pass "beats, choices, reroll, exports, validation" || fail=1

say "infinite story end-to-end (real http through the proxy)"
python3 tests/fake-ollama.py & FAKE=$!
OLLAMA_URL=http://127.0.0.1:11999 python3 projects/infinite-story/tools/ollama-proxy.py --port 8124 >/tmp/proxy.log 2>&1 &
PROXY=$!
sleep 1.2
node tests/e2e.test.js && pass "proxy passthrough + fenced-json parsing" || fail=1
kill $FAKE $PROXY 2>/dev/null

say "palette generation"
python3 projects/mood-lamp/tools/build_palettes.py >/dev/null && pass "palettes.json -> header + js" || fail=1

echo
if [ $fail -eq 0 ]; then printf '\033[32mall suites passed\033[0m\n'; else printf '\033[31mFAILURES above\033[0m\n'; fi
exit $fail
