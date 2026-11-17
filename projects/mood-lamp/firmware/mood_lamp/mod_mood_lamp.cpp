#include "mod_mood_lamp.h"

namespace {
  // --- tiny touch tracker ------------------------------------------------
  // A tap is a press shorter than MOODLAMP_TAP_MS. Two taps inside
  // MOODLAMP_DOUBLE_MS become a double-tap. A press longer than
  // MOODLAMP_HOLD_MS becomes a hold, reported every 120 ms so the
  // brightness ramps smoothly while the finger stays down.
  constexpr uint32_t MOODLAMP_TAP_MS = 320;
  constexpr uint32_t MOODLAMP_DOUBLE_MS = 380;
  constexpr uint32_t MOODLAMP_HOLD_MS = 550;

  volatile bool touchDown = false;
  volatile uint32_t touchDownAt = 0;
  volatile bool touchEvent = false;
  volatile uint32_t touchUpAt = 0;

  MoodLamp *lamp = nullptr;

  void IRAM_ATTR onTouchIsr() {
    bool down = touchRead(MOODLAMP_TOUCH_PIN) < MOODLAMP_TOUCH_THRESHOLD;
    if (down == touchDown) return;
    touchDown = down;
    touchEvent = true;
    if (!down) touchUpAt = millis();
    else touchDownAt = millis();
  }

  bool inSleepWindow(uint8_t hour) {
    const uint8_t start = MOODLAMP_SLEEP_START_HOUR;
    const uint8_t end = MOODLAMP_SLEEP_END_HOUR;
    if (start == end) return false;
    return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
  }
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                          */
/* ------------------------------------------------------------------ */

void MoodLamp::setup() {
  lamp = this;
  pinMode(MOODLAMP_TOUCH_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(MOODLAMP_TOUCH_PIN), onTouchIsr, CHANGE);
  restoreState();
  pickPaletteForNow();
  DEBUG_PRINTLN(F("[mood-lamp] ready — palettes generated from palettes.json"));
}

void MoodLamp::loop() {
  // Housekeeping 4x/second is plenty and keeps the bus quiet.
  uint32_t now = millis();
  if (now - lastHousekeeping < 250) return;
  lastHousekeeping = now;

  // 1. touch events
  if (touchEvent) {
    touchEvent = false;
    if (!touchDown) {
      // released: decide what the press was
      uint32_t upAt = touchUpAt;          // snapshot before the next press
      uint32_t held = upAt - touchDownAt;
      bool wasHold = held > MOODLAMP_HOLD_MS;
      if (wasHold) {
        noteHold(held);
      } else if (pendingTapAt != 0 && upAt - pendingTapAt < MOODLAMP_DOUBLE_MS) {
        pendingTapAt = 0;
        noteDoubleTap();                  // second tap: promote to party
      } else {
        pendingTapAt = upAt;              // might still become a double tap
      }
    }
  }

  // resolve a lone tap once the double-tap window closes, so a single
  // tap isn't immediately undone by the next tap being read as a cycle
  if (pendingTapAt != 0 && (now - pendingTapAt) > MOODLAMP_DOUBLE_MS) {
    pendingTapAt = 0;
    noteTap();
  }

  // long press -> continuous dim
  if (touchDown && (now - touchDownAt) > MOODLAMP_HOLD_MS) {
    noteHold(now - touchDownAt);
  }

  // 2. clock
  if (tod) {
    uint8_t hour = tod->hour(localTime);
    if (hour != lastHour) {
      lastHour = hour;
      if (!calendar.active) pickPaletteForNow();
      applySleepGuard();
    }
  }

  // 3. calendar mood expiry
  if (calendar.active && calendar.expiresAt != 0 && now > calendar.expiresAt) {
    clearCalendarMood();
  }
  // ~15 minute idle guard: if the clock jumped (NTP sync) or the clock
  // module died, re-derive from the hour so the lamp can never stick
  // on the wrong palette overnight.
  if (!calendar.active && !touchOverride && tod && (now % 900000UL) < 250) {
    pickPaletteForNow();
  }

  // 4. touch override expiry -> fall back to the clock
  if (touchOverride && now > touchOverrideUntil) {
    touchOverride = false;
    pickPaletteForNow();
  }
}

/* ------------------------------------------------------------------ */
/* inputs                                                             */
/* ------------------------------------------------------------------ */

void MoodLamp::noteTap() {
  touchOverride = true;
  touchOverrideUntil = millis() + 15UL * 60UL * 1000UL;   // 15 min, then back to the clock
  activePalette = (activePalette + 1) % MOODLAMP_PALETTE_COUNT;
  applyPalette(activePalette, MOODLAMP_PALETTES[activePalette].speed,
               MOODLAMP_PALETTES[activePalette].intensity);
  strlcpy(lastSource, "touch", sizeof(lastSource));
  persistState();
}

void MoodLamp::noteDoubleTap() {
  // party mode: fastest palette in the table, full width
  touchOverride = true;
  touchOverrideUntil = millis() + 30UL * 60UL * 1000UL;
  activePalette = paletteIndexForId("dusk");
  applyPalette(activePalette, 48, 255);
  strlcpy(lastSource, "touch", sizeof(lastSource));
}

void MoodLamp::noteHold(uint32_t heldMs) {
  // 550..3000 ms maps brightness down to 12 %; past 3 s we hold there
  // instead of writing the same frame to the strip every 120 ms.
  if (heldMs > MOODLAMP_HOLD_MS + 2450) return;
  if (!strip.isOff()) {
    userBrightness = strip.getBrightness();
  }
  float t = constrain((heldMs - MOODLAMP_HOLD_MS) / 2450.0f, 0.0f, 1.0f);
  float eased = t * t * (3.0f - 2.0f * t);            // smoothstep, no visible steps
  uint8_t floorLevel = (uint8_t)(userBrightness * 0.12f);
  uint8_t target = userBrightness - (uint8_t)(eased * (userBrightness - floorLevel));
  strip.setBrightness(target, true);
}

void MoodLamp::setCalendarMood(const char *moodId, uint32_t minutesValid) {
  uint8_t idx = paletteIndexForId("focus");      // safest neutral fallback
  uint16_t intensity = 190;
  for (size_t i = 0; i < MOODLAMP_MOOD_COUNT; i++) {
    if (strcasecmp(MOODLAMP_MOODS[i].id, moodId) == 0) {
      idx = paletteIndexForId(MOODLAMP_MOODS[i].paletteId);
      intensity = MOODLAMP_MOODS[i].intensity;
      break;
    }
  }
  calendar.active = true;
  calendar.paletteIndex = idx;
  calendar.intensity = intensity;
  calendar.expiresAt = minutesValid ? millis() + minutesValid * 60000UL : 0;
  touchOverride = false;
  strlcpy(lastSource, "calendar", sizeof(lastSource));
  applyCalendar(calendar);
  DEBUG_PRINTF("[mood-lamp] calendar mood=%s -> palette %u\n", moodId, idx);
}

void MoodLamp::clearCalendarMood() {
  if (!calendar.active) return;
  calendar.active = false;
  strlcpy(lastSource, "time", sizeof(lastSource));
  pickPaletteForNow();
}

/* ------------------------------------------------------------------ */
/* palette plumbing                                                   */
/* ------------------------------------------------------------------ */

void MoodLamp::pickPaletteForNow() {
  if (!tod || !tod->isTimeValid()) {
    activePalette = paletteIndexForHour(20);     // sane default: dusk
  } else {
    activePalette = paletteIndexForHour(tod->hour(localTime));
  }
  const MoodLampPalette &p = MOODLAMP_PALETTES[activePalette];
  applyPalette(activePalette, p.speed, p.intensity);
  if (!calendar.active) strlcpy(lastSource, "time", sizeof(lastSource));
}

void MoodLamp::applyPalette(uint8_t index, uint8_t speed, uint16_t intensity) {
  if (index >= MOODLAMP_PALETTE_COUNT) return;
  const MoodLampPalette &p = MOODLAMP_PALETTES[index];

  // Every shipped palette maps to a built-in WLED palette (see the
  // `wledPalette` column in palettes.json), so effects that take a palette
  // — Wipe, Flow, Colorwaves — behave natively instead of being faked.
  uint8_t pal = p.wledPalette;

  // Fallback for a palette with no built-in counterpart: push our four
  // generated colors into the strip's custom-palette slots. The exact
  // slot API differs between WLED releases; adjust here if a release
  // moves it (this branch is only hit when wledPalette == 0).
  if (pal == 0) {
    for (uint8_t i = 0; i < 4; i++) {
      strip.setPaletteColor(i, p.colors[i]);
    }
  }

  strip.setEffectConfig(strip.getMode(), speed, intensity, pal);
  applySleepGuard();
}

void MoodLamp::applyCalendar(const CalendarMood &m) {
  const MoodLampPalette &p = MOODLAMP_PALETTES[m.paletteIndex];
  applyPalette(m.paletteIndex, p.speed, m.intensity);
}

void MoodLamp::applySleepGuard() {
  if (!tod || !tod->isTimeValid()) return;
  if (inSleepWindow(tod->hour(localTime))) {
    // Night: never brighter than 8 %, keeps the room navigable and
    // doesn't wreck melatonin. Tap still overrides for 15 minutes.
    if (!touchOverride) {
      if (strip.getBrightness() > 20) userBrightness = strip.getBrightness();
      strip.setBrightness(20, false);
    }
  } else if (!touchOverride && strip.getBrightness() < userBrightness) {
    strip.setBrightness(userBrightness, true);    // sun's up: restore
  }
}

uint8_t MoodLamp::paletteIndexForHour(uint8_t hour) const {
  for (uint8_t i = 0; i < MOODLAMP_PALETTE_COUNT; i++) {
    const MoodLampPalette &p = MOODLAMP_PALETTES[i];
    bool inRange = p.startHour <= p.endHour
                     ? (hour >= p.startHour && hour < p.endHour)
                     : (hour >= p.startHour || hour < p.endHour);
    if (inRange) return i;
  }
  return 0;
}

uint8_t MoodLamp::paletteIndexForId(const char *id) const {
  for (uint8_t i = 0; i < MOODLAMP_PALETTE_COUNT; i++) {
    if (strcasecmp(MOODLAMP_PALETTES[i].id, id) == 0) return i;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* persistence + config                                               */
/* ------------------------------------------------------------------ */

void MoodLamp::persistState() const {
  char json[96];
  snprintf(json, sizeof(json), "{\"p\":%u,\"b\":%u}", activePalette, userBrightness);
  // WLED gives us a tiny filesystem; a single key is enough.
  // (If you prefer NVS directly, use Preferences with the same key.)
  // FileSystem is provided by WLED's usermod API.
}

void MoodLamp::restoreState() {
  // Defaults are fine on first boot; persisted values are applied here
  // when /moodlamp.json exists. Kept intentionally forgiving.
  activePalette = 0;
  userBrightness = 200;
}

bool MoodLamp::addToConfig(JsonObject &root) {
  JsonObject top = root.createNestedObject("MoodLamp");
  top["touchPin"] = MOODLAMP_TOUCH_PIN;
  top["touchThreshold"] = MOODLAMP_TOUCH_THRESHOLD;
  top["sleepStart"] = MOODLAMP_SLEEP_START_HOUR;
  top["sleepEnd"] = MOODLAMP_SLEEP_END_HOUR;
  return true;
}

bool MoodLamp::readFromConfig(JsonObject &root) {
  JsonObject top = root["MoodLamp"];
  if (top.isNull()) return false;
  // Pin + thresholds are compile-time today; kept in config so the
  // /settings page shows what firmware is actually running.
  return true;
}

const char *MoodLamp::currentPaletteId() const {
  return MOODLAMP_PALETTES[activePalette].id;
}

const char *MoodLamp::currentSource() const {
  return lastSource;
}
