#!/usr/bin/env node
// entitycheck.mjs — PLAN G17a: every entity type, against the bytecode and against the game.
//
//   node tools/entitycheck.mjs
//
// ⚠ WHAT THIS CHECK IS FOR. The table in `src/07h_entities.js` comes from the 1.18.2 bytecode
// by way of two generated artefacts — the golden TSV and `assets/entities.json` — and a value
// can be lost at either hop. G16b is the proof that it happens: `build-gui.mjs` packed two
// sheets, `assets/gui.bin` held them, and the SHIPPED FILE did not, because `gen-data.mjs` was
// never re-run (D-304). So every assertion below compares the RUNTIME's answer with the GOLDEN
// TABLE's, not with a number typed into this file — except the anchors, which are the handful
// of facts a player can verify by walking a mob into a gap.
//
// Sections:
//   1. the table arrives in the runtime, complete
//   2. every row agrees with the golden TSV, in both directions
//   3. the set is closed against the game's own registry dump
//   4. the anchors — hitboxes a player can measure
//   5. the box arithmetic: feet at the position, footprint centred on it
//   6. no silent defaults: an unknown id is an error, not a 0.6 x 1.8 entity
//   7. anti-vacuity — break the table and every section above must notice

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ROOT = MCLITE_ROOT;
const TSV = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const JSONF = join(ROOT, 'assets', 'entities.json');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };
const say = (...a) => console.log(...a);

if (!existsSync(TSV) || !existsSync(JSONF)) {
  say('entitycheck: SKIP — run tools/extract-entities.mjs and tools/pack-entities.mjs first');
  process.exit(0);
}

const M = loadEngine({ extra: ['07h_entities.js'], initReg: false });
const data = JSON.parse(readFileSync(JSONF, 'utf8'));
M.DATA = Object.assign({}, M.DATA, { entities: data });
M.Entities.init();
const E = M.Entities;

say("entitycheck — PLAN G17a, the entity table (D-306)");

// ── 1. it arrived ───────────────────────────────────────────────────────────────────────────
say('\n1. the table reached the runtime');
ok(E.ready === true, 'Entities.init() left the table not ready');
ok(E.count > 100, `only ${E.count} entity types in the runtime`);

// ── 2. runtime against the golden TSV, both ways ────────────────────────────────────────────
say('\n2. every row agrees with the golden table');
const gold = new Map();
for (const l of readFileSync(TSV, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const [n, w, h, f, t, u] = l.split('\t');
  gold.set(n, { w: Number(w), h: Number(h), fire: Number(f) === 1,
                track: t === '' ? -1 : Number(t), upd: u === '' ? -1 : Number(u) });
}
ok(gold.size > 100, `the golden TSV has ${gold.size} rows`);
let diff = 0;
for (const [n, g] of gold) {
  const d = E.dimensions(n);
  if (!d || d.width !== g.w || d.height !== g.h) { diff++; if (diff < 4) say(`   x ${n}: runtime ${d && d.width}x${d && d.height}, golden ${g.w}x${g.h}`); continue; }
  if (E.fireImmune(n) !== g.fire) { diff++; if (diff < 4) say(`   x ${n}: fireImmune disagrees`); continue; }
  if (E.trackingRange(n) !== g.track || E.updateInterval(n) !== g.upd) { diff++; if (diff < 4) say(`   x ${n}: networking numbers disagree`); }
}
ok(diff === 0, `${diff} of ${gold.size} rows in the runtime disagree with the golden table`);
// ⚠ THE OTHER DIRECTION. A runtime holding a SUBSET of the table passes the loop above happily.
const extra = E.all().filter((n) => !gold.has(n));
ok(extra.length === 0, `${extra.length} runtime types are not in the golden table: ${extra.slice(0, 5).join(' ')}`);
ok(E.count === gold.size, `the runtime has ${E.count} types and the table has ${gold.size}`);

// ── 3. closed against the game's own registry ───────────────────────────────────────────────
say("\n3. the set is closed against the game's registry dump");
{
  const regFile = join(ROOT, '.mcdata', '1.18.2', '_registries.json');
  if (existsSync(regFile)) {
    const reg = JSON.parse(readFileSync(regFile, 'utf8'))['entity_type'] || [];
    ok(reg.length > 100, `the registry dump lists ${reg.length} entity types`);
    ok(reg.every((n) => E.has(n)), 'every registry entity type is in the runtime');
    ok(E.all().every((n) => reg.indexOf(n) >= 0), 'every runtime type is in the registry');
  } else {
    say('   ⓘ no .mcdata registry dump — this section is unrun (tools/fetch-vanilla-data.mjs)');
  }
}

// ── 4. the anchors ──────────────────────────────────────────────────────────────────────────
// ⚠ THE ONLY NUMBERS TYPED INTO THIS FILE, and each is measurable in the real game by walking
// a mob into a gap. They span the range so a systematic error cannot pass: the widest entity,
// the tallest, one wider than it is tall, and two that are bodiless.
say('\n4. hitboxes a player can measure');
const ANCHOR = {
  zombie: [0.6, 1.95], creeper: [0.6, 1.7], spider: [1.4, 0.9], enderman: [0.6, 2.9],
  ghast: [4, 4], ender_dragon: [16, 8], item: [0.25, 0.25], tnt: [0.98, 0.98],
  arrow: [0.5, 0.5], player: [0.6, 1.8], marker: [0, 0],
};
for (const [n, [w, h]] of Object.entries(ANCHOR)) {
  const d = E.dimensions(n);
  ok(d && d.width === w && d.height === h,
     `${n} should be ${w} x ${h}, runtime says ${d ? d.width + ' x ' + d.height : 'nothing'}`);
}
ok(E.width('spider') > E.height('spider'), 'a spider is wider than it is tall');
ok(E.height('enderman') > E.height('zombie'), 'an enderman is taller than a zombie');
ok(E.fireImmune('blaze') === true, 'a blaze is fire-immune');
ok(E.fireImmune('zombie') === false, 'a zombie is not fire-immune');
ok(E.updateInterval('painting') === E.NEVER, "a painting's update interval is Integer.MAX_VALUE");
ok(E.trackingRange('player') === 32, "the player's client tracking range is 32");

// ── 5. the box arithmetic ───────────────────────────────────────────────────────────────────
// ⚠ FEET AT THE POSITION, FOOTPRINT CENTRED ON IT. Vanilla's
// `EntityDimensions.makeBoundingBox` is `[x - w/2, y, z - w/2] .. [x + w/2, y + h, z + w/2]`.
// Centring vertically too — the other obvious reading — puts every mob half-buried in the floor,
// and it is not a mistake a rule test catches, because both readings are self-consistent.
say('\n5. the bounding box: feet at the position, footprint centred on it');
{
  const b = E.boxAt('zombie', 10, 64, -3);
  ok(Math.abs(b[0] - 9.7) < 1e-9 && Math.abs(b[3] - 10.3) < 1e-9, `x spans ${b[0]}..${b[3]}, expected 9.7..10.3`);
  ok(b[1] === 64, `the box starts at the FEET (y0 ${b[1]}, expected 64)`);
  ok(Math.abs(b[4] - 65.95) < 1e-9, `and reaches y ${b[4]}, expected 65.95`);
  ok(Math.abs(b[2] + 3.3) < 1e-9 && Math.abs(b[5] + 2.7) < 1e-9, `z spans ${b[2]}..${b[5]}, expected -3.3..-2.7`);
  const m = E.boxAt('marker', 0, 0, 0);
  ok(m[0] === 0 && m[3] === 0 && m[4] === 0, 'a bodiless type gets a degenerate box, not a default one');
}

// ── 6. no silent defaults ───────────────────────────────────────────────────────────────────
// ⚠ D-298's `|| 'NORMAL'` swallowed 584 unresolved rows into a plausible table. An unknown id
// here is an ERROR and says so; it is not "probably a 0.6 x 1.8 entity".
say('\n6. an unknown id is an error, not a default');
ok(E.dimensions('minecraft:zombi') === null, 'a misspelt id returns null, not a default box');
ok(E.boxAt('not_an_entity', 0, 0, 0) === null, 'and boxAt refuses it too');
ok(E.fireImmune('not_an_entity') === null, 'and so does fireImmune');
ok(E.has('minecraft:zombie') === true, 'a namespaced id resolves');
ok(E.has('zombie') === true, 'and so does a bare one');

// ── 7. anti-vacuity ─────────────────────────────────────────────────────────────────────────
say('\n7. break it, and it must be caught');
{
  const real = E.types.zombie.slice();
  // a wrong width must fail §2 and §4
  E.types.zombie[0] = 0.9;
  okAv(E.dimensions('zombie').width !== gold.get('zombie').w
       && E.width('zombie') !== ANCHOR.zombie[0], 'a zombie widened to 0.9 read as correct');
  E.types.zombie = real;
  okAv(E.width('zombie') === 0.6, '...and it reads 0.6 again when it is put back');

  // a MISSING row must fail §2's count and §3's closure
  const keep = E.types.spider;
  delete E.types.spider;
  E.init();
  okAv(E.count !== gold.size && !E.has('spider'), 'a deleted row left the count unchanged');
  E.types.spider = keep;
  E.init();
  okAv(E.count === gold.size, '...and the count comes back');

  // an EXTRA row must fail the other direction of §2
  E.types.zombie_but_taller = [0.6, 9, 0, 8, -1];
  E.init();
  okAv(E.all().filter((n) => !gold.has(n)).length === 1, 'an invented type passed the reverse check');
  delete E.types.zombie_but_taller;
  E.init();

  // the box arithmetic: prove the check can tell the two readings apart
  const b = E.boxAt('zombie', 0, 64, 0);
  const centredVertically = [b[0], 64 - 1.95 / 2, b[2], b[3], 64 + 1.95 / 2, b[5]];
  okAv(b[1] !== centredVertically[1],
       'a box centred vertically on the position read the same as one standing on it');
}

say('');
say('================ entitycheck ==============');
say(` entity types ....... ${E.count}`);
say(` fire-immune ........ ${E.all().filter((n) => E.fireImmune(n)).length}`);
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
for (const f of fails) say('   ✗ ' + f);
say(` breaks caught ...... ${breaks}`);
say('==========================================');
process.exit(fails.length ? 1 : 0);
