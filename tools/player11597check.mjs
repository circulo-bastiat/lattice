#!/usr/bin/env node
// player11597check.mjs — #11597 (AUDIT-MAP). 14_player.js's vanilla-named pieces, driven through real entry
// points, then re-run against source cuts (loadEngine patch): every cut must be noticed.
//   ChestType (withChestType)  DoorHinge (doorHinge/withDoorHinge)  DoubleBlockHalf (secondCell)
//   BannerBlockEntity (bannerTagAt) + BlockItem (applyBannerTag)  EnderChestInventory (enderItems)
//   JumpingMount / MinecraftClient: the comments cite them; the code is guarded by the cuts of the same file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
  '14g_menu.js', '14g2_invclasses.js', '14_player.js', '15_hud.js', '14b_physics.js', '07f_redstone.js'];
let N = 0;
function run(patch) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const MCL = loadEngine({ extra: EXTRA, dom: true, patch });
    MCL.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
    const R = MCL.Reg, S = MCL.States, B = MCL.Behave, BE = MCL.BlockEntities, P = MCL.Player, V = R.PVAL, PR = R.PROP;
    const n = 48, mid = 24, cells = new Uint16Array(n * n * n);
    const idx = (x, y, z) => (((y + mid) * n + (z + mid)) * n + (x + mid));
    const world = { getBlock: (x, y, z) => cells[idx(x, y, z)], setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; B.changed(x, y, z); return true; }, blockLightAt: () => 15 };
    MCL.World = world; B.init(world); BE.init();
    const idOf = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
    const pv = (st, p) => R.valueNames[S.propValue(st, p)];
    // ChestType
    const chest = (x, yaw, sneak) => { let st = P.placementState(idOf('chest'), 2, 0.5, 0.5, 0.5, yaw); st = P.withChestType(st, x, 0, 0, 2, sneak); st = B.place(st, x, 0, 0); world.setBlock(x, 0, 0, st); return st; };
    ok(pv(chest(0, 0), PR.type) === 'single', 'ChestType lone chest single');
    ok(pv(chest(1, 0), PR.type) === 'left', 'ChestType neighbour pairs as left: ' + pv(world.getBlock(1, 0, 0), PR.type));
    ok(pv(world.getBlock(0, 0, 0), PR.type) === 'right', 'ChestType first becomes right');
    ok(pv(chest(5, 0, false), PR.type) === 'single', 'ChestType far chest single');
    // DoorHinge
    const dst = idOf('oak_door');
    const hl = P.withDoorHinge(dst, 10, 0, 10, 10.1, 10.5), hr = P.withDoorHinge(dst, 10, 0, 10, 10.9, 10.5);
    ok(pv(hl, PR.hinge) !== pv(hr, PR.hinge), 'DoorHinge click side picks hinge');
    ok(P.doorHinge(V, V.north, true, true, false, false, false, false, 0.9, 0.5) === V.left, 'DoorHinge wall on ccw side -> left');
    ok(P.doorHinge(V, V.north, false, false, true, true, false, false, 0.5, 0.5) === V.right, 'DoorHinge wall on cw side -> right');
    world.setBlock(9, 0, 10, idOf('stone')); world.setBlock(9, 1, 10, idOf('stone'));
    world.setBlock(11, 0, 10, 0);
    const hw = P.withDoorHinge(P.placementState(dst, 2, 0.5, 0.5, 0.5, 0), 10, 0, 10, 10.5, 10.5);
    ok(typeof S.propValue(hw, PR.hinge) === 'number', 'DoorHinge world half runs');
    // DoubleBlockHalf
    const lo = S.withProp(S.withProp(dst, PR.half, V.lower), PR.hinge, V.left);
    const sc = P.secondCell(lo, 3, 4, 5);
    ok(sc && sc.y === 5 && sc.x === 3 && S.propValue(sc.st, PR.half) === V.upper && S.propValue(sc.st, PR.hinge) === V.left, 'DoubleBlockHalf upper is above, keeps hinge');
    ok(P.secondCell(idOf('stone'), 0, 0, 0) === null, 'DoubleBlockHalf single block has none');
    // BannerBlockEntity / BlockItem
    BE.init();
    ok(P.bannerTagAt(1, 1, 1) === null, 'Banner no entity -> null');
    const bst = idOf('white_banner'); world.setBlock(1, 1, 1, bst);
    const e = BE.get(1, 1, 1);
    if (e && e.type === 'banner') {
      ok(P.applyBannerTag(1, 1, 1, { t: { BlockEntityTag: { Patterns: [{ Pattern: 'bs', Color: 3 }] } } }) === true, 'BlockItem applyBannerTag');
      const t = P.bannerTagAt(1, 1, 1);
      ok(t && t.BlockEntityTag.Patterns[0].Pattern === 'bs', 'BannerBlockEntity patterns round trip');
      t.BlockEntityTag.Patterns[0].Pattern = 'x';
      ok(P.bannerTagAt(1, 1, 1).BlockEntityTag.Patterns[0].Pattern === 'bs', 'BannerBlockEntity tag is a copy');
    } else ok(false, 'banner block entity not created');
    world.setBlock(2, 2, 2, idOf('chest')); ok(BE.get(2, 2, 2) && P.applyBannerTag(2, 2, 2, { t: {} }) === false, 'BlockItem applyBannerTag needs a banner');
    // EnderChestInventory
    ok(P.REPLACEABLE !== undefined, 'Player module loaded');
    try { P.init(); } catch (e) { ok(false, 'Player.init threw ' + e.message); }
    ok(Array.isArray(P.enderItems) && P.enderItems.length === 27, 'EnderChestInventory is 27 slots: ' + (P.enderItems && P.enderItems.length));
    // JumpingMount: charge curve + release hands floor(strength*100) to Mount.setJumpStrength
    const rec = { js: [], st: 0 }, veh = { type: 'horse' };
    MCL.Mount = { ready: true, isMountable: () => true, isSaddled: () => true, setJumpStrength: (v, n) => rec.js.push(n), startJumping: () => rec.st++,
      riderOffset: () => 0, mountedHeightOffset: () => 0, isRidden: () => true, travelRidden() {}, dismount() {}, ride() {} };
    P.vehicle = veh; P.eyeInWater = false; P.mountJumpTicks = 0; P.mountJumpStrength = 0;
    const cmd = (j) => ({ fwd: 0, strafe: 0, jump: j, sneak: false });
    for (let i = 0; i < 5; i++) { try { P.tickMounted(cmd(true)); } catch (e) { ok(false, 'tickMounted threw ' + e.message); break; } }
    ok(rec.st === 1, 'JumpingMount press starts jumping');
    ok(Math.abs(P.mountJumpStrength - 0.4) < 1e-9, 'JumpingMount charge 0.4 after 5 ticks: ' + P.mountJumpStrength);
    try { P.tickMounted(cmd(false)); } catch (e) { ok(false, 'tickMounted threw ' + e.message); }
    for (let i = 0; i < 10; i++) P.tickMounted(cmd(false));
    for (let i = 0; i < 13; i++) P.tickMounted(cmd(true));
    ok(Math.abs(P.mountJumpStrength - (0.8 + (2 / 3) * 0.1)) < 1e-9, 'JumpingMount eased charge after 12 held ticks: ' + P.mountJumpStrength);
    ok(rec.js[0] === 40, 'JumpingMount release passes floor(strength*100): ' + rec.js[0]);
  } catch (e) { f.push('threw: ' + (e && e.stack || e)); }
  return f;
}
console.log('player11597check — 14_player.js: ChestType DoorHinge DoubleBlockHalf BannerBlockEntity BlockItem');
const base = run(null);
base.forEach((m) => console.log('  FAIL ' + m));
const cuts = {
  ChestType: ['if (facing === partnerFacing(turnCW(V, facing))) type = V.left;', 'if (facing === partnerFacing(turnCW(V, facing))) type = V.single;'],
  DoorHinge: ['var i = (fullCcwLo ? -1 : 0) + (fullCcwHi ? -1 : 0)', 'var i = (fullCcwLo ? 0 : 0) + (fullCcwHi ? 0 : 0)'],
  DoubleBlockHalf: ["return { st: SR.withProp(st, P_.half, V.upper), x: bx, y: by + 1, z: bz };", "return null;"],
  BannerBlockEntity: ["e.patterns = src ? JSON.parse(JSON.stringify(src)) : [];", "e.patterns = [];"],
  EnderChestInventory: ['P.enderItems = new Array(27);', 'P.enderItems = new Array(26);'],
  JumpingMount: ['else P.mountJumpStrength = 0.8 + (2 / (P.mountJumpTicks - 9)) * 0.1;', 'else P.mountJumpStrength = 0.8;'],
  JumpingMountRelease: ['Math.floor(P.mountJumpStrength * 100)', 'Math.floor(P.mountJumpStrength * 10)'],
  BlockItem: ["if (!e || e.type !== 'banner') return false;\n    var src", "if (!e) return false;\n    var src"],
};
let breaks = 0; const missed = [];
for (const [k, [a, b]] of Object.entries(cuts)) {
  let hit = false;
  const r = run((file, src) => { if (file === '14_player.js' && src.includes(a)) { hit = true; return src.replace(a, b); } return src; });
  if (!hit) { console.log('  FAIL cut text for ' + k + ' not found'); missed.push(k); continue; }
  if (r.length) { breaks++; console.log('   ✓ cutting ' + k + ' fails: ' + r[0].slice(0, 70)); } else { console.log('  FAIL cutting ' + k + ' went unnoticed'); missed.push(k); }
}
console.log(` assertions passed .. ${N}`);
console.log(` failures ........... ${base.length + missed.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(base.length + missed.length ? 1 : 0);
