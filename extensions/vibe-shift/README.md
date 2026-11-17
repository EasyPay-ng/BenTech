# Vibe Shift — a reskin engine for the web

A Manifest V3 browser extension that injects CSS (and a little JS) to change how
sites feel. Two themes ship today:

| Theme | Site | What it does |
| --- | --- | --- |
| **Terminal** | `*.wikipedia.org` | Green-phosphor TTY. Scanlines, blinking caret, `cat ./article` title, dithered images, `$$`-prompt search. |
| **Vaporwave Dream** | `x.com`, `twitter.com` | Sunset grid horizon, frosted-glass columns, gradient serif headings, pink/cyan glow on every control, plus a small HUD strip. |

Nothing is stripped from the page: links, search, editing, composing and infinite
scroll all keep working. The themes are pure CSS with a couple of polite JS
behaviours, so a site redesign can't break the functionality — only the looks.

## Install (unpacked, ~30 seconds)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `extensions/vibe-shift` folder.
4. Visit `en.wikipedia.org` or `x.com`. It is already on.

Firefox: `about:debugging` → *This Firefox* → **Load Temporary Add-on** →
pick `manifest.json`. MV3 support in Firefox is fine for `storage` +
content scripts, which is all this uses.

## Using it

The toolbar popup is the whole control surface:

- one toggle per theme (saved in `chrome.storage.sync`, so it follows your profile)
- **Intensity** slider — `--vibeshift-intensity` drives glow, HUD opacity and
  the vaporwave haze. `0` is a whisper, `1` is a fever dream.
- **Dream HUD** — the little "vibe ::" pill at the bottom of X.
- A `live on this tab` chip tells you which theme is active for the tab you're on.

Toggling reloads the tab. The intensity slider and HUD apply live via
`chrome.storage.onChanged` — no reload, no flicker.

## How it's built

```
manifest.json            MV3, 3 host patterns, storage + activeTab only
src/themes.js            registry: id -> CSS file, host matchers, behaviours
src/apply.js             bootstrap: detect host -> inject <link> -> run behaviours
src/popup.html/.css/.js  settings UI (no inline styles; MV3 blocks them)
themes/*.css             one file per reskin
icons/*.png              generated split-swatch icons
```

Design rules that keep it honest:

- **Injected at `document_start`**, before paint, so there's no flash of stock
  Wikipedia or stock Twitter.
- **No `!important` carpet-bombing of layout.** Colors, type, borders and
  shadows are overridden; `display`, `position`, `width` mostly are not, so
  responsive behaviour and keyboard navigation survive.
- **`@media (prefers-reduced-motion: reduce)`** kills all animation in both themes.
- **No remote code, no network requests, no analytics.** `host_permissions`
  lists exactly the three site families it works on.
- Theme CSS is the only web-accessible resource, and only to those hosts.

### Add a third reskin

1. Drop `themes/my-theme.css` in.
2. Add an entry to `THEMES` in `src/themes.js` and to the `THEMES` array in
   `src/popup.js` (the two lists are intentionally duplicated so the popup needs
   no bundler).
3. Add your host pattern to `host_permissions`, `content_scripts.matches` and
   `web_accessible_resources.matches` in `manifest.json`.

Keep the CSS scoped to structural selectors and it'll survive site updates.

## Tests

From the repo root: `./tests/run.sh` — includes this project's headless suite.

## Known limits

- X/Twitter ships obfuscated class names (`.css-175oi2r`) that change between
  deploys. The vaporwave theme leans on `data-testid` attributes instead, which
  X keeps stable for automation — that's the durable surface.
- Wikipedia's Vector 2022 skin uses a lot of `!important` of its own. A couple of
  overrides need the extra weight; if a release breaks one, re-check
  `#content`/`.mw-body` first.
- The terminal theme deliberately keeps images (dithered) rather than hiding
  them; hiding them tends to break layout and reading flow on science articles.
