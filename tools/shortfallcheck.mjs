#!/usr/bin/env node
// shortfallcheck.mjs - 21 Oct: a worker that ends EARLY with no PR, no code and the issue open is resumed once by the brain (tools/brain/shortfall.mjs,
// wired in launch.mjs), and every non-RED worker issue runs at roles.json effortFeature. Cases on the pure parts + a fake GitHub, the wiring, then
// anti-vacuity: mutated copies of shortfall.mjs / launch.mjs / roles.json must each be caught.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { sf: rd('./brain/shortfall.mjs'), launch: rd('./brain/launch.mjs'), roles: rd('./brain/roles.json') };
const load = async (s) => { const d = mkdtempSync(join(tmpdir(), 'sfc-')); const f = join(d, 'sf.mjs'); writeFileSync(f, s); return import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); };
const dep = (body) => [...String(body || '').matchAll(/Depends on:? #(\d+)/gi)].map((m) => +m[1]);
const fakeGh = ({ prs = [], commits = [], issue = { state: 'open', body: '' }, other = {}, boom = false } = {}) => async (m, p) => {
  if (boom) throw new Error('down');
  if (/\/pulls\?/.test(p)) return prs; if (/\/commits\?/.test(p)) return commits;
  if (/^\/repos\/\{repo\}$/.test(p)) return { owner: { login: 'o' } };
  const n = (p.match(/issues\/(\d+)/) || [])[1]; return n === '7' ? issue : (other[n] || null);
};
async function verdict(S) {
  const bad = []; const t = async (n, f) => { let r = false; try { r = !!(await f()); } catch { r = false; } if (!r) bad.push(n); };
  let M; try { M = await load(S.sf); } catch (e) { return ['shortfall.mjs does not load: ' + e.message]; }
  const base = { role: 'worker', issueNo: 7, limit: null, cut: false, code: 0, res: { session_id: 's', num_turns: 5 }, resumed: false };
  await t('an early empty worker run is resumed', () => M.wantsResume(base) === true);
  await t('a run that used the 30-turn floor is not resumed', () => M.wantsResume({ ...base, res: { session_id: 's', num_turns: 30 } }) === false);
  await t('29 turns is still a shortfall', () => M.wantsResume({ ...base, res: { session_id: 's', num_turns: 29 } }) === true);
  await t('only once', () => M.wantsResume({ ...base, resumed: true }) === false);
  await t('a tester is never resumed', () => M.wantsResume({ ...base, role: 'tester' }) === false);
  await t('an account limit is not a shortfall', () => M.wantsResume({ ...base, limit: { kind: 'x' } }) === false);
  await t('a cut-off run is salvaged, not resumed', () => M.wantsResume({ ...base, cut: true }) === false);
  await t('a failed exit is not resumed', () => M.wantsResume({ ...base, code: 1 }) === false);
  await t('no session id, no resume', () => M.wantsResume({ ...base, res: { num_turns: 5 } }) === false);
  await t('no issue, no resume', () => M.wantsResume({ ...base, issueNo: 0 }) === false);
  const rp = (g) => M.ranProduced({ gh: g, branch: 'work/7-x', issueNo: 7, since: Date.now(), dependsOn: dep });
  await t('nothing produced -> false', async () => (await rp(fakeGh())) === false);
  await t('an open PR is produced', async () => (await rp(fakeGh({ prs: [{ number: 1 }] }))) === true);
  await t('a real commit is produced', async () => (await rp(fakeGh({ commits: [{ commit: { message: 'port x' }, parents: [1] }] }))) === true);
  await t('hand-off / merge commits are NOT produced', async () => (await rp(fakeGh({ commits: [{ commit: { message: 'handoff: released' }, parents: [1] }, { commit: { message: 'Merge x' }, parents: [1, 2] }] }))) === false);
  await t('a closed issue is produced', async () => (await rp(fakeGh({ issue: { state: 'closed', body: '' } }))) === true);
  await t('Depends on an OPEN issue is produced', async () => (await rp(fakeGh({ issue: { state: 'open', body: 'Depends on: #9' }, other: { 9: { state: 'open' } } }))) === true);
  await t('Depends on a CLOSED issue is not', async () => (await rp(fakeGh({ issue: { state: 'open', body: 'Depends on: #9' }, other: { 9: { state: 'closed' } } }))) === false);
  await t('GitHub down: cannot tell, never resume on a guess', async () => (await rp(fakeGh({ boom: true }))) === true);
  const a = ['-p', 'orig', '--model', 'sonnet', '--max-turns', '60', '--output-format', 'json'];
  await t('resumeArgs: new prompt, --resume id, reduced cap', () => { const r = M.resumeArgs(a, 'sid', 'MSG', 5, 60); return r[0] === '-p' && r[1] === 'MSG' && r[2] === '--resume' && r[3] === 'sid' && r[r.indexOf('--max-turns') + 1] === '55' && !r.includes('orig'); });
  await t('resumeArgs: never below 10 turns', () => { const r = M.resumeArgs(a, 'sid', 'M', 58, 60); return r[r.indexOf('--max-turns') + 1] === '10'; });
  await t('mergeRun adds turns and cost', () => { const r = M.mergeRun({ num_turns: 5, total_cost_usd: 0.05 }, { num_turns: 20, total_cost_usd: 0.3, result: 'x' }); return r.num_turns === 25 && Math.abs(r.total_cost_usd - 0.35) < 1e-9 && r.result === 'x'; });
  await t('mergeRun keeps the first run when the resume gave nothing', () => M.mergeRun({ num_turns: 5 }, {}).num_turns === 5);
  const msg = M.resumeMessage({ turns: 5, max: 60, issueNo: 7 });
  await t('the resume message names the 4 allowed endings and the budget left', () => /done --finished`/.test(msg) && /--part --owed/.test(msg) && /--already-fixed/.test(msg) && /say --to fixer/.test(msg) && /55 turns are still yours/.test(msg) && /part of THIS issue/.test(msg));
  // wiring
  await t('launch.mjs resumes through shortfall.mjs', () => /wantsResume\(\{[^}]*role, issueNo/.test(S.launch) && /ranProduced\(\{ gh, branch, issueNo, since: now, dependsOn \}\)/.test(S.launch) && /resumeArgs\(args, res\.session_id/.test(S.launch) && /res = mergeRun\(res, res2\)/.test(S.launch));
  await t('launch.mjs tells the bus line it resumed', () => /\$\{resumeTag\}\$\{cutTag\}/.test(S.launch));
  await t('launch.mjs picks effortFeature for non-RED worker issues', () => /R\.effortFeature && issueNo && !\/\^RED \/\.test\(issTitle\)/.test(S.launch) && /args\.push\('--effort', EFFORT\)/.test(S.launch));
  let C = {}; try { C = JSON.parse(S.roles).roles.worker; } catch { /* broken roles */ }
  await t('roles.json: worker effortFeature is medium, cap still <= 60 (turnbudgetcheck)', () => C.effortFeature === 'medium' && C.maxTurns <= 60);
  return bad;
}
const real = await verdict(SRC); let caught = 0;
const mutSf = (a, b) => ({ ...SRC, sf: SRC.sf.replace(a, b) });
const BREAKS = [
  ['never resumes', mutSf('return (Number(res.num_turns) || 0) < floor;', 'return false;')],
  ['always resumes', mutSf('return (Number(res.num_turns) || 0) < floor;', 'return true;')],
  ['resumes a cut-off run', mutSf('limit || cut || resumed', 'limit || resumed')],
  ['resumes more than once', mutSf('limit || cut || resumed', 'limit || cut')],
  ['resumes a tester', mutSf("role !== 'worker' || !issueNo", '!issueNo')],
  ['ignores a closed issue', mutSf("if (is.state === 'closed') return true;", '')],
  ['ignores an open dependency', mutSf('for (const m of dependsOn(is.body))', 'for (const m of [])')],
  ['hand-off commits count as code', mutSf('^(handoff: released|takeover:|Merge )', '^(zzz)')],
  ['guesses on a GitHub error', mutSf('catch { return true; }', 'catch { return false; }')],
  ['resume keeps the full cap', mutSf('String(Math.max(10, max - used))', 'String(max)')],
  ['resume message loses the part ending', mutSf('--part --owed', '--x')],
  ['launch never resumes', { ...SRC, launch: SRC.launch.replace('resumeArgs(args, res.session_id', 'resumeArgsX(args, res.session_id') }],
  ['launch ignores effortFeature', { ...SRC, launch: SRC.launch.replace('R.effortFeature && issueNo', 'false && issueNo') }],
  ['roles.json has no effortFeature', { ...SRC, roles: SRC.roles.replace('"effortFeature": "medium", ', '') }],
];
for (const [n, S] of BREAKS) { const r = await verdict(S); if (r.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`shortfallcheck: ${real.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
