#!/usr/bin/env node
// waterlogcheck.mjs — #11391 (FINAL GATE #10620): waterlogged blocks BEHAVE like vanilla's Waterloggable.
//
//   node tools/waterlogcheck.mjs
//
// The block list is every block of the real 1.18.2 table (.mcdata/pc/blocks.json) that has a `waterlogged`
// property, never a hand list. For each: (1) a water bucket poured on it waterlogs it and queues the fluid tick
// (Waterloggable.tryFillWithFluid: setBlockState + createAndScheduleFluidTick; a DOUBLE slab refuses,
// SlabBlock.tryFillWithFluid), (2) an empty bucket drains it back to dry and a dry one drains nothing,
// (3) a neighbour update re-queues its fluid tick (getStateForNeighborUpdate), (4) the water flows out of the
// faces the block leaves open, (5) breaking it leaves a water SOURCE (Block.onBreak -> removeBlock puts
// getFluidState().getBlockState()), (6) the state survives Save.encode/decode.
// Anti-vacuity: each rule's engine side is corrupted and the check must notice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const A = join(MCLITE_ROOT, 'assets'), rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const pc = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcdata', 'pc', 'blocks.json'), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js',
  '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js', '07m_breed.js', '07zh_rabbit.js',
  '07zj_fox.js', '07zj_goat.js', '07zl_panda.js', '07q_effects.js', '07zm_axolotl.js', '07zj_fish.js', '14_player.js', '16b_save.js'];

function scene(patch) {
  const fails = []; let pass = 0;
  const ok = (c, m) => { if (c) pass++; else if (fails.length < 400) fails.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  const { World: W, Behave: B, States: S, Use, CH, Save, Player: P } = MCL;
  W.init(1); B.init(W); MCL.EntityList.init(); if (Use.init) Use.init(W);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const stone = S.stateOf('stone'), water = S.stateOf('water');
  const X = 4, Y = 70, Z = 4;
  const clear = () => { B.clearSchedule(); for (let x = X - 3; x <= X + 3; x++) for (let z = Z - 3; z <= Z + 3; z++) for (let y = Y - 2; y <= Y + 3; y++) W.setBlock(x, y, z, y < Y || (y === Y && Math.abs(x - X) + Math.abs(z - Z) === 1) ? stone : 0); B.clearSchedule(); };
  const names = MCL.Reg.names;
  let n = 0; const unsupported = [];
  for (const b of pc) {
    if (!b.states || !b.states.some(p => p.name === 'waterlogged')) continue;
    n++;
    const def = S.stateOf(b.name), dry = B.setProp(def, 'waterlogged', 'false'), wet = B.setProp(def, 'waterlogged', 'true');
    const tag = b.name; const DBG = process.env.DBG === b.name;
    // a double slab: SlabBlock.tryFillWithFluid / canFillWithFluid refuse unless type != double
    const dbl = b.name.endsWith('_slab') ? B.setProp(dry, 'type', 'double') : null;
    // (1) fill. A block that cannot stand in this fixture (glow lichen with no face, dripleaf on stone, hanging roots
    // with nothing above) is removed by its own survival rule before any water is involved: that is not this rule.
    clear(); W.setBlock(X, Y, Z, dry);
    if (W.getBlock(X, Y, Z) !== dry) { unsupported.push(tag); continue; }
    const filled = Use.placeFluid('water', X, Y, Z, null);
    ok(filled && W.getBlock(X, Y, Z) === wet, `${tag}: a water bucket waterlogs it`);
    ok(B.isScheduled(X, Y, Z), `${tag}: filling queues the fluid tick`);
    // (2) drain
    const got = Use.tryDrainFluid(X, Y, Z, W.getBlock(X, Y, Z));
    ok(got === 'water_bucket' && W.getBlock(X, Y, Z) === dry, `${tag}: an empty bucket drains it to dry`);
    ok(Use.tryDrainFluid(X, Y, Z, W.getBlock(X, Y, Z)) === '', `${tag}: a dry block drains nothing`);
    if (dbl) {
      clear(); W.setBlock(X, Y, Z, dbl); Use.placeFluid('water', X, Y, Z, null);
      ok(B.propName(W.getBlock(X, Y, Z), 'waterlogged') === 'false', `${tag}: a double slab cannot be waterlogged`);
    }
    // (3) neighbour update queues the tick of a waterlogged block
    clear(); W.setBlock(X, Y, Z, wet); B.clearSchedule();
    B.changed(X + 1, Y, Z);
    ok(B.isScheduled(X, Y, Z), `${tag}: a neighbour update queues its fluid tick`);
    // (4) flow out: nothing is under it -> water must reach the cell below unless the bottom face is solid
    clear(); W.setBlock(X, Y - 1, Z, 0); W.setBlock(X, Y, Z, wet); B.changed(X, Y, Z);
    for (let t = 0; t < 12; t++) B.tick();
    const survived = W.getBlock(X, Y, Z) === wet;   // a rail / sign / ladder that lost its floor goes (BlockState.canPlaceAt), which is not this rule
    const below = W.getBlock(X, Y - 1, Z), sealed = B.faceSturdy(wet, 0) || S.opaque[wet] === 1;
    if (DBG) console.log('DBG', S.name(wet), 'sealed', B.faceSturdy(wet, 0), S.opaque[wet], 'below', below && S.name(below), 'surv', survived);
    const flows = below !== 0 && names[S.block[below]] === 'water';
    if (survived) ok(sealed ? !flows : flows, `${tag}: water ${sealed ? 'is held by' : 'falls out of'} its bottom face`);
    // (5) break leaves a source
    clear(); W.setBlock(X, Y, Z, wet); B.clearSchedule();
    Object.assign(P, { hasTarget: true, tx: X, ty: Y, tz: Z });
    P.breakBlock();
    const after = W.getBlock(X, Y, Z);
    if (isFinite(S.hard[wet])) ok(after === water, `${tag}: breaking it leaves a water source (got ${after === 0 ? 'air' : S.name(after)})`);
    // (6) save/load
    clear(); W.setBlock(X, Y, Z, wet);
    const edits = new Map(); edits.set(W.key(0, 0), { cx: 0, cz: 0, m: new Map([[((Y + 64) << 8) | (Z << 4) | X, wet]]) });
    const blob = Save.encode(edits), back = new Map();
    ok(Save.decode(blob, back) === true && back.size === 1 && [...back.values()][0].m.get(((Y + 64) << 8) | (Z << 4) | X) === wet, `${tag}: waterlogged state survives save/load`);
  }
  ok(unsupported.length <= 8, `too many blocks skipped as unsupported: ${unsupported.join(' ')}`);
  return { fails, pass, n, unsupported };
}

const real = scene();
// anti-vacuity: edits to the REAL sources, each of which must make the check fail
const BREAKS = [
  ['filling no longer queues the tick', '07b_behaviour.js', "else if (wlSource(self)) B.schedule(x, y, z, WATER_DELAY);", ''],
  ['a neighbour update does not queue a waterlogged tick', '07b_behaviour.js', "else if (wlSource(upd)) B.schedule(nx, ny, nz, WATER_DELAY);", '', "else if (wlSource(fs)) B.schedule(fx, fy, fz, WATER_DELAY);", ''],
  ['a waterlogged block does not spread', '07b_behaviour.js', "if (wlSource(st)) { spread(x, y, z, S.stateOf('water'), B.WATER); return; }", ''],
  ['breaking leaves air', '14_player.js', "NS.States.waterIn[id] === 1 ? NS.States.stateOf('water') : 0)) return false;", '0)) return false;'],
  ['a double slab can be waterlogged', '14l_use.js', " && !(prop(st, 'type') === 'double')", ''],
  ['draining leaves it wet', '14l_use.js', "W.setBlock(x, y, z, setProp(state, 'waterlogged', 'false')); changed(x, y, z);", 'changed(x, y, z);'],
];
let breaks = 0;
for (const [what, file, from, to, from2, to2] of BREAKS) {
  let hit = false;
  const r = scene((f, src) => { if (f !== file) return src; if (src.includes(from)) hit = true; src = src.split(from).join(to); if (from2) { if (src.includes(from2)) hit = true; src = src.split(from2).join(to2); } return src; });
  if (!hit) { real.fails.push(`anti-vacuity: "${what}" pattern not found in ${file}`); continue; }
  if (r.fails.length) breaks++; else real.fails.push(`anti-vacuity: "${what}" was NOT caught`);
}
for (const f of real.fails) console.log('  FAIL ' + f);
console.log(`${breaks} breaks caught; ${real.pass} assertions, ${real.fails.length} failures over ${real.n} waterloggable blocks`);
console.log(`  skipped as unable to stand in the fixture: ${real.unsupported.join(' ')}`);
process.exit(real.fails.length || breaks < BREAKS.length ? 1 : 0);
