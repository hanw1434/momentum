"""WSGI entry point for Momentum — for hosts like PythonAnywhere that run
WSGI apps instead of a standalone server. Reuses all routes from server.py.
"""
import json
import mimetypes
import os
from http.client import responses

import server

mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('image/svg+xml', '.svg')


def _json_response(start_response, status, obj):
    data = json.dumps(obj).encode()
    start_response(f"{status} {responses.get(status, '')}".strip(),
                   [('Content-Type', 'application/json'), ('Content-Length', str(len(data)))])
    return [data]


def application(environ, start_response):
    method = environ['REQUEST_METHOD']
    path = environ.get('PATH_INFO', '/') or '/'

    if path.startswith('/api/'):
        for m, rx, fn, needs_auth in server.ROUTES:
            if m != method:
                continue
            match = rx.match(path)
            if not match:
                continue
            user = None
            if needs_auth:
                authz = environ.get('HTTP_AUTHORIZATION', '')
                token = authz[7:] if authz.startswith('Bearer ') else ''
                user = server.verify_token(token)
                if not user:
                    return _json_response(start_response, 401, {'error': 'Not signed in'})
            try:
                length = int(environ.get('CONTENT_LENGTH') or 0)
            except ValueError:
                length = 0
            body = {}
            if length:
                try:
                    body = json.loads(environ['wsgi.input'].read(length))
                except Exception:
                    body = {}
            if not isinstance(body, dict):
                body = {}
            try:
                status, obj = fn(user, body, *match.groups())
            except Exception:
                status, obj = 500, {'error': 'Server error'}
            return _json_response(start_response, status, obj)
        return _json_response(start_response, 404, {'error': 'Not found'})

    # Static files, with SPA fallback for extensionless paths.
    rel = path.lstrip('/') or 'index.html'
    fpath = os.path.normpath(os.path.join(server.PUBLIC, rel))
    if not fpath.startswith(server.PUBLIC):
        return _json_response(start_response, 404, {'error': 'Not found'})
    if not os.path.isfile(fpath) and '.' not in os.path.basename(path):
        fpath = os.path.join(server.PUBLIC, 'index.html')
    if not os.path.isfile(fpath):
        return _json_response(start_response, 404, {'error': 'Not found'})
    ctype = mimetypes.guess_type(fpath)[0] or 'application/octet-stream'
    with open(fpath, 'rb') as f:
        data = f.read()
    start_response('200 OK', [('Content-Type', ctype), ('Content-Length', str(len(data)))])
    return [data]
