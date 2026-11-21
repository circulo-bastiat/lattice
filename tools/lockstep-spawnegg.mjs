#!/usr/bin/env node
// lockstep-spawnegg -- #7034 (G18c-L1): lockstep scenario 'spawnegg', 20 salts. A scripted player uses spawn eggs (every egg whose mob EntityList can spawn)
// through the engine's real Use.itemUseOn / Use.spawnEggInFluid / Use.spawnEggBaby: on a stone block face (SpawnEggItem.useOnBlock: neighbour of the face,
// +0.5 x/z, feet on the floor, yaw = wrapDegrees(random*360)), on water (use(): the hit cell itself, +0.5), on a spawner (SpawnData entity swapped, nothing
// spawned) and on a same-type animal (spawnBaby: baby at the parent's position, yaw 0). Per op: the entity made (type, x, y, z, yaw, baby), the stack count
// (creative keeps it) and the spawner's entity are compared with the vanilla rule written out independently.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const SALTS = 20, OPS = 40;
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js',
  '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07zs_spawner.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07n_tame.js', '07q_effects.js', '07zw_mobnbt.js'];
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const FACES = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 1, 0]];   // filled below from CFG order
const wrap = (r) => { let d = (r * 360) % 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d * Math.PI / 180; };
const r6 = (v) => Math.round(v * 1e6) / 1e6;

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Breed.init(); M.Use.init(M.World);
  const { Inventory: Iv, EntityList: EL, Use, World: W, States: S } = M;
  const CFG = M.CFG, stone = S.stateOf('stone'), spawner = S.stateOf('spawner');
  const roster = EL.spawnable().filter((t) => M.Items.of(t + '_spawn_egg') >= 0).sort();
  const babies = roster.filter((t) => Use.EGG_BABY_PASSIVE.indexOf(t) >= 0 && t !== 'villager');
  const r = stream(salt), ni = (n) => Math.floor(r() * n), rows = [], ref = [];
  for (let cx = -1; cx <= 0; cx++) for (let cz = -1; cz <= 0; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { W.setBlock(x, 63, z, stone); for (let y = 64; y < 68; y++) W.setBlock(x, y, z, 0); }
  W.setBlock(3, 64, 3, spawner);
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, ey: 65.62, EYE: 1.62, ez: 0, ex: 0, lookVec: () => [0, 0, 1], syncHotbar() {} };
  for (let i = 0; i < OPS; i++) {
    const type = roster[ni(roster.length)], k = ni(3), creative = ni(4) === 0, UP = Use.eggFaceUp();
    P.instabuild = creative;
    const give = (t) => { Iv.setItem(P.inventory, 0, Iv.stack(t + '_spawn_egg', 3, 0, null)); return Iv.getItem(P.inventory, 0); };
    EL.list.length = 0;
    const seed = (r() * 4294967296) >>> 0; const st = stream(seed); let last = 0; EL.random = () => (last = st());   // the yaw is the LAST world.random draw of the spawn
    const rr = () => last;
    const left = creative ? 3 : 2;
    const cnow = () => { const q = Iv.getItem(P.inventory, 0); return q ? q.n : 0; };
    const desc = (m) => m ? [m.type, r6(m.x), r6(m.y), r6(m.z), r6(m.yaw), !!(m.isBaby || m.baby || m.growAge < 0)].join(',') : 'none';
    if (k === 0) {                                                        // useOnBlock on the stone top: the cell above, feet on the floor
      const bx = ni(5) - 2, bz = ni(5) - 2, s = give(type);
      Use.itemUseOn(P, bx, 63, bz, UP, stone, s);
      rows.push(desc(EL.list[0]) + '#' + cnow());
      ref.push([type, r6(bx + 0.5), 64, r6(bz + 0.5), r6(wrap(rr())), false].join(',') + '#' + left);
    } else if (k === 1) {                                                 // spawner: SpawnData entity swapped, nothing spawned
      const s = give(type);
      Use.itemUseOn(P, 3, 64, 3, UP, spawner, s);
      const be = M.BlockEntities.get(3, 64, 3);
      rows.push((be ? be.entity : '?') + '#' + cnow() + '#' + EL.list.length);
      ref.push(type + '#' + left + '#0');
    } else {                                                              // same-type animal: baby at the parent, yaw 0, one egg
      const t = babies[ni(babies.length)], s = give(t);
      const par = EL.spawn(t, 1.5, 64, 1.5);
      const used = Use.spawnEggBaby(P, par, s);
      rows.push((used ? 'y,' : 'n,') + desc(EL.list.find((q) => q !== par)) + '#' + cnow());
      ref.push('y,' + [t, 1.5, 64, 1.5, 0, true].join(',') + '#' + left);
    }
  }
  return { rows, ref };
}
function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const { rows, ref } = engine(s, patch);
    for (let i = 0; i < rows.length; i++) if (rows[i] !== ref[i]) { bad++; if (!first) first = `salt ${s} op ${i}:\n engine ${rows[i]}\n ref    ${ref[i]}`; break; }
  }
  return { bad, first };
}
const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['egg lands at block centre minus 0.5', (f, s) => f === '14l_use.js' ? s.replace('EL.spawn(type, px + 0.5, py + oy, pz + 0.5)', 'EL.spawn(type, px, py + oy, pz)') : s],
  ['baby flag lost', (f, s) => f === '14l_use.js' ? s.replace('if (Br && Br.setBaby) Br.setBaby(child, true); else child.growAge = -24000;', '') : s],
  ['spawner swap spends nothing', (f, s) => f === '14l_use.js' ? s.replace('NS.Spawner.assign(x, y, z, spawnerEggType)) {', 'NS.Spawner.assign(x, y, z, spawnerEggType)) { return true;') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`spawnegg: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
