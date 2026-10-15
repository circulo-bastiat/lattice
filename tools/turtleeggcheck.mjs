#!/usr/bin/env node
// turtleeggcheck.mjs — #1253: `TurtleEggBlock` (.decomp/net/minecraft/block/TurtleEggBlock.java):
// randomTick hatch (skyAngle window / 1-in-500, sand below), onSteppedOn 1/100, onLandedUpon 1/3
// (never a zombie), breaksEgg (not Turtle/Bat, LivingEntity, player or mobGriefing), afterBreak.
//   node tools/turtleeggcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
console.log('turtleeggcheck — #1253, TurtleEggBlock behaviour');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js',
               '07q_effects.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07zp_turtle.js', '07zx_particle.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Tu = MCL.Turtle, Breed = MCL.Breed, W = MCL.World, S = MCL.States, R = MCL.Reg;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}


const B = MCL.Behave;
const sand = S.stateOf('sand'), egg = S.stateOf('turtle_egg');
const mk = (eggs, hatch) => B.setProp(B.setProp(egg, 'eggs', eggs), 'hatch', hatch);
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const turtles = () => EL.list.filter((e) => e.type === 'turtle');
const clear = () => { for (const e of EL.list.slice()) EL.remove ? EL.remove(e) : EL.list.splice(EL.list.indexOf(e), 1); };

function hatchRun(sky, rnd) {
  clear(); Tu.eggSounds.length = 0;
  W.setBlock(5, 60, 5, sand); W.setBlock(5, 61, 5, mk(3, 0));
  const seen = [];
  for (let t = 0; t < 2000; t++) {
    const st = W.getBlock(5, 61, 5);
    if (st === 0 || S.block[st] !== R.id.turtle_egg) break;
    seen.push(Tu.eggHatch(st));
    Tu.eggRandomTick(5, 61, 5, st, rnd, sky);
  }
  return { seen, gone: W.getBlock(5, 61, 5) === 0, babies: turtles() };
}
function trample(e, fn, n, seed) {
  const rnd = lcg(seed); let hits = 0;
  for (let i = 0; i < n; i++) {
    W.setBlock(8, 61, 8, mk(1, 0));
    if (fn(e, 8, 61, 8, rnd)) hits++;
  }
  return hits;
}

// 1. hatch at skyAngle 0.67 (inside the window) advances 0->1->2 then spawns EGGS babies
const hr = hatchRun(0.67, lcg(7));
ok(hr.seen.join() === '0,1,2', 'HATCH 0,1,2 then gone: ' + hr.seen);
ok(hr.gone, 'egg removed at hatch 2');
ok(hr.babies.length === 3, '3 babies expected, got ' + hr.babies.length);
for (const [i, b] of hr.babies.entries()) {
  ok(b.growAge === -24000, 'baby growAge -24000, got ' + b.growAge);
  ok(b.homeX === 5 && b.homeY === 61 && b.homeZ === 5, 'baby home = egg pos');
  ok(Math.abs(b.x - (5.3 + i * 0.2)) < 1e-9 && Math.abs(b.z - 5.3) < 1e-9, 'baby position pos+0.3+i*0.2');
}
ok(Tu.eggSounds.map((s) => s.ev).join() === 'entity.turtle.egg_crack,entity.turtle.egg_crack,entity.turtle.egg_hatch', 'sounds crack,crack,hatch: ' + Tu.eggSounds.map((s) => s.ev));
// outside the window: only the 1-in-500 roll hatches; with rnd always 0.9 nothing happens, always 0 it does
ok(hatchRun(0.5, () => 0.9).seen.length === 2000, 'outside window with no 1/500 roll the egg never progresses');
ok(hatchRun(0.5, () => 0).gone, 'rnd 0 -> nextInt(500)==0 hatches');
// no sand below: never hatches
W.setBlock(5, 60, 5, S.stateOf('dirt')); W.setBlock(5, 61, 5, mk(1, 0));
ok(Tu.eggRandomTick(5, 61, 5, mk(1, 0), () => 0, 0.67) === false && Tu.eggHatch(W.getBlock(5, 61, 5)) === 0, 'no sand below: no progress');
// the real random-tick path (Behave.randomTick) reaches it
W.setBlock(5, 60, 5, sand); W.setBlock(5, 61, 5, mk(1, 0));
ok(B.hasRandomTick(mk(1, 0)), 'Behave has a random-tick rule for turtle_egg');

// 2. trample rates
const player = MCL.Player || { type: 'player' };
const pig = { type: 'pig', maxHealth: 10 };
const N = 6000;
const stepP = trample(player, (e, x, y, z, r) => Tu.eggSteppedOn(e, x, y, z, r), N, 1) / N;
ok(Math.abs(stepP - 0.01) < 0.004, 'step-on rate ~1/100, got ' + stepP);
const landP = trample(pig, (e, x, y, z, r) => Tu.eggLandedUpon(e, x, y, z, r), N, 2) / N;
ok(Math.abs(landP - 1 / 3) < 0.03, 'land rate ~1/3, got ' + landP);
ok(trample({ type: 'zombie', maxHealth: 20 }, (e, x, y, z, r) => Tu.eggLandedUpon(e, x, y, z, r), 300, 3) === 0, 'zombie landing never breaks');
ok(trample({ type: 'zombie', maxHealth: 20 }, (e, x, y, z, r) => Tu.eggSteppedOn(e, x, y, z, () => 0), 20, 3) === 20, 'zombie stepping does');
ok(trample({ type: 'zombie', maxHealth: 20, sneaking: true }, (e, x, y, z) => Tu.eggSteppedOn(e, x, y, z, () => 0), 50, 3) === 0, 'sneaking (sneaking flag) never steps-breaks');
ok(trample({ type: 'player', edgeGuard: true }, (e, x, y, z) => Tu.eggSteppedOn(e, x, y, z, () => 0), 50, 3) === 0, 'sneaking (edgeGuard) never steps-breaks');
// 3. exclusions
const never = () => 0;
ok(trample({ type: 'turtle', maxHealth: 30 }, (e, x, y, z) => Tu.eggLandedUpon(e, x, y, z, never), 50, 4) === 0, 'turtle never breaks');
ok(trample({ type: 'bat', maxHealth: 6 }, (e, x, y, z) => Tu.eggLandedUpon(e, x, y, z, never), 50, 4) === 0, 'bat never breaks');
ok(trample({ type: 'item' }, (e, x, y, z) => Tu.eggLandedUpon(e, x, y, z, never), 50, 4) === 0, 'non-living never breaks');
// 4. break: EGGS-1 else gone, with the egg_break sound at 0.7
Tu.eggSounds.length = 0;
W.setBlock(8, 61, 8, mk(3, 0)); Tu.eggLandedUpon(pig, 8, 61, 8, never);
ok(Tu.eggCount(W.getBlock(8, 61, 8)) === 2, '3 eggs -> 2');
ok(Tu.eggSounds.length === 1 && Tu.eggSounds[0].ev === 'entity.turtle.egg_break' && Tu.eggSounds[0].volume === 0.7, 'egg_break sound 0.7');
const SJ = JSON.parse(readFileSync(new URL('../.mcdata/pc/sounds.json', import.meta.url), 'utf8'));
ok(['EGG_HATCH_SOUND','EGG_BORN_SOUND','EGG_BREAK_SOUND'].every((k) => JSON.stringify(SJ).includes('"' + Tu[k] + '"')), 'egg sound ids exist in vanilla sounds.json');
W.setBlock(8, 61, 8, mk(1, 0)); Tu.eggLandedUpon(pig, 8, 61, 8, never);
ok(W.getBlock(8, 61, 8) === 0, '1 egg -> gone');
W.setBlock(8, 61, 8, 0); Tu.eggAfterBreak(8, 61, 8, mk(2, 0));
ok(Tu.eggCount(W.getBlock(8, 61, 8)) === 1, 'afterBreak on a 2-stack leaves 1');
// mobGriefing off stops a mob but not the player
MCL.Commands = MCL.Commands || {}; const oldRule = MCL.Commands.ruleGet; MCL.Commands.ruleGet = () => 'false';
ok(!Tu.eggBreaksEgg(pig) && Tu.eggBreaksEgg(player), 'mobGriefing false: mob no, player yes');
MCL.Commands.ruleGet = oldRule;
// 5. worldEvent 2001 (break sound) once per eggBreak, both branches; 2005 on placement over sand
{
  const S = MCL.Sound = MCL.Sound || { blockBreak() {} }, orig = S.blockBreak; let nb = 0; S.blockBreak = () => { nb++; };
  W.setBlock(8, 61, 8, mk(3, 0)); Tu.eggBreak(8, 61, 8, W.getBlock(8, 61, 8), never);
  W.setBlock(8, 61, 8, mk(1, 0)); Tu.eggBreak(8, 61, 8, W.getBlock(8, 61, 8), never);
  S.blockBreak = orig;
  ok(nb === 2, 'Sound.blockBreak once per eggBreak (both branches): ' + nb);
  const P = MCL.Particle, ow = P.worldEvent; let ev = []; P.worldEvent = (id) => { ev.push(id); };
  const sand = MCL.States.stateOf('sand');
  W.setBlock(8, 60, 8, sand); Tu.placeEgg(8, 61, 8, never);
  W.setBlock(8, 60, 8, 0); Tu.placeEgg(8, 61, 8, never);
  P.worldEvent = ow;
  ok(ev.join() === '2005', '2005 only when placed over sand: ' + ev);
  P.list.length = 0; ok(ow(2005, 8, 61, 8, 0, never) > 0 && P.list.length > 0, '2005 spawns particles');
}

// ── anti-vacuity: break the module / the data and watch the assertions notice ────────────────
function caught(name, sabotage, restore, probe) {
  breaks++; sabotage(); let bad; try { bad = probe(); } finally { restore(); }
  ok(bad, 'anti-vacuity: ' + name + ' not noticed'); if (bad) console.log('   ✓ caught: ' + name);
}
{
  const o = Tu.eggBreaksEgg;
  caught('a turtle that breaks eggs', () => { Tu.eggBreaksEgg = () => true; }, () => { Tu.eggBreaksEgg = o; },
    () => trample({ type: 'turtle', maxHealth: 30 }, (e, x, y, z) => Tu.eggLandedUpon(e, x, y, z, never), 5, 4) > 0);
  caught('a bat that breaks eggs', () => { Tu.eggBreaksEgg = () => true; }, () => { Tu.eggBreaksEgg = o; },
    () => trample({ type: 'bat', maxHealth: 6 }, (e, x, y, z) => Tu.eggLandedUpon(e, x, y, z, never), 5, 4) > 0);
  const h = Tu.eggRandomTick;
  caught('an egg that never hatches', () => { Tu.eggRandomTick = () => false; }, () => { Tu.eggRandomTick = h; },
    () => hatchRun(0.67, lcg(7)).babies.length !== 3);
  const sh = Tu.eggShouldHatchProgress;
  caught('hatch ignoring the sky window', () => { Tu.eggShouldHatchProgress = () => false; }, () => { Tu.eggShouldHatchProgress = sh; },
    () => hatchRun(0.67, lcg(7)).seen.join() !== '0,1,2');
  const eb = Tu.eggBreak;
  caught('eggBreak without the break event', () => { Tu.eggBreak = (x, y, z, st) => { MCL.World.setBlock(x, y, z, 0); }; }, () => { Tu.eggBreak = eb; },
    () => { let nb = 0; const o = MCL.Sound.blockBreak; MCL.Sound.blockBreak = () => { nb++; }; W.setBlock(8, 61, 8, mk(1, 0)); Tu.eggBreak(8, 61, 8, W.getBlock(8, 61, 8), never); MCL.Sound.blockBreak = o; return nb !== 1; });
  const ea = Tu.eggAdded;
  caught('no 2005 on placement', () => { Tu.eggAdded = () => false; }, () => { Tu.eggAdded = ea; },
    () => { const P = MCL.Particle, ow = P.worldEvent; let n = 0; P.worldEvent = () => { n++; }; W.setBlock(8, 60, 8, MCL.States.stateOf('sand')); Tu.placeEgg(8, 61, 8, never); P.worldEvent = ow; return n !== 1; });
  const sp = Tu.eggSteppedOn;
  caught('a stepping rate of 1/1', () => { Tu.eggSteppedOn = (e, x, y, z, r) => sp(e, x, y, z, () => 0); }, () => { Tu.eggSteppedOn = sp; },
    () => Math.abs(trample(player, (e, x, y, z, r) => Tu.eggSteppedOn(e, x, y, z, r), 500, 1) / 500 - 0.01) > 0.004);
  const lu = Tu.eggLandedUpon;
  caught('zombies breaking on landing', () => { Tu.eggLandedUpon = (e, x, y, z, r) => lu({ type: 'pig', maxHealth: 1 }, x, y, z, () => 0); }, () => { Tu.eggLandedUpon = lu; },
    () => trample({ type: 'zombie', maxHealth: 20 }, (e, x, y, z, r) => Tu.eggLandedUpon(e, x, y, z, r), 20, 3) > 0);
}

console.log('================ turtleeggcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
