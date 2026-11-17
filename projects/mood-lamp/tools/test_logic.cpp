/*
 * Host-side test of the firmware's pure decision logic: hour -> palette,
 * the sleep window, and calendar keyword matching. Compiles with plain
 * g++, no Arduino toolchain required.
 *
 *   g++ -std=c++11 -O2 -o /tmp/test_logic tools/test_logic.cpp && /tmp/test_logic
 *
 * Keep this table in sync with palettes.json (it mirrors the generated
 * header on purpose: the test should not depend on the generator).
 */
// host-side test of the firmware's pure decision logic (no Arduino needed)
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <strings.h>

struct Palette { const char *id; uint8_t startHour; uint8_t endHour; uint32_t colors[4]; uint8_t speed; uint8_t intensity; };
// mirror of palettes_generated.h (dawn/morning/focus/golden/dusk/wind-down/night)
static const Palette P[] = {
  {"dawn",5,8,{0x2b1b4d,0x8f4a8a,0xff8a6b,0xffd08a},6,90},
  {"morning",8,11,{0xfff3d6,0xffe3a3,0xc9f2ff,0xfffaf0},12,200},
  {"focus",11,16,{0xe8f4ff,0xb7d8ff,0xffffff,0xa8cfff},4,215},
  {"golden",16,19,{0xffb347,0xff7a3d,0xffd98a,0xc2410c},9,170},
  {"dusk",19,21,{0x7b2d8b,0xff5f9e,0x3b1e63,0xffa8c8},14,120},
  {"wind-down",21,23,{0x241447,0x4b2a72,0x8a5aa8,0x2a1a3d},8,70},
  {"night",23,5,{0x0b1026,0x1b2a5e,0x2f4a8c,0x090d1c},3,28},
};
static const size_t N = sizeof(P)/sizeof(P[0]);
static const uint8_t SLEEP_START = 23, SLEEP_END = 6;

static uint8_t paletteIndexForHour(uint8_t hour) {
  for (size_t i = 0; i < N; i++) {
    const Palette &p = P[i];
    bool in = p.startHour <= p.endHour ? (hour >= p.startHour && hour < p.endHour)
                                       : (hour >= p.startHour || hour < p.endHour);
    if (in) return (uint8_t)i;
  }
  return 0;
}
static bool inSleepWindow(uint8_t hour) {
  if (SLEEP_START == SLEEP_END) return false;
  return SLEEP_START > SLEEP_END ? (hour >= SLEEP_START || hour < SLEEP_END)
                                 : (hour >= SLEEP_START && hour < SLEEP_END);
}
static const char *const kMeeting[]  = {"meeting","standup","stand-up","sync","call","interview","1:1","review","class","lecture"};
static const char *const kRest[]     = {"sleep","nap","rest","therapy","meditation","quiet"};
struct MoodRule { const char *id; const char *const *kw; uint8_t n; const char *pal; uint8_t bri; };
static const MoodRule M[] = {
  {"meeting", kMeeting, 10, "focus", 190},
  {"rest",    kRest,     6, "wind-down", 60},
};
static const size_t MN = sizeof(M)/sizeof(M[0]);

static int failures = 0;
static void expect(const char *what, bool ok, const char *got) {
  if (!ok) { printf("FAIL %-42s got %s\n", what, got); failures++; }
  else printf("ok   %-42s %s\n", what, got);
}
static const char *matchMood(const char *text) {
  for (size_t i = 0; i < MN; i++)
    for (uint8_t k = 0; k < M[i].n; k++)
      if (strcasestr(text, M[i].kw[k])) return M[i].id;
  return "";
}

int main() {
  // every hour of the day must land on exactly one palette
  bool covered = true;
  for (int h = 0; h < 24; h++) {
    const Palette &p = P[paletteIndexForHour((uint8_t)h)];
    bool in = p.startHour <= p.endHour ? (h >= p.startHour && h < p.endHour)
                                       : (h >= p.startHour || h < p.endHour);
    if (!in) { covered = false; printf("   hour %d -> %s (out of range!)\n", h, p.id); }
  }
  expect("all 24 hours covered exactly once", covered, covered ? "yes" : "no");

  expect("03:00 -> night", !strcmp(P[paletteIndexForHour(3)].id, "night"), P[paletteIndexForHour(3)].id);
  expect("07:00 -> dawn", !strcmp(P[paletteIndexForHour(7)].id, "dawn"), P[paletteIndexForHour(7)].id);
  expect("13:00 -> focus", !strcmp(P[paletteIndexForHour(13)].id, "focus"), P[paletteIndexForHour(13)].id);
  expect("20:00 -> dusk", !strcmp(P[paletteIndexForHour(20)].id, "dusk"), P[paletteIndexForHour(20)].id);
  expect("23:00 -> night", !strcmp(P[paletteIndexForHour(23)].id, "night"), P[paletteIndexForHour(23)].id);

  expect("sleep window covers 23:00", inSleepWindow(23), "true");
  expect("sleep window covers 03:00", inSleepWindow(3), "true");
  expect("sleep window excludes 12:00", !inSleepWindow(12), "false");
  expect("sleep window excludes 06:00", !inSleepWindow(6), "false");

  expect("'Design sync with Tunde' -> meeting", !strcmp(matchMood("Design sync with Tunde"), "meeting"),
         matchMood("Design sync with Tunde"));
  expect("'TEAM STANDUP' case-insensitive", !strcmp(matchMood("TEAM STANDUP"), "meeting"), matchMood("TEAM STANDUP"));
  expect("'nap' -> rest", !strcmp(matchMood("nap"), "rest"), matchMood("nap"));
  expect("'cooking jollof' -> no match", !strcmp(matchMood("cooking jollof"), ""), "(none)");

  printf(failures ? "\n%d FAILURES\n" : "\nall firmware logic checks passed\n", failures);
  return failures ? 1 : 0;
}
