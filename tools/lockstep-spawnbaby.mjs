#!/usr/bin/env node
// lockstep-spawnbaby -- #7914 (G18c-L2): lockstep lane 'spawnbaby', 20 salts. 2000 spawns each of zombie, husk, drowned, zombified_piglin, piglin, zombie_villager
// per salt (clampedLocalDifficulty pinned per salt to 0.25/0.5/0.75/1), plus every animal spawned once. Per type the counts are held to the vanilla probabilities
// (.decomp ZombieEntity.initialize / shouldBeBaby / MobEntity.initEquipment) within 5 sigma: baby 0.05; canPickUpLoot 0.55*d (zombie family; piglin always);
// door-breaking 0.1*d (not drowned); leader (reinforcement base + max-health bonus) 0.05*d; any armour 0.15*d. Chicken-jockey rolls (pooled over salts): 0.05 mount,
// else 0.05 fresh chicken. Animals egg-spawned are never babies. Anti-vacuity: baby chance 10% (and others) change the counts.
import { harnessM } from './referee/lockstep/zombielane.mjs';

let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const M = harnessM(), EL = M.EntityList;
const SALTS = 20, N = 2000;
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const ZF = ['zombie', 'husk', 'drowned', 'zombified_piglin', 'zombie_villager'];
const ANIMALS = ['cow', 'sheep', 'pig', 'chicken', 'horse', 'donkey', 'mule', 'llama', 'wolf', 'cat', 'ocelot', 'fox', 'rabbit', 'panda', 'goat', 'bee', 'turtle', 'axolotl', 'mooshroom', 'villager', 'polar_bear'];
const within = (got, p, k = N) => Math.abs(got - p * k) <= 5 * Math.sqrt(k * p * (1 - p)) + 1;

function run(salt, mut = {}) {
  const r = stream(salt), d = [0.25, 0.5, 0.75, 1][salt % 4], out = { salt, d, types: {}, animals: 0, jock: [0, 0] };
  EL.random = r; Math.random = r;
  M.Equip.clampedLocalDifficulty = () => d;
  EL.list.length = 0; EL.nextId = 1;
  for (const t of ZF.concat(['piglin'])) {
    const c = { baby: 0, loot: 0, door: 0, leader: 0, armour: 0 };
    for (let i = 0; i < N; i++) {
      const e = EL.spawn(t, 0, 64, 0, {});
      if (!e) continue;
      if ((e.growAge | 0) < 0) {
        c.baby++;
        const cx = { findChicken: () => null, spawnChicken: () => ({ type: 'chicken', x: 0, y: 64, z: 0 }) };
        if (M.Undead.CHICKEN_JOCKEY_FAMILY[t]) { out.jock[0]++; if (M.Undead.tryChickenJockey(e, r, cx)) out.jock[1]++; }
      }
      if (e.canPickUpLoot) c.loot++;
      if (M.Undead.ZOMBIE_FAMILY[t]) {
        if (e.canBreakDoors && !e.zombieLeader) c.door++; if (e.zombieLeader) c.leader++;
        if (['FEET', 'LEGS', 'CHEST', 'HEAD'].some((s) => M.Equip.getEquipped(e, M.Items[s]))) c.armour++;
      }
      e.removed = true;
    }
    EL.list.length = 0;
    out.types[t] = c;
  }
  for (const a of ANIMALS) { const e = EL.spawn(a, 0, 64, 0, {}); if (e && (e.growAge | 0) < 0) out.animals++; EL.list.length = 0; }
  return out;
}

function check(R, mut) {
  let b = 0, first = '';
  const f = (m) => { b++; if (!first) first = m; };
  const babyP = mut && mut.baby || 0.05;
  for (const o of R) for (const t of Object.keys(o.types)) {
    const c = o.types[t], z = !!M.Undead.ZOMBIE_FAMILY[t];
    if (t === 'piglin' && !within(c.baby, 0.2)) f(`salt ${o.salt} piglin baby ${c.baby}`);
    if (z && !within(c.baby, 0.05)) f(`salt ${o.salt} ${t} baby ${c.baby}`);
    if (z && t !== 'zombified_piglin' || t === 'zombified_piglin') { if (z && !within(c.loot, 0.55 * o.d)) f(`salt ${o.salt} ${t} loot ${c.loot}`); }
    if (t === 'piglin' && c.loot !== N) f(`salt ${o.salt} piglin loot ${c.loot}`);
    if (z && !within(c.leader, 0.05 * o.d)) f(`salt ${o.salt} ${t} leader ${c.leader}`);
    if (z && t !== 'drowned' && !within(c.door, 0.1 * o.d * (1 - 0.05 * o.d) + 0.05 * o.d * 0, N)) f(`salt ${o.salt} ${t} door ${c.door}`);
    if (z && t !== 'zombified_piglin' && t !== 'drowned' && c.armour > 0 && !within(c.armour, 0.15 * o.d)) f(`salt ${o.salt} ${t} armour ${c.armour}`);
    if (o.animals) f(`salt ${o.salt} animal baby`);
  }
  const J = R.reduce((a, o) => [a[0] + o.jock[0], a[1] + o.jock[1]], [0, 0]);
  if (J[0] && !within(J[1], 0.95 * 0.05, J[0])) f(`jockey ${J[1]}/${J[0]}`);
  return { b, first };
}

const base = R => check(R);
const runs = Array.from({ length: SALTS }, (_, s) => run(s));
const b0 = base(runs);
if (process.env.DBG) console.log(JSON.stringify(runs[0]));
ok(b0.b === 0, 'divergences: ' + b0.first);
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');
// anti-vacuity: break the engine's own baby chance to 10%, loot chance to 0.65 and leader chance to 0.10
const U = M.Undead; let caught = 0; const breaks = [];
const tryBreak = (name, apply, undo) => { apply(); const rr = Array.from({ length: SALTS }, (_, s) => run(s)); undo(); const x = check(rr); if (x.b > 0) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } n++; };
const ob = U.BABY_CHANCE;
tryBreak('baby 10%', () => { U.BABY_CHANCE = 0.10; }, () => { U.BABY_CHANCE = ob; });
const oj = U.CHICKEN_JOCKEY_ROLL_CHANCE;
tryBreak('jockey 15%', () => { U.CHICKEN_JOCKEY_ROLL_CHANCE = 0.15; }, () => { U.CHICKEN_JOCKEY_ROLL_CHANCE = oj; });
const oc = M.Equip.clampedLocalDifficulty, oe = EL.mobStateDefaults;
tryBreak('loot 0.55 -> always', () => { EL.PICKUP_LOOT_ROLL_BAK = EL.PICKUP_LOOT_ROLL; EL.PICKUP_LOOT_ROLL = {}; EL.PICKUP_LOOT_ALWAYS = Object.assign({ zombie: 1, husk: 1, drowned: 1, zombified_piglin: 1, zombie_villager: 1 }, EL.PICKUP_LOOT_ALWAYS); }, () => { EL.PICKUP_LOOT_ROLL = EL.PICKUP_LOOT_ROLL_BAK; for (const k of ['zombie', 'husk', 'drowned', 'zombified_piglin', 'zombie_villager']) delete EL.PICKUP_LOOT_ALWAYS[k]; });
console.log(`${n} assertions, spawnbaby: ${caught} breaks caught, ${b0.b} divergences${b0.first ? ' ' + b0.first : ''}`);
process.exit(bad === 0 && caught === 3 ? 0 : 1);
