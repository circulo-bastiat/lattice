#!/usr/bin/env node
// hangingcheck.mjs — G17-HG1: AbstractDecorationEntity core (src/07zzv_hanging.js): the thin
// wall box for all four facings x odd/even sizes (hand-computed from the .decomp formula),
// the 100-tick canStayAttached survival check, registration. Anti-vacuity: a wrong half-pixel
// shift and a never-checking tick must each make the checks FAIL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07zzv_hanging.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, H = M.Hanging, EL = M.EntityList;
M.Behave.init(W); M.Entities.init(); EL.init(); W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

const near = (a, b) => Math.abs(a - b) < 1e-9;
const boxOf = (f, w, h) => { const e = H.attach({}, 10, 64, 10, f, w, h); return [e.x, e.y, e.z, e.hbox]; };
// Hand-computed (vanilla formula): [facing, wpx, hpx, x, y, z, minX, minY, minZ, maxX, maxY, maxZ]
const CASES = [
  [0, 16, 16, 10.5, 64.5, 10.03125, 10.0, 64.0, 10.0, 11.0, 65.0, 10.0625],
  [2, 16, 16, 10.5, 64.5, 10.96875, 10.0, 64.0, 10.9375, 11.0, 65.0, 11.0],
  [1, 16, 16, 10.96875, 64.5, 10.5, 10.9375, 64.0, 10.0, 11.0, 65.0, 11.0],
  [3, 16, 16, 10.03125, 64.5, 10.5, 10.0, 64.0, 10.0, 10.0625, 65.0, 11.0],
  // 2x2 (32px): half-block shift in x and y; ccw(south)=east (+x), ccw(north)=west (-x)
  [0, 32, 32, 11.0, 65.0, 10.03125, 10.0, 64.0, 10.0, 12.0, 66.0, 10.0625],
  [2, 32, 32, 10.0, 65.0, 10.96875, 9.0, 64.0, 10.9375, 11.0, 66.0, 11.0],
  [1, 32, 32, 10.96875, 65.0, 11.0, 10.9375, 64.0, 10.0, 11.0, 66.0, 12.0],
  [3, 32, 32, 10.03125, 65.0, 10.0, 10.0, 64.0, 9.0, 10.0625, 66.0, 11.0],
  // 4x2 (64px wide, 32 tall) west-facing: shift 0.5 on z (ccw(west)=south +z)
  [1, 64, 32, 10.96875, 65.0, 11.0, 10.9375, 64.0, 9.0, 11.0, 66.0, 13.0],
];
function boxFails() {
  const bad = [];
  for (const c of CASES) {
    const [x, y, z, b] = boxOf(c[0], c[1], c[2]);
    const got = [x, y, z, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ];
    if (!got.every((v, i) => near(v, c[3 + i]))) bad.push(`facing ${c[0]} ${c[1]}x${c[2]}: ${got}`);
  }
  return bad;
}

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// 1. boxes
const bf = boxFails(); ok(bf.length === 0, 'box extents: ' + bf.join(' | '));

// 2. registration
ok(EL.canSpawn('painting') && EL.canSpawn('item_frame') && EL.canSpawn('glow_item_frame'), 'canSpawn');
ok(!EL.owed().some((n) => /painting|item_frame/.test(n)), 'not in EL.owed()');

// 3. survival: frame on a stone wall at (10,64,9) facing south (attachment cell 10,64,10 in front of the wall)
function frame() {
  W.setBlock(10, 64, 9, S.stateOf('stone') | 0);
  W.setBlock(10, 64, 10, 0);
  const e = H.attach({ type: 'item_frame' }, 10, 64, 10, 0, 12, 12);
  let broke = 0; e.onBreak = () => { broke++; };
  return [e, () => broke];
}
{
  const [e, broke] = frame();
  for (let i = 0; i < 100; i++) H.tick(e, W, []);
  ok(!e.removed && broke() === 0, 'intact frame survives the first 100 ticks and the check');
  H.tick(e, W, []);
  ok(!e.removed, 'intact frame survives its check at tick 101');
  W.setBlock(10, 64, 9, 0);
  let t = 0; while (!e.removed && t < 101) { H.tick(e, W, []); t++; }
  ok(e.removed && broke() === 1 && t <= 101, `wall broken: drops within one 101-tick period (took ${t})`);
  // 4. obstruction by another decoration
  W.setBlock(10, 64, 9, S.stateOf('stone') | 0);
  const a = H.attach({}, 10, 64, 10, 0, 12, 12), b = H.attach({}, 10, 64, 10, 0, 12, 12);
  ok(!H.canStayAttached(a, W, [a, b]), 'overlapping decoration blocks canStayAttached');
  ok(H.canStayAttached(a, W, [a]), 'alone it stays');
  // 5. move / addVelocity
  const [m, mb] = frame(); H.move(m, 0, 0, 0); ok(!m.removed, 'zero move is a no-op');
  H.move(m, 0.1, 0, 0); ok(m.removed && mb() === 1, 'non-zero move breaks it');
}

// anti-vacuity: wrong half-pixel shift must FAIL the box check; a never-checking tick must FAIL survival
{
  const orig = H.halfShift; H.halfShift = (px) => (px % 16 === 0 ? 0.5 : 0.0);
  breaks++; ok(boxFails().length > 0, 'injected wrong half-pixel shift went undetected'); H.halfShift = orig;
  const origC = H.canStayAttached; H.canStayAttached = () => true;
  const [e] = frame(); W.setBlock(10, 64, 9, 0);
  for (let i = 0; i < 300; i++) H.tick(e, W, []);
  breaks++; ok(!e.removed, 'never-failing canStayAttached should leave a floating frame');
  H.canStayAttached = origC;
}

// 6. G17-HG2 painting motives
const MOT = () => H.MOTIVES.map((m) => m.join(':')).join(',');
const decomp = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/decoration/painting/PaintingMotive.java'), 'utf8');
const vanilla = [...decomp.matchAll(/register\("(\w+)", (\d+), (\d+)\)/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`).join(',');
ok(vanilla.split(',').length === 26 && MOT() === vanilla, 'motive table equals PaintingMotive.java');
const clear = (x0, x1, y0, y1, z) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { W.setBlock(x, y, z, S.stateOf('stone') | 0); W.setBlock(x, y, z + 1, 0); } };
const paintTests = () => {
  const out = [];
  clear(0, 0, 70, 70, 3);                       // 1x1 wall
  for (let i = 0; i < 20; i++) { const p = H.placePainting(W, 0, 70, 4, 0, [], (n) => i % n); if (p.widthPixels !== 16 || p.heightPixels !== 16) out.push('1x1 got ' + p.motive); }
  clear(0, 5, 80, 85, 3);                       // big free wall
  for (let i = 0; i < 26; i++) { const p = H.placePainting(W, 2, 81, 4, 0, [], (n) => i % n); if (p.widthPixels * p.heightPixels !== 4096) out.push('big wall got ' + p.motive); }
  const p = H.placePainting(W, 2, 81, 4, 2, [], () => 0);
  const q = H.readPaintingNbt({ attachmentPos: p.attachmentPos }, H.writePaintingNbt(p));
  if (q.motive !== p.motive || q.facing !== p.facing || q.widthPixels !== p.widthPixels) out.push('NBT round trip');
  return out;
};
{ const r = paintTests(); ok(r.length === 0, 'painting placement: ' + r.slice(0, 3).join('; ')); }
{ const o = H.MOTIVES[0]; H.MOTIVES[0] = ['kebab', 64, 64];
  breaks++; ok(paintTests().length > 0 || MOT() !== vanilla, 'swapped motive size undetected'); H.MOTIVES[0] = o; }

// 7. G17-HG3 DecorationItem.useOnBlock
{
  const Inv = M.Inventory = M.Inventory || { shrink() {} }; const stone = S.stateOf('stone') | 0;
  const sounds = []; M.Sound = { play: (n) => sounds.push(n) };
  const place = (name, face, P) => {
    EL.list.length = 0;
    for (let x = 18; x < 24; x++) for (let y = 70; y < 76; y++) for (let z = 18; z < 24; z++) W.setBlock(x, y, z, 0);
    W.setBlock(20, 72, 20, stone); sounds.length = 0;
    const st = { i: M.Items.idOf ? M.Items.idOf(name) : 1, n: 3 };
    const orig = Inv.shrink; let used = 0; Inv.shrink = () => { used++; };
    const r = H.useOnBlock(P, 20, 72, 20, face, name, st, () => 0);
    Inv.shrink = orig; return { r, used, snd: sounds.length };
  };
  const run = () => {
    const out = [];
    if (place('painting', 2, {}).r) out.push('painting on floor');
    if (place('painting', 3, {}).r) out.push('painting on ceiling');
    const f = place('item_frame', 2, {}); if (!f.r) out.push('frame on floor refused');
    if (!place('painting', 5, {}).r) out.push('painting on wall refused');
    const w = place('glow_item_frame', 1, {}); if (!w.r || w.used !== 1 || w.snd !== 1) out.push('survival consume/sound ' + JSON.stringify(w));
    const c = place('item_frame', 5, { instabuild: true }); if (!c.r || c.used !== 0) out.push('creative consumed');
    const tg = (name, t) => { place(name, 5, {}); EL.list.length = 0; const st = { i: 1, n: 3, t: { EntityTag: t } };
      const pl = H.useOnBlock({}, 20, 72, 20, 5, name, st, () => 0); return pl ? EL.list[EL.list.length - 1] : null; };
    const pk = tg('painting', { Motive: 'minecraft:kebab' }); if (!pk || pk.motive !== 'kebab' || pk.widthPixels !== 16) out.push('tagged motive ' + (pk && pk.motive));
    const fr = tg('item_frame', { Invisible: 1, Item: { i: 5, n: 1 } }); if (!fr || !fr.invisible || !fr.item || fr.item.i !== 5) out.push('tagged frame');
    return out;
  };
  const r = run(); ok(r.length === 0, 'DecorationItem: ' + r.join('; '));
  const o = H.FACE_TO_FACING[2]; H.FACE_TO_FACING[2] = 0;
  breaks++; ok(run().length > 0, 'painting allowed on floor undetected'); H.FACE_TO_FACING[2] = o;
}

// 7b. G17-HG10 collidable entities / overlapping decorations refuse placement
{
  const Inv = M.Inventory = M.Inventory || { shrink() {} }; const stone = S.stateOf('stone') | 0;
  M.Sound = { play() {} };
  const tryPlace = (name, extra) => {
    EL.list.length = 0;
    for (let x = 18; x < 24; x++) for (let y = 70; y < 76; y++) for (let z = 18; z < 24; z++) W.setBlock(x, y, z, 0);
    W.setBlock(20, 72, 20, stone);
    if (extra) extra();
    let used = 0; Inv.shrink = () => { used++; };
    const r = H.useOnBlock({}, 20, 72, 20, 5, name, { i: 1, n: 3 }, () => 0);
    return { r, used };
  };
  const spawnAt = (t) => () => { const v = EL.spawn(t, 20.5, 72, 19.5); if (!v) throw new Error('spawn ' + t); };
  const run = () => {
    const out = [];
    for (const t of ['boat', 'minecart']) {
      const a = tryPlace('item_frame', spawnAt(t)); if (a.r || a.used) out.push(t + ' did not block');
    }
    const ok1 = tryPlace('item_frame', null); if (!ok1.r || ok1.used !== 1) out.push('free cell refused');
    const ov = tryPlace('painting', () => { H.useOnBlock({ instabuild: true }, 20, 72, 20, 5, 'item_frame', { i: 1, n: 1 }, () => 0); });
    if (ov.r) out.push('overlapping decoration accepted');
    return out;
  };
  const r = run(); ok(r.length === 0, 'HG10: ' + r.join('; '));
  const o = H.spaceEmpty; H.spaceEmpty = (e) => o.call(H, e, W) && true;
  const sv = NS_Ph(); sv.solidVehicle = () => false;
  breaks++; ok(run().length > 0, 'entity-blind placement undetected');
}
function NS_Ph() { return M.Physics; }

// 8. G17-HG4 item frame item + rotation
{
  const Inv = M.Inventory = M.Inventory || {}; const snd = []; M.Sound = { play: (n) => snd.push(n) };
  const run = () => {
    const out = []; let used = 0; Inv.shrink = () => { used++; };
    const e = { x: 0, y: 0, z: 0 };
    if (H.getComparatorPower(e) !== 0) out.push('empty reads nonzero');
    if (H.interact(e, {}, { i: 1, n: 5 }) !== 'consume' || !e.item || e.item.n !== 1 || used !== 1) out.push('insert');
    if (!snd.includes('entity.item_frame.add_item')) out.push('add sound');
    for (let k = 1; k <= 8; k++) { H.interact(e, {}, null); if (H.getComparatorPower(e) !== (k % 8) + 1) out.push('power at ' + k); }
    if (e.rotation !== 0) out.push('8 clicks not 0');
    if (!snd.includes('entity.item_frame.rotate_item')) out.push('rotate sound');
    const c = {}; used = 0; H.interact(c, { instabuild: true }, { i: 1, n: 5 }); if (used !== 0 || !c.item) out.push('creative');
    const f = { fixed: true }; if (H.interact(f, {}, { i: 1, n: 1 }) !== 'pass' || f.item) out.push('fixed');
    return out;
  };
  const r = run(); ok(r.length === 0, 'item frame: ' + r.join('; '));
  const o = H.setRotation; H.setRotation = (e, v) => { e.rotation = v % 7; };
  breaks++; ok(run().length > 0, 'modulo 7 undetected'); H.setRotation = o;
}

// 9. G17-HG11 floor / ceiling frames
{
  const stone = S.stateOf('stone') | 0;
  const run = () => {
    const out = [];
    for (const [face, fc, yy] of [[2, 4, 0.03125], [3, 5, 0.96875]]) {
      EL.list.length = 0;
      for (let x = 8; x < 13; x++) for (let y = 70; y < 76; y++) for (let z = 8; z < 13; z++) W.setBlock(x, y, z, 0);
      W.setBlock(10, 72, 10, stone);
      const ay = 72 + (face === 2 ? 1 : -1);
      M.Sound = { play() {} }; M.Inventory = { shrink() {} };
      if (!H.useOnBlock({ instabuild: true }, 10, 72, 10, face, 'item_frame', { i: 1, n: 1 }, () => 0)) { out.push('place ' + face); continue; }
      const e = EL.list[EL.list.length - 1];
      const b = e.hbox, want = [10.125, ay + yy - 1 / 32, 10.125, 10.875, ay + yy + 1 / 32, 10.875];
      const got = [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ];
      if (e.facing !== fc || !got.every((v, i) => near(v, want[i]))) out.push(`box ${face}: ${got}`);
      const q = H.readFrameNbt({}, H.writeFrameNbt(e));
      if (q.facing !== fc || q.attachmentPos.y !== ay || !near(q.hbox.minY, b.minY)) out.push('nbt ' + face);
      let broke = 0; e.onBreak = () => { broke++; };
      W.setBlock(10, 72, 10, 0);
      for (let i = 0; i < 102; i++) H.tick(e, W, []);
      if (!e.removed || broke !== 1) out.push('support loss ' + face);
    }
    return out;
  };
  const r = run(); ok(r.length === 0, 'vertical frames: ' + r.join('; '));
  const o = H.updateAttachmentPosition; H.updateAttachmentPosition = (e) => { e.hbox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }; };
  breaks++; ok(run().length > 0, 'block-sized box undetected'); H.updateAttachmentPosition = o;
}

// #5704: save/load round trip (MobNbt rows) - painting, map-less rotated sword frame, fixed invisible frame.
{
  const Mb = M.MobNbt;
  const mk = () => {
    EL.list.length = 0;
    const p = H.placePainting(W, 4, 64, 4, 2, [], (n) => n - 1);
    const pe = EL.spawn('painting', p.x, p.y, p.z); for (const k in p) if (k !== 'type') pe[k] = p[k];
    const f = { attachmentPos: { x: 8, y: 64, z: 8 }, obstructionCheckCounter: 0 }; H.attach(f, 8, 64, 8, 1, 12, 12);
    const fe = EL.spawn('item_frame', f.x, f.y, f.z); for (const k in f) fe[k] = f[k];
    fe.item = { i: 3, n: 1, t: { Damage: 5 } }; fe.rotation = 5; fe.itemDropChance = 0.25;
    const g = { attachmentPos: { x: 2, y: 66, z: 2 }, obstructionCheckCounter: 0 }; H.attach(g, 2, 66, 2, 3, 12, 12);
    const ge = EL.spawn('glow_item_frame', g.x, g.y, g.z); for (const k in g) ge[k] = g[k];
    ge.fixed = true; ge.invisible = true; ge.item = null;
    return [pe, fe, ge];
  };
  const snap = (e) => JSON.stringify([e.type, e.facing, e.attachmentPos, e.motive, e.item, e.rotation, e.itemDropChance, e.fixed, e.invisible,
    e.widthPixels, e.heightPixels, e.x, e.y, e.z, e.hbox]);
  const trip = () => {
    const before = mk().map(snap);
    const recs = JSON.parse(JSON.stringify(Mb.serializeAll()));
    EL.list.length = 0;
    Mb.restoreAll(recs);
    const after = EL.list.filter((e) => e.type === 'painting' || /item_frame/.test(e.type)).map(snap);
    return before.slice().sort().join('|') === after.slice().sort().join('|') && after.length === 3;
  };
  ok(trip(), 'hanging save/load: entities not field-identical');
  const of = Mb.fieldsFor;
  Mb.fieldsFor = (t) => of(t).filter((k) => k !== 'rotation');
  breaks++; ok(!trip(), 'dropping ItemRotation undetected'); Mb.fieldsFor = of;
}


// 9. G17-HG5 damage / onBreak
{
  const drops = []; const EL0 = M.EntityList; const od = EL0.dropStack, orm = EL0.remove;
  EL0.dropStack = (x, y, z, n) => { drops.push(n); }; EL0.remove = (e) => { e.removed = true; };
  M.Sound = { play: () => {} }; EL0.random = () => 0.5;
  const mk = (o) => Object.assign({ type: 'item_frame', x: 0, y: 0, z: 0, facing: 0, item: { i: 'diamond', n: 1 } }, o);
  const run = () => {
    const out = []; let e = mk(); drops.length = 0;
    if (!H.damage(e, { attacker: {} }) || e.item || e.removed || drops.join() !== 'diamond') out.push('first hit: ' + drops);
    H.damage(e, { attacker: {} });
    if (!e.removed || drops.join() !== 'diamond,item_frame') out.push('second hit: ' + drops);
    e = mk(); drops.length = 0; H.damage(e, { attacker: { instabuild: true }, creativeAttacker: true });
    H.damage(e, { attacker: { instabuild: true }, creativeAttacker: true });
    if (drops.length) out.push('creative drops ' + drops);
    e = mk(); if (H.damage(e, { fire: true }) || e.item === null) out.push('fire');
    e = mk({ type: 'glow_item_frame' }); drops.length = 0; H.damage(e, { explosive: true });
    if (!e.removed || drops.join() !== 'glow_item_frame,diamond') out.push('explosion: ' + drops);
    e = mk({ fixed: true }); if (H.damage(e, { attacker: {} }) || e.removed) out.push('fixed');
    return out;
  };
  const r = run(); ok(r.length === 0, 'damage: ' + r.join('; '));
  const o = H.dropHeldStack;
  H.dropHeldStack = (e, a, always) => o(e, a, true);
  breaks++; ok(run().length > 0, 'drop on first hit undetected'); H.dropHeldStack = o;
  EL0.dropStack = od; EL0.remove = orm;
}

// 10. G17-HG9: space check uses real collision shapes (frame box: south-facing, z 10..10.0625 of its cell)
{
  const R = M.Reg;
  const openLeaf = (() => {   // an oak_trapdoor state whose collision is the z 13/16..1 leaf
    const b0 = R.id['oak_trapdoor'];
    for (let i = R.realFirst[b0]; i < R.realFirst[b0 + 1]; i++) {
      const sh = M.Physics.shapesForState(i);
      if (sh && sh.length === 1 && near(sh[0][2], 0.8125) && sh[0][1] === 0 && sh[0][4] === 1) return i;
    }
    return 0;
  })();
  const test = (state) => {
    W.setBlock(10, 64, 10, state | 0);
    return H.spaceEmpty(H.attach({}, 10, 64, 10, 0, 16, 16), W);
  };
  const run = () => {
    const out = [];
    if (!openLeaf) out.push('no open trapdoor state');
    if (!test(openLeaf)) out.push('open trapdoor leaf at far side blocked frame');
    if (!test(S.stateOf('oak_fence'))) out.push('fence post blocked edge frame');
    if (test(S.stateOf('stone_slab'))) out.push('slab allowed');
    if (test(S.stateOf('white_carpet'))) out.push('carpet allowed');
    if (test(S.stateOf('oak_trapdoor'))) out.push('closed trapdoor allowed');
    if (test(S.stateOf('stone'))) out.push('stone allowed');
    if (!test(0)) out.push('air blocked');
    return out;
  };
  const r = run(); ok(r.length === 0, 'shape space: ' + r.join('; '));
  const o = H.spaceEmpty;
  H.spaceEmpty = (e) => !M.Physics.solidAt(10, 64, 10);
  breaks++; ok(run().length > 0, 'whole-cell test undetected'); H.spaceEmpty = o;
}

console.log(`hangingcheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  x ' + f); process.exit(1); }
