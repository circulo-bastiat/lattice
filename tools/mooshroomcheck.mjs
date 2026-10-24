#!/usr/bin/env node
// mooshroomcheck.mjs — s101 orchestrator (QUEUE 0.2 G18c): the MOOSHROOM + cow milking.
// Every rule is MooshroomEntity/CowEntity (.decomp, read whole); the numbers the game owns
// (1024 mutation, 5 drops, the flower effect table) are read back from .decomp/the packed
// recipe table, never typed here. Sections: 1 exists (motion/roster/spawn rule/type/skin),
// 2 milk (cow + mooshroom, baby refused), 3 bowl (plain + suspicious stew), 4 brown + flower,
// 5 shears -> cow + 5 mushrooms, 6 lightning flip, 7 child type (breed path), with breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
console.log('mooshroomcheck — s101 (QUEUE 0.2 G18c), the mooshroom + cow milking');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js',
  '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07n_tame.js', '07zn_mooshroom.js', '07zx_particle.js', '14h_brigadier.js', '15g_commands.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities, Mo = MCL.Mooshroom;
const Breed = MCL.Breed, W = MCL.World, S = MCL.States, Use = MCL.Use, Iv = MCL.Inventory, CH = MCL.CH, IT = MCL.Items;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs; W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); Spawn.init(); Breed.init();
if (MCL.Combat && MCL.Combat.init) MCL.Combat.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const SRC = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/passive/MooshroomEntity.java'), 'utf8');

// 1. exists
{
  ok(Mo && Mo.ready, 'NS.Mooshroom did not load');
  ok(EL.canSpawn('mooshroom'), 'EL.canSpawn(mooshroom) is false — no motion row');
  ok(Ai.ROSTER.mooshroom === Ai.ROSTER.cow, 'mooshroom must reuse cow\'s goal roster (it declares no initGoals)');
  const m = EL.spawn('mooshroom', 0, 64, 0, {});
  ok(m && m.mooshroomType === 'red', `a fresh mooshroom is red (initDataTracker default), got ${m && m.mooshroomType}`);
  ok(+(SRC.match(/MUTATION_CHANCE = (\d+)/) || [])[1] === Mo.MUTATION_CHANCE, 'MUTATION_CHANCE matches the jar');
  ok(/for \(int \$\$2 = 0; \$\$2 < (\d+);/.test(SRC) && +SRC.match(/for \(int \$\$2 = 0; \$\$2 < (\d+);/)[1] === Mo.SHEAR_DROPS, 'SHEAR_DROPS matches sheared()\'s loop bound');
  ok(MCL.Tame.skinKey({ type: 'mooshroom', mooshroomType: 'brown' }) === 'mooshroom_brown', 'a brown mooshroom picks the brown_mooshroom skin');
  okAv(MCL.Tame.skinKey({ type: 'mooshroom', mooshroomType: 'red' }) === null, 'a red one keeps the base skin (the skin pick reads the type)');
  const ex = readFileSync(join(MCLITE_ROOT, 'tools/extract-mob-textures.mjs'), 'utf8');
  ok(/mooshroom: P\('cow\/red_mooshroom\.png'\)/.test(ex) && /mooshroom_brown: P\('cow\/brown_mooshroom\.png'\)/.test(ex), 'the extractor maps both mooshroom skins to the jar\'s real paths');
  // spawn rule
  ok(typeof Spawn.RULES.mooshroom === 'function', 'Spawn.RULES.mooshroom not wired');
  W.setBlock(0, 63, 0, S.stateOf('mycelium') | 0); W.setBlock(0, 63, 1, S.stateOf('grass_block') | 0);
  const sb = W.rawBrightness; W.rawBrightness = () => 9;
  ok(Spawn.RULES.mooshroom(0, 64, 0) === true, 'mycelium below (#mooshrooms_spawnable_on) + light 9 passes');
  okAv(Spawn.RULES.mooshroom(0, 64, 1) === false, 'grass_block below is not in #mooshrooms_spawnable_on — refused');
  W.rawBrightness = () => 8;
  okAv(Spawn.RULES.mooshroom(0, 64, 0) === false, 'light 8 (the >8 animal rule) refuses');
  W.rawBrightness = sb;
}
const use = (e, name, opts = {}) => {
  const inv = Iv.create(); const st = { i: IT.of(name), n: opts.n || 1 }; Iv.setItem(inv, 0, st);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: !!opts.creative, targetEntity: e };
  const h = Use.entityUse(P, e, st); const s0 = Iv.getItem(inv, 0);
  return { h, name: s0 && s0.n > 0 ? IT.nameOf(s0.i) : null, n: s0 ? s0.n : 0, stack: s0 };
};
// 2. milk
{
  const cow = EL.spawn('cow', 2, 64, 0, {}); cow.isBaby = false;
  ok(use(cow, 'bucket').name === 'milk_bucket', 'a bucket on an adult COW milks it (CowEntity.interactMob)');
  const moo = EL.spawn('mooshroom', 2, 64, 1, {}); moo.isBaby = false;
  ok(use(moo, 'bucket').name === 'milk_bucket', 'a mooshroom inherits cow milking');
  const calf = EL.spawn('cow', 2, 64, 2, {}); calf.isBaby = true;
  okAv(use(calf, 'bucket').name !== 'milk_bucket', 'a baby cow is not milkable (!isBaby)');
}
// 3. bowl
{
  const moo = EL.spawn('mooshroom', 3, 64, 0, {}); moo.isBaby = false;
  ok(use(moo, 'bowl').name === 'mushroom_stew', 'a bowl on a mooshroom with no stored effect gives mushroom_stew');
  moo.stewEffect = { id: 16, ticks: 100 };
  const r = use(moo, 'bowl');
  const tg = r.stack && (r.stack.t || r.stack.tag);
  ok(r.name === 'suspicious_stew' && tg && tg.Effects && tg.Effects[0].EffectId === 16 && tg.Effects[0].EffectDuration === 100, `a stored effect makes suspicious_stew carrying it, got ${JSON.stringify(r.stack)}`);
  ok(moo.stewEffect === null, 'and the stored effect is cleared');
  const cow = EL.spawn('cow', 3, 64, 1, {}); cow.isBaby = false;
  okAv(use(cow, 'bowl').name === 'bowl', 'a bowl on a plain COW does nothing (only mooshroom has the stew branch)');
}
// 4. brown + flower
{
  const R = MCL.Recipes; const fl = R.flowers && R.flowers.oxeye_daisy;
  ok(!!fl, 'the packed flower-effect table has oxeye_daisy');
  const b = EL.spawn('mooshroom', 4, 64, 0, {}); b.isBaby = false; b.mooshroomType = 'brown';
  const r = use(b, 'oxeye_daisy', { n: 3 });
  ok(r.h === true && r.n === 2, `a brown mooshroom eats one small flower, got handled=${r.h} left=${r.n}`);
  ok(b.stewEffect && b.stewEffect.id === fl.id && b.stewEffect.ticks === fl.ticks, `and stores the flower's own effect ${JSON.stringify(fl)}, got ${JSON.stringify(b.stewEffect)}`);
  ok(b.stewEffect.ticks === 160, 'oxeye_daisy regeneration 8s is stored as 160 ticks');
  { const d = EL.spawn('mooshroom', 4, 64, 2, {}); d.isBaby = false; d.mooshroomType = 'brown'; use(d, 'dandelion', { n: 1 });
    ok(d.stewEffect && d.stewEffect.ticks === 7, `FlowerBlock stores an INSTANT effect's seconds as-is: dandelion saturation = 7, got ${d.stewEffect && d.stewEffect.ticks}`); }
  const r2 = use(b, 'oxeye_daisy', { n: 3 });
  okAv(r2.h === true && r2.n === 3, 'with an effect already stored, a second flower is NOT consumed');
  const red = EL.spawn('mooshroom', 4, 64, 1, {}); red.isBaby = false;
  const r3 = use(red, 'oxeye_daisy', { n: 3 });
  okAv(!red.stewEffect && r3.n === 3, 'a RED mooshroom takes no flower (the branch is brown-only)');
}
// 5. shears
{
  EL.clear && EL.clear();
  const m = EL.spawn('mooshroom', 5, 64, 0, {}); m.isBaby = false; m.mooshroomType = 'brown'; m.health = 7; m.yaw = 1.25;
  const drops = []; const sd = EL.dropStack; EL.dropStack = (x, y, z, item, n) => { drops.push([item, n]); };
  const r = use(m, 'shears');
  EL.dropStack = sd;
  ok(r.h === true, 'shears on an adult mooshroom are handled');
  ok(m.removed || EL.list.indexOf(m) < 0, 'the mooshroom is discarded');
  const cow = EL.list.find(e => e.type === 'cow');
  ok(cow && cow.health === 7 && cow.yaw === 1.25, `a cow takes its place with its health and yaw, got ${cow && cow.health}/${cow && cow.yaw}`);
  ok(drops.length === 5 && drops.every(d => d[0] === 'brown_mushroom' && d[1] === 1), `5 single brown_mushroom drops, got ${JSON.stringify(drops)}`);
  ok(r.stack && r.stack.d === 1, `the shears take 1 durability, got ${JSON.stringify(r.stack)}`);
  const baby = EL.spawn('mooshroom', 5, 64, 2, {}); baby.isBaby = true;
  use(baby, 'shears');
  okAv(!baby.removed && EL.list.indexOf(baby) >= 0, 'a baby mooshroom is not shearable');
}
// 6. lightning
{
  const m = { type: 'mooshroom', mooshroomType: 'red' };
  ok(Mo.onLightning(m, 'bolt-1') && m.mooshroomType === 'brown', 'lightning turns red -> brown');
  okAv(!Mo.onLightning(m, 'bolt-1') && m.mooshroomType === 'brown', 'the SAME bolt striking again does not flip it back (lightningId)');
  ok(Mo.onLightning(m, 'bolt-2') && m.mooshroomType === 'red', 'a new bolt flips it back to red');
}
// 7. child type
{
  const r = { type: 'mooshroom', mooshroomType: 'red' }, br = { type: 'mooshroom', mooshroomType: 'brown' };
  ok(Mo.chooseBabyType(r, r, () => 0) === 'brown', 'same-type parents + nextInt(1024)==0 mutate to the OTHER type');
  ok(Mo.chooseBabyType(r, r, () => 1 / 1024) === 'red', 'nextInt(1024)==1 does not mutate');
  ok(Mo.chooseBabyType(r, br, () => 0) === 'red' && Mo.chooseBabyType(r, br, () => 0.9) === 'brown', 'mixed parents: nextBoolean picks this / other');
  okAv(Mo.chooseBabyType(r, br, () => 0) !== 'brown', 'mixed parents never take the mutation branch');
  ok(!Breed.SPECIAL.mooshroom, 'Breed.SPECIAL no longer refuses mooshroom');
  const a = EL.spawn('mooshroom', 6, 64, 0, {}); const b = EL.spawn('mooshroom', 6.3, 64, 0, {});
  a.mooshroomType = 'brown'; b.mooshroomType = 'brown';
  Breed.setInLove(a, null); Breed.setInLove(b, null); Breed.setAge(a, 0); Breed.setAge(b, 0);
  const kid = Breed.breed(a, b, { random: () => 0.5 });
  ok(kid && kid.type === 'mooshroom' && kid.mooshroomType === 'brown', `the live breed path gives a brown calf from two brown parents, got ${kid && kid.mooshroomType}`);
  const save = Breed.CHILD.mooshroom; delete Breed.CHILD.mooshroom;
  const a2 = EL.spawn('mooshroom', 7, 64, 0, {}); const b2 = EL.spawn('mooshroom', 7.3, 64, 0, {});
  a2.mooshroomType = b2.mooshroomType = 'brown';
  Breed.setInLove(a2, null); Breed.setInLove(b2, null); Breed.setAge(a2, 0); Breed.setAge(b2, 0);
  const kid2 = Breed.breed(a2, b2, { random: () => 0.5 });
  okAv(kid2 && kid2.mooshroomType !== 'brown', 'with Breed.CHILD.mooshroom removed the calf is NOT brown — the rule is what sets it');
  Breed.CHILD.mooshroom = save;
}
// 8. getPathfindingFavor: the stroll picks the highest-favour of 10 candidates (mycelium 10 beats brightness-0.5)
{
  const myc = S.stateOf('mycelium') | 0, grs = S.stateOf('grass_block') | 0;
  const sg = W.getBlock, sgl = Ai.groundLevel, sfp = Ai.findPath, spp = Ai.pathPenalty, sbr = W.rawBrightness;
  W.getBlock = (x, y, z) => (y === 63 ? (x >= 0 ? myc : grs) : 0);
  Ai.groundLevel = () => 64; Ai.pathPenalty = () => 0; W.rawBrightness = () => 15;
  let tgt = null; Ai.findPath = (x, y, z, tx) => { tgt = tx; return [{ x, y, z }, { x: tx, y: 64, z: 0 }]; };
  const rate = (favor) => {
    let on = 0, N = 400, seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < N; i++) {
      const e = { x: 0.5, y: 64, z: 0.5, type: 'mooshroom' }; tgt = null;
      new Ai.WaterAvoidingRandomStrollGoal(e, 1, rnd, favor).start();
      if (tgt !== null && Math.floor(tgt) >= 0) on++;
    }
    return on / N;
  };
  const withF = rate(Ai.mooshroomPathfindingFavor), without = rate(null);
  ok(withF > 0.9, `favour picks mycelium nearly always on a mycelium/grass border, got ${withF}`);
  ok(without < 0.7, `without favour the stroll is ~uniform, got ${without}`);
  okAv(withF > without + 0.25, 'with the favour function removed the mycelium rate collapses to the uniform one');
  ok(Ai.mooshroomPathfindingFavor(1, 64, 0) === 10 && Ai.mooshroomPathfindingFavor(-1, 64, 0) < 1, 'favour: mycelium 10, else brightness-0.5');
  { const PG = Ai.PanicGoal; let got; const cap = (type) => { Ai.PanicGoal = function (e, sp, o) { got = o && o.favor; return PG.apply(this, arguments); }; try { Ai.ROSTER.cow({ type, x: 9, y: 64, z: 9 }, {}); } finally { Ai.PanicGoal = PG; } return got; };
    ok(cap('mooshroom') === Ai.mooshroomPathfindingFavor, 'mooshroom PanicGoal gets mooshroomPathfindingFavor (#4760)');
    okAv(cap('cow') !== Ai.mooshroomPathfindingFavor, 'a plain cow panic goal does not get the mycelium favour'); }
  W.getBlock = sg; Ai.groundLevel = sgl; Ai.findPath = sfp; Ai.pathPenalty = spp; W.rawBrightness = sbr;
}
// 8. sounds/particles per branch
{
  const snd = (fn) => { Mo.fx.log.length = 0; fn(); return Mo.fx.log.filter(x => x.sound).map(x => x.sound + '@' + x.volume).join(','); };
  const cnt = (k) => Mo.fx.log.filter(x => x.particle === k).length;
  const m = () => EL.spawn('mooshroom', 9, 64, 9, {});
  ok(snd(() => Mo.interact(m(), 'bowl', {})) === 'entity.mooshroom.milk@1', 'bowl -> MOOSHROOM_MILK');
  { const a = m(); a.stewEffect = { id: 1, ticks: 100 };
    ok(snd(() => Mo.interact(a, 'bowl', {})) === 'entity.mooshroom.suspicious_milk@1', 'bowl with effect -> SUSPICIOUS_MILK'); }
  { // #3102: CowEntity.interactMob plays the milk on the PLAYER (source 'player', at the player)
    const NS = MCL, S = NS.Sound || (NS.Sound = {}), sp = S.play, se = S.entitySound, sP = NS.Player; const calls = [];
    S.play = (ev, o) => calls.push({ ev, o }); S.entitySound = (ev) => calls.push({ ev, o: { source: 'neutral' } });
    NS.Player = { x: 1, y: 2, z: 3 };
    const milk = () => { calls.length = 0; Mo.interact(EL.spawn('cow', 9, 64, 9, {}), 'bucket', {}); return calls[0]; };
    const c = milk();
    ok(c && c.ev === 'entity.cow.milk' && c.o.source === 'player' && c.o.x === 1 && c.o.y === 2 && c.o.z === 3, 'cow milk sound: source player at the player pos');
    NS.Player = null; okAv(!(milk() || { o: {} }).o.x, 'anti-vacuity: without a player the position test cannot pass');
    S.play = sp; S.entitySound = se; NS.Player = sP;
  }
  ok(snd(() => Mo.interact(m(), 'shears', {})) === 'entity.mooshroom.shear@1' && cnt('explosion') === 1, 'shears -> SHEAR + 1 explosion');
  { const Px = MCL.Particle; Px.init(); const e = m(); Mo.interact(e, 'shears', {});
    const L = Px.list.filter(p => p.type === 'explosion');
    ok(L.length === 1 && L[0].x === e.x && L[0].z === e.z && Math.abs(L[0].y - (e.y + e.height * 0.5)) < 1e-9, 'shear leaves one live explosion particle at body y+0.5');
    Px.init(); Mo.interact(m(), 'bowl', {});
    okAv(Px.list.filter(p => p.type === 'explosion').length === 0, 'no explosion particle when not sheared'); }
  { const b = m(); b.mooshroomType = 'brown';
    ok(snd(() => Mo.interact(b, 'dandelion', {})) === 'entity.mooshroom.eat@2' && cnt('effect') === 4, 'flower -> EAT vol 2 + 4 effect particles');
    ok(snd(() => Mo.interact(b, 'dandelion', {})) === '' && cnt('smoke') === 2, 'second flower -> 2 smoke, no sound'); }
  ok(snd(() => Mo.interact(EL.spawn('cow', 9, 64, 9, {}), 'bucket', {})) === 'entity.cow.milk@1', 'cow bucket -> COW_MILK');
  ok(snd(() => Mo.onLightning(m(), 'bolt-z')) === 'entity.mooshroom.convert@2', 'lightning -> CONVERT vol 2');
  okAv(snd(() => Mo.interact(EL.spawn('cow', 9, 64, 9, {}), 'wheat', {})) === '', 'a non-branch item makes no sound');
  { const b = m(); b.isBaby = true; okAv(snd(() => Mo.interact(b, 'bowl', {})) === '', 'baby bowl: no sound'); }
  { const a = m(); a.customName = 'x'; a.customNameVisible = true; const c = Mo.applyShear(a, Mo.shear(a));
    ok(c && c.customNameVisible === true, 'sheared cow keeps customNameVisible'); }
  { const a = m(); const before = new Set(EL.all ? EL.all() : []);
    Mo.applyShear(a, Mo.shear(a));
    const drops = (EL.all ? EL.all() : []).filter((x) => x.type === 'item' && !before.has(x));
    ok(drops.length > 0 && drops.every((x) => x.pickupDelay === 0), 'shear drops have pickupDelay 0 (raw ItemEntity ctor)');
    okAv(EL.dropStack(9, 64, 9, 'brown_mushroom', 1).pickupDelay !== 0, 'a default dropStack drop (delay 10) is what the check rejects'); }
}
{ const mk = () => EL.spawn('mooshroom', 9, 64, 9, {});
  const b = mk(); MCL.Commands.applyNbt(b, { Type: 'brown', EffectId: 8, EffectDuration: 140 });
  ok(b.mooshroomType === 'brown' && b.stewEffect && b.stewEffect.id === 8 && b.stewEffect.ticks === 140, '/summon mooshroom {Type:brown,EffectId:8,EffectDuration:140} applies');
  const r = mk(); MCL.Commands.applyNbt(r, { Type: 'bogus' });
  ok(r.mooshroomType === 'red' && !r.stewEffect, 'unknown Type -> red, no effect');
  okAv(mk().mooshroomType !== 'brown' && !mk().stewEffect, 'a mooshroom with no NBT applied stays red (the test can fail)'); }
console.log('================ mooshroomcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
