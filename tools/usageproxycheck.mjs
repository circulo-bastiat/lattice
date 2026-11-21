#!/usr/bin/env node
// usageproxycheck.mjs - #7473 (14 Oct): Node's fetch ignores HTTPS_PROXY, so on proxy-only hosts (sandbox VM, cloud boxes) every
// live usage read died with "fetch failed" and `go.mjs status` printed nothing per account. usaged must go through curl when a proxy
// is set, and status must fall back to the PC daemon's published per-account table when no account is live.
// 1. behaviour (fake curl on PATH)  2. wiring  3. anti-vacuity (each break must be caught).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const here = (f) => fileURLToPath(new URL('../' + f, import.meta.url));
const rd = (f) => readFileSync(here(f), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const SRC = rd('tools/usaged.mjs'), GO = rd('tools/go.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'usageproxy-'));
mkdirSync(join(tmp, 'bin'));
writeFileSync(join(tmp, 'bin', 'curl'), '#!/bin/sh\nprintf \'{"seven_day":{"utilization":42,"resets_at":"x"},"five_hour":{"utilization":7,"resets_at":"y"}}\\n\'"${FAKE_STATUS:-200}"\n');
chmodSync(join(tmp, 'bin', 'curl'), 0o755);
const cfg = join(tmp, 'cfg'); mkdirSync(cfg);
writeFileSync(join(cfg, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 36e5 } }));
const load = async (src, n) => { const f = here('tools/_usageproxy_' + n + '.mjs'); writeFileSync(f, src); try { return await import(pathToFileURL(f).href + '?v=' + n + Date.now()); } finally { rmSync(f, { force: true }); } };
async function cases(src, n) {
  const bad = [], U = await load(src, n), save = { P: process.env.PATH, H: process.env.HTTPS_PROXY, h: process.env.https_proxy };
  const failFetch = async () => { throw new Error('plain fetch used'); };
  try {
    process.env.PATH = join(tmp, 'bin') + ':' + save.P; process.env.HTTPS_PROXY = 'http://proxy:1'; delete process.env.https_proxy;
    if (!U.proxied()) bad.push('proxied() false with HTTPS_PROXY set');
    let r; try { r = await U.readUsage(cfg, { renew: false }); } catch (e) { r = { ok: false, why: e.message }; }
    if (!(r.ok && r.week && r.week.pct === 42 && r.window.pct === 7)) bad.push('proxied host: readUsage did not go through curl: ' + JSON.stringify(r).slice(0, 120));
    process.env.FAKE_STATUS = '401'; try { const r4 = await U.readUsage(cfg, { renew: false }).catch((e) => ({ ok: null, why: e.message })); if (!(r4.ok === false && r4.status === 401)) bad.push('proxied host: a 401 through curl is not reported as 401'); } finally { delete process.env.FAKE_STATUS; }
    delete process.env.HTTPS_PROXY;
    if (U.proxied()) bad.push('proxied() true with no proxy');
    const g = globalThis.fetch; globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ seven_day: { utilization: 1 }, five_hour: { utilization: 2 } }) });
    try { const r2 = await U.readUsage(cfg, { renew: false }); if (!(r2.ok && r2.week.pct === 1)) bad.push('no proxy: plain fetch not used'); } finally { globalThis.fetch = g; }
    const r3 = await U.readUsage(cfg, { renew: false, fetchFn: async () => ({ status: 401, ok: false }) });
    if (r3.ok !== false || r3.status !== 401) bad.push('an injected fetchFn is no longer honoured');
  } finally { process.env.PATH = save.P; if (save.H === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = save.H; if (save.h !== undefined) process.env.https_proxy = save.h; }
  void failFetch; return bad;
}
const wiring = (u, g) => { const b = [];
  if (!/fetchFn = netFetch/.test(u)) b.push('readUsage does not default to netFetch');
  if (!/renewLogin\(dir, \{ fetchFn = \(u, o\) => netFetch/.test(u)) b.push('renewLogin does not default to netFetch');
  if (!/proxied\(\) \? curlFetch/.test(u)) b.push('netFetch does not pick curl when proxied');
  if (!/usage per account \(published by the usage daemon/.test(g) || !/U\.table\(pub\)/.test(g)) b.push('go.mjs status has no published per-account fallback');
  return b; };
try {
  const bad = await cases(SRC, 'real'); ok(bad.length === 0, 'behaviour: ' + bad.join(' | '));
  ok(wiring(SRC, GO).length === 0, 'wiring: ' + wiring(SRC, GO).join(' | '));
  let k = 0;
  for (const [n, f] of [
    ['readUsage ignores the proxy (plain fetch always)', (s) => s.replace('(proxied() ? curlFetch(u, o) : fetch(u, o))', 'fetch(u, o)')],
    ['proxied() never true', (s) => s.replace("!!(process.env.HTTPS_PROXY || process.env.https_proxy)", 'false')],
    ['curl status line not parsed', (s) => s.replace('Number(out.slice(i + 1))', '200')],
    ['curl body dropped', (s) => s.replace('text = out.slice(0, i)', "text = '{}'")],
  ]) { const m = f(SRC); const c = m !== SRC && (await cases(m, 'b' + k++)).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
  for (const [n, f] of [
    ['readUsage defaults to plain fetch again', (u, g) => [u.replace('fetchFn = netFetch', 'fetchFn = fetch'), g]],
    ['renewLogin defaults to plain fetch again', (u, g) => [u.replace('fetchFn = (u, o) => netFetch(u, o)', 'fetchFn = fetch'), g]],
    ['status loses the published per-account fallback', (u, g) => [u, g.replace('U.table(pub)', 'null')]],
  ]) { const [u, g] = f(SRC, GO); const c = (u !== SRC || g !== GO) && wiring(u, g).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`usageproxycheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
