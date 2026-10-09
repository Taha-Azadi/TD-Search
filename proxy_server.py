#!/usr/bin/env python3
"""
TD Search — Local proxy for SerpAPI + OpenRouter
================================================
- Serves static app files
- GET  /api/search  → SerpAPI (google, images, news, videos, maps)
- POST /api/ai      → OpenRouter chat completions
- GET  /api/health

Keys stay on the machine running this process (not in the browser).

Usage:
  python3 proxy_server.py --key SERPAPI_KEY --openrouter OPENROUTER_KEY
  # or env: SERPAPI_KEY / OPENROUTER_API_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_PORT = 8080
SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

ALLOWED_ENGINES = {
    "google",
    "google_images",
    "google_news",
    "google_videos",
    "google_maps",
}


class ProxyHandler(SimpleHTTPRequestHandler):
    serpapi_key: str = ""
    openrouter_key: str = ""
    directory: str = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.directory, **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self) -> None:
        # Prevent sticky browser cache of JS/CSS during development
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


    def _set_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/search":
            self._handle_serpapi(parsed)
            return
        if parsed.path == "/api/health":
            self._send_json(200, {
                "ok": True,
                "has_serpapi_key": bool(self.serpapi_key),
                "has_openrouter_key": bool(self.openrouter_key),
                "engines": sorted(ALLOWED_ENGINES),
                "message": "TD Search proxy is running",
            })
            return
        if parsed.path == "/api/ai":
            self._send_json(405, {
                "error": "Use POST /api/ai with JSON body {\"q\": \"your question\", \"model\": \"openai/gpt-4o-mini\"}"
            })
            return
        if parsed.path == "/api":
            self._send_json(200, {
                "endpoints": {
                    "GET /api/health": "proxy status",
                    "GET /api/search?q=&engine=": "SerpAPI (google, google_images, google_videos, google_news, google_maps)",
                    "POST /api/ai": "OpenRouter chat",
                }
            })
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/ai":
            self._handle_openrouter()
            return
        self._send_json(404, {"error": "Not found"})

    def _handle_serpapi(self, parsed: urllib.parse.ParseResult) -> None:
        if not self.serpapi_key:
            self._send_json(500, {
                "error": "No SerpAPI key. Restart: python3 proxy_server.py --key YOUR_KEY"
            })
            return

        qs = urllib.parse.parse_qs(parsed.query)
        query = (qs.get("q") or qs.get("query") or [""])[0].strip()
        if not query:
            self._send_json(400, {"error": "Missing query parameter ?q="})
            return

        engine = (qs.get("engine") or ["google"])[0]
        if engine not in ALLOWED_ENGINES:
            engine = "google"

        num = (qs.get("num") or ["10"])[0]
        hl = (qs.get("hl") or ["fa"])[0]
        gl = (qs.get("gl") or ["ir"])[0]

        params = {
            "q": query,
            "api_key": self.serpapi_key,
            "engine": engine,
            "num": num,
            "hl": hl,
            "gl": gl,
        }
        # maps sometimes uses ll / type — keep minimal
        if engine == "google_maps":
            params["type"] = (qs.get("type") or ["search"])[0]

        url = SERPAPI_ENDPOINT + "?" + urllib.parse.urlencode(params)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "TD-Search-Proxy/2.0"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self._set_cors()
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8", errors="replace")
                err_json = json.loads(err_body)
                msg = err_json.get("error") or err_body
            except Exception:
                msg = str(e)
            self._send_json(e.code if e.code else 502, {"error": msg})
        except Exception as e:
            self._send_json(502, {"error": f"SerpAPI proxy failed: {e}"})

    def _handle_openrouter(self) -> None:
        if not self.openrouter_key:
            self._send_json(500, {
                "error": "No OpenRouter key. Restart with --openrouter YOUR_KEY or set OPENROUTER_API_KEY"
            })
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        query = (body.get("q") or body.get("query") or "").strip()
        if not query:
            self._send_json(400, {"error": "Missing q / query in body"})
            return

        model = body.get("model") or "nvidia/nemotron-3.5-lightning:free"
        system = body.get("system") or (
            "You are a helpful search assistant. Answer clearly and concisely in the same "
            "language as the user. Use Markdown when helpful (lists, bold, code blocks). "
            "Remember prior messages in this conversation. Say when you are unsure."
        )

        history = body.get("messages") or []
        messages = [{"role": "system", "content": system}]
        if isinstance(history, list):
            for m in history:
                if not isinstance(m, dict):
                    continue
                role = m.get("role")
                content = m.get("content")
                if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                    messages.append({"role": role, "content": content})
        if not messages or messages[-1].get("role") != "user" or messages[-1].get("content") != query:
            messages.append({"role": "user", "content": query})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": float(body.get("temperature", 0.4)),
        }

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            OPENROUTER_ENDPOINT,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.openrouter_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://127.0.0.1:8080",
                "X-Title": "TD Search",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw_resp = resp.read()
                parsed = json.loads(raw_resp.decode("utf-8"))
                # Normalize for frontend
                content = ""
                try:
                    content = parsed["choices"][0]["message"]["content"] or ""
                except Exception:
                    content = ""
                self._send_json(200, {
                    "answer": content,
                    "model": parsed.get("model") or model,
                    "usage": parsed.get("usage"),
                    "raw_id": parsed.get("id"),
                })
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8", errors="replace")
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message") if isinstance(err_json.get("error"), dict) else err_json.get("error") or err_body
            except Exception:
                msg = str(e)
            self._send_json(e.code if e.code else 502, {"error": msg})
        except Exception as e:
            self._send_json(502, {"error": f"OpenRouter proxy failed: {e}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="TD Search proxy (SerpAPI + OpenRouter)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--key", type=str, default="", help="SerpAPI key")
    parser.add_argument("--openrouter", type=str, default="", help="OpenRouter API key")
    parser.add_argument("--dir", type=str, default=".")
    args = parser.parse_args()

    serp = args.key or os.environ.get("SERPAPI_KEY", "").strip()
    or_key = args.openrouter or os.environ.get("OPENROUTER_API_KEY", "").strip()

    if not serp:
        print("WARNING: No SerpAPI key (--key / SERPAPI_KEY). Web/Images/News/Videos/Maps disabled.")
    else:
        print(f"SerpAPI key loaded ({serp[:6]}…{serp[-4:]})")
    if not or_key:
        print("WARNING: No OpenRouter key (--openrouter / OPENROUTER_API_KEY). AI tab disabled.")
    else:
        print(f"OpenRouter key loaded ({or_key[:6]}…{or_key[-4:]})")

    root = Path(args.dir).resolve()
    if not (root / "index.html").exists():
        print(f"ERROR: index.html not found in {root}")
        sys.exit(1)

    ProxyHandler.serpapi_key = serp
    ProxyHandler.openrouter_key = or_key
    ProxyHandler.directory = str(root)
    # backward compat attribute used nowhere critical
    ProxyHandler.api_key = serp

    server = ThreadingHTTPServer(("127.0.0.1", args.port), ProxyHandler)
    print(f"Serving TD Search at  http://127.0.0.1:{args.port}")
    print(f"SerpAPI proxy:        http://127.0.0.1:{args.port}/api/search?q=test")
    print(f"OpenRouter AI:        POST http://127.0.0.1:{args.port}/api/ai")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
