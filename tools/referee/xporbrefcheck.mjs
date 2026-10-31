#!/usr/bin/env node
// xporbrefcheck.mjs — #6086: XP ORB pull / merge / pickup vs the real 1.18.2 server (golden: runxporb.mjs, xp-orb.json).
// Scenes (xporbscen.mjs): a player 4 blocks away standing / creative / walking away, two orbs side by side, ten orbs of 3, a far player.
// Per tick: orb count, the first orb's merged Count, its position (within 2e-4 block, while alive on both sides), and the player's
// XpTotal (exact, incl. the pickup tick). Anti-vacuity (D-30): pull radius 7, merge box off, a wrong orb-size table each fail.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENES, T, SCALE, origin } from './xporbscen.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'xp-orb.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'xp-orb.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('xporbrefcheck: SKIP (golden not generated -- run node tools/referee/runxporb.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js',
  '14j_combat.js', '14d_survival.js', '14l_use.js', '07zzd_throw.js', '07zz_xporb.js'];
const TOL = 2;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function runEngine(sc, k, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init(); M.EntityList.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  M.Xp.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, Xp = M.Xp;
  W.init(1);
  for (let cx = -2; cx <= 4; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const STONE = M.States.stateOf('stone') | 0;
  for (let x = -8; x <= 72; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, STONE);
  const P = { x: sc.px, y: 0, z: 0.5, width: 0.6, height: 1.8, eyeHeight: 1.62, health: 20, mode: sc.mode === 'creative' ? 1 : 0, xpTotal: 0, xpLevel: 0, xpProgress: 0 };
  M.Player = P;
  if (hook) hook(M);
  const out = { n: [], cnt: [], x: [], y: [], z: [], xp: [] };
  let first = null;
  for (let t = 1; t <= T; t++) {
    if (t === 1) {
      for (const o of sc.orbs) {
        const e = EL.spawn('experience_orb', o.pos[0], o.pos[1], o.pos[2], { vx: 0, vy: 0, vz: 0 });
        e.value = o.value; e.pickingCount = 1; e.orbAge = 0;
        first = first || e;
      }
    }
    const live = EL.list.filter((e) => e.type === 'experience_orb' && !e.removed);
    const f = live[0] || first;
    out.n.push(live.length); out.cnt.push(live.length ? (f.pickingCount || 1) : 0);
    out.x.push(Math.floor(f.x * SCALE)); out.y.push(Math.floor(f.y * SCALE)); out.z.push(Math.floor(f.z * SCALE));
    out.xp.push(P.xpTotal | 0);
    if (sc.step) P.x += sc.step;
    EL.tick();
    Xp.pickupTick();
  }
  return out;
}

function compare(id, k, g, e) {   // XpTotal is compared as the gain since tick 0 (the bot persists in the server world)
  const bad = [];
  const rel = (a) => a.map((v) => v - a[0]);
  g = { ...g, xp: rel(g.xp) };
  for (const key of ['n', 'cnt', 'xp']) {
    const i = g[key].findIndex((v, t) => v !== e[key][t]);
    if (i >= 0) bad.push(`${id}.${key}: first differs at tick ${i}: server ${g[key].slice(Math.max(0, i - 2), i + 4).join(' ')} | engine ${e[key].slice(Math.max(0, i - 2), i + 4).join(' ')}`);
  }
  for (const a of ['x', 'y', 'z']) {
    const base = origin(k)[a] * SCALE;
    for (let t = 0; t < T; t++) {
      if (!g.n[t] || !e.n[t]) continue;
      if (Math.abs(g[a][t] - base - e[a][t]) > TOL) { bad.push(`${id}.${a}: first differs at tick ${t}: server ${g[a][t] - base} | engine ${e[a][t]} (x1e-4)`); break; }
    }
  }
  return bad;
}

console.log(`xporbrefcheck — xp orb pull/merge/pickup vs the real 1.18.2 server (${SCENES.length} scenes, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = ${T} (regenerate: node tools/referee/runxporb.mjs)`);
const G = {};
SCENES.forEach((sc, k) => {
  if (!ok(!!golden.cases[sc.id], `${sc.id}: in the golden`)) return;
  G[sc.id] = golden.cases[sc.id].probes;
  try { for (const b of compare(sc.id, k, G[sc.id], runEngine(sc, k))) ok(false, b); } catch (err) { ok(false, `${sc.id}: engine threw ${err.stack}`); }
});
ok(G.stand && G.stand.xp[T - 1] - G.stand.xp[0] === 3 && G.ten_by_3.xp[T - 1] - G.ten_by_3.xp[0] === 30, 'the server really paid 3 (one orb) and 30 (ten orbs)');
// roundToOrbSize (.decomp ExperienceOrbEntity.java:278): the size table, parsed out of the decompiled source
{
  const src = readFileSync(join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'entity', 'ExperienceOrbEntity.java'), 'utf8');
  const body = src.slice(src.indexOf('public static int roundToOrbSize'));
  const steps = [...body.slice(0, body.indexOf('}\n    }') > 0 ? body.indexOf('return 1;') : 600).matchAll(/>= (\d+)\) \{\s*return (\d+);/g)].map((m) => [+m[1], +m[2]]);
  const vanilla = (v) => { for (const [lim, size] of steps) if (v >= lim) return size; return v >= 3 ? 3 : 1; };   // the final `else { return $$0 >= 3 ? 3 : 1; }`
  ok(steps.length === 9, `parsed ${steps.length} roundToOrbSize steps from .decomp`);
  const sizeBad = (Xp) => { let n = 0; for (let v = 1; v <= 3000; v++) if (Xp.roundToOrbSize(v) !== vanilla(v)) n++; return n; };
  const M = loadEngine({ extra: EXTRA, dom: false });
  ok(sizeBad(M.Xp) === 0, `Xp.roundToOrbSize matches vanilla for 1..3000 (${sizeBad(M.Xp)} differ)`);
  breaks++;
  const real = M.Xp.roundToOrbSize;
  M.Xp.roundToOrbSize = (v) => (v >= 8 && v < 17 ? 3 : real(v));
  if (sizeBad(M.Xp) > 0) { pass++; console.log('   ✓ break caught: a wrong orb size table (8..16 -> 3)'); } else fails.push('anti-vacuity: wrong size table');
}
const caught = (m, id, hook) => {
  breaks++;
  const k = SCENES.findIndex((s) => s.id === id);
  let bad = true;
  try { bad = compare(id, k, G[id], runEngine(SCENES[k], k, hook)).length > 0; } catch (e) { bad = true; }
  if (bad) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m);
};
caught('pull radius 3 instead of 8 (the player 4.3 away is no longer pulled)', 'stand', (M) => { M.Xp.FOLLOW_RANGE_SQ = 9; M.Xp.FOLLOW_RANGE = 3; });
caught('pull radius 7 (the far scene, player 40 away, stays put either way; stand: 4.3 away still pulled -> radius 4)', 'stand', (M) => { M.Xp.FOLLOW_RANGE_SQ = 16; M.Xp.FOLLOW_RANGE = 4; });
caught('merge box off (merge41: orb 1 and 41 fold together)', 'merge41', (M) => { M.Xp.mergeNear = () => 0; M.Xp.MERGE_BOX = 0; });
caught('pull force doubled', 'stand', (M) => { const t = M.Xp.pull; M.Xp.pull = (e) => { t(e); t(e); }; });
console.log(`xporbrefcheck: ${SCENES.length} scenes, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 40)) console.log('  ✗ ' + f);
console.log('\n================ xporbrefcheck (#6086) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
console.log(`xporbrefcheck: ${pass} assertions, ${fails.length} failures, ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
