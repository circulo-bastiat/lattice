#!/usr/bin/env node
// mirroretagcheck.mjs - #9701: tools/infra/mirror.mjs api() sends If-None-Match on a repeated GET and returns the cached body on 304 (a 304 does not count
// against the 5000/h that MIRROR_TOKEN shares with the PAT: same GitHub user; 22 Oct 19:59Z the pool hit 0). A write never sends it. Breaks: no header, no cache.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const INFRA = join(dirname(fileURLToPath(import.meta.url)), 'infra'), SRC = readFileSync(join(INFRA, 'mirror.mjs'), 'utf8');
process.env.MIRROR_TOKEN = process.env.MIRROR_TOKEN || 'test-token';
// #9920: refreshAppToken() reads App creds from ~/.brain and MCLITE_PROJECTS/_secrets; on the brain VM it would mint through the mocked fetch below
process.env.HOME = mkdtempSync(join(tmpdir(), 'mec-home-')); delete process.env.MCLITE_PROJECTS;
let asserts = 0, fails = 0, breaks = 0, k = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
async function cases(src) {
  const d = mkdtempSync(join(tmpdir(), 'mec-')), bad = [];
  const real = globalThis.fetch, seen = [];
  try {
    for (const f of readdirSync(INFRA).filter((x) => x.endsWith('.mjs') || x.endsWith('.json'))) copyFileSync(join(INFRA, f), join(d, f));
    writeFileSync(join(d, `mirror${k}.mjs`), src);
    const { mirrorApi } = await import(pathToFileURL(join(d, `mirror${k++}.mjs`)).href);
    globalThis.fetch = async (url, o) => { const h = o.headers || {}; seen.push({ m: o.method, inm: h['if-none-match'] || null });
      const hdr = { get: (n) => (n === 'etag' ? '"E1"' : null) };
      if (o.method === 'GET' && h['if-none-match'] === '"E1"') return { status: 304, ok: false, headers: hdr, json: async () => { throw new Error('304 has no body'); } };
      return { status: 200, ok: true, headers: hdr, json: async () => ({ workflow_runs: [{ id: 7, status: 'in_progress' }] }) }; };
    const t = (n, c) => { if (!c) bad.push(n); };
    const a = await mirrorApi('GET', '/repos/o/r/actions/runs?head_sha=abc&per_page=5');
    const b = await mirrorApi('GET', '/repos/o/r/actions/runs?head_sha=abc&per_page=5');
    await mirrorApi('POST', '/repos/o/r/actions/runs?head_sha=abc&per_page=5', { x: 1 });
    t('the first GET sends no If-None-Match', seen[0] && seen[0].inm === null);
    t('a repeated GET sends the ETag', seen[1] && seen[1].inm === '"E1"');
    t('a 304 returns the cached body', b && b.workflow_runs && b.workflow_runs[0].id === 7 && JSON.stringify(a) === JSON.stringify(b));
    t('a write never sends If-None-Match', seen[2] && seen[2].m === 'POST' && seen[2].inm === null);
  } catch (e) { bad.push('threw: ' + String(e.message).slice(0, 120)); } finally { globalThis.fetch = real; rmSync(d, { recursive: true, force: true }); }
  return bad;
}
const r = await cases(SRC); ok(r.length === 0, 'mirror api: ' + r.join('; '));
// #9701: the GitHub App token (apptoken.mjs): a verifiable RS256 JWT, the installation lookup then the token, no creds = null
{ const { generateKeyPairSync, createVerify } = await import('node:crypto'); const A = await import('./infra/apptoken.mjs');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const j = A.appJwt('123', pem, Date.parse('2026-10-22T20:00:00Z')).split('.'); const p = JSON.parse(Buffer.from(j[1], 'base64url'));
  ok(createVerify('RSA-SHA256').update(j[0] + '.' + j[1]).verify(publicKey, Buffer.from(j[2], 'base64url')) && p.iss === '123' && p.exp - p.iat <= 600, 'app JWT verifies, iss = app id, life <= 10 min');
  const calls = []; const f = async (u, o = {}) => { calls.push((o.method || 'GET') + ' ' + u.replace('https://api.github.com', '')); return u.endsWith('/installation') ? { ok: true, json: async () => ({ id: 77 }) } : { ok: true, json: async () => ({ token: 'ghs_x' }) }; };
  ok(await A.mintAppToken({ appId: '123', pem, repo: 'o/lattice', fetchFn: f }) === 'ghs_x' && calls.join() === 'GET /repos/o/lattice/installation,POST /app/installations/77/access_tokens', 'mint: installation lookup, then its access token');
  const keep = [process.env.MIRROR_APP_ID, process.env.MIRROR_APP_KEY]; delete process.env.MIRROR_APP_ID; delete process.env.MIRROR_APP_KEY;
  ok(A.appCreds('/nonexistent') === null, 'no app creds = null (MIRROR_TOKEN stays)');
  process.env.MIRROR_APP_ID = '5'; process.env.MIRROR_APP_KEY = pem; ok(A.appCreds('/nonexistent')?.appId === '5', 'env creds are read');
  if (keep[0] === undefined) delete process.env.MIRROR_APP_ID; else process.env.MIRROR_APP_ID = keep[0]; if (keep[1] === undefined) delete process.env.MIRROR_APP_KEY; else process.env.MIRROR_APP_KEY = keep[1];
  const W = /async function api\(method, path, body\) \{\n  await refreshAppToken\(\);/; ok(W.test(SRC) && (SRC.match(/await refreshAppToken\(\);   \/\/ #9701/g) || []).length === 3, 'api() and the three pushes refresh the App token');
  if (!W.test(SRC.replace('  await refreshAppToken();\n', ''))) { breaks++; console.log('  ✓ api() without the App refresh is caught'); } }
for (const [name, src] of [['no If-None-Match header', SRC.replace("...(c ? { 'if-none-match': c.etag } : {})", '')], ['no cache on 304', SRC.replace('if (r.status === 304 && c) return c.body;', '')]]) {
  if (src === SRC) { ok(false, 'break did not apply: ' + name); continue; }
  const b = await cases(src); ok(b.length > 0, `cases cannot tell "${name}"`); if (b.length) { breaks++; console.log(`  ✓ "${name}" caught: ${b[0]}`); }
}
console.log(`mirroretagcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
