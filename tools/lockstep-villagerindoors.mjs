// lockstep-villagerindoors.mjs -- #8724 (G18f-L18): 20 salts x 3 conditions (rain, dusk, clear day) x villager cells in/under/outside a roofed hut: WanderIndoorsTask.run target cell (a valid 3x3x3 neighbour: non-sky isTopSolid cell, walk speed/range 0), 'under a roof' sky test and no-op under open sky vs an independent .decomp reference sharing the Random stream. Faults: sky test inverted, range changed, cell shift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv3_vbpanic.js', '07zv4_vbidle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63, TICKS = 2400, START = 2000, CLEAR = 120;
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
const stoneS = SR.stateOf('stone');
const sky = (x, y, z) => { for (let yy = y; yy < 256; yy++) if (W.getBlock(x, yy, z) !== 0) return false; return true; };
// headless world has no light engine: skylight 15 above the topmost block of a column, 0 under it (what canSeeSky reads)
W.getLight = (x, y, z) => (y >= 256 || sky(x, y, z) ? 15 : 0) << 4;
function refRun(e, rnd) {
  const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
  if (sky(bx, by, bz)) return null;
  const cells = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) cells.push([bx + dx, by + dy, bz + dz]);
  // Collections.shuffle(list) uses an unseeded java.util.Random in vanilla: the pick is any member of the valid set
  const ok2 = cells.filter((c) => !sky(c[0], c[1], c[2]) && SR.faceSturdy(W.getBlock(c[0], c[1], c[2]), 2, SR.SUPPORT_FULL));
  return ok2.length ? ok2 : undefined;
}
let runs = 0, targets = 0, nosky = 0;
function lane(salt) {
  Math.random = stream(salt + 1000); W.seed64 = BigInt(salt + 1) * 7919n; EL.random = stream(salt + 2000);
  EL.clear(); EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; Prof.claimed = {};
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 1; y <= 8; y++) W.setBlock(x, Y + y, z, 0);
  // hut: 7x7 walls 3 high, roof at Y+4 over x,z in -3..3 except a hole whose place depends on the salt
  const hx = salt % 3 - 1, hz = (salt >> 1) % 3 - 1;
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    const wall = Math.abs(x) === 3 || Math.abs(z) === 3;
    if (wall && !(x === 3 && z === 0)) for (let y = 1; y <= 3; y++) W.setBlock(x, Y + y, z, stoneS);
    if (!(x === hx && z === hz) && !(x === hx + 1 && z === hz && salt % 2)) W.setBlock(x, Y + 4, z, stoneS);
  }
  for (const cond of ['rain', 'dusk', 'clear']) {
    M.Sky = { dayTime: cond === 'dusk' ? 12000 : 3000 }; M.Weather = { raining: cond === 'rain' };
    for (let k = 0; k < 6; k++) {
      const px = [0, -2, hx, 2, 5, 8][k], pz = [0, 2, hz, -2, 0, 8][k];
      const v = EL.spawn('villager', 0.5 + px, Y + 1, 0.5 + pz); v.ai = new Ai.GoalSelector(); v.profession = 'none'; v.vbWalkTarget = null;
      const seed = salt * 100 + k;
      VB.rand = stream(seed); const want = refRun(v, stream(seed));
      const got = VB.wanderIndoorsStart(v); runs++;
      const tag = 'salt ' + salt + ' ' + cond + ' cell ' + px + ',' + pz + ' ';
      const roofed = !sky(Math.floor(v.x), Y + 1, Math.floor(v.z));
      if (roofed !== (want !== null)) return tag + 'ref disagrees with roof test';
      const w = v.vbWalkTarget;
      if (want === null) { nosky++; if (w) return tag + 'target set under open sky ' + JSON.stringify(w); continue; }
      if (!got) return tag + 'returned false under a roof';
      if (!want) { if (w) return tag + 'target with no valid cell ' + JSON.stringify(w); continue; }
      targets++;
      if (!w || !want.some((c) => c[0] === w.x && c[1] === w.y && c[2] === w.z) || w.range !== 0) return tag + 'target ' + JSON.stringify(w) + ' not in ' + JSON.stringify(want);
    }
  }
  return null;
}
const pass = () => { runs = 0; targets = 0; nosky = 0; return salts.map(lane).filter(Boolean); };
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(targets >= 100 && nosky >= 100, 'targets ' + targets + ' open-sky ' + nosky);
console.log('  runs', runs, 'targets', targets, 'open-sky no-ops', nosky);
const real = W.canSeeSky;
W.canSeeSky = (x, y, z) => !real(x, y, z); brk(pass().length > 0, 'sky test inverted caught'); W.canSeeSky = real;
const realRand = VB.rand; const origStart = VB.wanderIndoorsStart;
VB.wanderIndoorsStart = (e) => { const r = origStart(e); if (e.vbWalkTarget) e.vbWalkTarget.range = 1; return r; };
brk(pass().length > 0, 'walk range 0 -> 1 caught'); VB.wanderIndoorsStart = origStart;
VB.wanderIndoorsStart = (e) => { const r = origStart(e); if (e.vbWalkTarget) e.vbWalkTarget.y += 1; return r; };
brk(pass().length > 0, 'target cell shifted up caught'); VB.wanderIndoorsStart = origStart;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`lockstep-villagerindoors: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
