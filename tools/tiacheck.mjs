// tools/tiacheck.mjs - #7765. Test impact analysis: selection from a diff, deterministic seeded sample, time cap, replay recall.
// Anti-vacuity: each break mutates tools/infra/tia.mjs and the same assertions must then fail.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SRC = readFileSync(new URL('./infra/tia.mjs', import.meta.url), 'utf8');
const dir = fileURLToPath(new URL('./infra/', import.meta.url));
const load = async (src, n) => { const f = `${dir}.tia-mut-${n}.mjs`; writeFileSync(f, src); try { return await import(pathToFileURL(f).href + '?' + Date.now()); } finally { unlinkSync(f); } };

const ids = (n) => Array.from({ length: n }, (_, i) => 'filler' + i);
const map = { stages: { a: { kind: 'check', files: ['src/01.js', 'tools/a.mjs'], ms: 25000 }, b: { kind: 'check', files: ['src/'], ms: 25000 }, c: { kind: 'check', files: ['tools/c.mjs'], ms: 1000 },
  br: { kind: 'browser', files: ['src/01.js'], ms: 1000 }, k: { kind: 'check', files: ['src/01.js'], ms: 1000 },
  'lockstep-pilot': { kind: 'check', files: ['src/01.js'], ms: 6000 }, lockstep_pilot2: { kind: 'check', files: ['src/'], ms: 6000 }, lockstepsuitecheck: { kind: 'check', files: ['src/01.js'], ms: 1000 } } };
for (const i of ids(400)) map.stages[i] = { kind: 'check', files: ['tools/' + i + '.mjs'], ms: 50000 };

/** every assertion; returns the list of failures */
async function verdict(T) {
  const bad = [], ok = (c, m) => { if (!c) bad.push(m); };
  const pick = (o) => T.select({ map, branch: 'work/x', core: ['k'], ...o });
  const r = pick({ changed: ['src/01.js'] }), got = r.picks.map((p) => p.id);
  ok(got.includes('a') && got.includes('b'), 'a diff touching a mapped file selects the stages mapping it (file and directory prefix)');
  ok(!got.includes('c') || r.picks.find((p) => p.id === 'c').why.startsWith('sample'), 'an unrelated stage is not impacted');
  ok(!got.includes('br'), 'browser stages are never selected');
  ok(!got.includes('k'), 'a core stage is not selected twice');
  ok(got.length > 0 && pick({ changed: ['tools/c.mjs'] }).picks.some((p) => p.id === 'c'), 'a diff touching a mapped file selects something');
  const m2 = JSON.parse(JSON.stringify(map)); delete m2.stages.a;
  ok(!T.select({ map: m2, changed: ['tools/a.mjs'], branch: 'w', core: [] }).picks.some((p) => p.id === 'a'), 'sanity: a stage dropped from the map cannot be selected');
  ok(T.select({ map, changed: ['tools/a.mjs'], branch: 'w', core: [] }).picks.some((p) => p.id === 'a'), 'a stage present in the map IS selected (dropping it above loses it)');
  ok(!got.includes('lockstep-pilot') && !r.picks.some((p) => p.id === 'lockstep-pilot') && r.pilots.includes('lockstep-pilot'), 'a pilot stage (lockstep-<mob>) is never selected: cold it is a 30 min real-server run in the lander');
  ok(!got.includes('lockstep_pilot2') && got.includes('lockstepsuitecheck'), 'lockstep_<mob> is a pilot too; an infra check named lockstep<x>check IS selected');
  const s1 = pick({ changed: [] }).picks.map((p) => p.id).join(), s2 = pick({ changed: [] }).picks.map((p) => p.id).join();
  ok(s1 === s2, 'the sample is deterministic for one branch');
  const other = T.select({ map, changed: [], branch: 'work/other', core: ['k'] }).picks.map((p) => p.id).join();
  ok(s1 !== other, 'a different branch samples different stages');
  const n = pick({ changed: [] }).picks.length; ok(n >= 5 && n <= 40, `the sample is about 5% of ${ids(400).length} (got ${n})`);
  const capped = T.select({ map, changed: ['src/01.js'], branch: 'w', core: [], sampleRate: 1, capMin: 1 });
  ok(capped.estSec <= 60 && capped.dropped.length > 0, 'the time cap cuts the selection (est ' + capped.estSec + 's)');
  ok(capped.picks.some((p) => p.id === 'a') && capped.picks.some((p) => p.id === 'b'), 'the cap cuts the sample before the impacted stages');
  const nw = T.select({ map, changed: [], branch: 'w', core: [], newStages: ['brandnew'] });
  ok(nw.picks.some((p) => p.id === 'brandnew'), 'a stage added by the diff is selected');
  // replay: red at sha2 for stage c; PR 11 touched tools/c.mjs, PR 12 nothing related
  const recs = [{ sha: 's1', failed: [] }, { sha: 's2', failed: ['c', 'zzz'] }];
  const rp = T.replay({ records: recs, map, core: [], commitsBetween: () => [{ pr: 12, files: ['docs/x.md'] }, { pr: 11, files: ['tools/c.mjs'] }], sampleRate: 0 });
  ok(rp.total === 2 && rp.caught === 1 && rp.rows.find((x) => x.stage === 'c').by === 11, 'replay attributes the red to the PR whose diff selects it, and counts an unmapped red as missed');
  return bad;
}

let assertions = 0, caught = 0, fails = 0;
const base = await verdict(await load(SRC, 0));
assertions += 17;
if (base.length) { fails++; console.log('FAILED:\n  ' + base.join('\n  ')); }

const BREAKS = [
  ['file match never hits', (s) => s.replace("changed.includes(f)", "false")],
  ['directory prefix ignored', (s) => s.replace("changed.some((c) => c.startsWith(f))", "false")],
  ['browser stages selected', (s) => s.replace("st.kind !== 'check' ||", "")],
  ['core stage re-selected', (s) => s.replace("skip.has(id) ||", "")],
  ['sample ignores the seed', (s) => s.replace("createHash('sha1').update(seed + '\\0' + id)", "createHash('sha1').update(id)")],
  ['sample not deterministic', (s) => s.replace("parseInt(createHash", "Math.random() * 0 + Math.random() * 0 + 0 * parseInt(createHash").replace("/ 2 ** 32;", "/ 2 ** 32 + Math.random();")],
  ['time cap ignored', (s) => s.replace("t + p.sec > capSec && kept.length", "false")],
  ['cap cuts impacted first', (s) => s.replace("rank(a) - rank(b) ||", "rank(b) - rank(a) ||")],
  ['new stages not selected', (s) => s.replace("for (const id of newStages)", "for (const id of [])")],
  ['pilot stages selected', (s) => s.replace("if (/^lockstep[-_]/.test(id))", "if (false)")],
  ['replay counts every red caught', (s) => s.replace("caught: by != null", "caught: true")],
];
for (const [name, f] of BREAKS) {
  let bad; try { bad = await verdict(await load(f(SRC), caught + 1)); } catch (e) { bad = ['threw: ' + e.message]; }
  if (SRC === f(SRC)) { console.log(`break "${name}" changed nothing`); fails++; continue; }
  if (bad.length) caught++; else { console.log(`NOT CAUGHT: ${name}`); fails++; }
}
// #7765: the mirror's shards each write tia-map-<i>.json; mergeMaps must union them (a lost shard map = a stage the lander never selects)
{
  const { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const FS = readFileSync(new URL('./infra/fullshard.mjs', import.meta.url), 'utf8');
  const mapVerdict = async (src, n) => {
    const f = `${dir}.fs-mut-${n}.mjs`; writeFileSync(f, src); const d = mkdtempSync(join(tmpdir(), 'tiam-'));
    try {
      const M = await import(pathToFileURL(f).href + '?' + Date.now());
      writeFileSync(join(d, 'tia-map-0.json'), JSON.stringify({ at: 't', head: 'h', stages: { x: { files: ['a'] } } }));
      writeFileSync(join(d, 'tia-map-3.json'), JSON.stringify({ stages: { y: { files: ['b'] } } }));
      writeFileSync(join(d, 'tia-map-5.json'), '{torn');
      const m = M.mergeMaps(d); return !!(m.stages.x && m.stages.y && Object.keys(m.stages).length === 2);
    } catch { return false; } finally { unlinkSync(f); rmSync(d, { recursive: true, force: true }); }
  };
  assertions += 1;
  if (!await mapVerdict(FS, 'base')) { fails++; console.log('FAILED: mergeMaps does not union the shard maps'); }
  for (const [name, f] of [['shard maps: only the first kept', (s) => s.replace("Object.assign(map.stages, m.stages || {})", "if (!Object.keys(map.stages).length) Object.assign(map.stages, m.stages || {})")], ['shard maps: a torn file aborts the merge', (s) => s.replace("} catch { /* a torn map file", "} catch (e) { throw e; /* a torn map file")]]) {
    if (f(FS) === FS) { console.log(`break "${name}" changed nothing`); fails++; continue; }
    if (!await mapVerdict(f(FS), 'b' + caught)) caught++; else { console.log(`NOT CAUGHT: ${name}`); fails++; }
  }
}
// #9754: the shard maps must travel back from the mirror: ci-full.yml's report step ships tia-map-<i>.json and collectFull fetches it (until 22 Oct neither did,
// so the map was never built on the mirror path and the lander ran core only)
{ const Y = readFileSync(new URL('./infra/mirror/ci-full.yml', import.meta.url), 'utf8'), MJ = readFileSync(new URL('./infra/mirror.mjs', import.meta.url), 'utf8');
  for (const [name, s, re] of [['ci-full.yml ships tia-map-<i>.json with the shard result', Y, /cp "\$GITHUB_WORKSPACE\/shard-out\/tia-map-\$i\.json" \./],
    ['collectFull fetches tia-map-<i>.json', MJ, /for \(const f of \[`shard-\$\{i\}\.json`, `shard-\$\{i\}\.log`, `tia-map-\$\{i\}\.json`\]\)/]]) {
    assertions++; if (!re.test(s)) { fails++; console.log('FAILED: ' + name); }
    if (!re.test(s.replace(re, 'X'))) caught++; else { console.log(`NOT CAUGHT: removing "${name}"`); fails++; } } }
// #9776: stages already red on master (the newest tia-history record) are never selected - the first TIA batch bounced on soundcheck, red on master
{ const T = await import('./infra/tia.mjs'), TS = readFileSync(new URL('./infra/tia.mjs', import.meta.url), 'utf8');
  const cases = (f) => { const bad = []; const t = (n, c) => { let v = false; try { v = !!c(); } catch { v = false; } if (!v) bad.push(n); };
    t('the newest record wins', () => JSON.stringify(f('{"failed":["a"]}\n{"failed":["b","c"]}\n')) === '["b","c"]');
    t('a torn last line falls back to the one before', () => JSON.stringify(f('{"failed":["a"]}\n{torn')) === '["a"]');
    t('no history = nothing red', () => f('').length === 0 && f(null).length === 0);
    return bad; };
  const b0 = cases(T.redOnMaster); assertions++; if (b0.length) { fails++; console.log('FAILED: redOnMaster ' + b0.join('; ')); }
  if (cases(() => []).length) caught++; else { console.log('NOT CAUGHT: redOnMaster that knows nothing'); fails++; }
  const W = /redOnMaster\(readFileSync\(join\(dirname\(mapPath\(\)\), 'tia-history\.jsonl'\), 'utf8'\)\)[\s\S]{0,200}for \(const id of red\) if \(!quarantine\[id\]\) quarantine\[id\] =/;
  assertions++; if (!W.test(TS)) { fails++; console.log('FAILED: tia select does not skip the stages red on master'); }
  if (!W.test(TS.replace('for (const id of red) if (!quarantine[id]) quarantine[id] =', 'for (const id of []) if (!quarantine[id]) quarantine[id] ='))) caught++; else { console.log('NOT CAUGHT: select without the red skip'); fails++; } }
console.log(`${assertions} assertions, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
