#!/usr/bin/env node
// #11667: proves GoTowardsLookTarget (07zzze_axolotlidle.js) is reached from the axolotl roster
// (07k_goals.js -> AxolotlIdle.BrainWanderGoal -> makeWanderTask weight-3 entry) and that its rules matter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/new NS\.AxolotlIdle\.BrainWanderGoal\(e, ctx\)/.test(rd('07k_goals.js')), 'reach: roster adds BrainWanderGoal');
function scenario(edit) {
  const NS = { CFG: { WORLD_MIN_Y: -64 }, States: { block: [], isAir: [], solid: [] }, Reg: { id: { water: 1 } },
    World: { getBlock: () => 0 }, Axolotl: { navStep() {}, nodeType: () => 'OPEN' } };
  globalThis.MCL = NS;
  const load = (f, ed) => { let s = rd(f); if (ed) { if (!s.includes(ed[0])) throw new Error('edit target missing: ' + ed[0]); s = s.replace(ed[0], ed[1]); } new Function('MCL', s)(NS); };
  load('07zzzb_brain.js'); load('07zzzc_braintasks.js'); load('07zzze_axolotlidle.js', edit);
  const B = NS.Brain, AI = NS.AxolotlIdle, out = {};
  const comp = AI.makeWanderTask({ nextFloat: () => 0.5 });
  const ents = comp.tasks.entries.filter((x) => x.data instanceof B.GoTowardsLookTarget);
  out.inComposite = ents.length === 1 && ents[0].weight === 3;
  const mk = (water, lookWater) => {
    const e = { inWater: water, isInWaterOrBubble: () => water, lookTargetIsWater: () => lookWater, brain: AI.makeBrain({ nextFloat: () => 0.5 }) };
    return e;
  };
  const t = new B.GoTowardsLookTarget(AI.canGoToLookTarget, AI.temptedSpeed, 3);
  const e1 = mk(false, false); e1.brain.remember(B.LOOK_TARGET, { x: 5, y: 64, z: 7 });
  out.same = t.shouldRun(null, e1);
  const e2 = mk(false, true); e2.brain.remember(B.LOOK_TARGET, { x: 5, y: 64, z: 7 });
  out.differ = t.shouldRun(null, e2);
  out.noLook = t.shouldRun(null, mk(false, false));
  t.run(null, e1);
  const w = e1.brain.memories.get(B.WALK_TARGET); const v = w && w.value;
  out.walk = v ? [v.pos.x, v.pos.z, v.speed, v.completionRange].join() : 'none';
  const e3 = mk(true, true); e3.brain.remember(B.LOOK_TARGET, { x: 1, y: 1, z: 1 }); t.run(null, e3);
  out.wetSpeed = e3.brain.memories.get(B.WALK_TARGET).value.speed;
  return JSON.stringify(out);
}
const base = scenario(); const o = JSON.parse(base);
ok(o.inComposite, 'weight-3 entry in wander composite'); ok(o.same === true, 'same water-ness runs');
ok(o.differ === false, 'different water-ness refuses'); ok(o.noLook === false, 'no look target refuses');
ok(o.walk === '5,7,0.15,3', 'walk target ' + o.walk); ok(o.wetSpeed === 0.5, 'wet speed');
const breaks = [
  [['return !!this.predicate(e);', 'return true;'], 'predicate ignored'],
  [['e.lookTargetIsWater(m.value) === e.isInWaterOrBubble()', 'true'], 'water-ness ignored'],
  [['pos: lt, speed: this.speed(e), completionRange: this.completionRange', 'pos: lt, speed: 1, completionRange: this.completionRange'], 'speed ignored'],
  [['completionRange: this.completionRange });', 'completionRange: 0 });'], 'range ignored'],
  [['[new B.GoTowardsLookTarget(AI.canGoToLookTarget, AI.temptedSpeed, 3), 3],', ''], 'not in roster'],
  [['e.brain.remember(B.WALK_TARGET, { pos: lt,', 'e.brain.remember(B.LOOK_TARGET, { pos: lt,'], 'writes wrong memory'],
];
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw'; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`gotowardslooktarget11667check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
