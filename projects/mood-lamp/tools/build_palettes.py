#!/usr/bin/env python3
"""
Generate the firmware palette table from palettes.json.

One source of truth (palettes.json) feeds three consumers:

  firmware/mood_lamp/palettes_generated.h   <- C table for the WLED usermod
  simulator/palettes.js                     <- ES module for the Lamp Studio
  (the standalone .ino carries its own copy by design: it has no build step)

Run:  python3 tools/build_palettes.py
"""

from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "palettes.json"
H_OUT = ROOT / "firmware" / "mood_lamp" / "palettes_generated.h"
JS_OUT = ROOT / "simulator" / "palettes.js"


def norm_hex(value: str) -> str:
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        raise ValueError(f"bad color: {value!r}")
    return value.upper()


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def build_header(data: dict) -> str:
    pals = data["palettes"]
    moods = data["calendarMoods"]

    lines = [
        "// GENERATED FILE — do not edit.",
        "// Source: projects/mood-lamp/palettes.json",
        "// Regenerate: python3 projects/mood-lamp/tools/build_palettes.py",
        "#pragma once",
        "#include <Arduino.h>",
        "",
        "struct MoodLampPalette {",
        "  const char *id;",
        "  uint8_t startHour;",
        "  uint8_t endHour;",
        "  uint32_t colors[4];   // 0xRRGGBB, brightest first",
        "  uint8_t speed;",
        "  uint8_t intensity;    // 0-255 target brightness",
        "  uint8_t wledPalette;  // matching built-in WLED palette (0 = custom)",
        "};",
        "",
        "struct MoodLampMood {",
        "  const char *id;",
        "  const char *paletteId;",
        "  uint8_t intensity;",
        "};",
        "",
        "static const MoodLampPalette MOODLAMP_PALETTES[] = {",
    ]
    for p in pals:
        colors = ", ".join(f"0x{norm_hex(c)}" for c in p["colors"])
        assert len(p["colors"]) == 4, f"{p['id']} needs exactly 4 colors"
        lo, hi = p["hours"]
        lines.append(
            f'  {{"{p["id"]}", {lo:>2}, {hi:>2}, {{{colors}}}, '
            f'{p["speed"]:>2}, {p["intensity"]:>3}, {p.get("wledPalette", 0):>2}}},'
        )
    lines += [
        "};",
        "static const size_t MOODLAMP_PALETTE_COUNT = "
        "sizeof(MOODLAMP_PALETTES) / sizeof(MOODLAMP_PALETTES[0]);",
        "",
        "static const MoodLampMood MOODLAMP_MOODS[] = {",
    ]
    for m in moods:
        lines.append(
            f'  {{"{m["id"]}", "{m["palette"]}", {m["intensity"]}}},'
        )
    lines += [
        "};",
        "static const size_t MOODLAMP_MOOD_COUNT = "
        "sizeof(MOODLAMP_MOODS) / sizeof(MOODLAMP_MOODS[0]);",
        "",
        "// Keyword lists, grouped so the matcher can scan them cheaply.",
    ]
    for m in moods:
        ident = "kMoodKeywords_" + slug(m["id"])
        body = ", ".join(f'"{k}"' for k in m["match"])
        lines.append(f"static const char *const {ident}[] = {{{body}}};")
        lines.append(
            f"static const uint8_t {ident}_count = "
            f"sizeof({ident}) / sizeof({ident}[0]);"
        )
    lines.append("")
    return "\n".join(lines)


def build_js(data: dict) -> str:
    payload = {
        "version": data.get("version", 1),
        "palettes": data["palettes"],
        "calendarMoods": data["calendarMoods"],
    }
    return (
        "// GENERATED FILE — do not edit.\n"
        "// Source: projects/mood-lamp/palettes.json\n"
        "// Regenerate: python3 projects/mood-lamp/tools/build_palettes.py\n"
        "// Plain global (not an ES module) so the simulator also works\n"
        "// when opened straight off disk with file://.\n"
        "window.MOODLAMP = "
        + json.dumps(payload, indent=2)
        + ";\n"
    )


def main() -> None:
    data = json.loads(SRC.read_text())
    ids = [p["id"] for p in data["palettes"]]
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate palette ids in palettes.json")

    # every calendar mood must point at a real palette
    for m in data["calendarMoods"]:
        if m["palette"] not in ids:
            raise SystemExit(f"mood {m['id']} -> unknown palette {m['palette']}")

    H_OUT.write_text(build_header(data))
    JS_OUT.write_text(build_js(data))
    print(f"wrote {H_OUT.relative_to(ROOT)}")
    print(f"wrote {JS_OUT.relative_to(ROOT)}")
    print(f"{len(ids)} palettes, {len(data['calendarMoods'])} calendar moods")


if __name__ == "__main__":
    main()
