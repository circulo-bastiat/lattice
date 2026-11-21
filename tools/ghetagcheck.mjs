// tools/ghetagcheck.mjs - 22 Oct 2026: the one PAT ran dry three times in a day and the fill started nobody. gh() must send If-None-Match for
// GETs and serve a 304 from a cache shared by processes (a 304 is free), without caching writes, /rate_limit, or another token's answers,
// and busComments() must round `since` so its URL repeats. Runs the real gh.mjs against a local server; anti-vacuity: each break below
// is made in a copy of gh.mjs and must be caught by the same verdict.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const src = readFileSync(new URL('./infra/gh.mjs', import.meta.url), 'utf8');
process.env.NODE_USE_ENV_PROXY = '1'; process.env.NO_PROXY = '127.0.0.1,localhost'; process.env.MCLITE_GHLEDGER = 'off';
const work = mkdtempSync(join(tmpdir(), 'ghetag-'));
let seen = [];
const srv = createServer((req, res) => {
  const inm = req.headers['if-none-match'] || null; seen.push({ m: req.method, u: req.url, inm, auth: req.headers.authorization });
  if (req.method === 'GET' && inm === 'W/"v1"') { res.writeHead(304, { ETag: 'W/"v1"' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json', ETag: 'W/"v1"' }); res.end(JSON.stringify(req.method === 'GET' ? [1, 2, 3] : { ok: true }));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
process.env.MCLITE_API_BASE = `http://127.0.0.1:${srv.address().port}`;
let n = 0;
const verdicts = async (code) => {
  const bad = [], dir = join(work, 'c' + n), file = join(work, `gh${n++}.mjs`); writeFileSync(file, code);
  process.env.MCLITE_GHCACHE = dir; process.env.GH_TOKEN = 'tok1';
  const m = await import(pathToFileURL(file).href + '?v=' + n);
  const run = async (fn) => { seen = []; try { return await fn(); } catch (e) { bad.push('threw: ' + e.message.slice(0, 80)); return null; } };
  const a = await run(() => m.gh('GET', '/items'));
  if (JSON.stringify(a) !== '[1,2,3]' || seen[0].inm) bad.push('first GET must be a plain 200');
  const b = await run(() => m.gh('GET', '/items'));
  if (!seen[0] || seen[0].inm !== 'W/"v1"') bad.push('second GET did not send If-None-Match');
  if (JSON.stringify(b) !== '[1,2,3]') bad.push('a 304 did not return the cached body');
  await run(() => m.gh('POST', '/items', { x: 1 })); await run(() => m.gh('POST', '/items', { x: 1 }));
  if (seen.some((s) => s.m === 'POST' && s.inm)) bad.push('a POST was sent conditionally');
  await run(() => m.gh('GET', '/rate_limit')); await run(() => m.gh('GET', '/rate_limit'));
  if (seen.some((s) => /rate_limit/.test(s.u) && s.inm)) bad.push('/rate_limit was cached');
  process.env.GH_TOKEN = 'tok2'; await run(() => m.gh('GET', '/items'));
  if (seen.at(-1).inm) bad.push("another token was served the first token's cache key");
  process.env.GH_TOKEN = 'tok1'; process.env.MCLITE_GHCACHE = 'off'; await run(() => m.gh('GET', '/items')); await run(() => m.gh('GET', '/items'));
  if (seen.at(-1).inm) bad.push('MCLITE_GHCACHE=off still sent If-None-Match');
  if (!/Math\.floor\(\(Date\.now\(\) - days \* 86400e3\) \/ 600e3\) \* 600e3/.test(code)) bad.push('busComments() does not round `since`, so its URL never repeats');
  return bad;
};
const BREAKS = [
  ['no If-None-Match sent', (c) => c.replace("...(hit ? { 'If-None-Match': hit.etag } : {}),", '')],
  ['304 not served from the cache', (c) => c.replace('if (r.status === 304 && hit) return hit.body;', '')],
  ['cache never written', (c) => c.replace('if (cf) writeCache(', 'if (false) writeCache(')],
  ['cache key ignores the token', (c) => c.replace("update(`${t || ''}\\n${url}`)", 'update(`${url}`)')],
  ['writes are cached too', (c) => c.replace("method !== 'GET' || ", '')],
  ['rate_limit is cached', (c) => c.replace(' || /\\/rate_limit/.test(path)', '')],
  ['since is not rounded', (c) => c.replace('Math.floor((Date.now() - days * 86400e3) / 600e3) * 600e3', 'Date.now() - days * 86400e3')],
];
const real = await verdicts(src);
let caught = 0;
for (const [name, mk] of BREAKS) { const c = mk(src); if (c !== src && (await verdicts(c)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
srv.close(); rmSync(work, { recursive: true, force: true });
console.log(`ghetagcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${9 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
