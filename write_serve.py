#!/usr/bin/env python3
"""Helper: writes the corrected serve.py"""
import os
content = r'''#!/usr/bin/env python3
"""
Local proxy server for QA4AI_dash_metrics.html
Usage:  python3 serve.py
Open:   http://localhost:7755
"""
import base64, http.server, http.client, ssl, os, sys

PORT         = 7755
HTML_FILE    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "QA4AI_dash_metrics.html")
GRAFANA_HOST = "unified-dash-grafana.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io"
GFAUTH       = "Basic " + base64.b64encode(b"admin:ZenLabs@2025!").decode()

# Bypass self-signed cert check — ACA uses managed certs but Python 3.14 chain check fails
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode    = ssl.CERT_NONE


def grafana_get(path):
    """Open a fresh HTTPS connection per request so _CTX is applied correctly."""
    conn = http.client.HTTPSConnection(GRAFANA_HOST, context=_CTX, timeout=15)
    try:
        conn.request("GET", path, headers={
            "Authorization": GFAUTH,
            "Accept": "application/json",
            "User-Agent": "QA4AI-Proxy/1.0",
        })
        r    = conn.getresponse()
        body = r.read()
        ct   = r.getheader("Content-Type", "application/json")
        return r.status, ct, body
    finally:
        conn.close()


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, f, *a):
        if "/datasources" not in self.path:
            super().log_message(f, *a)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type")

    def _send(self, status, ct, body):
        self.send_response(status)
        self.send_header("Content-Type",   ct)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _html(self):
        try:
            data = open(HTML_FILE, "rb").read()
        except FileNotFoundError:
            self.send_error(404, "HTML not found")
            return
        # Rewrite absolute Grafana URLs -> localhost so browser makes same-origin calls
        data = data.replace(
            b"https://unified-dash-grafana.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io",
            b"http://localhost:" + str(PORT).encode(),
        )
        self._send(200, "text/html; charset=utf-8", data)

    def _proxy(self):
        try:
            status, ct, body = grafana_get(self.path)
            self._send(status, ct, body)
        except Exception as e:
            err = f'{{"error":"{e}"}}'.encode()
            self._send(502, "application/json", err)
            print(f"  [proxy] {self.path} -> ERROR: {e}", file=sys.stderr)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html", "/QA4AI_dash_metrics.html"):
            self._html()
        elif self.path.startswith("/api/"):
            self._proxy()
        else:
            self.send_error(404)


if __name__ == "__main__":
    server = http.server.HTTPServer(("", PORT), H)
    print(f"\n  QA4AI Dashboard — local proxy")
    print(f"  \033[1;36mhttp://localhost:{PORT}\033[0m")
    print(f"  Forwarding /api/* → https://{GRAFANA_HOST}")
    print(f"  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
        sys.exit(0)
'''

dest = os.path.join(os.path.dirname(__file__), "serve.py")
with open(dest, "w") as f:
    f.write(content)
print(f"Written {len(content)} bytes to {dest}")
