/* ============================================================
   INFINITE STORY :: the ink-ish narrative engine
   ------------------------------------------------------------
   The model is a *writer*, never the referee. It returns one JSON
   beat with 2–4 choices; this file owns the rules:

     - scenes are keyed by `id`, so a story can loop back on itself
     - tension (0-10) is tracked per path, not by the model
     - the runtime refuses beats that would soft-lock the story
     - every retelling gets a "remix" mutation applied on top,
       which is what makes the story refuse to repeat itself

   Save format is deliberately plain JSON: scenes + choice ids,
   which maps 1:1 onto ink.js knots and Twine passages.
   ============================================================ */
(function () {
  'use strict';

  const REMIXES = {
    none: {
      label: 'Straight',
      prompt: 'Tell the story straight. No supernatural intrusions.'
    },
    remix: {
      label: 'Remix',
      prompt:
        'Remix the retelling: keep the same characters and places, but change one ' +
        'load-bearing fact from the previous version (who is guilty, what a place ' +
        'means, what the object does). State the change organically in the prose.'
    },
    ghosts: {
      label: 'Ghosts',
      prompt:
        'A version where the past is actively present: memories, echoes and presences ' +
        'bleed into the rooms. Nothing is explained fully.'
    },
    lucid: {
      label: 'Lucid',
      prompt:
        'A version where the protagonist slowly realises they are being told, and begins ' +
        'talking back to the narration without breaking the scene.'
    },
    temporal: {
      label: 'Temporal',
      prompt:
        'A version played out of order: the beat you write now happens before the last ' +
        'one chronologically, and the prose lets the reader feel that inversion.'
    },
    mundane: {
      label: 'Kitchen Sink',
      prompt:
        'Strip every fantastic element. The same conflict, entirely domestic and ' +
        'physical: money, smells, weather, other people\'s opinions.'
    }
  };

  const SEEDS = [
    { id: 'night-bus', text: 'A night bus that only stops for people who are lying.' },
    { id: 'rainmarket', text: 'A rain-market in Makurdi where memories are sold by weight.' },
    { id: 'flat-3', text: 'A flat that keeps the belongings of everyone who ever lived in it.' },
    { id: 'radio', text: 'A radio station broadcasting tomorrow\'s news at slightly wrong angles.' },
    { id: 'tailor', text: 'A tailor who sews clothes for the person you are about to become.' },
    { id: 'bridge', text: 'A bridge that adds one arch every time someone crosses it twice.' },
    { id: 'houseboy', text: 'A boy who remembers every life he has lived in the same house.' },
    { id: 'library', text: 'A library where the books slowly rewrite themselves into one story.' }
  ];

  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));

  /* ---------- session model ---------- */
  function createSession(seedText, remixId) {
    return {
      id: 's_' + Date.now().toString(36),
      seed: seedText,
      remix: remixId && REMIXES[remixId] ? remixId : 'none',
      tension: 2,
      turn: 0,
      scenes: {},               // id -> scene
      order: [],                // path order of scene ids
      currentId: null,
      ending: null,
      startedAt: Date.now()
    };
  }

  /* ---------- prompt construction ---------- */
  function systemPrompt(session, opts) {
    const remix = REMIXES[session.remix];
    const maxWords = (opts && opts.maxWords) || 170;
    return [
      'You are the narrator of a choice-based interactive story. You write one scene at a time.',
      '',
      'HARD RULES',
      '- Reply with a single JSON object and nothing else. No markdown fences, no commentary.',
      '- The JSON shape is exactly:',
      '  {"id":"kebab-case-scene-id","title":"up to 6 words",',
      '   "prose":"1-3 paragraphs, ' + maxWords + ' words maximum, second person, present tense",',
      '   "choices":[{"id":"kebab-case","label":"up to 9 words","tension":"up|down|hold"}]}',
      '- Give 2 to 4 choices. Never fewer, never more.',
      '- Never resolve the central mystery. Never write the words "the end".',
      '- Do not repeat a scene id that already exists.',
      '- Keep continuity: characters, objects and places must stay recognisable.',
      '',
      'THE STORY SO FAR',
      session.seed ? 'Seed: ' + session.seed : 'Seed: (nothing yet — invent it from the last beat)',
      'Retelling style: ' + remix.label + '. ' + remix.prompt,
      'Tension right now: ' + session.tension + '/10. ' +
        (session.tension > 7
          ? 'Tension is high: write short, blunt sentences. Consequences are landing.'
          : session.tension < 3
            ? 'Tension is low: let the world get strange and specific before anything breaks.'
            : 'Tension is mid: let one thing go wrong in a small, physical way.'),
      '',
      'VOICE',
      '- Concrete nouns, no abstraction for its own sake.',
      '- Let the supernatural be treated as normal by the people inside it.',
      '- One sensory detail per paragraph that only this story could have.'
    ].join('\n');
  }

  function historyMessages(session, limit) {
    const tail = session.order.slice(-(limit || 4));
    const messages = [];
    for (const id of tail) {
      const scene = session.scenes[id];
      if (!scene) continue;
      messages.push({ role: 'assistant', content: JSON.stringify({
        id: scene.id, title: scene.title, prose: scene.prose
      }) });
      if (scene.chosenLabel) {
        messages.push({ role: 'user', content: 'The reader chose: ' + scene.chosenLabel });
      }
    }
    return messages;
  }

  /* ---------- validation: the runtime is the referee ---------- */
  function normaliseBeat(raw, session, opts) {
    let beat = raw;
    if (typeof raw === 'string') {
      beat = parseLooseJson(raw);
    }
    if (!beat || typeof beat !== 'object') {
      throw new EngineError('bad-beat', 'Model did not return a JSON object.');
    }

    const slug = (s, fallback) => {
      const v = String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
      return v || fallback;
    };

    let id = slug(beat.id, 'scene-' + (session.turn + 1));
    if (session.scenes[id]) id = id + '-' + (session.turn + 1);

    const prose = String(beat.prose || '').trim();
    if (prose.length < 40) {
      throw new EngineError('bad-beat', 'Model returned a beat with no usable prose.');
    }

    let choices = Array.isArray(beat.choices) ? beat.choices : [];
    choices = choices
      .map((c, i) => {
        if (typeof c === 'string') c = { label: c };
        return {
          id: slug(c.id, 'choice-' + (i + 1)),
          label: String(c.label || '').trim().slice(0, 90),
          tension: ['up', 'down', 'hold'].includes(c.tension) ? c.tension : 'hold',
          to: c.to ? slug(c.to, null) : null
        };
      })
      .filter((c) => c.label.length > 0);

    // de-dupe choice ids so React keys and save files stay sane
    const seen = new Set();
    choices = choices.map((c, i) => {
      let cid = c.id;
      if (seen.has(cid)) cid = cid + '-' + i;
      seen.add(cid);
      return { ...c, id: cid };
    });

    // The runtime guarantees a way forward even if the model got lazy.
    if (choices.length === 0) {
      choices = [
        { id: 'look-closer', label: 'Look closer', tension: 'up' },
        { id: 'walk-away', label: 'Walk away', tension: 'down' }
      ];
    }
    if (choices.length === 1) {
      choices.push({ id: 'say-nothing', label: 'Say nothing and wait', tension: 'hold' });
    }
    if (choices.length > 4) choices = choices.slice(0, 4);

    return {
      id,
      title: String(beat.title || '').trim().slice(0, 60) || 'Untitled beat',
      prose,
      choices,
      turn: session.turn + 1,
      createdAt: Date.now()
    };
  }

  function parseLooseJson(text) {
    const trimmed = String(text).trim();
    const attempts = [
      trimmed,
      trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim(),
      trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
    ];
    for (const a of attempts) {
      if (!a) continue;
      try {
        return JSON.parse(a);
      } catch (e) { /* next */ }
    }
    return null;
  }

  class EngineError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  /* ---------- the turn ---------- */
  async function nextBeat(session, opts) {
    const options = opts || {};
    const system = systemPrompt(session, options);
    const messages = historyMessages(session, 4);

    if (options.choice) {
      messages.push({
        role: 'user',
        content:
          'The reader chose "' + options.choice.label + '". Write the next scene that shows ' +
          'what that choice actually costs. Tension intent: ' + options.choice.tension + '.'
      });
    } else {
      messages.push({
        role: 'user',
        content:
          'Open the story. Write scene one from the seed, and give the reader their first ' +
          'real decision.'
      });
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = await window.Ollama.chat({
          system,
          messages,
          json: true,
          temperature: attempt === 0 ? 0.95 : 0.8
        });
        const beat = normaliseBeat(content, session, options);
        return beat;
      } catch (err) {
        if (err instanceof window.Ollama.OllamaError) throw err;
        lastError = err;
      }
    }
    throw lastError || new EngineError('unknown', 'Could not produce a beat.');
  }

  /* ---------- applying a beat ---------- */
  function commitBeat(session, beat) {
    session.scenes[beat.id] = beat;
    session.order.push(beat.id);
    session.currentId = beat.id;
    session.turn = beat.turn;
    return session;
  }

  function choose(session, choice) {
    const scene = session.scenes[session.currentId];
    if (scene) {
      scene.chosenId = choice.id;
      scene.chosenLabel = choice.label;
    }
    if (choice.tension === 'up') session.tension = clamp(session.tension + 2, 0, 10);
    else if (choice.tension === 'down') session.tension = clamp(session.tension - 2, 0, 10);
    return session;
  }

  /* ---------- export: ink.js + Twine ---------- */
  function sceneId(session, scene) {
    const index = session.order.indexOf(scene.id);
    return 'knot_' + (index + 1) + '_' + scene.id.replace(/-/g, '_');
  }

  function toInk(session) {
    const lines = [
      '// ' + session.seed,
      '// Generated by Infinite Story (BenTech). Compile with inklecate.',
      '// retelling: ' + session.remix + ' · ' + session.order.length + ' scenes',
      '// This is the path that was actually read. Branches you did not take',
      '// end at -> END; play the other way to get their knots.',
      ''
    ];
    session.order.forEach((id, i) => {
      const scene = session.scenes[id];
      const isLast = i === session.order.length - 1 && !session.ending;
      lines.push('=== ' + sceneId(session, scene) + ' ===');
      lines.push('// ' + scene.title);
      lines.push(...scene.prose.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean));
      lines.push('');
      if (isLast) {
        lines.push('-> END');
      } else {
        for (const choice of scene.choices) {
          const next = nextSceneFor(session, scene, choice);
          lines.push(
            '* [' + choice.label + ']' +
            (next ? ' -> ' + sceneId(session, session.scenes[next]) : ' -> END')
          );
        }
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  /** Where did a choice actually lead? Uses the recorded path when there is one. */
  function nextSceneFor(session, scene, choice) {
    if (scene.chosenId === choice.id) {
      const i = session.order.indexOf(scene.id);
      if (i >= 0 && session.order[i + 1]) return session.order[i + 1];
    }
    return choice.to && session.scenes[choice.to] ? choice.to : null;
  }

  function toTwine(session) {
    const passages = [];
    session.order.forEach((id) => {
      const scene = session.scenes[id];
      const links = scene.choices
        .map((choice) => {
          const next = nextSceneFor(session, scene, choice);
          return next
            ? '[[' + choice.label + '->' + twineName(session, session.scenes[next]) + ']]'
            : '[[' + choice.label + '->The End]]';
        })
        .join('\n');
      passages.push(
        '<div class="passage" data-name="' + esc(twineName(session, scene)) + '">\n' +
        '<h2>' + esc(scene.title) + '</h2>\n' +
        '<p>' + scene.prose.split(/\n+/).map(esc).join('</p>\n<p>') + '</p>\n' +
        links + '\n' +
        '</div>'
      );
    });
    passages.push(
      '<div class="passage" data-name="The End">\n<p>That telling is over. Another will differ.</p>\n</div>'
    );

    // Twee 3 syntax, imports straight into Twine 2 as a story archive.
    const twee = session.order.map((id) => {
      const scene = session.scenes[id];
      const links = scene.choices
        .map((c) => {
          const next = nextSceneFor(session, scene, c);
          return '[[' + c.label + (next ? '->' + twineName(session, session.scenes[next]) : '->The End') + ']]';
        })
        .join('\n');
      return (
        ':: ' + twineName(session, scene) + '\n' +
        scene.prose + '\n\n' + links + '\n'
      );
    }).join('\n');

    return { twee, html: passages.join('\n') };
  }

  function twineName(session, scene) {
    return (scene.title || scene.id) + ' (' + (session.order.indexOf(scene.id) + 1) + ')';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- save / load ---------- */
  function toSave(session) {
    return {
      format: 'infinite-story/v1',
      savedAt: new Date().toISOString(),
      seed: session.seed,
      remix: session.remix,
      tension: session.tension,
      order: session.order.slice(),
      scenes: session.scenes
    };
  }

  function fromSave(obj) {
    if (!obj || obj.format !== 'infinite-story/v1') {
      throw new EngineError('bad-save', 'Not an Infinite Story save file.');
    }
    const session = createSession(obj.seed, obj.remix);
    session.order = obj.order.filter((id) => obj.scenes[id]);
    session.scenes = obj.scenes;
    session.currentId = session.order[session.order.length - 1] || null;
    session.turn = session.order.length;
    session.tension = clamp(obj.tension, 0, 10);
    return session;
  }

  window.StoryEngine = {
    REMIXES,
    SEEDS,
    createSession,
    nextBeat,
    commitBeat,
    choose,
    toInk,
    toTwine,
    toSave,
    fromSave,
    EngineError,
    systemPrompt
  };
})();
