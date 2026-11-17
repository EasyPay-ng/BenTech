/* ============================================================
   INFINITE STORY :: ollama client
   Two ways to reach the local model:

     1. same-origin  /ollama/*        (via tools/ollama-proxy.py — no CORS)
     2. direct       http://127.0.0.1:11434/*

   Ollama refuses cross-origin calls unless you allow them, so the
   proxy exists. We try 1, fall back to 2, and report exactly what
   went wrong instead of a vague "failed to fetch".
   ============================================================ */
(function () {
  'use strict';

  const DIRECT = 'http://127.0.0.1:11434';
  const PROXY = '/ollama';
  const STORE_KEY = 'infinite-story:settings';

  let base = null;          // resolved base URL
  let model = null;
  let reachable = false;

  const settings = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  };
  const saveSettings = (patch) => {
    const next = { ...settings(), ...patch };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch (e) {
      /* private mode — settings just don't persist */
    }
    return next;
  };

  async function tryFetch(url, options, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 4000);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Find a base URL that answers /api/tags. */
  async function discover() {
    const saved = settings();
    const candidates = [saved.base, PROXY, DIRECT].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const res = await tryFetch(candidate + '/api/tags', { method: 'GET' }, 2500);
        if (!res.ok) continue;
        const data = await res.json();
        base = candidate;
        reachable = true;
        saveSettings({ base });
        const models = (data.models || []).map((m) => m.name);
        return { ok: true, base, models };
      } catch (err) {
        /* try the next candidate */
      }
    }
    reachable = false;
    base = saved.base || DIRECT;
    return { ok: false, base, reason: saved.base ? 'custom' : 'no-endpoint' };
  }

  /** One non-streaming chat turn. Returns the raw string content. */
  async function chat({ system, messages, json = true, temperature = 0.95, numPredict = 900 }) {
    if (!reachable) {
      const found = await discover();
      if (!found.ok) throw new OllamaError('not-running', found);
    }
    if (!model) model = settings().model || null;

    const payload = {
      model,
      stream: false,
      options: { temperature, top_p: 0.95, num_predict: numPredict },
      messages: [{ role: 'system', content: system }, ...messages]
    };
    if (json) payload.format = 'json';

    let res;
    try {
      res = await tryFetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 120000);
    } catch (err) {
      // the endpoint died mid-session; rediscover once
      reachable = false;
      throw new OllamaError('unreachable', { base, error: err.message });
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).error || '';
      } catch (e) { /* body wasn't json */ }
      if (res.status === 404) throw new OllamaError('no-model', { model, detail });
      throw new OllamaError('http-' + res.status, { detail });
    }

    const data = await res.json();
    const content = (data.message && data.message.content) || '';
    return content;
  }

  class OllamaError extends Error {
    constructor(code, info) {
      super(code);
      this.code = code;
      this.info = info || {};
    }
  }

  window.Ollama = {
    discover,
    chat,
    OllamaError,
    setModel(name) {
      model = name;
      saveSettings({ model: name });
    },
    setBase(url) {
      base = url;
      saveSettings({ base: url });
    },
    get model() { return model; },
    get base() { return base; },
    get settings() { return settings(); }
  };
})();
