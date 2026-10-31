// packstatuscheck (#10122): `go.mjs status` and the brain's ladder / fill-idle rules count the workers that run as worker-pack runs on the mirror
// (WORKER_RUNNER=mirror), not only brain.yml runs. 24 Oct: status said "fill 0 running, last worker run 83 min" while a pack of 4 had been working 22 min and 54 PRs landed.
// RUNS packSummary / packByAccount / mirrorCreds / mirrorPackSummary on fixtures, then checks the wiring in go.mjs and brain.mjs. Prints '<n> breaks caught'.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), rd = (f) => readFileSync(join(TOOLS, f), 'utf8');
const SRC = { wp: rd('infra/workerpack.mjs'), go: rd('go.mjs'), brain: rd('brain/brain.mjs') };
let ASSERTS = 0;
async function run(mut) {   // mut = [file, from, to]
  let fails = 0; const ok = (c, msg) => { ASSERTS++; if (!c) { fails++; if (!mut) console.log('FAIL: ' + msg); } };
  const src = { ...SRC };
  if (mut) { if (!src[mut[0]].includes(mut[1])) throw new Error('no-op break: ' + mut[1]); src[mut[0]] = src[mut[0]].replace(mut[1], mut[2]); }
  const d = mkdtempSync(join(tmpdir(), 'psc-')); writeFileSync(join(d, 'workerpack.mjs'), src.wp);
  const m = await import(pathToFileURL(join(d, 'workerpack.mjs')).href + '?' + Math.random()); rmSync(d, { recursive: true, force: true });
  const run1 = (title, status, at) => ({ display_title: title, status, created_at: at });
  const runs = [run1('worker-pack p0 x4', 'in_progress', '2026-10-24T21:17:57Z'), run1('worker-pack p1 x1', 'queued', '2026-10-24T21:22:59Z'), run1('worker-pack p0 x3', 'completed', '2026-10-24T21:40:07Z'), run1('ci', 'in_progress', '2026-10-24T21:50:00Z'), run1('worker-pack p1 x2', 'in_progress', '2026-10-24T21:00:00Z')];
  const s = m.packSummary(runs);
  ok(s.running.p0 === 4 && s.running.p1 === 2 && m.packWorkers(s.running) === 6, 'in-progress pack workers are summed per pool tag');
  ok(s.queued.p1 === 1 && m.packWorkers(s.queued) === 1 && !s.queued.p0, 'queued pack workers are counted apart from running ones; completed runs count for neither');
  ok(s.newestAt === Date.parse('2026-10-24T21:40:07Z'), 'newestAt is the newest PACK run (a ci run does not count)');
  ok(m.packSummary([]).newestAt === 0 && m.packWorkers(m.packSummary(null).running) === 0, 'no runs = nothing running, newestAt 0');
  ok(JSON.stringify(m.packByAccount({ p0: 4, p1: 2, p9: 5 }, [{ name: 'max' }, { name: 'pro' }])) === '{"max":4,"pro":2}', 'pool tags map to accounts by index in roles.json; an unknown tag is dropped');
  ok(m.mirrorCreds({ MIRROR_REPO: 'o/r', MIRROR_TOKEN: 't' }).repo === 'o/r' && m.mirrorCreds({}) === null, 'credentials come from the environment, and are null without them');
  const files = { '/s/mirror-repo.txt': 'o/lat\n', '/s/mirror-token.txt': 'tok\n' };
  ok(m.mirrorCreds({}, '/s', (f) => { if (!(f in files)) throw new Error('nf'); return files[f]; }).token === 'tok' && m.mirrorCreds({}, '/s', () => { throw new Error('nf'); }) === null, 'the PC _secrets files are the fallback; a missing file is null, not a throw');
  const okf = async () => ({ ok: true, json: async () => ({ workflow_runs: runs }) });
  ok((await m.mirrorPackSummary({ repo: 'o/r', token: 't', f: okf })).running.p0 === 4, 'mirrorPackSummary reads the runs');
  ok(await m.mirrorPackSummary({ repo: 'o/r', token: 't', f: async () => ({ ok: false, json: async () => ({ workflow_runs: runs }) }) }) === null && await m.mirrorPackSummary({ repo: 'o/r', token: 't', f: async () => { throw new Error('net'); } }) === null, 'a failed read is null (unreadable), never an empty fill');
  // wiring
  ok(/const run = wr\.filter\(\(r\) => r\.status === 'in_progress'\)\.length \+ pw/.test(src.go) && /packAgo/.test(src.go) && /mirror packs UNREADABLE/.test(src.go), 'status: the headline counts pack workers, uses the pack age for "last worker run", and says UNREADABLE instead of 0');
  ok(/packByAccount\(ps2\.running, R\.accounts\)/.test(src.go), 'status: the per-account running counts include the mirror packs');
  ok(/packs\.active > 0 \? now : 0/.test(src.brain) && /Math\.max\(packs\.newestAt/.test(src.brain), 'brain ladder: a running pack is a run, and the newest pack start is the last run');
  ok(/\(await packActivity\(\)\)\.active/.test(src.brain), 'brain fill-idle rule counts the pack workers');
  return fails;
}
const base = await run(null);
const BREAKS = [
  ['wp', "r.status === 'in_progress' ? 'running'", "r.status === 'xx' ? 'running'"],
  ['wp', "r.status === 'queued' ? 'queued'", "r.status === 'in_progress' ? 'queued'"],
  ['wp', "out.newestAt = Math.max(out.newestAt, Date.parse(r.created_at || '') || 0);", ""],
  ['wp', "if (!m) continue;", ""],
  ['wp', "(accounts || [])[Number(tag.slice(1))]", "(accounts || [])[0]"],
  ['wp', "return r.ok ? packSummary", "return true ? packSummary"],
  ['wp', "} catch { return null; }\n}", "} catch { return packSummary([]); }\n}"],
  ['wp', "return repo && token ? { repo, token } : null;", "return { repo, token };"],
  ['go', ".length + pw, want", ".length, want"],
  ['go', "mirror packs UNREADABLE", "mirror packs none"],
  ['go', "packByAccount(ps2.running, R.accounts)", "{}"],
  ['brain', "packs.active > 0 ? now : 0", "false ? now : 0"],
  ['brain', "(await packActivity()).active + ", ""],
];
let caught = 0; for (const b of BREAKS) { let f; try { f = await run(b); } catch (e) { if (/^no-op break/.test(e.message)) { console.log(e.message); f = 0; } else f = 1; } if (f > 0) { caught++; console.log(' ✓ caught: ' + b[1].slice(0, 60)); } else console.log(' NOT CAUGHT: ' + b[1]); }
console.log(`packstatuscheck: ${ASSERTS} assertions, ${base} failures, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(base || caught < BREAKS.length ? 1 : 0);
