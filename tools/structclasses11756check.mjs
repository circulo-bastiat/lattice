#!/usr/bin/env node
// #11756: net/minecraft/structure StructureSets/StructureSetKeys/JigsawJunction/StructurePiecesList/Holder (04w2_structure_classes.js).
// Reached from Structures.init (verifySets over the loaded structure_set JSON); cutting the table or the class logic fails it.
import { loadEngine } from './loadsrc.mjs';
function trial(patch) {
  const M = loadEngine({ extra: ['04w2_structure_classes.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const K = M.StructureClasses;
  chk(M.Structures.sets.length === 17 && K.KEYS.length === 17, '17 sets');
  chk(Array.isArray(M.Structures.setMismatch) && M.Structures.setMismatch.length === 0, 'init cross-check clean: ' + (M.Structures.setMismatch || []).join('; '));
  chk(K.verifySets([]).length === 17, 'empty sets all reported missing');
  const j = K.JigsawJunction(1, 2, 3, 4, 'rigid'), j2 = K.JigsawJunction(1, 99, 3, 4, 'rigid');
  chk(j.equals(j2) && !j.equals(K.JigsawJunction(1, 2, 3, 4, 'terrain_matching')), 'junction equals ignores ground y only');
  chk(K.JigsawJunction.deserialize(j.serialize()).equals(j) && K.JigsawJunction.deserialize({}).destProjection === 'rigid', 'junction serialize round trip');
  const b = (a, c) => ({ box: { minX: a[0], minY: a[1], minZ: a[2], maxX: c[0], maxY: c[1], maxZ: c[2] } });
  const h = K.StructurePiecesHolder(); h.addPiece(b([0, 0, 0], [4, 4, 4])); h.addPiece(b([10, 0, 10], [12, 5, 12]));
  const L = h.toList();
  chk(L.contains(4, 4, 4) && !L.contains(5, 0, 0) && L.contains(11, 5, 11) && !L.isEmpty(), 'pieces list contains');
  const bb = L.getBoundingBox(); chk(bb.minX === 0 && bb.maxX === 12 && bb.maxY === 5, 'pieces bounding box');
  chk(h.getIntersecting({ minX: 12, minY: 5, minZ: 12, maxX: 20, maxY: 9, maxZ: 20 }) === L.pieces[1] && h.getIntersecting({ minX: 5, minY: 0, minZ: 5, maxX: 9, maxY: 9, maxZ: 9 }) === null, 'holder intersecting');
  let thr = false; try { K.StructurePiecesList([]).getBoundingBox(); } catch (e) { thr = true; } chk(thr, 'empty box throws');
  const P = K.StructurePieceType;
  chk(P.ids.length === 56 && new Set(P.ids).size === 56 && M.Structures.pieceTypeCount === 56, 'piece type registry size, reached from Structures.init');
  chk(P.rawId('MSCorridor') === 0 && P.has('jigsaw') && P.get(55) === 'jigsaw' && P.rawId('shcc') === 19 && !P.has('nope'), 'piece type ids');
  const S = K.ShiftableStructurePiece, W = { topY: 256, top: (x, z) => 60 + (x & 3) };
  const pa = { box: { minX: 0, minY: 10, minZ: 0, maxX: 3, maxY: 20, maxZ: 0 }, hPos: -1 };
  chk(S.adjustToAverageHeight(pa, W, { minX: 0, minY: 0, minZ: 0, maxX: 15, maxY: 255, maxZ: 15 }, 1) && pa.hPos === 61 && pa.box.minY === 62 && pa.box.maxY === 72, 'average height shift');
  chk(!S.adjustToAverageHeight({ box: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }, hPos: -1 }, W, { minX: 50, minY: 0, minZ: 50, maxX: 60, maxY: 255, maxZ: 60 }, 0), 'average height no columns');
  const pm = { box: { minX: 0, minY: 10, minZ: 0, maxX: 3, maxY: 20, maxZ: 0 }, hPos: -1 };
  chk(S.adjustToMinHeight(pm, W, 2) && pm.hPos === 60 && pm.box.minY === 62 && S.adjustToMinHeight(pm, W, 9) && pm.box.minY === 62, 'min height shift, idempotent');
  const SG = K.ShipwreckGenerator, IG = K.IglooGenerator;
  chk(SG.REGULAR_TEMPLATES.length === 20 && SG.BEACHED_TEMPLATES.length === 11 && SG.templates(true)[1] === 'shipwreck/sideways_full' && SG.REGULAR_TEMPLATES[19] === 'shipwreck/rightsideup_backhalf_degraded' && SG.REGULAR_TEMPLATES[10] === 'shipwreck/with_mast_degraded' && SG.DEFAULT_POSITION[2] === 15, 'shipwreck templates');
  chk(IG.OFFSETS['igloo/bottom'][2] === 7 && IG.OFFSETS_FROM_TOP['igloo/middle'].join() === '2,-3,4' && IG.OFFSET_Y === 90, 'igloo offsets');
  const BT = K.BuriedTreasureGenerator, G = new Map(), gk = (x, y, z) => x + ',' + y + ',' + z;
  const bw = { bottomY: 0, top: () => 12, get: (x, y, z) => G.has(gk(x, y, z)) ? G.get(gk(x, y, z)) : (y <= 10 ? 'stone' : 'air'), set: (x, y, z, n) => G.set(gk(x, y, z), n) };
  G.set(gk(5, 11, 5), 'water'); G.set(gk(5, 12, 5), 'air');
  const bp = { box: { minX: 5, minY: 12, minZ: 5, maxX: 5, maxY: 12, maxZ: 5 } }, bc = BT.generate(bp, bw);
  chk(bc && bc.join() === '5,11,5' && bp.box.minY === 11 && G.get(gk(5, 11, 6)) === 'sand' && G.get(gk(5, 12, 5)) === 'sand' && !G.has(gk(5, 9, 5)), 'buried treasure chest + sand shell');
  chk(BT.generate({ box: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }, { bottomY: 0, top: () => 5, get: () => 'dirt', set() {} }) === null, 'buried treasure no base');
  const SH = K.SwampHutGenerator;
  chk(SH.FILLS.length === 11 && SH.BLOCKS.length === 10 && SH.BLOCKS[7][3] === 'cauldron' && SH.DEPTH === 9 && SH.PILLARS.length === 4, 'swamp hut layout');
  const DT = K.DesertTempleGenerator, ops = DT.ops(), cnt = {}; ops.forEach(o => cnt[o[0]] = (cnt[o[0]] || 0) + 1);
  chk(DT.WIDTH === 21 && DT.HEIGHT === 15 && cnt.fill === 56 && cnt.block > 150, 'desert ops built ' + JSON.stringify(cnt));
  chk(cnt.chest === 4 && cnt.down === 441 && ops.filter(o => o[0] === 'chest').map(o => o.slice(1).join()).join('|') === '2,10,-11,8|3,12,-11,10|0,10,-11,12|1,8,-11,10', 'desert chests/down count and chest positions');
  const dw = new Map(), dn = DT.apply({ set: (x, y, z, n) => dw.set(x + ',' + y + ',' + z, n) });
  chk(dn > 1500 && dw.get('10,-11,10') === 'stone_pressure_plate' && dw.get('10,-13,10') === 'tnt' && dw.get('9,-13,9') === 'tnt' && dw.get('10,0,10') === 'blue_terracotta' && dw.get('10,5,0') === 'chiseled_sandstone' && dw.get('0,4,2') === 'chiseled_sandstone' && dw.get('2,10,0') === 'sandstone_stairs[north]' && dw.get('8,6,0') === 'air' && dw.get('20,8,3') === 'cut_sandstone' && dw.get('10,-10,7') === 'chiseled_sandstone' && dw.get('10,-8,10') === 'air' && dw.get('8,-8,8') === 'sandstone', 'desert temple blocks');
  chk(dw.get('2,1,2') === 'sandstone_stairs[west]' && dw.get('18,1,2') === 'sandstone_stairs[east]' && dw.get('7,-11,10') === 'cut_sandstone' && dw.get('7,-11,11') === undefined && dw.get('10,-12,10') === 'cut_sandstone' && dw.get('1,1,2') === 'sandstone' && dw.get('19,2,2') === 'sandstone_slab', 'desert temple inner/outline');
  const sc = K.StructureContext.from({ resourceManager: 1, registryManager: 2, structureManager: 3 });
  chk(sc.resourceManager === 1 && sc.registryManager === 2 && sc.structureManager === 3 && K.PostPlacementProcessor.EMPTY.afterPlace() === undefined && K.PostPlacementProcessor.of(() => 7).afterPlace() === 7, 'structure context + post placement');
  return f;
}
const base = trial(); if (base.length) { console.log('FAIL baseline:\n ' + base.join('\n ')); process.exit(1); }
const cuts = [
  ["['sandstone', 'stone',", "['sandstone', 'dirt',"], ["&& i !== 1) ? below : fill", "&& i !== 0) ? below : fill"], 
  ["? cur : 'sand'", "? cur : 'dirt'"],
  ["'sideways_full', 'sideways_fronthalf', 'sideways_backhalf', 'rightsideup_full', 'rightsideup_fronthalf', 'rightsideup_backhalf',\n      'with_mast_degraded'", "'sideways_fronthalf', 'sideways_full', 'sideways_backhalf', 'rightsideup_full', 'rightsideup_fronthalf', 'rightsideup_backhalf',\n      'with_mast_degraded'"],
  ["[2, -3, 4]", "[2, -3, 5]"],
  ['14357618', '14357619'], ["rs(34, 8, LIN, 10387312)", "rs(34, 9, LIN, 10387312)"], ["['fortress', 2]", "['fortress', 1]"],
  ["rs(80, 20, TRI,", "rs(80, 20, LIN,"], ["distance: 32, spread: 3, count: 128", "distance: 32, spread: 3, count: 127"],
  ["rs(1, 0, LIN, 0, [9, 0, 9])", "rs(1, 0, LIN, 0, [8, 0, 9])"],
  ["this.sourceX === o.sourceX && this.sourceZ", "this.sourceX === o.sourceX && this.sourceGroundY === o.sourceGroundY && this.sourceZ"],
  ["'mscorridor', 'mscrossing'", "'mscrossing', 'mscorridor'"],
  ["x >= b.minX && x <= b.maxX", "x >= b.minX && x < b.maxX"],
  ["piece.hPos = Math.trunc(sum / n)", "piece.hPos = Math.trunc(sum / n) + 1"], ["m = Math.min(m, w.top(x, z))", "m = Math.max(m, w.top(x, z))"],
  ["[4, 2, 6, 'cauldron']", "[4, 2, 6, 'crafting_table']"],
  ["B(OR, 9, 5, 0); B(CH, 10, 5, 0)", "B(OR, 9, 5, 0); B(OR, 10, 5, 0)"],
  ["[[2, 0, -1], [3, 1, 0]", "[[2, 0, -1], [3, -1, 0]"], ["B(Wt, 2, 1, 2); B(E, W - 3, 1, 2)", "B(E, 2, 1, 2); B(E, W - 3, 1, 2)"],
  ["[4, 'o', 'h', 'o']", "[4, 'o', 'o', 'o']"], ["x < W; x++) for (z = 0; z < D; z++)", "x < W; x++) for (z = 0; z < D - 1; z++)"],
  ["B(CUT, 7, -11, 10)", "B(CUT, 7, -11, 11)"],
  ["server.structureManager);", "server.registryManager);"],
  ["if (!list.length) throw new Error('Pieces must not be empty');", ""],
];
let caught = 0;
for (const [a, c] of cuts) {
  let r; try { r = trial((file, s) => /04w2/.test(file) ? s.replace(a, c) : s); } catch (e) { r = ['threw']; }
  if (r.length) caught++; else console.log('uncaught cut', a);
}
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS structclasses11756check — ' + caught + ' breaks caught');
