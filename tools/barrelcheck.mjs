#!/usr/bin/env node
// barrelcheck.mjs — G17-K5 (#5660): BarrelBlockEntity.openersCounter. Opening flips BarrelBlock.OPEN and
// plays block.barrel.open at the facing-offset position; the last close flips it back (block.barrel.close).
// The state is the world's, so it survives a reload. Headless: real 07b/07c/15_hud over a Map world.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '14f_inventory.js', '14g_menu.js',
               '07c_blockentity.js', '13_input.js', '15_hud.js'];

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.BlockEntities.init();
  const B = MCL.Behave, S = MCL.States, R = MCL.Reg, BE = MCL.BlockEntities, H = MCL.Hud;
  const world = new Map();
  B.init({}); B.w = { get: (x, y, z) => world.get(x + ',' + y + ',' + z) || 0, set: (x, y, z, s) => world.set(x + ',' + y + ',' + z, s) };
  const sounds = [];
  MCL.Sound = { play: (n, o) => sounds.push([n, o]) };
  MCL.Player = { menu: { inventory: MCL.Inventory.create() } };
  let st = 0;
  for (let i = 1; i < S.block.length; i++) if (R.names[S.block[i]] === 'barrel' && B.propName(i, 'facing') === 'east' && B.propName(i, 'open') === 'false') { st = i; break; }
  B.w.set(1, 70, 1, st);
  const be = BE.create(1, 70, 1, 'barrel');
  const isOpen = () => B.propName(B.w.get(1, 70, 1), 'open');
  const r = {};
  r.start = isOpen();
  H.openChest(1, 70, 1); BE.tick();
  r.open1 = isOpen(); r.snd1 = sounds.slice();
  // a second viewer
  be.open++; BE.tick();
  r.snd2 = sounds.length;
  be.open--; BE.tick(); r.stillOpen = isOpen();
  H.close(); BE.tick();
  r.closed = isOpen(); r.snd3 = sounds.slice();
  // reload: the entity forgets its edge detector, the world state stays
  H.openChest(1, 70, 1); BE.tick();
  delete be.barrelWas; BE.tick();
  r.reload = isOpen();
  H.close();
  return r;
}

console.log('barrelcheck — G17-K5 barrel open state');
const r = run();
ok(r.start === 'false', 'barrel starts closed');
ok(r.open1 === 'true', 'opening the menu flips open=true');
ok(r.snd1.length === 1 && r.snd1[0][0] === 'block.barrel.open', 'one block.barrel.open queued');
const o = r.snd1[0] && r.snd1[0][1] || {};
ok(o.x === 2 && o.y === 70.5 && o.z === 1.5, 'at the block centre offset half a block toward facing (east)');
ok(o.volume === 0.5 && o.pitch >= 0.9 && o.pitch < 1.0, 'volume 0.5, pitch 0.9..1.0');
ok(r.snd2 === 1, 'a second viewer plays nothing');
ok(r.stillOpen === 'true', 'stays open while one viewer remains');
ok(r.closed === 'false' && r.snd3.length === 2 && r.snd3[1][0] === 'block.barrel.close', 'last close flips it back and plays block.barrel.close');
ok(r.reload === 'true', 'lid state survives a reload (it is the block state)');

// anti-vacuity: no-op the counter
let caught = 0;
try {
  const b = run((f, s) => f === '07c_blockentity.js' ? s.replace('if (now === !!e.barrelWas) return;', 'return;') : s);
  if (b.open1 !== 'true' || b.snd1.length !== 1) caught++;
} catch (e) { caught++; }
ok(caught === 1, 'anti-vacuity: no-op counter fails'); if (caught === 1) console.log('   ✓ no-op counter fails');
for (const f of fails) console.log('FAIL  ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
