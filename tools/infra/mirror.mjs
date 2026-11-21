// tools/infra/mirror.mjs - #6767 (Dan, 13 Oct): tests run on free GitHub-hosted runners in a PUBLIC mirror repo that lives in a
// separate organisation. The private repo stays the source of truth; the mirror only ever holds ONE scrubbed orphan commit per
// test run (no history, no issues, no PRs) plus the result, and both branches are deleted as soon as the result is read.
//   node tools/infra/mirror.mjs run -- <suite.mjs args>   snapshot the working tree, push t/<id>, wait, print the output, exit with its status
//   node tools/infra/mirror.mjs visibility private|public  (MIRROR-PRIVATE.cmd: Dan's undo switch for when the project is done)
// env: MIRROR_REPO (org/name, repo variable), MIRROR_TOKEN (secret: contents + workflows + actions on the mirror only).
import { gitExec } from './gitenv.mjs';
import { readFeed } from './fullshard.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Paths never published. Kept short on purpose: checks read RUN.md, roles.json, *.cmd ..., so those go out SCRUBBED (REPLACE) rather than
// missing - a mirror tree that differs from the private one would make the mirror's verdict differ too.
export const EXCLUDE = [/^\.claude\/(?!settings\.json$)/, /(^|\/)_secrets\//, /(^|\/)_status\//, /\.ipa$/i, /^docs\/(pass-cost|bench-[^/]*)\.json$/];
// The names are built from pieces so THIS file (and testmirrorcheck) publish unchanged: a scrubbed copy of the scrubber would test nothing.
const ACC = 'hiner' + 'manDanny'.toLowerCase(), MAIN = 'boiler' + 'bobbing', USR = 'hi' + 'ner', PC = 'DESKTOP-' + '6OUIDG0';
// Replacements applied to every text file that is published (strings in code such as the store URL default).
export const REPLACE = [[/[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|icloud)\.com/gi, 'user@invalid.invalid'], [new RegExp(ACC + '-dev', 'gi'), 'owner'],
  [new RegExp(ACC + '|' + MAIN, 'gi'), 'user'], [new RegExp('([A-Za-z]:[\\\\/]+Users[\\\\/]+)' + USR + '\\b', 'gi'), '$1user'], [new RegExp('/home/' + USR + '\\b', 'g'), '/home/user'],
  [new RegExp(PC, 'gi'), 'PC']];
// What must never reach the mirror; checked on the FINAL tree, so a gap in REPLACE fails the push instead of leaking.
export const FORBID = new RegExp(ACC + '|' + MAIN + '|@gmail\\.com|Users[\\\\/]+' + USR + '\\b|' + PC + '|x-access-token:[A-Za-z0-9_]', 'i');

/** files: [{path, buf}] -> {out: [{path, buf}], leaks: [path...]}. Pure: testmirrorcheck drives it with planted breaks. */
export function scrubTree(files, { exclude = EXCLUDE, replace = REPLACE, forbid = FORBID } = {}) {
  const out = [], leaks = [];
  for (const f of files) {
    if (exclude.some((r) => r.test(f.path))) continue;
    let buf = f.buf;
    if (!buf.includes(0)) { let t = buf.toString('utf8'); for (const [r, w] of replace) t = t.replace(r, w); buf = Buffer.from(t, 'utf8'); }
    if (forbid.test(f.path) || (!buf.includes(0) && forbid.test(buf.toString('utf8')))) leaks.push(f.path);
    // #6767: checks read the private workflows, but a file under .github/workflows would RUN on the mirror (schedules, pushes):
    // they travel as .ci-wf/ and ci.yml copies them back into the runner's workspace only
    out.push({ path: f.path.replace(/^\.github\//, '.ci-wf/'), buf });
  }
  return { out, leaks };
}

// on Dan's PC (MIRROR-PRIVATE.cmd) the two values come from <Projects>/_secrets/mirror-repo.txt and mirror-token.txt
const fromSecrets = (k) => { try { return readFileSync(join(ROOT, '..', '_secrets', k === 'MIRROR_REPO' ? 'mirror-repo.txt' : 'mirror-token.txt'), 'utf8').trim(); } catch { return ''; } };
const env = (k) => process.env[k] || fromSecrets(k) || (() => { throw new Error(`${k} is not set (repo variable MIRROR_REPO / secret MIRROR_TOKEN, or _secrets/mirror-*.txt)`); })();
// #9701: every wait on a mirror run (lander rounds, full-suite shards, each lockstep pilot) polls its runs list every 20-30 s, and MIRROR_TOKEN is the SAME
// GitHub user as the PAT: one 5000/h pool for everything (exhausted at 19:59Z on 22 Oct). A GET answered 304 (If-None-Match) does not count against it.
const etags = new Map();
// #9701: with GitHub App creds (tools/infra/apptoken.mjs) the mirror uses the App's own 5000/h, re-minted every 45 min; without them MIRROR_TOKEN as before
let appTok = null;
export async function refreshAppToken(now = Date.now()) {
  const { appCreds, mintAppToken } = await import('./apptoken.mjs'), c = appCreds(join(ROOT, '..', '_secrets')) || (process.env.MCLITE_PROJECTS ? appCreds(join(process.env.MCLITE_PROJECTS, '_secrets')) : null) || appCreds(join(homedir(), '.brain'));   // a clone next to Projects, the PC runners (MCLITE_PROJECTS), the brain VM (~/.brain: tick, farm, brain jobs): no workflow secret needed
  if (!c || (appTok && now - appTok.at < 45 * 60e3)) return !!c;
  try { appTok = { token: await mintAppToken({ ...c, repo: env('MIRROR_REPO'), now }), at: now }; process.env.MIRROR_TOKEN = appTok.token; return true; }
  catch (e) { console.log(`mirror: app token failed (${String(e.message).slice(0, 100)}); MIRROR_TOKEN as before`); return false; }
}
async function api(method, path, body) {
  await refreshAppToken();
  const c = method === 'GET' ? etags.get(path) : null;
  const r = await fetch(`https://api.github.com${path}`, { method, headers: { authorization: `Bearer ${env('MIRROR_TOKEN')}`, accept: 'application/vnd.github+json',
    'content-type': 'application/json', ...(c ? { 'if-none-match': c.etag } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 304 && c) return c.body;
  if (r.status === 404 || r.status === 409) return null;   // #6819: 409 = an empty repo (no refs yet)
  if (!r.ok) throw new Error(`mirror api ${method} ${path.replace(/\?.*/, '')} -> ${r.status}`);
  const out = r.status === 204 ? {} : await r.json();
  const et = method === 'GET' && r.headers && r.headers.get && r.headers.get('etag');
  if (et) { etags.set(path, { etag: et, body: out }); if (etags.size > 500) etags.delete(etags.keys().next().value); }
  return out;
}
export { api as mirrorApi };   // #9701: for mirroretagcheck
/** #7021: the branches a cut-off run left behind. list = [{ name, date }] (date = head commit time, ms or ISO). Never main; only t/ r/ f/ older than maxAge. */
export const STRAY = /^[trf]\//;
export function staleBranches(list, now = Date.now(), maxAge = 3 * 3600e3) {
  return (list || []).filter((b) => b && STRAY.test(b.name) && now - new Date(b.date).getTime() > maxAge).map((b) => b.name);
}
export async function pruneStale(repo, { all = false, A = api, now = Date.now() } = {}) {
  const list = [];
  for (let page = 1; page < 20; page++) {
    const r = await A('GET', `/repos/${repo}/branches?per_page=100&page=${page}`);
    if (!r || !r.length) break;
    list.push(...r); if (r.length < 100) break;
  }
  const cand = list.filter((b) => b.name !== 'main' && (all || STRAY.test(b.name))), dated = [];
  for (const b of cand) {
    if (all) { dated.push({ name: b.name, date: 0 }); continue; }
    const c = await A('GET', `/repos/${repo}/commits/${b.commit.sha}`).catch(() => null);
    const d = c && c.commit && (c.commit.committer || c.commit.author || {}).date;
    if (d) dated.push({ name: b.name, date: d });
  }
  const del = all ? dated.map((b) => b.name) : staleBranches(dated, now);
  for (const n of del) await A('DELETE', `/repos/${repo}/git/refs/heads/${n}`).catch(() => {});
  return del;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function snapshot(root, args) {
  const paths = gitExec(['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
  const files = []; for (const p of paths) { try { files.push({ path: p, buf: readFileSync(join(root, p)) }); } catch { /* deleted in the tree */ } }
  const { out, leaks } = scrubTree(files);
  if (leaks.length) throw new Error(`mirror: refusing to publish, personal data left after the scrub in ${leaks.slice(0, 5).join(', ')}`);
  const dir = mkdtempSync(join(tmpdir(), 'mirror-'));
  for (const f of out) { mkdirSync(dirname(join(dir, f.path)), { recursive: true }); writeFileSync(join(dir, f.path), f.buf); }
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), readFileSync(join(root, 'tools', 'infra', 'mirror', 'ci.yml')));
  writeFileSync(join(dir, '.github', 'workflows', 'ci-full.yml'), readFileSync(join(root, 'tools', 'infra', 'mirror', 'ci-full.yml')));
  writeFileSync(join(dir, '.github', 'workflows', 'ci-pilot.yml'), readFileSync(join(root, 'tools', 'infra', 'mirror', 'ci-pilot.yml')));
  writeFileSync(join(dir, '.github', 'workflows', 'land.yml'), readFileSync(join(root, 'tools', 'infra', 'mirror', 'land.yml')));
  // #9251: the planner's feed (real per-stage seconds from the last full runs) rides along, so the 16 shards are balanced by cost
  try { const t = readFeed(root); if (t && Object.keys(t).length) writeFileSync(join(dir, 'tools', 'stage-times.json'), JSON.stringify(t)); } catch { /* no feed yet: planned by count */ }
  writeFileSync(join(dir, '.ci-args'), args.join(' ') + '\n');
  return dir;
}

/** Stage EVERYTHING snapshot() wrote, ignored or not. The snapshot dir holds only tracked files (+ the workflows), but it carries the
 *  repo's .gitignore, so a plain `add -A` silently dropped the tracked-but-ignored tools/mobproof/matrix.json|md and phonevisualcheck
 *  read ENOENT on every mirror run (#8362, 20 Oct). `-f` makes the mirror tree exactly what was written. testmirrorcheck proves it. */
export function stageAll(g) { g('add', '-A', '-f'); }

async function run(args) {
  const repo = env('MIRROR_REPO'); await pruneStale(repo).catch(() => {});   // #7021
  const id = randomBytes(5).toString('hex'), dir = snapshot(ROOT, args);
  const g = (...a) => gitExec(a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g('init', '-q'); g('config', 'user.name', 'CI'); g('config', 'user.email', 'ci@invalid.invalid'); stageAll(g); g('commit', '-q', '-m', id);
  await refreshAppToken();   // #9701: the App token, when configured
  const sha = g('rev-parse', 'HEAD'), auth = Buffer.from(`x-access-token:${env('MIRROR_TOKEN')}`).toString('base64');
  try { g('-c', `http.extraheader=AUTHORIZATION: basic ${auth}`, 'push', '-q', '--force', `https://github.com/${repo}.git`, `HEAD:refs/heads/t/${id}`); }
  catch { throw new Error('mirror: push refused (token scope or repo name) - never reached the game'); }
  rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now(); let wr = null, bad = 0;
  while (Date.now() - t0 < 88 * 60e3) {   // waiting INSIDE a job for a result, not a session poll
    await sleep(20e3);
    // #7003: a rate-limit 403/429 or a 5xx on one poll is not a verdict; only 10 in a row (~3+ min) is
    try { wr = ((await api('GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`)) || {}).workflow_runs?.[0] || null; bad = 0; }
    catch (e) { if (++bad >= 10 || !/-> (403|429|5\d\d)$/.test(e.message)) throw e; await sleep(10e3 * bad); continue; }
    if (wr && wr.status === 'completed') break;
  }
  const file = async (f) => { const c = await api('GET', `/repos/${repo}/contents/${f}?ref=r/${id}`); return c ? Buffer.from(c.content, 'base64').toString('utf8') : null; };
  const out = await file('ci-out.txt'), status = await file('ci-status.txt');
  for (const b of [`t/${id}`, `r/${id}`]) await api('DELETE', `/repos/${repo}/git/refs/heads/${b}`).catch(() => {});
  if (out === null || status === null) {   // the mirror job died before the suite reported: a host fault, retried like one (hostload.mjs)
    console.log(`mirror run ${wr ? wr.conclusion || wr.status : 'never started'} without a result - never reached the game`); return 1;
  }
  process.stdout.write(out); return parseInt(status, 10) || 0;
}

/** The whole suite on the mirror (#6767 owed part): push f/<id>, the 16 shards of ci-full.yml run on hosted ubuntu, each leaves
 *  shard-<i>.json/.log on r/<id>.<i>; they are copied into a temp dir (what full.mjs reads as FULL_AGG_DIR) and every branch is deleted.
 *  A shard that left nothing is simply absent: mergeShards() turns that into pack-shard-<i>-missing, full.mjs decides what that means. */
export async function runFull(n = 16) {
  const repo = env('MIRROR_REPO'); await pruneStale(repo).catch(() => {});   // #7021
  const id = randomBytes(5).toString('hex'), dir = snapshot(ROOT, ['full']);
  const g = (...a) => gitExec(a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g('init', '-q'); g('config', 'user.name', 'CI'); g('config', 'user.email', 'ci@invalid.invalid'); stageAll(g); g('commit', '-q', '-m', id);
  await refreshAppToken();   // #9701: the App token, when configured
  const sha = g('rev-parse', 'HEAD'), auth = Buffer.from(`x-access-token:${env('MIRROR_TOKEN')}`).toString('base64');
  try { g('-c', `http.extraheader=AUTHORIZATION: basic ${auth}`, 'push', '-q', '--force', `https://github.com/${repo}.git`, `HEAD:refs/heads/f/${id}`); }
  catch { throw new Error('mirror: push refused (token scope or repo name) - never reached the game'); }
  rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now(); let wr = null;
  while (Date.now() - t0 < 100 * 60e3) {   // waiting INSIDE a job for the result, not a session poll
    await sleep(30e3);
    wr = ((await api('GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`)) || {}).workflow_runs?.[0] || null;
    if (wr && wr.status === 'completed') break;
  }
  return collectFull(repo, id, n);
}

/** Copy shard-<i>.json/.log from r/<id>.<i> into a temp dir and delete those branches and f/<id> (also used by hand: `mirror.mjs full --collect <id>`). */
export async function collectFull(repo, id, n = 16) {
  const out = mkdtempSync(join(tmpdir(), 'mirror-full-'));
  for (let i = 0; i < n; i++) {
    for (const f of [`shard-${i}.json`, `shard-${i}.log`, `tia-map-${i}.json`]) {   // #9754: the TIA map too (full.mjs mergeMaps reads tia-map-<i>.json from this dir)
      const c = await api('GET', `/repos/${repo}/contents/${f}?ref=r/${id}.${i}`).catch(() => null);
      if (c && c.content) writeFileSync(join(out, f), Buffer.from(c.content, 'base64'));
    }
    await api('DELETE', `/repos/${repo}/git/refs/heads/r/${id}.${i}`).catch(() => {});
  }
  await api('DELETE', `/repos/${repo}/git/refs/heads/f/${id}`).catch(() => {});
  return out;
}

/** A mirror pilot result counts only if it is the (lane, salt) asked for, with both hashes and a boolean verdict: a missing, foreign or garbled file is nothing (#7585). */
export function acceptPilotResult(txt, lane, salt) {
  let r; try { r = JSON.parse(txt); } catch { return null; }
  return r && r.lane === lane && r.salt === salt && typeof r.same === 'boolean' && /^[0-9a-f]{8,}$/.test(String(r.a)) && /^[0-9a-f]{8,}$/.test(String(r.b)) ? r : null;
}

/** One lane's salts FROM..FROM+n-1 (n <= 20), one hosted job each (ci-pilot.yml); returns the accepted result objects (absent salt = not run, the caller runs it locally). */
/** #7722: the salt offsets (0..n-1) of FROM..FROM+n-1 that `have` (a Set of salts already cached/shared for this lane) does not hold. */
export function missingIdx(from, n, have = new Set()) { const out = []; for (let i = 0; i < n; i++) if (!have.has(from + i)) out.push(i); return out; }

/** #8881/#8997: salts per hosted job, from the pilot caller's env; default 2 (proved equal to 1, docs/decisions/8997-pilot-pack.md); MCLITE_PILOT_PACK=1 restores one salt per job. */
export const pilotPack = (v = process.env.MCLITE_PILOT_PACK) => Math.max(1, Math.min(4, Math.floor(+v) || 2));

/** The .pilot-args line ci-pilot.yml reads: lane from n missing-offsets pack. */
export const pilotArgsLine = (lane, from, n, miss, pack = pilotPack()) => `${lane} ${from} ${n} ${miss.join(',')} ${pack}\n`;

/** #9725: a ci-full run (16 of the 20 mirror jobs) is in progress among these runs: a pilot dispatched now queues jobs ahead of the lander's ci. */
export const fullRunBusy = (runs) => (runs || []).some((r) => r.name === 'ci-full' && (r.status === 'in_progress' || r.status === 'queued'));
/** #9725: the lander first: while a ci-full run holds the mirror (16 of its 20 jobs), a pilot outside the mirror's own ci / ci-full / ci-pilot
 *  (worker packs, the VM, the pilot farm) waits up to 45 min before it queues jobs ahead of the lander's ci. One GET a minute (free when unchanged: 304).
 *  #9768: this used to be inline in runPilot, with its `let runs` swallowed by a // comment on the same line: a ReferenceError on every pilot for 2 h.
 *  Exported and called by pilotgatecheck with stubs, so that cannot pass a check again. Returns the minutes waited. */
export async function waitForFullRun(repo, { lane = '', workflow = process.env.GITHUB_WORKFLOW || '', get = (p) => api('GET', p), nap = sleep, maxMs = (+process.env.MCLITE_PILOT_WAIT_MIN || 45) * 60e3, clock = Date.now, log = (m) => console.error(m) } = {}) {
  if (/^ci(-full|-pilot)?$/.test(workflow)) return 0;
  const w0 = clock();
  while (clock() - w0 < maxMs) {
    let runs = [];
    try { runs = ((await get(`/repos/${repo}/actions/runs?status=in_progress&per_page=30`)) || {}).workflow_runs || []; } catch { break; }
    if (!fullRunBusy(runs)) break;
    if (clock() - w0 < 1000) log(`mirror pilot: lane ${lane} waits - the full run holds the mirror, the lander goes first`);
    else if ((clock() - w0) % 300e3 < 60e3) log(`mirror pilot: lane ${lane} still waiting (${Math.round((clock() - w0) / 60e3)} min)`);   // #10026: a silent wait looked like a hang
    await nap(60e3);
  }
  return Math.round((clock() - w0) / 60e3);
}
export async function runPilot(lane, from, n, have = new Set(), pack = pilotPack()) {
  if (!(n >= 1 && n <= 20)) throw new Error('mirror pilot: --seeds must be 1..20');
  const miss = missingIdx(from, n, have);
  console.error(`mirror pilot plan: lane ${lane} asked ${n} cached ${n - miss.length} dispatched ${miss.length}`);   // #7722: one line per pilot, the saving is measurable
  if (!miss.length) return [];
  const repo = env('MIRROR_REPO');
  const waited = await waitForFullRun(repo, { lane });   // #9725/#9768: the lander first - see waitForFullRun
  // #10026: pilot.mjs caps the wait (MCLITE_PILOT_WAIT_MIN); still held after it = no mirror this time, the caller runs the salts here instead of queuing ahead of the lander
  if (process.env.MCLITE_PILOT_WAIT_MIN && waited >= +process.env.MCLITE_PILOT_WAIT_MIN) { console.error(`mirror pilot: lane ${lane} - the full run still holds the mirror after ${waited} min, running here`); return []; }
  const id = randomBytes(5).toString('hex'), dir = snapshot(ROOT, ['pilot']);
  writeFileSync(join(dir, '.pilot-args'), pilotArgsLine(lane, from, n, miss, pack));
  const g = (...a) => gitExec(a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g('init', '-q'); g('config', 'user.name', 'CI'); g('config', 'user.email', 'ci@invalid.invalid'); stageAll(g); g('commit', '-q', '-m', id);
  await refreshAppToken();   // #9701: the App token, when configured
  const sha = g('rev-parse', 'HEAD'), auth = Buffer.from(`x-access-token:${env('MIRROR_TOKEN')}`).toString('base64');
  try { g('-c', `http.extraheader=AUTHORIZATION: basic ${auth}`, 'push', '-q', '--force', `https://github.com/${repo}.git`, `HEAD:refs/heads/p/${id}`); }
  catch { throw new Error('mirror: push refused (token scope or repo name) - never reached the game'); }
  rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now(); let wr = null;
  while (Date.now() - t0 < 45 * 60e3) {
    await sleep(20e3);
    wr = ((await api('GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`)) || {}).workflow_runs?.[0] || null;
    if (wr && wr.status === 'completed') break;
  }
  const out = [];
  for (const i of miss) {
    const br = `r/${id}.${i}`;
    const c = await api('GET', `/repos/${repo}/contents/pilot-${i}.json?ref=${br}`).catch(() => null);
    const r = c && c.content ? acceptPilotResult(Buffer.from(c.content, 'base64').toString('utf8').trim().split('\n').pop(), lane, from + i) : null;
    if (r) out.push(r);
    await api('DELETE', `/repos/${repo}/git/refs/heads/${br}`).catch(() => {});
  }
  await api('DELETE', `/repos/${repo}/git/refs/heads/p/${id}`).catch(() => {});
  console.error(`mirror pilot ${lane} ${from}+${n} (${miss.length} jobs): ${out.length} results in ${Math.round((Date.now() - t0) / 1e3)} s (run ${wr ? wr.conclusion || wr.status : 'never started'})`);
  return out;
}


/** #8992: workflows that must live on the mirror's DEFAULT branch (a workflow_dispatch workflow is only dispatchable from there; the t/<id> branches carry the test snapshots).
 *  The files hold no code: worker-pack.yml clones the private repo with a secret at run time. */
export const DEFAULT_BRANCH_WORKFLOWS = ['worker-pack.yml', 'brain-tick.yml', 'role-run.yml', 'land.yml', 'full-run.yml', 'farm-run.yml'];   // #10419 role-run, #10420 land: the hosted brain starts them by workflow_dispatch
/** Idempotently PUT each workflow onto the mirror's default branch through the contents API: one GET per file, a PUT only when the content differs.
 *  api(method, path, body) returns parsed JSON, or null for 404/409. Returns { put: [names], same: [names], branch }. */
export async function publishWorkflows({ repo, api: A = api, root = ROOT, names = DEFAULT_BRANCH_WORKFLOWS } = {}) {
  const info = await A('GET', `/repos/${repo}`), branch = (info && info.default_branch) || 'main', put = [], same = [];
  for (const n of names) {
    const want = readFileSync(join(root, 'tools', 'infra', 'mirror', n), 'utf8'), path = `/repos/${repo}/contents/.github/workflows/${n}`;
    const cur = await A('GET', `${path}?ref=${branch}`);
    if (cur && cur.content && Buffer.from(cur.content, 'base64').toString('utf8') === want) { same.push(n); continue; }
    const r = await A('PUT', path, { message: `workflow ${n}`, content: Buffer.from(want).toString('base64'), branch, ...(cur && cur.sha ? { sha: cur.sha } : {}) });
    if (!r) throw new Error(`mirror: publishing ${n} to ${branch} was refused (404/409)`);
    put.push(n);
  }
  return { put, same, branch };
}

// One-time setup once Dan has made the org and saved _secrets/mirror-repo.txt (org/name) + mirror-token.txt: the public repo with
// everything but Actions switched off, an empty `main` (the default branch, so t/<id> branches can always be deleted), and the
// STORE_URL secret (the private data store, read with the private token) sealed with the repo's public key (libsodium, fetched once).
async function setup() {
  const repo = env('MIRROR_REPO'), [org, name] = repo.split('/');
  if (!(await api('GET', `/repos/${repo}`))) await api('POST', `/orgs/${org}/repos`, { name, private: false, has_issues: false, has_wiki: false,
    has_projects: false, has_discussions: false, auto_init: false });
  if (!(await api('GET', `/repos/${repo}/git/refs/heads/main`))) {
    const dir = mkdtempSync(join(tmpdir(), 'mirror-main-')), g = (...a) => gitExec(a, { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q'); g('-c', 'user.name=CI', '-c', 'user.email=ci@invalid.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
    g('-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env('MIRROR_TOKEN')}`).toString('base64')}`, 'push', '-q', `https://github.com/${repo}.git`, 'HEAD:refs/heads/main');
    rmSync(dir, { recursive: true, force: true });
  }
  await api('PATCH', `/repos/${repo}`, { default_branch: 'main', description: '', homepage: '', has_issues: false, has_wiki: false, has_projects: false });
  const priv = readFileSync(join(ROOT, '..', '_secrets', 'github-token.txt'), 'utf8').trim();
  const store = `https://x-access-token:${priv}@github.com/${ACC}-dev/mclite-store.git`;
  let sodium; try { sodium = (await import('libsodium-wrappers')).default; } catch {
    const d = mkdtempSync(join(tmpdir(), 'sodium-')); execFileSync('npm', ['install', '-s', '--prefix', d, 'libsodium-wrappers@0.7.15'], { stdio: 'ignore', shell: true });
    sodium = (await import(new URL(`file:///${join(d, 'node_modules', 'libsodium-wrappers', 'dist', 'modules', 'libsodium-wrappers.js').replace(/\\/g, '/')}`).href)).default;
  }
  await sodium.ready;
  const key = await api('GET', `/repos/${repo}/actions/secrets/public-key`);
  const sealed = sodium.crypto_box_seal(sodium.from_string(store), sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL));
  await api('PUT', `/repos/${repo}/actions/secrets/STORE_URL`, { encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: key.key_id });
  // the private side: MIRROR_REPO variable + MIRROR_TOKEN secret for land.yml. TEST_REMOTE is NOT flipped here: the first `run` is
  // proved by hand (a commander) before the lander depends on it.
  // #6819: the infra token (fine-grained) may not reach this repo's secrets; the mirror token (classic, repo scope) can
  if (!process.env.GH_TOKEN) process.env.GH_TOKEN = env('MIRROR_TOKEN');
  const { gh } = await import('./gh.mjs');
  const pk = await gh('GET', '/repos/{repo}/actions/secrets/public-key');
  const tok = sodium.crypto_box_seal(sodium.from_string(env('MIRROR_TOKEN')), sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL));
  await gh('PUT', '/repos/{repo}/actions/secrets/MIRROR_TOKEN', { encrypted_value: sodium.to_base64(tok, sodium.base64_variants.ORIGINAL), key_id: pk.key_id });
  await gh('POST', '/repos/{repo}/actions/variables', { name: 'MIRROR_REPO', value: repo }).catch(() => gh('PATCH', '/repos/{repo}/actions/variables/MIRROR_REPO', { name: 'MIRROR_REPO', value: repo }));
  console.log(`mirror ready: ${repo} public, Actions only, STORE_URL set; private repo has MIRROR_REPO + MIRROR_TOKEN. Next: one 'run -- --fast --only testmirrorcheck' by hand, then TEST_REMOTE=mirror`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'setup') await setup();
    else if (cmd === 'publish-workflows') console.log(JSON.stringify(await publishWorkflows({ repo: env('MIRROR_REPO') })));
    else if (cmd === 'run') process.exitCode = await run(rest[0] === '--' ? rest.slice(1) : rest);
    else if (cmd === 'full') console.log(rest[0] === '--collect' ? await collectFull(env('MIRROR_REPO'), rest[1]) : await runFull());   // prints the dir of shard results (what full.mjs reads as FULL_AGG_DIR)
    else if (cmd === 'pilot') {
      const a = (k, d) => { const i = rest.indexOf(k); return i < 0 ? d : rest[i + 1]; };
      for (const r of await runPilot(a('--lane', 'zombie'), +a('--from', 0), +a('--seeds', 20))) console.log(JSON.stringify(r));
    } else if (cmd === 'visibility' && /^(private|public)$/.test(rest[0] || '')) {
      if (rest[0] === 'private') console.log(`pruned: ${(await pruneStale(env('MIRROR_REPO'), { all: true }).catch(() => [])).join(', ') || 'nothing'}`);   // #7021: everything but main
      await api('PATCH', `/repos/${env('MIRROR_REPO')}`, { private: rest[0] === 'private' }); console.log(`mirror is now ${rest[0]}`);
      // a private mirror has no free minutes: the lander goes back to testing on the PC in the same step (never left to Dan)
      const { gh } = await import('./gh.mjs');
      await gh('PATCH', '/repos/{repo}/actions/variables/TEST_REMOTE', { name: 'TEST_REMOTE', value: rest[0] === 'private' ? 'off' : 'mirror' });
      console.log(`lander TEST_REMOTE = ${rest[0] === 'private' ? 'off (tests on the PC)' : 'mirror'}`);
    } else { console.log('usage: mirror.mjs setup | run -- <suite args> | full | pilot --lane L --from A --seeds N | visibility private|public'); process.exitCode = 2; }
  } catch (e) { console.log(String(e.message || e)); process.exitCode = 1; }
}
