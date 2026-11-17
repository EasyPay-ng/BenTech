#pragma once

/*
 * MoodLamp — a WLED usermod
 * -------------------------------------------------------------
 * Turns an ESP32 + WLED lamp into something with a sense of time:
 *
 *   1. A palette for the hour of the day (dawn, focus, dusk, night...)
 *   2. A palette for what your calendar says you're doing
 *      (meeting = neutral, gym = drive, rest = low and warm-free)
 *   3. Touch controls: tap to cycle, hold to dim, double-tap for party
 *
 * The palette table is generated from ../../palettes.json by
 * ../../tools/build_palettes.py — edit the JSON, not the generated file.
 *
 * Build: drop this folder into WLED/usermods/ and uncomment
 *   -D USERMOD_MOOD_LAMP
 * in the WLED platformio environment flags (or copy ./platformio_override.ini).
 */

#include "wled.h"

// Generated: do not hand-edit. See tools/build_palettes.py
#include "palettes_generated.h"

#ifndef MOODLAMP_TOUCH_PIN
#define MOODLAMP_TOUCH_PIN 27
#endif

#ifndef MOODLAMP_TOUCH_THRESHOLD
#define MOODLAMP_TOUCH_THRESHOLD 2200
#endif

#ifndef MOODLAMP_SLEEP_START_HOUR
#define MOODLAMP_SLEEP_START_HOUR 23
#endif

#ifndef MOODLAMP_SLEEP_END_HOUR
#define MOODLAMP_SLEEP_END_HOUR 6
#endif

// Calendar moods arrive over MQTT from Home Assistant (or anything else):
//   topic:   wled/<device>/mood
//   payload: {"mood":"meeting","minutes":30}
//
// WLED's usermod MQTT hooks are version-specific; runWledMoodTopic() is
// called from loop() after the bridge posts into usermodMoodInbox().
class MoodLamp {
public:
  void setup();
  void loop();

  bool addToConfig(JsonObject &root);
  bool readFromConfig(JsonObject &root);

  // --- inputs (called by touch ISR / MQTT bridge / HTTP) ---
  void noteTap();
  void noteDoubleTap();
  void noteHold(uint32_t heldMs);
  void setCalendarMood(const char *moodId, uint32_t minutesValid);
  void clearCalendarMood();

  // --- state ---
  const char *currentPaletteId() const;
  const char *currentSource() const;   // "time" | "calendar" | "touch"
  uint8_t currentPaletteIndex() const { return activePalette; }

private:
  struct CalendarMood {
    bool active = false;
    uint8_t paletteIndex = 0;
    uint16_t intensity = 180;
    uint32_t expiresAt = 0;    // millis(); 0 = never
  };

  void pickPaletteForNow();
  void applyPalette(uint8_t index, uint8_t speed, uint16_t intensity);
  void applyCalendar(const CalendarMood &m);
  void applySleepGuard();
  uint8_t paletteIndexForHour(uint8_t hour) const;
  uint8_t paletteIndexForId(const char *id) const;
  void persistState() const;
  void restoreState();

  CalendarMood calendar;
  uint8_t activePalette = 0;
  bool touchOverride = false;
  uint32_t touchOverrideUntil = 0;
  uint8_t lastHour = 255;
  uint8_t userBrightness = 200;      // remembered across sleep windows
  uint32_t lastHousekeeping = 0;
  uint32_t pendingTapAt = 0;   // millis() of an unresolved single tap
  char lastSource[12] = "time";
};
