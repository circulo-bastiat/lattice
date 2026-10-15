#!/usr/bin/env node
// parrotcheck.mjs — #1224: ParrotEntity's 5-colour Variant. Drives the REAL modules against
// `.decomp/net/minecraft/entity/passive/ParrotEntity.java` (initialize :134 setVariant(nextInt(5)),
// getVariant clamp 0..4 :415, "Variant" NBT :432/:438).
//   1. spawn rolls cover 0..4 (and opts.variant wins)
//   2. Fl.skinKey -> parrot, parrot#1..#4, clamped; non-parrot null; every key has packed geometry
//   3. "Variant" is persisted (MobNbt.fieldsFor) and survives an EL.spawn round trip
//   4. anti-vacuity
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ breaks caught: ' + m); };

console.log('parrotcheck — #1224, parrot Variant (5 colours)');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07t_fly.js', '07zw_mobnbt.js', '07zx_particle.js', '14e_gamemode.js', '07zk_undead.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Fl = MCL.Fly, Mb = MCL.MobNbt, W = MCL.World, CH = MCL.CH;
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
W.init(1); MCL.Behave.init(W); EL.init(); MCL.Ai.init(); MCL.Spawn.init(); MCL.Breed.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
ok(Fl && Fl.skinKey, 'Fly.skinKey missing');

// 1. spawn rolls
const seen = new Set();
for (let i = 0; i < 100; i++) { const e = EL.spawn('parrot', 4 + i * 0.01, 70, 4); if (e) seen.add(e.parrotVariant); }
ok([0, 1, 2, 3, 4].every((v) => seen.has(v)) && seen.size === 5, `100 spawned parrots covered variants {${[...seen]}}, expected exactly 0..4`);
const forced = EL.spawn('parrot', 5, 70, 5, { variant: 3 });
ok(forced && forced.parrotVariant === 3, 'opts.variant 3 not honoured');

// 2. skin keys
const want = ['parrot', 'parrot#1', 'parrot#2', 'parrot#3', 'parrot#4'];
const geom = rdj('mob-geometry.json');
for (let v = 0; v < 5; v++) {
  const k = Fl.skinKey({ type: 'parrot', parrotVariant: v });
  ok(k === want[v], `variant ${v} -> ${k}, expected ${want[v]}`);
  ok(!!geom.layers[k], `no packed geometry for ${k}`);
}
ok(Fl.skinKey({ type: 'parrot', parrotVariant: 9 }) === 'parrot#4', 'variant 9 must clamp to 4');
ok(Fl.skinKey({ type: 'parrot', parrotVariant: -2 }) === 'parrot', 'variant -2 must clamp to 0');
ok(Fl.skinKey({ type: 'cow', parrotVariant: 2 }) === null, 'non-parrot must be null');

// 3. persistence
ok(Mb.fieldsFor('parrot').indexOf('parrotVariant') >= 0, 'MobNbt.fieldsFor(parrot) lacks parrotVariant ("Variant" NBT)');
const e2 = EL.spawn('parrot', 6, 70, 6, { variant: 4 });
ok(e2 && e2.parrotVariant === 4, 'spawn(variant 4) lost it');

// 5. #1586 feeding: entity.parrot.eat sound + heart/smoke burst; no sound when silent
{
  const calls = [], bursts = [];
  const Px = MCL.Particle, oS = MCL.Sound, oP = Px.spawnBurst;
  MCL.Sound = { play: (ev, o) => calls.push([ev, o]) };
  Px.spawnBurst = (k) => bursts.push(k);
  const feed = (silent, r) => { calls.length = 0; bursts.length = 0;
    const p = EL.spawn('parrot', 8, 70, 8); p.silent = silent;
    Fl.feed(p, 'wheat_seeds', { random: r }); return p; };
  feed(false, () => 0.5);
  ok(calls.length === 1 && calls[0][0] === 'entity.parrot.eat' && calls[0][1].volume === 1 &&
     calls[0][1].pitch >= 0.8 && calls[0][1].pitch <= 1.2, 'feed must play entity.parrot.eat vol 1 pitch 0.8..1.2');
  ok(bursts.join() === 'smoke', 'failed tame must spawn smoke, got ' + bursts);
  const t = feed(false, () => 0);
  ok(t.tamed && bursts.join() === 'heart', 'successful tame must spawn hearts, got ' + bursts);
  feed(true, () => 0.5);
  ok(calls.length === 0 && bursts.join() === 'smoke', 'silent parrot must play no sound (particles still)');
  const f0 = Fl.feed;
  Fl.feed = (e, i, c) => { const r = f0(e, i, c); calls.length = 0; return r; };
  feed(false, () => 0.5);
  okAv(calls.length === 0, 'dropping the sound call was visible');
  Fl.feed = f0;
  Px.spawnBurst = () => {};
  feed(false, () => 0.5);
  okAv(bursts.length === 0, 'dropping the particle burst was visible');
  MCL.Sound = oS; Px.spawnBurst = oP;
}

// 6. #2475 locateTree scan order = BlockPos.iterate (X fastest, Z slowest): first match wins
{
  const P = MCL.Physics, T = MCL.Tags, St = MCL.States;
  const oB = P.blockAt, oT = T, oS = St.block, oR = T.ready, oBT = T.blockTag, oIC = T.blockInCol;
  const e = { x: 100.5, y: 70, z: 100.5 };
  const leaves = new Set(['102,69,99', '98,69,101']); // A (+2,0,-1) vs B (-2,0,+1)
  P.blockAt = (x, y, z) => (leaves.has(x + ',' + y + ',' + z) ? 1 : 0);
  St.block = [-1, 7]; T.ready = true; T.blockTag = () => 0; T.blockInCol = (c, id) => id === 7;
  const r = Fl.locateTree(e);
  ok(r && r.x === 102.5 && r.z === 99.5, 'locateTree must pick the lowest-Z perch first, got ' + JSON.stringify(r));
  okAv(!(r && r.x === 98.5), 'x-outer order (old bug) would pick the other perch');
  P.blockAt = oB; St.block = oS; T.ready = oR; T.blockTag = oBT; T.blockInCol = oIC;
}

// 7. #3528 ParrotEntity.pushAway is a no-op for a player: pushAround must not move the player
{
  const pl = { x: 7, y: 70, z: 7, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, maxHealth: 20 };
  const pr = EL.spawn('parrot', 7.1, 70, 7);
  const oP = EL.pushPlayer; EL.pushPlayer = () => pl;
  EL.pushAround(pr);
  ok(pl.vx === 0 && pl.vz === 0, 'parrot shoved the player: ' + pl.vx + ',' + pl.vz);
  ok(pr.vx !== 0 || pr.vz !== 0, 'parrot should still be shoved by the player');
  const pg = EL.spawn('pig', 7.1, 70, 7); pl.vx = pl.vz = 0; pr.dead = true;
  EL.pushAround(pg);
  okAv(pl.vx !== 0 || pl.vz !== 0, 'a pig must still shove the player (guard is parrot-only)');
  EL.pushPlayer = oP;
}

// 8. #3931 PlayerEntity.tickMovement drop conditions + SitOnOwnerShoulderGoal.canStart owner gates
{
  const mk = (o) => Object.assign({ x: 7, y: 70, z: 7, shoulderLeft: { type: 'parrot' }, shoulderRight: null, shoulderAge: 30, onGround: true }, o);
  const dropped = (o) => { const p = mk(o); Fl.tickShoulders(p); return !p.shoulderLeft; };
  ok(!dropped({}), 'idle player must keep the shoulder parrot');
  ok(dropped({ fallDistance: 0.6 }), 'fallDistance>0.5 must drop');
  okAv(!dropped({ fallDistance: 0.5 }), 'fallDistance==0.5 must not drop');
  ok(dropped({ sleeping: true }), 'sleeping must drop');
  const oIn = Fl.inPowderSnow; Fl.inPowderSnow = () => true;
  ok(dropped({}), 'powder snow must drop');
  const pr = EL.spawn('parrot', 9, 70, 9); pr.tamed = true; pr.owner = 'player'; pr.age = 200;
  const canUse = (o) => new Fl.SitOnOwnerShoulderGoal(pr, () => [o]).canUse();
  ok(!canUse(mk({ shoulderLeft: null })), 'powder-snow owner must refuse the shoulder goal');
  Fl.inPowderSnow = oIn;
  ok(canUse(mk({ shoulderLeft: null })), 'plain owner must accept the shoulder goal');
  ok(!canUse(mk({ shoulderLeft: null, mode: MCL.Gamemode.SPECTATOR })), 'spectator owner must refuse the shoulder goal');
}

// 9. #4659 BirdNavigation: a parrot behind an L-shaped wall routes AROUND it (path > straight line), never into it
{
  const stone = MCL.Reg.id.stone, air = 0;
  // wall x=20, z=12..28, y=68..76 with a return leg at z=28 (x=20..26): the straight line from (18,70,20) to (22,70,20) is blocked
  const cells = [];
  for (let z = 12; z <= 28; z++) for (let y = 68; y <= 76; y++) cells.push([20, y, z]);
  for (let x = 20; x <= 26; x++) for (let y = 68; y <= 76; y++) cells.push([x, y, 28]);
  for (const [x, y, z] of cells) W.setBlock(x, y, z, stone);
  const run = (wall) => {
    const p = EL.spawn('parrot', 18.5, 70, 20.5); p.onGround = false;
    let near = 1e9, travelled = 0, lx = p.x, ly = p.y, lz = p.z;
    for (let i = 0; i < 700; i++) {
      p.flyMove.setWantedPosition(22.5, 70.5, 20.5, 1.0); p.flyMove.tick(); Fl.travelMob(p);
      travelled += Math.hypot(p.x - lx, p.y - ly, p.z - lz); lx = p.x; ly = p.y; lz = p.z;
      near = Math.min(near, Math.hypot(p.x - 22.5, p.y - 70.5, p.z - 20.5));
    }
    return { near, travelled, p };
  };
  const r = run();
  ok(r.near < 1.5, `parrot behind the L-wall never reached the target (closest ${r.near.toFixed(2)})`);
  ok(r.travelled > 8, `parrot path ${r.travelled.toFixed(1)} not longer than the straight line (4)`);
  const g = MCL.Ai.findSwimPath; MCL.Ai.findSwimPath = () => null;   // no navigator -> old straight-line behaviour
  const r0 = run(); MCL.Ai.findSwimPath = g;
  okAv(r0.near >= 1.5, `without the air path the parrot still reached the target (closest ${r0.near.toFixed(2)})`);
}

// 4. anti-vacuity
okAv((() => { const s = Fl.PARROT_SKIN[2]; Fl.PARROT_SKIN[2] = 'broken'; const bad = Fl.skinKey({ type: 'parrot', parrotVariant: 2 }) === 'broken'; Fl.PARROT_SKIN[2] = s; return bad; })(), 'corrupting PARROT_SKIN[2] did not change skinKey');
okAv((() => { const r = EL.random; EL.random = () => 0; const v = new Set(); for (let i = 0; i < 5; i++) v.add(EL.spawn('parrot', 7, 70, 7).parrotVariant); EL.random = r; return v.size === 1; })(), 'a constant RNG did not collapse spawn variants to one');
okAv((() => { const f = Mb.fieldsFor; Mb.fieldsFor = (t) => f(t).filter((x) => x !== 'parrotVariant'); const bad = Mb.fieldsFor('parrot').indexOf('parrotVariant') < 0; Mb.fieldsFor = f; return bad; })(), 'dropping parrotVariant from fieldsFor was not visible');
okAv(Fl.skinKey({ type: 'parrot' }) === 'parrot', 'undefined variant should draw sheet 0');

console.log(`\n${pass} checks passed, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('parrotcheck: ALL GREEN');
