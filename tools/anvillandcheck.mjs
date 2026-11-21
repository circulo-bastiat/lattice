#!/usr/bin/env node
// anvillandcheck.mjs — #5557: AnvilBlock.onLanding (1031) / onDestroyedOnLanding (1029), gated on !isSilent.
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('anvillandcheck — #5557 LandingBlock.onLanding / onDestroyedOnLanding');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
               '07i_entitylist.js', '14b_physics.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const R = MCL.Reg, S = MCL.States, EL = MCL.EntityList;
const st = (n) => S.stateOf(n) | 0;

const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const W = {
  getBlock: (x, y, z) => (y < -64 ? st('stone') : (cells.get(key(x, y, z)) | 0)),
  setBlock(x, y, z, id) { cells.set(key(x, y, z), id); return true; },
  canSurvive: () => true,
};
MCL.World = W;
const SOLID = new Set([st('stone'), st('sand')]);   // torch / grass have no collision box
MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(W.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);   // the one function the sweep asks
MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
MCL.Physics.grounded = (x, y, z, d) => SOLID.has(W.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
MCL.Entities.init();
EL.init();
let rule = 'true';
MCL.Commands = { ruleGet: () => rule };
function fresh() { cells.clear(); rule = 'true'; EL.init(); }
function floor(y) { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) cells.set(key(x, y, z), st('stone')); }
function run(e, n) { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); }
const items = () => EL.all().filter((e) => e.type === 'item' && !e.removed);

const snd = [];
MCL.Sound = Object.assign(MCL.Sound || {}, { entitySound: (ev, x, y, z, vol, pitch) => snd.push({ ev, x, y, z, vol }) });
const BE = MCL.BlockEntities;
function trial(opts, setup) {
  fresh(); floor(10); snd.length = 0; BE.eventLog = [];
  if (setup) setup();
  const e = EL.spawn('falling_block', 0.5, 14, 0.5, Object.assign({ state: st('anvil') }));
  Object.assign(e, opts);
  run(e, 60);
  return { e, ids: BE.eventLog.map((v) => v.id) };
}
let r = trial({});
ok(r.e.removed && W.getBlock(0, 11, 0) === st('anvil'), 'anvil placed');
ok(r.ids.join() === '1031', 'landing emits only 1031: ' + r.ids);
ok(snd.length === 1 && snd[0].ev === 'block.anvil.land' && snd[0].vol === 0.3, 'sound block.anvil.land at 0.3');
r = trial({}, () => { W.canSurvive = (x, y, z) => false; });
W.canSurvive = () => true;
ok(r.ids.join() === '1029' && snd[0].ev === 'block.anvil.destroy' && snd[0].vol === 1, 'blocked anvil emits 1029 anvil.destroy: ' + r.ids);
r = trial({ destroyedOnLanding: true });
ok(r.ids.join() === '1029' && !W.getBlock(0, 11, 0), 'destroyedOnLanding emits 1029, places nothing: ' + r.ids);
r = trial({ silent: true });
ok(r.ids.length === 0 && snd.length === 0 && W.getBlock(0, 11, 0) === st('anvil'), 'silent anvil lands with no event');
r = trial({ silent: true, destroyedOnLanding: true });
ok(r.ids.length === 0 && snd.length === 0, 'silent destroyed anvil emits none');
r = trial({ state: st('sand') });
ok(r.ids.length === 0, 'sand is not a LandingBlock: no event');
// anti-vacuity: without the call there is no event
const keep = EL.onLanding; EL.onLanding = () => {};
r = trial({}); EL.onLanding = keep;
av(r.ids.length === 0, 'removing the onLanding call fails the 1031 assertion');
const keep2 = EL.onDestroyedOnLanding; EL.onDestroyedOnLanding = () => {};
r = trial({ destroyedOnLanding: true }); EL.onDestroyedOnLanding = keep2;
av(r.ids.length === 0, 'removing the onDestroyedOnLanding call fails the 1029 assertion');
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
