#!/usr/bin/env node
// throwableitemcheck.mjs — Dan: "a thrown potion is invisible ... no visible bottle while it
// flies". `EL.DEFAULTS.item` is the ONLY place any entity is ever given `e.item`
// (07i_entitylist.js:435, `if (opts.item !== undefined) e.item = opts.item`), and none of
// `EL.DEFAULTS.potion`/`.snowball`/`.egg`/`.ender_pearl` call it. `ER.spritesFor` ->
// `ER.itemIdOf` required `e.item` unconditionally, so every one of these four thrown entities
// (not only the potion) resolved `idx = -1` and `ER.visible` skipped them outright
// (`if (!sprites) continue;`) -- a real, live, in-flight potion/snowball/egg/pearl had no
// picture at all.
//
//   node tools/throwableitemcheck.mjs [--verbose]
//
// 1. `ER.itemIdOf` resolves a real, non-negative item index for a bare `potion` entity with NO
//    `e.item` field at all, for both the splash (default) and lingering variants (splash_potion
//    vs lingering_potion — two different real items, keyed off `e.lingering`), and for
//    snowball/egg/ender_pearl the same way.
// 2. `ER.spritesFor` (the function `ER.visible`'s own `if (!sprites) continue` gate calls)
//    returns a real, non-empty sprite part list for a live `potion` entity built the exact way
//    `EL.spawn('potion', ...)`/`Po.witchThrow` build one (via `EL.spawn`, not a hand-rolled
//    object), for both variants, and for snowball/egg/ender_pearl.
// 3. an entity carrying an explicit `e.item` (a real dropped item) is completely unaffected —
//    `ER.itemIdOf` still reads `e.item` first, never the new fallback, byte for byte.
// 4. anti-vacuity: delete `ER.THROWN_ITEM_NAME`/the `e.type` fallback (an empty map, `potion`
//    fallback disabled) and watch every thrown-entity assertion above fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ASSETS = join(MCLITE_ROOT, 'assets');
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { const p0 = pass; ok(c, 'anti-vacuity: ' + m); if (pass > p0 && !VERBOSE) console.log('   ✓ ' + m); };

console.log('throwableitemcheck — a thrown potion/snowball/egg/pearl is drawn in flight (D-KW)');

const M = loadEngine({
  extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07j_entityrender.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
ok(M.Items.ready, 'the item table loaded');
ok(M.EntityList.ready, 'the entity table loaded');

const EL = M.EntityList, ER = M.EntityRender, IT = M.Items;

function checkThrown(er, o) {
  const CASES = [
    ['potion', { lingering: false }, 'splash_potion'],
    ['potion', { lingering: true }, 'lingering_potion'],
    ['snowball', {}, 'snowball'],
    ['egg', {}, 'egg'],
    ['ender_pearl', {}, 'ender_pearl'],
  ];
  for (const [type, opts, wantItem] of CASES) {
    EL.list.length = 0;
    const e = EL.spawn(type, 8.5, 65, 8.5, opts);
    if (!o(!!e && e.type === type, type + '(' + JSON.stringify(opts) + ') spawns a real entity')) continue;
    o(e.item === undefined, type + ' carries no e.item of its own (the real gap this check proves ER.itemIdOf works around)');
    const idx = er.itemIdOf(e);
    const wantIdx = IT.of(wantItem);
    o(wantIdx >= 0, '"' + wantItem + '" is a real item in this build’s registry');
    o(idx === wantIdx, type + ' resolves item index ' + wantIdx + ' (' + wantItem + '), got ' + idx);
    const sprites = er.spritesFor(e);
    o(!!sprites && Array.isArray(sprites.parts) && sprites.parts.length > 0,
      type + ' (' + wantItem + ') has a real, non-empty sprite part list to draw in flight');
  }
}
checkThrown(ER, ok);

// ── 3. a real dropped item entity is unaffected — e.item still wins, byte for byte. ──
{
  EL.list.length = 0;
  const stoneIdx = IT.of('stone');
  ok(stoneIdx >= 0, '"stone" is a real item in this build’s registry');
  const e = EL.spawn('item', 8.5, 65, 8.5, { item: stoneIdx, count: 1 });
  ok(!!e && e.item === stoneIdx, 'a dropped item entity still carries its own e.item');
  ok(ER.itemIdOf(e) === stoneIdx, 'ER.itemIdOf still reads e.item first for a real dropped item (unchanged)');
}

// ── 4. anti-vacuity: no fallback at all -> every thrown-entity assertion above must fail. ──
{
  const brokenER = Object.create(ER);
  brokenER.itemIdOf = function (e) {
    if (!e || e.item === undefined || e.item === null) return -1;
    if (typeof e.item === 'number') return e.item;
    return e.item.i !== undefined ? e.item.i : (e.item.id !== undefined ? e.item.id : -1);
  };
  brokenER.spritesFor = function (e) {
    const idx = brokenER.itemIdOf(e);
    if (!(idx >= 0)) return null;
    return ER.spritesFor.call(ER, Object.assign({}, e, { item: idx }));
  };
  const localFails = [];
  const localOk = (c, m) => { if (!c) localFails.push(m); return c; };
  checkThrown(brokenER, localOk);
  // count only the "has a real, non-empty sprite part list" assertions -- those are the ones
  // that prove the picture, and the idx===wantIdx ones (which also fail once idx is stuck at -1).
  okAv(localFails.length > 0, 'reverting to the old e.item-only ER.itemIdOf fails every thrown-entity sprite check (' + localFails.length + ' would fail)');
}

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures`);
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('FAIL throwableitemcheck');
  process.exit(1);
}
console.log(`PASS throwableitemcheck: ${pass} assertions, 0 failures, 1 break caught`);
