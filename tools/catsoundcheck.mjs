#!/usr/bin/env node
// catsoundcheck.mjs — #1542: CatEntity.tick/updateAnimations sounds (purr while sleeping/head-down every 5 ticks,
// beg_for_food while tempted+untamed every 100 ticks). CatEntity.java l.289-300.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m); };
const M = loadEngine({ extra: ['07zzp_mobvoice.js'], dom: false });
const played = [];
M.Sound = { play: (ev) => { played.push(ev); return true; } };
const run = (props, ticks = 200) => {
  played.length = 0;
  const e = Object.assign({ type: 'cat', x: 0, y: 0, z: 0, age: 0 }, props);
  for (let i = 0; i < ticks; i++) { e.age = i; M.MobVoice.tickCat(e); }
  return { purr: played.filter((x) => x === 'entity.cat.purr').length, beg: played.filter((x) => x === 'entity.cat.beg_for_food').length };
};
ok(run({}).purr === 0 && run({}).beg === 0, 'idle cat silent');
ok(run({ inSleepingPose: true, tamed: true }).purr === 40, 'sleeping: purr every 5 ticks');
ok(run({ headDown: true, tamed: true }).purr === 40, 'head down: purr every 5 ticks');
ok(run({ temptActive: true }).beg === 2, 'tempted untamed: beg_for_food every 100 ticks');
ok(run({ temptActive: true, tamed: true }).beg === 0, 'tamed: no beg');
// breaks
const orig = M.MobVoice.tickCat; M.MobVoice.tickCat = () => true;
okAv(run({ inSleepingPose: true }).purr !== 40, 'silenced tickCat is caught (purr)');
okAv(run({ temptActive: true }).beg !== 2, 'silenced tickCat is caught (beg)');
M.MobVoice.tickCat = orig;
okAv(run({ temptActive: true, tamed: true }).beg === 0 && run({ temptActive: true }).beg !== 0, 'tamed/untamed beg distinction is observable');
okAv(run({ headDown: true }, 3).purr === 1 && run({ headDown: true }, 5).purr === 1, 'purr fires on age%5==0 only');
// #2920: every cat event the voice code can emit must be in the PACKED sounds.bin (Sound.play of an unknown event is false)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const A = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02j_sounds.js']) new Function('MCL', readFileSync(join(dirname(A), 'src', f), 'utf8'))(NS);
const meta = JSON.parse(readFileSync(join(A, 'sounds.meta.json'), 'utf8'));
NS.Sound.init({ sounds: readFileSync(join(A, 'sounds.bin')).toString('base64'), soundsBytes: meta.rawBytes });
const catEvs = ['purr', 'purreow', 'ambient', 'stray_ambient', 'hurt', 'death', 'eat', 'beg_for_food', 'hiss'].map((n) => 'entity.cat.' + n);   // CatEntity.java:225-299
const missing = catEvs.filter((e) => !NS.Sound.events[e]);
ok(missing.length === 0, 'cat events missing from sounds.bin: ' + missing);
okAv(!NS.Sound.events['entity.cat.__nope'] && catEvs.length === 9, 'an event absent from the pack is detected');
// #2921: phantom swoop abort near a cat hisses every cat in range
{
  const M2 = loadEngine({ extra: ['07zzp_mobvoice.js', '07zz1_phantom.js'], dom: false });
  const pl = []; M2.Sound = { play: (ev) => { pl.push(ev); return true; } };
  const cat = (x) => ({ type: 'cat', x, y: 0, z: 0 });
  const hiss = (cats) => {
    pl.length = 0; M2.EntityList = { list: cats };
    const ph = { target: { dead: false }, phantomMovementType: 'swoop', age: 5, x: 0, y: 0, z: 0 };
    const g = new M2.Phantom.SwoopMovementGoal(ph, {});
    return { cont: g.canContinueToUse(), n: pl.filter((x) => x === 'entity.cat.hiss').length };
  };
  const a = hiss([cat(3), cat(5)]); ok(!a.cont && a.n === 2, 'swoop abort hisses each cat in range');
  const b = hiss([cat(40)]); ok(b.cont && b.n === 0, 'far cat: no hiss, swoop continues');
  breaks++; ok(hiss([cat(3)]).n === 1, 'anti-vacuity: near cat hisses'); console.log('  ✓ break caught: near cat hisses');
  breaks++; ok(hiss([cat(40)]).n === 0, 'anti-vacuity: far cat silent'); console.log('  ✓ break caught: far cat silent');
}
for (const f of fails) console.log("  FAIL " + f);
console.log(`catsoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
