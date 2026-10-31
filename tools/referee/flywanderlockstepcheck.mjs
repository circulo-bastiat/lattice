// lockstep-flywander -- #7715 (G18b-L17): parrot/bat/bee wander target: AboveGround forward cone, FlyOntoTree locateTree 7x13x7 box, 600 ticks, 20 salts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02h_recipes.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Mount.init();
const { EntityList: EL, Fly: Fl, Wither: Wi } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const stone = M.States.stateOf('stone'), leaves = M.States.stateOf('oak_leaves'), log = M.States.stateOf('oak_log');
function field(grove, rnd) {
  cells.clear(); EL.list.length = 0;
  for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) w.set(x, -1, z, stone);
  if (grove) for (let i = 0; i < 10; i++) {
    const tx = Math.floor(rnd() * 30) - 15, tz = Math.floor(rnd() * 30) - 15, h = 3 + Math.floor(rnd() * 4);
    for (let y = 0; y < h; y++) w.set(tx, y, tz, log);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(tx + dx, h, tz + dz, leaves);
  }
}
// Reference locateTree: the 7x13x7 box (x +-3, y +-6, z +-3), X fastest then Y then Z, leaves/log below + 2 air, own cell skipped.
function refTree(e) {
  const T = M.Tags, lv = T.blockTag('leaves'), lg = T.blockTag('logs');
  const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
  const isL = (x, y, z) => { const id = M.States.block[w.get(x, y, z)]; return T.blockInCol(lv, id) || T.blockInCol(lg, id); };
  for (let z = bz - 3; z <= bz + 3; z++) for (let y = by - 6; y <= by + 6; y++) for (let x = bx - 3; x <= bx + 3; x++) {
    if (x === bx && y === by && z === bz) continue;
    if (isL(x, y - 1, z) && !w.get(x, y, z) && !w.get(x, y + 1, z)) return { x: x + 0.5, y, z: z + 0.5 };
  }
  return null;
}
function lane(salt) {
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const rnd = stream(salt + 7);
  for (const kind of ['parrot', 'bat', 'bee']) {
    field(true, rnd);
    const e = EL.spawn(kind, +(rnd() * 8 - 4).toFixed(2), 1 + Math.floor(rnd() * 5), +(rnd() * 8 - 4).toFixed(2)); e.yaw = rnd() * 6.283;
    const fx = Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    let hits = 0, tgts = 0;
    for (let t = 0; t < 600; t++) {
      if (t % 20 === 0) { e.x += (rnd() - 0.5) * 6; e.z += (rnd() - 0.5) * 6; e.y = 1 + Math.floor(rnd() * 6); e.yaw = rnd() * 6.283; }
      const ef = { x: Math.sin(e.yaw), z: -Math.cos(e.yaw) };
      if (Math.floor(rnd() * 120) !== 0) continue;
      const want = refTree(e), got = Fl.locateTree(e);
      if (!!want !== !!got || (want && (want.x !== got.x || want.y !== got.y || want.z !== got.z))) note(`${kind} t${t} locateTree ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
      if (want) hits++;
      // open-air targets: forward cone (+-90 deg of the facing), inside the 8 block fuzz radius
      const a = Wi.flyWanderTarget(e, rnd);
      if (a) {
        tgts++;
        const ox = a.x - 0.5 - Math.floor(e.x), oz = a.z - 0.5 - Math.floor(e.z);
        if (ox * ef.x + oz * ef.z < -1.5) note(`${kind} t${t} target behind the facing (${ox},${oz})`);
        if (Math.abs(ox) > 9 || Math.abs(oz) > 9) note(`${kind} t${t} target outside the fuzz radius (${ox},${oz})`);
      }
    }
    if (!tgts) note(kind + ' no wander target in 600 ticks');
  }
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'flywander salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = () => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return h; };
{ const sv = Wi.flyWanderTarget; Wi.flyWanderTarget = (e, r) => ({ x: Math.floor(e.x + Math.floor(r() * 17) - 8) + 0.5, y: Math.floor(e.y + Math.floor(r() * 15) - 7), z: Math.floor(e.z + Math.floor(r() * 17) - 8) + 0.5 }); const h = first(); brk(!!h, `uniform box target: ${h}`); Wi.flyWanderTarget = sv; }
{ const sv = Fl.TREE_SCAN_XZ; Fl.TREE_SCAN_XZ = 2; const h = first(); brk(!!h, `narrow tree box: ${h}`); Fl.TREE_SCAN_XZ = sv; }
{ const sv = Fl.TREE_SCAN_Y; Fl.TREE_SCAN_Y = 3; const h = first(); brk(!!h, `short tree box: ${h}`); Fl.TREE_SCAN_Y = sv; }
console.log(`lockstep-flywander: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
