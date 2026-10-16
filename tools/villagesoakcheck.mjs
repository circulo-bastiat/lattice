// villagesoakcheck — #7650: Main.worldTick against a populated village, thousands of ticks at several times of day, zero throws.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const MAIN = (() => {
  const m = readFileSync(MCLITE_ROOT + 'build.mjs', 'utf8').match(/const MAIN_MODULES\s*=\s*\[([\s\S]*?)\]/);
  return [...m[1].matchAll(/'([0-9][^' ]*\.js)'/g)].map((x) => x[1]);
})();
export function soak(opts) {
  opts = opts || {};
  const SEED = Number(process.env.SEED || 1337), TICKS = Number(process.env.TICKS || 2400), KIND = process.env.KIND || 'village';
  const M = loadEngine({ extra: MAIN, dom: true, patch: opts.patch });
  const rd = (f) => JSON.parse(readFileSync(MCLITE_ROOT + 'assets/' + f, 'utf8'));
  globalThis.requestAnimationFrame = () => {};
  M.DATA = Object.assign({}, M.DATA, { entities: rd('entities.json') });
  M.Items.init({ items: readFileSync(MCLITE_ROOT + 'assets/items.bin').toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
  M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  M.World.init(SEED);
  const names = { village: 'village', mansion: 'on_woodland_explorer_maps', outpost: 'pillager_outpost', monument: 'on_ocean_explorer_maps' };
  let loc = null;
  for (const ring of [0, 1000, -1000, 3000, -3000, 6000]) { loc = M.Structures.locateStructure(names[KIND] || KIND, ring, -ring / 2, 100); if (loc) break; }
  if (!loc) throw new Error('no ' + KIND + ' found');
  const inits = ['Recipes', 'Behave', 'BlockEntities', 'Redstone', 'Piston', 'Sky', 'Entities', 'Equip', 'EntityList', 'Xp', 'Use', 'Sleep', 'Combat', 'Ai', 'Spawn',
    'Breed', 'Passive', 'Tame', 'Profession', 'Village', 'Mount', 'Raid', 'Patrol', 'CatSpawner', 'Spell', 'Particle', 'Explosion', 'Creeper', 'Tnt', 'Bat', 'Enderman', 'Slime', 'Squid', 'Fish', 'Dolphin'];
  const initErrs = [];
  for (const n of inits) { try { if (M[n] && M[n].init) M[n].init(n === 'Behave' || n === 'Use' || n === 'Sleep' ? M.World : (n === 'Recipes' ? M.DATA : undefined)); } catch (e) { initErrs.push(n + ': ' + e.message); } }
  const R = 4;
  for (let cx = loc.cx - R; cx <= loc.cx + R; cx++) for (let cz = loc.cz - R; cz <= loc.cz + R; cz++) {
    const col = M.Gen.genColumn(cx, cz);
    M.World.installChunk(cx, cz, col);
  }
  const cx = loc.x + 8, cz = loc.z + 8;
  const P = M.Player;
  P.x = P.px = cx; P.z = P.pz = cz; P.y = P.py = (M.World.heightAt(cx, cz) || 70) + 1;
  P.ex = P.x; P.ez = P.z;
  const ents = () => (M.EntityList.list || []).reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {});
  const first = new Map();
  for (const t0 of opts.times || [0, 6000, 13000, 18000]) {
    if (M.Sky) M.Sky.dayTime = t0;
    for (let i = 0; i < TICKS; i++) {
      try { M.Main.worldTick(); } catch (e) { const k = e.message; if (!first.has(k)) first.set(k, { at: t0 + ':' + i, stack: e.stack }); }
      try { P.tick && P.tick(); } catch (e) { const k = 'player ' + e.message; if (!first.has(k)) first.set(k, { at: t0 + ':' + i, stack: e.stack }); }
    }
  }
  return { M, loc, first, initErrs, ents: ents() };
}
if (process.argv[1].endsWith('villagesoakcheck.mjs')) {
  const CHECK = !process.env.KIND && !process.env.SEED && !process.env.TICKS;
  if (!CHECK) {
    const r = soak();
    console.log('located', JSON.stringify(r.loc), 'init errors', r.initErrs, 'entities', JSON.stringify(r.ents));
    for (const [k, v] of r.first) console.log('THROW', k, v.at, '\n' + v.stack);
    console.log('distinct throws', r.first.size);
  } else {
    // seed 7's village has farmland that water reaches: the cascade used NS.Reg.stateOf (missing) and threw.
    process.env.SEED = '7'; process.env.TICKS = '700';
    const r = soak();
    let fail = 0;
    if (r.initErrs.length) { console.log('FAIL init', r.initErrs); fail++; }
    if (!r.ents.villager) { console.log('FAIL no villagers in the village', JSON.stringify(r.ents)); fail++; }
    for (const [k, v] of r.first) { console.log('FAIL THROW', k, v.at, '\n' + v.stack); fail++; }
    let breaks = 0;
    const r2 = soak({ patch: (f, t) => f === '07_world.js' ? t.replace("NS.States.stateOf('dirt')", "NS.Reg.stateOf('dirt')") : t });
    if (r2.first.size > 0) breaks++; else console.log('break 1 not caught');
    const r3 = soak({ patch: (f, t) => f === "07zzv_siege.js" ? t.replace("Sg.tick = function (NS2) {", "Sg.tick = function (NS2) { throw new Error(\"planted\");") : t });
    if (r3.first.has('planted') || r3.first.size > 0) breaks++; else console.log('break 2 not caught');
    console.log(`villagesoakcheck: ${fail ? 'FAIL' : 'ok'}, ${r.first.size} throws, ${breaks} breaks caught`);
    process.exit(fail || breaks < 2 ? 1 : 0);
  }
}
