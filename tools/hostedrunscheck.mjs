// hostedrunscheck (#10420): the full suite and pilot farm with no machine of Dan's. makeGhw sends ONLY full-suite.yml / pilot-farm.yml to the mirror's full-run.yml / farm-run.yml
// (when hosted), the workflows are silent and private-checkout-by-PAT, published, and the health pass uses ghw. Then each rule is broken to prove the check fails.
import fs from 'node:fs';
const read = (f) => fs.readFileSync(f, 'utf8');
const SRC = { m: await import('./infra/hostedruns.mjs'), full: read('tools/infra/mirror/full-run.yml'), farm: read('tools/infra/mirror/farm-run.yml'), pub: read('tools/infra/mirror.mjs'), brain: read('tools/brain/brain.mjs'), guard: read('tools/infra/runnerguard.mjs'), sync: read('tools/infra/mirror/state-sync.sh') };
const env = { BRAIN_RUNNER: 'mirror', MIRROR_REPO: 'o/l', MIRROR_TOKEN: 'mt' };
async function verdict(S) {
  const bad = [], M = S.m;
  const run = async (e, method, path, body, st = 200) => { const calls = []; const f = async (u, i = {}) => { calls.push([u, i.method || 'GET', i.body]); return { ok: st < 300, status: st, json: async () => ({ default_branch: 'trunk', workflow_runs: [] }) }; };
    const gh = async (...a) => { calls.push(['PRIVATE', ...a]); return {}; }; let err = ''; try { await M.makeGhw(gh, e, f)(method, path, body); } catch (x) { err = x.message; } return { calls, err }; };
  { const r = await run(env, 'POST', '/repos/{repo}/actions/workflows/full-suite.yml/dispatches', { ref: 'master' }); const p = r.calls.find(([u, m]) => m === 'POST');
    if (!p || !/\/repos\/o\/l\/actions\/workflows\/full-run\.yml\/dispatches$/.test(p[0]) || JSON.parse(p[2]).ref !== 'trunk') bad.push('full-suite.yml dispatch does not go to the mirror full-run.yml on its default branch'); }
  { const r = await run(env, 'GET', '/repos/{repo}/actions/workflows/pilot-farm.yml/runs?per_page=10'); if (!r.calls.some(([u]) => /\/o\/l\/actions\/workflows\/farm-run\.yml\/runs\?per_page=10$/.test(u))) bad.push('pilot-farm.yml reads do not go to the mirror farm-run.yml'); }
  { const r = await run(env, 'GET', '/repos/{repo}/actions/workflows/land.yml/runs'); if (!r.calls.some((c) => c[0] === 'PRIVATE')) bad.push('another workflow was rewritten to the mirror'); }
  { const r = await run({}, 'GET', '/repos/{repo}/actions/workflows/full-suite.yml'); if (!r.calls.some((c) => c[0] === 'PRIVATE')) bad.push('rewrites when NOT hosted'); }
  { const r = await run({ BRAIN_RUNNER: 'mirror' }, 'GET', '/repos/{repo}/actions/workflows/full-suite.yml'); if (!/no mirror credentials/.test(r.err)) bad.push('hosted without mirror credentials does not fail loudly'); }
  { const r = await run(env, 'POST', '/repos/{repo}/actions/workflows/full-suite.yml/dispatches', {}, 404); if (!/not published/.test(r.err)) bad.push('a 404 does not say the workflow is unpublished'); }
  for (const [n, t] of [['full-run', S.full], ['farm-run', S.farm]]) {
    if (!/workflow_dispatch/.test(t)) bad.push(`${n}.yml cannot be dispatched`);
    if (!/silent clone git/.test(t) || !/MCLITE_SRC/.test(t) || !/MCLITE_PAT/.test(t)) bad.push(`${n}.yml does not clone the private repo silently by PAT`);
    if (/^\s*run:.*\bnode tools\/infra\/(full|pilotfarm)\.mjs\b/m.test(t.replace(/silent \w+ node/g, ''))) bad.push(`${n}.yml runs a tool outside silent (public log)`);
    if (/set -x|ACTIONS_STEP_DEBUG/.test(t)) bad.push(`${n}.yml traces (public log)`);
  }
  if (!/rc=0; silent full node tools\/infra\/full\.mjs \|\| rc=\$\?/.test(S.full) || !/rc=0; silent farm node[^\n]*\|\| rc=\$\?/.test(S.farm)) bad.push('a red full/farm run would abort under bash -e before the failure post and the state save');
  if (!/state-sync\.sh restore full-state/.test(S.full) || !/state-sync\.sh save full-state/.test(S.full)) bad.push('full-run.yml does not restore/save its state branch');
  if (!/MCLITE_TEST_REMOTE: mirror/.test(S.full) || !/node tools\/infra\/full\.mjs/.test(S.full)) bad.push('full-run.yml does not run full.mjs against the mirror');
  if (!/pilotfarm\.mjs --run/.test(S.farm) || !/farm\/lat-/.test(S.farm)) bad.push('farm-run.yml does not run the farm and ship a farm/ branch');
  if (!/'full-run\.yml'/.test(S.pub) || !/'farm-run\.yml'/.test(S.pub)) bad.push('full-run.yml / farm-run.yml are not in the publish list');
  if (!/restore\)/.test(S.sync) || !/save\)/.test(S.sync) || !/push -q -f/.test(S.sync)) bad.push('state-sync.sh lacks restore/save/force-push');
  if ((S.brain.match(/ghw\('(GET|POST)', '\/repos\/\{repo\}\/actions\/workflows\/(full-suite|pilot-farm)\.yml/g) || []).length < 5) bad.push('brain.mjs health does not use ghw for the full suite / farm');
  if (/\bgh\('(GET|POST)', '\/repos\/\{repo\}\/actions\/workflows\/(full-suite|pilot-farm)\.yml/.test(S.brain)) bad.push('brain.mjs still reads/dispatches full-suite/pilot-farm through the private gh');
  if (!/hostedBrain\(\)\)/.test(S.brain) || !/hosted = false/.test(S.guard) || !/full-run\.yml has not completed/.test(S.guard)) bad.push('fullStale still reasons about gpu runners when hosted');
  return bad;
}
const brk = (k, f) => ({ ...SRC, [k]: f(SRC[k]) });
const mm = (o) => ({ ...SRC, m: { ...SRC.m, ...o } });
const breaks = [
  mm({ makeGhw: (gh) => gh }), mm({ makeGhw: (gh, e, f) => SRC.m.makeGhw(gh, { ...e, BRAIN_RUNNER: '' }, f) }),
  mm({ makeGhw: (gh, e, f) => async (m, p, b) => SRC.m.makeGhw(gh, e, f)(m, p.replace('land.yml', 'full-suite.yml'), b) }),
  brk('full', (t) => t.replace('MCLITE_TEST_REMOTE: mirror', 'MCLITE_TEST_REMOTE: x')), brk('full', (t) => t.replace(/state-sync\.sh save full-state/, 'true')),
  brk('full', (t) => t.replace('silent clone git', 'git')), brk('farm', (t) => t.replaceAll('farm/lat-', 'farm/x-')), brk('farm', (t) => t.replace('workflow_dispatch', 'push')), brk('full', (t) => t.replace('|| rc=$?', '')), brk('farm', (t) => t.replace('|| rc=$?', '')),
  brk('farm', (t) => t.replace('silent farm node tools/infra/pilotfarm.mjs --run', 'node tools/infra/pilotfarm.mjs --run').replace('silent clone git', 'git')),
  brk('pub', (t) => t.replace("'farm-run.yml'", "'x.yml'")), brk('sync', (t) => t.replace('push -q -f', 'push -q')),
  brk('brain', (t) => t.replace(/ghw\('GET', '\/repos\/\{repo\}\/actions\/workflows\/full-suite\.yml'\)/, "gh('GET', '/repos/{repo}/actions/workflows/full-suite.yml')")),
  brk('brain', (t) => t.replace('now, 6, hostedBrain())', 'now)')), brk('guard', (t) => t.replace(/full-run\.yml has not completed/, 'x')),
];
let bad = await verdict(SRC); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; for (const S of breaks) if ((await verdict(S)).length) caught++; else console.log('NOT CAUGHT: break #' + (breaks.indexOf(S) + 1));
console.log(`hostedrunscheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
if (caught < breaks.length) bad = bad.concat('vacuous');
process.exit(bad.length ? 1 : 0);
