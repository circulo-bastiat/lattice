#!/usr/bin/env node
// stalactitecheck.mjs — #5664: PointedDripstoneBlock updateShape/scheduledTick -> falling column, tip hurts entities.
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('stalactitecheck — #5664 falling stalactite');

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07h_entities.js',
               '07i_entitylist.js', '14b_physics.js', '07zzi_dripstone.js'];
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
const tipDown = S.withLocal('pointed_dripstone', 1 * 4 + 2 + 1), midDown = S.withLocal('pointed_dripstone', 2 * 4 + 2 + 1);
const hurts = [];
MCL.Combat = { hurt: (o, amt, a, b, opts) => { hurts.push({ o, amt, src: opts && opts.source }); return true; } };
function run3() {
  fresh(); floor(10); hurts.length = 0; MCL.Behave.init(W); MCL.Behave.clearSchedule();
  cells.set(key(0, 40, 0), st('stone'));
  cells.set(key(0, 39, 0), midDown); cells.set(key(0, 38, 0), midDown); cells.set(key(0, 37, 0), tipDown);
  const z = EL.spawn('zombie', 0.5, 11, 0.5, {});
  z.noGravity = true;
  W.canSurvive = () => true;
  cells.set(key(0, 40, 0), 0);
  MCL.Behave.changed(0, 40, 0, st('stone'));
  for (let i = 0; i < 4; i++) MCL.Behave.tick();
  const fb = EL.all().filter((e) => e.type === 'falling_block');
  return { z, fb };
}
let { z, fb } = run3();
ok(fb.length === 3, '3 falling_block entities: ' + fb.length);
const tip = fb.find((e) => e.hurtEntities);
ok(tip && tip.fallHurtAmount === 6 && tip.fallDamageMax === 40 && tip.hurtSource === 'fallingStalactite', 'tip hurts: max(1+dy,6)=6, cap 40');
ok(fb.filter((e) => e.hurtEntities).length === 1, 'only the tip hurts');
for (let i = 0; i < 80; i++) for (const e of fb) if (!e.removed) EL.tickOne(e);
const h = hurts.filter((v) => v.o === z);
ok(h.length >= 1 && h[0].src === 'fallingStalactite' && h[0].amt > 0 && h[0].amt <= 40, 'zombie hurt by fallingStalactite: ' + JSON.stringify(h.map((v) => v.amt)));
MCL.Dripstone.noHurt = true;
({ z, fb } = run3());
for (let i = 0; i < 80; i++) for (const e of fb) if (!e.removed) EL.tickOne(e);
av(fb.length === 3 && hurts.filter((v) => v.o === z).length === 0, 'column without setHurtsEntities hurts nobody');
MCL.Dripstone.noHurt = false;
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
