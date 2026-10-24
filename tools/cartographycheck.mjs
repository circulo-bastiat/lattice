#!/usr/bin/env node
// cartographycheck.mjs — #8058 G19e: CartographyTableScreenHandler.updateResult (.decomp) as
// Menu.cartographyResult / Menu.cartographyMenu: paper zooms (scale cap 4), glass pane locks,
// empty map clones x2, result map NBT, take consumes one of each. Breaks its own rules (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0, caught = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const brk = (c, m) => { breaks++; if (!c) caught++; else fails.push('break not caught: ' + m); };
console.log('cartographycheck — #8058 cartography table');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js'] });
const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
const I = (n) => M.Items.of(n);
const st = (n, c = 1, t) => (t ? { i: I(n), n: c, d: 7, t } : { i: I(n), n: c, d: 7 });
const R = (a, b) => M.Menu.cartographyResult(a, b);

// zoom: scale 0..3 with paper -> map_scale_direction 1, count 1, id kept; scale 4 refused
for (let sc = 0; sc < 4; sc++) {
  const r = R(st('filled_map', 1, { scale: sc }), st('paper'));
  ok(r && r.n === 1 && r.d === 7 && r.t.map_scale_direction === 1 && r.t.scale === sc, 'zoom at scale ' + sc);
}
const capped = R(st('filled_map', 1, { scale: 4 }), st('paper'));
ok(capped === null, 'scale 4 does not zoom');
// lock
const lk = R(st('filled_map'), st('glass_pane'));
ok(lk && lk.n === 1 && lk.t.map_to_lock === true, 'glass pane locks');
ok(R(st('filled_map', 1, { locked: true }), st('glass_pane')) === null, 'locked map not locked again');
ok(R(st('filled_map', 1, { locked: true }), st('paper')) === null, 'locked map does not zoom');
// clone
const cl = R(st('filled_map', 1, { scale: 2 }), st('map'));
ok(cl && cl.n === 2 && cl.d === 7 && cl.t.scale === 2 && cl.t.map_scale_direction === undefined, 'empty map clones, count 2');
ok(R(st('filled_map', 1, { locked: true }), st('map')).n === 2, 'locked map can still be cloned');
ok(R(st('filled_map'), st('stone')) === null && R(st('map'), st('paper')) === null, 'wrong inputs refused');
// source map untouched
const src = st('filled_map', 1, { scale: 1 }); R(src, st('paper'));
ok(src.t.map_scale_direction === undefined, 'input tag not mutated');

// menu: result, take, slot filters
{
  const inv = M.Inventory.create ? M.Inventory.create() : null;
  const m = M.Menu.cartographyMenu(inv);
  ok(m.slots.length === 39, '39 slots');
  m.input.set(0, st('filled_map', 1, { scale: 0 })); m.input.set(1, st('paper', 3)); m.refresh();
  ok(m.result.get(0) && m.result.get(0).t.map_scale_direction === 1, 'menu result');
  m.slots[2].onTakeFn();
  ok(m.input.get(0) === null && m.input.get(1).n === 2, 'take consumes one map and one paper');
  ok(m.result.get(0) === null, 'result cleared after take');
}

// ── breaks
{
  const real = M.Menu.cartographyResult;
  const noCap = (map, mat) => (map.t && map.t.scale >= 4 && mat.i === I('paper'))
    ? { ...map, n: 1, t: { ...map.t, map_scale_direction: 1 } } : real(map, mat);   // scale cap 4 removed
  brk(noCap(st('filled_map', 1, { scale: 4 }), st('paper')) === null, 'scale cap 4 removed');
  const noLock = (map, mat) => mat.i === I('glass_pane') ? { ...map, n: 1, t: { ...map.t, map_to_lock: true } } : real(map, mat);
  brk(noLock(st('filled_map', 1, { locked: true }), st('glass_pane')) === null, 'lock check removed');
  const one = (map, mat) => { const r = real(map, mat); if (r && mat.i === I('map')) r.n = 1; return r; };
  brk(one(st('filled_map'), st('map')).n === 2, 'clone count 1');
  const noFlag = (map, mat) => { const r = real(map, mat); if (r && r.t) delete r.t.map_to_lock; return r; };
  brk(noFlag(st('filled_map'), st('glass_pane')).t.map_to_lock === true, 'lock flag dropped');
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}/${breaks}`);
for (let i = 0; i < caught; i++) console.log('   ✓ break caught (' + (i + 1) + ')');
console.log(' ' + caught + ' breaks caught');
if (fails.length || caught !== breaks) { fails.forEach((f) => console.log('   x ' + f)); process.exit(1); }
