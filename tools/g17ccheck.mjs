#!/usr/bin/env node
// g17ccheck.mjs — PLAN G17c. The entities you can SEE: the geometry, the roster, the placement.
//
//   node tools/g17ccheck.mjs [--verbose]
//
// ⚠ WHAT THIS EXISTS TO CATCH. G17a read the entity table and G17b built the motion, and both
// were behind green checks while **nothing in the game had ever drawn an entity**. `NEXT.md`
// said so in as many words: *"no entity is spawned during play, so there is no play-test item
// for G17b."* This file holds the arithmetic of the picture; `g17cbcheck` watches it reach a
// real screen, because a stage whose output is a moving picture and whose checks only hold
// numbers is a stage that can ship drawing nothing (D-303, D-304).
//
// ⚠⚠ **§1 IS THE ONE THAT MATTERS.** `EntityRender.emit` is a second writer of the model vertex
// stream, and a second writer is exactly what D-314 cost a session over: the mesher packed the
// face in one convention and the icon rasteriser read it in another, and every model block in
// the world was lit as if lying on its side while `emitcheck` stayed green — because it asserted
// each writer copied its OWN source, never that the two agreed. So the first thing here is that
// for a whole-block offset the entity writer produces **byte-for-byte** what the mesher does.

import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('g17ccheck — PLAN G17c, the entities you can see (D-321)');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  // D-407: the mob draw path (ER.mobLayerFor) reads BEModel, so §3's closed roster needs it up.
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                    modelsBytes: mm.rawBytes });
}
M.DATA = Object.assign({}, M.DATA,
  { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
{
  // ⚠ THE ITEM TABLE IS LOADED HERE because §9 needs to turn an item into a block state, which is
  // the whole question an item entity asks.
  const meta = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/items.meta.json', 'utf8'));
  M.Items.init({ items: readFileSync(MCLITE_ROOT + 'assets/items.bin').toString('base64'),
                 itemsBytes: meta.rawBytes });
}
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();

const EL = M.EntityList, ER = M.EntityRender, Me = M.Mesher, SR = M.States, CFG = M.CFG;
ok(ER.ready, 'the entity renderer is up');
ok(EL.ready, 'the entity list is up');

// a floor so nothing tunnels, and a light the world can answer for
const FLOOR = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR;
let LIGHT = 0xF0;
M.World = M.World || {};
M.World.getLight = () => LIGHT;

const stateOf = (n) => SR.stateOf(n) | 0;
const SAND = stateOf('sand'), TNT = stateOf('tnt'), STONE = stateOf('stone');
ok(SAND > 0 && TNT > 0, `sand is state ${SAND} and tnt is state ${TNT}`);

// ═══════════════ 1. the entity writer and the MESHER writer agree ══════════════════════════
console.log('\n 1. the second writer of the model stream agrees with the first (D-314)');
{
  // ⚠ ALL SEVEN LIGHT BYTES ARE THE SAME VALUE ON PURPOSE. `emitModelBlock` gives a quad the
  // light of the cell its cullface looks into and `EntityRender.emit` gives every quad the cell
  // the entity stands in — which is right, because an entity has no neighbours. Making the
  // seven equal removes the one difference the two writers are ENTITLED to have, so anything
  // left over is a real disagreement about winding, face order, tint or UV.
  const L = 0xF3;
  const lite0 = L | (L << 8) | (L << 16) | (L << 24);
  const lite1 = lite0;
  const U = CFG.MODEL_UNITS_PER_BLOCK;

  const compare = (state, bx, by, bz) => {
    const vis = SR.vis[state];
    const n = Me.modelQuadCount(vis, bx, by, bz, 0, 0, 0, 0);
    if (!n) return { n: 0, same: true };
    const a = new Uint32Array(n * 16), b = new Uint32Array(n * 16);
    Me.emitModelBlock(a, 0, vis, bx, by, bz, lite0, lite1, 3, 0, 0, 0, 0);
    ER.emit(b, 0, state, bx * U, by * U, bz * U, L >> 4, L & 15, bx, by, bz);
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return { n, same: diff === 0, diff };
  };

  let tested = 0, agreed = 0, skipped = 0;
  const NAMES = ['sand', 'gravel', 'tnt', 'stone', 'grass_block', 'oak_slab', 'oak_stairs',
                 'oak_fence', 'torch', 'dandelion', 'oak_leaves', 'glass', 'anvil', 'cactus',
                 'ladder', 'rail', 'lever', 'stone_button', 'snow', 'cake'];
  for (const name of NAMES) {
    const st = stateOf(name);
    if (!st) { skipped++; continue; }
    const r = compare(st, 3, 5, 9);
    if (!r.n) { skipped++; continue; }
    tested++;
    if (r.same) agreed++;
    ok(r.same, `${name}: the entity writer and the mesher write the same ${r.n} quads` +
       (r.same ? '' : ` (${r.diff} words differ)`));
  }
  console.log(`    ${agreed}/${tested} states agree word for word (${skipped} have no model stream)`);
  ok(tested >= 8, `at least eight model states were compared (${tested})`);

  // ⚠ AND IT IS COMPARED AT MORE THAN ONE CELL, because `partFor` takes the position — a state
  // with random variants can choose a different part at a different coordinate, and a check
  // pinned to one cell would never see the two writers disagree about which variant they picked.
  let multi = 0;
  for (const [x, y, z] of [[0, 0, 0], [1, 2, 3], [15, 9, 15], [7, 1, 12]]) {
    const r = compare(SAND, x, y, z);
    if (r.same) multi++;
  }
  ok(multi === 4, `sand agrees at all four cells (${multi}/4)`);
}

// ═══════════════ 2. anti-vacuity for §1 ════════════════════════════════════════════════════
console.log('\n 2. anti-vacuity — the agreement is broken and the break must be caught');
{
  const L = 0xF3, lite0 = L | (L << 8) | (L << 16) | (L << 24);
  const U = CFG.MODEL_UNITS_PER_BLOCK, vis = SR.vis[SAND];
  const n = Me.modelQuadCount(vis, 0, 0, 0, 0, 0, 0, 0);
  const a = new Uint32Array(n * 16), b = new Uint32Array(n * 16);
  Me.emitModelBlock(a, 0, vis, 0, 0, 0, lite0, lite0, 3, 0, 0, 0, 0);

  // the corner order put back the way it was before D-133
  const realPack = Me.packModelVertex;
  ER.emit(b, 0, SAND, 0, 0, 0, L >> 4, L & 15, 0, 0, 0);
  let base = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) base++;
  okAv(base === 0, 'anti-vacuity: the unbroken comparison really is identical');

  // a one-unit shift must be visible, or the comparison is not looking at positions
  const c = new Uint32Array(n * 16);
  ER.emit(c, 0, SAND, 1, 0, 0, L >> 4, L & 15, 0, 0, 0);
  let moved = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) moved++;
  okAv(moved > 0, `anti-vacuity: a one-256th shift changes ${moved} words, so positions are compared`);

  // the face field put back to the raw vanilla direction — D-314's bug, re-created
  const MAP = Me.MESH_OF_DIR;
  const savedMap = MAP.slice();
  for (let i = 0; i < MAP.length; i++) MAP[i] = i;
  const d = new Uint32Array(n * 16);
  ER.emit(d, 0, SAND, 0, 0, 0, L >> 4, L & 15, 0, 0, 0);
  for (let i = 0; i < MAP.length; i++) MAP[i] = savedMap[i];
  let faced = 0; for (let i = 0; i < a.length; i++) if (a[i] !== d[i]) faced++;
  okAv(faced > 0, `anti-vacuity: un-mapping the face breaks ${faced} words — D-314 would be caught here`);
  ok(Me.packModelVertex === realPack, 'the packer was not replaced by this section');
}

// ═══════════════ 3. the roster is CLOSED ═══════════════════════════════════════════════════
console.log('\n 3. every spawnable type is either drawn or named as owed');
{
  const spawnable = EL.spawnable();
  ok(spawnable.length > 0, `${spawnable.length} types can be spawned`);
  // D-407: a type is DRAWN through ER.SHAPE (block/item) OR the mob path (ER.mobLayerFor).
  const drawn = spawnable.filter((n) => !!ER.SHAPE[n] || !!ER.mobLayerFor(n));
  // ⚠ PASS 15: ER.OWED entries now carry their stage as `name — Gxx`, the way Use.OWED
  // does, so stagecheck can cite-sweep them. The exact spawnable NAME is the part before
  // the dash; a malformed entry with no dash would compare the whole string and never
  // match a real type, which the anti-vacuity check below catches.
  const owed = ER.OWED.map((s) => s.split(' — ')[0].trim());
  const unaccounted = spawnable.filter((n) => drawn.indexOf(n) < 0 && owed.indexOf(n) < 0);
  ok(unaccounted.length === 0,
     `every spawnable type is accounted for (${unaccounted.join(', ') || 'none missing'})`);
  // ⚠ AND THE OWED LIST MAY NOT CARRY A TYPE THAT IS ACTUALLY DRAWN, or the list stops meaning
  // anything the moment a type is implemented and nobody takes it off.
  const stale = owed.filter((n) => drawn.indexOf(n) >= 0);
  ok(stale.length === 0, `the owed list has no drawn types on it (${stale.join(', ') || 'clean'})`);
  // ...nor a type that cannot be spawned at all
  const ghosts = owed.filter((n) => spawnable.indexOf(n) < 0);
  ok(ghosts.length === 0, `the owed list names only spawnable types (${ghosts.join(', ') || 'clean'})`);
  console.log(`    drawn: ${drawn.join(' ')} · owed: ${owed.join(' ')}`);
  ok(drawn.length + owed.length === spawnable.length,
     `${drawn.length} drawn + ${owed.length} owed = ${spawnable.length} spawnable`);
  // ⚠ PASS 15: every raw entry must actually carry its stage — a malformed entry with no
  // ` — Gxx` suffix would still parse a name (the whole string, before any dash), pass every
  // check above, and silently stop citing anything `stagecheck` can sweep.
  const uncited = ER.OWED.filter((s) => !/ — G\d+[a-z]?$/.test(s));
  ok(uncited.length === 0, `every ER.OWED entry names its stage (${uncited.join('; ') || 'clean'})`);
  okAv((() => {
    const before = ER.OWED.slice();
    ER.OWED.push('phantom_test_entry_with_no_stage');
    const bad = ER.OWED.filter((s) => !/ — G\d+[a-z]?$/.test(s)).length > 0;
    ER.OWED.length = 0; ER.OWED.push(...before);
    return bad;
  })(), 'anti-vacuity: an entry with no stage citation is caught, not silently accepted');
}

// ═══════════════ 4. what gets built, and where it lands ════════════════════════════════════
console.log('\n 4. the buffer: placement, layers, interpolation, range');
{
  EL.clear();
  const f = EL.spawn('falling_block', 10.5, 70, 20.5, { state: SAND });
  ok(!!f && f.state === SAND, 'a falling block carries the state it fell from');
  const t = EL.spawn('tnt', 12.5, 70, 20.5);
  ok(!!t, 'primed tnt spawns');

  const built = ER.build(10, 70, 20, 10.5, 71, 20.5, 1);
  ok(!!built, 'the frame builds a buffer');
  ok(built.drawn === 2, `both entities are in it (${built.drawn})`);
  ok(built.clipped === 0, 'nothing was clipped');
  const hdr = Me.readHeader(built.buf);
  ok(!!hdr, 'the buffer has a valid §8 header');
  ok(hdr.quads[0] + hdr.quads[1] + hdr.quads[2] === 0,
     'it holds NO greedy quads — an entity is model geometry and nothing else');
  const mTotal = hdr.modelQuads[0] + hdr.modelQuads[1] + hdr.modelQuads[2];
  ok(mTotal === 12, `it holds 12 model quads — six faces each (${mTotal})`);
  ok(hdr.modelQuadBytes === CFG.MODEL_QUAD_BYTES,
     'and it declares the vertex size this build uses, so a backend will accept it');

  // ⚠ THE CUBE IS CENTRED ON THE ENTITY'S FOOTPRINT AND SITS ON ITS FEET. `MODEL_OFFSET` is
  // the renderer's `translate(-0.5, 0, -0.5)`; get it wrong and every falling block is drawn
  // one corner away from its own shadow.
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  const words = new Uint32Array(built.buf, hdr.modelOff[0], mTotal * 16);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let q = 0; q < mTotal; q++) for (let c = 0; c < 4; c++) {
    const o = (q * 4 + c) * 4;
    const v = Me.unpackModelVertex(words[o], words[o + 1], words[o + 2], words[o + 3]);
    const p = [v.px, v.py, v.pz];
    for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  }
  say(`extent ${lo.join(',')} .. ${hi.join(',')} (1/${U} block)`);
  // the falling block is at x 10.5 with the origin at 10, so its cube spans 10.0 .. 11.0
  ok(lo[0] === 0, `the west face of the nearest cube is exactly on the block boundary (${lo[0]})`);
  ok(lo[1] === 0, `the cubes sit on the entity's feet, not through them (${lo[1]})`);
  ok(hi[1] === U, `and they are one block tall (${hi[1]} = ${U})`);
  // the two entities stand at x 10.5 and 12.5 with the origin at 10, so their cubes run
  // 10.0 .. 11.0 and 12.0 .. 13.0 — three blocks from the west face of one to the east face
  // of the other, and a half-block error in the re-centre shows up here as 2.5 or 3.5.
  ok(hi[0] - lo[0] === 3 * U,
     `the pair spans exactly three blocks in x (${(hi[0] - lo[0]) / U})`);
  ok(hi[2] - lo[2] === U, `and one block in z (${(hi[2] - lo[2]) / U})`);

  // layers are the MESHER's answer, not a second opinion
  ok(ER.layerOf(SAND) === SR.layer[SR.block[SAND]],
     'the layer of a state is the one the mesher would give it');
  ok(hdr.modelQuads[ER.layerOf(SAND)] > 0, 'and the quads went into that layer');
}

// ═══════════════ 5. the refusals ═══════════════════════════════════════════════════════════
console.log('\n 5. what it refuses to draw');
{
  EL.clear();
  // ⚠⚠ **THE DEFAULT IS THE ENTITY'S, AND IT IS THE JAR'S.** `FallingBlockEntity` — the
  // obfuscated class `blh`, the only one in the jar carrying BOTH the `TileEntityData` and
  // `DropItem` NBT keys — opens its constructor with
  //     this.blockState = cdr.C.defaultBlockState();  this.dropItem = true;  this.<int> = 40;
  // `cdr` is `Blocks`, whose static fields are declared in vanilla REGISTRY order, so `C` is
  // its 29th field (`a`..`z`, then `A`, `B`, `C`) — vanilla registry index 28, which in 1.18.2
  // is `sand`, three past `bedrock`, `water`, `lava`.
  //
  // ⚠ THIS ENGINE'S OWN REGISTRY IS ALPHABETICAL, NOT VANILLA'S, so index 28 here is `azalea`
  // and there is no index to assert against. The assertions below therefore pin the VALUE and
  // rule out the three answers a mistake would plausibly produce — air, stone and gravel —
  // rather than dressing up a coincidence of ordering as a proof.
  ok(M.Reg.id.sand !== 28, 'the engine registry is not vanilla-ordered, so the index proves nothing here');
  const bare = EL.spawn('falling_block', 4.5, 70, 4.5);           // no state given
  ok(!!bare, 'a falling block spawns with no state named');
  ok(bare.state === SAND, "and vanilla's own field initialiser gives it sand");
  ok(bare.state !== 0 && bare.state !== STONE && bare.state !== stateOf('gravel'),
     'not air, not stone and not gravel — the three a slip would have produced');
  ok(bare.dropItem === true && bare.fallDamageMax === 40,
     'along with dropItem = true and fallDamageMax = 40, from the same constructor');
  ok(ER.stateOf(bare) === SAND, 'so the renderer has something to draw');
  ok(ER.build(4, 70, 4, 4.5, 70, 4.5, 1) !== null, 'and the frame builds it');

  // ⚠ THE RENDERER STILL REFUSES A STATE OF ZERO. The default belongs to the entity; a state
  // the renderer cannot resolve must draw NOTHING, or "it never spawned" and "it spawned as
  // air" look identical on screen for ever.
  EL.clear();
  const nul = EL.spawn('falling_block', 4.5, 70, 4.5, { state: 0 });
  ok(ER.stateOf(nul) === 0, 'a falling block of state 0 resolves to nothing');
  ok(ER.build(4, 70, 4, 4.5, 70, 4.5, 1) === null, 'and nothing is built for it');

  // primed TNT is born with vanilla's fuse and vanilla's hop
  EL.clear();
  const t2 = EL.spawn('tnt', 4.5, 70, 4.5);
  ok(t2.fuse === 80, `primed tnt is born with an 80-tick fuse (${t2.fuse})`);
  ok(t2.vy === 0.2, `and a 0.2 upward kick (${t2.vy})`);
  ok(Math.abs(t2.vx) <= 0.02 + 1e-9 && Math.abs(t2.vz) <= 0.02 + 1e-9,
     `with a horizontal scatter inside 0.02 (${t2.vx.toFixed(4)}, ${t2.vz.toFixed(4)})`);
  ok(Math.abs(Math.hypot(t2.vx, t2.vz) - 0.02) < 1e-9,
     'and that scatter is a direction, not a box — its magnitude is exactly 0.02');

  EL.clear();
  EL.spawn('falling_block', 4.5, 70, 4.5, { state: SAND });
  const far = ER.build(0, 0, 0, 4.5 + ER.RANGE + 5, 70, 4.5, 1);
  ok(far === null, `an entity past ${ER.RANGE} blocks is not drawn`);
  const near = ER.build(4, 70, 4, 4.5, 70, 4.5, 1);
  ok(near !== null, 'and one in range is');

  // ⚠ THE RANGE IS ALSO A FORMAT LIMIT. A model position is i16 in 1/256 of a block, so it
  // reaches 128 blocks; an entity drawn past that WRAPS to the other side of the camera rather
  // than vanishing, which looks like a teleport and reads like a physics bug.
  ok(ER.RANGE * CFG.MODEL_UNITS_PER_BLOCK < 32768,
     `the range fits the i16 position field (${ER.RANGE} blocks = ${ER.RANGE * CFG.MODEL_UNITS_PER_BLOCK} units < 32768)`);
  ok(ER.RANGE * 2 * CFG.MODEL_UNITS_PER_BLOCK <= 32768,
     'with room for a model that reaches outside its own cell');

  EL.clear();
  const removed = EL.spawn('falling_block', 4.5, 70, 4.5, { state: SAND });
  EL.remove(removed);
  ok(ER.build(4, 70, 4, 4.5, 70, 4.5, 1) === null, 'a removed entity is not drawn before the sweep');
}

// ═══════════════ 6. interpolation, and the rounding ════════════════════════════════════════
console.log('\n 6. it moves smoothly and it does not jitter across zero');
{
  EL.clear();
  const e = EL.spawn('falling_block', 0, 80, 0, { state: SAND });
  e.px = 0; e.py = 80; e.pz = 0;
  e.x = 1; e.y = 81; e.z = 2;
  const p = [0, 0, 0];
  ER.posAt(e, 0, p);
  ok(p[0] === 0 && p[1] === 80 && p[2] === 0, 'at partial 0 the entity is where it was last tick');
  ER.posAt(e, 1, p);
  ok(p[0] === 1 && p[1] === 81 && p[2] === 2, 'at partial 1 it is where it is now');
  ER.posAt(e, 0.5, p);
  ok(p[0] === 0.5 && p[1] === 80.5 && p[2] === 1, 'and halfway between at 0.5');

  // ⚠ ROUNDED, NOT TRUNCATED. `| 0` truncates toward zero, so the same sub-block offset
  // quantises one way at x = +0.002 and the other at x = −0.002, and a falling block crossing
  // the origin twitches by a 256th. Measured, not asserted by reading the source.
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  const firstX = (ox, x) => {
    EL.clear();
    const en = EL.spawn('falling_block', x, 80, 0, { state: SAND });
    en.px = x; en.py = 80; en.pz = 0;
    const b = ER.build(ox, 80, 0, x, 80, 0, 1);
    const h = Me.readHeader(b.buf);
    const w = new Uint32Array(b.buf, h.modelOff[0], 16);
    return Me.unpackModelVertex(w[0], w[1], w[2], w[3]).px;
  };
  // +0.5 above the origin and −0.5 below it must land the same distance from their own origin
  // x = +0.5 with the origin at 0, and x = -0.5 with the origin at -1: the same sub-block
  // offset on either side of zero. Truncation sends one of them a 256th the other way.
  const a1 = firstX(0, 0.5 + 1 / 512);
  const a2 = firstX(-1, -0.5 + 1 / 512);
  ok(a1 === a2, `the same offset quantises identically on both sides of zero (${a1} vs ${a2})`);

  // ⚠ AND IT IS ROUNDING, NOT TRUNCATION, MEASURED THE ONLY WAY THAT TELLS THEM APART. Six
  // tenths of a unit ABOVE a boundary lands on the next unit either way; six tenths BELOW it
  // lands on the previous unit when rounding and stays put when truncating toward zero. The
  // positive case alone proves nothing, which is why both are here.
  const U1 = 1 / CFG.MODEL_UNITS_PER_BLOCK;
  const base = firstX(0, 0.5);
  const up = firstX(0, 0.5 + 0.6 * U1);
  const down = firstX(0, 0.5 - 0.6 * U1);
  ok(up === base + 1, `six tenths of a unit up moves the cube one unit (${base} -> ${up})`);
  ok(down === base - 1, `and six tenths down moves it one unit the other way (${base} -> ${down}) ` +
     '— truncation would have left it where it was');
}

// ═══════════════ 7. the cap degrades rather than corrupts ══════════════════════════════════
console.log('\n 7. a spawn storm is clipped, and says so');
{
  EL.clear();
  const per = Me.modelQuadCount(SR.vis[SAND], 0, 0, 0, 0, 0, 0, 0);
  const want = Math.ceil(ER.MAX_QUADS / per) + 20;
  for (let i = 0; i < want; i++) EL.spawn('falling_block', (i % 40) + 0.5, 80, Math.floor(i / 40) + 0.5, { state: SAND });
  const b = ER.build(0, 80, 0, 20, 80, 20, 1);
  ok(!!b, `${want} entities still build a buffer`);
  const h = Me.readHeader(b.buf);
  const total = h.modelQuads[0] + h.modelQuads[1] + h.modelQuads[2];
  ok(total <= ER.MAX_QUADS, `the buffer is capped at ${ER.MAX_QUADS} quads (${total})`);
  ok(b.clipped > 0, `and it reports ${b.clipped} entities clipped rather than dropping them silently`);
  ok(b.drawn + b.clipped <= want, 'drawn + clipped never exceeds what was asked for');
  // every quad in the capped buffer must still be a WHOLE entity's worth — a buffer cut off
  // mid-entity would draw a half cube
  ok(total % per === 0, `the cap falls on an entity boundary (${total} is a multiple of ${per})`);
  EL.clear();
}

// ═══════════════ 8. anti-vacuity for the rest (D-30) ═══════════════════════════════════════
console.log('\n 8. anti-vacuity — break each measurement and the break must be caught');
{
  EL.clear();
  EL.spawn('falling_block', 1.5, 80, 1.5, { state: SAND });
  const good = ER.build(1, 80, 1, 1.5, 80, 1.5, 1);
  okAv(!!good && good.drawn === 1, 'anti-vacuity: the clean case really does build one entity');

  const savedShape = ER.SHAPE.falling_block;
  delete ER.SHAPE.falling_block;
  const none = ER.build(1, 80, 1, 1.5, 80, 1.5, 1);
  ER.SHAPE.falling_block = savedShape;
  okAv(none === null, 'anti-vacuity: with falling_block off the shape table, nothing is drawn');

  const savedRange = ER.RANGE;
  ER.RANGE = 0.1;
  const clipped = ER.build(1, 80, 1, 40, 80, 40, 1);
  ER.RANGE = savedRange;
  okAv(clipped === null, 'anti-vacuity: with the range at nothing, nothing is in range');

  const savedOff = ER.MODEL_OFFSET.slice();
  ER.MODEL_OFFSET[0] = 0;
  const shifted = ER.build(1, 80, 1, 1.5, 80, 1.5, 1);
  ER.MODEL_OFFSET[0] = savedOff[0];
  const firstOf = (b) => {
    const h = Me.readHeader(b.buf);
    const w = new Uint32Array(b.buf, h.modelOff[0], 16);
    return Me.unpackModelVertex(w[0], w[1], w[2], w[3]).px;
  };
  okAv(firstOf(shifted) !== firstOf(good),
       'anti-vacuity: dropping the half-block re-centre moves the cube, so §4 is measuring it');
  EL.clear();
}

// ═══════════════ 9. ITEM ENTITIES: the display transform, the bob and the spin ═════════════
console.log('\n 9. item entities (D-323)');
{
  const IT = M.Items;
  ok(!!IT && IT.ready, 'the item table is up');
  const dirt = IT.of('dirt'), stick = IT.of('stick');
  ok(dirt >= 0 && IT.isBlock(dirt), 'dirt is a block item');
  ok(stick >= 0 && !IT.isBlock(stick), 'a stick is not');

  EL.clear();
  const e = EL.spawn('item', 5.5, 70, 5.5, { item: dirt });
  ok(!!e, 'an item entity spawns');
  ok(e.bobOffs !== undefined && e.bobOffs >= 0 && e.bobOffs < Math.PI * 2,
     `it is born with a bob offset in [0, 2pi) (${(e.bobOffs || 0).toFixed(3)})`);
  ok(ER.stateOf(e) === IT.stateOf(dirt), 'and it draws as the block it holds');

  // ⚠⚠ **THIS SECTION USED TO ASSERT THE LIMITATION, AND IT FAILED THE DAY THE LIMITATION WAS
  // LIFTED — WHICH IS WHAT IT WAS FOR** (D-324). It read "a SPRITE item draws nothing — the model
  // shader does not sample the item atlas" and pinned `OWED_ITEM.length === 2`. D-341 put the
  // item sprites into the texture array and D-342 gave them vanilla's extruded model, so both
  // sentences are now false and the check said so on the next run. A note about what is missing
  // must not be able to outlive the thing it describes.
  const s2 = EL.spawn('item', 7.5, 70, 5.5, { item: stick });
  ok(ER.stateOf(s2) === 0,
     'a SPRITE item has no block STATE — it is drawn from its own geometry part instead');
  const sp = ER.spritesFor(s2);
  ok(!!sp && sp.parts.length === 1, 'and that part exists (D-342)');
  ok(!!sp && ER.partQuads(sp.parts[0]) > 2,
     `whose model is EXTRUDED, not two flat faces (${sp ? ER.partQuads(sp.parts[0]) : 0} quads)`);
  // ⚠⚠ AND THIS SECTION USED TO PIN THE OTHER HALF AS OWED, FOR THE SAME REASON (PASS 15 JOB 3):
  // `OWED_ITEM.length === 1` was correct the day it was written and would still be green today
  // if G17e had never shipped — a note about what is missing must not be able to outlive the
  // thing it describes, which is exactly the trap D-324's neighbouring comment names.
  const chest = IT.of('chest');
  const beIdx = ER.beIndexOf(chest), bePart = ER.bePartOf(beIdx);
  ok(beIdx >= 0, 'a block-entity item (a chest) resolves to a be-item index');
  ok(bePart >= 0 && ER.partQuads(bePart) > 2,
     `and a real geometry part (${bePart >= 0 ? ER.partQuads(bePart) : 0} quads)`);
  ok(ER.OWED_ITEM.length === 0,
     `the owed list is EMPTY now — both halves are drawn (${JSON.stringify(ER.OWED_ITEM)})`);

  // ⚠⚠ **THE COLLAPSED TRANSFORM IS CHECKED AGAINST THE UNCOLLAPSED CHAIN.** `ER.itemLift` and
  // `ER.itemMatrix` are an algebraic simplification of five PoseStack operations, and an
  // algebraic simplification is exactly the kind of thing that is nearly right. This runs the
  // chain as vanilla writes it and asserts the two land on the same point.
  const chain = (p, age, partial, bobOffs) => {
    const f = (age + partial) / ER.BOB_PERIOD + bobOffs;
    const bob = Math.sin(f) * ER.BOB_AMP + ER.BOB_AMP;
    const spin = (age + partial) / ER.SPIN_PERIOD + bobOffs;
    // translate(-0.5,-0.5,-0.5)
    let v = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];
    // scale(0.25)
    v = v.map((c) => c * ER.GROUND.scale);
    // [ground] translate(0, 3/16, 0)
    v = [v[0], v[1] + ER.GROUND.ty, v[2]];
    // rotateY(spin)
    const c = Math.cos(spin), si = Math.sin(spin);
    v = [v[0] * c + v[2] * si, v[1], -v[0] * si + v[2] * c];
    // translate(0, bob + 0.25 * groundScale.y, 0)
    return [v[0], v[1] + bob + 0.25 * ER.GROUND.scale, v[2]];
  };
  const collapsed = (p, age, partial, bobOffs) => {
    const m = ER.itemMatrix(ER.itemSpin(age, partial, bobOffs));
    const o = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];
    return [m[0] * o[0] + m[1] * o[1] + m[2] * o[2],
            m[3] * o[0] + m[4] * o[1] + m[5] * o[2] + ER.itemLift(age, partial, bobOffs),
            m[6] * o[0] + m[7] * o[1] + m[8] * o[2]];
  };
  let worst = 0;
  for (const age of [0, 3, 17, 60, 200]) {
    for (const bo of [0, 1.3, 4.9]) {
      for (const p of [[0, 0, 0], [1, 1, 1], [1, 0, 0.5], [0.25, 0.75, 1]]) {
        const a = chain(p, age, 0.5, bo), b = collapsed(p, age, 0.5, bo);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
      }
    }
  }
  ok(worst < 1e-12,
     `the collapsed transform matches vanilla's five-step chain at every sample (worst ${worst.toExponential(1)})`);

  // ⚠ THE TWO PERIODS ARE DIFFERENT AND THAT IS LOAD-BEARING. Make them equal and an item turns
  // once per bob instead of once per two, which reads as one mechanical wobble.
  ok(ER.BOB_PERIOD !== ER.SPIN_PERIOD,
     `the bob runs on ${ER.BOB_PERIOD} ticks and the spin on ${ER.SPIN_PERIOD}`);
  ok(Math.abs(ER.itemSpin(20, 0, 0) - ER.itemSpin(0, 0, 0) - 1) < 1e-12,
     'twenty ticks is exactly one radian of spin');
  const liftAt = (age) => ER.itemLift(age, 0, 0);
  ok(liftAt(0) < liftAt(Math.PI * 5) , 'and the bob actually moves the item up and down');

  // the drawn geometry: a quarter of a block, centred on the entity, lifted
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  EL.clear();
  const it2 = EL.spawn('item', 5.5, 70, 5.5, { item: dirt });
  it2.bobOffs = 0; it2.age = 0;
  const b2 = ER.build(5, 70, 5, 5.5, 70, 5.5, 1);
  ok(!!b2 && b2.drawn === 1, 'the item builds geometry');
  const h2 = Me.readHeader(b2.buf);
  const mTot = h2.modelQuads[0] + h2.modelQuads[1] + h2.modelQuads[2];
  const w2 = new Uint32Array(b2.buf, h2.modelOff[0], mTot * 16);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let q = 0; q < mTot; q++) for (let c = 0; c < 4; c++) {
    const o = (q * 4 + c) * 4;
    const v = Me.unpackModelVertex(w2[o], w2[o + 1], w2[o + 2], w2[o + 3]);
    const pt = [v.px, v.py, v.pz];
    for (let k = 0; k < 3; k++) { if (pt[k] < lo[k]) lo[k] = pt[k]; if (pt[k] > hi[k]) hi[k] = pt[k]; }
  }
  const spanX = (hi[0] - lo[0]) / U, spanY = (hi[1] - lo[1]) / U;
  say(`item extent ${lo.join(',')} .. ${hi.join(',')}`);
  // a cube spun about Y is up to sqrt(2) wide across the diagonal; its HEIGHT is exact
  ok(Math.abs(spanY - ER.GROUND.scale) < 0.01,
     `it is a quarter of a block tall (${spanY.toFixed(3)} vs ${ER.GROUND.scale})`);
  ok(spanX >= ER.GROUND.scale - 0.01 && spanX <= ER.GROUND.scale * Math.SQRT2 + 0.01,
     `and between a quarter and a quarter-root-two wide, depending on the spin (${spanX.toFixed(3)})`);
  const cx = (lo[0] + hi[0]) / 2 / U, cz = (lo[2] + hi[2]) / 2 / U;
  ok(Math.abs(cx - 0.5) < 0.01 && Math.abs(cz - 0.5) < 0.01,
     `it is CENTRED on the entity, not offset to a corner (${cx.toFixed(3)}, ${cz.toFixed(3)})`);
  const lift = ER.itemLift(0, 1, 0);
  ok(Math.abs((lo[1] + hi[1]) / 2 / U - lift) < 0.01,
     `and floats at the lift the transform asks for (${((lo[1] + hi[1]) / 2 / U).toFixed(3)} vs ${lift.toFixed(3)})`);
  EL.clear();
}

// ═══════════════ 10. anti-vacuity for the item path ════════════════════════════════════════
console.log('\n 10. anti-vacuity — the item transform is broken and the break must be caught');
{
  const IT = M.Items, dirt = IT.of('dirt'), U = CFG.MODEL_UNITS_PER_BLOCK;
  const extentOf = () => {
    const b = ER.build(5, 70, 5, 5.5, 70, 5.5, 1);
    if (!b) return null;
    const h = Me.readHeader(b.buf);
    const n = h.modelQuads[0] + h.modelQuads[1] + h.modelQuads[2];
    const w = new Uint32Array(b.buf, h.modelOff[0], n * 16);
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) {
      const o = (q * 4 + c) * 4;
      const v = Me.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]);
      const pt = [v.px, v.py, v.pz];
      for (let k = 0; k < 3; k++) { if (pt[k] < lo[k]) lo[k] = pt[k]; if (pt[k] > hi[k]) hi[k] = pt[k]; }
    }
    return { lo, hi, h: (hi[1] - lo[1]) / U };
  };
  EL.clear();
  const e = EL.spawn('item', 5.5, 70, 5.5, { item: dirt });
  e.bobOffs = 0; e.age = 0;
  const good = extentOf();
  okAv(!!good && Math.abs(good.h - 0.25) < 0.01, 'anti-vacuity: the clean item really is a quarter tall');

  const savedScale = ER.GROUND.scale;
  ER.GROUND.scale = 1;
  const big = extentOf();
  ER.GROUND.scale = savedScale;
  okAv(big && big.h > good.h * 3, `anti-vacuity: a scale of 1 draws a full-size block (${big.h.toFixed(2)})`);

  // the SPIN must move the geometry — a matrix that ignored it would pass everything above
  e.age = 0;
  const at0 = extentOf();
  e.age = 8;                      // 8/20 = 0.4 rad, well off an axis
  const at8 = extentOf();
  e.age = 0;
  okAv(at0.lo[0] !== at8.lo[0] || at0.hi[2] !== at8.hi[2],
       'anti-vacuity: the spin moves the corners, so the matrix is not ignoring it');

  // the BOB must move it vertically
  e.bobOffs = 0; e.age = 0;
  const low = extentOf();
  e.age = Math.round(Math.PI * ER.BOB_PERIOD / 2);
  const high = extentOf();
  e.age = 0;
  okAv(Math.abs(high.lo[1] - low.lo[1]) > 0.05 * U,
       `anti-vacuity: the bob lifts it (${((high.lo[1] - low.lo[1]) / U).toFixed(3)} blocks)`);

  // ⚠ A DROPPED STICK IS DRAWN NOW (D-342), so the break is the other way round: take its
  // geometry away and it must vanish, then put it back and it must return. Leaving the old
  // "draws nothing" assertion in place would have pinned the bug as a requirement.
  EL.clear();
  EL.spawn('item', 5.5, 70, 5.5, { item: IT.of('stick') });
  okAv(ER.build(5, 70, 5, 5.5, 70, 5.5, 1) !== null,
       'anti-vacuity: a dropped stick DOES build geometry now');
  {
    const saved = M.DATA.spriteParts;
    M.DATA.spriteParts = 0;
    okAv(ER.build(5, 70, 5, 5.5, 70, 5.5, 1) === null,
         'anti-vacuity: with the sprite parts taken away it draws nothing rather than a placeholder');
    M.DATA.spriteParts = saved;
    okAv(ER.build(5, 70, 5, 5.5, 70, 5.5, 1) !== null,
         'anti-vacuity: and putting them back brings it straight back');
  }
  EL.clear();
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` g17ccheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' an entity is a block model at a place the world does not have a section for.');
