// sandlockstepcheck.mjs -- #6310 (G17-L58): lockstep scenario 'sand': a column of 3 sand (support removed) lands on stone, a sand lands on a torch
// (not replaceable -> item drop), a sand lands in water (replaces it), an anvil drops on a cow; 20 salts.
// Reference = .decomp FallingBlockEntity.tick (timeFalling++, gravity 0.04, move, land when onGround, drag 0.98) + FallingBlock.scheduledTick/startFalling
// (2-tick stagger up the column) + FallingBlockEntity.handleFallDamage (ceil(dist-1), min(floor(n*2), 40), AnvilBlock.configureFallingBlockEntity).
// Per tick: every falling entity's y, the block changes (x,y,z,name), the item drops, the cow health.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07k_goals.js', '07q_effects.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js', '07d_mining.js', '07e_loot.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, log = [];
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; } };
w.getBlock = w.get; w.setBlock = (x, y, z, s) => { w.set(x, y, z, s); log.push(x + ',' + y + ',' + z + ':' + M.Reg.names[M.States.block[s]]); return true; };
w.getLight = () => 0; w.tickingAt = () => true; w.canSurvive = () => true;
M.World = Object.assign(M.World || {}, w);
M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Combat.init();
M.Diff = { get: () => 'normal' }; M.Player = null;
const { EntityList: EL, States: S } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 60, FLOOR = 60;   // stone top surface y = FLOOR
const params = (salt) => { const r = stream(salt); return { gap: 4 + Math.floor(r() * 6), anvilDist: 2 + Math.floor(r() * 4) + Math.floor(r() * 4) / 4, tail: 2 + Math.floor(r() * 3) }; };

// ---- reference: pure kinematics, no engine code ----
function fallRef(startY, t0, floorTop) {   // y after tick t (t >= t0): vy -= 0.04; y += vy (clamped to the floor); vy *= 0.98 -- lands the tick y reaches the floor
  const ys = {}; let y = startY, vy = 0, land = 0;
  for (let t = t0 + 1; t <= TICKS; t++) {
    vy -= 0.04; y += vy;
    if (y <= floorTop) { ys[t] = floorTop; land = t; break; }
    vy *= 0.98; ys[t] = y;
  }
  return { ys, land };
}
function reference(p) {
  const ev = [];   // [tick, 'blk'|'drop'|'hp', text]
  // lane A: column of 3 sand at x=0, bottom cell FLOOR+gap, lands on stone, 2-tick stagger up the column
  const top = (i) => FLOOR + p.gap + i;
  const A = [0, 1, 2].map((i) => ({ i, ...fallRef(top(i), 2 * i, FLOOR + i) }));
  A.forEach((a) => ev.push([a.land, 'blk', `0,${FLOOR + a.i},0:sand`]));
  // lane B: torch at (10,FLOOR,0); sand lands in its cell, torch is not replaceable -> drop, no block change
  const B = fallRef(FLOOR + p.gap, 0, FLOOR); ev.push([B.land, 'drop', 'sand']);
  // lane C: water cell at (20,FLOOR,0): replaced by the sand
  const C = fallRef(FLOOR + p.gap, 0, FLOOR); ev.push([C.land, 'blk', `20,${FLOOR},0:sand`]);
  // lane D: anvil on a cow at (30,FLOOR,0); fall distance = anvilDist, amt = min(floor(ceil(d-1)*2), 40)
  const D = fallRef(FLOOR + p.anvilDist, 0, FLOOR), amt = Math.min(Math.floor(Math.ceil(p.anvilDist - 1) * 2), 40);
  ev.push([D.land, 'blk', `30,${FLOOR},0:anvil`], [D.land, 'hp', 10 - amt]);
  return { ys: { A: A.map((a) => a.ys), B: B.ys, C: C.ys, D: D.ys }, ev };
}

// ---- engine ----
function engine(p) {
  cells.clear(); log.length = 0; EL.init(); EL.random = () => 0.99;
  const st = (n) => S.stateOf(n);
  for (let x = -2; x <= 34; x++) for (let z = -2; z <= 2; z++) for (let y = FLOOR - 2; y < FLOOR; y++) cells.set(key(x, y, z), st('stone'));
  cells.set(key(10, FLOOR, 0), st('torch')); for (let y = FLOOR - 2; y < FLOOR; y++) { cells.set(key(20, y, 0), st('stone')); }
  cells.set(key(20, FLOOR, 0), st('water'));
  const mk = (n, x, y) => { const e = EL.spawn('falling_block', x + 0.5, y, 0.5, { state: st(n) }); e.silent = true; return e; };
  const cow = EL.spawn('cow', 30.5, FLOOR, 0.5); cow.silent = true; cow.noAi = true;
  const pend = [[0, 'A0', () => mk('sand', 0, FLOOR + p.gap)], [2, 'A1', () => mk('sand', 0, FLOOR + p.gap + 1)], [4, 'A2', () => mk('sand', 0, FLOOR + p.gap + 2)],
    [0, 'B', () => mk('sand', 10, FLOOR + p.gap)], [0, 'C', () => mk('sand', 20, FLOOR + p.gap)], [0, 'D', () => mk('anvil', 30, FLOOR + p.anvilDist)]];
  const live = {}, ys = { A: [{}, {}, {}], B: {}, C: {}, D: {} }, ev = [];
  const slot = (id) => id[0] === 'A' ? ys.A[+id[1]] : ys[id];
  for (let t = 1; t <= TICKS; t++) {
    const logBefore = log.length, dropsBefore = EL.list.filter((q) => q.type === 'item').length, hp0 = cow.health;
    for (const [t0, id, f] of pend) if (t0 === t - 1) live[id] = f();   // spawned at the end of tick t0, first moves on tick t0+1
    for (const id of Object.keys(live)) { const e = live[id]; if (e.removed) continue; EL.tickOne(e); slot(id)[t] = e.y; }
    for (const l of log.slice(logBefore)) ev.push([t, 'blk', l]);
    const di = EL.list.filter((q) => q.type === 'item' && !q.removed);
    if (di.length > dropsBefore) ev.push([t, 'drop', M.Reg.names[M.States.block[S.stateOf('sand')]]]);
    if (cow.health !== hp0) ev.push([t, 'hp', cow.health]);
  }
  return { ys, ev };
}
function diff(R, E) {
  const lanes = [['A0', R.ys.A[0], E.ys.A[0]], ['A1', R.ys.A[1], E.ys.A[1]], ['A2', R.ys.A[2], E.ys.A[2]], ['B', R.ys.B, E.ys.B], ['C', R.ys.C, E.ys.C], ['D', R.ys.D, E.ys.D]];
  for (let t = 1; t <= TICKS; t++) for (const [n, a, b] of lanes) if (!(Math.abs((a[t] ?? NaN) - (b[t] ?? NaN)) < 1e-4) && !(a[t] === undefined && b[t] === undefined)) return `tick ${t} ${n} y ${a[t]} vs ${b[t]}`;
  const f = (ev) => ev.map((e) => e.join('|')).sort().join(' ; ');
  if (f(R.ev) !== f(E.ev)) { const a = R.ev.map((e) => e.join('|')).sort(), b = E.ev.map((e) => e.join('|')).sort(); const d = a.find((x) => !b.includes(x)) || b.find((x) => !a.includes(x)); return 'events: ' + d + ' (ref ' + a.length + ', engine ' + b.length + ')'; }
  return null;
}
const run = (s) => { const p = params(s), R = reference(p), E = engine(p); return { R, E, d: diff(R, E), p }; };
const res = salts.map((s) => ({ s, ...run(s) }));
ok(res.every((r) => !r.d), '20 salts: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} ${r.d}`));
ok(res.every((r) => r.R.ev.filter((e) => e[1] === 'blk').length === 5 && r.R.ev.some((e) => e[1] === 'drop') && r.R.ev.some((e) => e[1] === 'hp')), 'reference lands 5 blocks, 1 drop, 1 cow hit');
ok(res.every((r) => r.E.ev.some((e) => e[1] === 'hp' && e[2] < 10)), 'engine hurts the cow');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const tf = EL.tickFallingBlock;
EL.tickFallingBlock = function (e, d) { if (e.fallHurtAmount === 2) e.fallHurtAmount = 1; return tf.call(this, e, d); };
const bad = salts.map(run).find((r) => r.d);
brk(!!bad && /hp/.test(bad.d), 'fallDamagePerDistance 2.0 -> 1.0 is reported at the landing tick (' + (bad && bad.d) + ')');
EL.tickFallingBlock = tf;
const ge = EL.spawn; EL.spawn = function (t, x, y, z, o) { const e = ge.call(this, t, x, y, z, o); if (t === 'falling_block') e.gravity = 0.05; return e; };
brk(salts.some((s) => run(s).d), 'gravity 0.04 -> 0.05 is reported'); EL.spawn = ge;
const dfb = EL.dropFallingBlock; EL.dropFallingBlock = () => {};
brk(salts.some((s) => run(s).d), 'torch landing without the item drop is reported'); EL.dropFallingBlock = dfb;
console.log(`sandlockstepcheck: ${breaks + 3} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
