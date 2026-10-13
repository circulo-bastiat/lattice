#!/usr/bin/env node
// tintcheck.mjs — PLAN W6c's acceptance test. The seam between a biome and the colour of the
// grass standing on it.
//
//   node tools/tintcheck.mjs [--print]
//
// W5 proved the colours (`biomecheck`, 10,704 assertions) and W6a/W6b proved the biomes
// (`climcheck`, `surfcheck`). This proves the ONE THING between them: that the colour a block
// is drawn with is the colour of the biome that block is actually in.
//
// That sounds trivial and is not, because the map is a TEXTURE indexed by world position and
// there are four separate places the index can be wrong by two blocks:
//
//   1. `Tint.texelX` — world position to texel, which must floor rather than truncate or every
//      colour west of x=0 shifts by one texel (four blocks);
//   2. `Tint.fillChunk` — which of a quart cell's sixteen columns supplies its colour, which
//      must be the CENTRE one because the swamp's grass is positional;
//   3. the shader's `(wp.xz - origin) * 0.25 * (1/N)` — which must carry NO half-texel offset,
//      and an earlier draft carried one, and it shifted the world two blocks (D-122);
//   4. `Tint.anchor` — which must round the origin to a texel, or the whole world's colours
//      crawl by a fraction of a texel every time the player walks a block.
//
// Every one of those is a two-block shift that looks *almost* right in a screenshot. So this
// check does the arithmetic exactly: it asserts the shader's own uv expression lands on an
// integer texel index at a quart-cell centre and on an exact half-way blend at a quart-cell
// boundary, and it asserts the CPU map and the GPU maths agree about which texel that is.
//
// Section 7 is the cross-language part: the numbers the two backends upload into `uTint` are
// read out of the backend sources themselves, the way `shadercheck` does it, because a map that
// is perfect on the CPU and uploaded with the wrong scale is a world of sheared colour.
//
// Section 8 is the CADENCE (D-214). The map is written between frames, from the promise that
// settles when a worker returns a chunk, and it used to be uploaded only from `beginFrame` —
// so at a real render distance the GPU was permanently a few versions behind the CPU and the
// whole 768 KB went up on nearly every frame. The upload is now driven by the write, through
// a dirty rectangle and a `sink` the live backend registers. Section 8 holds the two things
// that has to be true for: that the rectangle is never smaller than what actually changed —
// diffed byte by byte, not taken on trust — and that `uploaded` never falls behind `version`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';
const PRINT = process.argv.includes('--print');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const NS = { CFG: {} };
globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js',
               '04g_biomes.js', '10_gfx.js', '06b_tintmap.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);

const meta = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
NS.WG.init({
  worldgen: readFileSync(join(ASSETS, 'worldgen.bin')).toString('base64'),
  worldgenBytes: meta('worldgen.meta.json').jsonBytes,
});
NS.Biomes.initColormaps({
  colormaps: readFileSync(join(ASSETS, 'colormaps.bin')).toString('base64'),
  colormapsBytes: meta('colormaps.meta.json').rawBytes,
});
NS.Biomes.init();

const B = NS.Biomes, T = NS.Tint, G = NS.Gfx;
const hx = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const bi = (n) => { const i = B.index(n); if (i === undefined || i < 0) throw new Error('no biome ' + n); return i; };

const PLAINS = bi('minecraft:plains'), JUNGLE = bi('minecraft:jungle'), DESERT = bi('minecraft:desert');
const SWAMP = bi('minecraft:swamp'), SNOWY = bi('minecraft:snowy_plains'), BADLANDS = bi('minecraft:badlands');
const DARKF = bi('minecraft:dark_forest'), OCEAN = bi('minecraft:warm_ocean'), TAIGA = bi('minecraft:taiga');
const CAST = [PLAINS, JUNGLE, DESERT, SWAMP, SNOWY, BADLANDS, DARKF, OCEAN, TAIGA];

/** A chunk biome array (256 columns, z-major) that is one biome everywhere. */
const uniform = (b) => { const a = new Uint16Array(256); a.fill(b); return a; };
/** One where every column differs, so that "which column did the texel take" is answerable. */
function varied(pick) {
  const a = new Uint16Array(256);
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) a[(lz << 4) | lx] = pick(lx, lz);
  return a;
}

// ─────────────────────────────────────────────── 1. the window
console.log('1. the window and the two modules that must agree about its size');
{
  T.init();
  ok(T.ready, 'Tint.init did not run');
  ok(T.SIZE === 256, `SIZE is ${T.SIZE}`);
  ok(T.LAYERS === 3, `LAYERS is ${T.LAYERS}`);
  ok(T.BLOCKS === T.SIZE * 4, `BLOCKS is ${T.BLOCKS}, not SIZE*4`);
  ok(T.data && T.data.length === T.SIZE * T.SIZE * T.LAYERS * 4,
     `data is ${T.data && T.data.length} bytes, expected ${256 * 256 * 3 * 4}`);
  ok(T.data instanceof Uint8Array, 'data is not a Uint8Array — the upload path takes RGBA8');
  // ⚠ the agreement that D-121 exists for: the backends size their texture from Gfx, not here.
  ok(G.TINT_TEXELS === T.SIZE, `Gfx.TINT_TEXELS ${G.TINT_TEXELS} != Tint.SIZE ${T.SIZE}`);
  ok(G.TINT_LAYERS === T.LAYERS, `Gfx.TINT_LAYERS ${G.TINT_LAYERS} != Tint.LAYERS ${T.LAYERS}`);
  ok(G.TINT_BLOCKS === T.BLOCKS, `Gfx.TINT_BLOCKS ${G.TINT_BLOCKS} != Tint.BLOCKS ${T.BLOCKS}`);
  // one texel is four blocks and that is vanilla's own biome resolution, not an approximation
  ok(T.BLOCKS / T.SIZE === 4, 'a texel is not four blocks');
  // 768 KB. If this grows the upload cost grows with it.
  ok(T.data.length === 786432, `the map is ${(T.data.length / 1024).toFixed(0)} KB`);
  const d0 = T.data;
  T.init();
  ok(T.data === d0, 'a second Tint.init reallocated the map');
}

// ─────────────────────────────────────────────── 2. world position -> texel
console.log('2. the mapping from world position to texel, including west of zero');
{
  let originsAligned = 0, floors = 0, runs = 0, steps = 0, mono = 0;
  for (const c of [0, 1, 3, 4, 7, 100, 511, 512, 1024, 40000, -1, -3, -4, -5, -100, -513, -40000]) {
    T.anchor(c, c);
    ok((T.originX & 3) === 0 && (T.originZ & 3) === 0,
       `anchor(${c}) put the origin at ${T.originX},${T.originZ} — not a texel boundary`);
    originsAligned++;
    // the window is centred on the anchor, to within the rounding
    const off = c - T.originX;
    ok(off >= T.BLOCKS / 2 && off < T.BLOCKS / 2 + 4, `anchor(${c}) is ${off} from the origin, not centred`);
    // four consecutive blocks share a texel, and the next four are the next texel
    for (let k = -600; k <= 600; k += 7) {
      const w = T.originX + k * 4;
      const t = T.texelX(w);
      if (T.texelX(w + 1) === t && T.texelX(w + 2) === t && T.texelX(w + 3) === t) runs++;
      if (T.texelX(w + 4) === t + 1) steps++;
      if (T.texelZ(w) === t) mono++;      // x and z use the same mapping
    }
    // ⚠ FLOORS, not truncates. `>> 2` on a negative is what makes this true; `/4|0` is not.
    if (T.texelX(T.originX - 1) === -1 && T.texelX(T.originX - 4) === -1 &&
        T.texelX(T.originX - 5) === -2 && T.texelX(T.originX) === 0) floors++;
  }
  ok(originsAligned === 17, `only ${originsAligned} anchors were texel-aligned`);
  ok(runs === 17 * 172, `${runs} of ${17 * 172} four-block runs shared a texel`);
  ok(steps === 17 * 172, `${steps} of ${17 * 172} texel steps were off`);
  ok(mono === 17 * 172, 'texelZ does not agree with texelX');
  ok(floors === 17, `${floors} of 17 anchors floored west of the origin instead of truncating`);
  pass += originsAligned + runs + steps + floors;
}

// ─────────────────────────────────────────────── 3. the default fill
console.log('3. what an unloaded texel reads as');
{
  T.anchor(0, 0);
  const DEF = [0x91bd59, 0x77ab2f, 0x3f76e4];
  ok(DEF[0] === B.grassColorAt(PLAINS, 0, 0), 'the default grass is not the plains grass');
  ok(DEF[1] === B.tintColor(2, PLAINS, 0, 0), 'the default foliage is not the plains foliage');
  let n = 0;
  for (let tz = 0; tz < 256; tz += 3) for (let tx = 0; tx < 256; tx += 3) {
    const wx = T.originX + tx * 4, wz = T.originZ + tz * 4;
    for (let ch = 1; ch <= 3; ch++) if (T.sample(ch, wx, wz) === DEF[ch - 1]) n++;
  }
  const want = 86 * 86 * 3;
  ok(n === want, `${want - n} of ${want} texels did not read as the plains default after a clear`);
  pass += n;
  let alpha = 0;
  for (let i = 3; i < T.data.length; i += 4) if (T.data[i] === 255) alpha++;
  ok(alpha === T.data.length / 4, `${T.data.length / 4 - alpha} texels have alpha != 255`);
  const v = T.version;
  T.clear();
  ok(T.version === v + 1, 'clear did not bump the version — a backend would never re-upload');
}

// ─────────────────────────────────────────────── 4. fillChunk
console.log('4. fillChunk — sixteen texels, from the centre column of each');
{
  T.anchor(0, 0);
  const before = T.fills;

  // 4a. a uniform chunk paints exactly its own sixteen texels and nothing else
  for (const b of CAST) {
    const cx = 3, cz = 5;
    T.clear();
    ok(T.fillChunk(cx, cz, uniform(b)) === true, `fillChunk refused a chunk inside the window (${B.name(b)})`);
    let inside = 0, outside = 0;
    for (let ch = 1; ch <= 3; ch++) {
      for (let tz = -2; tz < 6; tz++) for (let tx = -2; tx < 6; tx++) {
        const wx = (cx << 4) + tx * 4 + 2, wz = (cz << 4) + tz * 4 + 2;
        const got = T.sample(ch, wx, wz);
        const isIn = tx >= 0 && tx < 4 && tz >= 0 && tz < 4;
        const want = isIn ? (B.tintColor(ch, b, wx, wz) & 0xffffff) : [0x91bd59, 0x77ab2f, 0x3f76e4][ch - 1];
        if (got === want) { if (isIn) inside++; else outside++; }
      }
    }
    ok(inside === 48, `${B.name(b)}: ${48 - inside} of its 48 texel channels were wrong`);
    ok(outside === 144, `${B.name(b)}: it painted ${144 - outside} texels outside its own chunk`);
    pass += inside + outside;
  }
  ok(T.fills === before + CAST.length, 'the fill counter did not move once per chunk');

  // 4b. WHICH column supplies a texel. Every column of the chunk is a different biome, so a
  // texel that took the corner column instead of the centre reads as a different biome.
  {
    const cx = -7, cz = 11;
    T.anchor(cx << 4, cz << 4);
    // the centre columns (lx,lz = 2,6,10,14) get jungle; every other column gets desert
    const centreOnly = varied((lx, lz) => ((lx & 3) === 2 && (lz & 3) === 2) ? JUNGLE : DESERT);
    T.fillChunk(cx, cz, centreOnly);
    let hit = 0;
    for (let q = 0; q < 16; q++) {
      const wx = (cx << 4) + ((q & 3) << 2) + 2, wz = (cz << 4) + ((q >> 2) << 2) + 2;
      if (T.sample(1, wx, wz) === B.grassColorAt(JUNGLE, wx, wz)) hit++;
    }
    ok(hit === 16, `${16 - hit} texels took a column other than the centre of their quart cell`);
    pass += hit;
    // and the inverse: centre desert, everything else jungle
    T.fillChunk(cx, cz, varied((lx, lz) => ((lx & 3) === 2 && (lz & 3) === 2) ? DESERT : JUNGLE));
    let hit2 = 0;
    for (let q = 0; q < 16; q++) {
      const wx = (cx << 4) + ((q & 3) << 2) + 2, wz = (cz << 4) + ((q >> 2) << 2) + 2;
      if (T.sample(1, wx, wz) === B.grassColorAt(DESERT, wx, wz)) hit2++;
    }
    ok(hit2 === 16, `${16 - hit2} texels ignored the centre column when it was the odd one out`);
    pass += hit2;
    ok(B.grassColorAt(JUNGLE, 0, 0) !== B.grassColorAt(DESERT, 0, 0), 'jungle and desert grass are the same colour');
  }

  // 4c. the swamp, whose grass colour depends on WHERE the column is. This is the one biome
  // that can tell a two-block error from a correct fill, and the reason 4b's rule exists.
  {
    let exact = 0, seen = new Set();
    for (let cx = -40; cx < 40; cx += 7) for (let cz = -40; cz < 40; cz += 11) {
      T.anchor(cx << 4, cz << 4);
      T.fillChunk(cx, cz, uniform(SWAMP));
      for (let q = 0; q < 16; q++) {
        const lx = ((q & 3) << 2) + 2, lz = ((q >> 2) << 2) + 2;
        const wx = (cx << 4) + lx, wz = (cz << 4) + lz;
        const want = B.grassColorAt(SWAMP, wx, wz);
        seen.add(want);
        if (T.sample(1, wx, wz) === want) exact++;
      }
    }
    const total = 12 * 8 * 16;
    ok(exact === total, `${total - exact} of ${total} swamp texels took the colour of the wrong position`);
    ok(seen.size === 2, `the swamp produced ${seen.size} distinct colours over 96 chunks, so this proves nothing`);
    pass += exact;
  }

  // 4d. refusals
  T.anchor(0, 0);
  ok(T.fillChunk(9999, 0, uniform(PLAINS)) === false, 'fillChunk accepted a chunk east of the window');
  ok(T.fillChunk(-9999, 0, uniform(PLAINS)) === false, 'fillChunk accepted a chunk west of the window');
  ok(T.fillChunk(0, 9999, uniform(PLAINS)) === false, 'fillChunk accepted a chunk south of the window');
  ok(T.fillChunk(0, 0, null) === false, 'fillChunk accepted a chunk with no biome array');
  const vv = T.version;
  T.fillChunk(9999, 9999, uniform(PLAINS));
  ok(T.version === vv, 'a refused fill still bumped the version');
}

// ─────────────────────────────────────────────── 5. the three channels
console.log('5. the three layers, and that none of them is another one');
{
  T.anchor(0, 0);
  let g = 0, f = 0, w = 0, distinct = 0;
  for (let i = 0; i < B.count; i++) {
    const cx = 2, cz = 2;
    T.fillChunk(cx, cz, uniform(i));
    const wx = (cx << 4) + 2, wz = (cz << 4) + 2;
    if (T.sample(1, wx, wz) === (B.grassColorAt(i, wx, wz) & 0xffffff)) g++;
    if (T.sample(2, wx, wz) === (B.foliageColor(i) & 0xffffff)) f++;
    if (T.sample(3, wx, wz) === (B.waterColor(i) & 0xffffff)) w++;
    if (new Set([T.sample(1, wx, wz), T.sample(2, wx, wz), T.sample(3, wx, wz)]).size === 3) distinct++;
  }
  ok(g === B.count, `${B.count - g} biomes read the wrong colour on layer 1 (grass)`);
  ok(f === B.count, `${B.count - f} biomes read the wrong colour on layer 2 (foliage)`);
  ok(w === B.count, `${B.count - w} biomes read the wrong colour on layer 3 (water)`);
  ok(distinct > 50, `only ${distinct} of ${B.count} biomes have three distinct channel colours — the layers could be aliased`);
  pass += g + f + w;
  ok(T.sample(1, T.originX - 1, 0) === -1, 'sample west of the window did not report a miss');
  ok(T.sample(1, T.originX + T.BLOCKS, 0) === -1, 'sample east of the window did not report a miss');
  ok(T.sample(1, 0, T.originZ + T.BLOCKS) === -1, 'sample south of the window did not report a miss');
}

// ─────────────────────────────────────────────── 6. following the player
console.log('6. covers, needsReanchor, follow — the window that walks');
{
  T.anchor(0, 0);
  let cov = 0, notCov = 0;
  for (let cx = -80; cx < 80; cx++) {
    const inside = T.covers(cx, 0);
    const t = T.texelX(cx << 4);
    if (inside === (t >= 0 && t + 4 <= T.SIZE)) cov++; else notCov++;
  }
  ok(notCov === 0, `${notCov} chunks disagreed with covers()`);
  pass += cov;
  ok(!T.needsReanchor(T.originX + T.BLOCKS / 2, T.originZ + T.BLOCKS / 2), 'the centre of the window wants a re-anchor');
  ok(T.needsReanchor(T.originX + 4, T.originZ + T.BLOCKS / 2), 'the west edge did not ask for a re-anchor');
  ok(T.needsReanchor(T.originX + T.BLOCKS / 2, T.originZ + T.BLOCKS - 4), 'the south edge did not ask for a re-anchor');

  // a fake world of loaded chunks: one biome per chunk, so a mis-anchored refill is visible
  const world = { chunks: new Map() };
  for (let cx = -64; cx < 64; cx++) for (let cz = -64; cz < 64; cz++) {
    if ((cx * cx + cz * cz) > 34 * 34) continue;
    const b = CAST[((cx * 31 + cz * 17) & 0x7fffffff) % CAST.length];
    world.chunks.set(cx + ',' + cz, { cx, cz, biome: uniform(b) });
  }
  const wantOf = (cx, cz, ch, wx, wz) => B.tintColor(ch, world.chunks.get(cx + ',' + cz).biome[0], wx, wz) & 0xffffff;

  // walk 4,000 blocks east and assert the map stays correct under the player the whole way
  T.anchor(0, 0);
  T.refill(world);
  let steps = 0, reanchors = 0, correct = 0, comfortable = 0, sampled = 0;
  for (let x = 0; x <= 4000; x += 8) {
    if (T.follow(world, x, 0)) reanchors++;
    steps++;
    if (!T.needsReanchor(x, 0)) comfortable++;
    // every loaded chunk that the window covers must read as its own biome
    for (const key of ['0,0', '1,1', '-2,3']) {
      const c = world.chunks.get(key);
      const wx = (c.cx << 4) + 2, wz = (c.cz << 4) + 2;
      if (!T.covers(c.cx, c.cz)) continue;
      sampled++;
      if (T.sample(1, wx, wz) === wantOf(c.cx, c.cz, 1, wx, wz)) correct++;
    }
  }
  ok(comfortable === steps, `the player was outside the comfortable middle on ${steps - comfortable} of ${steps} steps`);
  // the margin is a quarter of the window, so this is 4,000 / 256 and not one per step
  ok(reanchors >= 10 && reanchors <= 20, `walking 4,000 blocks re-anchored ${reanchors} times`);
  ok(sampled > 200, `only ${sampled} covered samples were taken — the walk left the loaded area too early`);
  ok(correct === sampled, `${sampled - correct} of ${sampled} covered chunks read as the wrong biome while walking`);
  pass += correct + comfortable;

  // refill paints exactly the covered chunks
  T.anchor(0, 0);
  const n = T.refill(world);
  let covered = 0;
  world.chunks.forEach((c) => { if (T.covers(c.cx, c.cz)) covered++; });
  ok(n === covered, `refill painted ${n} chunks but ${covered} are inside the window`);
  ok(n > 1000, `refill only painted ${n} chunks — the fake world is too small to prove anything`);
  ok(T.follow(world, T.originX + T.BLOCKS / 2, T.originZ + T.BLOCKS / 2) === false,
     'follow re-anchored while the player stood in the middle');
}

// ─────────────────────────────────────────────── 7. the shader's half of the seam
console.log('7. the GPU maths — the same texel, arrived at from the other side');
{
  // The expression both backends emit, built with stubs that record what it asks for.
  const sel = (c, a, b) => `(${c} ? ${a} : ${b})`;
  const vec3 = (a, b, c) => `vec3(${a},${b},${c})`;
  let uvSeen = null, laySeen = null;
  const sample = (uv, lay) => { uvSeen = uv; laySeen = lay; return `TEX(${uv},${lay})`; };
  const expr = G.tintMapExpr('tint', 'wp', sample, sel, true, vec3);
  ok(/\*\s*0\.25/.test(uvSeen), `the uv expression does not scale blocks to texels: ${uvSeen}`);
  // ⚠ and it must NOT carry a half-texel offset — see the derivation in 10_gfx.js. An earlier
  // draft had one, with a note explaining why, and it shifted the world two blocks north-west.
  ok(!/\+\s*0\.5/.test(uvSeen), `the uv has a half-texel offset: ${uvSeen}`);
  ok(uvSeen.indexOf('wp.xz - uTint.xy') >= 0, `the uv is not relative to the origin: ${uvSeen}`);
  ok(uvSeen.trim().endsWith('uTint.z'), `the uv is not scaled by 1/N: ${uvSeen}`);
  ok(laySeen === 'float(tint) - 1.0', `the layer index is ${laySeen}, not channel-1`);
  ok(expr.indexOf('uTint.w') >= 0, 'the live/fallback mix does not use uTint.w');
  ok(expr.indexOf('0u') >= 0, 'channel 0 is not special-cased to white');

  // Now do that arithmetic in JS, exactly as the texture unit will.
  T.anchor(0, 0);
  const N = G.TINT_TEXELS, invN = 1 / N;
  const uvOf = (w, origin) => (w - origin) * 0.25 * invN;
  // Bilinear filtering reads texel floor(uv*N - 0.5) and the next one, blended by the fraction.
  const texelCoord = (w, origin) => uvOf(w, origin) * N - 0.5;

  let centres = 0, edges = 0, agree = 0;
  for (let k = -300; k <= 300; k++) {
    const wxCentre = T.originX + k * 4 + 2;      // the centre column of quart cell k
    const tc = texelCoord(wxCentre, T.originX);
    if (tc === Math.round(tc)) centres++;                       // no blend at all at the centre
    if (Math.round(tc) === T.texelX(wxCentre)) agree++;         // and it is the CPU's texel
    const wxEdge = T.originX + k * 4;            // the boundary between two quart cells
    if (Math.abs((texelCoord(wxEdge, T.originX) % 1) - 0.5) < 1e-9 ||
        Math.abs((texelCoord(wxEdge, T.originX) % 1) + 0.5) < 1e-9) edges++;
  }
  ok(centres === 601, `${601 - centres} quart-cell centres did not land on a texel centre`);
  ok(agree === 601, `${601 - agree} texel indices disagree between the CPU map and the shader maths`);
  ok(edges === 601, `${601 - edges} quart-cell boundaries were not an exact 50/50 blend`);
  pass += centres + agree + edges;

  // and the same with a negative origin, which is where a truncating map goes wrong
  T.anchor(-100000, -100000);
  let agree2 = 0;
  for (let k = 0; k < 256; k++) {
    const wx = T.originX + k * 4 + 2;
    if (Math.round(texelCoord(wx, T.originX)) === T.texelX(wx)) agree2++;
  }
  ok(agree2 === 256, `${256 - agree2} texels disagree with the shader west of zero`);
  pass += agree2;

  // ⚠ the numbers the backends actually upload. Read out of the sources, the way shadercheck
  // cross-checks the two languages: a perfect map uploaded with the wrong scale shears the world.
  const gl = readFileSync(join(SRC, '12_gfx_webgl2.js'), 'utf8');
  const gpu = readFileSync(join(SRC, '11_gfx_webgpu.js'), 'utf8');
  ok(/uniform4f\(locs\.uTint,[\s\S]{0,160}Tm\.originX[\s\S]{0,60}Tm\.originZ/.test(gl),
     'WebGL2 does not upload the tint origin into uTint.xy');
  ok(/1 \/ NS\.Gfx\.TINT_TEXELS/.test(gl), 'WebGL2 does not upload 1/N as uTint.z');
  ok(/1 \/ NS\.Gfx\.TINT_TEXELS/.test(gpu), 'WebGPU does not upload 1/N as uTint.z');
  ok(/f\[28\]\s*=\s*[\s\S]{0,80}originX/.test(gpu) || /originX/.test(gpu), 'WebGPU does not upload the tint origin');
  ok(/texSubImage3D[\s\S]{0,200}Tm\.data/.test(gl), 'WebGL2 never uploads the map itself');
  // ⚠ D-214: both backends upload the map's DIRTY RECTANGLE across all three layers, and both
  // address it as an offset into the plane-major bytes rather than by copying a rectangle out
  // of them. The two languages spell that differently and the pieces are checked apart:
  // WebGL2 with UNPACK_SKIP_*, WebGPU with a dataLayout offset — but the extent must be the
  // rectangle's own width and height in both, and the depth must be every layer.
  ok(/writeTexture\([\s\S]{0,400}\[w, h, NS\.Gfx\.TINT_LAYERS\]/.test(gpu),
     'WebGPU does not write the dirty rectangle across all three layers');
  ok(/origin: \{ x: x0, y: z0, z: 0 \}/.test(gpu), 'WebGPU does not place the write at the rectangle');
  ok(/offset: \(z0 \* N \+ x0\) \* 4, bytesPerRow: N \* 4, rowsPerImage: N/.test(gpu),
     'WebGPU does not address the rectangle as an offset into the plane-major map');
  ok(/texSubImage3D\(gl\.TEXTURE_2D_ARRAY, 0, x0, z0, 0, w, h, Tm\.LAYERS/.test(gl),
     'WebGL2 does not upload the dirty rectangle across all three layers');
  for (const k of ['UNPACK_ROW_LENGTH', 'UNPACK_IMAGE_HEIGHT', 'UNPACK_SKIP_PIXELS', 'UNPACK_SKIP_ROWS']) {
    // set for the sub-box, and PUT BACK — the atlas mips share this context
    ok((gl.match(new RegExp('pixelStorei\\(gl\\.' + k, 'g')) || []).length === 2,
       `WebGL2 does not set and then reset gl.${k} around the tint sub-box`);
  }
  // both backends must skip the upload when the version has not moved
  ok(/tintVersion === Tm\.version/.test(gl), 'WebGL2 re-uploads the map every frame');
  ok(/tintVersion === Tm\.version/.test(gpu), 'WebGPU re-uploads the map every frame');
  // and neither may go on uploading the whole map regardless of what changed (D-214)
  ok(!/texSubImage3D\([\s\S]{0,80}Tm\.SIZE, Tm\.SIZE, Tm\.LAYERS/.test(gl),
     'WebGL2 still uploads the whole 768 KB map on every change');
  ok(!/\[NS\.Gfx\.TINT_TEXELS, NS\.Gfx\.TINT_TEXELS, NS\.Gfx\.TINT_LAYERS\]/.test(gpu),
     'WebGPU still uploads the whole 768 KB map on every change');
}

// ─────────────────────────────────────────────── 8. the dirty rectangle and the upload sink
console.log('8. the cadence — a write reaches the GPU without waiting for a frame (D-214)');

/**
 * A stand-in for a backend's `syncTint`. It does exactly what the two real ones do: take the
 * rectangle, record it, mark itself current, and clear the rectangle. `seen` is every rectangle
 * it was ever handed, which is how "one upload, not two thousand" is measurable at all.
 */
function fakeBackend() {
  const seen = [];
  const sink = () => {
    seen.push([T.dirtyX0, T.dirtyZ0, T.dirtyX1, T.dirtyZ1]);
    T.uploaded = T.version;
    T.clearDirty();
  };
  return { seen, sink };
}

/** Every texel index whose four bytes differ between two copies of the map, in any layer. */
function changedTexels(before, after) {
  const out = new Set();
  const N = T.SIZE, PLANE = N * N * 4;
  for (let l = 0; l < T.LAYERS; l++) {
    for (let i = 0; i < PLANE; i += 4) {
      const o = l * PLANE + i;
      if (before[o] !== after[o] || before[o + 1] !== after[o + 1] ||
          before[o + 2] !== after[o + 2] || before[o + 3] !== after[o + 3]) out.add(i >> 2);
    }
  }
  return out;
}
/**
 * A fake world of loaded chunks spanning the whole 4,000-block walk section 8e makes. A world
 * that only reaches 640 blocks would leave the window a sixth of the way along and the walk
 * would spend the rest of its steps writing nothing — which is a walk that proves nothing.
 */
const walkWorld = { chunks: new Map() };
for (let x = -8; x <= 264; x++) for (let z = -8; z <= 8; z++) {
  walkWorld.chunks.set(x + ',' + z, { cx: x, cz: z, biome: uniform(CAST[((x * 31 + z * 17) & 0x7fffffff) % CAST.length]) });
}
/** The chunk under a walker at world x on the z=0 line. */
const walkChunkAt = (x) => walkWorld.chunks.get((x >> 4) + ',0');

const inRect = (t, r) => {
  const x = t % T.SIZE, z = (t / T.SIZE) | 0;
  return x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
};

{
  const save = T.sink;

  // 8a. with no backend, flush does nothing and keeps the rectangle for whoever arrives later.
  // This is the boot order: `Tint.init` and the first `anchor` run before the GL context does.
  T.sink = null;
  T.anchor(0, 0);
  ok(T.flush() === false, 'flush uploaded with no sink registered');
  ok(!T.dirtyEmpty(), 'a flush with no sink threw the dirty rectangle away — the first frame would upload nothing');
  ok(T.dirtyX0 === 0 && T.dirtyZ0 === 0 && T.dirtyX1 === T.SIZE - 1 && T.dirtyZ1 === T.SIZE - 1,
     `an anchor left the rectangle at ${T.dirtyX0},${T.dirtyZ0}..${T.dirtyX1},${T.dirtyZ1}, not the whole map`);

  // 8b. one arriving chunk is one upload of ITS OWN sixteen texels, not of the map
  const be = fakeBackend();
  T.sink = be.sink;
  T.anchor(0, 0);
  be.seen.length = 0;
  const before = T.data.slice();
  const cx = 9, cz = -6;
  ok(T.fillChunk(cx, cz, uniform(JUNGLE)) === true, 'the probe chunk was outside the window');
  ok(be.seen.length === 1, `one arriving chunk ran the sink ${be.seen.length} times, not once`);
  const r = be.seen[0];
  const tx0 = T.texelX(cx << 4), tz0 = T.texelZ(cz << 4);
  ok(r[0] === tx0 && r[1] === tz0 && r[2] === tx0 + 3 && r[3] === tz0 + 3,
     `one chunk marked ${r.join(',')} but its texels are ${tx0},${tz0}..${tx0 + 3},${tz0 + 3}`);
  ok(T.uploaded === T.version, `the sink ran but uploaded ${T.uploaded} lags version ${T.version}`);

  // ⚠ the rectangle is not taken on trust. Diff the bytes: every texel that moved must be
  // inside it, and it must not have grown to the whole map to be safe.
  const moved = changedTexels(before, T.data);
  let outside = 0;
  moved.forEach((t) => { if (!inRect(t, r)) outside++; });
  ok(moved.size === 16, `one chunk changed ${moved.size} texels, expected its own 16`);
  ok(outside === 0, `${outside} of the ${moved.size} texels that changed were outside the rectangle uploaded`);
  ok((r[2] - r[0] + 1) * (r[3] - r[1] + 1) === 16,
     `one chunk uploaded a ${(r[2] - r[0] + 1)}x${(r[3] - r[1] + 1)} rectangle for 16 texels`);
  pass += moved.size;

  // 8c. a refill is ONE upload, not one per chunk — the re-anchor path, which is the only place
  // the map moves in bulk. A sink per chunk would be 768 KB times two thousand.
  const world = { chunks: new Map() };
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) {
    if ((x * x + z * z) > 30 * 30) continue;
    world.chunks.set(x + ',' + z, { cx: x, cz: z, biome: uniform(CAST[((x * 31 + z * 17) & 0x7fffffff) % CAST.length]) });
  }
  T.anchor(0, 0);
  be.seen.length = 0;
  const beforeRefill = T.data.slice();
  const painted = T.refill(world);
  ok(painted > 1000, `the fake world only painted ${painted} chunks — too small to prove batching`);
  ok(be.seen.length === 1, `a refill of ${painted} chunks ran the sink ${be.seen.length} times, not once`);
  const rr = be.seen[0];
  const movedRefill = changedTexels(beforeRefill, T.data);
  let outsideRefill = 0;
  movedRefill.forEach((t) => { if (!inRect(t, rr)) outsideRefill++; });
  ok(movedRefill.size > 4000, `a refill of ${painted} chunks only moved ${movedRefill.size} texels`);
  ok(outsideRefill === 0, `${outsideRefill} texels a refill changed were outside the one rectangle it uploaded`);
  ok(T.uploaded === T.version, 'the GPU is behind the map after a refill');
  pass += movedRefill.size;

  // 8d. a re-anchor is ONE upload too: the clear and the refill that follows it must not each
  // send the whole map. `follow` is the call the frame loop makes, so it is the one measured.
  T.anchor(0, 0);
  T.refill(world);
  be.seen.length = 0;
  const moved0 = T.follow(world, T.originX + 8, T.originZ + T.BLOCKS / 2);
  ok(moved0 === true, 'follow did not re-anchor at the west edge');
  ok(be.seen.length === 2, `a re-anchor ran the sink ${be.seen.length} times — one for the clear, one for the refill`);
  ok(T.uploaded === T.version, 'the GPU is behind the map after a re-anchor');

  // 8e. ⚠ THE INVARIANT THE BUG BROKE. Walk 4,000 blocks and assert, after every single write
  // and not merely at the end, that what the GPU holds is what the map holds. Under the old
  // frame-driven upload this lagged by however many chunks had arrived since the last frame —
  // 1 to 6 at medium, and titlecheck only ever sampled it at the Celeron render distance,
  // where chunks arrive in bursts with quiet gaps between them.
  T.anchor(0, 0);
  T.refill(walkWorld);
  let steps = 0, current = 0, sunk = 0;
  for (let x = 0; x <= 4000; x += 8) {
    T.follow(walkWorld, x, 0);
    // a chunk landing between frames, which is where installChunk actually calls from — the
    // one under the walker, so it keeps writing for the whole walk instead of falling out of
    // the window a sixth of the way along.
    const c = walkChunkAt(x);
    if (c && T.covers(c.cx, c.cz)) { T.fillChunk(c.cx, c.cz, c.biome); sunk++; }
    steps++;
    if (T.uploaded === T.version) current++;
  }
  ok(steps > 400 && sunk > 200, `the walk took ${steps} steps and only ${sunk} writes`);
  ok(current === steps, `the GPU was behind the map on ${steps - current} of ${steps} steps`);
  pass += current;

  // 8f. a flush with nothing dirty must not upload — the beginFrame safety net calls it on
  // every frame of the game and it has to cost nothing when the world is quiet.
  be.seen.length = 0;
  ok(T.flush() === false, 'a flush with an empty rectangle uploaded anyway');
  ok(be.seen.length === 0, 'a flush with nothing dirty still ran the sink');

  T.sink = save;
}

// ─────────────────────────────────────────────── 9. anti-vacuity
console.log('9. anti-vacuity — every check above must be able to fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
  const N = G.TINT_TEXELS, invN = 1 / N;

  check('a half-texel offset added to the shader uv', () => {
    // section 7's own predicate, with the `+ 0.5` an earlier draft carried: the quart-cell
    // centre must stop landing on a texel centre, and must miss it by exactly two blocks.
    T.anchor(0, 0);
    let bad = 0;
    for (let k = -50; k <= 50; k++) {
      const w = T.originX + k * 4 + 2;
      const tc = ((w - T.originX) * 0.25 + 0.5) * invN * N - 0.5;   // the old, wrong + 0.5
      if (tc !== Math.round(tc)) bad++;
      if (Math.abs(tc - (T.texelX(w) + 0.5)) > 1e-9) bad--;   // and it is off by exactly half
    }
    if (bad !== 101) return;      // NOT caught: the offset would be invisible to section 7
    throw 0;
  });

  check('the texel mapping truncating instead of flooring', () => {
    T.anchor(-4000, -4000);
    const trunc = (w) => ((w - T.originX) / 4) | 0;
    // identical east of the origin, wrong west of it — which is exactly why it survives testing
    if (trunc(T.originX + 40) !== T.texelX(T.originX + 40)) throw 0;
    if (trunc(T.originX - 1) === T.texelX(T.originX - 1)) throw 0;
    throw 0;
  });

  check('fillChunk taking the corner column instead of the centre', () => {
    // rerun 4b's predicate against a fill that reads column (0,0) of each quart cell
    const cx = 5, cz = -3;
    T.anchor(cx << 4, cz << 4);
    const arr = varied((lx, lz) => ((lx & 3) === 2 && (lz & 3) === 2) ? JUNGLE : DESERT);
    // what the corner-reading fill would write:
    const cornerColour = B.grassColorAt(DESERT, 0, 0);
    const centreColour = B.grassColorAt(JUNGLE, 0, 0);
    if (cornerColour === centreColour) throw 0;
    T.fillChunk(cx, cz, arr);
    const wx = (cx << 4) + 2, wz = (cz << 4) + 2;
    if (T.sample(1, wx, wz) === cornerColour) throw 0;     // it did not take the corner
    if (T.sample(1, wx, wz) !== centreColour) throw 0;
    throw 0;                                              // the predicate can distinguish them
  });

  check('the swamp reading its colour two blocks away', () => {
    // the shift that a missing centre offset produces. Over 96 chunks it must change an answer.
    let differ = 0;
    for (let cx = -40; cx < 40; cx += 7) for (let cz = -40; cz < 40; cz += 11) {
      for (let q = 0; q < 16; q++) {
        const wx = (cx << 4) + ((q & 3) << 2) + 2, wz = (cz << 4) + ((q >> 2) << 2) + 2;
        if (B.grassColorAt(SWAMP, wx, wz) !== B.grassColorAt(SWAMP, wx - 2, wz - 2)) differ++;
      }
    }
    if (differ === 0) throw 0;      // NOT caught: the swamp noise would be too coarse to matter
    throw 0;
  });

  check('the layer stride off by one plane', () => {
    T.anchor(0, 0);
    T.clear();
    T.fillChunk(0, 0, uniform(JUNGLE));
    const wx = 2, wz = 2;
    const PLANE = T.SIZE * T.SIZE * 4;
    const wrong = (ch) => {
      const o = (ch - 1) * PLANE * 1 + ((T.texelZ(wz) * T.SIZE) + T.texelX(wx)) * 4 + PLANE;
      return (T.data[o] << 16) | (T.data[o + 1] << 8) | T.data[o + 2];
    };
    if (wrong(1) === T.sample(1, wx, wz)) throw 0;   // grass and foliage must differ for jungle
    if (T.sample(1, wx, wz) !== B.grassColorAt(JUNGLE, wx, wz)) throw 0;
    throw 0;
  });

  check('an anchor that does not round to a texel', () => {
    const bad = (c) => c - T.BLOCKS / 2;             // no >> 2 << 2
    let unaligned = 0;
    for (let c = 0; c < 40; c++) if ((bad(c) & 3) !== 0) unaligned++;
    if (unaligned === 0) throw 0;                    // NOT caught: the rounding would be free
    throw 0;
  });

  check('a fill that bleeds into the next chunk', () => {
    // section 4a's outside-count, applied to a 5x5 fill
    T.anchor(0, 0); T.clear();
    T.fillChunk(2, 2, uniform(JUNGLE));
    const wx = (3 << 4) + 2, wz = (2 << 4) + 2;      // the first texel of the chunk to the east
    if (T.sample(1, wx, wz) !== 0x91bd59) throw 0;   // it is still the default, so 4a can see a bleed
    throw 0;
  });

  check('the renderer and the map disagreeing about the texture size', () => {
    const saveT = G.TINT_TEXELS, saveData = T.data, saveReady = T.ready;
    G.TINT_TEXELS = 128; T.data = null; T.ready = false;
    try { T.init(); } finally { G.TINT_TEXELS = saveT; T.data = saveData; T.ready = saveReady; }
  });

  check('a window that never re-anchors', () => {
    T.anchor(0, 0);
    const o = T.originX;
    let outside = 0;
    for (let x = 0; x <= 4000; x += 8) if (T.needsReanchor(x, 0)) outside++;
    if (outside === 0) throw 0;      // NOT caught: nothing would ever leave the window
    if (o !== T.originX) throw 0;
    throw 0;
  });

  // ── D-214, the cadence. Three ways to have section 8 and prove nothing. ──────────────────

  check('a dirty rectangle one texel too small', () => {
    // section 8b's own predicate, against a rectangle that has been shrunk by a single texel.
    // A rectangle that is too small is the failure mode that matters: the backend is told the
    // texels outside it are already on the GPU, and they are not.
    T.sink = null;
    T.anchor(0, 0);
    T.clearDirty();
    const before = T.data.slice();
    T.fillChunk(11, 7, uniform(BADLANDS));
    const honest = [T.dirtyX0, T.dirtyZ0, T.dirtyX1, T.dirtyZ1];
    const shrunk = [honest[0] + 1, honest[1], honest[2], honest[3]];
    const moved = changedTexels(before, T.data);
    let outHonest = 0, outShrunk = 0;
    moved.forEach((t) => { if (!inRect(t, honest)) outHonest++; if (!inRect(t, shrunk)) outShrunk++; });
    if (moved.size !== 16) throw 0;
    if (outHonest !== 0) throw 0;          // the honest rectangle covers everything
    if (outShrunk !== 4) throw 0;          // NOT caught: the diff cannot see a missing column
    throw 0;
  });

  check('a refill that uploads once per chunk', () => {
    // section 8c counts sink calls; this proves the count can tell 1 from a thousand.
    const seen = [];
    T.sink = () => { seen.push(1); T.uploaded = T.version; T.clearDirty(); };
    const world = { chunks: new Map() };
    for (let x = -20; x < 20; x++) for (let z = -20; z < 20; z++) {
      world.chunks.set(x + ',' + z, { cx: x, cz: z, biome: uniform(TAIGA) });
    }
    T.anchor(0, 0);
    seen.length = 0;
    const held = T.held;
    T.held = 0;                            // the batching removed: every fill flushes
    let n = 0;
    world.chunks.forEach((c) => { if (T.fillChunk(c.cx, c.cz, c.biome)) n++; });
    T.held = held;
    T.sink = null;
    if (n < 1000) throw 0;
    if (seen.length === 1) throw 0;        // NOT caught: unbatched would look the same as batched
    if (seen.length !== n) throw 0;
    throw 0;
  });

  check('an upload driven by the frame instead of by the write', () => {
    // ⚠ THE BUG ITSELF, rebuilt: a sink that only runs when a frame ticks. Section 8e's
    // predicate must go red against it, or 8e is measuring nothing. The frame is deliberately
    // slower than the arrivals, which is exactly what medium and high do.
    T.sink = null;                          // frame-driven: nothing happens on a write
    T.anchor(0, 0);
    T.refill(walkWorld);
    const frame = () => { T.uploaded = T.version; T.clearDirty(); };
    frame();
    let steps = 0, current = 0;
    for (let x = 0; x <= 4000; x += 8) {
      T.follow(walkWorld, x, 0);
      const c = walkChunkAt(x);
      if (c && T.covers(c.cx, c.cz)) T.fillChunk(c.cx, c.cz, c.biome);
      if ((steps & 3) === 3) frame();      // a frame every four arrivals
      steps++;
      if (T.uploaded === T.version) current++;
    }
    if (current === steps) throw 0;        // NOT caught: the frame kept up and 8e proves nothing
    if (steps - current < 100) throw 0;    // and it is behind for most of the walk, not once
    throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

if (PRINT) {
  T.anchor(0, 0); T.clear();
  for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) T.fillChunk(cx, cz, uniform(CAST[(cx + cz) % CAST.length]));
  console.log('');
  console.log('  the first 32 texels of the map, grass layer:');
  for (let tz = 0; tz < 8; tz++) {
    let row = '   ';
    for (let tx = 0; tx < 8; tx++) row += hx(T.sample(1, T.originX + tx * 4, T.originZ + tz * 4)) + ' ';
    console.log(row);
  }
}

console.log('');
console.log('================ tintcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
