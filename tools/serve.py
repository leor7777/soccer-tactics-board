#!/usr/bin/env python3
"""Dev server and standalone build for Soccer Tactics Board.

index.html holds only the page content (the Artifact host adds the document skeleton).
This server wraps it in the same skeleton so local preview matches the published page.

  python3 tools/serve.py            # serve on http://localhost:5173
  python3 tools/serve.py --build    # write dist/ for hosting anywhere (Netlify, GitHub Pages)
"""
import http.server, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEAD = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
TAIL = '</body></html>'

def page():
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        return HEAD + f.read() + TAIL

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            body = page().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()
    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    if '--build' in sys.argv:
        out = os.path.join(ROOT, 'dist')
        shutil.rmtree(out, ignore_errors=True)
        shutil.copytree(os.path.join(ROOT, 'js'), os.path.join(out, 'js'))
        with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(page())
        print('Built', out)
    else:
        port = int(os.environ.get('PORT', '5173'))
        http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
