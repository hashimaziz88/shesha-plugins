"""Read-only LandBank API helper. Usage: from lbapi import Api; a=Api('046'|'p2')"""
import json, urllib.request, urllib.parse, os, ssl
from paths import CRED
HOSTS = {'046': 'https://landbankcrm-api-0-46-upgrade.shesha.app', 'p2': 'https://landbankcrm-api-lb-phase2.shesha.app', 'local': 'http://localhost:21021'}
FRONT = {'046': 'https://landbankcrm-adminportal-0-46-upgrade.shesha.app', 'p2': 'https://landbankcrm-adminportal-lb-phase2.shesha.app', 'local': 'http://localhost:3000'}
_TOK = {}
class Api:
    def __init__(self, env):
        self.env, self.base = env, HOSTS[env]
        if env not in _TOK:
            c = json.load(open(CRED))
            r = self._raw('POST', '/api/TokenAuth/Authenticate', {'userNameOrEmailAddress': c['username'], 'password': c['password']}, auth=False)
            _TOK[env] = r['result']['accessToken']
        self.token = _TOK[env]
    def _raw(self, method, path, body=None, params=None, auth=True):
        if method != 'GET' and not path.endswith('/Authenticate'):
            raise RuntimeError('READ-ONLY helper: refusing ' + method + ' ' + path)
        url = self.base + path + ('?' + urllib.parse.urlencode(params) if params else '')
        h = {'Content-Type': 'application/json'}
        if auth: h['Authorization'] = 'Bearer ' + self.token
        req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, h, method=method)
        with urllib.request.urlopen(req, timeout=120) as r:
            t = r.read().decode('utf-8', 'replace')
            try: return json.loads(t)
            except Exception: return t
    def get(self, path, **params): return self._raw('GET', path, params=params or None)
