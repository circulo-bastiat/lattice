#!/usr/bin/env node
// endwirecheck.mjs — #11224: the End dimension goes through G.genColumn (the real chunk path), not the unit API.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('endwirecheck -- #11224, G.genColumn dispatches the_end to EndTerrain');

function audit(M) {
  const R = {};
  M.Gen.init(12345, {});
  const col = (dim, cx, cz) => { M.Dim.cur = dim; try { return M.Gen.genColumn(cx, cz); } finally { M.Dim.cur = 'overworld'; } };
  const at = (c, wx, wy, wz) => { const s = c.sec[(wy + 64) >> 4], i = (((wy + 64) & 15) << 8) | ((wz & 15) << 4) | (wx & 15);
    if (s.u >= 0) return s.u; const bits = s.b, per = 32 / bits; return s.p[(s.d[Math.floor(i / per)] >>> ((i % per) * bits)) & ((1 << bits) - 1)]; };
  const census = (c) => { const m = new Map(); for (let y = -64; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { const s = at(c, x, y, z); if (s) m.set(s, (m.get(s) || 0) + 1); } return m; };
  M.EndTerrain.init(12345n); const B = M.EndTerrain.state().B;
  const c0 = col('the_end', 0, 0), ov = col('overworld', 0, 0);
  R.differs = c0.hmap.join() !== ov.hmap.join() || c0.biome.join() !== ov.biome.join();
  const cs = census(c0);
  R.onlyEnd = B && cs.get(B.end_stone) > 2000;
  R.noOverworld = B && !(cs.get(M.States.stateOf('stone')) > 0) && !(cs.get(M.States.stateOf('grass_block')) > 0);
  // the island's top is ~y 55..70; nothing above 128 / below 0
  let top = -99; for (let y = 0; y < 128; y++) if (at(c0, 8, y, 8) === B.end_stone) top = y;
  R.top = top >= 55 && top <= 70 && at(c0, 8, 200, 8) === 0 && at(c0, 8, -30, 8) === 0;
  R.biome = c0.biome[0] === M.Biomes.indexOf['the_end'];
  // spike columns: a spike centre is bedrock at its height; obsidian below it (chunk of the centre)
  const sp = M.EndTerrain.spikes(12345n)[0], cx = sp.centerX >> 4, cz = sp.centerZ >> 4, cs2 = col('the_end', cx, cz);
  R.spike = B && at(cs2, sp.centerX, sp.height, sp.centerZ) === B.bedrock && at(cs2, sp.centerX, sp.height - 3, sp.centerZ) === B.obsidian && at(cs2, sp.centerX, sp.height + 5, sp.centerZ) === 0;
  // ~1000 blocks out: outer islands exist somewhere, with void chunks between; the void ring (chunks ~ 5..8 out) is empty
  let outer = 0, voidChunks = 0, ringBlocks = 0;
  for (let k = 56; k < 72; k++) for (let z = -8; z < 8; z++) { const n = census(col('the_end', k, z)).get(B.end_stone) || 0; if (n) outer++; else voidChunks++; }
  R.outer = outer > 0 && voidChunks > 0;
  for (let k = 8; k < 12; k++) { const c = col('the_end', k, 0); for (const [s, n] of census(c)) ringBlocks += n; }
  R.ring = ringBlocks === 0;
  const hb = col('the_end', 60, 0).biome; R.outerBiome = [...hb].every((b) => ['the_end', 'end_highlands', 'end_midlands', 'end_barrens', 'small_end_islands'].map((n) => 'minecraft:' + n).includes(M.Biomes.names[b])) ;
  // #11226: podium, 20 gateways, chorus - all through genColumn
  let podium = false; for (let y = 0; y < 128; y++) if (at(col('the_end', 0, 0), 0, y, 0) === B.bedrock && at(col('the_end', 0, 0), 0, y + 3, 0) === B.bedrock) podium = true;
  R.podium = podium;
  let gw = 0;
  for (let i = 0; i < 20; i++) {
    const gx = Math.floor(96 * Math.cos(2 * (-Math.PI + (Math.PI / 20) * i))), gz = Math.floor(96 * Math.sin(2 * (-Math.PI + (Math.PI / 20) * i)));
    const c = col('the_end', gx >> 4, gz >> 4);
    if (at(c, gx, 75, gz) === B.end_gateway && at(c, gx, 77, gz) === B.bedrock) gw++;
  }
  R.gateways = gw === 20;
  let chorus = 0; const cp = M.States.stateOf('chorus_plant');
  for (let k = 56; k < 72 && !chorus; k++) for (let z = -8; z < 8 && !chorus; z++) { const cc = census(col('the_end', k, z)); for (const [s2, n] of cc) if (M.States.blockOf ? M.States.blockOf(s2) === M.States.blockOf(cp) : s2 === cp) chorus += n; }
  R.chorus = chorus > 0;
  return R;
}
const R = audit(loadEngine());
for (const k of Object.keys(R)) ok(R[k], 'real: ' + k);
const brk = (name, from, to) => {
  let M2;
  try { M2 = loadEngine({ patch: (f, s) => { if (f !== '04_worldgen.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } }); } catch (e) { ok(false, e.message); return; }
  let bad; try { bad = Object.entries(audit(M2)).filter(([, v]) => !v).map(([k]) => k); } catch (e) { bad = ['throws']; }
  if (ok(bad.length > 0, 'BREAK NOT CAUGHT: ' + name)) { breaks++; console.log('  ✓ break caught: ' + name + '  [' + bad.join(',') + ']'); }
};
brk('the_end dispatch removed', "if (NS.Dim && NS.Dim.cur === 'the_end' && NS.EndTerrain) return genEndColumn(cx, cz);", '');
brk('terrain writer removed', 'SB[base + IDX(x, y, z)] = r.blocks[(y << 8) | (z << 4) | x];\n    // EndSpikeFeature', ';\n    // EndSpikeFeature');
brk('spike call removed', 'ET.generateSpike(w, s, box);', '');
brk('podium removed', 'ET.generatePortal(cw, 0, py, 0, false);', ';');
brk('gateways removed', 'ET.generateGateway(cw, gx, 75, gz);', ';');
brk('chorus removed', 'ET.generateChorus(cw, crnd, qx, y, qz)', 'false');
console.log('endwirecheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
