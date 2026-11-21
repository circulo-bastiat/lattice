#!/usr/bin/env node
// framecheck.mjs — #319 acceptance: item frame comparator output (ItemFrameEntity.getComparatorPower =
// rotation % 8 + 1 when holding an item, else 0) read by a comparator through ComparatorBlock.getAttachedItemFrame,
// across all eight rotations; interact rotates; the rotation survives NBT. Anti-vacuity: rotation ignored / modulo 4.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07zzv_hanging.js', '07f_redstone.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, H = M.Hanging, EL = M.EntityList, Rs = M.Redstone;
M.Behave.init(W); M.Entities.init(); EL.init(); W.init(1); Rs.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const stone = S.stateOf('stone') | 0;
const cmp = M.Behave.setProp(S.stateOf('comparator'), 'facing', 'east');
const [X, Y, Z] = [0, 80, 0];
// comparator at X; its input side is +dir; solid block next; frame in the cell after, facing the same way.
W.setBlock(X, Y, Z, cmp);
function rig(frameFacing) {
  for (let x = -1; x <= 4; x++) for (let z = -2; z <= 2; z++) { W.setBlock(x, Y, z, 0); W.setBlock(x, Y - 1, z, stone); }
  W.setBlock(X, Y, Z, cmp); W.setBlock(X + 1, Y, Z, stone);
  EL.list.length = 0;
  const e = { type: 'item_frame', obstructionCheckCounter: 0 };
  H.attach(e, X + 2, Y, Z, frameFacing, 12, 12);
  EL.list.push(e);
  return e;
}
// comparator facing=east: input from +x, so the frame must face east (id 3) to count
const e = rig(3);
const read = () => Rs.diodeInput(X, Y, Z, cmp);
ok(read() === 0, 'empty frame reads 0, got ' + read());
e.item = { i: 'apple', n: 1 };
const seen = [];
for (let r = 0; r < 8; r++) { e.rotation = r; seen.push(read()); }
ok(seen.join() === '1,2,3,4,5,6,7,8', 'rotations 0..7 read 1..8: ' + seen.join());
// interact rotates by one and wraps
e.rotation = 7; H.interact(e, {}, null); ok(e.rotation === 0 && read() === 1, 'interact wraps 7 -> 0');
// wrong facing frame is ignored
e.facing = 1; ok(read() === 0, 'frame facing the wrong way is not attached');
const e2 = rig(3); e2.item = { i: 'apple', n: 1 }; e2.rotation = 5;
// NBT round trip
const back = H.readFrameNbt({ type: 'item_frame' }, JSON.parse(JSON.stringify(H.writeFrameNbt(e2))));
ok(back.rotation === 5, 'rotation survives NBT: ' + back.rotation);
// damage pops the item first, comparator drops to 0
H.damage(e2, {}); ok(!e2.item && !e2.removed && read() === 0, 'first hit pops the item; frame stays');

// anti-vacuity
let breaks = 0;
const real = H.getComparatorPower;
const sweep = () => { const f = rig(3); f.item = { i: 'apple', n: 1 }; const o = []; for (let r = 0; r < 8; r++) { f.rotation = r; o.push(read()); } return o.join(); };
const good = '1,2,3,4,5,6,7,8';
H.getComparatorPower = (f) => (f.item ? 1 : 0); if (sweep() !== good) breaks++;
H.getComparatorPower = (f) => (f.item ? (f.rotation | 0) % 4 + 1 : 0); if (sweep() !== good) breaks++;
H.getComparatorPower = real; if (sweep() === good) breaks++; else fails.push('restore failed');
for (const m of fails) console.log('FAIL', m);
console.log(`framecheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length || breaks < 3 ? 1 : 0);
