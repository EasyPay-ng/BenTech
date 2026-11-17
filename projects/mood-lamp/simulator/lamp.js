/* ============================================================
   Mood Lamp Studio — a live mirror of the firmware's decision loop.
   Same inputs, same precedence:
     calendar mood  >  touch override (15/30 min)  >  hour of day
   and the same 23:00–06:00 sleep guard on top of all of it.
   ============================================================ */
(function () {
  'use strict';

  const data = window.MOODLAMP;
  if (!data) return;

  const { palettes, calendarMoods } = data;

  /* ---------- state (mirrors mod_mood_lamp.cpp) ---------- */
  const state = {
    minutes: 19 * 60,          // simulated wall clock
    paletteIndex: 4,           // dusk
    source: 'time',            // time | calendar | touch
    brightness: 120,
    userBrightness: 200,
    touchOverride: false,
    touchOverrideUntil: 0,
    calendar: null             // { moodId, paletteIndex, intensity, expiresAt }
  };

  const SLEEP_START = 23;
  const SLEEP_END = 6;
  const TOUCH_OVERRIDE_MS = 15 * 60 * 1000;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hourOf = (minutes) => Math.floor((minutes % 1440) / 60);
  const hhmm = (minutes) => {
    const h = hourOf(minutes);
    const m = minutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  };

  const paletteById = (id) => palettes.find((p) => p.id === id) || palettes[0];
  const indexById = (id) => Math.max(0, palettes.findIndex((p) => p.id === id));

  function paletteForHour(hour) {
    const i = palettes.findIndex((p) => inRange(hour, p.hours[0], p.hours[1]));
    return i === -1 ? 0 : i;
  }

  function inRange(hour, start, end) {
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  function inSleepWindow(hour) {
    return inRange(hour, SLEEP_START, SLEEP_END);
  }

  /* ---------- the decision loop, one tick at a time ---------- */
  function tick(reason) {
    const hour = hourOf(state.minutes);
    const now = Date.now();

    // 1. calendar wins while it lasts
    if (state.calendar && state.calendar.expiresAt && now > state.calendar.expiresAt) {
      state.calendar = null;
      log('calendar event expired -> back to the clock', 'ignore');
    }

    if (state.calendar) {
      state.paletteIndex = state.calendar.paletteIndex;
      state.brightness = state.calendar.intensity;
      state.source = 'calendar';
    }
    // 2. a human touched it
    else if (state.touchOverride && now < state.touchOverrideUntil) {
      state.source = 'touch';
    }
    // 3. otherwise, the hour decides
    else {
      if (state.touchOverride) {
        state.touchOverride = false;
        log('touch override ended -> clock takes over', 'ignore');
      }
      state.source = 'time';
      state.paletteIndex = paletteForHour(hour);
      state.brightness = palettes[state.paletteIndex].intensity;
    }

    // 4. sleep guard — applies to everything except a deliberate tap
    if (inSleepWindow(hour) && !state.touchOverride) {
      if (state.brightness > 20) state.userBrightness = state.brightness;
      state.brightness = 20;
    }

    render(reason);
  }

  /* ---------- rendering ---------- */
  const $ = (id) => document.getElementById(id);
  const ui = {
    glow: $('glow'),
    leds: $('leds'),
    lamp: $('lamp'),
    palette: $('outPalette'),
    source: $('outSource'),
    brightness: $('outBrightness'),
    clock: $('outClock'),
    clockRange: $('clock'),
    clockOut: $('clockOut'),
    calOut: $('calOut'),
    table: $('paletteTable'),
    chips: $('moodChips'),
    log: $('log'),
    sendForm: $('sendForm'),
    sendInput: $('sendInput'),
    sendMinutes: $('sendMinutes')
  };

  const root = document.documentElement;

  function render(reason) {
    const p = palettes[state.paletteIndex];
    const led = p.colors[1];
    const glowColor = p.colors[2] || p.colors[1];
    const level = clamp(state.brightness / 255, 0, 1);

    root.style.setProperty('--lamp-color', led);
    root.style.setProperty('--glow-opacity', String(0.15 + level * 0.8));
    ui.glow.style.background =
      `radial-gradient(circle, ${glowColor} 0%, ${hexA(glowColor, 0.45)} 38%, transparent 70%)`;
    ui.leds.style.background = `linear-gradient(180deg, ${p.colors[0]}, ${led} 55%, ${p.colors[3]})`;
    ui.leds.style.opacity = String(0.25 + level * 0.75);

    ui.palette.textContent = p.id;
    ui.source.textContent =
      state.source === 'time' ? 'time of day'
      : state.source === 'calendar' ? 'calendar: ' + state.calendar.moodId
      : 'touch';
    ui.brightness.textContent = state.brightness + ' / 255';
    ui.clock.textContent = hhmm(state.minutes);

    ui.clockRange.value = String(state.minutes);
    ui.clockOut.textContent = hhmm(state.minutes);

    const active = state.calendar ? state.calendar.moodId : null;
    ui.calOut.textContent = active ? active + ' (' + palettes[state.paletteIndex].id + ')' : 'nothing scheduled';
    [...ui.chips.querySelectorAll('.chip[data-mood]')].forEach((c) =>
      c.classList.toggle('on', c.dataset.mood === active)
    );
    [...ui.table.querySelectorAll('.prow')].forEach((row, i) =>
      row.classList.toggle('on', i === state.paletteIndex)
    );

    if (reason) log(reason.text, reason.kind);
  }

  function hexA(hex, alpha) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function log(text, kind) {
    const row = document.createElement('div');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = hhmm(state.minutes) + '  ';
    const body = document.createElement('span');
    body.className = kind || '';
    body.textContent = text;
    row.append(t, body);
    ui.log.prepend(row);
    while (ui.log.children.length > 40) ui.log.lastChild.remove();
  }

  /* ---------- the palette table ---------- */
  function buildTable() {
    ui.table.textContent = '';
    palettes.forEach((p, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'prow';

      const id = document.createElement('span');
      id.className = 'pid';
      id.textContent = p.label;

      const sw = document.createElement('span');
      sw.className = 'swatches';
      p.colors.forEach((c) => {
        const dot = document.createElement('i');
        dot.style.background = c;
        sw.appendChild(dot);
      });

      const hours = document.createElement('span');
      hours.className = 'meta';
      hours.innerHTML = `<b>${String(p.hours[0]).padStart(2, '0')}:00</b> – <b>${String(p.hours[1]).padStart(2, '0')}:00</b>`;

      const bri = document.createElement('span');
      bri.className = 'meta';
      bri.innerHTML = `bri <b>${p.intensity}</b>`;

      const spd = document.createElement('span');
      spd.className = 'meta';
      spd.innerHTML = `spd <b>${p.speed}</b>`;

      row.append(id, sw, hours, bri, spd);
      row.addEventListener('click', () => {
        state.calendar = null;
        state.touchOverride = true;
        state.touchOverrideUntil = Date.now() + TOUCH_OVERRIDE_MS;
        state.paletteIndex = i;
        state.brightness = p.intensity;
        state.source = 'touch';
        log(`preview: ${p.id} — held for 15 min, then the clock resumes`, 'ok');
        render();
      });
      ui.table.appendChild(row);
    });
  }

  /* ---------- calendar chips ---------- */
  function buildChips() {
    ui.chips.textContent = '';
    calendarMoods.forEach((m) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.mood = m.id;
      chip.textContent = m.label;
      chip.title = m.note || '';
      chip.addEventListener('click', () => applyMood(m.id, 30, m.label));
      ui.chips.appendChild(chip);
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'chip clear';
    clear.textContent = 'clear';
    clear.addEventListener('click', () => {
      state.calendar = null;
      log('calendar cleared', 'ignore');
      tick();
    });
    ui.chips.appendChild(clear);
  }

  function applyMood(moodId, minutes, label) {
    const mood = calendarMoods.find((m) => m.id === moodId);
    if (!mood) {
      log(`"${label}" — unrecognised, ignored (firmware would log the same)`, 'ignore');
      return;
    }
    state.calendar = {
      moodId: mood.id,
      paletteIndex: indexById(mood.palette),
      intensity: mood.intensity,
      expiresAt: minutes ? Date.now() + minutes * 60000 : 0
    };
    state.touchOverride = false;
    log(`calendar: "${mood.label}" -> ${mood.palette} @ ${mood.intensity}${minutes ? ` for ${minutes} min` : ''}`, 'mood');
    tick();
  }

  /* ---------- keyword matching (same rules as the firmware) ---------- */
  function matchMood(text) {
    const lower = text.toLowerCase();
    for (const mood of calendarMoods) {
      const hit = mood.match.find((k) => lower.includes(k.toLowerCase()));
      if (hit) return { mood, hit };
    }
    return null;
  }

  /* ---------- touch: tap / double tap / hold ---------- */
  const touch = { downAt: 0, lastTapAt: 0, holdTimer: null, holding: false, downBrightness: 200 };

  function onDown() {
    touch.downAt = Date.now();
    touch.holding = false;
    touch.downBrightness = state.userBrightness;
    ui.lamp.classList.add('pressing');
    document.getElementById('touchpad').classList.add('active');
    touch.holdTimer = setTimeout(() => {
      touch.holding = true;
    }, 550);
  }

  function onUp() {
    const held = Date.now() - touch.downAt;
    const now = Date.now();
    clearTimeout(touch.holdTimer);
    ui.lamp.classList.remove('pressing');
    document.getElementById('touchpad').classList.remove('active');

    if (touch.holding || held > 550) {
      // hold already dimmed live; remember the new floor
      state.userBrightness = Math.max(20, state.brightness);
      log(`held ${held} ms — brightness set to ${state.brightness}`, 'ok');
      return;
    }

    if (touch.lastTapAt && now - touch.lastTapAt < 380) {
      touch.lastTapAt = 0;
      doubleTap();
      return;
    }
    touch.lastTapAt = now;
    tap();
  }

  function tap() {
    const p = palettes[(state.paletteIndex + 1) % palettes.length];
    state.paletteIndex = palettes.indexOf(p);
    state.brightness = p.intensity;
    state.source = 'touch';
    state.touchOverride = true;
    state.touchOverrideUntil = Date.now() + TOUCH_OVERRIDE_MS;
    state.calendar = null;
    ui.lamp.classList.remove('tapped');
    void ui.lamp.offsetWidth;
    ui.lamp.classList.add('tapped');
    log(`tap -> ${p.id} (locked for 15 min)`, 'ok');
    render();
  }

  function doubleTap() {
    const p = paletteById('dusk');
    state.paletteIndex = indexById('dusk');
    state.brightness = 255;
    state.source = 'touch';
    state.touchOverride = true;
    state.touchOverrideUntil = Date.now() + 30 * 60 * 1000;
    state.calendar = null;
    ui.lamp.classList.add('tapped');
    log(`double tap -> ${p.id} at full blast for 30 min. party.`, 'ok');
    render();
  }

  function holdTick() {
    if (!touch.holding) return;
    const held = Date.now() - touch.downAt;
    const t = clamp((held - 550) / 2450, 0, 1);
    const eased = t * t * (3 - 2 * t);
    const floor = Math.round(touch.downBrightness * 0.12);
    state.brightness = Math.round(touch.downBrightness - eased * (touch.downBrightness - floor));
    render();
    if (held < 3000) requestAnimationFrame(holdTick);
    else touch.holding = false; // hold ceiling reached
  }

  /* ---------- wire up ---------- */
  ui.lamp.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
  ui.lamp.addEventListener('pointerup', onUp);
  ui.lamp.addEventListener('pointerleave', () => {
    if (ui.lamp.classList.contains('pressing')) onUp();
  });
  ui.lamp.addEventListener('pointercancel', () => {
    if (ui.lamp.classList.contains('pressing')) onUp();
  });
  ui.lamp.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(); }
  });

  const holdWatcher = setInterval(() => {
    if (touch.holding) holdTick();
  }, 60);
  window.addEventListener('pagehide', () => clearInterval(holdWatcher));

  ui.clockRange.addEventListener('input', () => {
    state.minutes = Number(ui.clockRange.value);
    tick();
  });

  ui.sendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ui.sendInput.value.trim();
    if (!text) return;
    const minutes = Number(ui.sendMinutes.value) || 0;
    const hit = matchMood(text);
    if (hit) {
      applyMood(hit.mood.id, minutes, text);
      log(`matched keyword "${hit.hit}" in "${text}"`, 'ok');
    } else {
      log(`"${text}" matched no mood keyword — firmware logs and stays put`, 'ignore');
    }
    ui.sendInput.value = '';
  });

  // let a countdown tick so expiry actually happens in a demo
  setInterval(() => {
    if (state.calendar && state.calendar.expiresAt) tick();
    else if (state.touchOverride && Date.now() > state.touchOverrideUntil) tick();
  }, 5000);

  buildTable();
  buildChips();
  log('boot — clock says ' + hhmm(state.minutes) + ', palette for the hour applied', 'ok');
  tick();
})();
