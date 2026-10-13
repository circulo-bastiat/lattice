#!/usr/bin/env node
// crossbowgoalcheck.mjs — #1201: CrossbowAttackGoal's pull time scales with Quick Charge
// (CrossbowItem.getPullTime = 25-5q), Multishot fires 3 arrows (0/-10/+10 deg), Piercing's level
// rides each arrow, and PillagerEntity.postShoot zeroes despawnCounter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js',
  '07c_blockentity.js', '07e_loot.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js',
  '14i_hand.js', '07q_effects.js', '07z_potion.js', '14j_combat.js', '07y_equip.js', '07k_goals.js'], dom: false });
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock() { return true; }, blockLightAt: () => 15 };
M.World = W; M.Behave.init(W); M.BlockEntities.init(); M.Entities.init(); M.EntityList.init(); M.Combat.init();
const Iv = M.Inventory, IT = M.Items, EL = M.EntityList, Eq = M.Equip, Ai = M.Ai;
Ai.findPath = () => null;   // the goal's approach path is not under test
const REAL = Math.random; Math.random = () => 0.5;

function run(ench) {
  const st = Iv.stack('crossbow', 1, 0);
  if (ench.length) Eq.applyEnchants(st, ench);
  const e = EL.spawn('pillager', 0, 64, 0);
  Eq.setEquipped(e, IT.MAINHAND, st);
  const t = { x: 0, y: 64, z: -6, height: 1.8 };
  e.target = t; e.despawnCounter = 77;
  const before = EL.list ? EL.list.length : 0;
  const g = new Ai.CrossbowAttackGoal(e, 1.0, 8.0, { random: () => 0, canSee: () => true });
  g.start();
  let chargedAt = -1, shotAt = -1, n = 0;
  const arrows = () => EL.list.filter((x) => x.type === 'arrow').length;
  const a0 = arrows();
  for (let i = 1; i < 200 && shotAt < 0; i++) {
    g.tick(); n = i;
    if (chargedAt < 0 && e.crossbowCharging === false && e.crossbowCharge === 1) chargedAt = i;
    if (arrows() > a0) shotAt = i;
  }
  return { chargedAt, shotAt, arrows: arrows() - a0, dc: e.despawnCounter, list: EL.list.filter((x) => x.type === 'arrow').slice(a0) };
}
const plain = run([]), q3 = run([{ id: 'quick_charge', lvl: 3 }]);
const ms = run([{ id: 'multishot', lvl: 1 }]), pc = run([{ id: 'piercing', lvl: 2 }]);
ok(Ai.CROSSBOW_PULL_TICKS === 25, 'base pull 25');
ok(plain.chargedAt === 30, 'plain charges in 25 ticks (+5 LOS ramp), got ' + plain.chargedAt);
ok(q3.chargedAt === 15, 'quick charge III charges in 10 ticks (+5), got ' + q3.chargedAt);
ok(plain.arrows === 1, 'plain fires 1 arrow, got ' + plain.arrows);
ok(ms.arrows === 3, 'multishot fires 3 arrows, got ' + ms.arrows);
ok(pc.list.every((a) => a.pierceLevel === 2) && pc.arrows === 1, 'piercing 2 on the arrow');
ok(plain.dc === 0 && ms.dc === 0, 'postShoot resets despawnCounter, got ' + plain.dc);
// anti-vacuity: break each rule on its own data
const saved = Ai.crossbowPullTicks;
Ai.crossbowPullTicks = () => 25;
okAv(run([{ id: 'quick_charge', lvl: 3 }]).chargedAt !== 15, 'fixed pull time is caught');
Ai.crossbowPullTicks = saved;
const sm = M.Combat.mobShootCrossbow;
M.Combat.mobShootCrossbow = (e, t, st, r) => sm(e, t, Iv.stack('crossbow', 1, 0), r);
okAv(run([{ id: 'multishot', lvl: 1 }]).arrows !== 3, 'dropping multishot is caught');
M.Combat.mobShootCrossbow = sm;
okAv(!(run([]).list.some((a) => a.pierceLevel > 0)), 'no piercing without the enchant');
okAv(Math.abs(ms.list[1].vx - ms.list[0].vx) > 1e-6, 'multishot arrows really diverge');
// #3787: extras are the aim vector rotated +-10 deg BEFORE divergence (rnd .25 -> gauss 0), CREATIVE_ONLY pickup
const zr = () => 0.25, shot = (deg) => { const e = EL.spawn('pillager', 0, 64, 0), t = { x: 0, y: 64, z: -6, height: 1.8 };
  const a = M.Combat.mobShoot(e, t, 1, zr, undefined, deg); return a; };
const gsv = M.Combat.gauss; M.Combat.gauss = () => 0;   // pure rotation: the gaussian jitter is checked elsewhere
const a0 = shot(0), am = shot(-10), ap = shot(10), a0b = shot(0); M.Combat.gauss = gsv; const ang = (a, b) => Math.acos((a.vx * b.vx + a.vy * b.vy + a.vz * b.vz) / (Math.hypot(a.vx, a.vy, a.vz) * Math.hypot(b.vx, b.vy, b.vz))) * 180 / Math.PI;
ok(Math.abs(ang(a0, am) - 10) < 0.05 && Math.abs(ang(a0, ap) - 10) < 0.05, 'extras are 10 deg off centre, got ' + ang(a0, am) + '/' + ang(a0, ap));
ok(Math.abs(Math.hypot(am.vx, am.vy, am.vz) - 1.6) < 1e-6, 'extra keeps speed 1.6');
ok(am.vx * ap.vx < 0 || am.vx !== ap.vx, 'extras go opposite ways');
ok(a0.pickupType !== 'creative_only' && am.pickupType === 'creative_only' && ap.pickupType === 'creative_only', 'extras CREATIVE_ONLY, centre not');
okAv(!(ang(a0, a0b) > 1) && ang(a0, am) > 1, 'angle 0 differs from angle 10');
// #3784: one item.crossbow.shoot per arrow (pitch 1 for the centre shot), never the skeleton bow sound
{
  const plays = []; const sp = M.Sound; M.Sound = { play: (n, o) => { if (!/loading/.test(n)) plays.push([n, o.pitch, o.source]); } };
  const shoot = (ench) => { plays.length = 0; const r = run(ench); return { r, plays: plays.slice() }; };
  const one = shoot([]), three = shoot([{ id: 'multishot', lvl: 1 }]);
  // #4171: each arrow = CrossbowUser hostile sound then CrossbowItem PLAYERS sound at the getSoundPitches pitch
  const pl = (r) => r.plays.filter((p) => p[2] === 'player');
  ok(one.plays.length === 2 && one.plays[0][2] === 'hostile' && one.plays[1][2] === 'player' && one.plays.every((p) => p[0] === 'item.crossbow.shoot') && one.plays[1][1] === 1, 'single shot: hostile + player crossbow sounds, player pitch 1');
  ok(three.plays.length === 6 && three.plays.every((p) => p[0] === 'item.crossbow.shoot') && pl(three)[0][1] === 1, 'multishot: two crossbow sounds per arrow');
  ok(pl(three)[1][1] > 0.9 && pl(three)[2][1] > 0.4 && pl(three)[1][1] !== pl(three)[2][1], 'multishot pitches from getSoundPitches');
  okAv(one.plays[0][1] === Math.fround(1 / (0.25 * 0.4 + 0.8)) || one.plays[0][1] !== 1, 'hostile pitch rolls a nextFloat');
  ok(one.r.list.every((a) => a.hitSound === 'item.crossbow.hit'), 'arrow hit sound is item.crossbow.hit');
  okAv(!plays.some((p) => p[0] === 'entity.skeleton.shoot'), 'no skeleton bow sound from a crossbow');
  M.Sound = sp;
}
// #4172: a mob's shot costs 1 durability (3 with multishot), Unbreaking rolls, and the stack breaks at max damage
{
  const fire = (d, ench, rnd) => { const st = Iv.stack('crossbow', 1, d); if (ench.length) Eq.applyEnchants(st, ench);
    const e = EL.spawn('pillager', 0, 64, 0); Eq.setEquipped(e, IT.MAINHAND, st);
    M.Combat.mobShootCrossbow(e, { x: 0, y: 64, z: -6, height: 1.8 }, st, rnd); return { st, e }; };
  const r0 = () => 0, r9 = () => 0.99;
  ok(fire(10, [], r0).st.d === 11, 'one shot costs 1 durability');
  ok(fire(10, [{ id: 'multishot', lvl: 1 }], r0).st.d === 13, 'multishot costs 3');
  ok(fire(10, [{ id: 'unbreaking', lvl: 3 }], r0).st.d === 11, 'unbreaking roll 0 does not spare');
  ok(fire(10, [{ id: 'unbreaking', lvl: 3 }], r9).st.d === 10, 'unbreaking roll >0 spares');
  const b = fire(IT.durability[Iv.stack('crossbow', 1, 0).i] - 1, [], r0);
  ok(!Eq.getEquipped(b.e, IT.MAINHAND), 'crossbow at max-1 breaks on the next shot');
  const sd = Eq.damageEquipped; Eq.damageEquipped = () => false;
  okAv(fire(10, [], r0).st.d === 10, 'no damage call is caught');
  Eq.damageEquipped = sd;
}
Math.random = REAL;
if (fails.length) { console.log(fails.join('\n')); console.log('FAIL'); process.exit(1); }
console.log('crossbowgoalcheck: ' + pass + ' passed, ' + breaks + ' breaks caught');
