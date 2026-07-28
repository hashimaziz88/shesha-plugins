// Backend API client for the gym: auth, module resolve, form upsert.
// Routes verified live against boxfusion.test (Shesha 0.45 backend):
//   Module list lives under /api/services/app/Module (NOT Shesha/Module).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// The cached token belongs in the session workdir, not the skill tree — contracts.md §2/§3.
// SHESHA_TOKEN_FILE (or a workdir via SHESHA_WORKDIR) wins; the in-skill path is the
// legacy fallback and is git-ignored.
const TOKEN_FILE = process.env.SHESHA_TOKEN_FILE
  || (process.env.SHESHA_WORKDIR ? path.join(process.env.SHESHA_WORKDIR, 'access-token') : null)
  || path.join(SCRIPT_DIR, '..', '..', 'access-token');

export class GymApi {
  constructor(baseUrl = 'http://localhost:21021') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = null;
  }

  /**
   * Credentials are never defaulted. They come from the caller, else the
   * environment (SHESHA_USER / SHESHA_PASSWORD), else --local-dev-insecure-defaults
   * opts in explicitly to the well-known local-dev pair. A hardcoded default
   * silently authenticates against whatever backend it is pointed at.
   */
  async authenticate(user, password) {
    let u = user ?? process.env.SHESHA_USER;
    let p = password ?? process.env.SHESHA_PASSWORD;
    if ((!u || !p) && process.argv.includes('--local-dev-insecure-defaults')) {
      u = u || 'admin';
      p = p || '123qwe';
    }
    if (!u || !p) {
      throw new Error(
        'No backend credentials. Supply them from task context, or set SHESHA_USER and ' +
        'SHESHA_PASSWORD, or pass --local-dev-insecure-defaults for a throwaway local backend.'
      );
    }
    return this.#authenticateWith(u, p);
  }

  async #authenticateWith(user, password) {
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
    const res = await fetch(`${this.baseUrl}/api/TokenAuth/Authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userNameOrEmailAddress: user, password }),
    });
    if (!res.ok) throw new Error(`auth failed: HTTP ${res.status}`);
    const body = await res.json();
    this.token = body?.result?.accessToken ?? body?.accessToken;
    if (!this.token) throw new Error('auth response had no accessToken');
    fs.writeFileSync(TOKEN_FILE, this.token, { encoding: 'utf8' });
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
