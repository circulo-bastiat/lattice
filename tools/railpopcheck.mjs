// railpopcheck.mjs — #1911: world generation must not pop a structure's rails into item entities.
// Mineshaft rails were placed over anything non-air (aquifer water included); vanilla needs
// `isOpaqueFullCube` below (MineshaftCorridor.generate). Install a grid of chunks, run the fluid
// ticks the install wakes, and count rails that dropped (Rail.neighborUpdate -> popResource).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const EXTRA = ['02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js', '07zzq_rail.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07c_blockentity.js', '09b_sky.js'];
const SEEDS = [1337, 99, 7], RAD = 8;

function run(seed, brk) {
  const M = loadEngine({ extra: EXTRA, dom: false }); initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init();
  const { Gen: G, World: W, Light: L, EntityList: EL } = M;
  if (brk) for (let i = 0; i < M.States.waterIn.length; i++) if (M.States.waterIn[i]) M.States.opaque[i] = 1;   // water "supports" a rail again
  W.init(seed); G.init(seed, G.defaults()); L.init(); M.Behave.init(W); EL.init();
  for (let cx = -RAD; cx <= RAD; cx++) for (let cz = -RAD; cz <= RAD; cz++) W.installChunk(cx, cz, G.genColumn(cx, cz));
  for (let i = 0; i < 400; i++) M.Behave.tick();
  return M.Rail.drops;
}

let bad = 0, caught = 0;
for (const s of SEEDS) { const d = run(s, false); console.log(`seed ${s}: ${d} rails popped`); if (d) bad++; }
if (run(1337, true) > 0) caught++;
if (caught < 1) { console.log('FAIL: the break (water counted as support) was not caught'); bad++; }
for (let i = 0; i < caught; i++) console.log('  ✓ break caught');
console.log(`railpopcheck: ${SEEDS.length + 1} assertions, ${bad} failed\n ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
