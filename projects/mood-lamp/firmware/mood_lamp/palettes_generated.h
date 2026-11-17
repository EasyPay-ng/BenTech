// GENERATED FILE — do not edit.
// Source: projects/mood-lamp/palettes.json
// Regenerate: python3 projects/mood-lamp/tools/build_palettes.py
#pragma once
#include <Arduino.h>

struct MoodLampPalette {
  const char *id;
  uint8_t startHour;
  uint8_t endHour;
  uint32_t colors[4];   // 0xRRGGBB, brightest first
  uint8_t speed;
  uint8_t intensity;    // 0-255 target brightness
  uint8_t wledPalette;  // matching built-in WLED palette (0 = custom)
};

struct MoodLampMood {
  const char *id;
  const char *paletteId;
  uint8_t intensity;
};

static const MoodLampPalette MOODLAMP_PALETTES[] = {
  {"dawn",  5,  8, {0x2B1B4D, 0x8F4A8A, 0xFF8A6B, 0xFFD08A},  6,  90, 19},
  {"morning",  8, 11, {0xFFF3D6, 0xFFE3A3, 0xC9F2FF, 0xFFFAF0}, 12, 200, 38},
  {"focus", 11, 16, {0xE8F4FF, 0xB7D8FF, 0xFFFFFF, 0xA8CFFF},  4, 215, 37},
  {"golden", 16, 19, {0xFFB347, 0xFF7A3D, 0xFFD98A, 0xC2410C},  9, 170, 10},
  {"dusk", 19, 21, {0x7B2D8B, 0xFF5F9E, 0x3B1E63, 0xFFA8C8}, 14, 120, 13},
  {"wind-down", 21, 23, {0x241447, 0x4B2A72, 0x8A5AA8, 0x2A1A3D},  8,  70, 12},
  {"night", 23,  5, {0x0B1026, 0x1B2A5E, 0x2F4A8C, 0x090D1C},  3,  28, 14},
};
static const size_t MOODLAMP_PALETTE_COUNT = sizeof(MOODLAMP_PALETTES) / sizeof(MOODLAMP_PALETTES[0]);

static const MoodLampMood MOODLAMP_MOODS[] = {
  {"meeting", "focus", 190},
  {"deepwork", "morning", 205},
  {"workout", "golden", 220},
  {"social", "dusk", 150},
  {"rest", "wind-down", 60},
};
static const size_t MOODLAMP_MOOD_COUNT = sizeof(MOODLAMP_MOODS) / sizeof(MOODLAMP_MOODS[0]);

// Keyword lists, grouped so the matcher can scan them cheaply.
static const char *const kMoodKeywords_meeting[] = {"meeting", "standup", "stand-up", "sync", "call", "interview", "1:1", "review", "class", "lecture"};
static const uint8_t kMoodKeywords_meeting_count = sizeof(kMoodKeywords_meeting) / sizeof(kMoodKeywords_meeting[0]);
static const char *const kMoodKeywords_deepwork[] = {"focus", "deep work", "writing", "study", "revision", "deadline", "sprint"};
static const uint8_t kMoodKeywords_deepwork_count = sizeof(kMoodKeywords_deepwork) / sizeof(kMoodKeywords_deepwork[0]);
static const char *const kMoodKeywords_workout[] = {"gym", "run", "workout", "training", "football", "match", "hiit"};
static const uint8_t kMoodKeywords_workout_count = sizeof(kMoodKeywords_workout) / sizeof(kMoodKeywords_workout[0]);
static const char *const kMoodKeywords_social[] = {"birthday", "party", "dinner", "hangout", "wedding", "celebration", "drinks"};
static const uint8_t kMoodKeywords_social_count = sizeof(kMoodKeywords_social) / sizeof(kMoodKeywords_social[0]);
static const char *const kMoodKeywords_rest[] = {"sleep", "nap", "rest", "therapy", "meditation", "quiet"};
static const uint8_t kMoodKeywords_rest_count = sizeof(kMoodKeywords_rest) / sizeof(kMoodKeywords_rest[0]);
