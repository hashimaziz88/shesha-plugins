// The stub HTTP backend (§3.8). A node:http server on an ephemeral port returning ABP
// envelopes, so T4's consequence assertions are exercised with no live Shesha and no
// network. It covers the four HTTP shapes a recorded snapshot cannot express: 401/403,
// a transport failure, a non-JSON body, and `result: null` for an unknown record.
//
// It exists so `--selftest` proves the ASSERTIONS. Proving the transport against a real
// Shesha is BL-033 and is not something a green run may fake.

import http from 'node:http';

/** The records the stub serves. A path outside this map returns an ABP `result: null`. */
export const RECORDS = Object.freeze({
  '/api/services/app/Booking/Get?id=1': { id: 1, reference: 'BK-1001', status: 2 },
  '/api/services/app/Form/Get?name=booking-create': { name: 'booking-create', module: 'test' },
});

/**
 * Start the stub, hand `(origin, backendGet)` to `fn`, then always stop it.
 * @template T
 * @param {(origin:string, backendGet:(url:string)=>Promise<{status:number, body:any}>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withStubBackend(fn) {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/denied')) { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{}'); return; }
    if (url.startsWith('/garbage')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not json</html>'); return; }
    const hit = /** @type {Record<string, any>} */ (RECORDS)[url];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, error: null, result: hit === undefined ? null : hit }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  const origin = `http://127.0.0.1:${addr.port}`;
  /** @param {string} url */
  const backendGet = async (url) => {
    const r = await fetch(url.startsWith('http') ? url : `${origin}${url}`);
    const text = await r.text();
    /** @type {any} */
    let body;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { status: r.status, body };
  };
  try {
    return await fn(origin, backendGet);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}
