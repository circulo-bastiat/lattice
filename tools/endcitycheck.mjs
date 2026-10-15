#!/usr/bin/env node
// endcitycheck.mjs — #4560: End City piece layout (src/04z_struct_end_city.js) + the metadata markers the packer keeps.
//   node tools/endcitycheck.mjs
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('endcitycheck -- #4560, end_city pieces + template metadata');

function audit(M) {
  const T = M.Templates, Rnd = M.Noise ? M.Noise.LegacyRandom : M.LegacyRandom;
  const size = (n) => { const e = T.get(T.index('end_city/' + n)); if (!e) throw new Error('no template ' + n); return [e.sx, e.sy, e.sz]; };
  let sig = '', big = 0, inter = 0, ships = 0, names = new Set(), mismatch = 0;
  const N = 60;
  for (let s = 1; s <= N; s++) {
    const ps = M.EndCity.generate(new Rnd(s), 0, 60, 0, s & 3, size);
    if (ps.length > 12) big++;
    sig += ps.map((p) => p.name + p.bb).join(';') + '|';
    for (const p of ps) {
      names.add(p.name); if (p.name === 'ship') ships++;
      const e = T.get(T.index('end_city/' + p.name)), w = p.rot & 1 ? e.sz : e.sx, d = p.rot & 1 ? e.sx : e.sz;
      if (p.bb[3] - p.bb[0] + 1 !== w || p.bb[5] - p.bb[2] + 1 !== d || p.bb[4] - p.bb[1] + 1 !== e.sy) mismatch++;
    }
    // pieces of one part never overlap pieces of another unless the chain test allowed it; tower floors stack, so count only exact duplicates
    const seen = new Set(); for (const p of ps) { const k = p.name + p.bb; if (seen.has(k)) inter++; seen.add(k); }
  }
  return { sig, big, inter, ships, names, mismatch, N, size, T, Rnd };
}

const M = loadEngine({ initReg: true });
const a = audit(M);
ok(a.big >= 40, `cities grow past the tower (${a.big}/${a.N} have >12 pieces)`);
ok(a.inter === 0, `no duplicate pieces (${a.inter})`);
ok(a.mismatch === 0, `${a.mismatch} piece boxes do not match their template size for their rotation`);
ok(a.ships > 0, 'ships are produced');
for (const n of ['base_floor', 'tower_top', 'bridge_piece', 'bridge_end', 'fat_tower_top', 'third_roof']) ok(a.names.has(n), 'piece ' + n + ' is produced');
const j = (s) => JSON.stringify(M.EndCity.generate(new a.Rnd(s), 1, 2, 3, 0, a.size));
ok(j(5) === j(5) && j(5) !== j(6), 'same seed, same city; another seed differs');
// first piece sits at the start pos, rotation as given
const f = M.EndCity.generate(new a.Rnd(1), 10, 60, 20, 2, a.size)[0];
ok(f.name === 'base_floor' && f.x === 10 && f.y === 60 && f.z === 20 && f.rot === 2, 'start piece is base_floor at the start pos');

// the packer keeps the structure_block markers (D-212 drops the cell, not the fact)
const kinds = new Set(); let total = 0;
for (const nm of a.T.names()) {
  if (nm.indexOf('end_city/') !== 0) continue;
  const e = a.T.get(a.T.index(nm));
  for (const m of e.meta) { total++; kinds.add(m.data.replace(/\d+$/, '')); ok(m.pos >= 0 && m.pos < e.sx * e.sy * e.sz, 'marker in bounds ' + nm); }
}
ok(total >= 19, `${total} end_city markers kept, structaudit counted 19`);
for (const k of ['Chest', 'Sentry', 'Elytra']) ok([...kinds].some((x) => x.startsWith(k)), 'marker kind ' + k);

const brk = (name, from, to, pred) => {
  const M2 = loadEngine({ initReg: true, patch: (f, s) => { if (f !== '04z_struct_end_city.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } });
  okAv(pred(audit(M2)), name);
};
brk('depth limit removed', "if (depth > 8) return false;\n      var mine", "var mine", (r) => r.sig !== a.sig);
brk('wrong rotation of offsets', "var o = rotXZ(parent.rot, off[0], off[2]);", "var o = [off[0], off[2]];", (r) => r.sig !== a.sig);
brk('intersection test removed', "if (list[j].chain !== parent.chain) clash = true;", "", (r) => r.sig !== a.sig);
brk('no bridges from small towers', "var q = rng.nextInt(3) === 0 ? p : null", "var q = null", (r) => r.sig !== a.sig);

for (const f of fails) console.log('  ✗ ' + f);
console.log(`endcitycheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
