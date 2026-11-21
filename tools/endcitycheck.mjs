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

// handleMetadata positions: independent rotation of every marker, rule re-derived from the decompiled source
const SU = M.StructSurface;
const mk = (name, rot) => { const t = SU.templatePiece('end_city/' + name, rot, 100, 50, 200, {}); return { t, m: M.EndCity.markers(t) }; };
const wantFacing = ['south', 'west', 'north', 'east'];
let nch = 0, nsh = 0, nel = 0, badPos = 0;
for (const nm of a.T.names()) {
  if (nm.indexOf('end_city/') !== 0) continue;
  const e = a.T.get(a.T.index(nm));
  for (let rot = 0; rot < 4; rot++) {
    const { t, m } = mk(nm.slice(9), rot);
    ok(m.length === e.meta.filter((x) => /^(Chest|Sentry|Elytra)/.test(x.data)).length, 'every marker resolves ' + nm);
    e.meta.forEach((mm, i) => {
      const lx = mm.pos % e.sx, lz = Math.floor(mm.pos / e.sx) % e.sz, ly = Math.floor(mm.pos / (e.sx * e.sz));
      const [rx, rz] = [[lx, lz], [e.sz - 1 - lz, lx], [e.sx - 1 - lx, e.sz - 1 - lz], [lz, e.sx - 1 - lx]][rot];
      const r = m[i], wx = 100 + rx, wz = 200 + rz, wy = 50 + ly;
      if (r.x === undefined) return;
      const want = r.kind === 'chest' ? [wx, wy - 1, wz] : r.kind === 'shulker' ? [wx + .5, wy, wz + .5] : [wx, wy, wz];
      if (r.x !== want[0] || r.y !== want[1] || r.z !== want[2]) badPos++;
      if (r.x < t.x0 - 1 || r.x > t.x1 + 1 || r.z < t.z0 - 1 || r.z > t.z1 + 1) badPos++;
      if (r.kind === 'elytra_frame' && r.facing !== wantFacing[rot]) badPos++;
      if (rot === 0) { if (r.kind === 'chest') nch++; if (r.kind === 'shulker') nsh++; if (r.kind === 'elytra_frame') nel++; }
    });
  }
}
ok(badPos === 0, badPos + ' marker positions/facings disagree with the independent rotation');
ok(nch > 0 && nsh > 0 && nel > 0, `marker kinds resolved: chest ${nch}, shulker ${nsh}, elytra ${nel}`);
ok(M.EndCity.markers(mk('ship', 0).t).some((x) => x.kind === 'elytra_frame') && mk('ship', 0).m.some((x) => x.kind === 'shulker'), 'the ship carries the Elytra frame and a Sentry');
ok(mk('ship', 0).m.every((x) => x.kind !== 'chest' || x.loot === 'minecraft:chests/end_city_treasure'), 'chests carry end_city_treasure');
// handleMetadata: every marker yields its chest loot / shulker / elytra frame
function metaSig(M) {
  const T = M.Templates; let chest = 0, shulker = 0, frame = 0, bad = 0, sig = '';
  const size = (n) => { const e = T.get(T.index('end_city/' + n)); return [e.sx, e.sy, e.sz]; };
  for (let s = 1; s <= 30; s++) for (const p of M.EndCity.generate(new a.Rnd(s), 0, 60, 0, s & 3, size)) {
    for (const o of M.EndCity.metadata(p, T.get(T.index('end_city/' + p.name)))) {
      if (o.kind === 'chest') { chest++; if (o.loot !== 'end_city_treasure') bad++; }
      else if (o.kind === 'shulker') shulker++;
      else if (o.kind === 'item_frame') { frame++; if (o.item !== 'elytra') bad++; }
      sig += o.kind + o.x + ',' + o.y + ',' + o.z + (o.facing || '') + ';';
    }
  }
  return { chest, shulker, frame, bad, sig };
}
const ms = metaSig(M);
ok(ms.chest > 0 && ms.shulker > 0 && ms.frame > 0 && ms.bad === 0, `metadata yields chest ${ms.chest}, shulker ${ms.shulker}, frame ${ms.frame}, bad ${ms.bad}`);
const fr = M.EndCity.metadata({ rot: 1, x: 0, y: 0, z: 0, bb: [-99, -99, -99, 99, 99, 99] }, { sx: 2, sy: 1, sz: 1, meta: [{ pos: 0, data: 'Elytra' }] });
ok(fr.length === 1 && fr[0].facing === 'west', 'elytra frame faces SOUTH turned CW90 = west');

const brk = (name, from, to, pred) => {
  const M2 = loadEngine({ initReg: true, patch: (f, s) => { if (f !== '04z_struct_end_city.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } });
  okAv(pred(audit(M2)), name);
};
const msig = (M2) => { let o = ''; for (const nm of M2.Templates.names().filter((n) => n.startsWith('end_city/')).map((n) => n.slice(9))) for (let r = 0; r < 4; r++) o += JSON.stringify(M2.EndCity.markers(M2.StructSurface.templatePiece('end_city/' + nm, r, 100, 50, 200, {}))); return o; };
const base = msig(M);
const brkM = (name, from, to) => okAv(msig(loadEngine({ initReg: true, patch: (f, s) => { if (f !== '04z_struct_end_city.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } })) !== base, name);
brkM('elytra facing ignores rotation', 'FRAME_FACING[p.rot & 3]', "'south'");
brkM('chest not moved down a block', "y: y - 1, z: z, loot: 'minecraft:", "y: y, z: z, loot: 'minecraft:");
brkM('wrong loot table', "loot: 'minecraft:chests/end_city_treasure'", "loot: 'minecraft:chests/simple_dungeon'");
brkM('shulker not centred', "x: x + 0.5, y: y, z: z + 0.5 });\n      else if (d.indexOf('Elytra')", "x: x, y: y, z: z });\n      else if (d.indexOf('Elytra')");
brkM('marker rotation dropped', 'NS.Jigsaw.rotX(e, p.rot, lx, lz)', 'lx');
brk('depth limit removed', "if (depth > 8) return false;\n      var mine", "var mine", (r) => r.sig !== a.sig);
brk('wrong rotation of offsets', "var o = rotXZ(parent.rot, off[0], off[2]);", "var o = [off[0], off[2]];", (r) => r.sig !== a.sig);
brk('intersection test removed', "if (list[j].chain !== parent.chain) clash = true;", "", (r) => r.sig !== a.sig);
for (const [n, f1, t1] of [['chest loot dropped', "loot: 'end_city_treasure'", "loot: 'x'"], ['sentry dropped', "d.indexOf('Sentry') === 0", "false"], ['elytra frame dropped', "d.indexOf('Elytra') === 0", "false"]]) {
  const M2 = loadEngine({ initReg: true, patch: (f, s) => f !== '04z_struct_end_city.js' ? s : s.replace(f1, t1) });
  okAv(metaSig(M2).sig !== ms.sig || metaSig(M2).bad > 0, n);
}
brk('no bridges from small towers', "var q = rng.nextInt(3) === 0 ? p : null", "var q = null", (r) => r.sig !== a.sig);

// the writer hands the markers on: shulkers -> Gen.entityLog, chests -> Gen.chestLog, only in the chunk that holds them
const writeLogs = (M2) => {
  M2.Jigsaw.ready = true;
  const d = M2.Structures.makers.endcity();
  if (!d) return null;
  M2.StructSurface.write = () => 0;
  const t = M2.StructSurface.templatePiece('end_city/ship', 0, 96, 50, 192, {});
  t.markers = M2.EndCity.markers(t);
  M2.Gen.entityLog = []; M2.Gen.chestLog = [];
  for (let cx = 5; cx <= 9; cx++) for (let cz = 11; cz <= 14; cz++) d.write(null, cx, cz, t);
  return { ents: M2.Gen.entityLog.filter((e) => e[0] === 'shulker').length, chests: M2.Gen.chestLog.length, frames: M2.Gen.entityLog.filter((e) => e[0] === 'item_frame' && e[5] && e[5].item === 'elytra').length, wantF: t.markers.filter((m) => m.kind === 'elytra_frame').length, want: t.markers.filter((m) => m.kind === 'shulker').length, wantC: t.markers.filter((m) => m.kind === 'chest').length };
};
const wl = writeLogs(loadEngine({ initReg: true }));
ok(wl && wl.want > 0 && wl.ents === wl.want && wl.chests === wl.wantC && wl.wantC > 0 && wl.wantF > 0 && wl.frames === wl.wantF, 'write logs every shulker once and every loot chest once: ' + JSON.stringify(wl));
for (const [n, f1, t1] of [['writer drops shulkers', "G.entityLog.push(['shulker'", "G.entityLog.slice(['shulker'"], ['writer drops elytra frame', "m.kind === 'elytra_frame' && G.entityLog", "m.kind === 'elytra_frameX' && G.entityLog"], ['writer drops chests', 'G.chestLog.push(', 'G.chestLog.slice(']]) {
  const wb = writeLogs(loadEngine({ initReg: true, patch: (f, s) => f !== '04z_struct_end_city.js' ? s : s.replace(f1, t1) }));
  okAv(!(wb && wb.ents === wb.want && wb.chests === wb.wantC && wb.frames === wb.wantF), n);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`endcitycheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
