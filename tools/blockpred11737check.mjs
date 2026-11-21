#!/usr/bin/env node
// blockpred11737check.mjs — #11737: BlockPredicatesChecker (CanPlaceOn/CanDestroy) in 07po_blockpred.js, and its wiring
// into P.placeBlock / P.breakBlock for adventure mode. Breaks its own source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = '07po_blockpred.js';
function trial(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', F], dom: false, ...(patch ? { patch: (f, t) => (f === F ? patch(t) : t) } : {}) });
  const BP = E.BlockPred, S = E.States, o = {};
  const st = (n) => S.stateOf(n), P = (n) => S.withProp ? S.withProp : null;
  const stk = (k, l) => ({ t: { [k]: l } });
  o.parse = (() => { const a = BP.parse('minecraft:oak_stairs[half=top,facing=east]'); const b = BP.parse('#minecraft:logs'); return a && a.id === 'oak_stairs' && a.props.half === 'top' && !a.tag && b && b.tag && b.id === 'logs' && BP.parse('stone{x:1}').hasNbt && BP.parse('bad id!') === null && BP.parse('a:stone') === null && BP.parse('stone[x]') === null; })();
  o.block = BP.canPlaceOn(stk('CanPlaceOn', ['minecraft:stone']), st('stone')) && BP.canPlaceOn(stk('CanPlaceOn', ['dirt']), st('dirt')) && !BP.canPlaceOn(stk('CanPlaceOn', ['stone']), st('dirt'));
  o.any = BP.canPlaceOn(stk('CanPlaceOn', ['bogus!', 'minecraft:nosuchblock', 'stone']), st('stone')) && !BP.canPlaceOn(stk('CanPlaceOn', ['bogus!']), st('stone'));
  o.key = !BP.canDestroy(stk('CanPlaceOn', ['stone']), st('stone')) && BP.canDestroy(stk('CanDestroy', ['stone']), st('stone')) && !BP.canPlaceOn({}, st('stone')) && !BP.canPlaceOn(null, st('stone')) && !BP.canPlaceOn({ t: { CanPlaceOn: 'stone' } }, st('stone'));
  o.air = !BP.canPlaceOn(stk('CanPlaceOn', ['air']), 0);
  const slab = st('oak_stairs');
  o.props = BP.canPlaceOn(stk('CanPlaceOn', ['oak_stairs[half=bottom]']), slab) && !BP.canPlaceOn(stk('CanPlaceOn', ['oak_stairs[half=top]']), slab) && !BP.canPlaceOn(stk('CanPlaceOn', ['oak_stairs[nope=1]']), slab) && !BP.canPlaceOn(stk('CanPlaceOn', ['stone[half=bottom]']), st('stone'));
  o.tag = BP.canPlaceOn(stk('CanPlaceOn', ['#minecraft:logs']), st('oak_log')) && !BP.canPlaceOn(stk('CanPlaceOn', ['#minecraft:logs']), st('stone')) && !BP.canPlaceOn(stk('CanPlaceOn', ['#minecraft:nosuchtag']), st('stone'));
  o.nbt = !BP.canPlaceOn(stk('CanPlaceOn', ['stone{a:1}']), st('stone')) && BP.canPlaceOn(stk('CanPlaceOn', ['stone{a:1}']), st('stone'), true);
  return o;
}
const base = (() => { try { return trial(); } catch (e) { fails.push('baseline threw ' + e.message); return {}; } })();
for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const pl = readFileSync(join(ROOT, 'src/14_player.js'), 'utf8');
ok(/NS\.BlockPred\.canPlaceOn\(P\.heldItem\(\), P\.tid\)/.test(pl), 'placeBlock consults CanPlaceOn');
ok(/NS\.BlockPred\.canDestroy\(P\.heldItem\(\)/.test(pl), 'breakBlock consults CanDestroy');
ok(readFileSync(join(ROOT, 'build.mjs'), 'utf8').includes("'" + F + "'"), 'build lists the module');
const BR = [['dkey', "'CanDestroy', state", "'CanPlaceOn', state", ['key']],
  ['anyskip', "if (typeof list[i] === 'string' && BP.matches(BP.parse(list[i]), state, hasBlockEntity)) return true;", "if (!BP.matches(BP.parse(list[i]), state, hasBlockEntity)) return false; else return true;", ['any']],
  ['tag', 'NS.Tags.blockIn(pred.id, blk)', 'true', ['tag']], ['blk', 'R.id[pred.id] !== blk', 'false', ['block']],
  ['prop', 'S.propValue(state, pid) !== vid', 'false', ['props']], ['nbt', 'pred.hasNbt && !hasBlockEntity', 'false', ['nbt']],
  ['ns', "m[2] !== 'minecraft'", 'false', ['parse']], ['air', 'state <= 0', 'state < 0', ['air']], ['arr', '!Array.isArray(list)', 'false', ['key']],
  ['dup', 'props[kv[1]] !== undefined', 'false', []]];
let breaks = 0;
for (const [key, a, b, expect] of BR) {
  if (!expect.length) continue;
  let hit = false, X;
  const p = (s) => { const j = s.indexOf(a); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = trial(p); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]); ok(caught, 'anti-vacuity: ' + key); if (caught) { breaks++; console.log('  ✓ break caught: ' + key); }
}
console.log(`blockpred11737check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
