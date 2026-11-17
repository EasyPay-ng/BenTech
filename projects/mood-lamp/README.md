# Mood Lamp — ESP32 + WLED + touch

A lamp that knows what time it is and what you're doing.

- **Hour of day** picks a palette: dawn, morning, focus, golden hour, dusk,
  wind-down, night.
- **Your calendar** overrides it. A meeting makes the lamp neutral white so you
  look right on video calls; the gym makes it warm and driving; "rest" takes it
  low and amber-free.
- **One capacitive pad, no screen.** Tap = next palette, double tap = party,
  hold = dim. Each touch locks its own choice for 15 minutes, then the lamp goes
  back to being a clock.
- **A sleep guard**: between 23:00 and 06:00 nothing is brighter than ~8% unless
  you deliberately tap it. Cheap melatonin protection.

There is a live simulator at [`simulator/index.html`](simulator/index.html) that
runs the exact same precedence rules (calendar > touch > clock > sleep guard) in
the browser, so you can feel the behaviour before you solder anything.

## Two ways to build it

### A. Standalone sketch (easier, recommended)

The ESP32 keeps its own sketch and drives a **stock WLED** instance over its HTTP
JSON API. You keep updating WLED independently; no patching.

```
firmware/mood_lamp/
├── mood_lamp_main.ino     the whole sketch (palette loop, touch, MQTT, NTP)
├── config.example.h       copy to config.h, fill in WiFi/WLED/MQTT
├── platformio.ini         pio run -t upload
└── palettes_generated.h   generated from palettes.json
```

```bash
cp config.example.h config.h    # edit credentials
pio run -t upload
pio device monitor
```

Serial output tells you exactly why the lamp did what it did:

```
[mood-lamp] evening               -> dusk       bri=120 http=200 (...)
[mood-lamp] calendar 'Team standup' -> focus    for 30 min
[mood-lamp] calendar event expired -> back to the clock
```

### B. WLED usermod (the lamp *is* WLED)

Copy `mod_mood_lamp.h` / `.cpp` / `palettes_generated.h` into
`WLED/usermods/mood_lamp/`, then add `-D USERMOD_MOOD_LAMP` to your WLED build
flags (or use `platformio_override.ini`).

```bash
git clone https://github.com/Aircoookie/WLED
cd WLED
mkdir -p usermods/mood_lamp
cp /path/to/BenTech/projects/mood-lamp/firmware/mood_lamp/{mod_mood_lamp.h,mod_mood_lamp.cpp,palettes_generated.h} usermods/mood_lamp/
# add  -D USERMOD_MOOD_LAMP  to build_flags in platformio_override.ini
pio run -e esp32dev -t upload
```

The usermod path gives you the palette logic *inside* WLED's effect engine, which
is nicer for synced strips and presets. The standalone path is less fragile.

> The usermod touches a few WLED internals (`strip.setEffectConfig`,
> `strip.setPaletteColor`, `tod`). If a WLED release moves them, the standalone
> sketch still works — that's why both exist.

## Hardware

| Part | Note | Approx. |
| --- | --- | --- |
| ESP32 WROOM-32 dev board | any 30/38-pin clone is fine | $4–7 |
| WS2812B strip, 60 LED/m, 1–2 m | 5 V, ~18 W/m at full white | $8–20 |
| 5 V 3 A supply | 5 A if you go past ~150 LEDs | $6 |
| TTP223 capacitive touch module | or a bare copper pad on GPIO 27 | $0.5 |
| 330 Ω resistor | in series with DIN — protects the first LED | — |
| 1000 µF electrolytic | across 5 V/GND at the strip end | — |
| Old lamp shade / frosted tube | diffusion is 80% of the look | — |

Wiring:

```
strip 5V   ← PSU 5V          strip GND ← PSU GND ──┬── ESP32 GND   (common ground, always)
strip DIN  ← ESP32 GPIO5 (through 330 Ω)
TTP223 VCC → ESP32 3V3       TTP223 GND → ESP32 GND
TTP223 OUT → ESP32 GPIO27    TTP223 I/O pad → copper tape on the shade
```

Two things that cost people evenings: **inject power** every ~150 LEDs and put
the 1000 µF cap at the strip's 5 V terminals, and **never** power a long strip
through the ESP32's 5 V pin.

## Palettes

`palettes.json` is the single source of truth, and it feeds three things:

```bash
python3 tools/build_palettes.py
```

```
palettes.json ──┬──> firmware/mood_lamp/palettes_generated.h   (usermod C table)
                └──> simulator/palettes.js                     (Lamp Studio)
```

Each palette is `hours` + 4 `colors` + `speed` + `intensity`. Each calendar mood
is a keyword list + target palette. Edit, regenerate, reflash. The script
validates: exactly four colors, no duplicate ids, every mood points at a real
palette.

The standalone `.ino` keeps its own copy of the table deliberately — it has no
build step, and duplicating eight lines is cheaper than a codegen dependency.

## Calendar → lamp

Anything that can publish MQTT can drive it. Home Assistant automation:

```yaml
- alias: Mood lamp follows calendar
  trigger:
    - platform: state
      entity_id: calendar.work
  action:
    - service: mqtt.publish
      data:
        topic: wled/lamp/mood
        payload: >
          {"mood": "{{ trigger.to_state.attributes.description | default('focus') }}",
           "minutes": 45}
```

Matching is **keyword** based, not exact, so "Design sync with Tunde" hits
`sync` → neutral focus lighting. Unknown moods are logged and ignored — the lamp
never guesses.

Node-RED users: one `mqtt out` node to the same topic is enough. Google Calendar
→ Node-RED → MQTT works fine.

## Tuning notes

- **Brightness ceilings** are per palette in `intensity`. Night is 28/255 on
  purpose. If your room is dark and 28 is too much, lower it in the JSON.
- **Effect choice**: the standalone sketch maps palettes to WLED's built-in
  palette/effect ids. Those ids shift between WLED releases — check
  `http://<lamp>/json/palettes` and adjust `wledPaletteIndex()`.
- **Touch sensitivity** with a bare pad is a `touchRead()` threshold problem;
  print raw values over serial and set `MOODLAMP_TOUCH_THRESHOLD` to roughly the
  midpoint between idle and touched.
- **Hold-to-dim** is smoothstepped over 2.45 s from the current level down to
  12%. It doesn't fight the palette; it returns to the palette's intensity on the
  next hour change.

## Tests

From the repo root: `./tests/run.sh` — includes this project's headless suite.

## Tests (no hardware needed)

```bash
# firmware decision logic: hour -> palette, sleep window, mood keywords
g++ -std=c++11 -O2 -o /tmp/test_logic tools/test_logic.cpp && /tmp/test_logic

# regenerate the palette tables after editing palettes.json
python3 tools/build_palettes.py
```

The C++ test deliberately mirrors the palette table instead of including the
generated header, so a broken generator shows up as a failing test rather than a
silently consistent pair of files.

## What this cost, and what I'd change

The lamp is the one that needs the least screen and the most physical iteration.
Two things worth knowing before you build:

- **Touch is the fiddly part, not the LEDs.** A bare copper pad behind a plastic
  shade moves its baseline capacitance with humidity and with how close your hand
  is to the shade. Print raw `touchRead()` values for a day before trusting a
  threshold; the TTP223 route costs $0.50 and removes the problem entirely.
- **The calendar bridge is where the real value is**, and it lives outside this
  repo (Home Assistant / Node-RED). The firmware only needs one MQTT topic and a
  keyword list — keep it that way, and the lamp stays useful when you swap
  calendar providers.
