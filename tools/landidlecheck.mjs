// tools/landidlecheck.mjs - #2700 (4 Oct 2026: the lander sat idle 16:43Z-18:30Z with 100 PRs labelled `land`, no land.yml run
// queued or in progress, and nothing noticed). The brain health pass must (a) decide by landIdleAction, (b) dispatch land.yml
// itself when PRs wait and nothing runs, (c) raise `lander-idle` only when that dispatch did not help.
// Anti-vacuity: each break below must be caught by the same verdict.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const route = read('./brain/route.mjs'), brain = read('./brain/brain.mjs');
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const verdicts = async (rt, b) => {
  const bad = [];
  const m = await load(rt);
  const N = Date.parse('2026-10-04T18:30:00Z');
  if (m.landIdleAction(100, 0, 0, N) !== 'dispatch') bad.push('100 PRs wait, no run, never dispatched: must dispatch');
  if (m.landIdleAction(100, 1, 0, N) !== 'none') bad.push('a land run exists: nothing to do');
  if (m.landIdleAction(0, 0, 0, N) !== 'none') bad.push('no PR waits: nothing to do');
  if (m.landIdleAction(5, 0, N - 10 * 60e3, N) !== 'alert') bad.push('dispatched 10 min ago and still idle: must alert');
  if (m.landIdleAction(5, 0, N - 50 * 60e3, N) !== 'dispatch') bad.push('dispatched 50 min ago: dispatch again');
  const snap = (landAction) => ({ now: N, mail: [], runners: [], landAction, landWaiting: 3 });
  const keys = (a) => m.findings(snap(a), { health: {}, accounts: [] }).map((f) => f.key);
  if (!keys('alert').includes('lander-idle')) bad.push("an 'alert' raises no `lander-idle` finding");
  if (keys('dispatch').includes('lander-idle') || keys('none').includes('lander-idle')) bad.push('lander-idle raised before the self-dispatch had a chance');
  if (!/workflows\/land\.yml\/dispatches/.test(b)) bad.push('health() never dispatches land.yml');
  if (!/labels=land&per_page=100[\s\S]{0,1200}?workflows\/land\.yml\/runs\?status=\$\{st\}[\s\S]{0,300}?landIdleAction\(/.test(b)) bad.push('health() does not count waiting PRs and active land runs before deciding');
  if (!/'queued', 'in_progress'\]\) la \+=/.test(b)) bad.push('a QUEUED land run is not counted as active (it would dispatch a second drain every pass)');
  if (!/h\.lastLandDispatch = now/.test(b)) bad.push('the dispatch time is never saved (alert could never fire)');
  if (!/#10200[\s\S]{0,900}?APPROVAL\.test[\s\S]{0,1200}?labels: \['land'\]/.test(b)) bad.push('an approved verifier-change PR is never re-labelled land (#10200: 9 h idle, dormant fill)');
  if (!/#10205[\s\S]{0,900}?heldMailed\[p\.number\][\s\S]{0,400}?post\('commander'/.test(b)) bad.push('a HELD unapproved verifier-change PR never mails the commander (#10205: PR #10202 sat 1 h 48 min, dormant fill)');
  return bad;
};
const BREAKS = [
  ['never dispatches', (rt, b) => [rt, b.replaceAll('/land.yml/dispatches', '/land.yml/nothing')]],
  ['idle is judged by active runs only', (rt, b) => [rt.replace('if (!(waiting > 0) || active > 0)', 'if (active > 0)'), b]],
  ['a run does not suppress the dispatch', (rt, b) => [rt.replace('|| active > 0)', '|| active > 99)'), b]],
  ['no alert after a failed dispatch', (rt, b) => [rt.replace("return lastDispatchAt && now - lastDispatchAt < 40 * 60e3 ? 'alert' : 'dispatch'", "return 'dispatch'"), b]],
  ['alert never becomes a finding', (rt, b) => [rt.replace("snap.landAction === 'alert'", "snap.landAction === 'never'"), b]],
  ['queued runs not counted', (rt, b) => [rt, b.replace("'queued', 'in_progress']) la +=", "'in_progress']) la +=")]],
  ['dispatch time not saved', (rt, b) => [rt, b.replace('h.lastLandDispatch = now', 'h.lastLandDispatchX = now')]],
  ['approved held PR not re-labelled', (rt, b) => [rt, b.replace("{ labels: ['land'] }); await gh('DELETE'", "{ labels: ['landx'] }); await gh('DELETE'")]],
  ['held PR never mailed', (rt, b) => [rt, b.replace("post('commander', `PR #", "post('commanderx', `PR #")]],
  ['waiting PRs not counted', (rt, b) => [rt, b.replace('labels=land&', 'labels=landx&')]],
];
const real = await verdicts(route, brain);
let caught = 0;
for (const [name, mk] of BREAKS) { const [rt, b] = mk(route, brain); if ((rt !== route || b !== brain) && (await verdicts(rt, b)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`landidlecheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${12 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
