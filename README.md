# BenTech / Stark Technologies

Static site plus a small pile of browser-based tools. No build step: open `index.html`
or serve the folder.

```
index.html                  marketing site + tool index
calculator.html             advanced calculator
document.html               document tool
image-to-pdf.html           image → PDF builder

extensions/vibe-shift/      MV3 extension that reskins Wikipedia + X
projects/mood-lamp/         ESP32 + WLED + touch mood lamp (firmware + simulator)
projects/infinite-story/    local-LLM choice-based story engine (Ollama)
```

## The three experiments

**Vibe Shift** — a Manifest V3 extension with two themes: Wikipedia as a
green-phosphor terminal, X as a vaporwave dream. Pure CSS injection at
`document_start`, so nothing flashes and nothing breaks.

- Live previews: [`extensions/vibe-shift/demo/index.html`](extensions/vibe-shift/demo/index.html)
- Install + architecture: [`extensions/vibe-shift/README.md`](extensions/vibe-shift/README.md)

**Mood Lamp** — ESP32 + WLED + one capacitive pad. Palette by hour of day,
overridden by your calendar (meeting → neutral white, gym → driving amber,
rest → low and warm-free), with a 23:00–06:00 sleep guard.

- Simulator (runs the firmware's real decision order): [`projects/mood-lamp/simulator/index.html`](projects/mood-lamp/simulator/index.html)
- Build guide, BOM, wiring: [`projects/mood-lamp/README.md`](projects/mood-lamp/README.md)

**Infinite Story** — choice-based narratives written by a local model. The runtime,
not the model, enforces the rules: no dead ends, no duplicate scenes, tension
tracked in code, and six "retelling" styles that mutate the story on each pass.
Exports to ink.js and Twine.

- App: `projects/infinite-story/index.html` (run the proxy: `python3 projects/infinite-story/tools/ollama-proxy.py`)
- Design + setup: [`projects/infinite-story/README.md`](projects/infinite-story/README.md)

## Tests

```bash
./tests/run.sh
```

One command, six suites, no GPU and no hardware:

| Suite | What it proves |
| --- | --- |
| static | CSS braces/vars/contrast blocks, demo pages link the real themes, every local `href`/`src` resolves |
| firmware logic (C++) | all 24 hours map to exactly one palette, the sleep window boundaries, calendar keyword matching |
| lamp simulator (jsdom) | clock → palette, sleep guard, tap/double-tap/hold, calendar precedence, unmatched text ignored |
| extension (jsdom) | host detection (`notx.com` must not match `x.com`), CSS injection, per-theme opt-out, live toggle via `storage.onChanged`, popup states, minimal permissions |
| story engine (jsdom) | beat validation, choice → tension, reroll not growing the path, ink/Twee export shape, save round-trip, model-down errors |
| story e2e (real HTTP) | the proxy passthrough and fenced-JSON parsing against a fake Ollama on a real socket |

## Serving locally

```bash
python3 -m http.server 8080      # from this folder
```

Two of the three pages need origin parity with the things they talk to:

- the story engine needs Ollama; use its proxy so no CORS setup is required
- the extension needs to be loaded unpacked in Chrome/Edge (`chrome://extensions`
  → Developer mode → Load unpacked → `extensions/vibe-shift`)

The lamp simulator is entirely client-side and also runs from `file://`.
