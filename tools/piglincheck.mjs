#!/usr/bin/env node
// piglincheck.mjs — s133 (KW-32): piglin + piglin_brute exist (src/07zzf_piglin.js).
//
//   node tools/piglincheck.mjs [--verbose]
//
//   1. spawn: both EL.canSpawn; PiglinEntity.initialize — 20% baby (speed x1.2, no weapon), an adult's
//      weapon ~50/50 crossbow/golden sword, ~10% per golden armour piece, none on a baby; brute:
//      golden axe always, never enchanted, 50 hp.
//   2. zombification: 300 ticks in the overworld are fine, the 301st converts to a zombified piglin
//      keeping the equipment and baby flag, with Nausea 200; an immune piglin never converts.
//   3. HostileEntity babies never grow up (EL.PERMANENT_BABY); a calf still does.
//   4. targets: an adult piglin takes a player not in gold, never one in a golden piece, never while a
//      zombified piglin is within 6, prefers a wither skeleton; a baby never targets; the brute
//      takes any player within 12, not at 14.
//   5. revenge: hitting a piglin angers it AND a nearby adult piglin, even through gold.
//   6. xp: a piglin drops its bare 5 whatever it wears; a brute 20 + equipment.
//   7. anti-vacuity: each of the above broken on purpose and caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m) && !VERBOSE) console.log('   ✓ ' + m); };

console.log('piglincheck — s133: piglin + piglin_brute (spawn, zombification, targets, revenge, xp)');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07s_raid.js', '07zzf_piglin.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.Breed && M.Breed.init) M.Breed.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
if (M.Xp && M.Xp.init) M.Xp.init();
M.Combat.init();
if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
const EL = M.EntityList, Eq = M.Equip, IT = M.Items, Pg = M.Piglin;
Pg.init();

const seq = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
function spawn(type, x = 0.5, z = 0.5, rnd, opts) {
  const prev = EL.random; if (rnd) EL.random = rnd;
  try { return EL.spawn(type, x, 64, z, opts); } finally { EL.random = prev; }
}
const held = (e) => { const s = Eq.getEquipped(e, IT.MAINHAND); return s ? IT.nameOf(s.i) : null; };
const armour = (e) => [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD].map((s) => Eq.getEquipped(e, s)).filter(Boolean).length;
const enchanted = (e) => { const s = Eq.getEquipped(e, IT.MAINHAND); return !!(s && s.t && s.t.Enchantments && s.t.Enchantments.length); };
const clear = () => { EL.list.length = 0; };

// ── 1. spawn ──
say1();
function say1() {
  ok(EL.canSpawn('piglin') && EL.canSpawn('piglin_brute'), 'EL.canSpawn(piglin) and (piglin_brute)');
  const baby = spawn('piglin', 0.5, 0.5, () => 0);
  ok(!!baby && baby.isBaby === true, 'a 0.0 roll spawns a BABY piglin');
  ok(baby && held(baby) === null && armour(baby) === 0, 'a baby piglin holds nothing and wears nothing');
  ok(baby && Math.abs(baby.speedAttr - 0.35 * 1.2) < 1e-6, `a baby piglin moves at 0.35 x 1.2 (BABY_SPEED_BOOST) — got ${baby && baby.speedAttr}`);
  let cross = 0, sword = 0, adults = 0, pieces = 0, babies = 0;
  for (let i = 0; i < 2000; i++) {
    const p = spawn('piglin'); if (!p) continue;
    if (p.isBaby) { babies++; ok(armour(p) === 0, 'no baby wears armour'); continue; }
    adults++; const h = held(p); if (h === 'crossbow') cross++; else if (h === 'golden_sword') sword++;
    pieces += armour(p);
    for (const s of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) { const a = Eq.getEquipped(p, s); if (a) ok(/^golden_/.test(IT.nameOf(a.i)), 'armour is golden: ' + IT.nameOf(a.i)); }
  }
  clear();
  ok(babies > 300 && babies < 500, `~20% of piglins are babies (${babies}/2000)`);
  ok(cross + sword === adults, `every adult holds a crossbow or a golden sword (${cross + sword}/${adults})`);
  ok(Math.abs(cross / adults - 0.5) < 0.05, `crossbow vs golden sword ~50/50 (${cross}/${adults})`);
  ok(Math.abs(pieces / (adults * 4) - 0.1) < 0.02, `~10% per golden armour piece (${pieces}/${adults * 4})`);
  const b = spawn('piglin_brute', 0.5, 0.5, () => 0);
  ok(!!b && held(b) === 'golden_axe' && !enchanted(b) && !b.isBaby, 'a brute always holds an unenchanted golden axe, never a baby, even on all-zero rolls');
  ok(b && b.maxHealth === 50, `brute max health 50 (${b && b.maxHealth})`);
  ok(M.Ai.ROSTER.piglin && M.Ai.ROSTER.piglin_brute && b && !!b.ai, 'both have a goal roster and a spawned brute runs it');
  clear();
}

// ── 2. zombification ──
function zombifyRun(opts) {
  clear();
  const p = spawn('piglin', 0.5, 0.5, seq([0.9, 0.9, 0.9, 0.05, 0.9, 0.9, 0.9, 0.9]), opts);
  let at = -1;
  for (let t = 1; t <= 400 && at < 0; t++) { Pg.tickEntity(p); if (p.removed) at = t; }
  const z = EL.list.find((o) => o.type === 'zombified_piglin');
  return { p, at, z };
}
{
  const { p, at, z } = zombifyRun();
  ok(at === 301, `a piglin converts on its 301st overworld tick (timeInOverworld > 300) — at ${at}`);
  ok(!!z, 'the conversion leaves a zombified piglin');
  ok(z && held(z) === held(p) && held(z) === 'golden_sword', `convertTo keeps the equipment (${z && held(z)})`);
  ok(z && Eq.getEquipped(z, IT.HEAD) && IT.nameOf(Eq.getEquipped(z, IT.HEAD).i) === 'golden_helmet', 'the golden helmet carries over');
  const nz = z && z.effects && (z.effects.nausea || (Array.isArray(z.effects) && z.effects.find((x) => x.id === 'nausea' || x.effect === 'nausea')));
  ok(!!nz, 'the zombified piglin wakes with Nausea');
  for (const admiring of [true, false]) {
    clear();
    const a = spawn('piglin'); Eq.setEquipped(a, IT.OFFHAND, Eq.stackOf('gold_ingot'));
    if (admiring) Pg.setAdmiring(a);
    const n0 = EL.list.length, za = Pg.zombify(a);
    const dropped = EL.list.some((o) => o.type === 'item');
    const off = za && Eq.getEquipped(za, IT.OFFHAND);
    if (admiring) ok(dropped && !off, 'an admiring piglin zombifies by dropping its offhand ingot');
    else ok(!dropped && !!off, 'a non-admiring piglin keeps its offhand through zombify (admiring assertion is not vacuous)');
  }
  clear();
  const b = spawn('piglin', 0.5, 0.5, () => 0); b.timeInOverworld = 300; Pg.tickEntity(b);
  const zb = EL.list.find((o) => o.type === 'zombified_piglin');
  ok(zb && zb.isBaby === true, 'a baby piglin becomes a BABY zombified piglin');
  clear();
  const im = spawn('piglin'); im.immuneToZombification = true;
  for (let t = 0; t < 400; t++) Pg.tickEntity(im);
  ok(!im.removed && im.timeInOverworld === 0, 'an IsImmuneToZombification piglin never converts');
  const br = spawn('piglin_brute'); for (let t = 0; t < 301; t++) Pg.tickEntity(br);
  ok(br.removed && EL.list.some((o) => o.type === 'zombified_piglin' && held(o) === 'golden_axe'), 'a brute zombifies too, axe in hand');
  clear();
}

// ── 3. permanent babies ──
ok(EL.PERMANENT_BABY.zombie && EL.PERMANENT_BABY.piglin && EL.PERMANENT_BABY.zombified_piglin && !EL.PERMANENT_BABY.cow,
  'EL.PERMANENT_BABY holds the HostileEntity baby types and not the animals');
{
  const src = readFileSync(join(MCLITE_ROOT, 'src', '07i_entitylist.js'), 'utf8');
  ok(/!EL\.PERMANENT_BABY\[e\.type\]\) NS\.Breed\.tickAge\(e\)/.test(src), 'EL.tick gates Breed.tickAge on EL.PERMANENT_BABY');
}

// ── 4. targets ──
const player = { type: 'player', x: 0.5, y: 64, z: 6.5, health: 20, inventory: { slots: new Array(46).fill(null) } };
M.Player = player;
const wearGold = (on) => { player.inventory.slots[M.Inventory.ARMOR_START + 3] = on ? Eq.stackOf('golden_helmet') : null; };
const adult = () => { const p = spawn('piglin', 0.5, 0.5, seq([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])); return p; };
{
  clear(); const p = adult();
  wearGold(false); ok(Pg.preferredTarget(p) === player, 'an adult piglin targets a player wearing no gold');
  wearGold(true); ok(Pg.preferredTarget(p) === null, 'a player in a golden helmet is left alone');
  const ws = spawn('wither_skeleton', 0.5, 3.5);
  wearGold(false); ok(Pg.preferredTarget(p) === ws, 'a wither skeleton (nemesis) is preferred over the player');
  const zp = spawn('zombified_piglin', 0.5, -4.5);
  ok(Pg.preferredTarget(p) === null, 'a zombified piglin within 6 blocks: no target at all');
  clear(); spawn('zoglin', 0.5, -4.5); wearGold(false);
  ok(Pg.preferredTarget(adult()) === null, 'a zoglin within 6 blocks counts as zombified: no target (PiglinBrain.isZombified)');
  clear();
  const b = spawn('piglin', 0.5, 0.5, () => 0);
  const g = new Pg.TargetGoal(b); ok(!g.canUse(), 'a baby piglin never picks a target');
  const br = spawn('piglin_brute'); wearGold(true);
  ok(Pg.preferredTarget(br) === player, 'a brute attacks a gold-wearing player within 12');
  player.z = 14.5; ok(Pg.preferredTarget(br) === null, 'a brute ignores a player 14 blocks away');
  player.z = 6.5; clear();
}

{
  clear(); M.Player = null;
  const p = adult(), ws = spawn('wither_skeleton', 0.5, 5.5);
  let hit = false; for (let t = 0; t < 400 && !hit; t++) { ws.ai.tick(); hit = ws.target === p; }
  ok(hit, 'a wither skeleton targets a piglin (WitherSkeletonEntity.initGoals, ActiveTargetGoal<AbstractPiglinEntity>)');
  M.Player = player; clear();
}
// ── 5. revenge ──
{
  clear(); wearGold(true);
  const a = adult(), b = spawn('piglin', 3.5, 0.5, seq([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
  a.lastHurtByEntity = player; a.hurtSeq = 1; Pg.tickEntity(a);
  ok(Pg.angryAt(a) === player && Pg.preferredTarget(a) === player, 'hit through gold: the piglin is angry at the player');
  ok(Pg.angryAt(b) === player, 'a nearby adult piglin joins in (angerAtCloserTargets)');
  const br = spawn('piglin_brute', 6.5, 0.5); br.lastHurtByEntity = a; br.hurtSeq = 1; Pg.tickEntity(br);
  ok(!Pg.angryAt(br), 'a brute never takes revenge on a piglin');
  clear(); wearGold(false);
}

// ── 6. xp ──
{
  const p = adult(); for (const s of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(p, s, Eq.stackOf('golden_boots'));
  ok(M.Xp.xpToDrop(p, () => 0.99) === 5, `a fully armoured piglin still drops 5 xp (${M.Xp.xpToDrop(p, () => 0.99)})`);
  const br = spawn('piglin_brute'); const x = M.Xp.xpToDrop(br, () => 0);
  ok(x === 21, `a brute drops 20 + 1 for its axe (${x})`);
  clear();
}

// ── 8. movement speed (blocks/second) — Dan: piglin_brute "feels too fast" even though its
// MOVEMENT_SPEED attribute (0.35) already matches the jar. Measured LIVE through the real
// walk path (`Ai.stepToward` -> `Ph.travelMob`, the same physics `mobmovecheck.mjs` §4 already
// pins as `a = mobSpeed² × (0.216/f³)` — read off `.decomp`'s own `LivingEntity.travel`, not
// invented here), not assumed from the attribute number alone: because the acceleration law is
// QUADRATIC in the attribute, a piglin's 0.35 (1.52× a zombie's 0.23) does NOT walk 1.52× a
// zombie's pace — it walks roughly (0.35/0.23)² ≈ 2.3× as fast, which is genuinely, faithfully
// vanilla (the same law `mobmovecheck` already proved correct against `.decomp`), not a stray
// multiplier this file owns. The decisive comparison is piglin vs piglin_brute: BOTH carry the
// SAME 0.35 attribute and the SAME MeleeAttackGoal speedModifier (1.0, `07zzf_piglin.js`
// itself, both branches) — if the brute alone were "too fast" from a bug (an AI goal not
// respecting the attribute, a tick-rate issue, a brute-only multiplier), its measured
// blocks/second would DIFFER from plain piglin's; it does not.
{
  function measure(type) {
    W.init(1);
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
      const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
    }
    EL.init(); EL.pushPlayer = () => null;
    const STONE = M.States.stateOf('stone') | 0, PY = 8;
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, PY, z, STONE);
    const e = (EL.random = () => 0.99, EL.spawn(type, 0.5, PY + 1, 0.5));   // 0.99 roll: never the 20% baby (faster)
    if (!e) return null;
    e.ai = { tick() { Ai.stepToward(e, { x: 100, y: PY + 1, z: 0 }, 1.0); } };
    for (let t = 0; t < 100; t++) EL.tickOne(e);          // reach steady-state terminal velocity
    const x0 = e.x;
    for (let t = 0; t < 20; t++) EL.tickOne(e);           // 20 ticks is exactly one second
    return e.x - x0;
  }
  const W = M.World, CH = M.CH, Ai = M.Ai;
  const zSpd = measure('zombie'), pSpd = measure('piglin'), bSpd = measure('piglin_brute');
  ok(zSpd !== null && pSpd !== null && bSpd !== null, 'zombie/piglin/piglin_brute all measured a live walking speed');
  ok(Math.abs(bSpd - pSpd) < 1e-6, `piglin_brute's live blocks/second must equal plain piglin's, not run faster on its own (piglin ${pSpd.toFixed(4)}, brute ${bSpd.toFixed(4)})`);
  // the quadratic law itself, checked against the SAME measured zombie baseline (not a second
  // guess at the formula) — (0.35/0.23)² within 1%, loose enough for friction-cube rounding,
  // tight enough that a linear (1.52×) stray-multiplier bug or a halved (0.76×) one both fail it.
  const attrRatio = M.Entities.attrsOf('piglin_brute').speed / M.Entities.attrsOf('zombie').speed;
  const wantRatio = attrRatio * attrRatio;
  const gotRatio = bSpd / zSpd;
  ok(Math.abs(gotRatio - wantRatio) / wantRatio < 0.01,
     `piglin_brute's speed advantage over zombie is the vanilla QUADRATIC law (attribute ratio ${attrRatio.toFixed(4)}, want speed ratio ${wantRatio.toFixed(4)}, got ${gotRatio.toFixed(4)}) — "too fast" is the jar's own attribute, not a code bug`);

  // anti-vacuity: a STRAY MULTIPLIER (exactly the shape Dan's report worried about — an AI goal
  // not respecting the attribute) really does move the needle on both assertions above.
  const savedStep = Ai.stepToward;
  Ai.stepToward = function (e, node, sm) { savedStep(e, node, e.type === 'piglin_brute' ? sm * 1.4 : sm); };
  const bSpdBroken = measure('piglin_brute');
  Ai.stepToward = savedStep;
  okAv(Math.abs(bSpdBroken - pSpd) >= 1e-6, `anti-vacuity: a 1.4× stray multiplier on the brute's own stepToward call must break the piglin==brute equality (got brute ${bSpdBroken.toFixed(4)} vs piglin ${pSpd.toFixed(4)})`);
}

{
  const W = M.World, keepDim = W.dimension;
  W.dimension = 'the_nether';
  const n = zombifyRun(); ok(n.at < 0 && !n.p.removed && !n.z, `a piglin never zombifies in the Nether (piglinSafe) — at ${n.at}`);
  W.dimension = 'overworld';
  const o = zombifyRun(); okAv(o.at === 301, 'the same run in the overworld still converts (nether assertion is not vacuous)');
  W.dimension = keepDim;
}
// ── 6b. PiglinEntity.startRiding: a baby onto a hoglin mounts getTopMostPassenger(hoglin, 3) ──
function stackRun() {
  clear();
  const h = spawn('hoglin', 0.5, 0.5); h.isBaby = true;
  const mk = () => { const p = spawn('piglin', 0.5, 0.5, () => 0); p.isBaby = true; p.pgRideTarget = h; p.pgRideUntil = 1e9; return p; };
  const a = mk(), b = mk(), c = mk();
  for (const p of [a, b, c]) Pg.tickRide(p);
  return { h, a, b, c };
}
{
  const { h, a, b, c } = stackRun();
  ok(a.vehicle === h && b.vehicle === a, 'the second baby piglin mounts the FIRST piglin, not the hoglin');
  ok(c.vehicle === b, 'the third rides the second (walk is depth-limited to 2 hops; the single-passenger model has no 4th seat)');
}
// ── 7. anti-vacuity ──
{
  const keep = Pg.ZOMBIFY_AFTER; Pg.ZOMBIFY_AFTER = 999;
  const { at } = zombifyRun(); Pg.ZOMBIFY_AFTER = keep;
  okAv(at !== 301, 'a 999-tick clock does not convert at 301');
  const g = Pg.GOLD_ARMOR.golden_helmet; delete Pg.GOLD_ARMOR.golden_helmet;
  clear(); const p = adult(); wearGold(true);
  okAv(Pg.preferredTarget(p) === player, 'without the gold rule a helmet no longer protects');
  Pg.GOLD_ARMOR.golden_helmet = g; wearGold(false);
  const kb = Pg.BABY_CHANCE; Pg.BABY_CHANCE = 0; clear();
  okAv(!spawn('piglin', 0.5, 0.5, () => 0).isBaby, 'BABY_CHANCE 0 spawns an adult on a 0.0 roll');
  Pg.BABY_CHANCE = kb;
  const kx = M.Xp.NO_EQUIP_BONUS.piglin; delete M.Xp.NO_EQUIP_BONUS.piglin;
  const q = adult(); Eq.setEquipped(q, IT.HEAD, Eq.stackOf('golden_helmet'));
  okAv(M.Xp.xpToDrop(q, () => 0.99) > 5, 'without NO_EQUIP_BONUS the armour adds xp');
  M.Xp.NO_EQUIP_BONUS.piglin = kx; clear();
  { const keepTop = Pg.isBaby; Pg.isBaby = () => false; const r = stackRun();   // an adult mounts the hoglin itself: walk is baby-only
    okAv(r.b.vehicle === r.h, 'non-baby piglins skip the top-most walk (stack assertion is not vacuous)'); Pg.isBaby = keepTop; clear(); }
}

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL piglincheck'); process.exit(1); }
console.log(`PASS piglincheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
