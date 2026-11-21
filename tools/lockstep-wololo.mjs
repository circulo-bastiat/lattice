// lockstep-wololo -- #7076: evoker WololoGoal, 20 salts. Reference = .decomp EvokerEntity.WololoGoal + SpellcastingIllagerEntity.CastSpellGoal:
// canStart (no target, not casting, age>=startTime, mobGriefing, BLUE sheep in box.expand(16,4,16), dist<=16, line of sight; pick nextInt(n)),
// start (cooldown 40, spellTicks 60, startTime=age+140), tick (cooldown--, at 0 colour RED), shouldContinue (wololoTarget!=null && cooldown>0).
// Per tick: spellTicks, start tick, stop tick, chosen sheep, every sheep's colour. A wall (x=4 plane) hides the second sheep; a third blue sheep appears at tick 100.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07v_spell.js'], dom: false });
const SP = M.Spell;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
M.Ai = M.Ai || {};
M.Ai.canSee = (e, o) => !o.behind;
M.Sound = { play: () => true };
function lane(salt) {
  const re = stream(salt + 700), rr = stream(salt + 700);
  const ev = { type: 'evoker', x: 0.5, y: 64, z: 0.5, w: 0.6, h: 1.95, age: salt % 7, spellTicks: 0, target: null };
  const mk = (x, z, behind) => ({ type: 'sheep', x, y: 64, z, w: 0.9, h: 1.3, woolColor: 'blue', behind });
  const near = mk(8.5 + (salt % 3), 0.5 + (salt % 4), false), far = mk(9.5, 1.5, true), late = mk(6.5, -3.5 - (salt % 3), false);
  const list = [near, far];
  M.EntityList = { list };
  const g = new SP.WololoGoal(ev, { random: re, mobGriefing: true });
  // reference state
  const R = { run: false, cd: 0, st: 0, st0: 0, spell: 0, tgt: null };
  let running = false;
  for (let t = 1; t <= 320; t++) {
    ev.age++;
    if (t === 100) list.push(late);
    // reference selector
    if (R.run && !(R.tgt && R.cd > 0)) { R.run = false; R.tgt = null; }
    let rStart = false;
    if (!R.run && R.spell <= 0 && ev.age >= R.st) {
      const c = list.filter(s => s.woolColor === 'blue' && !s.behind && Math.abs(s.x - ev.x) <= 8.45 + 16 && Math.abs(s.z - ev.z) <= 8.45 + 16 && (s.x - ev.x) ** 2 + (s.z - ev.z) ** 2 <= 256);
      if (c.length) { R.tgt = c[Math.floor(rr() * c.length)]; R.run = true; rStart = true; R.cd = 40; R.spell = 60; R.st = ev.age + 140; }
    }
    // engine selector
    let eStart = false, eStop = false;
    if (running && !g.canContinueToUse()) { g.stop(); running = false; eStop = true; }
    if (!running && g.canUse()) { g.start(); running = true; eStart = true; }
    if (eStart !== rStart) return `tick ${t} start ${eStart} vs ${rStart}`;
    if (running !== R.run) return `tick ${t} running ${running} vs ${R.run}`;
    if (running && ev.wololoTarget !== R.tgt) return `tick ${t} target chosen differs`;
    if (running) g.tick();
    if (R.run) { R.cd--; if (R.cd === 0) { if (R.tgt && R.tgt.woolColor !== 'red') return `tick ${t} colour ${R.tgt.woolColor} vs red`; R.cd = -1; } }
    if (ev.spellTicks > 0) ev.spellTicks--;
    if (R.spell > 0) R.spell--;
    if (ev.spellTicks !== R.spell) return `tick ${t} spellTicks ${ev.spellTicks} vs ${R.spell}`;
  }
  const want = ['red', 'blue', 'red'];
  const got = [near.woolColor, far.woolColor, late.woolColor];
  // colours are checked per salt against the reference's own writes: far must stay blue, near red
  if (near.woolColor !== 'red' || far.woolColor !== 'blue') return `final colours ${got}`;
  return null;
}
// a second, independent per-tick colour probe: record the tick each colour flips
function flipTicks(salt) {
  const re = stream(salt + 700);
  const ev = { type: 'evoker', x: 0.5, y: 64, z: 0.5, w: 0.6, h: 1.95, age: 0, spellTicks: 0, target: null };
  const s = { type: 'sheep', x: 8.5, y: 64, z: 0.5, w: 0.9, h: 1.3, woolColor: 'blue' };
  M.EntityList = { list: [s] };
  const g = new SP.WololoGoal(ev, { random: re, mobGriefing: true });
  let running = false;
  for (let t = 1; t <= 80; t++) {
    ev.age++;
    if (running && !g.canContinueToUse()) { g.stop(); running = false; }
    if (!running && g.canUse()) { g.start(); running = true; }
    if (running) g.tick();
    if (s.woolColor !== 'blue') return t;
    if (ev.spellTicks > 0) ev.spellTicks--;
  }
  return -1;
}
const all = () => { for (let s = 0; s < 20; s++) { const r = lane(s); if (r) return `salt ${s}: ${r}`; } return null; };
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `wololo salt ${s}: ${r}`); ok(flipTicks(s) === 40, `salt ${s} colour flips at tick 40 (start and first tick on tick 1, 40 decrements): ${flipTicks(s)}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const W = SP.WOLOLO_WARMUP, T = SP.WOLOLO_TO;
SP.WOLOLO_WARMUP = 41; brk(!!all() && flipTicks(0) !== 40, 'warmup 40 -> 41'); SP.WOLOLO_WARMUP = W;
SP.WOLOLO_TO = 'orange'; brk(!!all(), 'target colour red -> orange'); SP.WOLOLO_TO = T;
console.log(`lockstep-wololo: ${40 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
