#!/usr/bin/env node
// fallingtedcheck.mjs — #5918: FallingBlockEntity TileEntityData restores the block entity on landing.
// Runs the landing twice: with the restore step and with it disabled (anti-vacuity), and a save/load mid-fall.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '14f_inventory.js', '07c_blockentity.js', '07h_entities.js',
               '07i_entitylist.js', '07zw_mobnbt.js', '14b_physics.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const S = MCL.States, EL = MCL.EntityList, BE = MCL.BlockEntities, st = (n) => S.stateOf(n) | 0;
const cells = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
MCL.World = { getBlock: (x, y, z) => (y < -64 ? st('stone') : (cells.get(key(x, y, z)) | 0)),
  setBlock(x, y, z, id) { cells.set(key(x, y, z), id); BE.onChanged(x, y, z, id); return true; }, canSurvive: () => true };
const SOLID = new Set([st('stone')]);
MCL.Physics.shapeAt = (x, y, z) => (SOLID.has(MCL.World.getBlock(x, y, z)) ? MCL.Physics.FULL_CUBE : null);
MCL.Physics.solidAt = (x, y, z) => MCL.Physics.shapeAt(x, y, z) !== null;
MCL.Physics.grounded = (x, y, z, d) => SOLID.has(MCL.World.getBlock(Math.floor(x), Math.floor(y - d), Math.floor(z)));
MCL.Entities.init(); BE.init();
const Iv = MCL.Inventory;
const diamonds = Iv.stackToJSON(Iv.stack ? Iv.stack('diamond', 7) : { id: 'diamond', n: 7 });
function fresh() { cells.clear(); BE.clear(); EL.init(); for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) cells.set(key(x, 10, z), st('stone')); }
const run = (e, n) => { for (let i = 0; i < n && !e.removed; i++) EL.tickOne(e); };
const count = (be) => (be && be.items ? be.items.filter((s) => s && !Iv.isEmpty(s)).length : -1);

console.log('fallingtedcheck — #5918');
function scenario(withTag, midSave) {
  fresh();
  const o = { state: st('chest') };
  if (withTag) o.tileEntityData = { items: (() => { const a = new Array(27).fill(null); a[3] = diamonds; return a; })() };
  let e = EL.spawn('falling_block', 0.5, 14, 0.5, o);
  if (midSave) {
    run(e, 3);
    const recs = JSON.parse(JSON.stringify(MCL.MobNbt.serializeAll()));
    EL.init(); MCL.MobNbt.restoreAll(recs);
    e = EL.all().find((x) => x.type === 'falling_block');
    ok(!!e, 'falling block survives save/load');
  }
  run(e, 80);
  return BE.get(0, 11, 0);
}
const a = scenario(true, false);
ok(a && count(a) === 1, 'landed chest holds the items');
const b = scenario(true, true);
ok(b && count(b) === 1, 'items survive a save/load mid-fall');
const c = scenario(false, false);
ok(c && count(c) === 0, 'no tag: chest lands empty');
console.log('   ✓ ' + (a && count(a) === 1 ? 'restore present' : 'restore missing'));
// anti-vacuity: remove the restore step and the first assertion must fail
const orig = BE.restoreAll; BE.restoreAll = () => 0;
const d = scenario(true, false);
BE.restoreAll = orig;
if (d && count(d) === 0) console.log('   ✓ restore removed: chest lands empty (breaks caught)'); else fails.push('anti-vacuity: restore removal not detected');
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
