#!/usr/bin/env node
// dragonpartdmgcheck.mjs -- #2708: player/arrow hits on a live ender_dragon are hit-tested per
// EnderDragonPart and reach EnderDragonEntity.damagePart (head full, other parts amount/4+min(amount,1),
// sitting-damage > 25% max health -> Takeoff).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('dragonpartdmgcheck -- #2708 per-part dragon damage');

const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js',
    '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js', '07q_effects.js',
    '14j_combat.js', '07k_goals.js', '07zzl_enderdragon.js', '07za_explosion.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Combat.init(); M.EnderDragon.init(); M.Explosion.init();
const W = M.World, CH = M.CH, EL = M.EntityList, ED = M.EnderDragon, Cb = M.Combat;
W.init(1);
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
M.Player = { type: 'player', x: 0, y: 0, z: 40, width: 0.6, height: 1.8, vx: 0, vy: 0, vz: 0, health: 20, maxHealth: 20, age: 100 };

function dragon() {
  EL.list.length = 0;   // one dragon at a time: arrows strike the nearest of any
  const e = EL.spawn('ender_dragon', 0, 90, 0, {});
  e.dragon.latestSegment = -1; e.dragon.tickWingAndSegments(); e.dragon.entity = e; e.dragon.hurtTime = 0; e.dragon.tickParts();
  return e;
}
const mid = (b) => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
// pick along a ray and return the part it landed on
function aim(e, name) {
  const d = e.dragon, p = d[name], c = mid(p.getBox());
  const r = name === 'head' ? Cb.pick(c[0], c[1], c[2] - 30, 0, 0, 1, 60)      // from in front: head is first along facing
    : Cb.pick(c[0], c[1] + 30, c[2], 0, -1, 0, 60);                           // from above: wing / body are clear
  return r && r.entity === e ? e.hitPart : null;
}
function hit(name, amount) {
  const e = dragon(), d = e.dragon;
  const part = aim(e, name);
  const h0 = e.health;
  Cb.hurt(e, amount, undefined, true, undefined);
  return { e, part, dealt: h0 - e.health };
}

for (const [name, want] of [['head', 10], ['rightWing', 3.5], ['leftWing', 3.5], ['body', 3.5]]) {
  const r = hit(name, 10);
  ok(r.part && r.part === r.e.dragon[name] || (r.part === null && false), name + ': pick resolves the ' + name + ' part');
  ok(Math.abs(r.dealt - want) < 1e-6, name + ': 10 damage deals ' + want + ' (got ' + r.dealt + ')');
}
{
  // anti-vacuity: with no attacker (/damage, void) the generic pipeline is untouched -> full damage on a wing
  const e = dragon(); aim(e, 'rightWing'); const h0 = e.health;
  Cb.hurt(e, 10, undefined, false, { source: 'outOfWorld' });
  okAv(Math.abs(h0 - e.health - 10) < 1e-6, 'attacker-less hit bypasses part routing (full 10)');
  // #3823: any other non-part hurt (magic, fire, attacker-less) must leave the dragon untouched
  const h1 = e.health;
  Cb.hurt(e, 10, undefined, false, { source: 'magic' }); Cb.hurt(e, 10, undefined, false, undefined);
  okAv(e.health === h1, 'non-part magic/plain hurt leaves dragon health unchanged');
}
{
  // anti-vacuity: head-vs-wing really differ (a one-box dragon would deal the same to both)
  const a = hit('head', 10).dealt, b = hit('rightWing', 10).dealt;
  okAv(a > b, 'head damage (' + a + ') exceeds wing damage (' + b + ')');
}
{
  // arrow from a player: wing takes the reduced amount too
  const e = dragon(), c = mid(e.dragon.rightWing.getBox()), h0 = e.health;
  const arrow = { type: 'arrow', shooter: M.Player, x: c[0], y: c[1] + 5, z: c[2], critical: false, vx: 0, vy: -3, vz: 0 };
  const hitAny = Cb.arrowStrikeEntity(arrow, c[0], c[1] + 5, c[2], 0, -10, 0);
  ok(hitAny && h0 - e.health > 0 && h0 - e.health < Cb.arrowHitDamage(arrow), 'arrow on the wing is part-reduced (' + (h0 - e.health) + ' < ' + Cb.arrowHitDamage(arrow) + ')');
}
{
  // sitting: > 25% of max health in one go -> Takeoff
  const e = dragon(), d = e.dragon;
  d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingScanning);
  aim(e, 'head'); Cb.hurt(e, 60, undefined, true, undefined);
  ok(d.getPhaseManager().getCurrent().getType().name === 'Takeoff', 'sitting damage above 25% of max health starts Takeoff');
}
{
  // #3099: launch/damageLivingEntities -> victim's Thorns hurts the dragon (applyDamageEffects)
  const run = (lvl) => {
    const e = dragon(), d = e.dragon, Iv = M.Inventory;
    const p = M.Player; p.inventory = { slots: [] };
    for (let i = 0; i < 40; i++) p.inventory.slots[i] = Iv.EMPTY;
    if (lvl) p.inventory.slots[Iv.ARMOR_START] = { id: M.Items ? 0 : 0, count: 1, ench: [] };
    const orig = Cb.enchantLevel; Cb.enchantLevel = (st, id) => (lvl && id === 'thorns' ? lvl : 0);
    const orig2 = M.Effects.thornsShouldTrigger; M.Effects.thornsShouldTrigger = () => true;
    p.health = 20; p.x = 0; p.y = 60; p.z = 0;
    const h0 = e.health; d.damageLivingEntities([p]);
    Cb.enchantLevel = orig; M.Effects.thornsShouldTrigger = orig2; p.inventory = undefined;
    return h0 - e.health;
  };
  ok(run(3) > 0, 'thorns-armoured victim of damageLivingEntities hurts the dragon');
  okAv(run(0) === 0, 'no thorns -> dragon unhurt');
}
{
  // #3824: a blast over the body hurts each EnderDragonPart in range through damagePart (non-head amount/4+min(amount,1))
  const e = dragon(), d = e.dragon, calls = [], orig = d.damagePart;
  d.damagePart = function (part, src, amt) { calls.push([part, amt]); return orig.call(this, part, src, amt); };
  const h0 = e.health, c = mid(d.body.getBox());
  M.Explosion.damageEntities(null, c[0], c[1], c[2], 4);
  const raw = calls.reduce((a, x) => a + x[1], 0), dealt = h0 - e.health;
  okAv(calls.length > 1 && new Set(calls.map(x => x[0])).size === calls.length, 'blast hits several distinct parts (' + calls.length + ')');
  okAv(dealt > 0 && dealt < raw, 'parts took the reduced split (' + dealt + ' < raw ' + raw + ')');
}
{
  // #6472: AbstractSittingPhase.modifyDamageTaken ignites the ARROW for 1 s (20 ticks), dragon takes 0
  const shoot = (phase) => {
    const e = dragon(), d = e.dragon, c = mid(d.body.getBox());
    d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName[phase]);
    const arrow = { type: 'arrow', shooter: M.Player, x: c[0], y: c[1] + 5, z: c[2], critical: false, vx: 0, vy: -3, vz: 0 };
    const h0 = e.health;
    Cb.arrowStrikeEntity(arrow, c[0], c[1] + 5, c[2], 0, -10, 0);
    return { dealt: h0 - e.health, fire: arrow.remainingFireTicks | 0 };
  };
  for (const ph of ['SittingFlaming', 'SittingScanning']) {
    const r = shoot(ph);
    okAv(r.dealt === 0 && r.fire === 20, ph + ': arrow deals 0 and burns 20 ticks (dealt ' + r.dealt + ', fire ' + r.fire + ')');
  }
  const r = shoot('HoldingPattern');
  okAv(r.dealt > 0 && r.fire === 0, 'HoldingPattern: arrow damages normally, not lit (dealt ' + r.dealt + ', fire ' + r.fire + ')');
}
console.log(`${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
