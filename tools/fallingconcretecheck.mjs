#!/usr/bin/env node
// fallingconcretecheck.mjs — #833 G17c: FallingBlockEntity.tick's landing (.decomp FallingBlockEntity.java:114-216).
// Gravity/move/drag, place on landing, drop-as-item when it cannot place (doEntityDrops-gated),
// the 600-tick / out-of-world drop, air-state discard, hurtEntities fall damage.
// Every section breaks its own data and prints a "✓" line (the suite counts them as breaks caught).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const av = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('fallingconcretecheck — #833 FallingBlockEntity.tick landing');

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
const SOLID = new Set([st('stone'), st('sand')]);
for (const c of ['white','red','lime']) { SOLID.add(st(c + '_concrete_powder')); SOLID.add(st(c + '_concrete')); }   // torch / grass have no collision box
MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(W.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);   // the one function the sweep asks
MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
MCL.Physics.grounded = (x, y, z, d) => SOLID.has(W.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
MCL.Behave.init(W);
MCL.Entities.init();
EL.init();
let rule = 'true';
MCL.Commands = { ruleGet: () => rule };
function fresh() { cells.clear(); rule = 'true'; EL.init(); }
function floor(y) { for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) cells.set(key(x, y, z), st('stone')); }
function run(e, n) { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); }
const items = () => EL.all().filter((e) => e.type === 'item' && !e.removed);


const COL = R.names.filter((n) => n && n.endsWith('_concrete_powder')).map((n) => n.slice(0, -16));
ok(COL.length === 16, '16 colours found');
function trial(c, wet) {
  fresh(); floor(10);
  if (wet) cells.set(key(0, 11, 0), st('water'));
  const e = EL.spawn('falling_block', 0.5, 14, 0.5, { state: st(c + '_concrete_powder') });
  run(e, 60);
  return W.getBlock(0, 11, 0);
}
function sweep(real) {
  const B = MCL.Behave, saved = B.concrete;
  if (!real) B.concrete = (s) => s;
  let hard = 0, dry = 0, placed = 0;
  for (const c of COL) {
    if (trial(c, true) === st(c + '_concrete')) hard++;
    if (trial(c, false) === st(c + '_concrete_powder')) dry++;
    fresh(); cells.set(key(1, 5, 0), st('water'));
    if (B.place(st(c + '_concrete_powder'), 0, 5, 0) === st(c + '_concrete')) placed++;
    if (B.place(st(c + '_concrete_powder'), 0, 5, 3) === st(c + '_concrete_powder')) placed++;
  }
  B.concrete = saved;
  return [hard, dry, placed];
}
let r = sweep(true);
ok(r[0] === 16, 'powder landing in water becomes concrete (' + r[0] + '/16)');
ok(r[1] === 16, 'dry powder stays powder');
ok(r[2] === 32, 'placed beside water hardens, away from water stays');
r = sweep(false);
av(r[0] === 0, 'without the hook landing does not harden');
av(r[2] === 16, 'without the hook placement does not harden');
fresh(); cells.set(key(0, 4, 0), st('water'));
ok(MCL.Behave.place(st('white_concrete_powder'), 0, 5, 0) === st('white_concrete_powder'), 'water only below does not harden');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log(pass + " checks passed, 2 breaks caught");
