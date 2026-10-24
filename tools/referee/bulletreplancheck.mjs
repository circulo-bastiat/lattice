#!/usr/bin/env node
// bulletreplancheck.mjs — #9444 (owed part of #7061): the shulker bullet's waypoint REPLANNING (Sh.replanBullet = ShulkerBulletEntity.method_7486
// selectNextMoveDirection: axis exclusion, candidate directions, the random fallback, TXD/TYD/TZD aim vector, `10 + nextInt(5) * 10` Steps, plus the
// stepCount countdown and the blocked/aligned re-plans) against the REAL 1.18.2 server, salts 0..19, Steps > 0.
//   node tools/referee/runbullet.mjs --replan   # once (~45 s)
// The server's bullet RNG cannot be seeded, so the draws are not compared: at every replan the engine is fed the draws that make it choose the
// server's Dir and Steps (oracle: it tries each direction/pick the rule allows); a Dir the engine's rule cannot produce is a divergence. Everything
// else is compared per tick with the old tolerance (2e-4): Pos, Motion, Steps, Dir, TXD/TYD/TZD, alive. No golden -> SKIP (self-compare breaks only).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T, FIELDS, origin } from './bulletreplanscen.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'shulker-bullet-replan.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'shulker-bullet-replan.json')].find((f) => existsSync(f));
const golden = !GOLDEN ? null : JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07q_effects.js', '07zzk_shulker.js'];
const TOL = 2;
const SC = Object.fromEntries(FIELDS.map(([f, , s]) => [f, s]));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function goldenRel(sc, i) {
  const o = origin(i), g = golden.cases[sc.id].probes, base = { x: o.x, y: o.y, z: o.z };
  const out = {};
  for (const k of Object.keys(g)) out[k] = g[k].slice();
  for (const f of ['x', 'y', 'z']) out[f] = g[f].map((v) => v - base[f] * SC[f]);
  return out;
}

// hook(M) may break the engine rule (anti-vacuity); `g` is the server trace the oracle follows (null: self-compare, engine picks)
function runEngine(sc, g, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init(); M.EntityList.init();
  if (M.Combat && M.Combat.init) M.Combat.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, S = M.States, Sh = M.Shulker;
  W.init(1);
  for (let cx = -2; cx <= 4; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const STONE = S.stateOf('stone') | 0;
  for (let x = -12; x <= 40; x++) for (let z = -12; z <= 12; z++) W.setBlock(x, -1, z, STONE);
  if (hook) hook(M);
  const orig = Sh.replanBullet, stats = { replans: 0, missed: 0, dirs: new Set() };
  let idx = 0, callNo = 0, force = null;   // server-log index of the sample the running tick ends in
  Sh.replanBullet = function (e, axis) {
    if (idx === 0) return orig.call(Sh, e, axis);   // EL.spawn's own initial plan; the scenario state is set right after
    const first = callNo++ === 0;
    stats.replans++;
    if (!g || idx >= T) return orig.call(Sh, e, axis);
    const wantDir = g.hasdir[idx] ? g.dir[idx] : null, sr = (((g.steps[idx] - 10) / 10) + 0.5) / 5;
    const snap = { d: e.bulletDir, x: e.bulletStepX, y: e.bulletStepY, z: e.bulletStepZ, s: e.bulletSteps };
    const old = EL.random;
    const attempt = (j, last) => {   // every draw but the last is `(j+.5)/6`; the last (Steps) is the server's
      e.bulletDir = snap.d; e.bulletStepX = snap.x; e.bulletStepY = snap.y; e.bulletStepZ = snap.z; e.bulletSteps = snap.s;
      let n = 0;
      EL.random = () => (++n === last ? sr : (j + 0.5) / 6);
      orig.call(Sh, e, axis);
      return n;
    };
    let hit = false;
    if (first && force !== null) { const n = attempt(force, 1e9); attempt(force, n); EL.random = old; return; }   // an earlier call of a double replan: the lookahead picks its direction
    for (let j = 0; j < 6 && !hit; j++) {
      const n = attempt(j, 1e9);
      attempt(j, n);
      hit = (e.bulletDir === undefined ? null : e.bulletDir) === wantDir;
      if (hit) stats.dirs.add(wantDir);
      if (wantDir === null) break;
    }
    EL.random = old;
    if (!hit) { stats.missed++; }
  };
  const out = { alive: [], hasdir: [] };
  for (const [f] of FIELDS) out[f] = [];
  let e = null, pig = null;
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      pig = EL.spawn('pig', sc.pig[0], sc.pig[1], sc.pig[2], {});
      Object.defineProperty(pig, 'y', { get: () => sc.pig[1], set() {} });   // the server pig is NoGravity: pinned, even inside the tick
      Object.defineProperty(pig, 'pendingFallDamage', { get: () => 0, set() {} });   // NoGravity: no fall damage either
      pig.noAI = true; pig.noAi = true; pig.noGravity = true; pig.health = pig.maxHealth = 100;
      e = EL.spawn('shulker_bullet', sc.pos[0], sc.pos[1], sc.pos[2], { vx: 0, vy: 0, vz: 0, target: pig });
      e.bulletDir = sc.dir; e.bulletSteps = sc.steps;
      [e.bulletStepX, e.bulletStepY, e.bulletStepZ] = sc.step;
    }
    const alive = !e.removed && EL.list.includes(e);
    out.alive.push(alive ? 1 : 0);
    const dir = e.bulletDir === undefined ? null : e.bulletDir;
    const vals = { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, steps: e.bulletSteps, dir: dir === null ? 0 : dir, txd: e.bulletStepX, tyd: e.bulletStepY, tzd: e.bulletStepZ };
    for (const [f] of FIELDS) out[f].push(alive ? Math.floor(vals[f] * SC[f]) : 0);
    out.hasdir.push(alive && dir !== null ? 1 : 0);
    idx = k;
    const keys = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'bulletDir', 'bulletStepX', 'bulletStepY', 'bulletStepZ', 'bulletSteps', 'age', 'removed', 'yaw', 'pitch'];
    const snap = Object.fromEntries(keys.map((q) => [q, e[q]])), st0 = { r: stats.replans, m: stats.missed };
    const reaches = () => !g || k >= T || e.removed || stats.missed === st0.m && ((e.bulletDir === undefined ? null : e.bulletDir) === (g.hasdir[k] ? g.dir[k] : null) && e.bulletSteps === g.steps[k]);
    // a tick can replan twice (countdown, then blocked/aligned on the fresh Dir): when the oracle cannot satisfy the last call, try each first-call direction
    for (const f of [null, 0, 1, 2, 3, 4, 5]) {
      force = f; callNo = 0; stats.replans = st0.r; stats.missed = st0.m;
      EL.tick();
      if (reaches() || f === 5) break;
      Object.assign(e, snap); if (EL.list.indexOf(e) < 0) EL.list.push(e);
    }
    force = null;
  }
  Sh.replanBullet = orig;
  out.stats = stats;
  return out;
}

function compare(id, g, e) {
  const bad = [];
  for (const key of ['alive', 'hasdir']) {
    const a = g[key], b = e[key] || [];
    const i = a.findIndex((v, k) => v !== b[k] && (key === 'alive' || (g.alive[k] && e.alive[k])));
    if (i >= 0) bad.push(`${id}.${key}: first differs at tick ${i}: server ${a.slice(Math.max(0, i - 2), i + 6).join('')} | engine ${b.slice(Math.max(0, i - 2), i + 6).join('')}`);
  }
  for (const [f] of FIELDS) {
    const a = g[f], b = e[f] || [], tol = SC[f] === 1 ? 0 : TOL;
    for (let k = 0; k < a.length; k++) {
      if (!g.alive[k] || !e.alive[k]) continue;
      if (f === 'dir' && !g.hasdir[k]) continue;
      if (Math.abs(a[k] - b[k]) > tol) {
        const from = Math.max(0, k - 2);
        bad.push(`${id}.${f}: first differs at tick ${k}: server ${a.slice(from, k + 5).join(' ')} | engine ${b.slice(from, k + 5).join(' ')}`);
        break;
      }
    }
  }
  if (e.stats && e.stats.missed) bad.push(`${id}: ${e.stats.missed}/${e.stats.replans} replans could not produce the server's Dir/Steps with any draw`);
  return bad;
}

if (!golden) {
  const sc = SCENARIOS[0], e0 = runEngine(sc, null);
  const nb = (c, m) => { if (!c) { console.log('bulletreplancheck: FAIL anti-vacuity: ' + m); process.exit(1); } breaks++; console.log('   ✓ break caught: ' + m); };
  nb(compare(sc.id, { ...e0, steps: e0.steps.map((v) => v + 1) }, e0).length > 0, 'steps off by one is a mismatch');
  nb(compare(sc.id, e0, { ...e0, txd: e0.txd.map((v) => v + 9) }).length > 0, 'TXD drift is a mismatch');
  console.log('bulletreplancheck: SKIP server comparison (golden not generated -- run node tools/referee/runbullet.mjs --replan)');
  console.log(`bulletreplancheck: ${breaks} breaks caught`);
  process.exit(0);
}
console.log(`bulletreplancheck — shulker bullet replanning vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runbullet.mjs --replan)`);
const G = {};
let replans = 0;
SCENARIOS.forEach((sc, i) => {
  if (!ok(!!golden.cases[sc.id], `${sc.id}: in the golden`)) return;
  const g = G[sc.id] = goldenRel(sc, i);
  ok(g.steps.some((v, k) => k && v > g.steps[k - 1]), `${sc.id}: the server's bullet replanned (Steps rose)`);
  let eng;
  try { eng = runEngine(sc, g); } catch (err) { ok(false, `${sc.id}: engine threw ${err.stack}`); return; }
  replans += eng.stats.replans;
  const bad = compare(sc.id, g, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
});
console.log(`bulletreplancheck: ${replans} engine replans followed`);

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const any = (hook, scs = SCENARIOS.map((s, i) => i)) => scs.some((i) => G[SCENARIOS[i].id] && compare(SCENARIOS[i].id, G[SCENARIOS[i].id], runEngine(SCENARIOS[i], G[SCENARIOS[i].id], hook)).length > 0);
{
  const s0 = SCENARIOS[1], g = G[s0.id], e = runEngine(s0, g);
  breakCaught('golden Steps shifted one tick is a mismatch', compare(s0.id, { ...g, steps: [g.steps[0], ...g.steps.slice(0, -1)] }, e).length > 0);
  breakCaught('aim step length 0.2 instead of 0.15 is a mismatch', any((M) => { M.Shulker.BULLET_STEP_LEN = 0.2; }));
  breakCaught('east/west mirrored (wrong candidate direction) is a mismatch', any((M) => { const S = M.Shulker; [S.DX[4], S.DX[5]] = [1, -1]; }));
  breakCaught('replan ignoring the excluded axis is a mismatch', any((M) => { M.Shulker.attachAxis = () => undefined; }));
}
console.log(`bulletreplancheck: ${SCENARIOS.length} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ bulletreplancheck (#9444) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`bulletreplancheck: ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
