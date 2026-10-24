#!/usr/bin/env node
// savecheck.mjs — a save must survive the block registry changing underneath it.
// worldbordersavecheck.mjs — #8307: the world border (WorldBorder.Properties) survives Save.save/Save.load,
// a shrink in progress resumes with its REMAINING lerp time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';

const RUNTIME = readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64');
const GEOMETRY = readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64');
const RMETA = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const GMETA = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));
const TILEALPHA = JSON.parse(readFileSync(join(ASSETS, 'block-tiles.meta.json'), 'utf8')).alpha;

const ITEMS = readFileSync(join(ASSETS, 'items.bin')).toString('base64');
const IMETA = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));

const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
               '02c_states.js', '02g_items.js', '03_section.js', '09b_sky.js', '14d_survival.js',
               '14f_inventory.js', '16b_save.js'];

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const store = {};
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
function fresh() {
  const NS = {}; globalThis.MCL = NS;
  for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
  NS.Blocks.init();
  NS.Reg.init({ runtime: RUNTIME, runtimeBytes: RMETA.rawBytes, geometry: GEOMETRY, geometryBytes: GMETA.rawBytes, tileAlpha: TILEALPHA });
  NS.Items.init({ items: ITEMS, itemsBytes: IMETA.rawBytes });
  // the border block of 07_world.js, lifted verbatim (the whole world module needs the engine)
  const w = readFileSync(join(SRC, '07_world.js'), 'utf8');
  const a = w.indexOf('  var WB = W.border'), b = w.indexOf('})(MCL);', a);
  NS.World = {}; new Function('W', w.slice(a, b))(NS.World);
  NS.Hud = { say() {}, pushStatus() {} };
  NS.Player = { toJSON() { return { x: 0, y: 80, z: 0 }; } };
  return NS;
}
function run(dropWriter) {
  const A = fresh(), B = A.World.border; let t = 1000;
  B.now = () => t;
  A.Save.init(); A.Save.seed = 77;
  B.centerX = 120.5; B.centerZ = -33; B.damagePerBlock = 0.75; B.safeZone = 9; B.warningBlocks = 11; B.warningTime = 21;
  B.setSize(1000); B.lerpSize(200, 10000); t += 4000;      // 6000 ms of the shrink left, size 680
  if (dropWriter) A.Save.borderToJSON = () => undefined;
  A.Save.save(false);
  const C = fresh(), D = C.World.border; D.now = () => t;
  C.Save.init(); C.Save.load();
  return D;
}
const D = run(false);
ok(D.centerX === 120.5 && D.centerZ === -33, 'center');
ok(D.damagePerBlock === 0.75 && D.safeZone === 9 && D.warningBlocks === 11 && D.warningTime === 21, 'damage/safe/warning');
ok(D.size() === 680, 'size now ' + D.size());
ok(D.newSize === 200 && D.dur === 6000 && D.stage() === 'shrinking', 'lerp target + remaining time kept: ' + D.newSize + ' ' + D.dur);
{ // finished lerp saves as stationary
  const A = fresh(), B = A.World.border; let t = 0; B.now = () => t; B.lerpSize(5, 100); t = 500;
  const j = A.Save.borderToJSON(); ok(j.BorderSize === 5 && j.BorderSizeLerpTime === 0, 'finished lerp is stationary');
}
breaks++;
const E = run(true);
ok(!(E.centerX === 120.5 && E.size() === 680), 'anti-vacuity: writer skipping the border must be seen');
console.log(`   ${breaks} breaks caught`);
console.log(`worldbordersavecheck: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
