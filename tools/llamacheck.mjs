#!/usr/bin/env node
// llamacheck.mjs — loop/llama-s97 (QUEUE 0.2 G18e remainder close): LLAMA.
//
//   node tools/llamacheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, ON TOP OF mountcheck.mjs/donkeycheck.mjs (which already prove the SHARED
// horse-family machinery: feed/temper shape, mounting, the chest attach/resize mechanism, the
// breeding pipeline). This file proves the parts that are genuinely llama-shaped: strength/
// variant rolling on spawn (LlamaEntity.initialize/initializeStrength, .decomp), the flat
// jump/speed + rolled-health attribute branch it shares with donkey/mule, canBeSaddled always
// false (so it never reaches Mount.travelRidden's steering branch), the chest sized off
// STRENGTH rather than donkey/mule's flat 5 columns, the carpet decoration slot (the "armour"
// slot repurposed), its own two-item food/temper table (Mount.LLAMA_FOOD, maxTemper 30),
// Breed.CHILD.llama (strength/variant child roll), the spit projectile (Llama.spit/tick), and
// the placement-tier goal selector (Ai.ROSTER.llama) including SpitRevengeGoal/ChaseWolvesGoal/
// FormCaravanGoal.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('llamacheck — loop/llama-s97, llama strength/variant/chest/carpet/food/breed/spit/goals');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07r_mount.js', '07zx_particle.js', '07z_potion.js', '07ze_llama.js', '14f_inventory.js', '14g_menu.js',
          '14l_use.js', '14j_combat.js', '14d_survival.js', '14_player.js', '15b_gui.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Breed.init();
M.Tame.init();
M.Mount.init();
M.Combat.init();

const Mnt = M.Mount, Br = M.Breed, EL = M.EntityList, Ai = M.Ai, Ll = M.Llama;
ok(Mnt.ready && Br.ready, 'Mount/Breed both report ready');
ok(!!Ll, 'NS.Llama exists (07ze_llama.js loaded)');

M.World.init(1);
const PLAT_Y = 63;
// wide enough for every position this file spawns a llama at (the §10 caravan chain reaches x=90)
for (let cx = -3; cx <= 7; cx++) for (let cz = -3; cz <= 3; cz++) {
  const c = M.World.makeChunk(cx, cz);
  c.state = M.CH.GENERATED;
  M.World.chunks.set(M.World.key(cx, cz), c);
}
const STONE = M.States.stateOf('stone') | 0;
for (let x = -48; x <= 120; x++) for (let z = -32; z <= 32; z++) M.World.setBlock(x, PLAT_Y, z, STONE);

function mkLlama(x, z) { return EL.spawn('llama', x === undefined ? 0 : x, PLAT_Y + 1, z === undefined ? 0 : z); }
function mkHorse(x, z) { return EL.spawn('horse', x === undefined ? 0 : x, PLAT_Y + 1, z === undefined ? 0 : z); }

// ── §1. MOUNTABLE/CHESTABLE/ROSTER ──────────────────────────────────────────────────────
say('\n§1 — llama is MOUNTABLE/CHESTABLE, and Ai.ROSTER has its own placement tier');
{
  ok(Mnt.MOUNTABLE.llama === true, 'llama is MOUNTABLE (taming/mounting)');
  ok(Mnt.CHESTABLE.llama === true, 'llama is CHESTABLE too');
  ok(typeof Ai.ROSTER.llama === 'function', 'Ai.ROSTER has a llama placement tier');
  const l = mkLlama(), h = mkHorse(0, 10);
  ok(!!l.ai && l.ai.entries.length > 0, 'a spawned llama gets a real, non-empty e.ai goal selector');
  ok(l.ai.entries.length > h.ai.entries.length, 'llama\'s own goal list is LONGER than horse\'s (FormCaravanGoal/ProjectileAttackGoal/PanicGoal are all extra slots horse\'s roster does not carry)');
}

// ── §2. EL.spawn resolves llama, and rolls strength/variant on spawn ────────────────────
say('\n§2 — EL.spawn resolves llama (motion/dims/attrs), and rolls strength (1..5)/variant (0..3)');
{
  const l = mkLlama();
  ok(!!l, 'EL.spawn(\'llama\', ...) returns a real entity');
  ok(l.width > 0 && l.height > 0, 'real dimensions off Entities.dimensions');
  ok(typeof l.maxHealth === 'number' && l.maxHealth > 0, 'real health off Entities.attrsOf');
  ok(l.strength >= 1 && l.strength <= 5, `strength rolled into [1,5] on spawn (got ${l.strength})`);
  ok(l.variant >= 0 && l.variant <= 3, `variant rolled into [0,3] on spawn (got ${l.variant})`);
  okAv(EL.spawn('this_type_does_not_exist', 0, 0, 0) === null, 'anti-vacuity: an unknown type still refuses');

  const seqLow = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  ok(Mnt.rollStrength(seqLow([0.5, 0.9])) <= 3, 'rollStrength: a >=0.04 first draw caps the range at 1..3 (n=3 branch)');
  ok(Mnt.rollStrength(seqLow([0.01, 0.99])) === 5, 'rollStrength: a <0.04 first draw opens 1..5, and nextInt(5) at its own top (0.99) lands on 5');
  ok(Mnt.rollLlamaVariant(seqLow([0.99])) === 3, 'rollLlamaVariant: Math.floor(0.99*4) === 3, the top of the 0..3 range');
  okAv(Mnt.rollLlamaVariant(seqLow([0])) === 0, 'anti-vacuity: the bottom of the rand range gives 0, not the same 3 every time');
}

// ── §3. attribute roll: health rolled, jump/speed FLAT (shared donkey/mule branch) ──────
say('\n§3 — Mount.rollAttributes: llama rolls ONLY health, jump/speed stay AbstractDonkeyEntity\'s flat literals');
{
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const l1 = { type: 'llama' }; Mnt.rollAttributes(l1, seq([0.1, 0.2, 0.3]));
  const l2 = { type: 'llama' }; Mnt.rollAttributes(l2, seq([0.9, 0.8, 0.7]));
  ok(l1.jumpStrengthAttr === 0.5 && l2.jumpStrengthAttr === 0.5, 'jumpStrengthAttr is always the flat 0.5 (llama never overrides initAttributes, shares AbstractDonkeyEntity\'s)');
  ok(l1.movementSpeedAttr === 0.175 && l2.movementSpeedAttr === 0.175, 'movementSpeedAttr is always the flat 0.175 too');
  okAv(l1.maxHealthAttr !== l2.maxHealthAttr, 'anti-vacuity: health DOES still move with the rand sequence');

  ok(Mnt.maxTemperOf({ type: 'llama' }) === 30, 'Mount.maxTemperOf(llama) is 30 (LlamaEntity.getMaxTemper override)');
  ok(Mnt.maxTemperOf({ type: 'horse' }) === 100, 'and stays the shared 100 for horse');
  const lt = mkLlama(); lt.temper = 25;
  Mnt.addTemper(lt, 20);
  ok(lt.temper === 30, `Mount.addTemper clamps at the LLAMA max (30), not the shared 100 (got ${lt.temper})`);
}

// ── §4. taming: mountable, but NEVER saddleable — canBeSaddled always false ─────────────
say('\n§4 — Mount.interact: a llama can be mounted (tamed via bucking) but never saddled/steered');
{
  const l = mkLlama(); l.tamed = false;
  ok(Mnt.interact(l, '', {}).mounted === true, 'an empty-hand right-click still mounts an untamed llama (bucking-taming path)');

  const l2 = mkLlama(); l2.tamed = true;
  ok(Mnt.canBeSaddled(l2) === false, 'Mount.canBeSaddled is ALWAYS false for a llama, even tamed (LlamaEntity.canBeSaddled override)');
  const sad = Mnt.trySaddleItem(l2);
  ok(sad === null, 'Mount.trySaddleItem refuses a llama outright (canBeSaddled gates it)');
  ok(l2.saddled !== true, 'and it never becomes saddled');
  okAv(Mnt.canBeSaddled(mkHorse(5, 5)) === false, 'anti-vacuity: an UNTAMED horse also refuses (proves canBeSaddled checks more than just species)');
  const th = mkHorse(6, 5); th.tamed = true;
  okAv(Mnt.canBeSaddled(th) === true, 'anti-vacuity: a TAME horse DOES pass canBeSaddled — llama\'s false is species-specific, not a broken gate');

  ok(!(Mnt.isRidden(l2) && Mnt.isSaddled(l2)), 'a mounted llama never satisfies the ridden+saddled gate travelRidden is called behind');
}

// ── §5. the chest: sized off STRENGTH, not donkey/mule's flat 5 columns ─────────────────
say('\n§5 — the chest: Mount.inventoryColumns(llama) == getStrength(), Mount.menu sizes 2+3*columns');
{
  const l3 = mkLlama(); Mnt.setStrength(l3, 3);
  ok(Mnt.inventoryColumns(l3) === 3, 'Mount.inventoryColumns reads getStrength() for a llama');
  const untamed = mkLlama(); untamed.tamed = false;
  const r0 = Mnt.interact(untamed, 'chest', {});
  ok(!untamed.hasChest, 'an UNTAMED llama refuses a chest, same AbstractDonkeyEntity.interactMob gate donkey/mule share');
  ok(r0 && r0.consumed === false, 'and does not consume the chest item');

  const l4 = mkLlama(); l4.tamed = true; Mnt.setStrength(l4, 3);
  const r1 = Mnt.interact(l4, 'chest', {});
  ok(r1 && r1.consumed === true && l4.hasChest === true, 'a tame, chestless, strength-3 llama accepts a chest');

  const Inv = M.Inventory, inventory = Inv.create();
  const m3 = Mnt.menu(l4, inventory);
  ok(m3.slots.length === (2 + 3 * 3) + 27 + 9, `a strength-3 llama's chest menu has 11 mount slots (2+3*3), not donkey/mule's 17 (got ${m3.slots.length - 36})`);

  const l5 = mkLlama(); l5.tamed = true; Mnt.setStrength(l5, 5); l5.hasChest = true;
  const m5 = Mnt.menu(l5, inventory);
  ok(m5.slots.length === (2 + 3 * 5) + 27 + 9, 'a strength-5 llama matches donkey/mule\'s own 17-slot size exactly (2+3*5==17, same formula, different input)');
  okAv(m3.slots.length !== m5.slots.length, 'anti-vacuity: the two llamas really do get different-sized menus off their own strength, not one fixed count');

  const drops = Mnt.dropInventory(l4);
  ok(drops.length === 1 && drops[0].item === 'chest', 'Mount.dropInventory still reports one chest item regardless of column count (same donkey/mule mechanism, e.hasChest alone)');
}

// ── §6. the carpet decoration slot ───────────────────────────────────────────────────────
say('\n§6 — the carpet slot: Mount.hasDecorSlot/isCarpetItem/carpetColorIndex, and Mount.menu\'s slot 1');
{
  ok(Mnt.hasDecorSlot(mkLlama()) === true, 'Mount.hasDecorSlot is true for a llama');
  ok(Mnt.hasDecorSlot(mkHorse(7, 5)) === false, 'and false for a horse (that\'s the ARMOUR slot instead, Mount.hasArmorSlot)');
  ok(Mnt.isCarpetItem('red_carpet') === true, 'red_carpet is recognised as a carpet item');
  ok(Mnt.isCarpetItem('moss_carpet') === false, 'moss_carpet is NOT — it is not a DyedCarpetBlock at all (.decomp getColorFromCarpet)');
  ok(Mnt.isCarpetItem('red_wool') === false, 'an unrelated item is not a carpet either');
  ok(Mnt.carpetColorIndex('white_carpet') === 0 && Mnt.carpetColorIndex('black_carpet') === 15, 'carpetColorIndex reads the real 0..15 DyeColor ordinal off Tame.DYES');

  const l6 = mkLlama(); l6.tamed = true;
  const tryCarpet = Mnt.interact(l6, 'lime_carpet', {});
  ok(tryCarpet && tryCarpet.opened === true, 'holding a carpet on a tame llama opens the screen (real equip happens in Mount.menu\'s slot 1, same "no direct equip" shape horse armour uses)');
  const untamedL = mkLlama(); untamedL.tamed = false;
  const tryCarpet2 = Mnt.interact(untamedL, 'lime_carpet', {});
  ok(!(tryCarpet2 && tryCarpet2.opened === true), 'an UNTAMED llama refuses the same carpet instead of opening anything');

  const Inv = M.Inventory, inventory = Inv.create();
  const l7 = mkLlama(); l7.tamed = true;
  const m7 = Mnt.menu(l7, inventory);
  const carpetStack = Inv.stack('cyan_carpet', 1);
  ok(M.Menu.slotMayPlace(m7.slots[1], carpetStack) === true, 'slot 1\'s own mayPlace accepts a real carpet stack for a llama');
  M.Menu.slotSet(m7.slots[1], carpetStack);
  ok(l7.carpetColor === 9, `equipping cyan_carpet sets e.carpetColor to DyeColor CYAN's own ordinal (9), got ${l7.carpetColor}`);
  M.Menu.slotSet(m7.slots[1], null);
  ok(l7.carpetColor === null, 'and removing it clears e.carpetColor back to null');

  const h8 = mkHorse(8, 5); h8.tamed = true;
  const m8 = Mnt.menu(h8, inventory);
  ok(M.Menu.slotMayPlace(m8.slots[1], carpetStack) === false, 'the SAME carpet stack is REFUSED by a horse\'s own slot 1 mayPlace (that slot wants horse armour, not a carpet — the two predicates are mutually exclusive)');
}

// ── §7. llama's own food/temper table, DIFFERENT numbers from horse's shared one ────────
say('\n§7 — Mount.LLAMA_FOOD: wheat/hay_block only, its own heal/grow/temper numbers');
{
  ok(Mnt.foodTable(mkLlama()) === Mnt.LLAMA_FOOD, 'Mount.foodTable picks LLAMA_FOOD for a llama');
  ok(Mnt.foodTable(mkHorse(9, 5)) === Mnt.FOOD, 'and the shared FOOD table for a horse');
  ok(Mnt.LLAMA_FOOD.wheat.grow === 10 && Mnt.FOOD.wheat.grow === 20, 'llama\'s own wheat.grow (10) differs from horse\'s shared wheat.grow (20) — a real, separate table, not an alias');
  ok(Mnt.LLAMA_FOOD.hay_block.love === true, 'llama\'s hay_block is a LOVE item (breeding), unlike horse\'s own hay_block');
  ok(Mnt.LLAMA_FOOD.sugar === undefined, 'sugar is not in llama\'s own food table at all (LlamaEntity.receiveFood recognises only two items)');

  const l9 = mkLlama(); l9.health = 5; l9.maxHealth = 20; l9.tamed = true;
  const fed = Mnt.feed(l9, 'wheat', {});
  ok(fed && fed.consumed === true && l9.health === 7, `feeding wheat heals llama's own 2 HP (got ${l9.health})`);
  const sugarTry = Mnt.feed(l9, 'sugar', {});
  ok(sugarTry === null, 'feeding sugar does nothing at all for a llama (not in Mount.LLAMA_FOOD)');
}

// ── §8. Breed.CHILD.llama: strength/variant child roll, and canBreed flips true ─────────
say('\n§8 — Breed.CHILD.llama: getBreedOffspring\'s strength/variant roll, off LlamaEntity.method_6804');
{
  ok(Br.canBreed('llama') === true, 'Breed.canBreed(\'llama\') is now true (Breed.SPECIAL.llama removed)');
  ok(!Br.SPECIAL.llama, 'and Breed.SPECIAL itself no longer lists llama');
  // loop/wtrader-s103 -- trader_llama LEFT Breed.SPECIAL this session: it has a real
  // wandering-trader escort/spawn substrate now (07zt_wtrader.js), so LlamaEntity's own
  // species-agnostic canBreedWith (.decomp) is no longer refused around.
  ok(!Br.SPECIAL.trader_llama, 'trader_llama LEFT Breed.SPECIAL (loop/wtrader-s103 -- a real escort/spawn substrate exists now)');
  ok(Br.canBreed('trader_llama') === true, "Breed.canBreed('trader_llama') is now true too");

  const a = mkLlama(20, 30); a.tamed = true; a.growAge = 0; Mnt.setStrength(a, 2); a.variant = 0; Br.setInLove(a, null);
  const b = mkLlama(20.1, 30); b.tamed = true; b.growAge = 0; Mnt.setStrength(b, 4); b.variant = 1; Br.setInLove(b, null);
  ok(Br.canMate(a, b) === true, 'two tame, in-love llamas may mate (same-type path, no MATE override needed)');
  const child = Br.breed(a, b, { random: Math.random });
  ok(!!child && child.type === 'llama', 'Breed.breed spawns a real llama child');
  ok(Br.isBaby(child), 'and it is born a baby');
  ok(child.strength >= 1 && child.strength <= 5, `child strength stays inside [1,5] (rollChildStrength's own +1 cap risk), got ${child.strength}`);
  ok(child.variant === 0 || child.variant === 1, `child variant is ONE of the two parents' own (coin flip, no fresh roll), got ${child.variant}`);
  ok(child.maxHealthAttr > 0, 'the child also carries averaged attributes (Mount.setChildAttributes, shared machinery)');

  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const p1 = { strength: 2 }, p2 = { strength: 5 };
  ok(Mnt.rollChildStrength(p1, p2, seq([0.99, 0.5])) === 5, 'rollChildStrength: floor(0.99*max(2,5))+1 == 5, no bonus (second roll 0.5 >= 0.03)');
  ok(Mnt.rollChildStrength(p1, p2, seq([0, 0.01])) === 2, 'rollChildStrength: floor(0*5)+1 == 1, PLUS the 3% bonus (second roll 0.01 < 0.03) == 2');
  okAv(Mnt.rollChildStrength(p1, p2, seq([0, 0.99])) === 1, 'anti-vacuity: the SAME base roll withOUT the bonus roll firing gives 1, not always the +1 result');
  ok(Mnt.rollChildLlamaVariant(a, b, seq([0.4])) === a.variant, 'rollChildLlamaVariant: rand<0.5 picks parent A\'s own variant');
  ok(Mnt.rollChildLlamaVariant(a, b, seq([0.6])) === b.variant, 'and rand>=0.5 picks parent B\'s');
}

// ── §9. the spit projectile: kinematics and the per-tick hit/discard consequence ────────
say('\n§9 — Llama.spit/spitVelocity/tick: a real llama_spit entity, aimed, that hits and discards');
{
  const shooter = mkLlama(0, 0); shooter.yaw = 0;
  const target = { id: 999, type: 'wolf', x: 5, y: PLAT_Y + 1, z: 0, width: 0.6, height: 0.85, maxHealth: 8, health: 8, vx: 0, vy: 0, vz: 0 };
  EL.list.push(target);
  const v = Ll.spitVelocity(shooter, target, () => 0.25);   // gaussian(0.25,0.25) = 0: no jitter
  ok(v.vx > 0, `spitVelocity aims toward the target (target is +x of the shooter), vx=${v.vx.toFixed(3)}`);
  const speed = Math.hypot(v.vx, v.vy, v.vz);
  ok(Math.abs(speed - Ll.SPIT_POWER) < 1e-9, `the resulting velocity's own magnitude is exactly SPIT_POWER (1.5), got ${speed}`);

  // #677: jitter across N shots + a spit sound event + 7 spit particles
  {
    const seen = new Set();
    for (let i = 0; i < 20; i++) { const w = Ll.spitVelocity(shooter, target); seen.add(w.vy.toFixed(6)); }
    ok(seen.size > 10, `spitVelocity jitters across shots (Gaussian 10.0 spread): ${seen.size}/20 distinct vy`);
    let calls = [];
    const NSx = M;
    if (!NSx.Sound) NSx.Sound = {};
    const Snd = NSx.Sound; const old = Snd && Snd.entitySound;
    if (Snd) Snd.entitySound = (ev, ...a) => { calls.push(ev); return true; };
    const nPart0 = NSx.Particle.list.length;
    Ll.spit(shooter, target);
    ok(calls.includes('entity.llama.spit'), 'Ll.spit plays entity.llama.spit');
    ok(NSx.Particle.list.filter(p => p.type === 'spit').length >= 7 && NSx.Particle.list.length - nPart0 >= 7, 'Ll.spit spawns 7 spit particles');
    calls = []; shooter.silent = true; Ll.spit(shooter, target); shooter.silent = false;
    okAv(!calls.includes('entity.llama.spit'), 'anti-vacuity: a silent llama plays no spit sound');
    if (Snd) Snd.entitySound = old;
  }
  const proj = Ll.spit(shooter, target);
  ok(!!proj && proj.type === 'llama_spit', 'Llama.spit spawns a real llama_spit entity via EL.spawn');
  ok(shooter.spit === true, 'and flags e.spit = true on the shooter (SpitRevengeGoal reads this to drop its target)');
  okAv(Ll.spit(shooter, null) === null, 'anti-vacuity: Llama.spit refuses with no target instead of spawning garbage');

  const spitOnTarget = EL.spawn('llama_spit', target.x, target.y, target.z, { shooter, vx: 0, vy: 0, vz: 0 });
  const before = target.health;
  target.vx = 0; target.vz = 0;
  Ll.tick(spitOnTarget);
  ok(Math.hypot(target.vx, target.vz) > 0, 'a spit hit knocks the mob back (projectile src with the shooter as attacker, #2558)');
  ok(target.health < before, `Ll.tick actually damages a mob it overlaps (health ${before} -> ${target.health})`);
  ok(spitOnTarget.removed !== true, 'and is NOT discarded by an entity hit (#2749: vanilla onEntityHit never discards)');

  {
    // #4598: ProjectileEntity.canHit - the owner is immune until leftOwner flips, then a hit lands
    const sh = mkLlama(40, 40);
    const own = (lo) => { const sp = EL.spawn('llama_spit', sh.x, sh.y + 0.5, sh.z, { shooter: sh, vx: 0, vy: 0, vz: 0 }); if (lo) sp.leftOwner = true; const h = sh.health; Ll.tick(sp); return h - sh.health; };
    ok(own(false) === 0, 'a spit still inside its owner\'s expanded box does not hurt the owner');
    ok(own(true) > 0, 'a spit that has leftOwner hurts its owner (#4598)');
    const fall = EL.spawn('llama_spit', shooter.x + 5, shooter.y + 0.5, shooter.z, { shooter, vx: 0, vy: 0, vz: 0 }); Ll.tick(fall);
    okAv(fall.leftOwner === true, 'anti-vacuity: leftOwner flips once the owner is outside bbox.expand(1)');
  }

  {
    const far = EL.spawn('cow', target.x + 8, target.y, target.z, {});
    const near = EL.spawn('cow', target.x + 6, target.y, target.z, {});
    const fh = far.health, nh = near.health;
    const sp = EL.spawn('llama_spit', target.x + 10, target.y + 0.1, target.z, { shooter, vx: 0, vy: 0, vz: 0 });
    sp.spitPrevX = target.x + 4; sp.spitPrevY = target.y + 0.1; sp.spitPrevZ = target.z;
    Ll.tick(sp);
    ok(near.health < nh && far.health === fh, `${nh}>${near.health} ${fh}>${far.health} two mobs on one ray: the NEARER along the path takes the spit, not the first in list order (#4110)`);
    far.removed = true; near.removed = true;
  }
  const spitInGround = EL.spawn('llama_spit', 0, PLAT_Y, 0, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(spitInGround);
  ok(spitInGround.removed === true, 'Ll.tick discards a spit embedded in a solid block (Physics.solidAt)');

  const spitInAir = EL.spawn('llama_spit', 0, PLAT_Y + 20, 0, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(spitInAir);
  okAv(spitInAir.removed !== true, 'anti-vacuity: a spit in open air with nothing to hit survives the tick — proves the two removals above are conditional, not Ll.tick always discarding');

  // #676: vanilla's discard rules -- any non-air state in the box, water, and a swept hit
  const FLOWER = M.States.stateOf('oak_fence') | 0, WATER = M.States.stateOf('water') | 0;
  M.World.setBlock(20, PLAT_Y + 3, 0, FLOWER);
  const spitInFlower = EL.spawn('llama_spit', 20.5, PLAT_Y + 3.1, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(spitInFlower);
  ok(spitInFlower.removed === true, 'Ll.tick discards a spit whose box touches a non-solid non-air block (oak fence post gap-free non-full block)');
  M.World.setBlock(22, PLAT_Y + 3, 0, WATER);
  const spitInWater = EL.spawn('llama_spit', 22.5, PLAT_Y + 3.5, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(spitInWater);
  ok(spitInWater.removed === true, 'Ll.tick discards a spit inside water');
  // #1236: discard only when EVERY state in the box is non-air
  M.World.setBlock(24, PLAT_Y + 3, 0, STONE);
  const straddle = EL.spawn('llama_spit', 24.95, PLAT_Y + 3.5, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(straddle);
  ok(straddle.removed !== true, 'a spit straddling air + a solid block survives the tick (vanilla noneMatch(isAir))');
  M.World.setBlock(26, PLAT_Y + 3, 0, FLOWER);
  const inGrass = EL.spawn('llama_spit', 26.5, PLAT_Y + 3.1, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(inGrass);
  okAv(inGrass.removed === true, 'anti-vacuity: a box wholly inside one non-air cell is still discarded');
  M.World.setBlock(28, PLAT_Y + 3, 0, 0);
  const inAir2 = EL.spawn('llama_spit', 28.5, PLAT_Y + 3.1, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  Ll.tick(inAir2);
  okAv(inAir2.removed !== true, 'anti-vacuity: a box in an air cell survives');
  const thin = { id: 998, type: 'wolf', x: 30, y: PLAT_Y + 1, z: 0, width: 0.25, height: 0.85, maxHealth: 8, health: 8, vx: 0, vy: 0, vz: 0 };
  EL.list.push(thin);
  const fast = EL.spawn('llama_spit', 33, PLAT_Y + 1.5, 0, { shooter, vx: -1.5, vy: 0, vz: 0 });
  fast.spitPrevX = 34.5; fast.spitPrevY = PLAT_Y + 1.5; fast.spitPrevZ = 0;
  fast.x = 27.5;   // moved 34.5 -> 27.5 this tick: skips clean over x=30
  Ll.tick(fast);
  ok(thin.health < 8, 'a swept hit catches a 0.25-wide target the current point has already passed');
  // #2914: swept block raycast — a 1-thick wall between prev and current discards the spit
  M.World.setBlock(40, PLAT_Y + 1, 0, STONE);
  const wall = EL.spawn('llama_spit', 41.4, PLAT_Y + 1.5, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  wall.spitPrevX = 39.9; wall.spitPrevY = PLAT_Y + 1.5; wall.spitPrevZ = 0.5;
  Ll.tick(wall);
  ok(wall.removed === true, 'a spit stepping 39.9 -> 41.4 over a 1-block wall at x=40 is discarded (swept block raycast)');
  M.World.setBlock(40, PLAT_Y + 1, 0, 0);
  const noWall = EL.spawn('llama_spit', 41.4, PLAT_Y + 1.5, 0.5, { shooter, vx: 0, vy: 0, vz: 0 });
  noWall.spitPrevX = 39.9; noWall.spitPrevY = PLAT_Y + 1.5; noWall.spitPrevZ = 0.5;
  Ll.tick(noWall);
  okAv(noWall.removed !== true, 'anti-vacuity: the same step with no wall survives');
  const miss = EL.spawn('llama_spit', 27.5, PLAT_Y + 1.5, 5, { shooter, vx: 0, vy: 0, vz: 0 });
  miss.spitPrevX = 34.5; miss.spitPrevY = PLAT_Y + 1.5; miss.spitPrevZ = 5;
  Ll.tick(miss);
  okAv(miss.removed !== true, 'anti-vacuity: an equally fast spit passing 5 blocks wide of the target survives');
}

// ── §10. the goals: SpitRevengeGoal, ChaseWolvesGoal, FormCaravanGoal ───────────────────
say('\n§10 — Ai.SpitRevengeGoal/ChaseWolvesGoal/FormCaravanGoal, each broken and caught');
{
  const e10 = mkLlama(40, 0);
  const attacker = { id: 1001, type: 'player' };
  e10.lastHurtByEntity = attacker; e10.hurtSeq = 1;
  const rg = new Ai.SpitRevengeGoal(e10, {});
  ok(rg.canUse() === true, 'SpitRevengeGoal.canUse fires off a fresh hurtSeq, same as the base RevengeGoal');
  rg.start();
  ok(e10.target === attacker, 'and targets the actual attacker');
  ok(rg.canContinueToUse() === true, 'continues while e.spit is still false');
  e10.spit = true;
  ok(rg.canContinueToUse() === false, 'drops the target the instant e.spit flips true (LlamaEntity.SpitRevengeGoal.shouldContinue, .decomp)');
  ok(e10.spit === false, 'and clears e.spit back to false so the next hit can re-arm it');
  okAv(new Ai.SpitRevengeGoal({ hurtSeq: 0 }, {}).canUse() === false, 'anti-vacuity: no attacker at all never starts the goal');

  const e11 = mkLlama(50, 0);
  const wildWolf = { id: 1101, type: 'wolf', x: 55, y: PLAT_Y + 1, z: 0, tamed: false, dead: false, removed: false };
  const tameWolf = { id: 1102, type: 'wolf', x: 51, y: PLAT_Y + 1, z: 0, tamed: true, dead: false, removed: false };
  EL.list.push(wildWolf, tameWolf);
  // KW-44 (session 152): ChaseWolvesGoal.canUse() is now gated by ActiveTargetGoal's own
  // reciprocalChance (toGoalTicks(16) = 1/8 per tick, `.decomp` ActiveTargetGoal.canStart) --
  // a random source that always PASSES that roll (0 < 1/8) isolates the range/predicate scan
  // this sub-test is actually about, same as kw4445check.mjs's own deterministic gate proof.
  const alwaysRoll = { random: () => 0 };
  const cw = new Ai.ChaseWolvesGoal(e11, alwaysRoll);
  ok(cw.canUse() === true, 'ChaseWolvesGoal finds the wild wolf within its own 0.25x-follow-range box');
  ok(e11.target === wildWolf, 'and targets the WILD wolf specifically, never the tame one even though it is closer');
  wildWolf.removed = true; tameWolf.removed = true;   // clear the previous sub-test's wolves out of range
  const farWolf = { id: 1103, type: 'wolf', x: 5000, y: PLAT_Y + 1, z: 0, tamed: false, dead: false, removed: false };
  const e12 = mkLlama(60, 0);
  EL.list.push(farWolf);
  okAv(new Ai.ChaseWolvesGoal(e12, alwaysRoll).canUse() === false, 'a wolf far outside the 0.25x range is NOT picked up');
  // ANTI-VACUITY (KW-44): a random source that always FAILS the roll (0.5 >= 1/8) refuses even
  // the in-range wild wolf above -- proving canUse() really is gated, not the range check alone.
  wildWolf.removed = false;
  okAv(new Ai.ChaseWolvesGoal(e11, { random: () => 0.5 }).canUse() === false, 'and the SAME in-range wild wolf is refused when the reciprocalChance roll always fails');

  const leader = mkLlama(70, 0);
  const middle = mkLlama(72, 0);
  const tail = mkLlama(78, 0);
  Ll.follow(middle, leader);
  ok(Ll.canFollowChain(middle, 1) === false, 'canFollowChain refuses a chain that never reaches a LEASHED llama at all');
  leader.leashHolder = 'fencepost';
  ok(Ll.canFollowChain(middle, 1) === true, 'and accepts it the moment the chain\'s own end IS leashed');
  const fcg = new Ai.FormCaravanGoal(tail, 2.1);
  ok(fcg.canUse() === true, 'FormCaravanGoal.canStart finds "middle" (already following, not yet followed) and attaches');
  ok(tail.llamaFollowing === middle, 'tail now follows middle, the nearest eligible candidate');
  fcg.start();
  ok(fcg.canContinueToUse() === true, 'continues while the chain still resolves to a leashed llama');
  fcg.tick();
  ok(tail.zza > 0, `FormCaravanGoal.tick actually aims the llama at its leader (Ai.stepToward sets e.zza/mobSpeed, got ${tail.zza})`);
  fcg.stop();
  ok(Ll.isFollowing(tail) === false, 'FormCaravanGoal.stop() releases the follow chain (Ll.stopFollowing)');
  okAv(new Ai.FormCaravanGoal(leader, 2.1).canUse() === false, 'anti-vacuity: an ALREADY-leashed llama never starts a new caravan of its own');

  let ring = mkLlama(80, 0);
  for (let i = 0; i < 10; i++) {
    const next = mkLlama(80 + i + 1, 0);
    Ll.follow(next, ring);
    ring = next;
  }
  okAv(Ll.canFollowChain(ring, 1) === false, 'anti-vacuity: a chain that never reaches a leash at all refuses even past the depth cap, not by accident passing');

  // #1235: the follower stops ~2 blocks behind a still leader (startMovingTo self+vec*(d-2)), and a knot holder does not move it
  const runGap = (holder) => {
    const A = mkLlama(-30, 0), B = mkLlama(-20, 0);
    A.noAi = true;
    Ll.follow(B, A);
    if (holder) B.leashHolder = holder;
    const g = new Ai.FormCaravanGoal(B, 2.1);
    g.start();
    B.ai = { tick: () => g.tick() };   // only this goal steers B (tickMob zeroes zza before the selector runs)
    for (let t = 0; t < 200; t++) { EL.tickOne(B); if (VERBOSE && t % 20 === 0) say(t, B.x.toFixed(2), B.z.toFixed(2), B.zza); }
    return Math.hypot(B.x - A.x, B.z - A.z);
  };
  const gapD = runGap(null);
  ok(gapD > 1.3 && gapD < 3.2, `FormCaravanGoal.tick keeps the follower ~2 blocks behind a still leader (final ${gapD.toFixed(2)})`);
  const knotD = runGap({ kind: 'knot', knot: {} });
  okAv(knotD > 9, `anti-vacuity: a LeashKnot holder exempts the follower from tick movement (final ${knotD.toFixed(2)})`);
}

// ── §S. #680 llama sounds: every LlamaEntity event emits its own name ─────────────────────
say('\n§S — llama sounds (ambient/angry/hurt/death/eat/step 0.15/spit/chest/swag)');
{
  const log = [];
  const realPlay = M.Sound && M.Sound.play;
  M.Sound = M.Sound || {};
  M.Sound.play = (ev, o) => { log.push({ ev, o }); };
  const evs = () => log.map(l => l.ev);
  const clear = () => { log.length = 0; };

  const a = mkLlama(); a.ticksAlive = 100; a.ambientChance = 100000;
  Ll.tickSounds(a);
  ok(evs().includes('entity.llama.ambient'), 'ambient roll emits entity.llama.ambient');
  clear(); const b = mkLlama(); b.silent = true; b.ticksAlive = 100; b.ambientChance = 100000; Ll.tickSounds(b);
  okAv(evs().length === 0, 'anti-vacuity: a silent llama emits nothing');

  clear(); const c = mkLlama(); Ai.stepToward; Ll.tickSounds(c); c.onGround = true; c.x += 5; Ll.tickSounds(c);
  const st = log.filter(l => l.ev === 'entity.llama.step');
  ok(st.length === 0, 'Ll.tickSounds emits no step: EL.tickStep is the single, gated owner (#4483)');

  clear(); const d = mkLlama(); d.tamed = false; Mnt.playAngrySound(d);
  ok(evs().includes('entity.llama.angry'), 'playAngrySound emits entity.llama.angry');
  clear(); Mnt.playAngrySound(d);
  okAv(evs().length === 0, 'anti-vacuity: an already-angry llama does not re-emit');

  clear(); const f = mkLlama(); f.tamed = false; Mnt.feed(f, 'hay_block', {});
  ok(evs().includes('entity.llama.eat'), 'feeding hay emits entity.llama.eat');

  clear(); const g = mkLlama(); g.tamed = true; Mnt.interact(g, 'chest', {});
  ok(evs().includes('entity.llama.chest'), 'adding a chest emits entity.llama.chest');

  clear(); const h = mkLlama(); h.ticksAlive = 100; h.carpetColor = null; h.carpetColor = 3; Ll.onCarpetChanged(h, null);
  const sw = log.find(l => l.ev === 'entity.llama.swag');
  ok(sw && sw.o.volume === 0.5, 'a new carpet colour emits entity.llama.swag at 0.5');
  clear(); h.ticksAlive = 5; Ll.onCarpetChanged(h, null);
  okAv(evs().length === 0, 'anti-vacuity: swag stays silent while age <= 20');
  clear(); h.ticksAlive = 100; Ll.onCarpetChanged(h, 3);
  okAv(evs().length === 0, 'anti-vacuity: swag stays silent when the colour did not change');

  clear(); const i = mkLlama(); i.health = 20; i.maxHealth = 22;
  M.Combat.hurt(i, 1, undefined, false);
  ok(evs().includes('entity.llama.hurt'), 'a non-lethal hit emits entity.llama.hurt');
  ok(log.find(l => l.ev === 'entity.llama.hurt').o.volume === 0.8, 'hurt plays at getSoundVolume 0.8 (#1867)');
  clear(); i.invulnerableTime = 0; M.Combat.hurt(i, 1000, undefined, false);   // fresh: death sound is gated on the fresh hit (LivingEntity.damage $$6)
  ok(evs().includes('entity.llama.death') && !evs().includes('entity.llama.hurt'), 'a lethal hit emits entity.llama.death, not hurt');
  ok(log.find(l => l.ev === 'entity.llama.death').o.volume === 0.8, 'death plays at 0.8 (#1867)');
  clear(); Ll.playAmbient(mkLlama()); Ll.playAngry(mkLlama());
  ok(log.length === 2 && log.every(l => l.o.volume === 0.8), 'ambient and angry play at 0.8 (#1867)');
  clear(); Ll.playAmbient(mkLlama()); okAv(log[0].o.volume !== 1, 'anti-vacuity: ambient is no longer volume 1');

  clear(); const j = mkLlama(); const t = mkHorse(5, 0);
  const realES = M.Sound.entitySound; M.Sound.entitySound = (ev) => { log.push({ ev, o: {} }); };
  Ll.spit(j, t); if (realES) M.Sound.entitySound = realES; else delete M.Sound.entitySound;
  ok(evs().includes('entity.llama.spit'), 'spitting emits entity.llama.spit');

  clear(); const k = EL.spawn('cow', 0, PLAT_Y + 1, 0); M.Combat.hurt(k, 1, undefined, false);
  okAv(!evs().some(e => e.startsWith('entity.llama')), 'anti-vacuity: a cow never emits a llama sound');
  if (realPlay) M.Sound.play = realPlay;
}

{ // #2746 spit origin: HorseBaseEntity eye = height*0.95, spawn = eyeY - 0.1
  const sp = Ll.spitSpawnPos({ x: 0, y: 0, z: 0, yaw: 0, width: 0.9, height: 1.87, type: 'llama' });
  ok(Math.abs(sp.y - (1.87 * 0.95 - 0.1)) < 1e-3, 'spit spawns at height*0.95 - 0.1 (got ' + sp.y + ')');
  okAv(Math.abs(sp.y - (1.87 * 0.85 - 0.1)) > 0.1, 'anti-vacuity: the old 0.85 eye is distinguishable');
}

{ // #3792 LlamaEntity.walkToParent: no-op while following a caravan leader
  const mk = (x) => ({ type: 'llama', x, y: 64, z: 0, bred: true, growAge: -100, removed: false, dead: false });
  const run = (baby) => {
    const par = mk(10), saved = [EL.list, Ai.findPath, Ai.stepToward]; let steps = 0;
    EL.list = [baby, par]; Ai.findPath = () => [0, 1]; Ai.stepToward = () => { steps++; };
    try { Mnt.walkToParent(baby); } finally { [EL.list, Ai.findPath, Ai.stepToward] = saved; }
    return steps;
  };
  const free = mk(0), fol = mk(0); fol.llamaFollowing = mk(5);
  okAv(run(free) === 1, 'free baby llama walks to parent (sanity)');
  okAv(run(fol) === 0, 'following baby llama does NOT walk to parent');
}

console.log(`\n${pass} assertions passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('llamacheck: PASS');
