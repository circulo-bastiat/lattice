#!/usr/bin/env node
// netherstructcheck.mjs — #259: the Nether structure rows (04r registry) and what the Nether actually produces.
// Fortress: every piece family of NetherFortressGenerator appears across starts. Bastion / fossil: the rows
// are registered, Nether-gated, at the right generation step. Nothing but nether structures start in the Nether.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures;
const NEED = ['Start', 'BridgePlatform', 'BridgeCrossing', 'Bridge', 'BridgeSmallCrossing', 'BridgeStairs', 'BridgeEnd',
  'CorridorExit', 'CorridorLeftTurn', 'SmallCorridor', 'CorridorCrossing', 'CorridorRightTurn',
  'CorridorNetherWartsRoom', 'CorridorBalcony', 'CorridorStairs'];
const ALLOWED = ['fortress', 'bastion_remnant', 'nether_fossil', 'ruined_portal_nether'];

function run(tag) {
  M.Dim.cur = 'the_nether';
  const kinds = new Set(), names = new Set();
  for (let cz = -160; cz <= 160; cz += 8) for (let cx = -160; cx <= 160; cx += 8)
    for (const s of ST.startsNear(cx, cz)) { names.add(s.def.name); for (const p of s.pieces) kinds.add(p.kind); }
  M.Dim.cur = 'overworld';
  for (const k of NEED) ok(kinds.has(k), tag + 'fortress piece kind never produced: ' + k);
  for (const n of names) ok(ALLOWED.includes(n), tag + 'non-nether structure started in the Nether: ' + n);
  ok(names.has('fortress'), tag + 'no fortress start in the Nether');
  const d = ST.defs;
  for (const n of ALLOWED) ok(d[n] && d[n].dim === 'the_nether', tag + n + ' row missing or not Nether-gated');
  ok(d.nether_fossil && d.nether_fossil.step === ST.STEP_OF.nether_fossil, tag + 'nether_fossil step');
  ok(d.fortress && d.fortress.step === ST.STEP_OF.fortress, tag + 'fortress step');
  // fortress spawn_overrides.monster: blaze/zombified_piglin/wither_skeleton/skeleton/magma_cube inside a piece
  M.Dim.cur = 'the_nether';
  let sp = null;
  for (let cz = -160; cz <= 160 && !sp; cz += 8) for (let cx = -160; cx <= 160 && !sp; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'fortress' && s.pieces.length) {
      const q = s.pieces[0]; sp = ST.spawnOverride(q.x0, q.y0, q.z0, 'monster', false); break;
    }
  M.Dim.cur = 'overworld';
  const names2 = sp ? sp.map((e) => e.type).sort().join() : '';
  ok(names2 === 'blaze,magma_cube,skeleton,wither_skeleton,zombified_piglin', tag + 'fortress monster spawn override: ' + names2);
  // ruined_portal_nether: the Nether member of the mixed ruined_portals set starts in the Nether, inside y 15..127
  M.Dim.cur = 'the_nether';
  let rp = 0, rpBad = 0;
  for (let cz = -400; cz <= 400; cz += 4) for (let cx = -400; cx <= 400; cx += 4)
    for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'ruined_portal_nether') { rp++; if (s.y0 < 15 || s.y1 > 127) rpBad++; }
  M.Dim.cur = 'overworld';
  ok(rp > 0, tag + 'no ruined_portal_nether start in the Nether');
  ok(rpBad === 0, tag + 'nether ruined portal out of the Nether column: ' + rpBad);
  // nether_fossil: a real template piece (fossil_1..14), placed in the Nether column, in a soul_sand_valley column
  M.Dim.cur = 'the_nether';
  let nf = 0, nfBad = 0;
  const NTr = M.NetherTerrain, T = M.Templates;
  for (let cz = -96; cz <= 96; cz += 8) for (let cx = -96; cx <= 96; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'nether_fossil') {
      nf++;
      const p = s.pieces[0];
      if (!p || p.y0 <= 32 || p.y1 > 127 || !/^nether_fossils\/fossil_\d+$/.test(String(T.names()[p.tpl]))) nfBad++;
    }
  M.Dim.cur = 'overworld';
  ok(nf > 0, tag + 'no nether_fossil start in the Nether');
  ok(nfBad === 0, tag + 'nether_fossil piece wrong (not a fossil template / outside y 33..127): ' + nfBad);
  // bastion_remnant: jigsaw pieces from bastion/ templates, start piece at y 33 (no heightmap projection)
  M.Dim.cur = 'the_nether';
  let bn = 0, bnBad = 0;
  for (let cz = -200; cz <= 200; cz += 8) for (let cx = -200; cx <= 200; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'bastion_remnant') {
      bn++;
      const p0 = s.pieces[0];
      if (s.pieces.length < 2 || !p0 || p0.y0 !== 33 || !s.pieces.every((p) => /^bastion\//.test(String(T.names()[p.tpl])))) bnBad++;
    }
  M.Dim.cur = 'overworld';
  ok(bn > 0, tag + 'no bastion_remnant start in the Nether');
  ok(bnBad === 0, tag + 'bastion pieces wrong (not bastion/ templates, <2 pieces, or start not at y 33): ' + bnBad);
  // ruined_portal_nether processors (RuinedPortalStructurePiece IN_NETHER + BlackstoneReplacementStructureProcessor)
  {
    const JG = M.Jigsaw || M.JG, S = M.States, st = (n) => S.stateOf(n);
    const f = JG && JG.rpNether;
    ok(typeof f === 'function', tag + 'no rpNether processor');
    if (typeof f === 'function') {
      const cnt = (name) => { let n = 0, tot = 4000; for (let i = 0; i < tot; i++) if (f(st(name), 77, i, i * 3 % 50, i * 7 % 31) === st('magma_block')) n++; return n / tot; };
      const lv = cnt('lava'), nr = cnt('netherrack');
      ok(Math.abs(lv - 0.2) < 0.03, tag + 'lava->magma fraction ' + lv);
      ok(Math.abs(nr - 0.07) < 0.02, tag + 'netherrack->magma fraction ' + nr);
      let air = 0; for (let i = 0; i < 4000; i++) if (f(st('gold_block'), 5, i, 3, i % 9) === 0) air++;
      ok(Math.abs(air / 4000 - 0.3) < 0.03, tag + 'gold->air fraction ' + air / 4000);
      for (const [a, b] of [['cobblestone', 'blackstone'], ['mossy_stone_bricks', 'polished_blackstone_bricks'], ['iron_bars', 'chain'], ['cracked_stone_bricks', 'cracked_polished_blackstone_bricks']])
        ok(f(st(a), 1, 2, 3, 4) === st(b), tag + a + ' not replaced by ' + b);
      ok(f(st('oak_planks'), 1, 2, 3, 4) === st('oak_planks'), tag + 'unmapped block changed');
      // stairs keep facing/half
      const P = M.Reg.PROP, src = S.withProp(S.withProp(st('stone_brick_stairs'), P.facing, M.Reg.valueId ? M.Reg.valueId.east : 0), P.half, 0);
      const out = f(src, 1, 2, 3, 4);
      ok(S.name(out) === 'polished_blackstone_brick_stairs' && S.propValue(out, P.facing) === S.propValue(src, P.facing) && S.propValue(out, P.half) === S.propValue(src, P.half), tag + 'stairs state not copied');
    }
  }
  let ow = 0;
  for (let cz = -80; cz <= 80; cz += 8) for (let cx = -80; cx <= 80; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (ALLOWED.includes(s.def.name)) ow++;
  ok(ow === 0, tag + 'nether structure started in the overworld: ' + ow);
}
run('');
let caught = 0;
function breakIt(name, mut, restore) {
  const before = fails.length; mut();
  try { run('[' + name + '] '); } catch (e) { fails.push('x'); }
  restore();
  if (fails.length > before) { caught++; fails.length = before; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
}
const dimSave = ST.sets.map((s) => s.dim);
breakIt('sets ungated', () => ST.sets.forEach((s) => { s.dim = 'overworld'; }), () => ST.sets.forEach((s, i) => { s.dim = dimSave[i]; }));
const g = ST.defs.fortress.grammar, ex = g.expand;
breakIt('bridge pieces dropped', () => { g.expand = (st, r) => ex(st, r).filter((p) => p.kind !== 'BridgeStairs'); ST.dropCache(); }, () => { g.expand = ex; ST.dropCache(); });
const bd = ST.defs.bastion_remnant.dim;
breakIt('bastion row ungated', () => { ST.defs.bastion_remnant.dim = 'overworld'; }, () => { ST.defs.bastion_remnant.dim = bd; });
const fs = ST.defs.nether_fossil.step;
breakIt('fossil wrong step', () => { ST.defs.nether_fossil.step = 0; }, () => { ST.defs.nether_fossil.step = fs; });
const rd = ST.defs.ruined_portal_nether.dim;
breakIt('nether portal ungated', () => { ST.defs.ruined_portal_nether.dim = 'overworld'; ST.dropCache(); }, () => { ST.defs.ruined_portal_nether.dim = rd; ST.dropCache(); });
const so = ST.defs.fortress.spawnOverrides;
breakIt('fortress spawn override dropped', () => { ST.defs.fortress.spawnOverrides = null; }, () => { ST.defs.fortress.spawnOverrides = so; });
const fg = ST.defs.nether_fossil.grammar, fex = fg.expand;
breakIt('fossil pieces dropped', () => { fg.expand = () => null; ST.dropCache(); }, () => { fg.expand = fex; ST.dropCache(); });
const bg = ST.defs.bastion_remnant.grammar, bex = bg.expand;
breakIt('bastion pieces dropped', () => { bg.expand = () => null; ST.dropCache(); }, () => { bg.expand = bex; ST.dropCache(); });
{
  const JG = M.Jigsaw || M.JG, map = JG.rpNetherMap, orig = map.cobblestone;
  breakIt('blackstone map cut', () => { map.cobblestone = 'stone'; JG.rpNetherReset(); }, () => { map.cobblestone = orig; JG.rpNetherReset(); });
}

// ── bastion chest loot: the table each template's chest carries, against the real 1.18.2 jar's NBT
import { jarPath } from './paths.mjs';
import { Jar } from './jarlib.mjs';
import { readNBT } from './nbt.mjs';
{
  const jarFile = jarPath('1.18.2');
  const want = {};
  const jar = new Jar(jarFile);
  for (const n of jar.names()) {
    if (!/^data\/minecraft\/structures\/bastion\/.*\.nbt$/.test(n)) continue;
    const t = new Set(JSON.stringify(readNBT(jar.read(n)), (k, v) => typeof v === 'bigint' ? String(v) : v).match(/chests\/[a-z_]+/g) || []);
    if (t.size) want[n.slice('data/minecraft/structures/'.length, -4)] = [...t];
  }
  const JGx = M.Jigsaw;
  const lootRun = (tag) => {
    const keys = Object.keys(want);
    ok(keys.length >= 20, tag + 'jar yields too few bastion chest templates: ' + keys.length);
    for (const k of keys) {
      ok(want[k].length === 1, tag + k + ' has several loot tables');
      ok(JGx.CHEST_LOOT[k] === want[k][0].slice(7), tag + k + ' loot ' + JGx.CHEST_LOOT[k] + ' != jar ' + want[k][0]);
    }
    for (const k of Object.keys(JGx.CHEST_LOOT)) ok(want[k], tag + k + ' in CHEST_LOOT but no chest in the jar template');
  };
  lootRun('');
  const saved = Object.assign({}, JGx.CHEST_LOOT);
  const brk = (name, mut) => { const b = fails.length; mut(); lootRun('[' + name + '] '); const hit = fails.length > b; fails.length = b; JGx.CHEST_LOOT = Object.assign({}, saved);
    if (hit) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name); };
  brk('treasure -> other', () => { JGx.CHEST_LOOT['bastion/treasure/bases/centers/center_0'] = 'bastion_other'; });
  brk('entry dropped', () => { delete JGx.CHEST_LOOT['bastion/bridge/starting_pieces/entrance']; });
  brk('phantom entry', () => { JGx.CHEST_LOOT['bastion/nope'] = 'bastion_other'; });
}
console.log(`${caught} breaks caught`);
if (caught !== 12) fails.push('not every break caught');
for (const f of fails) console.log('   ✗ ' + f);
console.log('netherstructcheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
