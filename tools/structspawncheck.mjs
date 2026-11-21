#!/usr/bin/env node
// structspawncheck.mjs — #165 G18c-b: StructureSpawns / ChunkGenerator.getEntitySpawnList.
// Real starts from the seed; inside/outside the box the pick table must match vanilla's
// (`spawn_overrides` in the configured-structure JSON, piece vs full bounding box).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { MCDATA } from './paths.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const M = loadEngine({ extra: ['07l_spawn.js'] , dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures, B = M.Biomes;
const dir = join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen', 'configured_structure_feature');
const vanilla = (n) => JSON.parse(readFileSync(join(dir, n + '.json'), 'utf8')).spawn_overrides;
const key = (l) => l ? JSON.stringify(l.map((e) => [String(e.type).replace('minecraft:', ''), e.weight, e.minCount, e.maxCount])) : 'null';

// find real starts by scanning chunk space
const found = {};
for (let cz = -200; cz <= 200; cz += 4) for (let cx = -200; cx <= 200; cx += 4) {
  for (const s of ST.startsNear(cx, cz)) {
    if (s.def.spawnOverrides && !found[s.def.name] && s.pieces) found[s.def.name] = s;
  }
}
// swamp huts need a swamp: seed 1337 has one near chunk (-118,-596)
for (let cz = -610; cz <= -580; cz += 2) for (let cx = -130; cx <= -100; cx += 2) {
  for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'swamp_hut' && !found.swamp_hut) found.swamp_hut = s;
}
const names = Object.keys(found);
console.log('starts found:', names.join(', '));
for (const need of ['swamp_hut', 'monument', 'pillager_outpost']) ok(found[need], 'no real ' + need + ' start found');

let breaks = 0;
function checkAll(tag, ovOf) {
  let n = 0;
  for (const name of Object.keys(found)) {
    const s = found[name], want = vanilla(name);
    for (const cat of Object.keys(want)) {
      const o = want[cat];
      const wl = o.spawns.map((e) => [e.type.replace('minecraft:', ''), e.weight, e.minCount, e.maxCount]);
      const p0 = s.pieces[0];
      const inside = [(p0.x0 + p0.x1) >> 1, (p0.y0 + p0.y1) >> 1, (p0.z0 + p0.z1) >> 1];
      const got = ovOf(inside[0], inside[1], inside[2], cat);
      n++;
      if (key(got) !== JSON.stringify(wl)) { if (tag === 'real') ok(false, `${name}/${cat} inside piece: ${key(got)} != ${JSON.stringify(wl)}`); else breaks++; }
      else if (tag === 'real') pass++;
      // outside: 1 block beyond the full box on every side (and far above) -> biome fallback (null)
      for (const out of [[s.x1 + 1, inside[1], inside[2]], [s.x0 - 1, inside[1], inside[2]],
                         [inside[0], s.y1 + 1, inside[2]], [inside[0], inside[1], s.z1 + 1]]) {
        const g2 = ovOf(out[0], out[1], out[2], cat);
        if (g2 !== null) { if (tag === 'real') ok(false, `${name}/${cat} outside box gave ${key(g2)}`); else breaks++; }
        else if (tag === 'real') pass++;
      }
    }
    // a category with no override is never overridden
    const g3 = ovOf((s.pieces[0].x0 + s.pieces[0].x1) >> 1, s.pieces[0].y0, (s.pieces[0].z0 + s.pieces[0].z1) >> 1, 'ambient');
    if (g3 !== null) { if (tag === 'real') ok(false, name + ' ambient overridden'); else breaks++; }
    else if (tag === 'real') pass++;
  }
}
checkAll('real', (x, y, z, c) => ST.spawnOverride(x, y, z, c));

// piece vs full: swamp_hut is 'piece' (a point in its full box but in no piece gets biome list),
// monument/outpost are 'full' (any point of the box overrides).
{
  const s = found.swamp_hut;
  if (s) {
    let gap = null;
    for (let x = s.x0; x <= s.x1 && !gap; x++) for (let z = s.z0; z <= s.z1 && !gap; z++) for (let y = s.y0; y <= s.y1; y++) {
      if (!s.pieces.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && z >= p.z0 && z <= p.z1)) { gap = [x, y, z]; break; }
    }
    if (gap) ok(ST.spawnOverride(gap[0], gap[1], gap[2], 'monster') === null, 'swamp_hut: point in full box but no piece must not override');
    else pass++;
  }
  for (const nm of ['monument', 'pillager_outpost']) {
    const t = found[nm]; if (!t) continue;
    ok(ST.spawnOverride(t.x0, t.y0, t.z0, 'monster') !== null, nm + ': full box corner must override');
    ok(ST.spawnOverride(t.x1, t.y1, t.z1, 'monster') !== null, nm + ': full box far corner must override');
  }
  // Spawn.spawnList falls back to the biome list outside, override inside
  const m = found.pillager_outpost;
  if (m) {
    const cx = (m.x0 + m.x1) >> 1, cz = (m.z0 + m.z1) >> 1, cy = (m.y0 + m.y1) >> 1;
    const bi = B.indexOf['plains'];
    const inL = M.Spawn.spawnList(bi, 'monster', cx, cy, cz);
    ok(inL.length === 1 && inL[0].type === 'pillager', 'Spawn.spawnList inside outpost is the pillager entry');
    const outL = M.Spawn.spawnList(bi, 'monster', m.x1 + 1, cy, cz);
    ok(outL === B.spawners(bi).monster, 'Spawn.spawnList outside outpost is the biome list');
  }
}

// anti-vacuity: break the port three ways; the same comparison must fail each time
const real = ST.spawnOverride;
// a broken box test that treats every start's box as unbounded in y: re-asks at that start's mid-y
const s0y = (f, x, z, c) => { for (const s of Object.values(f)) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.def.spawnOverrides && s.def.spawnOverrides[c]) return (s.y0 + s.y1) >> 1; return null; };
const breaksList = {
  'never overrides': () => null,
  'box ignores y': (x, y, z, c) => real(x, s0y(found, x, z, c) ?? y, z, c),
  'weights corrupted': (x, y, z, c) => { const r = real(x, y, z, c); return r && r.map((e) => Object.assign({}, e, { weight: e.weight + 1 })); },
  'category ignored': (x, y, z, c) => real(x, y, z, 'monster')
};
let caught = 0;
for (const [nm, fn] of Object.entries(breaksList)) {
  breaks = 0; checkAll('broken', fn);
  if (breaks > 0) { caught++; console.log('  ✓ break caught: ' + nm); } else fails.push('anti-vacuity: break "' + nm + '" not caught');
}
console.log(`${caught} breaks caught`);
if (caught !== Object.keys(breaksList).length) fails.push('not every break caught');
for (const f of fails) console.log('   ✗ ' + f);
console.log('structspawncheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
