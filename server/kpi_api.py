# -*- coding: utf-8 -*-
"""KPI 프로젝트 최소 백엔드 (표준 라이브러리만). CORS 허용."""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys

HOST = "127.0.0.1"
PORT = 8787


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/api/health":
            self.send_json({"ok": True, "service": "kpi-api", "port": PORT})
        elif path == "/api":
            self.send_json({
                "endpoints": ["/api/health", "/api"],
                "note": "프론트는 현재 src/data/kpiData.js 정적 데이터 사용. API 연동 시 여기에 라우트 추가.",
            })
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()


def main():
    httpd = HTTPServer((HOST, PORT), Handler)
    print("KPI API  http://%s:%s/  (GET /api/health)" % (HOST, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
        sys.exit(0)


if __name__ == "__main__":
    main()
