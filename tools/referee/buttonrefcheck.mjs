#!/usr/bin/env node
// buttonrefcheck.mjs — infra I6 (24 Sept 2026): BUTTONS and ARROW PRESSES, the engine against the REAL 1.18.2
// server.
//
//   node tools/referee/runbutton.mjs          # once per machine/store (~15 s, the real server)
//   node tools/referee/buttonrefcheck.mjs [--verbose]
//
// Each scenario of buttonscen.mjs runs in the engine in a real World: a `press` scenario calls `Use.blockUse`
// directly (the engine's own player-press entry point -- no faking needed on THIS side, only the real server's
// runbutton.mjs fakes its press, D-Button-1) and lets `Behave.tick` carry the scheduled unpress; an `arrow`
// scenario spawns a real `minecraft:arrow` through `EntityList.spawn` on the engine's own clock. The button's
// (or plate's) `powered` AND its downstream lamp's `lit` must equal the server's EXACTLY.
// Anti-vacuity (D-30/D-305): a golden series shifted one tick, a stone button that releases like a wooden one
// (20 ticks instead of honouring a still-present arrow), and a lamp that never receives the signal must each be
// caught; every scenario's golden must move at least once.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T } from './buttonscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'button-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'button-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('buttonrefcheck: SKIP (golden not generated -- run node tools/referee/runbutton.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js',
               '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js'];

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function runEngine(sc) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init();
  M.EntityList.init();
  if (M.Combat && M.Combat.init) M.Combat.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, S = M.States;
  W.init(1);
  for (let cx = -2; cx <= 4; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const STONE = S.stateOf('stone') | 0;
  const LAMP = S.stateOf('redstone_lamp') | 0;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, STONE);
  const w = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st) };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.Redstone.init();
  M.Use.init(w);
  if (!M.Use.ready) throw new Error('Use.init did not reach ready (tags missing?): ' + JSON.stringify(M.Use.tagFamilies));
  const B = M.Behave;

  let held; // { x, y, z } of the button/plate under test
  if (sc.plate) {
    const st = S.stateOf(sc.plate) | 0;
    W.setBlock(0, 0, 0, st); B.changed(0, 0, 0);
    held = { x: 0, y: 0, z: 0 };
  } else {
    W.setBlock(0, 0, 1, STONE); B.changed(0, 0, 1);          // the wall it's mounted on
    let st = S.stateOf(sc.block) | 0;
    st = B.setProp(st, 'facing', sc.facing);
    st = B.setProp(st, 'face', sc.face);
    st = B.setProp(st, 'powered', false);
    W.setBlock(0, 0, 0, st); B.changed(0, 0, 0);
    held = { x: 0, y: 0, z: 0 };
  }
  W.setBlock(0, 0, -1, LAMP); B.changed(0, 0, -1);
  for (let i = 0; i < 20; i++) { B.tick(); M.BlockEntities.tick(); EL.tick(); }

  const out = { button: [], lamp: [] };
  const live = {};
  for (let k = 1; k <= T; k++) {
    for (const t of sc.press || []) {
      if (t !== k) continue;
      // the engine's OWN press entry point -- `Use.blockUse`'s own "already POWERED -> no-op"
      // guard (14l_use.js:344) is what has to reproduce D-Button-1's no-reset case, not us.
      const st = W.getBlock(held.x, held.y, held.z);
      M.Use.blockUse(null, held.x, held.y, held.z, st, null);
    }
    for (const [t, tag] of sc.holdcheckKills || []) { /* unused: kills below cover it */ }
    for (const a of sc.arrows || []) {
      if (a.t !== k) continue;
      const e = EL.spawn('arrow', a.x, a.y, a.z, { vx: a.vx, vy: a.vy, vz: a.vz });
      if (!e) throw new Error(`EntityList.spawn('arrow') returned null`);
      live[a.tag] = e;
    }
    for (const [t, tag] of sc.kills || []) if (t === k && live[tag]) live[tag].removed = true;
    const bst = W.getBlock(held.x, held.y, held.z);
    const powered = sc.plate
      ? (B.propName(bst, 'powered') === 'true' ? 1 : (parseInt(B.propName(bst, 'power'), 10) > 0 ? 1 : 0))
      : (B.propName(bst, 'powered') === 'true' ? 1 : 0);
    out.button.push(powered);
    const lst = W.getBlock(0, 0, -1);
    out.lamp.push(M.Behave.propName(lst, 'lit') === 'true' ? 1 : 0);
    B.tick(); M.BlockEntities.tick(); EL.tick();
  }
  return out;
}

function compare(id, g, e) {
  const out = [];
  for (const label of ['button', 'lamp']) {
    const a = g[label], b = e[label] || [];
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0) out.push(`${id}.${label}: first differs at tick ${i}:\n        server ${a.join('')}\n        engine ${b.join('')}`);
  }
  return out;
}

console.log(`buttonrefcheck — buttons and arrow presses vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runbutton.mjs)`);
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id] && golden.cases[sc.id].probes;
  if (!ok(!!g, `${sc.id}: in the golden (regenerate: node tools/referee/runbutton.mjs)`)) continue;
  if (!sc.stat) ok(g.button.some((v) => v !== 0), `${sc.id}: the server's button/plate went down at least once`);
  let eng;
  try { eng = runEngine(sc); } catch (err) { ok(false, `${sc.id}: engine threw ${err.message}`); continue; }
  const bad = compare(sc.id, g, eng);
  for (const x of bad) ok(false, x);
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) console.log(`  ${sc.id}: server ${g.button.join('')} / engine ${(eng.button || []).join('')}`);
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const gp = (id) => golden.cases[id].probes;
{
  const g = gp('stone_button_press');
  const sh = { button: [0, ...g.button.slice(0, -1)], lamp: g.lamp };
  breakCaught('stone_button_press golden shifted one tick is a mismatch', compare('stone_button_press', sh, { button: g.button, lamp: g.lamp }).length > 0);
}
{
  // the divergence D-Button-2 exists to catch: a wooden button that releases at a flat 20 ticks
  // (ignoring the still-present arrow) instead of honouring the hold through tick 64.
  const g = gp('wooden_button_arrow_stuck');
  const flat20 = { button: g.button.map((v, k) => (k >= 27 ? 0 : v)), lamp: g.lamp };  // press~tick8 + 20 -> off at 28
  breakCaught('a wooden button that ignores a lodged arrow and releases at 20 ticks is a mismatch', compare('wooden_button_arrow_stuck', g, flat20).length > 0);
}
{
  const g = gp('oak_plate_arrow');
  const never = { button: g.button.map(() => 0), lamp: g.lamp.map(() => 0) };
  breakCaught('a wooden plate that never senses the arrow at all is a mismatch', compare('oak_plate_arrow', g, never).length > 0);
}

console.log(`buttonrefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 80)) console.log('  ✗ ' + f);
console.log('');
console.log('================ buttonrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
