/*
 * Mood Lamp — ESP32 + WLED + capacitive touch
 * ---------------------------------------------------------------
 * Standalone sketch for people who don't want to patch WLED.
 * Talks to a stock WLED instance over its JSON API, so you can keep
 * flashing WLED releases without recompiling this file.
 *
 *   Hardware
 *     ESP32 dev board (any WROOM-32)
 *     WS2812B strip, 5 V, inject power every ~150 LEDs
 *     TTP223 or a bare copper pad on GPIO 27 (capacitive touch)
 *     5 V 3 A supply (separate from the ESP32 if the strip is long)
 *
 *   Wiring
 *     strip DIN  -> GPIO 5  (through 330 R)
 *     strip GND  -> PSU GND + ESP32 GND  (common ground, always)
 *     touch OUT  -> GPIO 27 (TTP223 VCC 3V3, GND)
 *
 *   Firmware side
 *     - keeps time with NTP
 *     - picks a palette from the hour of the day (tables below)
 *     - accepts calendar moods over MQTT: wled/lamp/mood {"mood":"meeting"}
 *     - touch: tap = next palette, double tap = party, hold = dim
 *
 *   See ../README.md for the full build + print list.
 */

#include <WiFi.h>
#include <strings.h>        // strcasestr
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <PubSubClient.h>

#include "config.h"        // copy config.example.h -> config.h and edit

// ------------------------------------------------------------------
// palette table: mirrors ../../palettes.json
// ------------------------------------------------------------------
struct Palette {
  const char *id;
  uint8_t startHour;
  uint8_t endHour;
  uint32_t colors[4];
  uint8_t speed;
  uint8_t intensity;
};

static const Palette PALETTES[] = {
  {"dawn",      5,  8,  {0x2b1b4d, 0x8f4a8a, 0xff8a6b, 0xffd08a},  6,  90},
  {"morning",   8,  11, {0xfff3d6, 0xffe3a3, 0xc9f2ff, 0xfffaf0}, 12, 200},
  {"focus",     11, 16, {0xe8f4ff, 0xb7d8ff, 0xffffff, 0xa8cfff},  4, 215},
  {"golden",    16, 19, {0xffb347, 0xff7a3d, 0xffd98a, 0xc2410c},  9, 170},
  {"dusk",      19, 21, {0x7b2d8b, 0xff5f9e, 0x3b1e63, 0xffa8c8}, 14, 120},
  {"wind-down", 21, 23, {0x241447, 0x4b2a72, 0x8a5aa8, 0x2a1a3d},  8,  70},
  {"night",     23,  5, {0x0b1026, 0x1b2a5e, 0x2f4a8c, 0x090d1c},  3,  28},
};
static const size_t PALETTE_COUNT = sizeof(PALETTES) / sizeof(PALETTES[0]);

struct MoodRule {
  const char *id;
  const char *const *keywords;
  uint8_t keywordCount;
  const char *paletteId;
  uint8_t intensity;
};

static const char *const kMeeting[]  = {"meeting", "standup", "stand-up", "sync", "call", "interview", "1:1", "review", "class", "lecture"};
static const char *const kDeepWork[] = {"focus", "deep work", "writing", "study", "revision", "deadline", "sprint"};
static const char *const kWorkout[]  = {"gym", "run", "workout", "training", "football", "match", "hiit"};
static const char *const kSocial[]   = {"birthday", "party", "dinner", "hangout", "wedding", "celebration", "drinks"};
static const char *const kRest[]     = {"sleep", "nap", "rest", "therapy", "meditation", "quiet"};

static const MoodRule MOODS[] = {
  {"meeting",  kMeeting,  10, "focus",     190},
  {"deepwork", kDeepWork,  7, "morning",   205},
  {"workout",  kWorkout,   7, "golden",    220},
  {"social",   kSocial,    7, "dusk",      150},
  {"rest",     kRest,      6, "wind-down",  60},
};
static const size_t MOOD_COUNT = sizeof(MOODS) / sizeof(MOODS[0]);

// ------------------------------------------------------------------
// state
// ------------------------------------------------------------------
WiFiClient net;
PubSubClient mqtt(net);
uint32_t nextMqttAttempt = 0;    // backoff: no reconnect storm while offline

uint8_t activePalette = 0;
uint8_t userBrightness = 200;
char source[12] = "time";
bool calendarActive = false;
uint8_t calendarPalette = 2;
uint8_t calendarIntensity = 190;
uint32_t calendarExpiresAt = 0;

bool touchDown = false;
uint32_t touchDownAt = 0;
uint32_t pendingTapAt = 0;       // resolved once the double-tap window closes
bool touchOverride = false;
uint32_t touchOverrideUntil = 0;

uint8_t lastHour = 255;
uint32_t lastHousekeeping = 0;

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
static const Palette &paletteById(const char *id) {
  for (size_t i = 0; i < PALETTE_COUNT; i++)
    if (strcasecmp(PALETTES[i].id, id) == 0) return PALETTES[i];
  return PALETTES[2];             // focus
}

static uint8_t paletteIndexById(const char *id) {
  for (size_t i = 0; i < PALETTE_COUNT; i++)
    if (strcasecmp(PALETTES[i].id, id) == 0) return i;
  return 2;
}

static uint8_t paletteIndexForHour(uint8_t hour) {
  for (uint8_t i = 0; i < PALETTE_COUNT; i++) {
    const Palette &p = PALETTES[i];
    bool in = p.startHour <= p.endHour
                ? (hour >= p.startHour && hour < p.endHour)
                : (hour >= p.startHour || hour < p.endHour);
    if (in) return i;
  }
  return 0;
}

static bool inSleepWindow(uint8_t hour) {
  if (SLEEP_START_HOUR == SLEEP_END_HOUR) return false;
  return SLEEP_START_HOUR > SLEEP_END_HOUR
           ? (hour >= SLEEP_START_HOUR || hour < SLEEP_END_HOUR)
           : (hour >= SLEEP_START_HOUR && hour < SLEEP_END_HOUR);
}

// Built-in WLED palette + effect pairings. WLED renumbers palettes between
// releases, so verify these against your /json/palettes before trusting them.
static uint8_t wledPaletteIndex(const char *id) {
  if (!strcasecmp(id, "dawn"))      return 19;   // Sunset
  if (!strcasecmp(id, "morning"))   return 38;   // Snow / soft bright
  if (!strcasecmp(id, "focus"))     return 37;   // Breeze
  if (!strcasecmp(id, "golden"))    return 10;   // Autumn
  if (!strcasecmp(id, "dusk"))      return 13;   // Aurora
  if (!strcasecmp(id, "wind-down")) return 12;   // Beech
  if (!strcasecmp(id, "night"))     return 14;   // Vintage
  return 0;                                      // 0 = use the i[] colors above
}

static uint8_t wledEffectIndex(const char *id) {
  if (!strcasecmp(id, "morning") || !strcasecmp(id, "focus")) return 101; // Wipe
  if (!strcasecmp(id, "dusk"))                                return 65;  // Colorwaves
  return 0;                                                              // Solid
}

static uint8_t currentHour() {
  struct tm t;
  if (!getLocalTime(&t, 20)) return 255;
  return (uint8_t)t.tm_hour;
}

// Push a state to WLED over its HTTP JSON API.
// mode 101 = "Wipe", which honours a palette nicely; swap if you prefer.
static void applyToWled(const Palette &p, uint8_t intensity, const char *reason) {
  if (WiFi.status() != WL_CONNECTED) return;

  StaticJsonDocument<512> seg;
  seg["on"] = true;
  seg["bri"] = intensity;
  JsonArray segs = seg.createNestedArray("seg");
  JsonObject s0 = segs.createNestedObject();
  s0["n"] = "mood";
  s0["i"] = {
    ARGB32(p.colors[0]), ARGB32(p.colors[1]),
    ARGB32(p.colors[2]), ARGB32(p.colors[3])
  };
  s0["pal"] = wledPaletteIndex(p.id);    // built-in WLED palette...
  s0["fx"] = wledEffectIndex(p.id);      // ...and the effect that shows it off
  s0["sx"] = p.speed;

  String body;
  serializeJson(seg, body);

  HTTPClient http;
  http.begin(WLED_HOST, WLED_PORT, "/json/state");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();

  Serial.printf("[mood-lamp] %-9s -> %-9s bri=%u http=%d (%s)\n",
                p.id, reason, intensity, code, body.c_str());
}

void cyclePalette() {
  activePalette = (activePalette + 1) % PALETTE_COUNT;
  touchOverride = true;
  touchOverrideUntil = millis() + 15UL * 60UL * 1000UL;
  strlcpy(source, "touch", sizeof(source));
  applyToWled(PALETTES[activePalette], PALETTES[activePalette].intensity, "tap");
}

void partyMode() {
  activePalette = paletteIndexById("dusk");
  touchOverride = true;
  touchOverrideUntil = millis() + 30UL * 60UL * 1000UL;
  strlcpy(source, "touch", sizeof(source));
  applyToWled(PALETTES[activePalette], 255, "double-tap");
}

void dimWhileHeld(uint32_t heldMs) {
  if (heldMs > HOLD_MS + 2450) return;   // held at the floor; stop spamming WLED
  float t = constrain((heldMs - HOLD_MS) / 2450.0f, 0.0f, 1.0f);
  float eased = t * t * (3.0f - 2.0f * t);
  uint8_t floorLevel = (uint8_t)(userBrightness * 0.12f);
  uint8_t target = userBrightness - (uint8_t)(eased * (userBrightness - floorLevel));
  const Palette &p = PALETTES[activePalette];
  applyToWled(p, target, "dim");
}

// ------------------------------------------------------------------
// MQTT: calendar moods
// ------------------------------------------------------------------
void onMqttMessage(char *topic, byte *payload, unsigned int len) {
  if (strcmp(topic, MQTT_TOPIC_MOOD) != 0) return;

  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, payload, len) != DeserializationError::Ok) return;

  const char *mood = doc["mood"] | "";
  uint32_t minutes = doc["minutes"] | 0;

  for (size_t i = 0; i < MOOD_COUNT; i++) {
    bool hit = false;
    for (uint8_t k = 0; k < MOODS[i].keywordCount; k++) {
      if (strcasestr(mood, MOODS[i].keywords[k])) { hit = true; break; }
    }
    if (!hit) continue;

    const Palette &p = paletteById(MOODS[i].paletteId);
    calendarActive = true;
    calendarPalette = paletteIndexById(p.id);
    calendarIntensity = MOODS[i].intensity;
    calendarExpiresAt = minutes ? millis() + minutes * 60000UL : 0;
    touchOverride = false;
    strlcpy(source, "calendar", sizeof(source));
    Serial.printf("[mood-lamp] calendar '%s' -> %s for %u min\n", mood, p.id, minutes);
    applyToWled(p, calendarIntensity, "calendar");
    return;
  }
  Serial.printf("[mood-lamp] calendar mood '%s' unrecognised, ignored\n", mood);
}

// ------------------------------------------------------------------
// arduino lifecycle
// ------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== Mood Lamp (WLED client) ===");

  pinMode(TOUCH_PIN, INPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("wifi");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " offline (will retry)");

  configTime(GMT_OFFSET_SECONDS, DST_OFFSET_SECONDS, NTP_SERVER);
  Serial.println("ntp requested");

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);

  activePalette = paletteIndexForHour(currentHour() == 255 ? 20 : currentHour());
  applyToWled(PALETTES[activePalette], PALETTES[activePalette].intensity, "boot");
}

void loop() {
  // MQTT keepalive
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected() && millis() > nextMqttAttempt) {
    if (mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)) {
      mqtt.subscribe(MQTT_TOPIC_MOOD);
      Serial.println("mqtt subscribed");
    } else {
      nextMqttAttempt = millis() + 5000;   // try again in 5 s, not every loop
    }
  }
  mqtt.loop();

  // touch
  bool down = digitalRead(TOUCH_PIN) == HIGH;     // TTP223 is active-high
  if (down != touchDown) {
    touchDown = down;
    if (down) {
      touchDownAt = millis();
    } else if (millis() - touchDownAt <= HOLD_MS) {
      if (pendingTapAt && millis() - pendingTapAt < DOUBLE_MS) {
        pendingTapAt = 0;
        partyMode();
      } else {
        pendingTapAt = millis();      // might become a double tap
      }
    }
  }
  // a lone tap resolves when the double-tap window closes
  if (pendingTapAt && millis() - pendingTapAt > DOUBLE_MS) {
    pendingTapAt = 0;
    cyclePalette();
  }
  if (touchDown && millis() - touchDownAt > HOLD_MS) {
    dimWhileHeld(millis() - touchDownAt);
  }

  // housekeeping 4x/second
  if (millis() - lastHousekeeping < 250) return;
  lastHousekeeping = millis();

  uint8_t hour = currentHour();
  if (hour != 255 && hour != lastHour) {
    lastHour = hour;
    if (!calendarActive && !touchOverride) {
      activePalette = paletteIndexForHour(hour);
      applyToWled(PALETTES[activePalette], PALETTES[activePalette].intensity, "clock");
    }
  }

  if (hour != 255 && inSleepWindow(hour) && !touchOverride) {
    applyToWled(PALETTES[activePalette], 20, "sleep");
  }

  if (calendarActive && calendarExpiresAt && millis() > calendarExpiresAt) {
    calendarActive = false;
    strlcpy(source, "time", sizeof(source));
    activePalette = paletteIndexForHour(hour == 255 ? 20 : hour);
    applyToWled(PALETTES[activePalette], PALETTES[activePalette].intensity, "clock");
  }

  if (touchOverride && millis() > touchOverrideUntil) {
    touchOverride = false;
    activePalette = paletteIndexForHour(hour == 255 ? 20 : hour);
    applyToWled(PALETTES[activePalette], PALETTES[activePalette].intensity, "clock");
  }
}
