// tools/fillshapecheck.mjs - #4549 (Dan, 8 Oct: "I shouldn't have to make this ratio decision anymore"). Feeds route.mjs fillShape recorded
// scenarios (deep queue, empty queue, red master, usage near cap, quiet window, flapping inputs, unreadable input), asserts the shape,
// then breaks each rule and must see the scenarios fail. Also checks the wiring in brain.mjs / go.mjs.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const route = rd('./brain/route.mjs'), brain = rd('./brain/brain.mjs'), go = rd('./go.mjs'), cfg = JSON.parse(rd('./brain/roles.json'));
const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const NIGHT = Date.parse('2026-10-08T03:00:00Z'), QUIET = Date.parse('2026-10-08T15:00:00Z'), MIN = 60e3;   // 23:00 / 11:00 New York
const bad = async (src, b = brain, g = go) => {
  const out = [], R = await load(src), S = (ctx, now = NIGHT) => R.fillShape(cfg, now, undefined, { drain: 8, testerBugs: [1, 0, 2], ...ctx });
  const eq = (name, s, w, t) => { if (s.workers !== w || s.testers !== t) out.push(`${name}: ${s.workers}w+${s.testers}t, want ${w}w+${t}t`); };
  eq('deep queue (40 at 8/h) caps at maxWorkers', S({ claimable: 40 }), 4, 6);
  eq('queue 14 at 8/h wants 4 (ceil(14/4)), first pass', S({ claimable: 14, prev: { workers: 4, at: NIGHT - 99 * MIN } }), 4, 6);
  eq('empty queue is 1 worker', S({ claimable: 0 }), 1, 9);
  eq('queue 3 at 8/h is 1 worker', S({ claimable: 3 }), 1, 9);
  eq('red master halves the workers', S({ claimable: 40, masterRed: true }), 2, 8);
  eq('deep lander backlog halves the workers', S({ claimable: 40, landBacklog: 9 }), 2, 8);
  eq('shallow lander backlog does not', S({ claimable: 40, landBacklog: 2 }), 4, 6);
  eq('usage near cap: budget 2 slots', S({ claimable: 40, budgetSlots: 2 }), 2, 0);
  eq('budget 0 still keeps the 1-worker shape (caps stop the starts)', S({ claimable: 40, budgetSlots: 0 }), 1, 0);
  eq('quiet window halves the total (5 slots)', S({ claimable: 40 }, QUIET), 4, 1);
  eq('no drain history still plans (floor 1/h)', S({ claimable: 1, drain: 0 }), 2, 8);
  // hysteresis: 30 min between changes, 1 slot at a time, and the target is reached step by step
  eq('inside 30 min the shape holds', S({ claimable: 40, prev: { workers: 1, at: NIGHT - 10 * MIN } }), 1, 9);
  eq('after 30 min it moves ONE slot up', S({ claimable: 40, prev: { workers: 1, at: NIGHT - 31 * MIN } }), 2, 8);
  eq('after 30 min it moves ONE slot down', S({ claimable: 0, prev: { workers: 4, at: NIGHT - 31 * MIN } }), 3, 7);
  eq('a shrinking budget clamps at once', S({ claimable: 40, budgetSlots: 2, prev: { workers: 4, at: NIGHT - 1 * MIN } }), 2, 0);
  const flap = [40, 0, 40, 0, 40, 0].map((q) => q); let prev = { workers: 1, at: NIGHT - 99 * MIN }, changes = 0;
  flap.forEach((q, i) => { const s = S({ claimable: q, prev }, NIGHT + i * 5 * MIN); if (s.changed && s.workers !== prev.workers) changes++; prev = { workers: s.workers, at: s.at }; });
  if (changes > 1) out.push(`flapping inputs changed the shape ${changes} times in 30 min, want at most 1`);
  // error path
  const k = S({ claimable: 0, bad: ['usage'], prev: { workers: 3, at: NIGHT - 99 * MIN } });
  eq('an unreadable input keeps the previous shape', k, 3, 7);
  if (!/KEPT, unreadable: usage/.test(k.line)) out.push('the kept shape does not say which input was unreadable');
  const l = S({ claimable: 14, landBacklog: 1 }).line;
  if (!/queue 14, drain 8\/h, testers filed 3 bugs in 3 runs, lander 1, master green, budget 10 slots/.test(l)) out.push(`status/log line lacks its inputs: ${l}`);
  // wiring
  if (!/Math\.min\(PC\.testers, shape\.testers\)/.test(b) || !/shape\.workers\) - Math\.max\(0, running - testing\)/.test(b)) out.push('brain.mjs lets tester slots become workers or ignores the tester cap');
  if (!/post\('log', `brain: \$\{shape\.line\}`\)/.test(b) || !/shape\.changed/.test(b)) out.push('brain.mjs does not log a shape change with its inputs');
  if (!/post\('fixer'/.test(b.slice(b.indexOf('h.shapeMailAt = now'), b.indexOf('h.shapeMailAt = now') + 400))) out.push('brain.mjs does not mail the fixer for an unreadable input');
  if (!/h\.shape\.line/.test(g) || !/realQueue\(q\.list\)/.test(g) || !/freeQueue\(await queue\(\)\)\)\.free\.length/.test(g) || !/fq\.free\.length\} claimable/.test(g)) out.push('go.mjs status/claimable do not share realQueue or show the shape');
  if (!/brain: fill shape:/.test(g) || !/busComments\(3\)/.test(g.slice(g.indexOf('brain: fill shape:') - 300, g.indexOf('brain: fill shape:') + 100))) out.push('go.mjs status does not fall back to the bus line when the brain history is not on this machine (#4610)');
  return out;
};
const BREAKS = [
  ['no maxWorkers clamp', (r) => [r.replace('Math.min(maxW, slots)', 'slots')]],
  ['queue ignores drain', (r) => [r.replace('q / (drain * 0.5)', 'q / 4')]],
  ['red master ignored', (r) => [r.replace('ctx.masterRed ||', 'false ||')]],
  ['lander backlog ignored', (r) => [r.replace("(ctx.landBacklog || 0) >= deep", 'false')]],
  ['budget ignored', (r) => [r.replace('ctx.budgetSlots ?? total', 'total')]],
  ['no 30 min hysteresis', (r) => [r.replace('now - prev.at < 30 * 60e3 ?', 'false ?')]],
  ['jumps straight to target', (r) => [r.replace('prev.workers + Math.sign(target - prev.workers)', 'target')]],
  ['unreadable input not kept', (r) => [r.replace('if (bad.length && prev)', 'if (false)')]],
  ['quiet window ignored', (r) => [r.replace('Math.ceil(want * quietState(cfg, now).factor)', 'want')]],
  ['no drain floor', (r) => [r.replace('Math.max(ctx.drain || 0, 1)', '(ctx.drain || 0) || 1e-9')]],
  ['no fixer mail', (r) => [r, brain.replace("post('fixer', `brain: the auto fill shape", "post('nobody', `brain: the auto fill shape")]],
  ['no log line', (r) => [r, brain.replace("post('log', `brain: ${shape.line}`)", 'void 0')]],
  ['status shows no shape', (r) => [r, brain, go.replace('h.shape.line', 'h.shape.x')]],
  ['status has no bus fallback', (r) => [r, brain, go.replace('brain: fill shape:', 'brain: nothing:')]],
  ['status overcounts', (r) => [r, brain, go.replace('realQueue(q.list)', 'q.list')]],
  ['empty slots become workers', (r) => [r, brain.replace('shape.workers) - Math.max(0, running - testing)', 'n)'), go]],
];
const real = await bad(route); let caught = 0;
for (const [n, mk] of BREAKS) { const a = mk(route); const [r, b, g] = [a[0], a[1] ?? brain, a[2] ?? go]; if ((await bad(r, b, g)).length) { caught++; console.log(`  ✓ break caught: ${n}`); } else console.log(`  ✗ break NOT caught: ${n}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`fillshapecheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
