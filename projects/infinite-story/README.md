# Infinite Story — local LLM narratives that remix themselves

A choice-based story engine where every beat is written by a model running on
your own machine (Ollama), and the *rules* live in JavaScript, not in the model's
imagination.

The interesting part isn't that an LLM can write a scene. It's that the runtime
refuses to let it cheat: no dead ends, no repeated scene ids, tension is tracked
by the code, and each retelling applies a deliberate mutation so the same seed
can never come back the same way twice.

**No API keys, no cloud, no fallback model.** If Ollama isn't running, the page
says so and tells you how to start it.

## Run it

```bash
ollama serve                 # usually already running
ollama pull llama3.1         # or mistral, qwen2.5, gemma2, phi3

python3 tools/ollama-proxy.py
# Infinite Story   http://localhost:8080/
# Ollama proxy     http://localhost:8080/ollama  ->  http://127.0.0.1:11434
```

Open `http://localhost:8080/`.

The proxy matters: Ollama blocks cross-origin browser calls unless you set
`OLLAMA_ORIGINS`. Rather than asking you to edit your environment, the page asks
for `/ollama/api/tags` first and routes everything through the proxy when it's
there. It falls back to calling `127.0.0.1:11434` directly if you'd rather allow
that origin:

```bash
OLLAMA_ORIGINS=http://localhost:8080 ollama serve
```

Any static server works too (`python3 -m http.server 8080` from this folder) as
long as you set `OLLAMA_ORIGINS` accordingly and allow `file://` pages.

## What you're looking at

```
index.html           reader column + controls + studio drawer
story.css            type-driven reading layout (Newsreader + Inter + JetBrains Mono)
js/ollama.js         endpoint discovery, model list, one chat call
js/engine.js         the runtime: prompts, validation, tension, ink/Twine export
js/app.js            rendering, choice handling, reroll, save/load, studio dial
tools/ollama-proxy.py static server + same-origin Ollama proxy
```

### The loop

1. Pick a seed (or roll the dice) and a **retelling** style.
2. `Begin` → the model returns **one JSON beat**: `id`, `title`, `prose`, and
   2–4 `choices`, each tagged `up`/`down`/`hold`.
3. You pick. The runtime applies the tension delta, appends the beat to the path,
   and asks for the next scene, passing the actual choice you made.
4. `Retell this beat` throws that beat away and asks again — different phrasing,
   same decision point. That's the cheapest way to feel the model's range.

Because scenes are keyed by id and stored in a plain object, a save file is just
`{order: [...], scenes: {...}}`. Load it and the whole path is still there.

### Retelling styles (the remix layer)

| Style | Mutation |
| --- | --- |
| Straight | no intrusion |
| **Remix** (default) | change one load-bearing fact from the previous version — who's guilty, what a place means, what the object does |
| Ghosts | the past is actively present in the rooms |
| Lucid | the protagonist notices they're being narrated |
| Temporal | the next beat happens *before* the last one chronologically |
| Kitchen Sink | no supernatural elements at all; money, smells, weather, gossip |

Play the same seed under Straight and under Temporal and you get two stories that
share a world instead of a plot. That's the point.

### Where the model is *not* trusted

`engine.js` is the referee:

- **JSON shape is enforced**, with a loose parser that survives fences and
  preamble — but a beat with under 40 characters of prose is rejected and retried.
- **0 or 1 choices can't happen.** The runtime injects "Look closer" / "Walk
  away", or "Say nothing and wait". No soft-locks.
- **Duplicate scene ids are renamed** rather than overwriting history, so a
  looping story still records both visits.
- **Tension is the runtime's number**, not the model's self-report. `up` = +2,
  `down` = −2, clamped 0–10, and the prompt is told what that tension *means*
  ("short, blunt sentences" above 7).
- **No endings.** The system prompt forbids "the end" and resolving the mystery.

## Export to real tools

The studio drawer (`Open story dial`) shows the path and gives you the same
story two ways:

- **ink.js** — numbered knots (`=== knot_1_the_door ===`), prose, `*`/`+` choices
  with divert targets. `inklecate story.ink` to compile.
- **Twine (Twee 3)** — `:: Passage Name` blocks with `[[choice->target]]` links.
  Paste into a `.twee` and import into Twine 2, or use the generated HTML
  passages directly.

The map is deliberately 1:1: one scene = one knot = one passage. That keeps
exports honest instead of turning your story into a pseudo-parser.

## Tests

From the repo root: `./tests/run.sh` — includes this project's headless suite.

## Model notes

- Tested against 7–8B models (`llama3.1:8b`, `qwen2.5:7b`, `mistral`). Anything
  smaller struggles to keep the JSON shape twice in a row; the retry usually saves
  it, but expect more retells.
- `temperature 0.95` first attempt, `0.8` on retry — the retry is the "please
  just give me valid JSON" attempt.
- Keep the browser tab and Ollama on the same machine. If you put this on your
  LAN, point `OLLAMA_URL` at the host (`OLLAMA_URL=http://192.168.1.50:11434
  python3 tools/ollama-proxy.py`) and open the proxy's port, not Ollama's.
- First token from a cold 8B model can take 10–25 s. The status dot goes amber and
  the reader gets a soft inner glow while it waits — that's expected, not a hang.
