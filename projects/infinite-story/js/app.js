/* ============================================================
   INFINITE STORY :: UI
   Vanilla JS on purpose: this page must run from file:// with a
   local model and no build step. State lives in one object; every
   update re-renders the reading column from it.
   ============================================================ */
(function () {
  'use strict';

  const E = window.StoryEngine;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    session: null,
    busy: false,
    modelReady: false,
    remix: 'remix',
    error: null
  };

  const ui = {
    seedInput: $('#seedInput'),
    remixRow: $('#remixRow'),
    tensionFill: $('#tensionFill'),
    tensionNum: $('#tensionNum'),
    turnNum: $('#turnNum'),
    prose: $('#prose'),
    choices: $('#choices'),
    status: $('#status'),
    startBtn: $('#startBtn'),
    modelSelect: $('#modelSelect'),
    modelRow: $('#modelRow'),
    dial: $('#dial'),
    openStudio: $('#openStudio'),
    overlay: $('#overlay'),
    studioBody: $('#studioBody'),
    copyOut: $('#copyOut'),
    rerollBtn: $('#rerollBtn'),
    saveBtn: $('#saveBtn'),
    loadInput: $('#loadInput'),
    toast: $('#toast')
  };

  /* ---------- tiny helpers ---------- */
  function toast(msg, kind) {
    ui.toast.textContent = msg;
    ui.toast.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      ui.toast.className = 'toast';
    }, 4200);
  }

  function setStatus(text, kind) {
    ui.status.textContent = text;
    ui.status.dataset.kind = kind || '';
  }

  function setBusy(on, label) {
    state.busy = on;
    document.body.classList.toggle('busy', on);
    ui.startBtn.disabled = on || !state.modelReady;
    $$('#choices button').forEach((b) => { b.disabled = on; });
    // the action buttons key off the session, not just the busy flag
    ui.rerollBtn.disabled = on || !state.session;
    ui.saveBtn.disabled = !state.session;
    if (on) setStatus(label || 'thinking…', 'busy');
  }

  /* ---------- model discovery ---------- */
  async function connect() {
    setStatus('looking for ollama…', 'busy');
    const found = await window.Ollama.discover();

    if (!found.ok) {
      state.modelReady = false;
      ui.modelRow.hidden = false;
      ui.modelSelect.innerHTML = '<option value="">— ollama not found —</option>';
      setStatus('offline: no model', 'bad');
      showConnectHelp(found);
      return;
    }

    if (!found.models.length) {
      state.modelReady = false;
      ui.modelRow.hidden = false;
      ui.modelSelect.innerHTML = '<option value="">— no models pulled —</option>';
      setStatus('ollama up, no model', 'warn');
      showConnectHelp({ reason: 'no-models', base: found.base });
      return;
    }

    const saved = window.Ollama.settings.model;
    const preferred =
      found.models.find((m) => m === saved) ||
      found.models.find((m) => /^(llama3\.1|llama3|mistral|qwen2\.5|gemma2|phi3)/.test(m)) ||
      found.models[0];

    window.Ollama.setModel(preferred);
    state.modelReady = true;
    ui.modelRow.hidden = false;
    ui.modelSelect.innerHTML = found.models
      .map((m) => `<option value="${m}"${m === preferred ? ' selected' : ''}>${m}</option>`)
      .join('');
    setStatus('model ready · ' + preferred, 'good');
    clearConnectHelp();
    if (!state.session) ui.startBtn.disabled = false;
  }

  function showConnectHelp(info) {
    let pill = $('#connectPill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'connectPill';
      pill.className = 'connect-pill';
      $('#stage').prepend(pill);
    }
    const isNoModels = info.reason === 'no-models';
    pill.innerHTML =
      '<div class="cp-title">' +
      (isNoModels ? 'Ollama is running — pull a model first' : 'No local model answering') +
      '</div>' +
      '<div class="cp-body">' + (isNoModels
        ? 'In a terminal: <code>ollama pull llama3.1</code> then hit re-check.'
        : 'Start it with <code>ollama serve</code>, then reload this page. ' +
          'If the browser blocks the call (CORS), run <code>python3 tools/ollama-proxy.py</code> ' +
          'and this page will route through it automatically.') +
      '</div>' +
      '<div class="cp-actions">' +
      '<button id="recheckBtn" class="mini">Re-check</button>' +
      '<a class="mini" href="README.md">Setup guide</a>' +
      '</div>';
    $('#recheckBtn').addEventListener('click', connect);
  }

  function clearConnectHelp() {
    const pill = $('#connectPill');
    if (pill) pill.remove();
    const banner = $('#notRunning');
    if (banner) banner.remove();
  }

  /* ---------- rendering ---------- */
  function renderRemixes() {
    ui.remixRow.textContent = '';
    Object.entries(E.REMIXES).forEach(([id, remix]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'remix' + (id === state.remix ? ' on' : '');
      b.textContent = remix.label;
      b.dataset.remix = id;
      b.title = remix.prompt;
      b.addEventListener('click', () => {
        state.remix = id;
        $$('.remix', ui.remixRow).forEach((el) =>
          el.classList.toggle('on', el.dataset.remix === id)
        );
      });
      ui.remixRow.appendChild(b);
    });
  }

  function renderSession() {
    const s = state.session;
    ui.tensionFill.style.width = (s ? s.tension * 10 : 0) + '%';
    ui.tensionNum.textContent = String(s ? s.tension : 0);
    ui.turnNum.textContent = String(s ? s.turn : 0);
    ui.rerollBtn.disabled = !s || state.busy;
    ui.saveBtn.disabled = !s;

    if (!s) {
      ui.prose.innerHTML =
        '<p class="placeholder">Pick a seed, choose how it should be retold, and press ' +
        '<b>Begin</b>. Every scene comes from your local model; the choices are yours.</p>';
      ui.choices.textContent = '';
      return;
    }

    const scene = s.scenes[s.currentId];
    if (!scene) return;

    // Rebuild the whole reading column from the session. Cheap (a path is
    // a handful of scenes) and it keeps loaded saves and rerolls honest.
    const scrollY = window.scrollY;
    ui.prose.textContent = '';
    s.order.forEach((id, index) => {
      const beat = s.scenes[id];
      if (!beat) return;
      ui.prose.appendChild(beatElement(beat, index === s.order.length - 1));
    });

    if (scrollY > 0) {
      const current = ui.prose.querySelector('.beat.current');
      if (current) current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    renderChoices(scene);
  }

  function beatElement(scene, isCurrent) {
    const beat = document.createElement('article');
    beat.className = 'beat' + (isCurrent ? ' current' : '');
    beat.dataset.scene = scene.id;

    const head = document.createElement('header');
    head.className = 'beat-head';
    const turn = document.createElement('span');
    turn.className = 'beat-turn';
    turn.textContent = 'scene ' + scene.turn;
    const title = document.createElement('h2');
    title.textContent = scene.title;
    const id = document.createElement('code');
    id.className = 'beat-id';
    id.textContent = scene.id;
    head.append(turn, title, id);

    const body = document.createElement('div');
    body.className = 'beat-prose';
    scene.prose.split(/\n+/).forEach((para) => {
      if (!para.trim()) return;
      const p = document.createElement('p');
      p.textContent = para.trim();
      body.appendChild(p);
    });

    beat.append(head, body);

    if (scene.chosenLabel) {
      const taken = document.createElement('div');
      taken.className = 'beat-taken';
      taken.innerHTML = '<span>you chose</span>';
      const em = document.createElement('em');
      em.textContent = scene.chosenLabel;
      taken.appendChild(em);
      beat.appendChild(taken);
    }
    return beat;
  }

  function renderChoices(scene) {
    ui.choices.textContent = '';
    const heading = document.createElement('div');
    heading.className = 'choices-head';
    heading.innerHTML = '<span>what do you do</span><span class="rule"></span>';
    ui.choices.appendChild(heading);

    scene.choices.forEach((choice, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      b.disabled = state.busy;
      b.innerHTML =
        '<span class="choice-key">' + (i + 1) + '</span>' +
        '<span class="choice-label"></span>' +
        '<span class="choice-tension t-' + choice.tension + '">' + choice.tension + '</span>';
      b.querySelector('.choice-label').textContent = choice.label;
      b.addEventListener('click', () => pick(choice));
      ui.choices.appendChild(b);
    });
  }

  /* ---------- actions ---------- */
  async function begin() {
    if (!state.modelReady) {
      toast('No local model yet — see the setup note.', 'bad');
      return;
    }
    const seed = ui.seedInput.value.trim();
    if (!seed) {
      toast('Give it a seed first.', 'bad');
      ui.seedInput.focus();
      return;
    }

    state.session = E.createSession(seed, state.remix);
    ui.prose.textContent = '';
    setBusy(true, 'writing scene 1…');

    try {
      const beat = await E.nextBeat(state.session, {});
      E.commitBeat(state.session, beat);
      renderSession();
      setStatus('scene ' + beat.turn + ' ready', 'good');
    } catch (err) {
      handleError(err, 'Could not write the opening scene.');
    } finally {
      setBusy(false);
    }
  }

  async function pick(choice) {
    if (state.busy || !state.session) return;
    E.choose(state.session, choice);
    renderSession();
    setBusy(true, 'following "' + choice.label.toLowerCase() + '"…');

    try {
      const beat = await E.nextBeat(state.session, { choice });
      E.commitBeat(state.session, beat);
      renderSession();
      setStatus('scene ' + beat.turn + ' · tension ' + state.session.tension + '/10', 'good');
    } catch (err) {
      handleError(err, 'The next beat failed.');
    } finally {
      setBusy(false);
    }
  }

  async function reroll() {
    const s = state.session;
    if (!s || state.busy) return;
    const scene = s.scenes[s.currentId];
    const parentIndex = s.order.length - 2;
    const parentId = parentIndex >= 0 ? s.order[parentIndex] : null;
    const parent = parentId ? s.scenes[parentId] : null;
    const chosen = parent
      ? parent.choices.find((c) => c.id === parent.chosenId)
      : null;

    // drop the current scene, then re-ask the model for the same turn
    delete s.scenes[scene.id];
    s.order.pop();
    s.currentId = parentId;
    s.turn = Math.max(0, s.turn - 1);
    if (parent) {
      parent.chosenId = null;
      parent.chosenLabel = null;
    }
    renderSession();

    setBusy(true, 'retelling that beat…');
    try {
      const beat = await E.nextBeat(s, chosen ? { choice: chosen } : {});
      E.commitBeat(s, beat);
      renderSession();
      setStatus('retold — scene ' + beat.turn, 'good');
    } catch (err) {
      handleError(err, 'Could not retell that beat.');
    } finally {
      setBusy(false);
    }
  }

  function handleError(err, context) {
    const code = err && err.code;
    if (code === 'not-running' || code === 'unreachable') {
      state.modelReady = false;
      setStatus('model went away', 'bad');
      showConnectHelp({ reason: 'unreachable' });
      toast('Lost the local model. Is Ollama still running?', 'bad');
      connect();
      return;
    }
    if (code === 'no-model') {
      setStatus('unknown model', 'bad');
      toast('That model is not pulled locally. Pick another from the list.', 'bad');
      connect();
      return;
    }
    const msg = (err && err.message) || 'Unknown error';
    setStatus('error', 'bad');
    toast(context + ' ' + msg, 'bad');
  }

  /* ---------- studio drawer (dial + exports) ---------- */
  function renderDial() {
    const s = state.session;
    const nodes = s ? s.order.length : 0;
    const ink = s ? E.toInk(s) : '';
    const twine = s ? E.toTwine(s) : { twee: '' };
    const lines = ink.split('\n').length;

    ui.studioBody.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'studio-stats';
    [
      ['scenes', nodes],
      ['choices taken', s ? s.order.length - 1 : 0],
      ['tension', (s ? s.tension : 0) + '/10'],
      ['ink lines', lines],
      ['retelling', s ? E.REMIXES[s.remix].label : '—']
    ].forEach(([k, v]) => {
      const cell = document.createElement('div');
      cell.innerHTML = '<span>' + k + '</span><b>' + v + '</b>';
      stats.appendChild(cell);
    });

    const path = document.createElement('ol');
    path.className = 'studio-path';
    if (s) {
      s.order.forEach((id) => {
        const scene = s.scenes[id];
        const li = document.createElement('li');
        li.innerHTML =
          '<code>' + scene.id + '</code><span>' + scene.title +
          '</span><em>' + (scene.chosenLabel || 'current') + '</em>';
        path.appendChild(li);
      });
    } else {
      path.innerHTML = '<li class="empty">No scenes yet.</li>';
    }

    const inkBox = document.createElement('div');
    inkBox.className = 'studio-code';
    const inkHead = document.createElement('div');
    inkHead.className = 'studio-code-head';
    inkHead.innerHTML = '<span>ink.js</span>';
    const inkCopy = document.createElement('button');
    inkCopy.type = 'button';
    inkCopy.className = 'mini';
    inkCopy.textContent = 'copy';
    inkCopy.addEventListener('click', () => copy(ink, 'ink source'));
    inkHead.appendChild(inkCopy);
    const inkPre = document.createElement('pre');
    inkPre.textContent = ink || '// begin a story to generate ink source';
    inkBox.append(inkHead, inkPre);

    const twineBox = document.createElement('div');
    twineBox.className = 'studio-code';
    const twineHead = document.createElement('div');
    twineHead.className = 'studio-code-head';
    twineHead.innerHTML = '<span>twine (twee 3)</span>';
    const twineCopy = document.createElement('button');
    twineCopy.type = 'button';
    twineCopy.className = 'mini';
    twineCopy.textContent = 'copy';
    twineCopy.addEventListener('click', () => copy(twine.twee, 'twee source'));
    twineHead.appendChild(twineCopy);
    const twinePre = document.createElement('pre');
    twinePre.textContent = twine.twee || ':: Untitled\nBegin a story first.';
    twineBox.append(twineHead, twinePre);

    ui.studioBody.append(stats, path, inkBox, twineBox);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label + ' copied', 'good');
    } catch (e) {
      toast('Clipboard blocked — select the text instead.', 'bad');
    }
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- wiring ---------- */
  function init() {
    renderRemixes();

    // seed dice
    $('#diceBtn').addEventListener('click', () => {
      const seed = E.SEEDS[Math.floor(Math.random() * E.SEEDS.length)];
      ui.seedInput.value = seed.text;
      ui.seedInput.focus();
    });

    // seed chips
    const chips = $('#seedChips');
    E.SEEDS.forEach((seed) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'seed-chip';
      chip.textContent = seed.text;
      chip.addEventListener('click', () => {
        ui.seedInput.value = seed.text;
        ui.seedInput.focus();
      });
      chips.appendChild(chip);
    });

    ui.startBtn.addEventListener('click', begin);
    ui.rerollBtn.addEventListener('click', reroll);

    ui.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        begin();
      }
    });

    ui.modelSelect.addEventListener('change', () => {
      window.Ollama.setModel(ui.modelSelect.value);
      setStatus('model · ' + ui.modelSelect.value, 'good');
      toast('Using ' + ui.modelSelect.value, 'good');
    });

    ui.saveBtn.addEventListener('click', () => {
      if (!state.session) return;
      const save = E.toSave(state.session);
      download('story-' + state.session.id + '.json', JSON.stringify(save, null, 2), 'application/json');
      toast('save file downloaded', 'good');
    });

    ui.loadInput.addEventListener('change', async () => {
      const file = ui.loadInput.files && ui.loadInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        state.session = E.fromSave(JSON.parse(text));
        state.remix = state.session.remix;
        renderRemixes();
        renderSession();
        toast('loaded ' + state.session.order.length + ' scenes', 'good');
      } catch (err) {
        toast('Could not load that save: ' + err.message, 'bad');
      } finally {
        ui.loadInput.value = '';
      }
    });

    ui.openStudio.addEventListener('click', (e) => {
      e.preventDefault();
      renderDial();
      ui.overlay.classList.add('open');
      document.body.classList.add('drawer');
    });

    $$('[data-close-studio]').forEach((el) =>
      el.addEventListener('click', () => {
        ui.overlay.classList.remove('open');
        document.body.classList.remove('drawer');
      })
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ui.overlay.classList.remove('open');
        document.body.classList.remove('drawer');
      }
      // 1-4 pick a choice when you're not typing
      if (/^[1-4]$/.test(e.key) && document.activeElement.tagName !== 'TEXTAREA' &&
          document.activeElement.tagName !== 'INPUT' && state.session && !state.busy) {
        const scene = state.session.scenes[state.session.currentId];
        const choice = scene && scene.choices[Number(e.key) - 1];
        if (choice) pick(choice);
      }
    });

    renderSession();
    connect();
  }

  init();
})();
