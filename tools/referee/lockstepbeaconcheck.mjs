// lockstep-beacon -- #6796 (G17-L145): beacon over 0-4 layer pyramids, player + cow in/out of range, 20 seeds.
// Reference = .decomp BeaconBlockEntity.java: updateLevel (k=1..4, (2k+1)^2 base), applyPlayerEffects every getTime()%80==0
// (range 10+10*level, amp 1 iff level>=4 && primary==secondary, duration (9+2*level)*20, ambient, players only, secondary at level 4).
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
const R = M.Reg, BE = M.BlockEntities;
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
M.World = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0 };
BE.init();
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const NAMES = { 1: 'speed', 3: 'haste', 11: 'resistance', 8: 'jump_boost', 5: 'strength', 10: 'regeneration' };
const IDS = [1, 3, 11, 8, 5, 10];
const MATS = ['iron_block', 'gold_block', 'emerald_block', 'diamond_block'];
const by = 64, TICKS = 400;
let applied = [];
M.Effects = Object.assign(M.Effects || {}, { addStatusEffect: (e, n, d, a, amb, vis) => { applied.push({ e, n, d, a, amb, vis, t: M.Behave.gameTime }); return true; } });
function refLevel(layers) { // updateLevel over the built pyramid
  let lv = 0;
  for (let k = 1; k <= 4; lv = k++) { if (k > layers) break; }
  return lv;
}
function lane(c) {
  cells.clear(); applied = [];
  cells.set(key(0, by, 0), def('beacon'));
  for (let k = 1; k <= c.layers; k++) for (let x = -k; x <= k; x++) for (let z = -k; z <= k; z++) cells.set(key(x, by - k, z), def(MATS[(k + c.salt) % 4]));
  const player = { x: c.px + 0.5, y: by, z: 0.5, dead: false };
  const cow = { x: 0.5, y: by, z: 0.5, type: 'cow' };
  M.Player = player; M.EntityList = M.EntityList || {};
  const e = BE.create(0, by, 0, 'beacon');
  e.primary = c.primary; e.secondary = c.secondary;
  const exp = [], rr = stream(c.salt); void rr;
  let refSeg = false;
  for (let t = 0; t < TICKS; t++) {
    M.Behave.gameTime = t; BE.tickBeacon(e);
    // reference: beam scan completes on tick 0 (open sky, 1 block per step); levels computed at the next t%80==0
    if (t === 0) refSeg = true;
    // reference runs the effect step before the segment publish, so segments are visible from t=1 on
  }
  // reference expectations
  const lv = refLevel(c.layers);
  // first %80 tick with segments: t=80 (t=0 has no published segments yet)
  for (let t = 80; t < TICKS; t += 80) {
    if (lv > 0 && c.primary != null) {
      const r = lv * 10 + 10, inR = Math.abs(c.px) <= r + 0.3;
      if (inR) {
        const amp = lv >= 4 && c.primary === c.secondary ? 1 : 0, d = (9 + lv * 2) * 20;
        exp.push(`${t}:${NAMES[c.primary]}:${d}:${amp}:1:1`);
        if (lv >= 4 && c.primary !== c.secondary && c.secondary != null) exp.push(`${t}:${NAMES[c.secondary]}:${d}:0:1:1`);
      }
    }
  }
  const got = applied.map((a) => `${a.t}:${a.n}:${a.d}:${a.a}:${a.amb ? 1 : 0}:${a.vis ? 1 : 0}`);
  const bad = [];
  if (refSeg && e.levels !== lv) bad.push(`level ${e.levels} vs ${lv}`);
  if (got.join() !== exp.join()) bad.push(`effects ${got.slice(0, 4)} vs ${exp.slice(0, 4)}`);
  if (applied.some((a) => a.e === cow)) bad.push('cow received effect');
  if (applied.some((a) => a.e !== player)) bad.push('non-player received effect');
  return bad.join('; ') || null;
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) {
    const r = stream(s + 1);
    for (let layers = 0; layers <= 4 && !bad; layers++) for (const px of [3, 25 + Math.floor(r() * 5), 45]) {
      const primary = IDS[Math.floor(r() * 6)], secondary = r() < 0.5 ? primary : (r() < 0.2 ? null : IDS[Math.floor(r() * 6)]);
      const b = lane({ salt: s, layers, px, primary, secondary }); n++;
      if (b) { bad = `salt ${s} layers ${layers} px ${px} ${primary}/${secondary}: ${b}`; break; }
    }
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 300, 'lanes ' + base.n);
{ let hit = 0; lane({ salt: 3, layers: 4, px: 3, primary: 1, secondary: 1 }); hit = applied.length; ok(hit > 0 && applied[0].a === 1, 'level 4 same primary/secondary -> amplifier 1'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const ot = BE.tickBeacon; BE.tickBeacon = (e) => { const g = M.Behave.gameTime; M.Behave.gameTime = g * 80 / 100; try { return ot(e); } finally { M.Behave.gameTime = g; } }; brk(!!run().bad, 'interval 80 -> 100 ticks'); BE.tickBeacon = ot; }
{ const o = BE.updateLevel; BE.updateLevel = (x, y, z) => Math.min(3, o(x, y, z)); brk(!!run().bad, 'level capped at 3'); BE.updateLevel = o; }
{ const o = BE.applyPlayerEffects; BE.applyPlayerEffects = (e, lv, p, s) => o(e, lv, p, p); brk(!!run().bad, 'secondary forced to primary'); BE.applyPlayerEffects = o; }
{ const o = BE.applyPlayerEffects; BE.applyPlayerEffects = (e, lv, p, s) => o(e, lv - 1 < 0 ? 0 : lv - 1, p, s); brk(!!run().bad, 'range/duration use level-1'); BE.applyPlayerEffects = o; }
{ const o = M.Effects.addStatusEffect; M.Effects.addStatusEffect = (e, n, d, a, amb, v) => o(e, n, d, a, false, v); brk(!!run().bad, 'ambient flag dropped'); M.Effects.addStatusEffect = o; }
console.log(`lockstep-beacon: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
