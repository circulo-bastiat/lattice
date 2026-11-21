#!/usr/bin/env node
// bannerplacecheck.mjs — #896 (KW-49-4c2). A placed banner's block entity takes Patterns from the held
// stack's BlockEntityTag and gives them back on the drop (P.applyBannerTag / P.bannerTagAt, 14_player.js),
// the drop's tag survives popResource -> dropStack, and `banner.patterns` is a saved BE field.
// Anti-vacuity: each group re-runs against a deliberately broken copy of the source and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');

function grab(text, name) {
  const i = text.indexOf('P.' + name + ' = function');
  if (i < 0) return null;
  const j = text.indexOf('\n  };', i);
  return text.slice(i, j + 5);
}

function run(player, be, el, drop) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  const store = new Map();
  const NS = { BlockEntities: { ready: true, get: (x, y, z) => store.get(x + ',' + y + ',' + z) } };
  const P = {};
  new Function('NS', 'P', grab(player, 'bannerTagAt') + grab(player, 'applyBannerTag'))(NS, P);
  const tag = { BlockEntityTag: { Patterns: [{ Pattern: 'bs', Color: 14 }, { Pattern: 'bo', Color: 15 }] } };
  ok(!P.applyBannerTag(0, 0, 0, { t: tag }), 'no entity: nothing to apply');
  store.set('1,2,3', { type: 'banner', patterns: [] });
  ok(P.applyBannerTag(1, 2, 3, { t: tag }), 'banner entity takes the tag');
  const e = store.get('1,2,3');
  ok(e.patterns.length === 2 && e.patterns[0].Pattern === 'bs' && e.patterns[1].Color === 15, 'patterns copied in order');
  ok(e.patterns !== tag.BlockEntityTag.Patterns && e.patterns[0] !== tag.BlockEntityTag.Patterns[0], 'patterns are a copy, not the stack\'s array');
  P.applyBannerTag(1, 2, 3, { t: undefined });
  ok(store.get('1,2,3').patterns.length === 0, 'plain banner stack resets to no patterns');
  store.set('4,5,6', { type: 'chest', items: [] });
  ok(!P.applyBannerTag(4, 5, 6, { t: tag }) && !store.get('4,5,6').patterns, 'non-banner entity untouched');
  store.set('1,2,3', { type: 'banner', patterns: [{ Pattern: 'cr', Color: 1 }] });
  const back = P.bannerTagAt(1, 2, 3);
  ok(back && back.BlockEntityTag.Patterns[0].Pattern === 'cr' && back.BlockEntityTag.Patterns !== store.get('1,2,3').patterns, 'drop tag is a copy of the patterns');
  store.set('1,2,3', { type: 'banner', patterns: [] });
  ok(P.bannerTagAt(1, 2, 3) === null, 'pattern-less banner drops with no tag');
  ok(P.bannerTagAt(9, 9, 9) === null, 'no entity -> no tag');
  ok(/banner:\s*\['patterns'\]/.test(be), 'banner.patterns is a saved BE field');
  ok(/EL\.popResource = function \(bx, by, bz, item, count, opts\)/.test(el) && /dropStack\(x, y, z, item, count, opts\)/.test(el), 'popResource forwards opts (tag) to dropStack');
  ok(/d\.tag \? \{ tag: d\.tag \}/.test(drop), 'collectDrops hands the drop tag to popResource');
  return fails;
}

const P0 = src('14_player.js'), B0 = src('07c_blockentity.js'), E0 = src('07i_entitylist.js');
const base = run(P0, B0, E0, P0);
if (base.length) { console.log(' bannerplacecheck FAIL\n  ' + base.join('\n  ')); process.exit(1); }

const breaks = [
  [() => run(P0.replace("e.type !== 'banner') return false;\n    var src", "e.type !== 'bannerX') return false;\n    var src"), B0, E0, P0), 'applies to wrong type'],
  [() => run(P0.replace("e.patterns = src ? JSON.parse(JSON.stringify(src)) : [];", "e.patterns = src || [];"), B0, E0, P0), 'aliases the stack array'],
  [() => run(P0.replace("Patterns: JSON.parse(JSON.stringify(e.patterns))", "Patterns: e.patterns"), B0, E0, P0), 'drop aliases entity array'],
  [() => run(P0, B0.replace("banner: ['patterns']", "banner: []"), E0, P0), 'patterns not saved'],
  [() => run(P0, B0, E0.replace('count, opts);\n  };\n\n  /** Do these two', 'count);\n  };\n\n  /** Do these two'), P0), 'tag dropped in popResource'],
  [() => run(P0, B0, E0, P0.replace('d.tag ? { tag: d.tag } : undefined', 'undefined')), 'tag dropped in collectDrops'],
];
let caught = 0;
for (const [f, what] of breaks) {
  let fails;
  try { fails = f(); } catch (e) { fails = [String(e)]; }
  if (fails.length) { caught++; console.log('   ✓ anti-vacuity: ' + what + ' caught'); } else console.log('  MISSED BREAK: ' + what);
}
if (caught !== breaks.length) { console.log(' bannerplacecheck FAIL: ' + (breaks.length - caught) + ' breaks not caught'); process.exit(1); }
console.log(' bannerplacecheck: 12 assertions, 0 failures, ' + caught + ' breaks caught');
