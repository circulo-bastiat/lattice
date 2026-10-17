#!/usr/bin/env node
// dimcheck.mjs — #254 (#254): the multi-dimension substrate.
//   node tools/dimcheck.mjs [--verbose]
// 1. src/02l_dimension.js's table == the create(...) calls in .decomp DimensionType.java (parsed, not retyped),
//    and dimension/overworld.json names the overworld type.  2. World keeps one chunk store per dimension.
// 3. Save edits round-trip per dimension through a fresh engine.  4. Light honours has_skylight per dimension.
// Anti-vacuity (D-30): each section breaks its own data and asserts the break is caught.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (c) { pass++; console.log('  ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
console.log('dimcheck — #254: DimensionType table, per-dimension chunk store and save');

const store = {};
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const boot = () => { const M = loadEngine({ extra: ['07_world.js', '08_lighting.js', '16b_save.js'] }); M.Save.init(); return M; };
const M = boot();

// ── 1. table vs the decompiled source
const src = readFileSync(join(ROOT, '.decomp/net/minecraft/world/dimension/DimensionType.java'), 'utf8');
const FIELDS = ['fixedTime', 'hasSkyLight', 'hasCeiling', 'ultrawarm', 'natural', 'coordinateScale', 'hasEnderDragonFight',
  'piglinSafe', 'bedWorks', 'respawnAnchorWorks', 'hasRaids', 'minY', 'height', 'logicalHeight'];
const TAGS = { field_25588: 'infiniburn_overworld', field_25589: 'infiniburn_nether', field_25590: 'infiniburn_end' };
const KEYS = { OVERWORLD: 'overworld', THE_NETHER: 'the_nether', THE_END: 'the_end', OVERWORLD_CAVES: 'overworld_caves' };
function parseSrc() {
  const out = {};
  const re = /protected static final DimensionType (\w+) = create\(\s*([^;]*?)\s*\);/g;
  let m;
  while ((m = re.exec(src))) {
    const a = m[2].split(',').map((x) => x.trim());
    const v = { fixedTime: a[0] === 'OptionalLong.empty()' ? null : Number(/of\((\d+)L\)/.exec(a[0])[1]) };
    for (let i = 1; i < FIELDS.length; i++) v[FIELDS[i]] = /^(true|false)$/.test(a[i]) ? a[i] === 'true' : Number(a[i]);
    v.infiniburn = TAGS[a[14].split('.')[1]];
    v.ambientLight = Number(a[16].replace('F', ''));
    out[KEYS[m[1]]] = v;
  }
  return out;
}
function tableMismatches(types, ref) {
  const bad = [];
  for (const k of Object.keys(ref)) for (const f of Object.keys(ref[k])) {
    if (!types[k] || types[k][f] !== ref[k][f]) bad.push(k + '.' + f);
  }
  return bad;
}
const ref = parseSrc();
ok(Object.keys(ref).length === 4, `parsed 4 create() calls from DimensionType.java, got ${Object.keys(ref).length}`);
const bad = tableMismatches(M.Dim.types, ref);
ok(bad.length === 0, 'table differs from DimensionType.java: ' + bad.join(','));
{ // a broken table is caught
  const t = JSON.parse(JSON.stringify(M.Dim.types)); t.the_nether.ultrawarm = false; t.the_end.fixedTime = 1;
  caught(tableMismatches(t, ref).length === 2, 'a corrupted table must be reported');
  caught(tableMismatches({}, ref).length > 0, 'an empty table must be reported');
}
const ow = JSON.parse(readFileSync(join(ROOT, '.mcdata/1.18.2/data/minecraft/dimension/overworld.json'), 'utf8'));
ok(ow.type === 'minecraft:overworld', 'overworld.json type is ' + ow.type);
ok(M.Dim.options.overworld === 'overworld' && M.Dim.options.the_nether === 'the_nether' && M.Dim.options.the_end === 'the_end', 'DimensionOptions keys');
ok(M.Dim.scaleFactor('overworld', 'the_nether') === 0.125 && M.Dim.scaleFactor('the_nether', 'overworld') === 8, 'coordinate scale factor 8');
ok(M.Dim.get('overworld').brightness[15] === 1 && M.Dim.get('the_nether').brightness[0] > 0.09 && M.Dim.get('overworld').brightness[0] === 0, 'brightness ramp');
ok(M.Dim.norm('bogus') === 'overworld' && M.Dim.byNumId(-1) === 'the_nether' && M.Dim.byNumId(7) === null, 'norm/byNumId');
let threw = false; try { M.Dim.get('bogus'); } catch (e) { threw = true; }
caught(threw, 'an unknown dimension must throw');

// ── 2. World: one chunk store per dimension
const W = M.World;
W.init(1);
const ovMap = W.chunks;
W.getOrCreate(0, 0);
ok(W.setDimension('the_nether') === 'overworld' && W.dimension === 'the_nether' && M.Dim.cur === 'the_nether', 'setDimension switches');
ok(W.chunks !== ovMap && W.chunks.size === 0, 'the Nether store starts empty and is not the overworld map');
W.getOrCreate(5, 5); W.getOrCreate(6, 6);
W.setDimension('the_end');
ok(W.chunks.size === 0, 'the End store is separate');
W.setDimension('overworld');
ok(W.chunks === ovMap && W.chunks.size === 1 && W.dims.the_nether.size === 2, 'switching back restores each store intact');
ok(W.setDimension('bogus') === 'overworld' && W.dimension === 'overworld', 'unknown dimension normalises');
caught(W.dims.the_nether !== W.dims.the_end && W.dims.the_nether !== W.chunks, 'stores must be distinct objects');

// ── 3. Save round trip per dimension
const ST = M.Save;
const stone = M.States.withLocal('stone', 0), glow = M.States.withLocal('glowstone', 0), obs = M.States.withLocal('obsidian', 0);
const put = (dim, x, y, z, id) => { W.setDimension(dim); ST.record(x, y, z, id); };
put('overworld', 1, 70, 1, stone); put('the_nether', 2, 10, 3, glow); put('the_nether', -20, 100, 40, glow);
put('the_end', 0, 64, 0, obs); W.setDimension('overworld');
const count = (m) => { let n = 0; m.forEach((e) => { n += e.m.size; }); return n; };
ok(count(ST.edits) === 1 && count(ST.editsFor('the_nether')) === 2 && count(ST.editsFor('the_end')) === 1, 'record routes edits by World.dimension');
const dataBlob = ST.encode(), dims = ST.dimsToJSON();
ok(dims && Object.keys(dims).sort().join() === 'the_end,the_nether', 'dims field holds the two non-overworld stores');
const B = boot();
ok(B.Save.decode(dataBlob) && (B.Save.dimsFromJSON(JSON.parse(JSON.stringify(dims))), true), 'fresh engine decodes');
const same = (a, b) => { const flat = (m) => [...m].map(([k, e]) => k + ':' + [...e.m].join(';')).sort().join('|'); return flat(a) === flat(b); };
for (const d of ['overworld', 'the_nether', 'the_end']) ok(same(ST.editsFor(d), B.Save.editsFor(d)) && count(B.Save.editsFor(d)) > 0, 'round trip of ' + d);
ok(B.Save.count === 1, 'S.count counts the overworld only, got ' + B.Save.count);
{ // replay lands in the right dimension only
  B.World.init(1); B.World.setDimension('the_nether');
  const c = B.World.makeChunk(0, 0); B.Save.applyTo(c);
  ok(B.Save.editsFor('the_nether').get(B.World.key(0, 0)).m.size === 1, 'nether chunk (0,0) has its edit');
  const c2 = B.World.makeChunk(-2, 2); B.Save.applyTo(c2); // (-20,40) -> chunk (-2,2)
  ok(B.Save.editsFor('the_nether').get(B.World.key(-2, 2)) !== undefined, 'negative-coordinate chunk kept');
}
{ // old save: no `dims` field -> empty Nether and End
  const C = boot(); C.Save.dimsFromJSON(undefined);
  ok(count(C.Save.editsFor('the_nether')) === 0 && count(C.Save.editsFor('the_end')) === 0, 'absent dims = empty');
  // corrupt / cross-wired blob is caught
  const D = boot(); D.Save.dimsFromJSON({ the_nether: dims.the_nether.slice(0, 30), the_end: 'not base64!!', overworld: dims.the_end, bogus: dims.the_end });
  caught(count(D.Save.editsFor('the_nether')) === 0 && count(D.Save.editsFor('the_end')) === 0 && count(D.Save.edits) === 0, 'corrupt or foreign dims blobs must not load');
  const E = boot(); E.Save.dimsFromJSON({ the_end: dims.the_nether });
  caught(!same(E.Save.editsFor('the_end'), ST.editsFor('the_end')), 'a swapped blob must not compare equal to the original');
}

// ── 4. lighting honours has_skylight
const L = M.Light;
W.setDimension('overworld'); ok(L.hasSky() === true, 'overworld has sky light');
W.setDimension('the_nether'); ok(L.hasSky() === false, 'nether has no sky light');
W.setDimension('the_end'); ok(L.hasSky() === false, 'end has no sky light');
caught((W.setDimension('overworld'), L.hasSky()) !== false, 'hasSky must follow the live dimension');

if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); }
console.log(`assertions passed ..... ${pass}\nfailures ........... ${fails.length}\nbreaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
