// tools/infra/gh.mjs - the GitHub API, the token, and where things are. Shared by go.mjs, usaged.mjs,
// backlog-import.mjs and the lander. No dependencies (Node 18+ fetch).
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Behind a proxy (the Cowork VM, the cloud container) Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is
// set at startup, so re-run ourselves once with it set. Same arguments, same stdio, same exit code.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' } });
  process.exit(r.status ?? 1);
}
/** A cloud container (claude.ai/code): not Windows, not a Cowork /sessions/ home. */
export const CLOUD = process.platform !== 'win32' && !(process.env.HOME || '').startsWith('/sessions/');
/** The proxy there allows API reads and pushes to the session's own branch, and refuses API writes. */
export const proxyBlocked = (e) => !!e && e.status === 403 && /proxy/i.test(e.message);
export const REPO = process.env.MCLITE_REPO || 'owner/mclite';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Candidate Projects folders, most specific first. The token and usage file live under <Projects>/_secrets, _status. */
export function projectsDirs() {
  const c = [];
  if (process.env.MCLITE_PROJECTS) c.push(process.env.MCLITE_PROJECTS);
  c.push(resolve(ROOT, '..'));                                      // the repo usually IS Projects/mclite
  const H = process.env.HOME || process.env.USERPROFILE || '';
  if (H) {
    c.push(join(H, 'Downloads', 'Projects'));
    const mnt = join(H, 'mnt');                                        // Cowork: connected folders by name
    if (existsSync(mnt)) for (const d of readdirSync(mnt)) { c.push(join(mnt, d)); c.push(join(mnt, d, 'Projects')); }
  }
  return [...new Set(c)].filter((d) => existsSync(d));
}
export function findUnder(rel) {
  for (const d of projectsDirs()) { const p = join(d, rel); if (existsSync(p)) return p; }
  return null;
}
export function token() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.MCLITE_GH_TOKEN;
  if (t) return t.trim();
  const f = findUnder(join('_secrets', 'github-token.txt'));
  return f ? readFileSync(f, 'utf8').trim() : null;
}
// #ETAG (22 Oct 2026: the one PAT ran dry three times in a day, 50-110 calls a minute, and the fill started nobody). A conditional GET
// that answers 304 does not count against the primary rate limit, so every GET keeps its last answer in a cache shared by all processes on
// the machine and asks "has it changed?". MCLITE_GHCACHE=off disables it; MCLITE_API_BASE points the check at a local server.
const cacheDir = () => (process.env.MCLITE_GHCACHE === 'off' ? null : process.env.MCLITE_GHCACHE || join(tmpdir(), 'mclite-ghcache'));
function etagFile(method, path, url, t) {
  const d = cacheDir();
  if (!d || method !== 'GET' || /\/rate_limit/.test(path)) return null;
  return join(d, createHash('sha1').update(`${t || ''}\n${url}`).digest('hex') + '.json');
}
/** One line per API call in <tmpdir>/mclite-gh-calls.log (time, pid, script, method, status, path with ids blanked), so the next quota alarm can be
 *  attributed with `sort | uniq -c` instead of guessed at. 304 = free. MCLITE_GHLEDGER=off disables it. */
function ledger(method, path, status) {
  if (process.env.MCLITE_GHLEDGER === 'off') return;
  try {
    const f = join(tmpdir(), 'mclite-gh-calls.log');
    appendFileSync(f, `${new Date().toISOString().slice(11, 19)} ${process.pid} ${basename(process.argv[1] || '')} ${method} ${status} ${path.replace('{repo}', '').replace(/\?.*$/, '').replace(/\d{3,}/g, 'N')}\n`);
    if (Math.random() < 0.005 && statSync(f).size > 3e6) renameSync(f, f + '.1');
  } catch {}
}
function readCache(f) { try { const c = JSON.parse(readFileSync(f, 'utf8')); return c && c.etag ? c : null; } catch { return null; } }
function writeCache(f, etag, body) {
  if (!etag) return;
  try {
    const s = JSON.stringify({ etag, body }); if (s.length > 2e6) return;
    mkdirSync(dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, s, { mode: 0o600 }); renameSync(tmp, f);
    if (Math.random() < 0.02) for (const n of readdirSync(dirname(f))) { try { const p = join(dirname(f), n); if (Date.now() - statSync(p).mtimeMs > 864e5) unlinkSync(p); } catch {} }
  } catch {}
}
export async function gh(method, path, body, { ok404 = false } = {}) {
  const t = token();
  // a claude.ai/code cloud session may have no token of its own: its proxy authenticates GitHub for it
  if (!t && !CLOUD) throw new Error('NO_TOKEN');
  // 29 Sept: brain workers died with "fetch failed" on the first call after the 2-min assets build inside `go.mjs
  // start` (a pooled connection the network had dropped meanwhile). A network error - never an HTTP answer - is
  // retried up to 5 times (2-32 s apart, ~1 min in all) with a fresh connection.
  const url = `${process.env.MCLITE_API_BASE || 'https://api.github.com'}${path.replace('{repo}', REPO)}`;
  const cf = etagFile(method, path, url, t), hit = cf ? readCache(cf) : null;
  const call = () => fetch(url, {
    method,
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), Accept: 'application/vnd.github+json', 'User-Agent': 'mclite-go',
      'X-GitHub-Api-Version': '2022-11-28', ...(hit ? { 'If-None-Match': hit.etag } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30e3),   // 6 Oct: a waker's post hung on a dead connection for 25 min; a timeout is a network error, so it is retried below
  });
  let r;
  for (let i = 1; ; i++) {
    try {
      r = await call();
      // #9588: a 502/503/504 on an idempotent GET is transient (the #4589 rebase sweep died on a 503); retry 4 times (1-8 s apart)
      if (method === 'GET' && (r.status === 502 || r.status === 503 || r.status === 504) && i < 5) { await new Promise((res) => setTimeout(res, 1000 * 2 ** (i - 1))); continue; }
      break;
    }
    catch (e) { if (i >= 6) throw e; await new Promise((res) => setTimeout(res, 2000 * 2 ** (i - 1))); }   // ~1 min in all
  }
  ledger(method, path, r.status);
  if (r.status === 204) return {};
  if (r.status === 304 && hit) return hit.body;
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && ok404) return null;
  if (!r.ok) {
    const e = new Error(`GitHub ${method} ${path}: ${r.status} ${j.message || ''}`); e.status = r.status;
    // 30 Sept: the ONE PAT (5000 calls/h for Dan's user, shared by every runner, worker, lander and the phone) ran dry
    // at 01:10Z and 02:46Z; every session died on 403s and the waker that should restart the loop died too.
    // A rate-limit error now says so and carries when the quota comes back.
    if ((r.status === 403 || r.status === 429) && (r.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(j.message || ''))) {
      e.rateLimited = true; e.rateReset = Number(r.headers.get('x-ratelimit-reset') || 0) * 1000 || Date.now() + 60e3;
      e.message += ` (quota back at ${new Date(e.rateReset).toISOString().slice(11, 16)}Z)`;
    }
    throw e;
  }
  if (cf) writeCache(cf, r.headers.get('etag'), j);
  return j;
}
/** The core REST quota ({limit, used, remaining, reset(ms)}); GET /rate_limit itself costs nothing. null if unreachable. */
export async function rateLimit() {
  try { const c = (await gh('GET', '/rate_limit')).resources.core; return { ...c, reset: c.reset * 1000 }; } catch { return null; }
}
/** The bus issue (#53 and its successors): the open issue labelled `bus`. Once per process - it was one call per use. */
let BUS = null;
export async function busIssue() {
  if (BUS) return BUS;
  const b = await gh('GET', '/repos/{repo}/issues?state=open&labels=bus&per_page=1');
  if (!b.length) throw new Error('no open issue labelled `bus`');
  return (BUS = b[0].number);
}
/** Bus comments of the last `days` days. 30 Sept: every go.mjs call read the WHOLE bus (thousands of comments, up to
 *  50 API calls a read) - with 10 workers that alone emptied the hourly quota. Mail older than this is history. */
export const busComments = async (days = 2) => ghAll(`/repos/{repo}/issues/${await busIssue()}/comments?since=${new Date(Math.floor((Date.now() - days * 86400e3) / 600e3) * 600e3).toISOString()}`);   // rounded to 10 min so the URL repeats and the ETag cache can answer 304
/** Every page of a list endpoint. */
export async function ghAll(path) {
  const out = [];
  for (let p = 1; p < 50; p++) {
    const sep = path.includes('?') ? '&' : '?';
    let page;
    // 13 Oct: an empty/unparsable 200 body comes back from gh() as {}; spreading it crashed the rebase sweep with a bare TypeError
    for (let i = 0; i < 3; i++) {
      page = await gh('GET', `${path}${sep}per_page=100&page=${p}`);
      if (Array.isArray(page)) break;
      if (i < 2) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!Array.isArray(page)) throw new Error(`GitHub GET ${path}: non-list answer (page ${p})`);
    out.push(...page); if (page.length < 100) break;
  }
  return out;
}
/** A git -c flag that authenticates https pushes/fetches without writing the token into any config file. */
export function gitAuthArgs() {
  const t = token();
  // the cloud proxy adds its own credentials (a second header is refused) - but a brain runner (#105) is NOT behind it
  if (!t || (CLOUD && process.env.MCLITE_BRAIN !== '1')) return [];
  const b = Buffer.from(`x-access-token:${t}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${b}`];
}
