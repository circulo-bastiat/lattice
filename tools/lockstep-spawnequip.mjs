#!/usr/bin/env node
// lockstep-spawnequip -- #6939: spawn-time equipment, engine side x 20 salts x 3 difficulties x 300 spawns each of skeleton, zombie, piglin.
// Per spawn: held + armour items, enchantment ids/levels, damage, per-slot drop chances (0.085). An independent transcription of
// MobEntity.initEquipment (0.15*clamped roll, tier nextInt(2) + 3x0.095, helmet-LAST slot order FEET,LEGS,CHEST,HEAD, break 0.25/0.1) is
// replayed on the same stream against Eq.rollArmor; rows go through compareTraces (exact). Server rep0 comparison is the pilot's job.
import { harness } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const { M } = harness(), EL = M.EntityList, Eq = M.Equip, IT = M.Items;
const SLOTS = [IT.MAINHAND, IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const snap = (e) => ({ tick: 0, eq: SLOTS.map((s) => { const k = Eq.getEquipped(e, s); return k ? [IT.nameOf(k.i), k.d || 0, JSON.stringify(k.t || null)] : null; }), drop: SLOTS.map((s) => Eq.dropChance(e, s)) });

// reference of MobEntity.initEquipment's armour half, parameterised so the break tests can corrupt it
function refArmor(r, cd, diff, o) {
  const out = [null, null, null, null];   // FEET LEGS CHEST HEAD tier indexes
  if (!(r() < 0.15 * cd)) return out;
  let tier = Math.floor(r() * 2);
  for (let k = 0; k < 3; k++) if (r() < o.th) tier++;
  if (tier > 4) tier = 4;
  const bc = diff === 'hard' ? 0.1 : 0.25;
  let first = true;
  for (const i of o.order) {
    if (!first && r() < bc) break;
    first = false; out[i] = tier;
  }
  return out;
}
const GOOD = { th: 0.095, order: [0, 1, 2, 3] };
const armorRows = (diff, salt, o) => {
  M.Diff.set(diff);
  const r1 = stream(salt), r2 = stream(salt), rows = [];
  for (let n = 0; n < 300; n++) {
    const cd = (n % 5) / 4;   // spread the clamped local difficulty over 0..1
    const e = { type: 'zombie', x: 0, y: 0, z: 0, equip: [] };
    const saved = Eq.clampedLocalDifficulty; Eq.clampedLocalDifficulty = () => cd;
    try { Eq.rollArmor(e, r1); } finally { Eq.clampedLocalDifficulty = saved; }
    const want = refArmor(r2, cd, diff, o.ref);
    const got = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD].map((s, i) => { const k = Eq.getEquipped(e, s); return k ? Eq.ARMOR_TABLE[['FEET', 'LEGS', 'CHEST', 'HEAD'][i]].indexOf(IT.nameOf(k.i)) : null; });
    rows.push({ tick: n, got });
    o.out.push({ tick: n, got: want });
  }
  return rows;
};
const DIFFS = ['easy', 'normal', 'hard'], MOBS = ['skeleton', 'zombie', 'piglin'];
let rowsTotal = 0;
for (let salt = 0; salt < 20; salt++) for (const diff of DIFFS) {
  const o = { ref: GOOD, out: [] };
  const got = armorRows(diff, salt, o);
  const c = compareTraces(got, o.out, { fields: ['got'] });
  ok(c === null, `armour salt ${salt} ${diff}: ${JSON.stringify(c)}`);
  rowsTotal += got.length;
  for (const mob of MOBS) {
    const run = () => {
      M.Diff.set(diff); EL.list.length = 0; EL.spawnCounter = 0; EL.random = stream(salt * 7 + 1); Math.random = EL.random;
      const rows = [];
      for (let n = 0; n < 300; n++) {
        const e = EL.spawn(mob, 0.5 + (n % 20), 0, 0.5); if (!e) throw new Error('spawn ' + mob);
        const s = snap(e); s.tick = n; rows.push(s); e.persistent = true;
      }
      EL.list.length = 0;
      return rows;
    };
    const a = run(), b = run();
    ok(compareTraces(a, b, { fields: ['eq', 'drop'] }) === null, `${mob} ${diff} salt ${salt}: nondeterministic`);
    ok(a.every((s) => s.drop.every((d) => d === 0.085 || d === 0 || d === 2)), `${mob} ${diff} salt ${salt}: drop chance`);
    ok(a.every((s) => s.eq.slice(1).every((x) => !x || /_(boots|leggings|chestplate|helmet)$|pumpkin|jack_o/.test(x[0]))), `${mob} ${diff} salt ${salt}: armour slot content`);
    if (mob === 'skeleton') ok(a.every((s) => s.eq[0] && s.eq[0][0] === 'bow'), `skeleton ${diff} salt ${salt}: bow`);
    if (mob === 'piglin') ok(a.some((s) => s.eq[0] && /^(crossbow|golden_sword)$/.test(s.eq[0][0])) && a.every((s) => !s.eq[0] || /^(crossbow|golden_sword)$/.test(s.eq[0][0])), `piglin ${diff} salt ${salt}: held item`);
    rowsTotal += a.length;
  }
}
// anti-vacuity: corrupted reference must diverge from the engine on hard/normal at some salt
const diverges = (ref) => { for (let salt = 0; salt < 20; salt++) for (const d of DIFFS) { const o = { ref, out: [] }; if (compareTraces(armorRows(d, salt, o), o.out, { fields: ['got'] }) !== null) return true; } return false; };
caught(diverges({ th: 0.1, order: [0, 1, 2, 3] }), 'tier threshold 0.095 -> 0.1');
caught(diverges({ th: 0.095, order: [3, 2, 1, 0] }), 'slot order reversed');
const zombies = []; // a tampered held item is reported
{ M.Diff.set('hard'); EL.list.length = 0; EL.random = stream(3); const e = EL.spawn('skeleton', 1, 0, 1); const s = snap(e), t = JSON.parse(JSON.stringify(s)); t.eq[0] = ['stick', 0, 'null'];
  caught(compareTraces([s], [t], { fields: ['eq'] }) !== null, 'held item'); const u = JSON.parse(JSON.stringify(s)); u.drop[4] = 0.086; caught(compareTraces([s], [u], { fields: ['drop'] }) !== null, 'drop chance'); }
console.log(`${rowsTotal} rows, ${bad} failures, ${breaks} breaks caught (20 salts x 3 difficulties x 300 spawns)`);
process.exit(bad ? 1 : 0);
