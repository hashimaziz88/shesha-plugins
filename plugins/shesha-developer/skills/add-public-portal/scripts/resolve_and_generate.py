#!/usr/bin/env python3
"""
Resolve the latest Shesha project template for a given version and download it.

Flow: authenticate (ABP TokenAuth) -> GetAll (JsonLogic version filter, newest first)
      -> take first result's id -> Generate -> save the returned template.

Credentials are read from env vars SHESHA_SVC_USER / SHESHA_SVC_PASS by default so
secrets never live in the skill. Never print them.

Usage:
  python resolve_and_generate.py --version 0.45 --company Acme --project MyApp --out ./tmpl
  python resolve_and_generate.py --list-versions          # print distinct versions, newest first
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = os.environ.get("SHESHA_API_BASE", "http://demoshesha.azurewebsites.net")
PT = "/api/services/SheshaAspnetCoreDemo/ProjectTemplate"


def _req(method, path, token=None, body=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def authenticate():
    user = os.environ.get("SHESHA_SVC_USER")
    pwd = os.environ.get("SHESHA_SVC_PASS")
    if not user or not pwd:
        sys.stderr.write(
            "ERROR: SHESHA_SVC_USER and/or SHESHA_SVC_PASS is not set.\n"
            "This skill will not proceed without credentials. Choose one:\n"
            "\n"
            "  1) Set them persistently in your shell profile, then reopen your shell:\n"
            "       echo 'export SHESHA_SVC_USER=\"your-username\"' >> ~/.zshrc\n"
            "       echo 'export SHESHA_SVC_PASS=\"your-password\"' >> ~/.zshrc\n"
            "\n"
            "  2) On macOS, store the password in Keychain and read it at shell startup:\n"
            "       security add-generic-password -s shesha-svc -a \"$USER\" -w 'your-password'\n"
            "       export SHESHA_SVC_USER=\"your-username\"\n"
            "       export SHESHA_SVC_PASS=\"$(security find-generic-password -s shesha-svc -a \"$USER\" -w)\"\n"
            "\n"
            "  3) One-shot for this command only (not persisted):\n"
            "       SHESHA_SVC_USER='...' SHESHA_SVC_PASS='...' python resolve_and_generate.py ...\n"
            "\n"
            "Never hard-code credentials inside this skill.\n"
        )
        sys.exit(2)
    try:
        raw = _req("POST", "/api/TokenAuth/Authenticate",
                   body={"userNameOrEmailAddress": user, "password": pwd})
    except Exception as e:
        sys.exit(f"ERROR: authentication request failed: {e}")
    try:
        return json.loads(raw)["result"]["accessToken"]
    except (KeyError, ValueError):
        sys.exit("ERROR: authentication response did not contain a token — credentials rejected "
                 "or endpoint changed. Do not reprint the credentials; verify them and retry.")


def get_all(token, version=None, max_results=None):
    params = {"sorting": "creationTime desc"}
    if version:
        params["filter"] = json.dumps({"==": [{"var": "version"}, version]})
    if max_results:
        params["maxResultCount"] = max_results
    raw = _req("GET", f"{PT}/GetAll", token=token, params=params)
    return json.loads(raw)["result"]["items"]


def list_versions(token):
    items = get_all(token)
    seen, out = set(), []
    for it in items:                       # already newest-first
        v = it.get("version")
        if v and v not in seen and not str(v).startswith("0.44"):
            seen.add(v)
            out.append(v)
    return out


def generate(token, template_id, company, project, out_dir):
    raw = _req("POST", f"{PT}/Generate", token=token,
               body={"projectTemplateId": template_id,
                     "companyName": company, "projectName": project})
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, f"{project}-template.zip")
    with open(dest, "wb") as f:
        f.write(raw)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version")
    ap.add_argument("--company")
    ap.add_argument("--project")
    ap.add_argument("--out", default="./shesha-template")
    ap.add_argument("--list-versions", action="store_true")
    a = ap.parse_args()

    token = authenticate()

    if a.list_versions:
        print("\n".join(list_versions(token)))
        return

    if not (a.version and a.company and a.project):
        sys.exit("ERROR: --version, --company and --project are required to generate.")

    items = get_all(token, version=a.version, max_results=1)
    if not items:
        sys.exit(f"ERROR: no template found for version {a.version}")
    tid = items[0]["id"]
    dest = generate(token, tid, a.company, a.project, a.out)
    print(json.dumps({"projectTemplateId": tid, "saved": dest}))


if __name__ == "__main__":
    main()