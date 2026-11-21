#!/usr/bin/env node
// bowcheck.mjs — loop/bow: the PLAYER's own bow. Proves `Use.bowStart`/`Use.bowRelease`
// (14l_use.js) are a real `BowItem.use`/`BowItem.onStoppedUsing` (.decomp/net/minecraft/item/
// BowItem.java, read whole), `Use.getArrowSlot`/`Use.getArrowType` a real
// `PlayerEntity.getArrowType`/`RangedWeaponItem.getHeldProjectile` (.decomp/net/minecraft/
// entity/player/PlayerEntity.java:1977-1996, .decomp/net/minecraft/item/RangedWeaponItem.java),
// and that the fired arrow is the SAME live entity a mob's own shot uses (`Cb.mobShoot`/
// `Cb.tickArrow`, 14j_combat.js) — a tipped arrow's potion tag and a spectral arrow's Glowing
// both apply on a real landed hit, not a second copy of `Cb.applyArrowTip`.
//
//   node tools/bowcheck.mjs [--verbose]
//
// Sections:
//   1. `Use.bowPullProgress` — BowItem.getPullProgress's own exact formula, several ticks
//   2. `Use.getArrowSlot`/`Use.getArrowType` — off hand, then main hand, then inventory order;
//      creative's virtual plain arrow when nothing is carried
//   3. `Use.bowStart` — survival refuses with no ammo (no draw, no swing); creative always
//      starts; a second press mid-draw is refused (D-361's own re-click guard)
//   4. `Use.bowRelease`, pull under 0.1 — PASS, nothing fires, the hold still clears
//   5. `Use.bowRelease`, a full draw — a REAL arrow entity, through `EL.spawn`/`Cb.tickArrow`;
//      velocity direction and magnitude off `pull*3.0`; `critical` set only at pull 1.0;
//      Power/Punch/Flame off the bow's own enchantments; durability spent; ammo consumed
//   6. tipped/spectral ammo — a tipped arrow's `Potion` tag lands through `Cb.applyArrowTip`
//      on the FIRED entity; a spectral arrow lands Glowing(200) unconditionally
//   7. Infinity / creative pickup rule — the plain-arrow no-consume case, and `e.pickupType`
//   8. anti-vacuity — mutate the pull-progress formula and the crit threshold, must fail loud

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('bowcheck — loop/bow: the player\'s own bow, and the live arrow it fires');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
               '07zzo_stats.js', '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15,
};
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Use.init(W);

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat, ES = MCL.Effects;

// pinned so a velocity assertion is exact arithmetic instead of a tolerance band that
// occasionally loses to a rare multi-sigma gaussian draw -- the same Math.random override
// pattern combatcheck/aicheck/etc. already use for a seeded roll. Restored at the very end.
const REAL_RANDOM = Math.random;
Math.random = () => 0.5;
// Use draws from the player JRandom (pRand, #6447), not Math.random: pin that stream too
(MCL.Player || Use).random = { nextDouble: () => 0.5 };
function gaussOffset() { return Cb.gauss(Math.random) * Cb.ARROW_GAUSS_SCALE * Use.BOW_DIVERGENCE; }

ok(Use.ready, 'Use module reports ready');
ok(!!EL.canSpawn('arrow') && !!EL.canSpawn('spectral_arrow'), 'both arrow types are simulatable (D-402 motion table)');

// ── a player stub that is exactly what Use.bowStart/bowRelease/getArrowSlot read ────────────
function player(opts) {
  const inv = Iv.create();
  const o = opts || {};
  return Object.assign({
    inventory: inv,
    slot: 0,
    instabuild: false,
    usingItem: false, useHand: 0, useTicks: 0,
    ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true,
    yaw: 0, pitch: 0,
    heldItem() { return Iv.getItem(this.inventory, this.slot); },
    lookVec() { return [0, 0, -1]; },       // fixed, straight -Z — this engine's own convention
    syncHotbar() {},
  }, o);
}
const bow = () => Iv.stack('bow', 1, 0);
const mob = (x, z) => { const e = EL.spawn('turtle', x, 64, z || 0); e.maxHealth = e.health = 1000; return e; };

// ═══════════ 1. Use.bowPullProgress — BowItem.getPullProgress's own exact formula ═══════════
console.log('\n1. Use.bowPullProgress — (t*t + t*2) / 3, t = useTicks/20, clamped to 1');
{
  const fr = Math.fround;
  const f = (n) => { const t = fr(n / 20); return Math.min(fr(fr(fr(t * t) + fr(t * 2)) / 3), 1); };
  [0, 1, 5, 10, 19, 20, 30, 72000].forEach((n) => {
    ok(Use.bowPullProgress(n) === f(n), `bowPullProgress(${n}) = ${Use.bowPullProgress(n)}, want ${f(n)}`);
  });
  ok(Use.bowPullProgress(20) === 1 && Use.bowPullProgress(72000) === 1, 'a full 20-tick draw AND the 72000-tick cap both read as pull 1.0');
  for (let n = 0; n <= 20; n++) okAv(Math.fround(Use.bowPullProgress(n)) === Use.bowPullProgress(n), `bowPullProgress(${n}) is an exact float (BowItem.getPullProgress is float math)`);
  ok(Use.bowPullProgress(1) < 0.1, 'one tick of hold is well under the 0.1 dead zone');
}

// ═══════════ 2. Use.getArrowSlot / getArrowType — off hand, then main, then inventory ═══════
console.log('\n2. Use.getArrowSlot/getArrowType — off hand first, then main, then inventory order');
{
  const P = player();
  ok(Use.getArrowSlot(P) === -1, 'no ammo anywhere: no slot found');
  ok(Use.getArrowType(P) === null, 'no ammo, survival: getArrowType is null (not a virtual arrow)');
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 3));
  ok(Use.getArrowSlot(P) === 5, 'found in the plain inventory scan');
  Iv.setItem(P.inventory, Iv.OFFHAND, Iv.stack('spectral_arrow', 1));
  ok(Use.getArrowSlot(P) === Iv.OFFHAND, 'the OFF HAND wins over a main-inventory stack (RangedWeaponItem.getHeldProjectile’s own Hand.field_5810-first order)');
  P.slot = 2;
  Iv.setItem(P.inventory, 2, Iv.stack('tipped_arrow', 1, 0, { Potion: 'minecraft:poison' }));
  ok(Use.getArrowSlot(P) === Iv.OFFHAND, 'off hand STILL wins over the main hand too');
  Iv.setItem(P.inventory, Iv.OFFHAND, null);
  ok(Use.getArrowSlot(P) === 2, 'off hand empty now: falls back to the main hand');

  const creativeP = player({ instabuild: true });
  const virt = Use.getArrowType(creativeP);
  ok(!!virt && IT.nameOf(virt.i) === 'arrow' && virt.n === 1, 'creative with no ammo carried: a virtual 1-count plain arrow (PlayerEntity.getArrowType’s own closing ternary)');
}

// ═══════════ 3. Use.bowStart — the press ════════════════════════════════════════════════════
console.log('\n3. Use.bowStart — BowItem.use: fails (no draw) in survival with no ammo anywhere');
{
  const P = player();
  const st = bow();
  ok(Use.bowStart(P, st) === false, 'survival, empty quiver: bowStart refuses');
  ok(P.usingItem === false, 'and no hold was started');

  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 1));
  ok(Use.bowStart(P, st) === true, 'survival with a real arrow somewhere: bowStart succeeds');
  ok(P.usingItem === true && P.useTicks === 0 && P.handsBusy === true, 'the hold state is armed: usingItem, useTicks=0, handsBusy');
  ok(Use.bowStart(P, st) === false, 'a SECOND press mid-draw is refused, not restarted (D-361’s own re-click guard)');

  const creativeP = player({ instabuild: true });
  ok(Use.bowStart(creativeP, st) === true, 'creative always starts, even with an empty quiver');

  const notBow = Iv.stack('arrow', 1);
  ok(Use.bowStart(player(), notBow) === false, 'a non-bow stack never starts a draw');
}

// ═══════════ 4. Use.bowRelease — under 0.1 pull is a PASS, nothing fires ════════════════════
console.log('\n4. Use.bowRelease — pull < 0.1: PASS, no arrow, the hold still clears');
{
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 5));
  Use.bowStart(P, bow());
  P.useTicks = 1;                      // well under the 20-tick/0.1-pull threshold
  const before = EL.list.length;
  const fired = Use.bowRelease(P);
  ok(fired === false, 'bowRelease reports nothing fired');
  ok(EL.list.length === before, 'no arrow entity was spawned');
  ok(P.usingItem === false && P.useTicks === 0, 'the hold clears anyway (vanilla’s own tick still runs to completion)');
  ok(Iv.getItem(P.inventory, 5).n === 5, 'the untouched ammo stack was NOT consumed on a no-op release');
}

// ═══════════ 4b. BowItem.java:84 incrementStat(Stats.USED, bow) ═══════════════════════════
{
  const S = MCL.Stats, name = S.statName('used', 'bow');
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 2));
  S.reset();
  Use.bowStart(P, bow());
  P.useTicks = 1;
  Use.bowRelease(P);                          // pull < 0.1: nothing fired, no stat
  ok(S.get(name) === 0, 'an unfired (pull<0.1) release does not count minecraft.used:minecraft.bow');
  Use.bowStart(P, bow());
  P.useTicks = 20;
  Use.bowRelease(P);
  okAv(S.get(name) === 1, `a fired arrow counts used:bow once (got ${S.get(name)})`);
}

// ═══════════ 5. Use.bowRelease — a full draw fires a real, live arrow ═══════════════════════
console.log('\n5. Use.bowRelease — a full (pull=1.0) draw: a real EL-spawned, Cb.tickArrow-hittable arrow');
{
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 2));
  Use.bowStart(P, bow());
  P.useTicks = 20;                     // pull = 1.0 exactly
  const before = EL.list.length;
  const fired = Use.bowRelease(P);
  ok(fired === true, 'a full draw fires');
  ok(EL.list.length === before + 1, 'exactly one new entity was spawned');
  const a = EL.list[EL.list.length - 1];
  ok(a.type === 'arrow', 'the fired entity is a plain arrow (plain ammo)');
  ok(a.shooter === P, 'the player is recorded as the shooter (Cb.tickArrow’s own no-self-hit read)');
  ok(a.critical === true, 'pull === 1.0 sets `critical` (BowItem’s own `$$8 == 1.0F`)');
  const speed = 1 * Use.BOW_SPEED;
  const mag = Math.hypot(a.vx, a.vy, a.vz);
  const g = gaussOffset();
  const wantVx = g * speed, wantVy = g * speed, wantVz = (-1 + g) * speed;
  ok(Math.abs(a.vx - wantVx) < 1e-9, `vx (${a.vx}) matches (0+gaussOffset)*speed (${wantVx}) exactly, pinned Math.random`);
  ok(Math.abs(a.vy - wantVy) < 1e-9, `vy (${a.vy}) matches (0+gaussOffset)*speed (${wantVy}) exactly`);
  ok(Math.abs(a.vz - wantVz) < 1e-9, `vz (${a.vz}) matches (-1+gaussOffset)*speed (${wantVz}) exactly — the player’s own straight -Z look vector`);
  ok(Math.abs(Math.hypot(a.vx, a.vy, a.vz) - Math.hypot(wantVx, wantVy, wantVz)) < 1e-9, 'velocity magnitude matches the same pinned-noise vector exactly');
  ok(Math.abs(Iv.getItem(P.inventory, P.slot).d - 1) < 1e-9, 'the bow spent 1 durability');
  ok(Iv.getItem(P.inventory, 5).n === 1, 'the real ammo stack was decremented by exactly 1');
}

// same draw, but the last arrow: the stack is removed from the slot entirely, not left at n=0
{
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 1));
  Use.bowStart(P, bow());
  P.useTicks = 20;
  Use.bowRelease(P);
  ok(Iv.getItem(P.inventory, 5) === null, 'the last arrow leaves the slot empty (null), not a 0-count stack');
}

// Power/Punch/Flame — read off the BOW's own enchant tag directly (not a mob's e.equip[])
{
  const P = player();
  const enchBow = Iv.stack('bow', 1, 0, { Enchantments: [{ id: 'minecraft:power', lvl: 2 }, { id: 'minecraft:punch', lvl: 1 }, { id: 'minecraft:flame', lvl: 1 }] });
  Iv.setItem(P.inventory, P.slot, enchBow);
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 1));
  Use.bowStart(P, enchBow);
  P.useTicks = 20;
  Use.bowRelease(P);
  const a = EL.list[EL.list.length - 1];
  ok(a.arrowDamage === Cb.ARROW_BASE_DAMAGE + 2 * 0.5 + 0.5, `Power II adds +1.5 flat damage, got ${a.arrowDamage}`);
  ok(a.punch === 1, 'Punch I is carried onto the arrow’s own `punch` field');
  ok(a.isOnFire === true, 'Flame I ignites the arrow for 100s (Cb.igniteForSeconds)');
}

// ═══════════ 6. tipped/spectral ammo — the SAME live-hit path a mob's own shot uses ═════════
console.log('\n6. tipped/spectral ammo — a real landed hit through Cb.tickArrow');
{
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  const tipStack = Iv.stack('tipped_arrow', 1, 0, { Potion: 'minecraft:poison' });
  Iv.setItem(P.inventory, 5, tipStack);
  Use.bowStart(P, bow());
  P.useTicks = 20;
  Use.bowRelease(P);
  const a = EL.list[EL.list.length - 1];
  ok(a.type === 'arrow', 'a tipped_arrow still spawns as the plain `arrow` entity type');
  ok(!!a.tip && a.tip.potionId === 'poison', 'the tipped arrow’s own Potion tag reached the fired entity as `e.tip` (Po.tipFromTag)');
  const t = mob(10, 10);
  a.x = t.x; a.y = t.y; a.z = t.z; a.px = a.x; a.py = a.y; a.pz = a.z; a.onGround = false;
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'poison');
  ok(!!inst, 'the SAME real Cb.applyArrowTip a mob-fired tipped arrow uses applies poison on hit');
}
{
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('spectral_arrow', 1));
  Use.bowStart(P, bow());
  P.useTicks = 20;
  Use.bowRelease(P);
  const a = EL.list[EL.list.length - 1];
  ok(a.type === 'spectral_arrow', 'a spectral_arrow ammo stack spawns the real `spectral_arrow` entity type');
  const t = mob(20, 20);
  a.x = t.x; a.y = t.y; a.z = t.z; a.px = a.x; a.py = a.y; a.pz = a.z; a.onGround = false;
  Cb.tickArrow(a);
  const inst = ES.getStatusEffect(t, 'glowing');
  ok(!!inst && inst.duration === Cb.SPECTRAL_GLOW_TICKS && inst.amplifier === 0,
     `spectral hit applies Glowing(${Cb.SPECTRAL_GLOW_TICKS}), unconditionally (SpectralArrowEntity.onHit); got ${inst && inst.duration}`);
}

// ═══════════ 7. Infinity / creative — the no-consume case and the pickup flag ═══════════════
console.log('\n7. Infinity enchant and creative — no-consume firing, and the pickup-permission flag');
{
  // survival + Infinity + a single real plain arrow: fires WITHOUT consuming it
  const P = player();
  const infBow = Iv.stack('bow', 1, 0, { Enchantments: [{ id: 'minecraft:infinity', lvl: 1 }] });
  Iv.setItem(P.inventory, P.slot, infBow);
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 1));
  Use.bowStart(P, infBow);
  P.useTicks = 20;
  const fired = Use.bowRelease(P);
  ok(fired === true, 'Infinity fires');
  ok(Iv.getItem(P.inventory, 5).n === 1, 'Infinity + a plain arrow does NOT consume it');
  const a = EL.list[EL.list.length - 1];
  ok(a.pickupType === 'creative_only', 'Infinity’s own no-consume plain-arrow shot is creative-only pickup (BowItem’s own `$$9`)');
}
{
  // survival + Infinity, but a TIPPED arrow: still consumed (Infinity only covers plain arrow)
  const P = player();
  const infBow = Iv.stack('bow', 1, 0, { Enchantments: [{ id: 'minecraft:infinity', lvl: 1 }] });
  Iv.setItem(P.inventory, P.slot, infBow);
  Iv.setItem(P.inventory, 5, Iv.stack('tipped_arrow', 1, 0, { Potion: 'minecraft:poison' }));
  Use.bowStart(P, infBow);
  P.useTicks = 20;
  Use.bowRelease(P);
  ok(Iv.getItem(P.inventory, 5) === null, 'Infinity does NOT cover a tipped arrow: it is still consumed');
}
{
  // creative firing a spectral arrow: creative-only pickup, per BowItem's own second OR-branch
  const P = player({ instabuild: true });
  const st = bow();
  Iv.setItem(P.inventory, P.slot, st);
  Iv.setItem(P.inventory, 5, Iv.stack('spectral_arrow', 1));
  Use.bowStart(P, st);
  P.useTicks = 20;
  Use.bowRelease(P);
  const a = EL.list[EL.list.length - 1];
  ok(a.pickupType === 'creative_only', 'creative firing a spectral arrow is also creative-only pickup');
  ok(Iv.getItem(P.inventory, P.slot).d === 0, 'creative never spends bow durability');
}

// ═══════════ 8. anti-vacuity ════════════════════════════════════════════════════════════════
// ═══════════ 6b. Piercing II — PersistentProjectileEntity.onEntityHit piercedEntities ═════════
console.log('\n6b. piercing — level+1 entities hit, then discarded; none twice');
function pierceRun(clear) {
  const P = player();
  const ms = [0, 1, 2, 3].map(i => { const m = mob(20 + i * 2, 40); m.y = 64; return m; });
  const a = EL.spawn('arrow', 18, 64, 40);
  a.shooter = P; a.pierceLevel = 2; a.vx = 1; a.vy = 0; a.vz = 0; a.drag = 1; a.gravity = 0;
  const hits = ms.map(() => 0), hp = ms.map(m => m.health);
  for (let k = 0; k < 14; k++) {
    if (a.removed) break;
    if (clear) a.piercedEntities = [];
    Cb.tickArrow(a);
    ms.forEach((m, i) => { if (m.health < hp[i]) { hits[i]++; hp[i] = m.health; m.invulnerableTicks = 0; m.hurtTime = 0; if (m.iframes !== undefined) m.iframes = 0; } });
  }
  return { hits, removed: !!a.removed };
}
{
  const r = pierceRun(false);
  ok(r.hits[0] === 1 && r.hits[1] === 1 && r.hits[2] === 1, 'first three zombies each hit exactly once: ' + r.hits);
  ok(r.hits[3] === 0, 'the 4th is not hit');
  ok(r.removed, 'the arrow is removed after the 3rd');
  const c = pierceRun(true);
  okAv(!(c.hits[0] === 1 && c.hits[1] === 1 && c.hits[2] === 1 && c.hits[3] === 0 && c.removed), 'a cleared pierce set changes the outcome (check is load-bearing)');
}

console.log('\n8. anti-vacuity — mutate the pull formula and the crit threshold, must fail loud');
{
  const savedFn = Use.bowPullProgress;
  Use.bowPullProgress = function () { return 1; };   // every draw is instantly full pull
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 3));
  Use.bowStart(P, bow());
  P.useTicks = 1;                                     // §4's own "should not fire" tick count
  const fired = Use.bowRelease(P);
  okAv(fired === true, 'a mutated pull-progress that always returns 1.0 makes a 1-tick hold fire, which §4’s own real-formula assertion would have caught');
  Use.bowPullProgress = savedFn;
}
{
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow());
  Iv.setItem(P.inventory, 5, Iv.stack('arrow', 3));
  Use.bowStart(P, bow());
  P.useTicks = 19;               // pull just under 1.0 — must NOT be critical
  Use.bowRelease(P);
  const a = EL.list[EL.list.length - 1];
  okAv(a.critical !== true, `a 19-tick draw (pull < 1.0) must not set critical — got ${a.critical}, proving §5’s own pull===1 assertion is load-bearing`);
}

Math.random = REAL_RANDOM;
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity, ${breaks} breaks caught)`);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
