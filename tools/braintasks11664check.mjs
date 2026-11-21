#!/usr/bin/env node
// braintasks11664check.mjs -- #11664: proves 07zzzc_braintasks.js (CompositeTask, ConditionalTask, StrollTask,
// WeightedList) is REACHED from a real entry point: 07k_goals.js axolotl roster -> AxolotlIdle.BrainWanderGoal ->
// makeBrain/makeWanderTask (CompositeTask of StrollTask/ConditionalTask over a WeightedList). The goal's canUse is
// driven on a stub entity; cutting each class's rule changes the outcome. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/new NS\.AxolotlIdle\.BrainWanderGoal\(e, ctx\)/.test(rd('07k_goals.js')), 'reach: axolotl roster adds BrainWanderGoal');
ok(/B\.CompositeTask\(req/.test(rd('07zzze_axolotlidle.js')) && /B\.ConditionalTask\(/.test(rd('07zzze_axolotlidle.js')) &&
  /B\.StrollTask\(/.test(rd('07zzze_axolotlidle.js')), 'reach: makeWanderTask builds the tasks');

function scenario(edit) {
  const NS = { CFG: { WORLD_MIN_Y: -64 }, States: { block: [], isAir: [], solid: [] }, Reg: { id: { water: 1 } },
    World: { getBlock: () => 0 }, Axolotl: { navStep() {}, nodeType: () => 'OPEN' } };
  NS.JRandom = class { constructor() { this.s = 1; } nextFloat() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
    nextInt(n) { return Math.floor(this.nextFloat() * n); } nextDouble() { return this.nextFloat(); } };
  globalThis.MCL = NS;
  const load = (f, ed) => { let s = rd(f); if (ed) { if (!s.includes(ed[0])) throw new Error('edit target missing: ' + ed[0]); s = s.replace(ed[0], ed[1]); } new Function('MCL', s)(NS); };
  load('07zzzb_brain.js'); load('07zzzc_braintasks.js', edit); load('07zzze_axolotlidle.js');
  const out = {};
  const mk = (o) => Object.assign({ x: 0.5, y: 64, z: 0.5, inWater: false, onGround: true, random: new NS.JRandom() }, o);
  // goal entry: land axolotl; StrollTask(0.15,false) must run through the composite and write WALK_TARGET
  const e = mk({}); const g = new NS.AxolotlIdle.BrainWanderGoal(e, {});
  let r = false; for (let i = 0; i < 40 && !r; i++) r = g.canUse();
  out.landWalk = r;
  // water axolotl: StrollTask(.., false) must NOT start (strollInsideWater false)
  const B = NS.Brain, w = mk({ inWater: true, onGround: false }); const gw = new NS.AxolotlIdle.BrainWanderGoal(w, {});
  // brain structure: shuffle weights deterministic order
  const comp = NS.AxolotlIdle.makeWanderTask({ nextFloat: () => 0.5 });
  out.kinds = comp instanceof B.CompositeTask && comp.tasks instanceof B.WeightedList && comp.tasks.entries.length === 5;
  const ws = comp.tasks.entries.map((x) => x.weight).join();
  out.weights = ws === '2,2,3,5,5';
  const wl = new B.WeightedList({ nextFloat: (() => { const q = [0.3, 0.5, 0.6]; return () => q.shift(); })() }).add('a', 1).add('b', 2).add('c', 1);
  out.shuffle = wl.shuffle().stream().join();
  // ConditionalTask gating: condition false -> shouldRun false even if delegate would run
  const ct = new B.ConditionalTask({}, () => false, new B.WaitTask(1, 2));
  out.condFalse = !ct.shouldRun({ time: 0, random: { nextInt: () => 0 } }, { brain: new B.Brain() });
  const st = new B.StrollTask(0.3, 10, 7, false);
  out.strollWater = st.shouldRun(null, { isInWaterOrBubble: () => true }) === false && st.shouldRun(null, { isInWaterOrBubble: () => false }) === true;
  return JSON.stringify(out);
}
const base = scenario(); const o = JSON.parse(base);
ok(o.landWalk === true, 'land axolotl walks via composite'); ok(o.kinds, 'composite kinds'); ok(o.weights, 'weights');
ok(o.shuffle === 'b,c,a', 'shuffle order ' + o.shuffle);
ok(o.condFalse, 'condition gate'); ok(o.strollWater, 'stroll water gate');
const breaks = [
  [['var s = this.tasks.stream().filter(function (k) { return k.status === B.STOPPED; });', 'var s = [];'], 'composite run starts nothing'],
  [['return !!this.condition(e) && this.delegate.shouldRun(w, e);', 'return this.delegate.shouldRun(w, e);'], 'conditional ignores condition'],
  [['return this.strollInsideWater || !e.isInWaterOrBubble();', 'return true;'], 'stroll water gate'],
  [['Math.pow(Math.fround(r.nextFloat()), Math.fround(1 / en.weight))', 'Math.pow(Math.fround(r.nextFloat()), 1)'], 'weights ignored'],
  [['else e.brain.forget(B.WALK_TARGET);\n  };\n  StrollTask.prototype.findWalkTarget', 'else e.brain.forget(B.WALK_TARGET);\n  };\n  StrollTask.prototype.findWalkTarget'], null],
  [['e.brain.remember(B.WALK_TARGET, { pos: p, speed: this.speed, completionRange: 0 });', ''], 'stroll writes no target'],
].filter((b) => b[1]);
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw'; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`braintasks11664check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
