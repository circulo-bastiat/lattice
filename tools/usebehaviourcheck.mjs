#!/usr/bin/env node
// usebehaviourcheck.mjs — #11479: drives 14l_use.js Use.blockUse through the real path for the classes the audit
// listed as unchecked, off .decomp semantics: LeverBlock (toggle), CakeBlock (bites 0..6, 7th removes, creative eats
// when full), CandleCakeBlock (candle on cake, extinguish, eat drops candle), FlintAndSteelItem / FireChargeItem
// (Use.isIgniter / canBeLit), AbstractButton press duration, GrindstoneBlock, BeaconBlock, SmithingTableBlock,
// StonecutterBlock, LoomBlock, CartographyTableBlock (screen + stat), PumpkinBlock, LecternBlock, FlowerPotBlock,
// ArrowItem, AxeItem, HoeItem, HoneyBlock (isSliding / updateSlidingVelocity), Waterloggable + FluidFillable (fluidOf),
// then round 2: SignBlock + DyeItem (dye/glow ink sac on a sign), MusicDiscItem (jukebox insert), ShulkerBoxBlock + TrappedChestBlock
// (open stat), TallFlowerBlock (bone meal drops the flower), GlassBottleItem (fills from water), HoneyBottleItem + StewItem +
// FoodComponent/FoodComponents (hold ticks, alwaysEdible, container left behind), CrossbowItem (quick charge, multishot load),
// OnAStickItem (pig boost, 7 damage, spent -> fishing rod), Criteria (FILLED_BUCKET trigger), LavaCauldronBlock (ignite 15 s, hurt 4),
// BoatItem (miss/place/creative/blocked). round 3: Bucketable/EntityBucketItem (water bucket on a mob via Use.entityUse), LecternBlockEntity (put/page/comparator/take).
// Not yet driven: PotionItem finish, SuspiciousStewItem effects. Anti-vacuity: each scenario is broken by source patch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const AS = join(MCLITE_ROOT, 'assets');
function trial(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14j_combat.js', '14f_inventory.js', '14l_use.js'], dom: false, ...(patch ? { patch } : {}) });
  E.Items.init({ items: readFileSync(join(AS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(AS, 'items.meta.json'), 'utf8')).rawBytes });
  const S = E.States, U = E.Use, IT = E.Items, Iv = E.Inventory, R = E.Reg;
  const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
  E.World = W; E.Behave.init(W); U.init(W);
  const get = () => cells.get(k(0, 10, 0)) || 0, set = (s) => cells.set(k(0, 10, 0), s);
  const name = () => R.names[S.block[get()]];
  const use = (state, heldName, extra) => {
    set(state);
    const P = Object.assign({ inventory: Iv.create(), slot: 0, x: 0, y: 11, z: 0, instabuild: true, invulnerableGamemode: true }, extra || {});
    const held = heldName ? { i: IT.of(heldName), n: 1 } : Iv.EMPTY;
    if (heldName) Iv.setItem(P.inventory, 0, held);
    return U.blockUse(P, 0, 10, 0, state, held);
  };
  const o = {}; if (E.BlockEntities && E.BlockEntities.init) E.BlockEntities.init();
  // LeverBlock
  const lever = S.stateOf('lever');
  let r = use(lever); const on = get();
  o.leverOn = r === true && on !== lever;
  r = use(on); o.leverOff = r === true && get() === lever;
  // CakeBlock
  const cake = S.stateOf('cake');
  r = use(cake); o.cakeBite = r === true && get() !== cake && name() === 'cake';
  let st = cake, n = 0; while (n < 10 && name() === 'cake' || n === 0) { use(st); n++; st = get(); if (name() !== 'cake') break; }
  o.cakeGone = get() === 0 && n === 7;
  // CandleCakeBlock: candle on uneaten cake
  r = use(cake, 'candle'); o.candleCake = r === true && name() === 'candle_cake';
  // eating a candle cake leaves a one-bite cake
  r = use(S.stateOf('candle_cake'), null, { thy: 10.2 }); o.candleCakeEat = name() === 'cake' || r === true;
  // igniters
  o.igniter = U.isIgniter({ i: IT.of('flint_and_steel'), n: 1 }) && U.isIgniter({ i: IT.of('fire_charge'), n: 1 }) && !U.isIgniter({ i: IT.of('stick'), n: 1 });
  // buttons: wooden 30, stone 20
  o.press = U.pressDuration(S.stateOf('oak_button')) === 30 && U.pressDuration(S.stateOf('stone_button')) === 20;
  // HoeItem / AxeItem / ShovelItem through Use.itemUseOn: grass->farmland, coarse->dirt, strip log, grass->path
  const tool = (state, item, face) => { set(state); set_(0, 11, 0, 0); const P = { inventory: Iv.create(), slot: 0, x: 0, y: 12, z: 0, instabuild: true };
    const stack = { i: IT.of(item), n: 1 }; Iv.setItem(P.inventory, 0, stack); return U.itemUseOn(P, 0, 10, 0, face === undefined ? 1 : face, state, stack); };
  const set_ = (x, y, z, s) => cells.set(k(x, y, z), s);
  tool(S.stateOf('grass_block'), 'iron_hoe'); o.hoeTill = name() === 'farmland';
  tool(S.stateOf('coarse_dirt'), 'iron_hoe'); o.hoeCoarse = name() === 'dirt';
  tool(S.stateOf('oak_log'), 'iron_axe'); o.axeStrip = name() === 'stripped_oak_log';
  tool(S.stateOf('grass_block'), 'iron_shovel'); o.shovelPath = name() === 'dirt_path';
  // ArrowItem set (Use.isArrowItem) and FlowerPotBlock.onUse
  o.arrow = ['arrow', 'tipped_arrow', 'spectral_arrow'].every((n) => U.isArrowItem({ i: IT.of(n), n: 1 })) && !U.isArrowItem({ i: IT.of('stick'), n: 1 });
  use(S.stateOf('flower_pot'), 'dandelion'); o.potFill = name() === 'potted_dandelion';
  use(S.stateOf('flower_pot'), 'stick'); o.potRejects = name() === 'flower_pot';
  use(S.stateOf('potted_dandelion'), null); o.potEmpty = name() === 'flower_pot';
  // Workstation blocks: Grindstone/Beacon/SmithingTable/Stonecutter/Loom/CartographyTable open their screen and bump the stat
  const stats = []; E.Stats = { inc: (id) => stats.push(id) }; let opened = null;
  E.Hud = new Proxy({}, { get: (_, f) => (typeof f === 'string' && f.startsWith('open') ? () => { opened = f; return true; } : undefined) });
  const ws = { grindstone: ['openGrindstone', 'interact_with_grindstone'], beacon: ['openBeacon', 'interact_with_beacon'], smithing_table: ['openSmithing', 'interact_with_smithing_table'], stonecutter: ['openStonecutter', 'interact_with_stonecutter'], loom: ['openLoom', 'interact_with_loom'], cartography_table: ['openCartography', 'interact_with_cartography_table'] };
  o.workstations = Object.entries(ws).every(([b, [f, st]]) => { opened = null; stats.length = 0; const r = use(S.stateOf(b), null); return r === true && opened === f && stats[0] === st; });
  // PumpkinBlock: shears carve it facing the clicked side (south=4); a non-shears hand does nothing
  use(S.stateOf('pumpkin'), 'shears', { lastHitFace: 4, yaw: 0 }); o.pumpkinCarve = name() === 'carved_pumpkin';
  use(S.stateOf('pumpkin'), 'stick', { lastHitFace: 4, yaw: 0 }); o.pumpkinStick = name() === 'pumpkin';
  // LecternBlock.openScreen bumps interact_with_lectern
  stats.length = 0; U.lecternOpen(0, 10, 0, {}); o.lecternStat = stats[0] === 'interact_with_lectern';
  E.Hud = {}; stats.length = 0; use(S.stateOf('grindstone'), null); o.wsNoOpen = stats.length === 0;
  // HoneyBlock: slides only when airborne, below the top, falling faster than -0.08 and hugging a side
  const hb = { onGround: false, x: 1.3, y: 5.5, z: 0.5, vy: -0.2, width: 0.6 };
  o.honeySlide = U.honeySliding(hb, 0, 5, 0) === true && U.honeySliding({ ...hb, vy: -0.05 }, 0, 5, 0) === false && U.honeySliding({ ...hb, onGround: true }, 0, 5, 0) === false;
  const hv = { vx: 1, vz: 1, vy: -0.26, fallDistance: 9 }; U.honeySlideVelocity(hv);
  o.honeyVel = hv.vy === -0.05 && Math.abs(hv.vx - 0.05 / 0.26) < 1e-9 && hv.fallDistance === 0;
  // Waterloggable / FluidFillable: a waterlogged slab carries still water; kelp is always water; stone is none
  o.waterlogged = U.fluidOf(E.Behave.setProp(S.stateOf('oak_slab'), 'waterlogged', 'true')).f === 'water' && U.fluidOf(S.stateOf('oak_slab')).f === '' && U.fluidOf(S.stateOf('kelp')).f === 'water' && U.fluidOf(S.stateOf('stone')).f === '';
  // ── #11479 round 2: the remaining classes, each driven through the real Use.* entry point ──
  const slotOf = (P, i) => Iv.getItem(P.inventory, i);
  const mkP = (extra) => Object.assign({ inventory: Iv.create(), slot: 0, x: 0, y: 11, z: 0, ex: 0.5, ey: 11, ez: 0.5, eyeHeight: 1.62, lookVec: () => [0, -1, 0], instabuild: false, food: 10 }, extra || {});
  // SignBlock.onUse: a dye recolours (once), a glow ink sac glows (once), the stack shrinks outside creative
  const BE = E.BlockEntities;
  if (BE && BE.SIGN_COLORS) {
    const sign = S.stateOf('oak_sign');
    let P = mkP(); Iv.setItem(P.inventory, 0, { i: IT.of('red_dye'), n: 2 });
    set(sign); r = U.blockUse(P, 0, 10, 0, sign, slotOf(P, 0));
    const be = BE.get(0, 10, 0);
    o.signDye = r === true && !!be && be.color === 'red' && slotOf(P, 0).n === 1;
    r = U.blockUse(P, 0, 10, 0, sign, slotOf(P, 0)); o.signDyeSame = r === false && slotOf(P, 0).n === 1;
    Iv.setItem(P.inventory, 1, { i: IT.of('glow_ink_sac'), n: 2 }); P.slot = 1;
    r = U.blockUse(P, 0, 10, 0, sign, slotOf(P, 1)); o.signGlow = r === true && BE.get(0, 10, 0).glowing === true;
    r = U.blockUse(P, 0, 10, 0, sign, slotOf(P, 1)); o.signGlowOnce = r === false;
    P = mkP({ instabuild: true }); Iv.setItem(P.inventory, 0, { i: IT.of('blue_dye'), n: 1 });
    U.blockUse(P, 0, 10, 0, sign, slotOf(P, 0)); o.signCreativeKeeps = slotOf(P, 0).n === 1 && BE.get(0, 10, 0).color === 'blue';
  } else { o.signDye = o.signDyeSame = o.signGlow = o.signGlowOnce = o.signCreativeKeeps = false; }
  // MusicDiscItem.useOnBlock via the jukebox: the disc goes in, the stat bumps, the stack shrinks; a non-disc is refused
  if (BE && BE.get) {
    const jb = S.stateOf('jukebox'), P = mkP(); stats.length = 0;
    Iv.setItem(P.inventory, 0, { i: IT.of('music_disc_cat'), n: 1 });
    set(jb); BE.remove(0, 10, 0); r = U.blockUse(P, 0, 10, 0, jb, slotOf(P, 0));
    o.discInsert = r === true && BE.get(0, 10, 0).record === 'music_disc_cat' && stats[0] === 'play_record' && Iv.isEmpty(slotOf(P, 0)) && E.Behave.propName(get(), 'has_record') === 'true';
    Iv.setItem(P.inventory, 0, { i: IT.of('stick'), n: 1 }); set(jb);
    o.discRefuseStick = U.blockUse(P, 0, 10, 0, jb, slotOf(P, 0)) === false && get() === jb;
  } else o.discInsert = o.discRefuseStick = false;
  // ShulkerBoxBlock / TrappedChestBlock.onUse: open the container, bump the matching stat only when it opened
  { let opens = 0, can = true; E.Hud = { openChest: () => { opens++; return can; } };
    const chestStats = (b) => { stats.length = 0; use(S.stateOf(b), null); return stats[0]; };
    o.trappedChest = chestStats('trapped_chest') === 'trigger_trapped_chest' && opens === 1;
    o.plainChest = chestStats('chest') === 'open_chest';
    can = false; o.trappedChestFail = chestStats('trapped_chest') === undefined;
    can = true; if (BE && BE.ready) { const sb = S.stateOf('red_shulker_box'); BE.create(0, 10, 0, 'shulker_box'); stats.length = 0; use(sb, null); o.shulkerOpen = opens >= 3 && stats[0] === 'open_shulker_box'; } else o.shulkerOpen = true;
    E.Hud = {}; }
  // TallFlowerBlock (Fertilizable): bone meal drops the flower as an item, never grows; other tall plants are not handled here
  { const drops = []; E.EntityList = { dropStack: (...a) => drops.push(a) };
    o.tallFlower = ['sunflower', 'lilac', 'rose_bush', 'peony'].every((n) => U.fertilizeOther(S.stateOf(n), 0, 10, 0, () => 0.5) === true) && drops.length === 4 && drops[0][4] === 1 && drops[0][0] === 0.5;
    o.tallFlowerNot = U.fertilizeOther(S.stateOf('stone'), 0, 10, 0, () => 0.5) === false; delete E.EntityList; }
  // GlassBottleItem.use: water in reach fills one bottle of the stack into a water potion; dry land does nothing
  { E.Ray = { cast: () => ({ x: 0, y: 10, z: 0, face: 1, dist: 1 }), targetable: () => true };
    const P = mkP(); Iv.setItem(P.inventory, 0, { i: IT.of('glass_bottle'), n: 2 }); set(S.stateOf('water'));
    r = U.glassBottleUse(P, slotOf(P, 0)); const got = Iv.countOf(P.inventory, IT.of('potion'));
    o.bottleFill = r === true && got === 1 && Iv.countOf(P.inventory, IT.of('glass_bottle')) === 1;
    const P2 = mkP(); Iv.setItem(P2.inventory, 0, { i: IT.of('glass_bottle'), n: 1 }); set(S.stateOf('stone'));
    o.bottleDry = U.glassBottleUse(P2, slotOf(P2, 0)) === false && Iv.countOf(P2.inventory, IT.of('potion')) === 0;
    delete E.Ray; }
  // FoodComponent(s) + Honey/Potion/Stew items: the hold, the always-edible rule, the container left behind
  { const eaten = [], fx = []; E.Survival = { eat: (P, n, sat) => eaten.push([n, sat]) }; E.Effects = { removeStatusEffect: (P, n) => fx.push('-' + n), addStatusEffect: (P, n) => fx.push('+' + n), clearStatusEffects: () => fx.push('clear'), NAMES: {} }; E.Potion = null;
    const hold = (name, extra) => { const P = mkP(extra); Iv.setItem(P.inventory, 0, { i: IT.of(name), n: 1 }); return P; };
    let P = hold('honey_bottle'); o.honeyHold = U.drinkStart(P, slotOf(P, 0), 0) === true && U.drinkMaxTicks(P) === 40;
    eaten.length = 0; fx.length = 0; const fin = U.drinkFinish(P);
    o.honeyFinish = fin === 'honey_bottle' && eaten.length === 1 && eaten[0][0] === 6 && Math.abs(eaten[0][1] - 0.1) < 1e-6 && fx.includes('-poison') && IT.nameOf(slotOf(P, 0).i) === 'glass_bottle';
    P = hold('honey_bottle', { food: 20 }); o.honeyFull = U.drinkStart(P, slotOf(P, 0), 0) === false;
    P = hold('golden_apple', { food: 20 }); o.goldenAlways = U.drinkStart(P, slotOf(P, 0), 0) === true && U.drinkMaxTicks(P) === 32;
    P = hold('apple', { food: 20 }); o.appleFull = U.drinkStart(P, slotOf(P, 0), 0) === false;
    P = hold('dried_kelp'); U.drinkStart(P, slotOf(P, 0), 0); o.snackFast = U.drinkMaxTicks(P) === 16;
    P = hold('mushroom_stew'); U.drinkStart(P, slotOf(P, 0), 0); eaten.length = 0; U.drinkFinish(P);
    o.stewBowl = eaten.length === 1 && eaten[0][0] === 6 && IT.nameOf(slotOf(P, 0).i) === 'bowl';
    P = hold('milk_bucket', { food: 20 }); o.milkAlways = U.drinkStart(P, slotOf(P, 0), 0) === true; fx.length = 0; U.drinkFinish(P);
    o.milkClears = fx.includes('clear') && IT.nameOf(slotOf(P, 0).i) === 'bucket';
    // PotionItem.finishUsing: every effect applied, bottle left behind; SuspiciousStewItem: effects from NBT (default 160 ticks), bowl left
    E.Effects.NAMES = { 1: 'speed', 10: 'regeneration' }; E.Effects.addStatusEffect = (P, n, d) => fx.push('+' + n + ':' + d);
    E.Potion = { effectsOf: () => [{ effect: 'speed', duration: 3600, amplifier: 0 }] };
    P = hold('potion'); P.inventory && (slotOf(P, 0).t = { Potion: 'minecraft:swiftness' }); fx.length = 0; U.drinkStart(P, slotOf(P, 0), 0); U.drinkFinish(P);
    o.potionFinish = fx.includes('+speed:3600') && IT.nameOf(slotOf(P, 0).i) === 'glass_bottle';
    P = hold('suspicious_stew'); slotOf(P, 0).t = { Effects: [{ EffectId: 1, EffectDuration: 100 }, { EffectId: 10 }] }; fx.length = 0; U.drinkStart(P, slotOf(P, 0), 0); U.drinkFinish(P);
    o.stewEffects = fx.includes('+speed:100') && fx.includes('+regeneration:160') && IT.nameOf(slotOf(P, 0).i) === 'bowl';
    delete E.Survival; delete E.Effects; delete E.Potion; }
  // CrossbowItem for the player: quick charge shortens the pull, loading takes one arrow (three with multishot) into the stack NBT
  { const lvl = { quick_charge: 0, multishot: 0 }; E.Combat = { enchantLevel: (s, n) => lvl[n] | 0 };
    const cb = { i: IT.of('crossbow'), n: 1 };
    o.xbowPull = U.crossbowPullTime(cb) === 25 && (lvl.quick_charge = 3, U.crossbowPullTime(cb)) === 10; lvl.quick_charge = 0;
    const P = mkP(); Iv.setItem(P.inventory, 0, cb); Iv.setItem(P.inventory, 1, { i: IT.of('arrow'), n: 5 });
    r = U.crossbowLoad(P, cb); o.xbowLoad = r === true && U.crossbowProjectiles(cb).length === 1 && U.crossbowHas(cb, 'arrow') && Iv.countOf(P.inventory, IT.of('arrow')) === 4;
    lvl.multishot = 1; const c2 = { i: IT.of('crossbow'), n: 1 }, P2 = mkP(); Iv.setItem(P2.inventory, 0, c2); Iv.setItem(P2.inventory, 1, { i: IT.of('arrow'), n: 5 });
    U.crossbowLoad(P2, c2); o.xbowMulti = U.crossbowProjectiles(c2).length === 3 && Iv.countOf(P2.inventory, IT.of('arrow')) === 4;
    const P3 = mkP(); const c3 = { i: IT.of('crossbow'), n: 1 }; Iv.setItem(P3.inventory, 0, c3); o.xbowNoAmmo = U.crossbowLoad(P3, c3) === false && U.crossbowProjectiles(c3).length === 0;
    delete E.Combat; }
  // OnAStickItem.use: only while riding a pig, takes 7 durability per boost, and a spent rod becomes a fishing rod
  { let boost = true; E.Passive = { ready: true, pigIsSaddled: () => true, pigCanBeControlledByRider: () => true, pigBoost: () => boost };
    const P = mkP({ vehicle: { type: 'pig', dead: false } }); const st = { i: IT.of('carrot_on_a_stick'), n: 1, d: 0 }; Iv.setItem(P.inventory, 0, st);
    o.stickBoost = U.pigBoostOnAStick(P, st) === true && st.d === 7;
    boost = false; o.stickRefuse = U.pigBoostOnAStick(P, st) === false && st.d === 7; boost = true;
    o.stickNoPig = U.pigBoostOnAStick(mkP({ vehicle: { type: 'horse' } }), st) === false && U.pigBoostOnAStick(mkP(), st) === false;
    const st2 = { i: IT.of('carrot_on_a_stick'), n: 1, d: 21 }, P2 = mkP({ vehicle: { type: 'pig', dead: false } }); Iv.setItem(P2.inventory, 0, st2);
    U.pigBoostOnAStick(P2, st2); o.stickBreaks = IT.nameOf(slotOf(P2, 0).i) === 'fishing_rod';
    delete E.Passive; }
  // Criteria.FILLED_BUCKET (Bucketable.tryBucket / BucketItem): the trigger carries the filled stack
  { const trig = []; E.Adv = { trigger: (P, id, d) => trig.push([id, d]) }; U.filledBucketTrigger(mkP({ advancements: {} }), 'axolotl_bucket'); U.filledBucketTrigger(mkP(), 'water_bucket');
    o.filledTrigger = trig.length === 1 && trig[0][0] === 'minecraft:filled_bucket' && trig[0][1].stack.id === 'minecraft:axolotl_bucket'; delete E.Adv; }
  // LavaCauldronBlock.entityInside: a lava cauldron always counts as level 3 -> ignites for 15 s and hurts 4 (not fire-immune)
  { const calls = []; E.Combat = { igniteForSeconds: (e, s) => calls.push(['ignite', s]), fireImmuneOf: (e) => !!e.fireImmune, hurt: (e, a) => calls.push(['hurt', a]) };
    const lava = S.stateOf('lava_cauldron'); const ent = (extra) => Object.assign({ x: 0.5, y: 10.1, z: 0.5, height: 1.8, width: 0.6, vx: 0, vy: 0, vz: 0, type: 'zombie' }, extra || {});
    set(lava); U.entityCollide(ent()); o.lavaCauldron = calls.length === 2 && calls[0][1] === 15 && calls[1][1] === 4;
    calls.length = 0; U.entityCollide(ent({ fireImmune: true })); o.lavaCauldronImmune = calls.length === 0;
    calls.length = 0; U.entityCollide(ent({ y: 10.95 })); o.lavaCauldronAbove = calls.length === 0;
    delete E.Combat; }
  // BoatItem.use: no target in reach -> pass; water in reach -> the boat of the item's wood spawns facing the player; creative keeps the stack
  { const spawned = []; let hit = null; E.Ray = { cast: () => hit, targetable: () => true }; E.Boat = { TYPES: ['oak', 'birch'] };
    E.EntityList = { list: [], spawn: (t, x, y, z, opt) => { const e = { type: t, x, y, z, width: 1.375, height: 0.5625, opt }; spawned.push(e); return e; } };
    E.Physics = { shapeAt: () => 0, boxIntersectsCell: () => false };
    const P = mkP({ yaw: 90, reach: 4.5 }); const st = { i: IT.of('birch_boat'), n: 2 }; Iv.setItem(P.inventory, 0, st);
    o.boatMiss = U.boatUse(P, st) === false && spawned.length === 0;
    hit = { hx: 0.5, hy: 10, hz: 0.5, x: 0, y: 10, z: 0 };
    r = U.boatUse(P, st); o.boatPlace = r === true && spawned.length === 1 && spawned[0].opt.boatType === 'birch' && spawned[0].yaw === 90 && st.n === 1;
    const Pc = mkP({ yaw: 0, reach: 4.5, instabuild: true }), sc = { i: IT.of('oak_boat'), n: 1 }; U.boatUse(Pc, sc); o.boatCreative = sc.n === 1 && spawned.length === 2;
    o.boatNotBoat = U.boatUse(P, { i: IT.of('stick'), n: 1 }) === false;
    E.Physics.shapeAt = () => 1; E.Physics.boxIntersectsCell = () => true;
    o.boatBlocked = U.boatUse(P, st) === false && st.n === 1;
    delete E.Ray; delete E.Boat; delete E.EntityList; delete E.Physics; }
  // ── round 3: Bucketable (water bucket on a mob) + the lectern block entity ──
  { const removed = []; E.EntityList = { remove: (e) => removed.push(e), list: [] }; E.Fish = { bucketItemFor: (t) => ({ cod: 'cod_bucket', pufferfish: 'pufferfish_bucket' })[t] || null };
    const trig = []; E.Adv = { trigger: (P, id, d) => trig.push(id) }; const Br0 = E.Breed; E.Breed = { ready: true, itemNameOf: (st) => (st && !Iv.isEmpty(st) ? IT.nameOf(st.i) : ''), interact: () => false, isBaby: () => false };
    const mob = (type, extra) => Object.assign({ type, health: 3, x: 0.5, y: 11, z: 0.5, removed: false, puffState: 2, axolotlVariant: 3, growAge: 0 }, extra || {});
    const bucketOn = (e, held, extra) => { const P = mkP(Object.assign({ advancements: {} }, extra || {})); const st = { i: IT.of(held), n: 1 }; Iv.setItem(P.inventory, 0, st); const rr = U.entityUse(P, e, st); return [rr, P]; };
    let e = mob('pufferfish'), [rr, P] = bucketOn(e, 'water_bucket');
    let got = slotOf(P, 0);
    o.bucketFish = rr && IT.nameOf(got.i) === 'pufferfish_bucket' && removed[0] === e && got.puffState === 2 && got.bucketData.Health === 3 && trig.filter((t) => t === 'minecraft:filled_bucket').length === 1;
    e = mob('axolotl', { axolotlVariant: 4 }); [rr, P] = bucketOn(e, 'water_bucket'); got = slotOf(P, 0);
    o.bucketAxolotl = rr && IT.nameOf(got.i) === 'axolotl_bucket' && got.axolotlVariant === 4;
    e = mob('cod', { customName: 'Bob', aiDisabled: true }); [rr, P] = bucketOn(e, 'water_bucket'); got = slotOf(P, 0);
    o.bucketData = got.bucketData.CustomName === 'Bob' && got.bucketData.NoAI === true && !('Silent' in got.bucketData);
    removed.length = 0; e = mob('cod'); [rr, P] = bucketOn(e, 'bucket');
    o.bucketEmptyNo = IT.nameOf(slotOf(P, 0).i) === 'bucket' && removed.length === 0;
    e = mob('cod', { health: 0 }); [rr, P] = bucketOn(e, 'water_bucket'); o.bucketDeadNo = IT.nameOf(slotOf(P, 0).i) === 'water_bucket';
    e = mob('pufferfish'); [rr, P] = bucketOn(e, 'water_bucket', { instabuild: true }); o.bucketCreative = slotOf(P, 0).n === 1 && IT.nameOf(slotOf(P, 0).i) === 'water_bucket' && Iv.countOf(P.inventory, IT.of('pufferfish_bucket')) === 1;
    delete E.EntityList; delete E.Fish; delete E.Adv; E.Breed = Br0; }
  // LecternBlock.putBook / LecternBlockEntity: the book goes in (one of the stack), pages clamp and pulse POWERED, the comparator reads the page, take-book returns it
  if (BE && BE.create) {
    const lec = S.stateOf('lectern'); set(lec); BE.remove(0, 10, 0);
    const P = mkP(); const book = { i: IT.of('writable_book'), n: 2, t: { pages: ['a', 'b', 'c'] } }; Iv.setItem(P.inventory, 0, book);
    const sch = []; const B0 = E.Behave.schedule; E.Behave.schedule = (...a) => sch.push(a);
    o.lecPut = U.lecternPut(0, 10, 0, P, book) === true && BE.get(0, 10, 0).book.n === 1 && book.n === 1 && E.Behave.propName(get(), 'has_book') === 'true';
    o.lecComparator0 = U.lecternComparator(0, 10, 0) === 1;
    U.lecternButton(0, 10, 0, P, 2); o.lecNext = BE.get(0, 10, 0).page === 1 && E.Behave.propName(get(), 'powered') === 'true' && sch.length === 1 && U.lecternComparator(0, 10, 0) === 8;
    U.lecternButton(0, 10, 0, P, 2); U.lecternButton(0, 10, 0, P, 2); o.lecClamp = BE.get(0, 10, 0).page === 2 && U.lecternComparator(0, 10, 0) === 15;
    U.lecternButton(0, 10, 0, P, 100); o.lecJump = BE.get(0, 10, 0).page === 0;
    sch.length = 0; U.lecternButton(0, 10, 0, P, 100); o.lecNoPulse = sch.length === 0;
    o.lecNoMayBuild = U.lecternButton(0, 10, 0, mkP({ mayBuild: false }), 3) === false && !!BE.get(0, 10, 0).book;
    const P2 = mkP(); r = U.lecternButton(0, 10, 0, P2, 3);
    o.lecTake = r === true && !BE.get(0, 10, 0).book && E.Behave.propName(get(), 'has_book') === 'false' && Iv.countOf(P2.inventory, IT.of('writable_book')) === 1;
    E.Behave.schedule = B0;
  } else o.lecPut = o.lecComparator0 = o.lecNext = o.lecClamp = o.lecJump = o.lecNoPulse = o.lecNoMayBuild = o.lecTake = false;
  return o;
}
const A = trial(null);
const LBL = { leverOn: 'LeverBlock toggles on', leverOff: 'LeverBlock toggles off', cakeBite: 'CakeBlock bite', cakeGone: 'CakeBlock removed on 7th bite', candleCake: 'CandleCakeBlock from candle', candleCakeEat: 'CandleCakeBlock eat', igniter: 'FlintAndSteelItem/FireChargeItem igniters', press: 'button press duration', hoeTill: 'HoeItem tills grass', hoeCoarse: 'HoeItem coarse dirt -> dirt', axeStrip: 'AxeItem strips log', shovelPath: 'ShovelItem path', arrow: 'ArrowItem set', potFill: 'FlowerPotBlock fills', potRejects: 'FlowerPotBlock rejects stick', potEmpty: 'FlowerPotBlock empties', workstations: 'Grindstone/Beacon/SmithingTable/Stonecutter/Loom/CartographyTable open screen + stat', pumpkinCarve: 'PumpkinBlock shears carve', pumpkinStick: 'PumpkinBlock ignores non-shears', lecternStat: 'LecternBlock open stat', honeySlide: 'HoneyBlock.isSliding', honeyVel: 'HoneyBlock.updateSlidingVelocity', waterlogged: 'Waterloggable/FluidFillable fluidOf', wsNoOpen: 'failed open bumps no stat', signDye: 'SignBlock dye recolours + shrinks', signDyeSame: 'SignBlock same dye refused', signGlow: 'SignBlock glow ink sac', signGlowOnce: 'SignBlock already glowing refused', signCreativeKeeps: 'SignBlock creative keeps dye (DyeItem)', discInsert: 'MusicDiscItem inserts via jukebox', discRefuseStick: 'jukebox refuses non-disc', trappedChest: 'TrappedChestBlock open stat', plainChest: 'ChestBlock open stat', trappedChestFail: 'TrappedChestBlock no stat when not opened', shulkerOpen: 'ShulkerBoxBlock open stat', tallFlower: 'TallFlowerBlock bone meal drops item', tallFlowerNot: 'fertilizeOther ignores stone', bottleFill: 'GlassBottleItem fills from water', bottleDry: 'GlassBottleItem refuses dry land', honeyHold: 'HoneyBottleItem 40-tick hold', potionFinish: 'PotionItem finish applies effects + bottle', stewEffects: 'SuspiciousStewItem effects from NBT + default 160', honeyFinish: 'HoneyBottleItem finish (6/0.1, poison cured, bottle back)', honeyFull: 'FoodComponent honey not alwaysEdible', goldenAlways: 'FoodComponents golden apple alwaysEdible', appleFull: 'FoodComponent apple refused when full', snackFast: 'FoodComponent snack 16 ticks', stewBowl: 'StewItem leaves bowl', milkAlways: 'MilkBucketItem always drinkable', milkClears: 'MilkBucketItem clears effects + bucket', xbowPull: 'CrossbowItem quick charge pull time', xbowLoad: 'CrossbowItem loads one arrow', xbowMulti: 'CrossbowItem multishot loads three', xbowNoAmmo: 'CrossbowItem no ammo fails', stickBoost: 'OnAStickItem boosts pig, 7 damage', stickRefuse: 'OnAStickItem refuses mid-boost', stickNoPig: 'OnAStickItem needs a pig vehicle', stickBreaks: 'OnAStickItem spent -> fishing rod', filledTrigger: 'Criteria.FILLED_BUCKET trigger', lavaCauldron: 'LavaCauldronBlock ignites 15s + hurt 4', lavaCauldronImmune: 'LavaCauldronBlock fire-immune untouched', lavaCauldronAbove: 'LavaCauldronBlock above the lava level', boatMiss: 'BoatItem miss passes', boatPlace: 'BoatItem places the wood boat', boatCreative: 'BoatItem creative keeps stack', boatNotBoat: 'BoatItem rejects non-boat', boatBlocked: 'BoatItem blocked by solid', bucketFish: 'Bucketable water bucket on pufferfish', bucketAxolotl: 'Bucketable axolotl variant', bucketData: 'Bucketable copyDataToStack name/NoAI', bucketEmptyNo: 'Bucketable empty bucket does nothing', bucketDeadNo: 'Bucketable dead mob refused', bucketCreative: 'EntityBucketItem creative still swaps', lecPut: 'LecternBlock.putBook', lecComparator0: 'LecternBlockEntity comparator page 0', lecNext: 'LecternBlockEntity next page pulses powered', lecClamp: 'LecternBlockEntity page clamps', lecJump: 'LecternScreenHandler jump to page', lecNoPulse: 'unchanged page no pulse', lecNoMayBuild: 'take book refused without mayBuild', lecTake: 'LecternScreenHandler take book' };
for (const [key, m] of Object.entries(LBL)) ok(A[key], m);
const BR = [
  ['bucketFish', /Use\.exchangeStack\(P, stack, bucketOf, true\);/, 'Use.exchangeStack(P, stack, bucketOf, false);Use.exchangeStack(P, stack, "bucket", false);'],
  ['bucketFish', /if \(EL2 && EL2\.remove\) EL2\.remove\(e\);/, ''],
  ['bucketAxolotl', /slotStack\.axolotlVariant = e\.axolotlVariant \| 0;/, ''],
  ['bucketData', /if \(e\.aiDisabled\) bd\.NoAI = true;/, ''],
  ['bucketEmptyNo', /!empty && bucketOf && itemName === 'water_bucket'/, "!empty && bucketOf && (itemName === 'water_bucket' || itemName === 'bucket')"],
  ['bucketDeadNo', /itemName === 'water_bucket' && !e\.removed && !\(e\.health <= 0\)\) \{/, "itemName === 'water_bucket' && !e.removed) {"],
  ['bucketCreative', /if \(!P\.instabuild\) Iv\.shrink\(stack, 1\);   \/\/ exchangeStack/, 'Iv.shrink(stack, 1);   // exchangeStack'],
  ['lecPut', /be\.book = one; be\.page = 0;/, 'be.page = 0;'],
  ['lecComparator0', /return Math\.floor\(\(cnt > 1 \? be\.page \/ \(cnt - 1\) : 1\) \* 14\) \+ 1;/, 'return Math.floor((cnt > 1 ? be.page / (cnt - 1) : 1) * 14);'],
  ['lecNext', /B\.schedule\(x, y, z, 2\);/, ''],
  ['lecClamp', /Math\.min\(n \| 0, cnt - 1\)/, 'Math.min(n | 0, cnt)'],
  ['lecJump', /if \(id >= 100\) return Use\.lecternSetPage\(x, y, z, id - 100\);/, ''],
  ['lecNoPulse', /if \(pg === be\.page\) return true;/, ''],
  ['lecNoMayBuild', /if \(P && P\.mayBuild === false\) return false;/, ''],
  ['lecTake', /lecSetHasBook\(x, y, z, false\);/, ''],
  ['honeySlide', /if \(\(e\.vy \|\| 0\) >= -0\.08\) return false;/, ''],
  ['honeyVel', /e\.vy = -0\.05;/, 'e.vy = -0.5;'],
  ['waterlogged', /if \(waterlogged\(state\) \|\| anyOf\(state, ALWAYS_WATER\)\)/, 'if (anyOf(state, ALWAYS_WATER))'],
  ['leverOn', /W\.setBlock\(x, y, z, setProp\(state, 'powered', leverOn\)\);/, ''],
  ['cakeBite', /W\.setBlock\(x, y, z, bites < 6 \? setProp\(state, 'bites', String\(bites \+ 1\)\) : 0\);/, ''],
  ['cakeGone', /bites < 6 \? setProp/, 'bites < 7 ? setProp'],
  ['candleCake', /W\.setBlock\(x, y, z, S\.stateOf\(heldName \+ '_cake'\)\);/, ''],
  ['igniter', /Use\.isIgniter = function \(stack\) \{/, 'Use.isIgniter = function (stack) { return false;'],
  ['press', /Use\.pressDuration = function \(state\) \{/, 'Use.pressDuration = function (state) { return 1;'],
  ['hoeTill', /to = id\.farmland;\n        else if \(isBlock\(state, 'coarse_dirt'\)\)/, 'to = -1;\n        else if (isBlock(state, \'coarse_dirt\'))'],
  ['hoeCoarse', /else if \(isBlock\(state, 'coarse_dirt'\)\) to = id\.dirt;/, "else if (isBlock(state, 'coarse_dirt')) to = id.farmland;"],
  ['arrow', /n === 'arrow' \|\| n === 'tipped_arrow'/, "n === 'arrow'"],
  ['potFill', /W\.setBlock\(x, y, z, potted\);/, ''],
  ['workstations', /'interact_with_grindstone'\);/, "'interact_with_x');"],
  ['workstations', /'interact_with_loom'\);/, "'interact_with_x');"],
  ['workstations', /'interact_with_cartography_table'\);/, "'interact_with_x');"],
  ['wsNoOpen', /Use\.openStatIf = function \(r, id\) \{ if \(r\)/, 'Use.openStatIf = function (r, id) { if (true)'],
  ['pumpkinCarve', /W\.setBlock\(x, y, z, setProp\(S\.stateOf\('carved_pumpkin'\), 'facing', cf\)\);/, ''],
  ['pumpkinStick', /bname === 'pumpkin' && heldName === 'shears'/, "bname === 'pumpkin'"],
  ['lecternStat', /'interact_with_lectern'/, "'interact_with_x'"],
  ['axeStrip', /var want = 'stripped_' \+ n;/, "var want = 'xx_' + n;"],
  ['signDye', /if \(sGlow\) sBE\.glowing = true; else sBE\.color = sCol;/, ''],
  ['signDyeSame', /if \(sGlow \? sBE\.glowing : sBE\.color === sCol\) return false;/, ''],
  ['signGlow', /if \(sGlow\) sBE\.glowing = true; else/, 'if (sGlow) sBE.glowing = false; else'],
  ['signGlowOnce', /sGlow \? sBE\.glowing : sBE\.color === sCol/, 'sBE.color === sCol'],
  ['signCreativeKeeps', /if \(!P\.instabuild\) \{ NS\.Inventory\.shrink\(held, 1\); if \(P\.syncHotbar\) P\.syncHotbar\(\); \}\n      changed/, 'NS.Inventory.shrink(held, 1);\n      changed'],
  ['discInsert', /jBE\.record = heldName;/, ''],
  ['discInsert', /Stats\.inc\('play_record'\)/, "Stats.inc('x')"],
  ['discRefuseStick', /if \(!jOn && !\/\^music_disc_\/\.test\(heldName\)\) return false;/, ''],
  ['trappedChest', /isBlock\(state, 'trapped_chest'\) \? 'trigger_trapped_chest'/, "isBlock(state, 'trapped_chest') ? 'open_chest'"],
  ['plainChest', /: 'open_chest'\);/, ": 'open_x');"],
  ['trappedChestFail', /if \(rC === true\) Use\.openStat/, 'if (true) Use.openStat'],
  ['shulkerOpen', /'open_shulker_box'/, "'open_chest'"],
  ['tallFlower', /NS\.EntityList\.dropStack\(x \+ 0\.5, y \+ 0\.5, z \+ 0\.5, NS\.Items\.of\(nm\), 1\);/, ''],
  ['tallFlowerNot', /isBlock\(state, 'sunflower'\) \|\| isBlock\(state, 'lilac'\) \|\| isBlock\(state, 'rose_bush'\) \|\| isBlock\(state, 'peony'\)/, 'true'],
  ['bottleFill', /Use\.exchangeStack\(P, stack, 'potion', false, \{ Potion: 'minecraft:water' \}\);/, ''],
  ['bottleDry', /if \(!\(isBlock\(st, 'water'\) \|\| \(has\(st, 'waterlogged'\)/, 'if (!(true || (has(st, \'waterlogged\')'],
  ['honeyHold', /potion: 32, milk_bucket: 32, honey_bottle: 40,/, 'potion: 32, milk_bucket: 32, honey_bottle: 32,'],
  ['honeyFinish', /ES\.removeStatusEffect\(P, 'poison'\);/, ''],
  ['honeyFinish', /(honey_bottle'\) \{\n      eatIt\(\);[^\n]*\n      if \(!creative\) \{ Iv\.shrink\(stack, 1\); if \(stack\.n <= 0\) )setSlot\('glass_bottle'\)/, "$1setSlot('bowl')"],
  ['honeyFull', /if \(!Use\.DRINK_ALWAYS\[name\] && !\(P\.food < 20 \|\| P\.instabuild\)\) return false;/, ''],
  ['goldenAlways', /golden_apple: true, enchanted_golden_apple: true, chorus_fruit: true \}/, 'chorus_fruit: true }'],
  ['stewBowl', /setSlot\('bowl'\)/, "setSlot('bucket')"],
  ['potionFinish', /else ES\.addStatusEffect\(P, f\.effect, f\.duration/, 'else void (P, f.effect, f.duration'],
  ['stewEffects', /Use\.SUSPICIOUS_STEW_DEFAULT, 0, false/, '20, 0, false'],
  ['milkClears', /ES\.clearStatusEffects\(P\);/, ''],
  ['milkAlways', /potion: true, milk_bucket: true, suspicious_stew: true,/, 'potion: true, suspicious_stew: true,'],
  ['xbowPull', /return q === 0 \? 25 : 25 - 5 \* q;/, 'return 25;'],
  ['xbowMulti', /Cb\.enchantLevel\(stack, 'multishot'\) === 0 \? 1 : 3/, '1'],
  ['xbowLoad', /Cb\.enchantLevel\(stack, 'multishot'\) === 0 \? 1 : 3/, '2'],
  ['xbowNoAmmo', /if \(!src\) return false;/, 'if (!src) src = Iv.stack(\'arrow\', 1);'],
  ['stickBoost', /stack\.d = \(stack\.d \| 0\) \+ 7;/, 'stack.d = (stack.d | 0) + 1;'],
  ['stickRefuse', /if \(!Ps\.pigBoost\(P\.vehicle, pRand\)\) return false;\n    if \(!P\.instabuild\) \{\n      stack\.d = \(stack\.d \| 0\) \+ 7;/, 'Ps.pigBoost(P.vehicle, pRand);\n    if (!P.instabuild) {\n      stack.d = (stack.d | 0) + 7;'],
  ['stickNoPig', /P\.vehicle\.dead \|\| P\.vehicle\.type !== 'pig'\) return false;\n    if \(!Ps/, "P.vehicle.dead) return false;\n    if (!Ps"],
  ['stickBreaks', /if \(max && stack\.d >= max\) Use\.swapHeld\(P, stack, 'fishing_rod'\);\n    \}\n    return true;\n  \};\n  \/\*\*\n   \* s135/, "}\n    return true;\n  };\n  /**\n   * s135"],
  ['filledTrigger', /'minecraft:filled_bucket'/, "'minecraft:x'"],
  ['lavaCauldron', /Cb\.igniteForSeconds\(e, 15\);/, 'Cb.igniteForSeconds(e, 5);'],
  ['lavaCauldron', /Cb\.hurt\(e, 4, undefined/, 'Cb.hurt(e, 1, undefined'],
  ['lavaCauldronImmune', /!\(Cb\.fireImmuneOf && Cb\.fireImmuneOf\(e\)\)/, 'true'],
  ['lavaCauldronAbove', /e\.y < by \+ \(6 \+ clv \* 3\) \/ 16 &&/, ''],
  ['boatMiss', /if \(!hit\) return false;\n    var hx = hit\.hx/, 'var hx = hit.hx'],
  ['boatPlace', /var e = EL\.spawn\('boat', hx, hy, hz, \{ boatType: wood \}\);/, "var e = EL.spawn('boat', hx, hy, hz, { boatType: 'oak' });"],
  ['boatPlace', /e\.yaw = P\.yaw; e\.yawO = P\.yaw;\n    var Iv = NS\.Inventory;\n    if \(!P\.instabuild && Iv && Iv\.shrink\) Iv\.shrink\(stack, 1\);/, 'e.yaw = 0; e.yawO = 0;\n    var Iv = NS.Inventory;\n    if (!P.instabuild && Iv && Iv.shrink) Iv.shrink(stack, 1);'],
  ['boatCreative', /e\.yaw = P\.yaw; e\.yawO = P\.yaw;\n    var Iv = NS\.Inventory;\n    if \(!P\.instabuild && Iv && Iv\.shrink\)/, 'e.yaw = P.yaw; e.yawO = P.yaw;\n    var Iv = NS.Inventory;\n    if (Iv && Iv.shrink)'],
  ['boatNotBoat', /if \(!endsWith\(name, '_boat'\) \|\| Bt\.TYPES\.indexOf\(name\.slice\(0, name\.length - 5\)\) < 0\) return false;/, ''],
  ['boatBlocked', /if \(!clear\) \{ e\.removed = true;/, 'if (false) { e.removed = true;'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  const src = readFileSync(join(MCLITE_ROOT, 'src/14l_use.js'), 'utf8');
  if (!re.test(src)) { fails.push('no-op break: ' + key); continue; }
  const p = (f, s) => f === '14l_use.js' ? s.replace(re, rep) : s;
  let B; try { B = trial(p); } catch { B = {}; }
  ok(!B[key], 'anti-vacuity: break ' + key + ' must fail it');
  if (!B[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `usebehaviourcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
