#!/usr/bin/env node
// dimwirecheck.mjs — #11227: every dimension's terrain, features and structure sets reach G.genColumn output.
// Drives the REAL path (G.genColumn per Dim.cur), never the unit API. Anti-vacuity: breaks the dispatch / writer / feature call.
import { loadEngine, WORKER_FILES, SRC } from './loadsrc.mjs';
import { readFileSync, readdirSync } from 'node:fs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('dimwirecheck -- #11227, terrain / features / structures per dimension through G.genColumn');

const at = (c, wx, wy, wz) => { const s = c.sec[(wy + 64) >> 4], i = (((wy + 64) & 15) << 8) | ((wz & 15) << 4) | (wx & 15);
  if (s.u >= 0) return s.u; const bits = s.b, per = 32 / bits; return s.p[(s.d[Math.floor(i / per)] >>> ((i % per) * bits)) & ((1 << bits) - 1)]; };
const cells = (c) => { const a = new Int32Array(320 * 256); let k = 0; for (let y = -64; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) a[k++] = at(c, x, y, z); return a; };

function audit(M) {
  const R = {};
  const gen = (dim, on, cx, cz) => { M.Gen.init(12345, { structures: on }); M.Dim.cur = dim; try { return M.Gen.genColumn(cx, cz); } finally { M.Dim.cur = 'overworld'; } };
  const nameOf = (s) => (M.States.name ? M.States.name(s) : String(s));
  const count = (c, re) => { const a = cells(c), memo = new Map(); let t = 0; for (const s of a) { if (!s) continue; let m = memo.get(s); if (m === undefined) { m = re.test(nameOf(s)); memo.set(s, m); } if (m) t++; } return t; };
  // terrain: each non-overworld dimension differs from the overworld at the same column
  const ow = gen('overworld', true, 0, 0);
  for (const d of ['the_nether', 'the_end']) {
    const c = gen(d, true, 0, 0);
    R['terrain ' + d] = c.hmap.some((h, i) => h !== ow.hmap[i]) && c.biome.some((b, i) => b !== ow.biome[i]);
  }
  const eb = M.Biomes.names[gen('the_end', true, 0, 0).biome[0]]; R['end biome'] = /end/.test(eb);
  // features: Nether (applyNether) leaves ores / glowstone / lava; End leaves the obsidian spikes
  let nf = 0; for (let cx = 0; cx < 4; cx++) nf += count(gen('the_nether', false, cx, 0), /glowstone|quartz_ore|nether_gold_ore|magma_block|ancient_debris|nether_sprouts|crimson_fungus|warped_fungus|shroomlight|basalt/);
  R['features the_nether'] = nf > 0;
  let ob = 0; M.Dim.cur = 'the_end'; M.Gen.init(12345, { structures: false });
  const sp = M.EndTerrain.spikes(M.Gen.seed64 !== undefined ? M.Gen.seed64 : M.Gen.seed); M.Dim.cur = 'overworld';
  ob = count(gen('the_end', false, sp[0].centerX >> 4, sp[0].centerZ >> 4), /^(minecraft:)?obsidian$/);
  R['features the_end'] = ob > 0;
  // structures: every nether/end structure that startsNear reports changes blocks in the chunks its box covers
  for (const d of ['the_nether', 'the_end']) {
    M.Gen.init(12345, { structures: true }); M.Dim.cur = d;
    const seen = {}; const lim = d === 'the_end' ? 160 : 40;
    for (let cz = -lim; cz <= lim; cz++) for (let cx = -lim; cx <= lim; cx++) for (const s of M.Structures.startsNear(cx, cz)) { if (s.cx === cx && s.cz === cz && !seen[s.def.name]) seen[s.def.name] = s; }
    M.Dim.cur = 'overworld';
    const want = d === 'the_nether' ? ['fortress', 'bastion_remnant', 'nether_fossil', 'ruined_portal_nether'] : ['end_city'];
    for (const n of want) {
      const s = seen[n]; if (!ok(!!s, d + ' reports no ' + n)) continue;
      let diff = 0;
      const cx0 = Math.max(s.x0 >> 4, s.cx - 3), cx1 = Math.min(s.x1 >> 4, s.cx + 3), cz0 = Math.max(s.z0 >> 4, s.cz - 3), cz1 = Math.min(s.z1 >> 4, s.cz + 3);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const a = cells(gen(d, true, cx, cz)), b = cells(gen(d, false, cx, cz)); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++; }
      R['structure ' + d + ' ' + n] = diff > 0;
    }
  }
  return R;
}
const real = audit(loadEngine());
for (const [k, v] of Object.entries(real)) ok(v, 'real: ' + k);

const brk = (name, file, from, to, expect) => {
  let M2;
  try { M2 = loadEngine({ patch: (f, s) => { if (f !== file) return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } }); } catch (e) { ok(false, e.message); return; }
  let bad; try { bad = Object.entries(audit(M2)).filter(([, v]) => !v).map(([k]) => k); } catch (e) { bad = ['throws']; }
  if (ok(bad.length > 0 && (!expect || bad.some((k) => k.includes(expect))), 'BREAK NOT CAUGHT: ' + name + ' ' + bad)) { breaks++; console.log('  ✓ break caught: ' + name + '  [' + bad[0] + ']'); }
};
const W = '04_worldgen.js';
brk('nether dispatch removed', W, "if (NS.Dim && NS.Dim.cur === 'the_nether' && NS.NetherTerrain) return genNetherColumn(cx, cz);", '', 'terrain the_nether');
brk('end dispatch removed', W, "if (NS.Dim && NS.Dim.cur === 'the_end' && NS.EndTerrain) return genEndColumn(cx, cz);", '', 'terrain the_end');
brk('nether structure writer removed', W, "G.writeDimStructures(cx, cz);\n    var bi = new Uint8Array(256);\n    for (i = 0; i < 256; i++) bi[i] = NS.Biomes.indexOf[r.biomes[((i >> 4) << 4) | (i & 15)]] | 0;", "var bi = new Uint8Array(256);\n    for (i = 0; i < 256; i++) bi[i] = NS.Biomes.indexOf[r.biomes[((i >> 4) << 4) | (i & 15)]] | 0;", 'structure the_nether');
brk('end structure writer removed', W, "G.writeDimStructures(cx, cz);\n    var bi = new Uint8Array(256);\n    for (i = 0; i < 256; i++) bi[i] = NS.Biomes.indexOf[r.biomes[i]] | 0;", "var bi = new Uint8Array(256);\n    for (i = 0; i < 256; i++) bi[i] = NS.Biomes.indexOf[r.biomes[i]] | 0;", 'structure the_end');
brk('nether feature step removed', W, "NS.Features.applyNether(SB, cx, cz);", "0;", 'features the_nether');
brk('end spike step removed', W, "ET.generateSpike(w, s, box);", "0;", 'features the_end');
brk('structure bracket removed', W, "ST.beginChunk(cx, cz);\n    ST.writeUpTo(SB, cx, cz, 10, cH, P.seaLevel);\n  };", "0;\n  };", 'structure');

// every WORKER_FILES module that registers on NS must have a reference from another loaded module OR be a leaf registry (listed).
const body = WORKER_FILES.map((f) => [f, readFileSync(SRC + '/' + f, 'utf8')]);
const orphans = [];
for (const [f, s] of body) { const m = [...s.matchAll(/NS\.([A-Z][A-Za-z0-9]+)\s*=[^=]/g)].map((x) => x[1]); for (const n of new Set(m)) {
  const used = body.some(([g, t]) => g !== f && new RegExp('NS\\.' + n + '\\b').test(t)) || new RegExp('(?<!NS\\.)\\b' + n + '\\b\\.').test(s.replace(new RegExp('NS\\.' + n, 'g'), ''));
  if (!used && !/^(Reg|Dim|Gen|Structures)$/.test(n)) orphans.push(f + ':' + n); } }
console.log('modules in WORKER_FILES with no other caller (info): ' + (orphans.join(', ') || 'none'));
console.log('dimwirecheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
