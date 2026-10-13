#!/usr/bin/env node
// fireworkcheck.mjs -- #5081 (G17-P8): FireworkRocketEntity + FireworkRocketItem (src/07zzy_firework.js).
//   node tools/fireworkcheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };


const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14c_raycast.js',
  '14f_inventory.js', '14l_use.js', '14j_combat.js', '07za_explosion.js', '07zzy_firework.js', '07zv_villagerbrain.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const S = MCL.States, B = MCL.Behave, EL = MCL.EntityList, Ent = MCL.Entities, Fw = MCL.Firework, Iv = MCL.Inventory, It = MCL.Items;

const N = 48, MID = 24;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15, clear() { cells.fill(0); } };
MCL.World = W; B.init(W); MCL.BlockEntities.init(); Ent.init(); EL.init(); MCL.Use.init(W);
if (MCL.Explosion.init) MCL.Explosion.init();
MCL.Physics.shapeAt = (x, y, z) => { const id = W.getBlock(x, y, z); return id === 0 || MCL.States.solid[id] !== 1 ? null : MCL.Physics.shapesFor(id); };
const fresh = () => { W.clear(); EL.init(); };
const stars = (n, flight) => ({ Fireworks: { Flight: flight, Explosions: Array.from({ length: n }, () => ({ Type: 0, Colors: [1] })) } });
const rocket = (x, y, z, n, flight, o) => EL.spawn('firework_rocket', x, y, z, Object.assign({ tag: stars(n, flight) }, o || {}));

ok(EL.canSpawn('firework_rocket') && !('firework_rocket' in EL.OWED_STAGE), 'firework_rocket is spawnable and no longer OWED');

// 1. lifetime range per Flight, and the exact formula with pinned draws
function lifeRange(flight) {
  let lo = 1e9, hi = -1;
  for (let i = 0; i < 400; i++) { fresh(); const e = rocket(0, 10, 0, 0, flight); lo = Math.min(lo, e.lifeTime); hi = Math.max(hi, e.lifeTime); }
  return [lo, hi];
}
for (const f of [1, 2, 3]) {
  const [lo, hi] = lifeRange(f);
  ok(lo >= 10 * (f + 1) && hi <= 10 * (f + 1) + 5 + 6, `Flight ${f}: lifeTime within ${10 * (f + 1)}..${10 * (f + 1) + 11} (got ${lo}..${hi})`);
  ok(hi - lo >= 8, `Flight ${f}: lifeTime actually varies (got ${lo}..${hi})`);
}
ok(Fw.lifeFor(2, () => 3) === 36, 'lifeFor(2, draws 3,3) = 36');

// 2. motion recurrence: vh *= 1.15, vy += 0.04 per tick (open sky)
{
  fresh();
  const e = rocket(0, 10, 0, 0, 3, { vx: 0.01, vy: 0.05, vz: 0.0 });
  e.lifeTime = 999;
  let vx = e.vx, vy = e.vy, good = true;
  for (let t = 0; t < 6; t++) {
    EL.tickOne(e);
    vx *= 1.15; vy += 0.04;
    if (Math.abs(e.vx - vx) > 1e-9 || Math.abs(e.vy - vy) > 1e-9) good = false;
  }
  ok(good, 'velocity follows *1.15 horizontally and +0.04 vertically each tick');
  ok(e.life === 6, 'life counts ticks');
}

// 3. explosion damage
function cowAt(x, y, z) { const c = EL.spawn('cow', x, y, z); c.health = 100; c.maxHealth = 100; return c; }
function blast(n, dist, wall) {
  fresh();
  if (wall) for (let y = 8; y <= 14; y++) for (let z = -2; z <= 2; z++) W.setBlock(1, y, z, S.stateOf('stone') | 0);
  const cow = cowAt(dist === 2 && wall ? 2 : dist, 10, 0);
  const e = rocket(0, 10, 0, n, 1); e.lifeTime = 0;
  EL.tickOne(e);
  return { lost: 100 - cow.health, gone: e.removed };
}
{
  const r0 = blast(0, 2), r1 = blast(1, 2), r3 = blast(3, 2), rw = blast(3, 2, true);
  ok(r0.gone && r0.lost === 0, `0 stars: rocket vanishes, no damage (lost ${r0.lost})`);
  const want1 = 7 * Math.sqrt(3 / 5), want3 = 11 * Math.sqrt(3 / 5);
  ok(Math.abs(r1.lost - want1) < 0.05, `1 star at 2 blocks: ${want1.toFixed(2)} (lost ${r1.lost})`);
  ok(Math.abs(r3.lost - want3) < 0.05, `3 stars at 2 blocks: ${want3.toFixed(2)} (lost ${r3.lost})`);
  ok(rw.lost === 0, `3 stars behind a wall: no damage (lost ${rw.lost})`);

  // anti-vacuity: damage without LOS
  const clr = Fw.clear; Fw.clear = () => true;
  okAv(blast(3, 2, true).lost > 0, 'damage without line of sight is noticed');
  Fw.clear = clr;
  // wrong lifetime formula
  const lf = Fw.lifeFor; Fw.lifeFor = (f) => 5 * f;
  fresh(); const bad = rocket(0, 10, 0, 0, 3);
  okAv(bad.lifeTime < 30, 'wrong lifetime formula is noticed');
  Fw.lifeFor = lf;
}

// 4. items: launch from block / air, stack decrement
const mkStack = (n, tag) => ({ i: It.of('firework_rocket'), n, d: 0, t: tag });
const mkP = (o) => Object.assign({ instabuild: false, syncHotbar() {}, x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, fallFlying: false }, o);
{
  fresh();
  const st = mkStack(3, stars(1, 2)), P = mkP();
  ok(Fw.useOnBlock(P, 5, 4, 5, 2, st), 'useOnBlock launches');
  const e = EL.list.find((q) => q.type === 'firework_rocket');
  ok(e && Math.abs(e.y - 4.15) < 1e-9 && e.x === 5 && st.n === 2, `launched at face offset +0.15 and stack 3 -> 2 (n=${st.n})`);
  fresh();
  const s2 = mkStack(3, stars(1, 1));
  ok(!Fw.useInAir(mkP(), s2) && s2.n === 3 && EL.list.length === 0, 'in air without gliding: nothing happens');
  const s3 = mkStack(3, stars(1, 1));
  ok(Fw.useInAir(mkP({ fallFlying: true }), s3) && s3.n === 2, 'gliding: attached rocket, stack shrinks');
  const att = EL.list.find((q) => q.type === 'firework_rocket');
  ok(att && att.shooter, 'rocket is attached to the user');
  const s4 = mkStack(3, stars(1, 1));
  Fw.useInAir(mkP({ fallFlying: true, instabuild: true }), s4);
  ok(s4.n === 3, 'creative does not shrink');
  const shrink = Iv.shrink; Iv.shrink = () => {};
  const s5 = mkStack(3, stars(1, 1));
  Fw.useInAir(mkP({ fallFlying: true }), s5);
  okAv(s5.n === 3 && s3.n === 2, 'not decrementing the stack is noticed (a stack that never shrinks differs from the real 3 -> 2)');
  Iv.shrink = shrink;
}

// 4b. glide boost: v += look*0.1 + (look*1.5 - v)*0.5 per tick, rocket rides the shooter
{
  const run = () => {
    fresh();
    const P = mkP({ fallFlying: true, yaw: 0.7, pitch: -0.3, vx: 0.2, vy: -0.1, vz: 0.05 });
    const r = Fw.spawn(P.x, P.y, P.z, { tag: stars(2, 1), shooter: P });
    const out = [];
    let v = [P.vx, P.vy, P.vz];
    const cp = Math.cos(-0.3), L = [Math.sin(0.7) * cp, Math.sin(-0.3), -Math.cos(0.7) * cp];
    let worst = 0;
    for (let t = 0; t < 5; t++) {
      v = v.map((c, i) => c + L[i] * 0.1 + (L[i] * 1.5 - c) * 0.5);
      Fw.tick(r);
      worst = Math.max(worst, Math.abs(P.vx - v[0]), Math.abs(P.vy - v[1]), Math.abs(P.vz - v[2]));
    }
    return worst;
  };
  ok(run() < 1e-12, 'gliding: 5 ticks of the exact vanilla boost velocity');
  const b = Fw.BOOST; Fw.BOOST = 1.0;
  okAv(run() > 1e-6, 'dropping the 1.5 factor is noticed');
  Fw.BOOST = b;
  fresh();
  const P2 = mkP({ vx: 0.2 }); const s = mkStack(3, stars(1, 1));
  ok(!Fw.useInAir(P2, s) && EL.list.length === 0 && P2.vx === 0.2, 'not gliding: nothing launched, velocity untouched');
}

// 5. VB.celebrate spawns a live entity
{
  fresh();
  const VB = MCL.VillagerBrain || MCL.VB;
  const before = EL.list.length;
  const r = EL.spawn('firework_rocket', 0, 10, 0, { color: 3, flight: 1 });
  ok(r && EL.list.length === before + 1 && r.lifeTime >= 10, 'VB.celebrate-style opts {color, flight} yield a live rocket with a lifetime');
  ok(Fw.explosionCount(r) === 1, 'celebrate rocket carries its one star');
}

// SN1 (#6171): launch / blast / large_blast / twinkle (+_far at 16 blocks)
{
  const log = []; const oldSnd = MCL.Sound, oldP = MCL.Player;
  MCL.Sound = Object.assign({}, oldSnd, { entitySound: (ev, x, y, z, v, p) => log.push([ev, v, p]) });
  MCL.Player = { x: 0, y: 0, z: 0, eyeHeight: 0 };
  const mk = (xs, x) => ({ x, y: 0, z: 0, tag: { Fireworks: { Flight: 1, Explosions: xs } } });
  const run = (xs, x) => { log.length = 0; Fw.blastSounds(mk(xs, x), () => 0.5); return log.map((l) => l[0].replace('entity.firework_rocket.', '')).join(','); };
  ok(run([{ Type: 0 }], 5) === 'blast', 'small ball near = blast');
  ok(run([{ Type: 0 }], 16) === 'blast_far', 'small ball at 16 = blast_far');
  ok(run([{ Type: 1 }], 5) === 'large_blast', 'large ball = large_blast');
  ok(run([{ Type: 1 }], 20) === 'large_blast_far', 'large ball far = large_blast_far');
  ok(run([{ Type: 0 }, { Type: 2 }, { Type: 4 }], 5) === 'large_blast', '3 stars = large_blast');
  ok(run([{ Type: 2 }], 5) === 'blast', 'star shape = blast');
  ok(run([{ Type: 0, Flicker: 1 }], 5) === 'blast,twinkle', 'flicker adds twinkle');
  ok(run([{ Type: 0, Flicker: 1 }], 30) === 'blast_far,twinkle_far', 'flicker far = twinkle_far');
  ok(log[0][1] === 20 && Math.abs(log[0][2] - 1.0) < 1e-9, 'blast volume 20, pitch 0.95+0.5*0.1');
  fresh(); log.length = 0;
  const r = rocket(0, 0, 0, 1, 1); Fw.tick(r);
  ok(log.length === 1 && log[0][0] === 'entity.firework_rocket.launch' && log[0][1] === 3, 'launch sound on first tick, volume 3');
  Fw.tick(r); ok(log.length === 1, 'launch only once');
  // anti-vacuity: without the call there is no sound
  const keep = Fw.sound; Fw.sound = () => {}; log.length = 0; Fw.blastSounds(mk([{ Type: 0 }], 5)); Fw.sound = keep;
  okAv(log.length === 0, 'removing the sound call silences the blast');
  okAv(run([{ Type: 0 }], 5) !== run([{ Type: 0, Flicker: 1 }], 5), 'twinkle only with Flicker');
  okAv(run([{ Type: 0 }], 5) !== run([{ Type: 0 }], 30), 'near/far differ');
  MCL.Sound = oldSnd; MCL.Player = oldP;
}

console.log(`fireworkcheck (#5081): ${pass} passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
