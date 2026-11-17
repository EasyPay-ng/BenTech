#!/usr/bin/env python3
"""
Serve the Infinite Story page and proxy Ollama, so the browser never has
to make a cross-origin call.

    python3 tools/ollama-proxy.py            # http://localhost:8080
    python3 tools/ollama-proxy.py --port 3000

Then open http://localhost:8080/ (not file://). The page asks for
/ollama/api/tags first, finds this proxy, and uses it for every request.

Why this exists: Ollama only accepts cross-origin requests from origins
listed in OLLAMA_ORIGINS. Running through a same-origin proxy avoids
asking anyone to edit their environment.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socketserver
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # projects/infinite-story
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
PREFIX = "/ollama"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # keep the log readable: one line per request
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _proxy(self, method: str):
        path = self.path[len(PREFIX):]            # /ollama/api/chat -> /api/chat
        if not path.startswith("/"):
            path = "/" + path
        url = OLLAMA + path

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))

        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                payload = res.read()
                status = res.status
                ctype = res.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            payload = e.read()
            status = e.code
            ctype = e.headers.get("Content-Type", "application/json")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            message = json.dumps({"error": f"ollama unreachable at {OLLAMA}: {e}"}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
            return

        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith(PREFIX):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith(PREFIX):
            return self._proxy("POST")
        self.send_error(404, "not found")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def end_headers(self):
        # a little polish for the static side
        if not self.path.startswith(PREFIX):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()

    if not os.path.isdir(ROOT):
        sys.exit(f"cannot find {ROOT}")

    with Server((args.host, args.port), Handler) as httpd:
        print(f"Infinite Story   http://localhost:{args.port}/")
        print(f"Ollama proxy     http://localhost:{args.port}{PREFIX}  ->  {OLLAMA}")
        print("Ctrl-C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")


if __name__ == "__main__":
    main()
