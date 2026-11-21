// lockstep-temptgoal -- #7938 (G18b-L25): TemptGoal per species, 20 salts.
// Reference = .decomp TemptGoal (canStart: cooldown-- then closest player holding Ingredient within 10 (squared 3D); shouldContinue: if canBeScared and
// mob-player dist^2 < 36: player moved > 0.1 (sq 0.01) from last pos or pitch/yaw changed > 5 deg -> stop; else track pos; then canStart; stop: cooldown 100;
// tick: dist^2 < 6.25 stop navigation else startMovingTo(player, speed)). Species ingredients/speeds from each initGoals.
// Compared per tick: running, nav call (speed), player target, cooldown behaviour.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07l_spawn.js', '07k_goals.js'], dom: false, initReg: true });
const { Ai } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// species: speed, ingredient (vanilla initGoals), canBeScared
const SP = {
  cow: [1.25, ['wheat'], false], pig: [1.2, ['carrot', 'potato', 'beetroot'], false], sheep: [1.1, ['wheat'], false],
  chicken: [1.0, ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'], false], horse: [1.25, ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'], false],
  rabbit: [1.0, ['carrot', 'golden_carrot', 'dandelion'], false], cat: [0.6, ['cod', 'salmon'], true], ocelot: [0.6, ['cod', 'salmon'], true]
};
const ITEMS = ['wheat', 'carrot', 'wheat_seeds', 'cod', 'golden_carrot'];
function lane(c, mk) {
  const [speed, ing, scared] = SP[c.mob], rnd = stream(c.salt);
  const calls = [];
  Ai.findPath = () => [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
  Ai.stepToward = (e, n, sp) => { calls.push('go' + sp); };
  const e = { type: c.mob, x: 0.5, y: 5, z: 0.5 };
  const pl = { x: 0.5 + c.d0, y: 5, z: 0.5, yaw: 0, pitch: 0, heldItem: ITEMS[c.item], offHandItem: null };
  const rp = { x: pl.x, y: 5, z: 0.5, yaw: 0, pitch: 0, held: ITEMS[c.item] };
  const g = mk(e, speed, ing, scared, pl);
  const DEG = 180 / Math.PI, eng = [], rf = [];
  let run = false, rRun = false, cd = 0, rcd = 0, lx = 0, ly = 0, lz = 0, lpit = 0, lyaw = 0, rtarget = false;
  const d2 = (p) => (p.x - 0.5) ** 2 + (p.y - 5) ** 2 + (p.z - 0.5) ** 2;
  const canStart = () => { if (rcd > 0) { rcd--; return false; } rtarget = ing.includes(rp.held) && d2(rp) <= 100; return rtarget; };
  for (let t = 0; t < 200; t++) {
    const r = rnd();
    if (t === 80 || t === 140) { const it = (c.item + t / 20) % ITEMS.length | 0; pl.heldItem = rp.held = ITEMS[it]; }
    if (c.fast && t % 50 === 30) { pl.x += 0.3; rp.x += 0.3; }
    if (c.turn && t % 60 === 45) { pl.yaw += 6 / DEG; rp.yaw += 6 / DEG; }
    if (r < 0.1) { pl.x += 0.01; rp.x += 0.01; }
    calls.length = 0;
    if (!run) { if (g.canUse()) { g.start(); run = true; } } else if (!g.canContinueToUse()) { g.stop(); run = false; }
    if (run) g.tick();
    eng.push(run + '|' + calls.join(','));
    const rcalls = [];
    if (!rRun) { if (canStart()) { rRun = true; lx = rp.x; ly = rp.y; lz = rp.z; } }
    else {
      let cont = true;
      if (scared) {
        if (d2(rp) < 36) {
          if ((rp.x - lx) ** 2 + (rp.y - ly) ** 2 + (rp.z - lz) ** 2 > 0.010000000000000002) cont = false;
          else if (Math.abs(rp.pitch * DEG - lpit) > 5 || Math.abs(rp.yaw * DEG - lyaw) > 5) cont = false;
        } else { lx = rp.x; ly = rp.y; lz = rp.z; }
        if (cont) { lpit = rp.pitch * DEG; lyaw = rp.yaw * DEG; }
      }
      if (cont) cont = canStart();
      if (!cont) { rRun = false; rcd = 100; }
    }
    if (rRun && d2(rp) >= 6.25) rcalls.push('go' + speed);
    rf.push(rRun + '|' + rcalls.join(','));
  }
  const i = eng.findIndex((v, k) => v !== rf[k]);
  return i < 0 ? null : 'tick ' + i + ': ' + eng[i] + ' vs ' + rf[i];
}
const real = (e, speed, ing, scared, pl) => new Ai.TemptGoal(e, speed, () => [pl], (it) => ing.includes(typeof it === 'string' ? it : it.name || it.id), scared);
function run(mk = real) {
  let n = 0, bad = null;
  for (let s = 0; s < 20; s++) for (const mob of Object.keys(SP)) {
    const b = lane({ salt: s, mob, d0: [3, 6, 10, 2.7][s % 4], item: s % 5, fast: s % 2, turn: s % 4 === 1 }, mk); n++;
    if (b && !bad) bad = `salt ${s} ${mob}: ${b}`;
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 160, 'lanes ' + base.n);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk(!!run((e, sp, ing, sc, pl) => real(e, sp, e.type === 'chicken' ? ['wheat'] : ing, sc, pl)).bad, 'chicken given the wheat ingredient');
brk(!!run((e, sp, ing, sc, pl) => real(e, sp + 0.05, ing, sc, pl)).bad, 'speed off by 0.05');
brk(!!run((e, sp, ing, sc, pl) => real(e, sp, ing, !sc, pl)).bad, 'canBeScared flipped');
{ const o = Ai.TEMPT_COOLDOWN; Ai.TEMPT_COOLDOWN = 60; brk(!!run().bad, 'cooldown 60'); Ai.TEMPT_COOLDOWN = o; }
{ const o = Ai.TEMPT_STANDOFF; Ai.TEMPT_STANDOFF = 3; brk(!!run().bad, 'stand-off 9 sq'); Ai.TEMPT_STANDOFF = o; }
console.log(`lockstep-temptgoal: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
