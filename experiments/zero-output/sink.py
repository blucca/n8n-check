#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
"""Local synthetic source and in-memory write ledger for the 0/1-record demo."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Mock(BaseHTTPRequestHandler):
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/source':
            response = payload['records']  # HTTP 200, including a valid [] body.
        elif self.path == '/commit':
            response = {'committed': True, 'written_count': 1,
                        'record_id': payload['record']['id']}
            print(json.dumps({'mock_write': payload, 'receipt': response}), flush=True)
        else:
            self.send_error(404)
            return
        raw = json.dumps(response).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_):
        pass


if __name__ == '__main__':
    print('Synthetic source / mock ledger: http://127.0.0.1:5681', flush=True)
    HTTPServer(('127.0.0.1', 5681), Mock).serve_forever()
