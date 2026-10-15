#!/usr/bin/env node
// bulletrefcheck.mjs — #6079: the shulker bullet's homing flight (Sh.tickBullet) against the REAL 1.18.2 server.
//   node tools/referee/runbullet.mjs   # once (~15 s)
// x/y/z and vx/vy/vz within 2e-4 every tick both sides are alive; the alive bit (the hit tick) and the target's
// Levitation bit (hit applied) must match exactly. Anti-vacuity: wrong blend factor, wrong speed, one-tick shift. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T, SCALE, FIELDS, origin } from './bulletscen.mjs';


const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'shulker-bullet.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'shulker-bullet.json')].find((f) => existsSync(f));
const golden = !GOLDEN ? null : JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07q_effects.js', '07zzk_shulker.js'];
const TOL = 2;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function goldenRel(sc, i) {
  const o = origin(i), g = golden.cases[sc.id].probes, base = { x: o.x, y: o.y, z: o.z };
  const out = { alive: g.alive.slice(), lev: g.lev.slice() };
  for (const [f] of FIELDS) out[f] = g[f].map((v) => (base[f] !== undefined ? v - base[f] * SCALE : v));
  return out;
}

function runEngine(sc, hook) {
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
  for (let x = -8; x <= 72; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, STONE);
  if (hook) hook(M);
  const out = { alive: [], lev: [] };
  for (const [f] of FIELDS) out[f] = [];
  let e = null, pig = null;
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      pig = EL.spawn('pig', sc.pig[0], sc.pig[1], sc.pig[2], {});
      pig.noAI = true; pig.noAi = true; pig.noGravity = true; pig.health = pig.maxHealth = 100;
      e = EL.spawn('shulker_bullet', sc.pos[0], sc.pos[1], sc.pos[2], { vx: 0, vy: 0, vz: 0, target: pig });
      e.bulletDir = null; e.bulletSteps = 0;   // the server scenario: Steps:0, no Dir -> never replans
      [e.bulletStepX, e.bulletStepY, e.bulletStepZ] = sc.step;
    }
    if (sc.tpAt === k) { pig.x = sc.tpTo[0]; pig.y = sc.tpTo[1]; pig.z = sc.tpTo[2]; }
    pig.y = sc.tpAt && k >= sc.tpAt ? sc.tpTo[1] : sc.pig[1]; pig.vy = 0;   // the server pig is NoGravity
    const alive = !e.removed && EL.list.includes(e);
    out.alive.push(alive ? 1 : 0);
    const vals = { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz };
    for (const [f] of FIELDS) out[f].push(alive ? Math.floor(vals[f] * SCALE) : 0);
    out.lev.push(M.Effects && M.Effects.hasStatusEffect && M.Effects.hasStatusEffect(pig, 'levitation') ? 1 : 0);
    EL.tick();
  }
  return out;
}

function compare(id, g, e) {
  const bad = [];
  for (const key of ['alive', 'lev']) {
    const a = g[key], b = e[key] || [];
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0) bad.push(`${id}.${key}: first differs at tick ${i}: server ${a.join('')} | engine ${b.join('')}`);
  }
  for (const [f] of FIELDS) {
    const a = g[f], b = e[f] || [];
    for (let k = 0; k < a.length; k++) {
      if (!g.alive[k] || !e.alive[k]) continue;
      if (Math.abs(a[k] - b[k]) > TOL) {
        const from = Math.max(0, k - 2);
        bad.push(`${id}.${f}: first differs at tick ${k}: server ${a.slice(from, k + 5).join(' ')} | engine ${b.slice(from, k + 5).join(' ')} (x1e-4)`);
        break;
      }
    }
  }
  return bad;
}

if (!golden) {
  // No server golden here: still prove compare() can fail, against the engine's own trace (D-30).
  const sc = SCENARIOS[0], e0 = runEngine(sc);
  const nb = (c, m) => { if (!c) { console.log('bulletrefcheck: FAIL anti-vacuity: ' + m); process.exit(1); } breaks++; console.log('   ✓ break caught: ' + m); };
  nb(compare(sc.id, e0, e0).length === 0, 'self-compare must be clean');
  breaks--;
  nb(compare(sc.id, { ...e0, x: [e0.x[0], ...e0.x.slice(0, -1)] }, e0).length > 0, 'x shifted one tick is a mismatch');
  nb(compare(sc.id, { ...e0, vy: e0.vy.map((v) => v + 3) }, e0).length > 0, 'vy drift beyond tolerance is a mismatch');
  nb(compare(sc.id, { ...e0, alive: Array(T).fill(1) }, e0).length > 0 || e0.alive.every((v) => v === 1), 'alive bit flipped is a mismatch');
  nb(compare(sc.id, e0, runEngine(sc, (M) => { M.Shulker.BULLET_BLEND = 0.3; })).length > 0, 'blend factor 0.3 is a mismatch');
  console.log('bulletrefcheck: SKIP server comparison (golden not generated -- run node tools/referee/runbullet.mjs)');
  console.log('\n================ bulletrefcheck (#6079) ================');   // the suite's summary line is parsed from this block; the lander reads "<n> breaks caught" from it
  console.log(` assertions passed .. ${breaks}`);
  console.log(' failures ........... 0');
  console.log(`bulletrefcheck: ${breaks} breaks caught`);
  process.exit(0);
}
console.log(`bulletrefcheck — shulker bullet flight vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runbullet.mjs)`);
const G = {};
SCENARIOS.forEach((sc, i) => {
  if (!ok(!!golden.cases[sc.id], `${sc.id}: in the golden`)) return;
  const g = G[sc.id] = goldenRel(sc, i);
  ok(g.x.some((v) => v !== g.x[0]), `${sc.id}: the server's bullet moved`);
  let eng;
  try { eng = runEngine(sc); } catch (err) { ok(false, `${sc.id}: engine threw ${err.message}`); return; }
  const bad = compare(sc.id, g, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  if (VERBOSE) console.log(`   ${sc.id}.x\n     S ${g.x.slice(0, 12).join(' ')}\n     E ${eng.x.slice(0, 12).join(' ')}`);
});
ok(G.bullet_still && G.bullet_still.alive.includes(0) && G.bullet_still.lev.includes(1), 'bullet_still: the server bullet hit (removed) and the target got Levitation');

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sc = SCENARIOS[0], g = G[sc.id];
  breakCaught('golden `x` shifted one tick is a mismatch', compare(sc.id, { ...g, x: [g.x[0], ...g.x.slice(0, -1)] }, runEngine(sc)).length > 0);
  breakCaught('blend factor 0.3 instead of 0.2 is a mismatch', compare(sc.id, g, runEngine(sc, (M) => { M.Shulker.BULLET_BLEND = 0.3; })).length > 0);
  breakCaught('step length 0.2 instead of 0.15 is a mismatch', compare(sc.id, g, runEngine(sc, (M) => { M.Shulker.BULLET_STEP_GROWTH = 1.05; })).length > 0);
  breakCaught('a bullet that never hits (alive bit) is a mismatch', compare(sc.id, g, { ...runEngine(sc), alive: Array(T).fill(1) }).length > 0);
}
console.log(`bulletrefcheck: ${SCENARIOS.length} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ bulletrefcheck (#6079) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`bulletrefcheck: ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
