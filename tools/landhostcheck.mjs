// landhostcheck (#10420): the lander with no machine of Dan's. TEST_RUNNER=lattice: the private land.yml runs nothing, the hosted tick starts the mirror's land.yml
// when PRs wait and none runs (one at a time, 4-min cooldown), and land.mjs dispatches no private-repo workflow from the mirror. Then each rule is broken to prove the check fails.
import fs from 'node:fs';
const read = (f) => fs.readFileSync(f, 'utf8');
const SRC = { m: await import('./infra/landhost.mjs'), land: read('tools/infra/land.mjs'), priv: read('.github/workflows/land.yml'), mirror: read('tools/infra/mirror/land.yml'), brain: read('tools/brain/brain.mjs'), tick: read('tools/infra/mirror/brain-tick.yml') };
const now = 1e12;
async function verdict(S) {
  const bad = [], M = S.m;
  if (!M.latticeLander('lattice') || M.latticeLander('pc') || M.latticeLander('mirror') || M.latticeLander(undefined)) bad.push('latticeLander is not exactly TEST_RUNNER=lattice');
  const D = (o) => M.landTickDecision({ now, ...o });
  if (D({ prs: [], active: 0 }).do !== 'none') bad.push('dispatches with nothing waiting');
  if (D({ prs: [7, 9], active: 1 }).do !== 'none') bad.push('dispatches while a run is active (two landers at once)');
  { const x = D({ prs: [7, 9], active: 0 }); if (x.do !== 'dispatch' || x.pr !== 7) bad.push('does not dispatch the OLDEST waiting PR when idle'); }
  if (D({ prs: [7], active: 0, lastDispatchAt: now - 60e3 }).do !== 'none') bad.push('re-dispatches inside the cooldown');
  if (D({ prs: [7], active: 0, lastDispatchAt: now - 10 * 60e3 }).do !== 'dispatch') bad.push('never dispatches again after the cooldown');
  { const calls = []; const f = async (u, i = {}) => { calls.push([u, i.method || 'GET', i.body]); return { ok: true, status: 204, json: async () => ({ default_branch: 'trunk', workflow_runs: [{}, {}] }) }; };
    const n = await M.activeLandRuns({ repo: 'o/l', token: 't', f }); if (n !== 4) bad.push('activeLandRuns does not add queued and in_progress');
    await M.dispatchLand({ repo: 'o/l', token: 't', pr: 12, f }); const d = calls.find(([u, m]) => m === 'POST'); if (!d || !/\/o\/l\/actions\/workflows\/land\.yml\/dispatches$/.test(d[0]) || JSON.parse(d[2]).ref !== 'trunk' || JSON.parse(d[2]).inputs.pr !== '12') bad.push('dispatchLand does not POST land.yml on the default branch with the PR'); }
  { let m = ''; try { await M.dispatchLand({ repo: 'o/l', token: 't', pr: 1, f: async (u, i = {}) => ({ ok: false, status: i.method === 'POST' ? 404 : 200, json: async () => ({}) }) }); } catch (e) { m = e.message; } if (!/not published/.test(m)) bad.push('a 404 does not say land.yml is unpublished'); }
  if (!/vars\.TEST_RUNNER != 'lattice'/.test(S.priv.split('land-mirror:')[0])) bad.push("the private land-hosted job still runs when TEST_RUNNER=lattice (no hosted minutes there)");
  if (!/MCLITE_LANDER: lattice/.test(S.mirror)) bad.push('the mirror land.yml does not set MCLITE_LANDER');
  if (!/if \(left && !LATTICE\)/.test(S.land)) bad.push('land.mjs re-dispatches the private land.yml from the mirror');
  if (!/HOSTED && !LATTICE\) await gh\('POST', '\/repos\/\{repo\}\/actions\/workflows\/localcopy/.test(S.land)) bad.push('land.mjs dispatches localcopy.yml (a PC workflow) from the mirror');
  if (!/cmd === 'land'/.test(S.brain) || !/latticeLander\(tr\)/.test(S.brain)) bad.push('brain.mjs has no land tick');
  if (!/prs = orderQueue\(/.test(S.brain)) bad.push('the hosted tick does not order the queue with orderQueue (priority first, ghosts out)');
  if (!/brain\.mjs land/.test(S.tick)) bad.push('the hosted tick does not run brain.mjs land');
  return bad;
}
const brk = (k, f) => ({ ...SRC, [k]: f(SRC[k]) });
const mm = (o) => ({ ...SRC, m: { ...SRC.m, ...o } });
const breaks = [
  mm({ latticeLander: () => true }), mm({ landTickDecision: (a) => ({ do: 'dispatch', pr: (a.prs || [0])[0] }) }),
  mm({ landTickDecision: (a) => SRC.m.landTickDecision({ ...a, active: 0 }) }), mm({ landTickDecision: (a) => SRC.m.landTickDecision({ ...a, prs: [...(a.prs || [])].reverse() }) }),
  mm({ landTickDecision: (a) => SRC.m.landTickDecision({ ...a, lastDispatchAt: 0 }) }), mm({ landTickDecision: (a) => SRC.m.landTickDecision({ ...a, lastDispatchAt: Infinity }) }),
  mm({ activeLandRuns: async () => 0 }), mm({ dispatchLand: async () => {} }),
  brk('priv', (t) => t.replace(" && vars.TEST_RUNNER != 'lattice'", '')), brk('mirror', (t) => t.replace('MCLITE_LANDER: lattice', 'MCLITE_X: lattice')),
  brk('land', (t) => t.replace('if (left && !LATTICE)', 'if (left)')), brk('land', (t) => t.replace('HOSTED && !LATTICE) await gh', 'HOSTED) await gh')),
  brk('brain', (t) => t.replace("cmd === 'land'", "cmd === 'lan'")), brk('brain', (t) => t.replace('prs = orderQueue(', 'prs = (')), brk('tick', (t) => t.replace(/brain\.mjs land/g, 'brain.mjs health')),
];
let bad = await verdict(SRC); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; for (const S of breaks) if ((await verdict(S)).length) caught++; else console.log('NOT CAUGHT: break #' + (breaks.indexOf(S) + 1));
console.log(`landhostcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
if (caught < breaks.length) bad = bad.concat('vacuous');
process.exit(bad.length ? 1 : 0);
