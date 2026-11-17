#!/usr/bin/env python3
"""A 40-line stand-in for Ollama, used by tests/e2e.test.js.

It answers /api/tags and /api/chat, and deliberately wraps every beat in
```json fences to prove the engine's loose parser handles real-world
model output. Run on 127.0.0.1:11999.
"""
import json, http.server

def beat(n):
    return {"id": f"beat-{n}", "title": f"Scene {n} of the market",
            "prose": "You step into the rain-market and the price boards turn to face you. "
                     "The second paragraph keeps a detail only this story could have: wet ledger paper, and something underneath it, breathing.",
            "choices": [{"id": "pay", "label": "Pay with a memory", "tension": "up"},
                        {"id": "wait", "label": "Wait for the rain to stop", "tension": "down"},
                        {"id": "ask", "label": "Ask who is buying", "tension": "hold"}]}

count = {"n": 0}

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj, code=200):
        p = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(p))); self.end_headers(); self.wfile.write(p)
    def do_GET(self):
        if self.path.startswith("/api/tags"):
            return self._send({"models": [{"name": "llama3.1:8b"}, {"name": "qwen2.5:7b"}]})
        self._send({"error": "not found"}, 404)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        count["n"] += 1
        # deliberately wrap in fences to prove the loose parser works
        content = "```json\n" + json.dumps(beat(count["n"])) + "\n```"
        self._send({"model": body.get("model"), "message": {"role": "assistant", "content": content}, "done": True})

http.server.ThreadingHTTPServer(("127.0.0.1", 11999), H).serve_forever()
