#pragma once

/*
 * Copy this file to config.h and fill in your own values.
 * config.h is gitignored — never commit real WiFi passwords.
 */

// --- network ------------------------------------------------------
#define WIFI_SSID       "your-wifi"
#define WIFI_PASSWORD   "your-password"
#define NTP_SERVER      "pool.ntp.org"

// Nigeria (WAT) = UTC+1, no DST. Change for your own timezone.
#define GMT_OFFSET_SECONDS  3600
#define DST_OFFSET_SECONDS  0

// --- the lamp itself (a stock WLED board on your LAN) ------------
#define WLED_HOST       "192.168.1.50"     // or lamp.local
#define WLED_PORT       80

// --- touch pad ---------------------------------------------------
#define TOUCH_PIN       27                 // GPIO27, TTP223 OUT
#define HOLD_MS         550                // press longer than this = dim
#define DOUBLE_MS       380                // two taps inside this = party

// --- sleep window ------------------------------------------------
#define SLEEP_START_HOUR  23
#define SLEEP_END_HOUR     6

// --- MQTT (Home Assistant, Node-RED, anything) -------------------
#define MQTT_HOST       "192.168.1.10"
#define MQTT_PORT       1883
#define MQTT_CLIENT_ID  "mood-lamp-01"
#define MQTT_USER       "mqtt"
#define MQTT_PASS       "mqtt"
#define MQTT_TOPIC_MOOD "wled/lamp/mood"
