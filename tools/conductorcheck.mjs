#!/usr/bin/env node
// conductorcheck.mjs — #337 (G15a bug). `isRedstoneConductor`, every state, against the jar.
//
//   node tools/conductorcheck.mjs [--quiet]
//
// Vanilla's conductor test is `AbstractBlock.Settings.solidBlockPredicate` (.decomp
// AbstractBlock.java:840): DEFAULT `material.blocksLight() && isFullCube` (collision shape), overridden
// by `.solidBlock(Blocks::never | Blocks::always)` in Blocks.java. `Settings.copy` does not carry it.
// The expected table is DERIVED here, from three sources none of which is the engine:
//   1. Material.java — each constant's declaration index and whether it calls `lightPassesThrough()`;
//      the index names the obfuscated letter in tools/golden/block-materials-1.18.2.tsv (a..z, A..Z),
//      pinned by stone/glass/leaves/tnt/ice resolving to STONE/GLASS/LEAVES/TNT/ICE.
//   2. Blocks.java — every `register("name", …)` whose body, or whose `createXBlock` helper, calls
//      `.solidBlock(Blocks::never|always)`.
//   3. .mcdata/pc/blockCollisionShapes.json — the jar's collision boxes per state.
// Then `Redstone.isConductor` is compared on all 20k states, and the issue's circuits are built:
// lever → block → lamp, lit through soul_sand and stone, dark through piston/glowstone/leaves/ice/glass.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };
const DEC = join(ROOT, '.decomp/net/minecraft/block');

console.log('conductorcheck — #337 isRedstoneConductor against Material + Blocks.solidBlock + collision shapes');

// ═══════════ 1. derive vanilla ═════════════════════════════════════════════════════════════
say('\n1. the vanilla table, derived from the jar');
function materials(src) {
  const out = [];
  const re = /public static final Material (\w+) = new Material\.Builder\(([\s\S]*?)\.build\(\);/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], lightPasses: /\.lightPassesThrough\(\)/.test(m[2]) });
  return out;
}
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function matByLetter(mats) {
  const o = {};
  mats.forEach((mt, i) => { o[LETTERS[i]] = mt; });
  return o;
}
function overrides(src) {
  const helpers = {};
  const hre = /private static \w+ (create\w+)\(([\s\S]*?)(?=\n    (?:private|public) static )/g;
  let m;
  while ((m = hre.exec(src))) helpers[m[1]] = m[2];
  const out = {};
  const rre = /register\(\s*"([a-z0-9_]+)"([\s\S]*?)(?=\n    public static final |\n    private static )/g;
  const kind = (body) => /\.solidBlock\(Blocks::never\)/.test(body) ? 'never'
                      : /\.solidBlock\(Blocks::always\)/.test(body) ? 'always' : null;
  while ((m = rre.exec(src))) {
    let k = kind(m[2]);
    if (!k) {
      const h = /\b(create\w+)\(/.exec(m[2]);
      if (h && helpers[h[1]]) k = kind(helpers[h[1]]);
    }
    if (k) out[m[1]] = k;
  }
  return out;
}
const tsv = {};
for (const line of readFileSync(join(ROOT, 'tools/golden/block-materials-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!line || line[0] === '#') continue;
  const f = line.split('\t');
  tsv[f[0]] = f[1];
}
const shapesJ = JSON.parse(readFileSync(join(ROOT, '.mcdata/pc/blockCollisionShapes.json'), 'utf8'));
const isFull = (id) => {
  const s = shapesJ.shapes[String(id)];
  return !!s && s.length === 1 && s[0].join(',') === '0,0,0,1,1,1';
};
const fullAt = (name, off) => {
  const e = shapesJ.blocks[name];
  if (e === undefined) return null;
  return isFull(Array.isArray(e) ? e[off] : e);
};

const MATS = materials(readFileSync(join(DEC, 'Material.java'), 'utf8'));
const byL = matByLetter(MATS);
const OV = overrides(readFileSync(join(DEC, 'Blocks.java'), 'utf8'));
ok(MATS.length >= 40, `Material.java parsed to ${MATS.length} constants`);
for (const [b, want] of [['stone', 'STONE'], ['glass', 'GLASS'], ['oak_leaves', 'LEAVES'], ['tnt', 'TNT'],
                         ['ice', 'ICE'], ['soul_sand', 'AGGREGATE'], ['piston', 'PISTON'], ['air', 'AIR']]) {
  ok(byL[tsv[b]] && byL[tsv[b]].name === want, `tsv letter ${tsv[b]} for ${b} is ${byL[tsv[b]] && byL[tsv[b]].name}, expected ${want}`);
}
const lp = MATS.filter((x) => x.lightPasses).map((x) => x.name);
ok(['TNT', 'LEAVES', 'GLASS', 'ICE'].every((n) => lp.includes(n)) && !lp.includes('STONE'),
   `lightPassesThrough materials: ${lp.join(' ')}`);
const nNever = Object.values(OV).filter((k) => k === 'never').length;
ok(OV.soul_sand === 'always' && Object.values(OV).filter((k) => k === 'always').length === 1, 'soul_sand is the one `always`');
ok(nNever === 24, `${nNever} \`never\` overrides (glass, moving_piston, beacon, redstone_block, observer, tinted_glass, 16 stained glass, 2 pistons = 24)`);
say(`   ${MATS.length} materials (${lp.length} let light through), ${Object.keys(OV).length} overrides`);

/** vanilla isRedstoneConductor for (block name, state offset) from the three derived tables. */
function vanilla(name, off, T) {
  if (T.ov[name] === 'always') return true;
  if (T.ov[name] === 'never') return false;
  const mt = T.byL[tsv[name]];
  if (!mt) return null;
  const f = fullAt(name, off);
  if (f === null) return null;
  return !mt.lightPasses && f;
}

// ═══════════ 2. every state ════════════════════════════════════════════════════════════════
say('\n2. every state against Redstone.isConductor');
const EXTRA = ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
const R = M.Reg, S = M.States;
function freshRs() {
  const cells = new Map();
  const k = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(k(x, y, z)) || 0, set: (x, y, z, s) => cells.set(k(x, y, z), s) };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.Redstone.init();
  return w;
}
freshRs();
const NOT_VANILLA = ['item_frame', 'glow_item_frame'];
/** list of [name, state, want] where engine disagrees with the derived table T */
function compare(T, isC) {
  const bad = []; let n = 0, unknown = 0; const unk = new Set();
  for (let b = 0; b < R.blockCount; b++) {
    const name = R.names[b];
    for (let st = R.realFirst[b]; st < R.realFirst[b + 1]; st++) {
      if (st === 0) continue;
      // item frames are ENTITIES in vanilla and blocks here; no block, no conductor
      const want = NOT_VANILLA.includes(name) ? false : vanilla(name, st - R.realFirst[b], T);
      if (want === null) { unknown++; unk.add(name); continue; }
      n++;
      if (isC(st) !== want) bad.push([name, st, want]);
    }
  }
  return { bad, n, unknown, unk };
}
const T0 = { ov: OV, byL };
const c0 = compare(T0, (st) => M.Redstone.isConductor(st));
ok(c0.n > 20000, `${c0.n} states compared (${c0.unknown} with no vanilla data)`);
ok(c0.unknown === 0, `${c0.unknown} states have no material or shape in the jar data: ${[...c0.unk].join(' ')}`);
const byBlock = {};
for (const [n, , want] of c0.bad) byBlock[n] = want;
ok(c0.bad.length === 0, `${c0.bad.length} states disagree: ` + Object.entries(byBlock).slice(0, 12).map(([n, w]) => `${n} (vanilla ${w})`).join(', '));
say(`   ${c0.n} states, ${c0.bad.length} disagree`);

// the issue's ten, named
const NAMED = { soul_sand: true, piston: false, sticky_piston: false, white_stained_glass: false, glowstone: false,
                sea_lantern: false, oak_leaves: false, ice: false, frosted_ice: false, tnt: false,
                stone: true, redstone_lamp: true, packed_ice: true, glass: false, chorus_flower: false };
for (const [n, want] of Object.entries(NAMED)) {
  ok(M.Redstone.isConductor(S.stateOf(n)) === want, `${n} ${want ? 'conducts' : 'does not conduct'}`);
}

// ═══════════ 3. circuits ═══════════════════════════════════════════════════════════════════
say('\n3. lever on one face, lamp on the other');
function circuit(block) {
  const w = freshRs();
  const B = M.Behave, Rs = M.Redstone;
  w.set(0, 0, 0, S.stateOf(block));
  w.set(1, 0, 0, S.stateOf('redstone_lamp'));
  // a wall lever on the block's west face faces west, away from the block
  w.set(-1, 0, 0, B.setProp(B.setProp(B.setProp(S.stateOf('lever'), 'face', 'wall'), 'facing', 'west'), 'powered', false));
  Rs.update(-1, 0, 0);
  Rs.setPowered(-1, 0, 0, true);
  Rs.update(1, 0, 0);
  return Rs.boolProp(w.get(1, 0, 0), 'lit');
}
for (const [blk, want] of [['stone', true], ['soul_sand', true], ['piston', false], ['sticky_piston', false],
                           ['glowstone', false], ['oak_leaves', false], ['ice', false], ['white_stained_glass', false],
                           ['sea_lantern', false], ['tnt', false]]) {
  const got = circuit(blk);
  ok(got === want, `lever → ${blk} → lamp is ${got ? 'LIT' : 'dark'}, vanilla ${want ? 'lit' : 'dark'}`);
}

// ═══════════ 4. anti-vacuity ═══════════════════════════════════════════════════════════════
say('\n4. anti-vacuity: break it, and it must be caught');
{
  // (a) the pre-#337 engine: collision-full-cube only, soul_sand NEVER
  const Rs = M.Redstone;
  const keep = { N: Rs.NEVER_CONDUCTS, A: Rs.ALWAYS_CONDUCTS, L: Rs.LIGHT_PASSES };
  Rs.NEVER_CONDUCTS = ['beacon', 'glass', 'moving_piston', 'observer', 'redstone_block', 'soul_sand', 'tinted_glass'];
  Rs.ALWAYS_CONDUCTS = []; Rs.LIGHT_PASSES = [];
  freshRs();
  const cOld = compare(T0, (st) => Rs.isConductor(st));
  const names = new Set(cOld.bad.map((x) => x[0]));
  okAv(['soul_sand', 'piston', 'sticky_piston', 'white_stained_glass', 'glowstone', 'sea_lantern', 'oak_leaves', 'ice', 'frosted_ice', 'tnt']
         .every((n) => names.has(n)), `the pre-#337 table is caught on all ten blocks the issue names (${names.size} blocks disagree)`);
  okAv(circuit('soul_sand') === false && circuit('piston') === true, 'and its circuits are the issue\'s repro: soul_sand dark, piston lit');
  // (b) each engine list is load-bearing
  for (const key of ['NEVER_CONDUCTS', 'ALWAYS_CONDUCTS', 'LIGHT_PASSES']) {
    Rs.NEVER_CONDUCTS = keep.N; Rs.ALWAYS_CONDUCTS = keep.A; Rs.LIGHT_PASSES = keep.L;
    Rs[key] = [];
    freshRs();
    const c = compare(T0, (st) => Rs.isConductor(st));
    okAv(c.bad.length > 0, `emptying Redstone.${key} is caught (${c.bad.length} states)`);
  }
  Rs.NEVER_CONDUCTS = keep.N; Rs.ALWAYS_CONDUCTS = keep.A; Rs.LIGHT_PASSES = keep.L;
  freshRs();
  // (c) the derivation discriminates: forget the material term, or the overrides
  const noMat = {};
  for (const [l, mt] of Object.entries(byL)) noMat[l] = { name: mt.name, lightPasses: false };
  okAv(compare({ ov: OV, byL: noMat }, (st) => Rs.isConductor(st)).bad.length > 0,
       'a derivation without the material term disagrees with the engine');
  okAv(compare({ ov: {}, byL }, (st) => Rs.isConductor(st)).bad.length > 0,
       'a derivation without the solidBlock overrides disagrees with the engine');
  ok(compare(T0, (st) => Rs.isConductor(st)).bad.length === 0, 'restored engine agrees again');
}

console.log('');
console.log('================= conductorcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('=================================================');
process.exit(fails.length ? 1 : 0);
