#!/usr/bin/env python3
"""Thin HTTP shim around unoserver: POST vsdx bytes, get SVG bytes back."""
import http.server
import socketserver
import subprocess
import tempfile
import os
import sys
import time

PORT = 2003
UNOSERVER_PORT = 2004

# Start unoserver as a child process so libreoffice stays warm.
UNOSERVER = subprocess.Popen(
    ["/opt/unoserver-venv/bin/unoserver", "--port", str(UNOSERVER_PORT)],
    stdout=sys.stdout,
    stderr=sys.stderr,
)
# Give unoserver time to bind.
time.sleep(2)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/convert/svg":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            self.send_error(400, "empty body")
            return
        body = self.rfile.read(length)
        with tempfile.NamedTemporaryFile(suffix=".vsdx", delete=False) as f_in:
            f_in.write(body)
            in_path = f_in.name
        out_path = in_path.replace(".vsdx", ".svg")
        try:
            r = subprocess.run(
                ["/opt/unoserver-venv/bin/unoconvert", "--port", str(UNOSERVER_PORT),
                 "--convert-to", "svg", in_path, out_path],
                capture_output=True,
                timeout=20,
            )
            if r.returncode != 0:
                msg = (r.stderr.decode(errors="replace") or "unoconvert failed")[:300]
                self.send_error(500, f"unoconvert failed: {msg}")
                return
            with open(out_path, "rb") as f:
                svg = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(svg)))
            self.end_headers()
            self.wfile.write(svg)
        except subprocess.TimeoutExpired:
            self.send_error(504, "conversion timeout")
        except Exception as e:
            self.send_error(500, f"shim error: {str(e)[:200]}")
        finally:
            try: os.unlink(in_path)
            except OSError: pass
            try: os.unlink(out_path)
            except OSError: pass

    def log_message(self, fmt, *args):
        return


with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.allow_reuse_address = True
    httpd.serve_forever()
