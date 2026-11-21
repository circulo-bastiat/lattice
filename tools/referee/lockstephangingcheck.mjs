// lockstep-hanging -- #6857: item_frame / glow_item_frame / painting vs an independent reference of
// AbstractDecorationEntity.tick (survival check on the 101st call), ItemFrameEntity.damage/interact/dropHeldStack
// (item first, then frame), rotation steps (8, wrap), explosion + arrow hits; 20 salts, per-tick event log compared.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07zzv_hanging.js', '07zw_mobnbt.js'], dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, H = M.Hanging, EL = M.EntityList;
M.Behave.init(W); M.Entities.init(); EL.init(); W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
let tick = 0, drops = [];
EL.dropStack = (x, y, z, name, n) => { drops.push(`${tick}:${name}x${n}@${x.toFixed(3)},${y},${z.toFixed(3)}`); };
EL.remove = (e) => { e.removed = true; };
const DX = [0, -1, 0, 1], DZ = [1, 0, -1, 0];
let n = 0;
function run(salt) {
  const r = stream(salt), bad = [];
  const type = ['item_frame', 'glow_item_frame', 'painting'][salt % 3], facing = Math.floor(r() * 4);
  const item = type !== 'painting' && r() < 0.8 ? 'diamond' : null;
  const wallTick = 1 + Math.floor(r() * 150), hits = 1 + Math.floor(r() * 3), rots = Math.floor(r() * 12);
  const mode = ['player', 'arrow', 'explosion', 'none'][Math.floor(r() * 4)];
  const ax = 10, ay = 64, az = 10, ob = (facing + 2) & 3;
  const wx = ax + DX[ob], wz = az + DZ[ob];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 62; y < 68; y++) W.setBlock(ax + dx, y, az + dz, 0);
  for (let d = -2; d <= 2; d++) for (let y = 62; y < 68; y++) W.setBlock(wx + DX[(facing + 3) & 3] * d, y, wz + DZ[(facing + 3) & 3] * d, S.stateOf('stone') | 0);
  const e = H.attach({ type }, ax, ay, az, facing, type === 'painting' ? 16 : 12, type === 'painting' ? 16 : 12);
  e.rotation = 0; e.item = item ? { i: item, n: 1 } : null; let broke = 0; if (type === 'painting') e.onBreak = () => { broke++; };
  // reference state
  const ref = { removed: false, item: item, rot: 0, counter: 0, log: [] };
  const got = [];
  const hitAt = wallTick + 2;
  for (tick = 1; tick <= 260; tick++) {
    if (tick === wallTick) { W.setBlock(wx, ay, wz, 0); }
    if (tick >= hitAt && tick < hitAt + hits && mode !== 'none' && !e.removed) {
      const src = mode === 'player' ? { attacker: { instabuild: false } } : mode === 'arrow' ? { attacker: null, projectile: true } : { explosive: true };
      if (type === 'painting') H.decorationDamage(e, src); else H.damage(e, src);
      // reference
      if (!ref.removed) {
        if (type !== 'painting' && mode !== 'explosion' && ref.item) { ref.log.push(`${tick}:${ref.item}x1@` + pos(0)); ref.item = null; }
        else { ref.removed = true; if (type !== 'painting') { ref.log.push(`${tick}:${type}x1@` + pos(0)); if (ref.item) { ref.log.push(`${tick}:${ref.item}x1@` + pos(0)); ref.item = null; } } }
      }
    }
    if (tick === hitAt + 4 && !e.removed && type !== 'painting' && e.item) {
      for (let k = 0; k < rots; k++) { H.interact(e, {}, null); ref.rot = (ref.rot + 1) & 7; }
    }
    if (!e.removed) H.tick(e, W, []);
    if (!ref.removed && ref.counter++ === 100) {
      ref.counter = 0;
      const wallOk = !(tick >= wallTick);
      if (!wallOk) { ref.removed = true; if (type !== 'painting') { ref.log.push(`${tick}:${type}x1@` + pos(0)); if (ref.item) { ref.log.push(`${tick}:${ref.item}x1@` + pos(0)); ref.item = null; } } }
    }
    if (!!e.removed !== ref.removed) { bad.push(`salt ${salt} tick ${tick}: removed ${e.removed} != ${ref.removed}`); break; }
    n++;
    if (type !== 'painting' && !e.removed && (e.rotation | 0) !== ref.rot) { bad.push(`salt ${salt} tick ${tick}: rotation ${e.rotation} != ${ref.rot}`); break; }
    if (type !== 'painting' && !e.removed && (!!e.item) !== (!!ref.item)) { bad.push(`salt ${salt} tick ${tick}: held item`); break; }
  }
  function pos() { const f = facing; return `${e.x + DX[f] * 0.15},${e.y},${e.z + DZ[f] * 0.15}`.replace(/(\d+\.\d+)/g, (m) => m); }
  const fmt = (s) => s.replace(/@([-\d.]+),([-\d.]+),([-\d.]+)/, (_, a, b, c) => `@${(+a).toFixed(3)},${+b},${(+c).toFixed(3)}`);
  const want = ref.log.map(fmt), have = drops.splice(0);
  if (want.join('|') !== have.join('|')) bad.push(`salt ${salt} (${type},${mode}): drops [${have}] != [${want}]`);
  n++;
  return bad;
}
function runAll() { const bad = []; for (let s = 0; s < 20; s++) bad.push(...run(s)); return bad; }
let fails = 0, breaks = 0;
const b0 = runAll(); b0.slice(0, 10).forEach((b) => console.log('  FAIL ' + b)); fails += b0.length;
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ H.CHECK_INTERVAL = 99; const b = runAll(); H.CHECK_INTERVAL = 100; brk(b.length > 0, '100-tick check changed to 99'); }
{ const o = H.setRotation; H.setRotation = (e, r) => o(e, r % 7); const b = runAll(); H.setRotation = o; brk(b.length > 0, 'rotation steps 7'); }
{ const o = H.dropHeldStack; H.dropHeldStack = (e, a, al) => o(e, a, true); const b = runAll(); H.dropHeldStack = o; brk(b.length > 0, 'hit on held item also drops frame'); }
console.log(`lockstep-hanging: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
