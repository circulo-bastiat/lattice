// workerpackcheck (#8914): grouping, secrets never in dispatch args, rollback default, workflow shape; then proves itself with breaks.
import fs from 'node:fs';
import { packSizes, groupIssues, dispatchBody, plan, runnerMode, jobsFor, PACK_MAX, poolTag, packCounts } from './infra/workerpack.mjs';
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wf = fs.readFileSync('tools/infra/mirror/worker-pack.yml', 'utf8'), brain = fs.readFileSync('tools/brain/brain.mjs', 'utf8');
const checks = (o) => {
  const bad = [];
  if (!eq(o.packSizes(7), [4, 3]) || !eq(o.packSizes(4), [4]) || !eq(o.packSizes(5), [3, 2]) || !eq(o.packSizes(0), []) || !eq(o.packSizes(1), [1])) bad.push('packSizes');
  if (!o.packSizes(13).every((s) => s >= 1 && s <= 4) || o.packSizes(13).reduce((a, b) => a + b, 0) !== 13) bad.push('packSizes bounds');
  if (!eq(o.groupIssues([5, 6, 7, 8, 9, 5]), [[5, 6, 7], [8, 9]])) bad.push('groupIssues');
  if (o.runnerMode(undefined) !== 'vm' || o.runnerMode('mirror') !== 'mirror' || o.runnerMode('bogus') !== 'vm') bad.push('runnerMode rollback');
  const b = o.dispatchBody({ issues: [3, 4], account: 'max' });
  if (b.inputs.issues !== '3,4' || b.inputs.workers !== '2' || b.inputs.account !== 'max') bad.push('dispatchBody');
  let threw = false; try { o.dispatchBody({ issues: [1], account: 'ghp_' + 'a'.repeat(30) + ' x' }); } catch { threw = true; } if (!threw) bad.push('secret-looking account accepted');
  if (/ghp_|sk-|oauth|token/i.test(JSON.stringify(o.plan({ n: 6, account: 'max' })))) bad.push('secret in args');
  if (o.jobsFor(7) !== 2) bad.push('jobsFor');
  return bad;
};
let bad = checks({ packSizes, groupIssues, dispatchBody, plan, runnerMode, jobsFor });
const slot = fs.readFileSync('tools/infra/mirror/pack-slot.sh', 'utf8');   // #8992: the per-slot sequence (claim, brief, launch.mjs) lives in pack-slot.sh, read from the private clone at run time
if (!/workflow_dispatch/.test(wf) || !/pack-slot\.sh/.test(wf) || !/launch\.mjs --role worker/.test(slot)) bad.push('workflow shape');
if (/CLAUDE_CODE_OAUTH_TOKEN=['"]?[A-Za-z0-9]{20,}/.test(wf)) bad.push('literal token in workflow');
if (!/WORKER_RUNNER/.test(brain) || !/workerpack/.test(brain)) bad.push('brain.mjs not wired');
// #9324: reserve pools on the mirror are counted by OPAQUE tags; a public run name must never carry an account name
const pools = (o) => {
  const bad = [], acc = [{ name: 'default' }, { name: 'max', workers: 8 }, { name: 'pro', workers: 2 }];
  if (o.poolTag(acc, 'max') !== 'p1' || o.poolTag(acc, 'pro') !== 'p2' || o.poolTag(acc, 'nobody') !== '') bad.push('poolTag');
  if (!eq(o.packCounts([{ display_title: 'worker-pack p1 x4' }, { display_title: 'worker-pack p1 x2' }, { display_title: 'worker-pack p2 x1' }, { display_title: 'worker-pack p x3' }, { display_title: 'ci-pilot' }]), { p1: 6, p2: 1 })) bad.push('packCounts');
  return bad;
};
bad.push(...pools({ poolTag, packCounts }));
if (!/^run-name: worker-pack \$\{\{ inputs\.pool/m.test(wf) || /run-name:.*inputs\.account/.test(wf)) bad.push('worker-pack run-name must carry the opaque pool tag, never the account');
if (!/mirrorPackRuns/.test(brain) || !/pool: poolTag\(/.test(brain)) bad.push('brain.mjs reserve pools not wired to the mirror (#9324)');
{ let c = 0; for (const br of [{ poolTag: (a, n) => n }, { poolTag: () => 'p0' }, { packCounts: () => ({}) }, { packCounts: (r) => ({ p1: r.length }) }]) if (pools({ poolTag, packCounts, ...br }).length) c++; if (c < 4) bad.push(`pool breaks ${c}/4`); }
// anti-vacuity: broken implementations must be flagged
const broken = [
  { packSizes: (n) => Array(n).fill(1) }, { packSizes: (n) => [n] }, { groupIssues: (a) => [a] }, { runnerMode: () => 'mirror' },
  { dispatchBody: (x) => ({ inputs: { issues: '', workers: '1', account: x.account } }) }, { jobsFor: (n) => n }, { plan: () => [{ inputs: { account: 'ghp_' + 'a'.repeat(30) } }] },
];
let caught = 0; for (const br of broken) if (checks({ packSizes, groupIssues, dispatchBody, plan, runnerMode, jobsFor, ...br }).length) caught++;
if (caught < broken.length) bad.push(`only ${caught}/${broken.length} breaks caught`);
console.log(bad.length ? 'FAIL ' + bad.join('; ') : `workerpackcheck ok; ${caught} breaks caught`); process.exit(bad.length ? 1 : 0);
