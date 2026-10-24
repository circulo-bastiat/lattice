// tools/workerpublishcheck.mjs - #8992: RUNS publishWorkflows and dispatchPacks against a fake GitHub, and silent.sh in bash. 20 Oct: WORKER_RUNNER=mirror could never start a
// worker: worker-pack.yml was not on the mirror's default branch (`main`; only empty init + t/<id> test branches) and the dispatch named ref `master`. The fill then fell back to
// the VM without a word. Anti-vacuity: each rule is broken in a copy of the source and this check must fail.
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { mirror: rd('./infra/mirror.mjs'), pack: rd('./infra/workerpack.mjs'), brain: rd('./brain/brain.mjs'), silent: rd('./infra/mirror/silent.sh'), yml: rd('./infra/mirror/worker-pack.yml') };
const ROOT = fileURLToPath(new URL('..', import.meta.url)), ROOTURL = pathToFileURL(ROOT).href.replace(/\/?$/, '/');
const tmp = mkdtempSync(join(tmpdir(), 'wpc-'));
const load = async (src, name) => { const f = join(tmp, name + Math.random().toString(36).slice(2) + '.mjs'); (await import('node:fs')).writeFileSync(f, src); return import(pathToFileURL(f).href); };
// the mirror module imports ./gitenv.mjs: rewrite to absolute so it loads from tmp
const abs = (src) => src.replace(/from '\.\/(gitenv|gh|fullshard)\.mjs'/g, (m, n) => `from '${ROOTURL}tools/infra/${n}.mjs'`).replace(/import\('\.\/gh\.mjs'\)/g, `import('${ROOTURL}tools/infra/gh.mjs')`);
function fakeApi(state) {
  const calls = [];
  const api = async (m, p, body) => {
    calls.push([m, p, body]);
    if (m === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(p)) return { default_branch: state.branch };
    const mm = /\/contents\/\.github\/workflows\/([^?]+)/.exec(p);
    if (m === 'GET' && mm) { const f = state.files[mm[1]]; return f ? { content: Buffer.from(f.text).toString('base64'), sha: f.sha } : null; }
    if (m === 'PUT' && mm) return state.refuse ? null : { ok: true };
    throw new Error('unexpected ' + m + ' ' + p);
  };
  return { api, calls };
}
const fakeFetch = (o) => { const calls = []; const f = async (url, init = {}) => { calls.push([url, init]);
  if (/\/dispatches$/.test(url)) return { ok: o.dispatch < 300, status: o.dispatch, json: async () => ({}) };
  return o.repoInfo === null ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ default_branch: o.repoInfo }) }; }; return { f, calls }; };
async function verdict(S) {
  const bad = []; let M, P;
  try { M = await load(abs(S.mirror), 'mirror'); P = await load(S.pack, 'pack'); } catch (e) { return [`modules do not load: ${e.message}`]; }
  const want = readFileSync(new URL('./infra/mirror/worker-pack.yml', import.meta.url), 'utf8');
  if (!M.DEFAULT_BRANCH_WORKFLOWS || !M.DEFAULT_BRANCH_WORKFLOWS.includes('worker-pack.yml')) bad.push('worker-pack.yml is not in DEFAULT_BRANCH_WORKFLOWS');
  const puts = (c) => c.filter(([m]) => m === 'PUT');
  { const f = fakeApi({ branch: 'main', files: {} }); const r = await M.publishWorkflows({ repo: 'o/r', api: f.api, root: ROOT });
    const p = puts(f.calls); if (p.length !== 1 || !r.put.includes('worker-pack.yml')) bad.push('an absent workflow is not PUT exactly once');
    else { if (Buffer.from(p[0][2].content, 'base64').toString('utf8') !== want) bad.push('the PUT content is not tools/infra/mirror/worker-pack.yml'); if (p[0][2].branch !== 'main') bad.push('the PUT does not target the default branch'); if ('sha' in p[0][2]) bad.push('a new file is PUT with a sha'); } }
  { const f = fakeApi({ branch: 'main', files: { 'worker-pack.yml': { text: want, sha: 'S0' } } }); const r = await M.publishWorkflows({ repo: 'o/r', api: f.api, root: ROOT }); if (puts(f.calls).length || !r.same.includes('worker-pack.yml')) bad.push('an up-to-date workflow is PUT again'); }
  { const f = fakeApi({ branch: 'main', files: { 'worker-pack.yml': { text: want + '# old\n', sha: 'S1' } } }); await M.publishWorkflows({ repo: 'o/r', api: f.api, root: ROOT }); const p = puts(f.calls); if (p.length !== 1 || p[0][2].sha !== 'S1') bad.push('a changed workflow is not updated with the current blob sha'); }
  { const f = fakeApi({ branch: 'trunk', files: {} }); await M.publishWorkflows({ repo: 'o/r', api: f.api, root: ROOT }); const p = puts(f.calls); if (!p.length || p[0][2].branch !== 'trunk' || !f.calls.some(([m, u]) => m === 'GET' && u.endsWith('?ref=trunk'))) bad.push('the default branch is not read from the repo (hard-coded name)'); }
  { const f = fakeApi({ branch: 'main', files: {}, refuse: true }); let threw = false; try { await M.publishWorkflows({ repo: 'o/r', api: f.api, root: ROOT }); } catch { threw = true; } if (!threw) bad.push('a refused PUT is swallowed'); }
  // dispatch
  { const f = fakeFetch({ repoInfo: 'trunk', dispatch: 204 }); await P.dispatchPacks({ repo: 'o/r', token: 't', bodies: [P.dispatchBody({ count: 2 })], f: f.f }); const d = f.calls.find(([u]) => /dispatches$/.test(u)); if (!d || JSON.parse(d[1].body).ref !== 'trunk') bad.push("dispatch ref is not the mirror's default branch"); }
  { const f = fakeFetch({ repoInfo: null, dispatch: 204 }); await P.dispatchPacks({ repo: 'o/r', token: 't', bodies: [P.dispatchBody({ count: 1 })], f: f.f }); const d = f.calls.find(([u]) => /dispatches$/.test(u)); if (JSON.parse(d[1].body).ref !== 'main') bad.push('dispatch does not fall back to main'); if (JSON.stringify(f.calls).includes('master')) bad.push('the literal master reaches the mirror'); }
  { const f = fakeFetch({ repoInfo: 'main', dispatch: 404 }); let msg = ''; try { await P.dispatchPacks({ repo: 'o/r', token: 't', bodies: [P.dispatchBody({ count: 1 })], f: f.f }); } catch (e) { msg = e.message; } if (!/not published/.test(msg) || !/worker-pack\.yml/.test(msg)) bad.push('a 404 dispatch does not name the unpublished workflow'); }
  { const f = fakeFetch({ repoInfo: 'main', dispatch: 500 }); let threw = false; try { await P.dispatchPacks({ repo: 'o/r', token: 't', bodies: [P.dispatchBody({ count: 1 })], f: f.f }); } catch { threw = true; } if (!threw) bad.push('a failed dispatch is swallowed'); }
  // the public log: silent.sh really keeps output out of stdout and keeps the exit code
  { const d = mkdtempSync(join(tmpdir(), 'sil-')), sh = join(d, 'silent.sh'); (await import('node:fs')).writeFileSync(sh, S.silent);
    const r = spawnSync('bash', ['-c', `. "${sh}"; silent leak sh -c 'echo ISSUE-TEXT-9; echo ACCOUNT-9 >&2; exit 3'; echo "rc=$?"`], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: d } });
    const logged = existsSync(join(d, 'out.log')) ? readFileSync(join(d, 'out.log'), 'utf8') : '';
    if (/ISSUE-TEXT-9|ACCOUNT-9/.test(r.stdout + r.stderr)) bad.push('silent.sh lets command output reach the public log');
    if (!/ISSUE-TEXT-9/.test(logged)) bad.push('silent.sh does not keep the output in out.log');
    if (!/rc=3/.test(r.stdout)) bad.push('silent.sh loses the exit code'); rmSync(d, { recursive: true, force: true }); }
  // the workflow file itself: nothing that prints or uploads
  for (const [re, why] of [[/upload-artifact/, 'uploads an artifact'], [/set -x|bash -x/, 'traces commands'], [/cat [^\n]*out\.log/, 'prints out.log'], [/echo[^\n]*\$\{\{ *secrets/, 'echoes a secret']]) if (re.test(S.yml)) bad.push(`worker-pack.yml ${why} into a public log`);
  // wiring: the brain publishes before it dispatches
  const a = S.brain.indexOf('publishWorkflows('), b = S.brain.indexOf('dispatchPacks({ repo');
  if (a < 0 || b < 0 || a > b) bad.push('brain.mjs does not publish the workflow before dispatching packs');
  return bad;
}
const sub = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error('break target missing: ' + a); return { ...S, [k]: S[k].replace(a, b) }; };
const BREAKS = [
  ['not in the list', sub('mirror', "['worker-pack.yml']", '[]')],
  ['always PUT', sub('mirror', "=== want) { same.push(n); continue; }", '=== "x") { same.push(n); continue; }')],
  ['never PUT', sub('mirror', "const r = await A('PUT'", "const r = await Promise.resolve({}); void (async () => A('PUT'")],
  ['hard-coded main', sub('mirror', "(info && info.default_branch) || 'main'", "'main'")],
  ['refused PUT swallowed', sub('mirror', 'if (!r) throw new Error(`mirror: publishing', 'if (false) throw new Error(`mirror: publishing')],
  ['no sha on update', sub('mirror', '...(cur && cur.sha ? { sha: cur.sha } : {})', '')],
  ['dispatch ref master', sub('pack', "{ ...b, ref }", "{ ...b, ref: 'master' }")],
  ['dispatch ref not read', sub('pack', "ref = (await r.json()).default_branch || 'main'", "ref = 'main'")],
  ['404 not named', sub('pack', "if (r.status === 404) throw new Error(`worker-pack.yml is not published on", "if (r.status === 404) throw new Error(`oops on")],
  ['500 swallowed', sub('pack', "if (!r.ok) throw new Error(`worker-pack dispatch -> ${r.status}`);", '')],
  ['silent prints', sub('silent', '>> "${RUNNER_TEMP:-/tmp}/out.log" 2>&1', '')],
  ['silent loses rc', sub('silent', 'return $rc', 'return 0')],
  ['yml uploads', sub('yml', 'steps:', 'steps:\n      - uses: actions/upload-artifact@v4')],
  ['brain dispatches before publishing', sub('brain', 'await (await import(\'../infra/mirror.mjs\')).publishWorkflows({ repo: process.env.MIRROR_REPO }); const cnt = await dispatchPacks', 'const cnt = await dispatchPacks')],
];
const real = await verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { let m; try { m = mk(SRC); } catch (e) { console.log(' BAD BREAK:', n, e.message); continue; } if ((await verdict(m)).length) caught++; else console.log(' NOT CAUGHT:', n); }
rmSync(tmp, { recursive: true, force: true });
for (const x of real) console.log(' FAIL:', x);
console.log(`workerpublishcheck: ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
