// Backend API client for the gym: auth, module resolve, form upsert.
// Routes verified live against boxfusion.test (Shesha 0.45 backend):
//   Module list lives under /api/services/app/Module (NOT Shesha/Module).
import fs from 'node:fs';
import path from 'node:path';

// ---- token file resolution ---------------------------------------------------
// NEVER derive this from the script's own directory: that is the installed plugin
// tree, shared across every project and every backend, and a session token has no
// business being cached there [contracts.md §2–3]. Order: explicit arg →
// SHESHA_TOKEN_FILE → the session workdir (cwd).
export function resolveTokenFile(explicit) {
  if (explicit) return path.resolve(explicit);
  const fromEnv = (process.env.SHESHA_TOKEN_FILE ?? '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), 'access-token');
}

// A hostname where the well-known local-dev credentials are acceptable.
const isLocalHost = (baseUrl) => {
  let host;
  try { host = new URL(baseUrl).hostname; } catch { return false; }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
};

export class GymApi {
  /**
   * @param {string} baseUrl backend origin
   * @param {{tokenFile?: string, user?: string, password?: string}} [opts]
   */
  constructor(baseUrl = 'http://localhost:21021', opts = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = null;
    this.tokenFile = resolveTokenFile(opts.tokenFile);
    this.user = opts.user ?? null;
    this.password = opts.password ?? null;
  }

  /**
   * Credentials, most specific first: explicit args → constructor opts →
   * SHESHA_USER / SHESHA_PASSWORD. The local-dev default is a localhost-only
   * convenience; against any other host, missing credentials is a hard error.
   */
  resolveCredentials(user, password) {
    const u = user ?? this.user ?? (process.env.SHESHA_USER || null);
    const p = password ?? this.password ?? (process.env.SHESHA_PASSWORD || null);
    if (u && p) return { user: u, password: p };
    if (isLocalHost(this.baseUrl)) return { user: u ?? 'admin', password: p ?? '123qwe' };
    throw new Error(
      `refusing to authenticate against ${this.baseUrl} without credentials — ` +
      'set SHESHA_USER and SHESHA_PASSWORD (or pass them explicitly). ' +
      'The built-in local-dev default is only allowed for localhost/127.0.0.1.',
    );
  }

  async authenticate(user, password) {
    const TOKEN_FILE = this.tokenFile;
    // A cached token IS a credential — try it first. Credentials are resolved only
    // when we have to POST Authenticate, and resolveCredentials throws there before
    // any request leaves the process.
    if (fs.existsSync(TOKEN_FILE)) {
      const cached = fs.readFileSync(TOKEN_FILE, 'utf8').replace(/^﻿/, '').trim();
      if (cached) {
        this.token = cached;
        // validate cached token cheaply
        const probe = await fetch(`${this.baseUrl}/api/services/app/Module/GetAll?maxResultCount=1`, {
          headers: this.headers(),
        });
        if (probe.ok) return this.token;
        this.token = null;
      }
    }
    const creds = this.resolveCredentials(user, password);
    const res = await fetch(`${this.baseUrl}/api/TokenAuth/Authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userNameOrEmailAddress: creds.user, password: creds.password }),
    });
    if (!res.ok) throw new Error(`auth failed: HTTP ${res.status}`);
    const body = await res.json();
    this.token = body?.result?.accessToken ?? body?.accessToken;
    if (!this.token) throw new Error('auth response had no accessToken');
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, this.token, { encoding: 'utf8' }); // BOM-free [contracts.md §2]
    return this.token;
  }

  headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  async getJson(url) {
    const res = await fetch(`${this.baseUrl}${url}`, { headers: this.headers() });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  }

  async resolveModuleId(name) {
    const { ok, status, body } = await this.getJson('/api/services/app/Module/GetAll?maxResultCount=100');
    if (!ok) throw new Error(`Module/GetAll failed: HTTP ${status}`);
    const mod = (body?.result?.items ?? []).find((m) => m.name === name);
    if (!mod) throw new Error(`module not found: ${name}`);
    return mod.id;
  }

  async getFormByName(module, name) {
    const { ok, body } = await this.getJson(
      `/api/services/Shesha/FormConfiguration/GetByName?module=${encodeURIComponent(module)}&name=${encodeURIComponent(name)}`,
    );
    return ok ? body?.result ?? null : null;
  }

  /** Create-or-update. Returns backend form id. */
  async upsertForm({ moduleName, moduleId, name, markup, modelType }) {
    const markupStr = typeof markup === 'string' ? markup : JSON.stringify(markup);
    const existing = await this.getFormByName(moduleName, name);
    if (existing?.id) {
      const res = await fetch(`${this.baseUrl}/api/services/Shesha/FormConfiguration/UpdateMarkup`, {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: existing.id, markup: markupStr }),
      });
      if (!res.ok) throw new Error(`UpdateMarkup ${name} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return { id: existing.id, action: 'updated' };
    }
    const res = await fetch(`${this.baseUrl}/api/services/Shesha/FormConfiguration/Create`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ moduleId, name, label: name, description: 'component gym (generated)', modelType, markup: markupStr }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Create ${name} failed: HTTP ${res.status} ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
    return { id: body?.result?.id ?? body?.result, action: 'created' };
  }
}
