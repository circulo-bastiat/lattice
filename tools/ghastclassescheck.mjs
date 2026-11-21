#!/usr/bin/env node
// #11687: FireballEntity (Gh.tickFireball via EL.tickOne) and CollisionView.isSpaceEmpty (Gh.boxEmptyAt via GhastMoveControl), each cut and caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ cut caught: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('ghastclassescheck — #11687: FireballEntity + CollisionView (07zzi_ghast.js)');

const EXTRA = ['07zf_bat.js', '07zq_snowgolem.js', '07zg_enderman.js', '02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07t_fly.js', '07zf_bat.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js', '07zzi_ghast.js', '07zzk_shulker.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '14f_inventory.js', '07q_effects.js', '14h_brigadier.js', '15g_commands.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States, R = MCL.Reg;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, Bl = MCL.Blaze, Gh = MCL.Ghast, Mb = MCL.MobNbt, ER = MCL.EntityRender;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();
ER.init();
Bl.init();
Gh.init();

ok(Bl.ready, 'Blaze module reports ready');
ok(Gh.ready, 'Ghast module reports ready');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
const seq = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const withRnd = (rnd, f) => { const prev = EL.random; EL.random = rnd; try { return f(); } finally { EL.random = prev; } };
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }


// ── FireballEntity: a real spawned fireball, ticked by EL.tickOne (entry point), explodes on a block ──
function fireballRun() {
  freshWorld();
  put(8, 64, 5, 'dirt');   // low-resistance block in the path
  const gh = spawn('ghast', 0.5, 90, 0.5);
  const fb = spawn('fireball', 5.5, 64.5, 5.5, { power: [0.1, 0, 0], shooter: gh, explosionPower: 3 });
  fb.vx = 1; fb.vy = 0; fb.vz = 0;
  for (let t = 0; t < 8 && !fb.removed; t++) EL.tickOne(fb);
  return { removed: fb.removed, dirt: W.getBlock(8, 64, 5) };
}
const hit = fireballRun();
ok(hit.removed === true, 'FireballEntity: flies via EL.tickOne and is discarded on impact');
ok(hit.dirt === 0, 'FireballEntity: its explosion (power 3) destroyed the dirt block it hit');
{
  const saved = Gh.tickFireball; Gh.tickFireball = () => {};
  const cut = fireballRun();
  Gh.tickFireball = saved;
  okAv(!cut.removed && cut.dirt !== 0, 'FireballEntity cut (tickFireball no-op): no impact, block stays');
}
{
  const saved = MCL.Explosion.explode; MCL.Explosion.explode = () => {};
  const cut = fireballRun();
  MCL.Explosion.explode = saved;
  okAv(cut.dirt !== 0, 'FireballEntity cut (explosion removed): block stays');
}

// ── CollisionView.isSpaceEmpty: Gh.boxEmptyAt drives GhastMoveControl's willCollide ──
function moveRun() {
  freshWorld();
  for (let y = 70; y <= 80; y++) for (let z = 6; z <= 12; z++) for (let x = -6; x <= 6; x++) put(x, y, z, 'stone');
  const g = spawn('ghast', 0.5, 74, 0.5);
  g.flyMove.moveTo(0.5, 74, 10.5, 1);
  let pushed = false;
  withRnd(() => 0.5, () => { for (let t = 0; t < 10; t++) { g.flyMove.tick(); if (g.vz !== 0) pushed = true; } });
  return { pushed, moving: g.flyMove.isMoving() };
}
ok(Gh.boxEmptyAt({ width: 4, height: 4 }, 0.5, 74, 0.5) === true, 'CollisionView: open air box is empty');
freshWorld(); for (let y = 70; y <= 80; y++) for (let z = 6; z <= 12; z++) for (let x = -6; x <= 6; x++) put(x, y, z, 'stone');
ok(Gh.boxEmptyAt({ width: 4, height: 4 }, 0.5, 74, 9) === false, 'CollisionView: box inside stone is not empty');
ok(Gh.boxEmptyAt({ width: 4, height: 4 }, 30000000, 74, 0.5) === false, 'CollisionView: box past the world border is not empty');
const m = moveRun();
ok(!m.pushed && !m.moving, 'CollisionView: GhastMoveControl abandons a path blocked by stone');
{
  const saved = Gh.boxEmptyAt; Gh.boxEmptyAt = () => true;
  const cut = moveRun();
  Gh.boxEmptyAt = saved;
  okAv(cut.pushed && cut.moving, 'CollisionView cut (boxEmptyAt always true): ghast pushes into the wall');
}
{
  const saved = MCL.Shulker.spaceEmpty; MCL.Shulker.spaceEmpty = () => true;
  const cut = moveRun();
  MCL.Shulker.spaceEmpty = saved;
  okAv(cut.pushed, 'CollisionView cut (block-shape query removed): ghast pushes into the wall');
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
