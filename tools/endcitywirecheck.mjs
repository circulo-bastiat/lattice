#!/usr/bin/env node
// endcitywirecheck.mjs — #11225: an End City reaches real End chunks THROUGH G.genColumn (blocks, shulkers, Elytra frame, loot chests).
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('endcitywirecheck -- #11225, structure writes in the_end go through genColumn');

const at = (c, wx, wy, wz) => { const s = c.sec[(wy + 64) >> 4], i = (((wy + 64) & 15) << 8) | ((wz & 15) << 4) | (wx & 15);
  if (s.u >= 0) return s.u; const bits = s.b, per = 32 / bits; return s.p[(s.d[Math.floor(i / per)] >>> ((i % per) * bits)) & ((1 << bits) - 1)]; };
function audit(M, dim) {
  const R = {};
  const gen = (on, cx, cz) => { M.Gen.init(12345, { structures: on }); M.Dim.cur = dim; try { return M.Gen.genColumn(cx, cz); } finally { M.Dim.cur = 'overworld'; } };
  const census = (c) => { const m = new Map(); for (let y = -64; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { const s = at(c, x, y, z); if (s) { const n = M.States.name ? M.States.name(s) : String(s); m.set(n, (m.get(n) || 0) + 1); } } return m; };
  const nm = (n) => /purpur|end_stone_bricks/.test(n);
  const sum = (m) => { let t = 0; for (const [k, v] of m) if (nm(k)) t += v; return t; };
  M.Gen.init(12345, { structures: true }); M.Dim.cur = dim;
  const st = M.Structures.startsNear(-16, -157).find((s) => s.def.name === 'end_city'); M.Dim.cur = 'overworld';
  R.start = !!st; if (!st) return R;
  // every chunk the start's pieces touch
  const chunks = new Set(); for (const p of st.pieces) for (let cx = p.x0 >> 4; cx <= p.x1 >> 4; cx++) for (let cz = p.z0 >> 4; cz <= p.z1 >> 4; cz++) chunks.add(cx + ',' + cz);
  let on = 0, off = 0, shul = 0, chests = 0, frames = 0, wrongLoot = 0;
  for (const k of chunks) { const [cx, cz] = k.split(',').map(Number);
    const a = gen(true, cx, cz); on += sum(census(a)); off += sum(census(gen(false, cx, cz)));
    for (const e of a.entities) { if (e[0] === 'shulker') shul++; if (e[0] === 'item_frame' && e[5] && e[5].item === 'elytra') frames++; }
    for (const c of a.chests) { chests++; if (c[3] !== 'minecraft:chests/end_city_treasure') wrongLoot++; } }
  const mk = { shulker: 0, chest: 0, elytra_frame: 0 };
  for (const p of st.pieces) for (const m of p.markers || []) if (m.kind in mk) mk[m.kind]++;
  R.blocksOn = on > 0; R.blocksOff = off === 0;
  R.shulkers = shul > 0 && shul === mk.shulker;
  R.chests = chests > 0 && chests === mk.chest && wrongLoot === 0;
  R.frameCount = frames === mk.elytra_frame;
  R.endTerrain = M.Biomes.names[gen(true, -16, -157).biome[0]] === 'minecraft:the_end' || /end/.test(M.Biomes.names[gen(true, -16, -157).biome[0]]);
  return R;
}
// the ship: find any start with an Elytra frame over +-160 chunks and generate its frame chunk
function ship(M) {
  M.Gen.init(12345, { structures: true }); M.Dim.cur = 'the_end';
  let found = null;
  for (let cz = -160; cz <= 160 && !found; cz++) for (let cx = -160; cx <= 160 && !found; cx++) {
    const near = M.Structures.startsNear(cx, cz);
    for (const s of near) if (s.def.name === 'end_city' && s.cx === cx && s.cz === cz) for (const p of s.pieces) for (const m of p.markers || []) if (m.kind === 'elytra_frame' && !found) found = m;
  }
  if (!found) { M.Dim.cur = 'overworld'; return false; }
  const col = M.Gen.genColumn(Math.floor(found.x) >> 4, Math.floor(found.z) >> 4); M.Dim.cur = 'overworld';
  return col.entities.some((e) => e[0] === 'item_frame' && e[5] && e[5].item === 'elytra');
}
const all = (M) => { const R = audit(M, 'the_end'); R.ship = ship(M); return R; };
for (const [k, v] of Object.entries(all(loadEngine()))) ok(v, 'real: ' + k);
const brk = (name, file, from, to) => {
  let M2;
  try { M2 = loadEngine({ patch: (f, s) => { if (f !== file) return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } }); } catch (e) { ok(false, e.message); return; }
  let bad; try { bad = Object.entries(all(M2)).filter(([, v]) => !v).map(([k]) => k); } catch (e) { bad = ['throws']; }
  if (ok(bad.length > 0, 'BREAK NOT CAUGHT: ' + name)) { breaks++; console.log('  ✓ break caught: ' + name + '  [' + bad[0] + ']'); }
};
brk('the_end dispatch removed', '04_worldgen.js', "if (NS.Dim && NS.Dim.cur === 'the_end' && NS.EndTerrain) return genEndColumn(cx, cz);", '');
brk('writer call removed (end column)', '04_worldgen.js', "G.writeDimStructures(cx, cz);\n    var bi = new Uint8Array(256);\n    for (i = 0; i < 256; i++) bi[i] = NS.Biomes.indexOf[r.biomes[i]] | 0;", "var bi = new Uint8Array(256);\n    for (i = 0; i < 256; i++) bi[i] = NS.Biomes.indexOf[r.biomes[i]] | 0;");
brk('beginChunk removed', '04_worldgen.js', 'ST.beginChunk(cx, cz);\n    ST.writeUpTo(SB, cx, cz, 10, cH, P.seaLevel);', 'ST.writeUpTo(SB, cx, cz, 10, cH, P.seaLevel);');
brk('chest log dropped', '04z_struct_end_city.js', "else if (m.kind === 'chest' && G.chestLog) G.chestLog.push([m.x, m.y, m.z, m.loot]);", '');
brk('elytra frame dropped', '04z_struct_end_city.js', "else if (m.kind === 'elytra_frame' && G.entityLog)", "else if (false)");
console.log('endcitywirecheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
