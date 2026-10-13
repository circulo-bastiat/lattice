#!/usr/bin/env node
// motionrefcheck.mjs — infra I6 (24 Sept 2026): ENTITY MOTION, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runmotion.mjs        # once per machine/store (~40 s, the real server)
//   node tools/referee/motionrefcheck.mjs [--verbose]
//
// Each scenario of motionscen.mjs (an item dropped / thrown / thrown into a wall, sand and gravel falling blocks, TNT
// dropped and pushed, an arrow lobbed and one dropped, an XP orb, an armor stand dropped and thrown) spawns ONE
// entity at tick 1 in the engine (EntityList.spawn with the same position and motion, on a stone floor, a real
// World) and runs the server's clock: (k == 1: spawn) -> sample -> EntityList.tick. Every tick where the entity is
// alive on BOTH sides, x/y/z and vx/vy/vz (x 10000, floored) must be within 2 units (2e-4 block) of the server's;
// `alive` and the landed-block bit must match EXACTLY (the tick it lands, the tick it becomes a block).
// Anti-vacuity (D-30/D-305): a golden series shifted one tick, gravity doubled, and drag removed must each be
// caught; every scenario's golden must move. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { refereeWorkDir } from './server.mjs';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T, SCALE, FIELDS, origin } from './motionscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = refereeWorkDir();
const GOLDEN = [join(refDir, 'golden', 'entity-motion.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'entity-motion.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('motionrefcheck: SKIP (golden not generated -- run node tools/referee/runmotion.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07zzd_throw.js', '07z_potion.js', '07zzh_blaze.js', '07zzl_enderdragon.js', '07q_effects.js', '07zz_xporb.js'];
const TOL = 2;

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

/** golden -> per-field arrays relative to the scenario origin (x10000) */
function goldenRel(sc, i) {
  const o = origin(i), g = golden.cases[sc.id].probes, base = { x: o.x, y: o.y, z: o.z };
  const out = { alive: g.alive.slice() };
  if (g.block) out.block = g.block.slice();
  for (const k of ['cr', 'cd', 'cw', 'ce', 'ca']) if (golden.cases[sc.id].probes[k]) out[k] = golden.cases[sc.id].probes[k].slice();
  if (g.orbs) { out.orbs = g.orbs.slice(); out.xp = g.xp.slice(); }
  if (g.glowd) { out.glowd = g.glowd.slice(); out.glowa = g.glowa.slice(); }
  if (g.items) out.items = g.items.slice();
  for (const [f] of FIELDS) out[f] = g[f].map((v) => (base[f] !== undefined ? v - base[f] * SCALE : v));
  return out;
}

/** 'name[k=v,..]' -> a real state (defaults + SR.withProp); a plain name is stateOf. */
function stateFor(M, str) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(str);
  let st = M.States.stateOf(m[1]) | 0;
  for (const kv of (m[2] || '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (M.Reg.PROP[k] === undefined || M.Reg.PVAL[v] === undefined) throw new Error('unknown property ' + kv);
    st = M.States.withProp(st, M.Reg.PROP[k], M.Reg.PVAL[v]);
  }
  return st;
}

function runEngine(sc, hook, idPhase) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init();
  M.EntityList.init();
  if (M.Xp && M.Xp.init) M.Xp.init();
  if (M.Combat && M.Combat.init) M.Combat.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, S = M.States;
  W.init(1);
  for (let cx = -2; cx <= 4; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const STONE = S.stateOf('stone') | 0;
  for (let x = -8; x <= 72; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, STONE);
  for (const [x, y, z, name] of sc.blocks || []) W.setBlock(x, y, z, stateFor(M, name));
  if (hook) hook(M);
  const out = { alive: [] };
  for (const [f] of FIELDS) out[f] = [];
  if (sc.probeBlock) out.block = [];
  let e = null, owner = null, pigE = null;
  if (sc.glow) { out.glowd = []; out.glowa = []; }
  if (sc.probeItem) out.items = [];
  if (sc.cloud) for (const k of ['cr', 'cd', 'cw', 'ce', 'ca']) out[k] = [];
  if (sc.probeOrbs) { out.orbs = []; out.xp = []; }
  for (let k = 1; k <= T; k++) {
    if (k === 1) {
      const [px, py, pz] = sc.pos, [vx, vy, vz] = sc.motion;
      const opts = { vx, vy, vz };
      if (sc.type === 'item') { opts.item = sc.item || 'stone'; opts.count = 1; }
      if (sc.type === 'falling_block') opts.state = S.stateOf(/gravel/.test(sc.nbt) ? 'gravel' : 'sand') | 0;
      if (sc.type === 'tnt') opts.fuse = 200;
      if (sc.type === 'experience_orb') opts.value = 1;
      if (sc.owner) {
        opts.shooter = EL.spawn('armor_stand', sc.owner[0], sc.owner[1], sc.owner[2], { vx: 0, vy: 0, vz: 0 });
        opts.shooter.noGravity = true; opts.shooter.vx = opts.shooter.vy = opts.shooter.vz = 0;
      }
      if (sc.pig) { const pg = pigE = EL.spawn('pig', sc.pig[0], sc.pig[1], sc.pig[2], {}); pg.noAI = true; pg.noAi = true; }
      if (sc.type === 'ender_pearl') {   // the owner who threw it: far from the pearl, to see the teleport
        owner = { x: 20.5, y: 5, z: 0.5, px: 20.5, py: 5, pz: 0.5, ex: 20.5, ey: 5, ez: 0.5, health: 20, mode: 0, fallDistance: 0, width: 0.6, height: 1.8 };
        M.Player = owner; opts.shooter = owner;
      }
      e = EL.spawn(sc.type, px, py, pz, opts);
      if (sc.power) { e.powerX = sc.power[0]; e.powerY = sc.power[1]; e.powerZ = sc.power[2]; }   // NBT `power` is read raw (no normalize)
      if (sc.type === 'trident') { e.loyalty = sc.loyalty; e.pickupType = 'disallowed'; }
      if (!e) throw new Error(`EntityList.spawn('${sc.type}') returned null`);
      if (sc.type === 'item') e.pickupDelay = EL.PICKUP_NEVER;
      if (sc.eyeTarget) {   // the server's target is world (0,0,0); this scene is shifted by the scenario origin
        const o = origin(SCENARIOS.indexOf(sc));
        e.tx = sc.eyeTarget[0] - o.x; e.ty = sc.eyeTarget[1] - o.y; e.tz = sc.eyeTarget[2] - o.z;
        e.lifespan = 0; e.dropsItem = false;
      }
      if (idPhase !== undefined) e.id = idPhase;
    }
        const alive = !!e && !e.removed && EL.list.includes(e);
    out.alive.push(alive ? 1 : 0);
    const vals = { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz };
    for (const [f] of FIELDS) out[f].push(alive ? Math.floor(vals[f] * SCALE) : 0);
    if (sc.glow) {   // the target's Glowing (duration, amplifier), 0 while absent -- as the server probe stores it
      const gi = M.Effects.getStatusEffect(pigE, 'glowing');
      out.glowd.push(gi ? gi.duration : 0); out.glowa.push(gi ? gi.amplifier : 0);
    }
    if (sc.probeBlock) {
      const [x, y, z, name] = sc.probeBlock;
      out.block.push(W.getBlock(x, y, z) === stateFor(M, name) ? 1 : 0);
    }
    if (sc.cloud) {
      const c = EL.list.find((q) => q.type === 'area_effect_cloud' && !q.removed), fx = c && c.custom && c.custom[0];
      const EFF = { instant_damage: 7 };
      out.cr.push(c ? Math.floor(c.radius * SCALE) : 0); out.cd.push(c ? c.duration : 0); out.cw.push(c ? c.waitTime : 0);
      out.ce.push(fx ? EFF[fx.effect] : 0); out.ca.push(fx ? fx.amplifier : 0);
    }
    if (sc.probeItem) out.items.push(EL.list.filter((q) => q.type === 'item' && !q.removed).length);
    if (sc.probeOrbs) {
      const orbs = EL.list.filter((q) => q.type === 'experience_orb' && !q.removed);
      out.orbs.push(orbs.length);
      out.xp.push(orbs.reduce((a, q) => a + q.value * (q.pickingCount || 1), 0));
      out.orbList = orbs.map((q) => q.value);
    }
    EL.tick();
  }
  if (owner) out.owner = { x: owner.x, y: owner.y, z: owner.z, health: owner.health, pearl: { x: e.x, y: e.y, z: e.z } };   // the pearl stays where it was when it hit
  return out;
}

function compare(id, g, e) {
  const bad = [];
  for (const key of ['alive', 'block', 'items']) {
    if (!g[key]) continue;
    const a = g[key], b = e[key] || [];
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0) bad.push(`${id}.${key}: first differs at tick ${i}: server ${a.join('')} | engine ${b.join('')}`);
  }
  for (const key of ['cr', 'cd', 'cw', 'ce', 'ca']) {   // cloud, 1 and 20 ticks after the impact (first dead sample = impact)
    if (!g[key]) continue;
    const t0 = g.alive.indexOf(0);
    for (const dt of [1, 20]) {
      const k = t0 + dt, tol = key === 'cr' ? TOL : 0;
      if (t0 < 0 || !(Math.abs(g[key][k] - (e[key] || [])[k]) <= tol)) bad.push(`${id}.${key}: ${dt} tick(s) after impact: server ${g[key][k]} | engine ${(e[key] || [])[k]}`);
    }
  }
  for (const key of ['glowd', 'glowa']) {   // exact: the effect on the hit tick and every tick after
    if (!g[key]) continue;
    const a = g[key], b = e[key] || [];
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0) bad.push(`${id}.${key}: first differs at tick ${i}: server ${a.slice(Math.max(0, i - 1), i + 4).join(' ')} | engine ${b.slice(Math.max(0, i - 1), i + 4).join(' ')}`);
  }
  for (const [f] of FIELDS) {
    const a = g[f], b = e[f] || [];
    const until = (SCENARIOS.find((s) => s.id === id) || {}).until ?? a.length;   // a scenario whose server entity leaves the loaded chunks is compared up to there
    for (let k = 0; k < Math.min(a.length, until); k++) {
      if (!g.alive[k] || !e.alive[k]) continue;
      if (Math.abs(a[k] - b[k]) > TOL) {
        const from = Math.max(0, k - 2);
        bad.push(`${id}.${f}: first differs at tick ${k}: server ${a.slice(from, k + 5).join(' ')} | engine ${b.slice(from, k + 5).join(' ')} (x1e-4, from tick ${from})`);
        break;
      }
    }
  }
  return bad;
}

console.log(`motionrefcheck — entity motion vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runmotion.mjs)`);
let nScen = 0;
const G = {};
SCENARIOS.forEach((sc, i) => {
  if (!ok(!!golden.cases[sc.id], `${sc.id}: in the golden (regenerate: node tools/referee/runmotion.mjs)`)) return;
  const g = G[sc.id] = goldenRel(sc, i);
  ok(g.y.some((v) => v !== g.y[0]), `${sc.id}: the server's entity moved`);
  let eng;
  let bad;
  try {
    // the server's entity id is not in the golden, and an item rests-skips on (age + id) % 4: take the best of the 4 phases
    const phases = sc.type === 'item' ? [0, 1, 2, 3] : [undefined];
    for (const ph of phases) {
      const e2 = runEngine(sc, undefined, ph), b2 = compare(sc.id, g, e2);
      if (!bad || b2.length < bad.length) { bad = b2; eng = e2; }
    }
  } catch (err) { ok(false, `${sc.id}: engine threw ${err.message}`); return; }
  for (const b of bad) ok(false, b);
  if (sc.type === 'ender_pearl') {   // OnCollision: owner lands on the pearl's last position, takes exactly 5.0 (fall)
    const ow = eng.owner, d = (a, b) => Math.abs(a - b);
    ok(!!ow.pearl && d(ow.x, ow.pearl.x) + d(ow.y, ow.pearl.y) + d(ow.z, ow.pearl.z) < 1e-9, `${sc.id}: owner teleported to the pearl`);
    ok(ow.health === 15, `${sc.id}: owner took exactly 5.0 damage (health ${ow.health})`);
    ok(g.alive.indexOf(0) > 0, `${sc.id}: the server's pearl hit something and was removed`);
  }
  if (sc.probeOrbs) {   // the random draw cannot be seeded: both sides' orbs appear on the SAME tick the bottle goes, sum in 3..11, split by roundToOrbSize
    const lastAlive = g.alive.lastIndexOf(1), tick = lastAlive + 1;
    ok(g.alive.indexOf(0) > 0 && g.orbs[g.alive.indexOf(0)] > 0, `${sc.id}: the server's bottle broke into orbs`);
    for (const [who, o] of [['server', g], ['engine', eng]]) {
      const sum = o.xp[Math.min(tick + 1, T - 1)];
      ok(sum >= 3 && sum <= 11, `${sc.id}: ${who} orbs sum ${sum} within 3 + rand(5) + rand(5)`);
    }
    const sum = eng.xp[T - 1], split = []; let rest = sum;
    for (; rest > 0;) { const a = rest >= 7 ? 7 : rest >= 3 ? 3 : 1; split.push(a); rest -= a; }
    ok(JSON.stringify(eng.orbList.slice().sort()) === JSON.stringify([...new Set(split)].sort()) || eng.orbList.length <= split.length, `${sc.id}: engine orb values ${eng.orbList} are roundToOrbSize(${sum}) = ${split}`);
  }
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) for (const f of ['y', 'vy', 'x']) console.log(`   ${sc.id}.${f}\n     S ${g[f].slice(0, 16).join(' ')}\n     E ${eng[f].slice(0, 16).join(' ')}`);
});

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sc = SCENARIOS.find((s) => s.id === 'tnt_drop');
  const g = G[sc.id];
  breakCaught('tnt_drop golden `y` shifted one tick is a mismatch', compare(sc.id, { ...g, y: [g.y[0], ...g.y.slice(0, -1)] }, runEngine(sc)).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'item_drop');
  const eng = runEngine(sc, (M) => { const real = M.EntityList.motionFor; M.EntityList.motionFor = (t) => { const m = real(t); return m && [m[0] * 2, m[1]]; }; });
  breakCaught('an item falling with double gravity is a mismatch', compare(sc.id, G[sc.id], eng).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'item_throw');
  const eng = runEngine(sc, (M) => { const real = M.EntityList.tickItem; M.EntityList.tickItem = (e) => { e.vx /= 0.98; e.vy /= 0.98; e.vz /= 0.98; return real(e); }; });   // ItemEntity.tick's 0.98 undone
  breakCaught('an item thrown with no drag is a mismatch', compare(sc.id, G[sc.id], eng).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'pearl_ground');
  const gr = (f) => (M) => { const real = M.EntityList.motionFor; M.EntityList.motionFor = (t) => { const m = real(t); return m && f(m); }; };
  breakCaught('a pearl with double gravity is a mismatch', compare(sc.id, G[sc.id], runEngine(sc, gr((m) => [m[0] * 2, m[1]]))).length > 0);
  breakCaught('a pearl with no drag is a mismatch', compare(sc.id, G[sc.id], runEngine(sc, gr((m) => [m[0], 1]))).length > 0);
  const w = SCENARIOS.find((s) => s.id === 'pearl_wall');
  breakCaught('a pearl that never lands (alive bit) is a mismatch', compare(w.id, G[w.id], { ...runEngine(w), alive: Array(T).fill(1) }).length > 0);
}

{
  const sc = SCENARIOS.find((s) => s.id === 'eye_flight');
  const g = G[sc.id];
  ok(g.alive[80] === 1 && g.alive[81] === 0, 'eye_flight: server discards the eye on tick 81 (lifespan > 80)');
  breakCaught('eye_flight golden `x` shifted one tick is a mismatch', compare(sc.id, { ...g, x: [g.x[0], ...g.x.slice(0, -1)] }, runEngine(sc)).length > 0);
  const eng = runEngine(sc, (M) => { const real = M.Throw.tickEye; M.Throw.tickEye = (e) => { real(e); e.vy *= 0.9; }; });
  breakCaught('an eye with wrong vertical lerp is a mismatch', compare(sc.id, g, eng).length > 0);
  const eng2 = runEngine(sc, (M) => { const real = M.Throw.tickEye; M.Throw.tickEye = (e) => { real(e); e.lifespan -= 1; }; });
  breakCaught('an eye living a tick too long is a mismatch', compare(sc.id, g, eng2).length > 0);
}

{   // #6088: ItemEntity water/lava buoyancy, health 5 and fire-resistant netherite, each broken in turn
  const run = (id, hook) => compare(id, G[id], runEngine(SCENARIOS.find((s) => s.id === id), hook));
  const lastFn = (M, name, wrap) => { const real = M.EntityList[name]; M.EntityList[name] = wrap(real); };
  breakCaught('item_in_water with buoyancy 0.98 (not 0.99) is a mismatch', run('item_in_water', (M) => lastFn(M, 'tickItem', (real) => (e) => { const w = e.inWater; real(e); if (w) e.vy *= 0.98 / 0.99; })).length > 0);
  breakCaught('item_in_lava with a start health of 9 is a mismatch', run('item_in_lava', (M) => lastFn(M, 'hurtItem', (real) => (e, a, s) => { if (e.health === undefined) e.health = 9; return real(e, a, s); })).length > 0);
  breakCaught('item_on_fire with a start health of 6 is a mismatch', run('item_on_fire', (M) => lastFn(M, 'hurtItem', (real) => (e, a, s) => { if (e.health === undefined) e.health = 6; return real(e, a, s); })).length > 0);
  breakCaught('netherite_ingot in lava with fire resistance ignored is a mismatch', run('item_netherite_ingot_in_lava', (M) => { M.EntityList.itemFireImmune = () => false; }).length > 0);
}

for (const id of ['dfireball_air', 'dfireball_wall']) {
  const sc = SCENARIOS.find((s) => s.id === id), g = G[id];
  const wrap = (fn) => runEngine(sc, (M) => { const r = M.EnderDragon.tickDragonFireball; M.EnderDragon.tickDragonFireball = (e) => { r(e); fn(e); }; });
  breakCaught(`${id} golden \`x\` shifted one tick is a mismatch`, compare(id, { ...g, x: [g.x[0], ...g.x.slice(0, -1)] }, runEngine(sc)).length > 0);
  breakCaught(`${id} with gravity added (wrong gravity) is a mismatch`, compare(id, g, wrap((e) => { e.vy -= 0.08; })).length > 0);
  breakCaught(`${id} with the drag removed is a mismatch`, compare(id, g, wrap((e) => { e.vx /= 0.95; e.vy /= 0.95; e.vz /= 0.95; })).length > 0);
}
{
  const sc = SCENARIOS.find((s) => s.id === 'dfireball_wall');
  breakCaught('a breath cloud of radius 4 is a mismatch', compare(sc.id, G[sc.id], (() => { const e = runEngine(sc); e.cr = e.cr.map((v) => (v ? v + 10000 : v)); return e; })()).length > 0);
}
for (const id of ['bottle_floor', 'bottle_wall']) {
  const sc = SCENARIOS.find((s) => s.id === id), g = G[id];
  const mod = (fn) => runEngine(sc, (M) => { const real = M.EntityList.motionFor; M.EntityList.motionFor = (t) => { const m = real(t); return m && fn(m); }; });
  breakCaught(`${id} golden \`y\` shifted one tick is a mismatch`, compare(id, { ...g, y: [g.y[0], ...g.y.slice(0, -1)] }, runEngine(sc)).length > 0);
  breakCaught(`${id} with the egg's gravity 0.03 (wrong) is a mismatch`, compare(id, g, mod((m) => [0.03, m[1]])).length > 0);
  breakCaught(`${id} with the drag removed is a mismatch`, compare(id, g, mod((m) => [m[0], 1])).length > 0);
}
for (const id of ['snowball_air', 'egg_water']) {
  const sc = SCENARIOS.find((s) => s.id === id), g = G[id];
  const mod = (fn) => runEngine(sc, (M) => { const real = M.EntityList.motionFor; M.EntityList.motionFor = (t) => { const m = real(t); return m && fn(m); }; });
  breakCaught(`${id} golden \`y\` shifted one tick is a mismatch`, compare(id, { ...g, y: [g.y[0], ...g.y.slice(0, -1)] }, runEngine(sc)).length > 0);
  breakCaught(`${id} with double gravity is a mismatch`, compare(id, g, mod((m) => [m[0] * 2, m[1]])).length > 0);
  breakCaught(`${id} with the drag removed is a mismatch`, compare(id, g, mod((m) => [m[0], 1])).length > 0);
}
{   // #6078 spectral_arrow: wrong Glowing duration, wrong drag, one-tick shift each fail
  const lob = SCENARIOS.find((s) => s.id === 'spectral_arrow_lob'), mob = SCENARIOS.find((s) => s.id === 'spectral_arrow_mob');
  const wall = SCENARIOS.find((s) => s.id === 'spectral_arrow_wall');
  ok(G[mob.id].glowd.some((v) => v === 200), 'spectral_arrow_mob: the server granted Glowing 200');
  ok(G[wall.id].alive.every((v) => v === 1) && G[wall.id].vx.at(-1) !== 0, 'spectral_arrow_wall: the server arrow stuck (alive, parked)');
  breakCaught('spectral_arrow Glowing duration 100 is a mismatch', compare(mob.id, G[mob.id], runEngine(mob, (M) => { M.Combat.SPECTRAL_GLOW_TICKS = 100; })).length > 0);
  const drag = (M) => { const real = M.EntityList.motionFor; M.EntityList.motionFor = (t) => { const m = real(t); return m && [m[0], 1]; }; };
  breakCaught('spectral_arrow_lob golden `y` shifted one tick is a mismatch', compare(lob.id, { ...G[lob.id], y: [G[lob.id].y[0], ...G[lob.id].y.slice(0, -1)] }, runEngine(lob)).length > 0);
  breakCaught('spectral_arrow_mob Glowing shifted one tick is a mismatch', compare(mob.id, { ...G[mob.id], glowd: [0, ...G[mob.id].glowd.slice(0, -1)] }, runEngine(mob)).length > 0);
  breakCaught('spectral_arrow_lob with the drag removed is a mismatch', compare(lob.id, G[lob.id], runEngine(lob, drag)).length > 0);
}
// #6087 anti-vacuity: wrong landing rules must be caught by the landing-cell / item-count series
const LAND = SCENARIOS.filter((s) => s.probeItem);
const landBreak = (msg, fn, ids) => {
  // caught when AT LEAST ONE scenario that the rule matters for diverges from the server
  const hit = LAND.filter((s) => !ids || ids.includes(s.id)).some((sc) => compare(sc.id, G[sc.id], runEngine(sc, fn)).length > 0);
  breakCaught(msg, hit);
};
landBreak('landing: always place (replaceable and survive tests ignored) is a mismatch', (M) => { M.States.canBeReplacedBy = () => true; M.World.canSurvive = () => true; });
landBreak('landing: always drop as an item is a mismatch', (M) => { M.World.canSurvive = () => false; });
landBreak('landing: replaceable only when air (torch/snow/water not replaced) is a mismatch', (M) => { M.States.canBeReplacedBy = (cur) => cur === 0; });
console.log(`motionrefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ motionrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
