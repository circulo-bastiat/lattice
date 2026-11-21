// goatramlockstepcheck.mjs -- #6676 (G17-L105): lockstep scenario 'goatram': a ram-ready goat 10 blocks from a cow (adult / screaming / baby by salt), 20 salts, plus the long jump.
// Reference = .decomp PrepareRamTask (wind-up: memory RAM_TARGET set on the tick `now - prepareStartTime >= 20`, i.e. 20 ticks at the lane start then the 21st sets it),
// RamImpactTask (speed 3.0 -> movement speed 3.0*0.2; damage = attack attribute 2 / baby 1; knockback clamp(ms*1.65,0.2,3.0) * 2.5 adult / 1.0 baby along the FIXED lane direction;
// cooldown rolled 600-6000, screaming 100-300 (GoatBrain RAM_COOLDOWN_RANGE / SCREAMING_RAM_COOLDOWN_RANGE); RAM_TARGET forgotten) and LongJumpTask (getRammingVelocity:
// angles 65..80, shortest, *0.95; weighted target pick ceil(distSq); leap 40 ticks after the pick; cooldown 600-1200 rolled on landing) written out independently.
// Per tick, from the first wind-up tick: activity, wind-up flag, RAM_TARGET memory, ram cooldown, goat x (the ground travel ramp d = 0.546 d + ms*ms, the same constants
// ramrefcheck.mjs holds against the real server's charge peak), cow health. Walking to the lane start is ramrefcheck's job (golden), not modelled here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js',
  '07zw_mobnbt.js', '07w_passive.js', '07d_mining.js', '07e_loot.js', '07zj_goat.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const { EntityList: EL, Goat: Gt, Combat: Cb } = M;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const KIND = ['adult', 'screaming', 'baby', 'adult'];
const kindOf = (salt) => KIND[salt % 4];
const f32 = Math.fround;
function world() {
  M.World.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  const stone = M.States.stateOf('stone');
  for (let x = -20; x <= 40; x++) for (let z = -20; z <= 20; z++) M.World.setBlock(x, 79, z, stone);
  EL.init(); M.Ai.init(); M.Breed.init(); if (Gt.init) Gt.init(); M.Player = null;
}
// ---- ram ----------------------------------------------------------------------------------------
const AFTER = 8;
function engineRam(salt) {
  world();
  const kind = kindOf(salt), rng = stream(salt + 500); EL.random = rng;
  const g = EL.spawn('goat', 0.5, 80, 0.5), c = EL.spawn('cow', 10.5, 80, 0.5);
  g.persistent = c.persistent = true; g.silent = true; g.ramCooldown = 0; g.longJumpCooldown = 1e6;
  g.screaming = kind === 'screaming'; if (kind === 'baby') { g.isBaby = true; g.age = -24000; M.Breed.refreshDimensions && M.Breed.refreshDimensions(g); }
  const kb = [], orig = Cb.knockback;
  Cb.knockback = function (e, s, dx, dz) { if (e === c) kb.push({ s, dx, dz }); return orig.apply(this, arguments); };
  const rows = [], all = []; let T0 = -1, hit = -1;
  try {
    for (let t = 0; t < 260; t++) {
      if (hit < 0) { c.x = 10.5; c.z = 0.5; c.vx = c.vz = 0; }   // the cow stands still (the scenario is the goat's; the cow's own wander is not)
      EL.tick();
      const b = Gt.brainTrace(g);
      if (T0 < 0 && g.preparingRam) T0 = t;
      if (hit < 0 && kb.length) hit = t;
      all.push({ t, x: g.x, z: g.z, y: g.y, act: b.activity, prep: !!g.preparingRam, rt: b.ramTarget, cd: b.ram, hp: c.health, fx: c.effects ? Object.keys(c.effects).length : 0 });
      if (hit >= 0 && t >= hit + AFTER) break;
    }
  } finally { Cb.knockback = orig; }
  return { all, T0, hit, kb, g, c, kind };
}
function referenceRam(E) {
  const { kind, T0, g, c } = E, x0 = E.all[T0 + 20].x, rows = [];
  const ms = f32(f32(3.0) * f32(0.2)), A = f32(ms * f32(ms * f32(0.98))), DRAG = 0.546;   // LivingEntity.tickMovement zza *= 0.98F (#4023)
  const gw = g.width, cw = c.width, thr = 10.5 - (gw / 2 + cw / 2);
  const baby = kind === 'baby', scream = kind === 'screaming';
  // wind-up: flag on for 20 ticks (r 0..19); RAM_TARGET is set on r = 20; the charge's first step is the tick after (the goal runs after the brain tick)
  let x = x0, d = 0, hitR = -1, prevX = x0, cd = 0;
  const HP0 = 10, dmg = baby ? 1 : 2;
  for (let r = 0; r < E.all.length - T0; r++) {
    let act = 'ram', prep = r <= 19, rt = r >= 20, pos = r >= 21, hp = HP0;   // the wind-up still slides off the walk's momentum: position compared from the charge on
    if (r >= 21 && hitR < 0) {
      if (prevX > thr) hitR = r;   // the previous tick's end position overlaps the cow's box
      else { d = DRAG * d + A; x += d; }
    }
    if (hitR >= 0 && r >= hitR) { act = 'idle'; rt = false; hp = HP0 - dmg; pos = r < hitR; cd = r === hitR ? -1 : cd; }
    prevX = x;
    rows.push({ r, act, prep: r <= 19 ? prep : false, rt, x, pos, hp });
  }
  return { rows, hitR };
}
const normE = (E, ref) => E.all.slice(E.T0).map((q, i) => ({ tick: i, goals: [[0, q.act], [1, q.prep], [2, q.rt]], pos: i >= 21 && (i < ref.hitR || ref.hitR < 0) ? [q.x - E.all[E.T0 + 20].x, q.y, q.z] : null, hp: q.hp }));
const normR = (ref, E) => ref.rows.map((q) => ({ tick: q.r, goals: [[0, q.act], [1, q.prep], [2, q.rt]], pos: q.pos ? [q.x - E.all[E.T0 + 20].x, E.all[E.T0].y, E.all[E.T0].z] : null, hp: q.hp }));
function laneRam(salt) {
  const E = engineRam(salt);
  if (E.T0 < 0 || E.hit < 0) return { E, d: { tick: -1, field: 'no ram', a: E.T0, b: E.hit } };
  const ref = referenceRam(E);
  const rowsE = normE(E, ref).map((q) => ({ ...q, goals: q.goals.map((g) => (g[0] === 1 && q.tick > 19 ? [1, false] : g)) }));
  const d = compareTraces(normR(ref, E), rowsE, { fields: ['goals', 'pos'], tol: { pos: 1e-5 } });
  let dh = null;
  for (const q of E.all.slice(E.T0)) { if (ref.hitR >= 0 && q.t - E.T0 === ref.hitR - 1 && q.hp !== 10) dh = dh || { tick: ref.hitR - 1, field: 'hp-early', a: 10, b: q.hp }; }
  return { E, ref, d: d || dh || cmpHit(E, ref) };
}
// damage / knockback (LivingEntity.damage's own 0.4 knock first, then RamImpactTask's takeKnockback)
//  / cooldown, read at the hit
function cmpHit(E, ref) {
  const hitT = E.T0 + ref.hitR, q = E.all[hitT - 1] ? E.all[hitT] : null;
  if (E.hit !== hitT) return { tick: ref.hitR, field: 'hit tick', a: ref.hitR, b: E.hit - E.T0 };
  const baby = E.kind === 'baby', scream = E.kind === 'screaming';
  const dmg = 10 - E.all[hitT + 2].hp;
  if (dmg !== (baby ? 1 : 2)) return { tick: ref.hitR, field: 'damage', a: baby ? 1 : 2, b: dmg };
  const k = E.kb[1], str = f32(f32(f32(0.2) * 3.0) * f32(1.65)) * (baby ? 1.0 : 2.5);
  if (E.kb.length !== 2 || E.kb[0].s !== 0.4 || Math.abs(k.s - str) > 1e-6) return { tick: ref.hitR, field: 'knockback', a: str, b: k && k.s };
  // RamImpactTask.direction = (goat BLOCK x - ram target x, goat BLOCK z - ram target z).normalize(); target = lane-end block bottom-centre + 0.5*sign(end - start): (11.0, 0.5)
  const ddx = Math.floor(E.all[E.T0 + 20].x) - 11.0, ddz = Math.floor(E.all[E.T0 + 20].z) - 0.5, dl = Math.hypot(ddx, ddz);
  if (Math.abs(k.dx - ddx / dl) > 1e-9 || Math.abs(k.dz - ddz / dl) > 1e-9) return { tick: ref.hitR, field: 'kb direction', a: ddx / dl + ',' + ddz / dl, b: k.dx + ',' + k.dz };
  const lo = scream ? 100 : 600, hi = scream ? 300 : 6000, cd = E.all[hitT + 1].cd;
  if (!(cd >= lo - 1 && cd <= hi)) return { tick: ref.hitR, field: 'cooldown range', a: lo + '-' + hi, b: cd };
  if (E.all[hitT + 3].cd !== E.all[hitT + 2].cd - 1) return { tick: ref.hitR, field: 'cooldown ticks down', a: E.all[hitT + 2].cd - 1, b: E.all[hitT + 3].cd };
  if (E.all[hitT + 1].rt) return { tick: ref.hitR, field: 'ram_target forgotten', a: false, b: true };
  if (E.all.some((z) => z.fx)) return { tick: ref.hitR, field: 'no stun/effect on the target', a: 0, b: 1 };
  return null;
}
// ---- long jump ----------------------------------------------------------------------------------
function jumpRef(fx, fy, fz, tx, ty, tz) {   // LongJumpTask.getRammingVelocity (flat open floor: the arc sweep never meets a block)
  let best = null;
  for (let deg = 65; deg < 85; deg += 5) {
    const nx = tx - fx, nz = tz - fz, nl = Math.hypot(nx, nz), px = tx - (nx / nl) * 0.5, pz = tz - (nz / nl) * 0.5;
    const dx = px - fx, dy = ty - fy, dz = pz - fz, rad = f32(f32(deg) * f32(Math.PI) / 180), a = Math.atan2(dz, dx);
    const h2 = dx * dx + dz * dz, h = Math.sqrt(h2), v2 = h2 * 0.08 / (h * Math.sin(f32(2 * rad)) - 2 * dy * Math.pow(Math.cos(rad), 2));
    if (v2 < 0) continue; const v = Math.sqrt(v2); if (v > 1.5) continue;
    const r = [v * Math.cos(rad) * Math.cos(a) * f32(0.95), v * Math.sin(rad) * f32(0.95), v * Math.cos(rad) * Math.sin(a) * f32(0.95)];
    if (!best || r[0] * r[0] + r[1] * r[1] + r[2] * r[2] < best[0] * best[0] + best[1] * best[1] + best[2] * best[2]) best = r;
  }
  return best;
}
function laneJump(salt) {
  world();
  const rng = stream(salt + 900), g = EL.spawn('goat', 0.5, 80, 0.5); g.silent = true; g.onGround = true; g.ramCooldown = 1e6; g.longJumpCooldown = 0;
  const goal = new Gt.LongJumpGoal(g, { random: rng, walkable: false });
  const mirror = stream(salt + 900);
  // reference pick: candidates are the 120 columns of the 11x11 box minus the goat's own, at y=80 (floor below), all within the 1.5 launch cap; weight ceil(distSq)
  const cands = [];
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { if (x === 0 && z === 0) continue; cands.push({ x, z, w: Math.ceil(x * x + z * z) }); }
  const total = cands.reduce((s, q) => s + q.w, 0);
  let r = Math.floor(mirror() * total), i = 0; for (; i < cands.length - 1 && (r -= cands[i].w) >= 0; i++);
  const pick = cands[i], v = jumpRef(0.5, 80, 0.5, pick.x + 0.5, 80.5, pick.z + 0.5);
  ok(goal.canUse(), 'salt ' + salt + ': long jump can start');
  goal.start();
  let leap = -1; const vel = [];
  for (let t = 1; t <= 60; t++) { goal.tick(); if (leap < 0 && g.leapPending) { leap = t; vel.push(g.vx, g.vy, g.vz); } }
  return { leap, vel, ref: v, mem: Gt.hasMemory(g, 'long_jump_mid_jump'), g };
}
// ---- run ----------------------------------------------------------------------------------------
const widths = (() => { world(); const g = EL.spawn('goat', 0.5, 80, 0.5), c = EL.spawn('cow', 5.5, 80, 0.5); return { g: g.width, c: c.width }; })();
ok(widths.g === 0.9 && widths.c === 0.9, 'goat and cow boxes are 0.9 wide (got ' + widths.g + ', ' + widths.c + ')');
const resR = salts.map((s) => ({ s, ...laneRam(s) }));
ok(resR.every((r) => !r.d), 'ram: ' + resR.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).join('; '));
ok(resR.every((r) => r.E.kind !== 'screaming' || r.E.all[r.E.hit + 1].cd <= 300), 'screaming goat re-arms within 100-300 ticks');
ok(resR.some((r) => r.E.kind === 'baby') && resR.some((r) => r.E.kind === 'screaming'), 'salts cover baby and screaming');
const resJ = salts.map((s) => ({ s, ...laneJump(s) }));
ok(resJ.every((r) => r.leap === 41), 'long jump: the leap comes 40 ticks after the pick (tick 41), got ' + resJ.map((r) => r.leap).join());
ok(resJ.every((r) => r.ref && r.vel.every((q, i) => Math.abs(q - r.ref[i]) < 1e-7)), 'long jump: launch velocity equals the independent getRammingVelocity: ' + resJ.filter((r) => !r.ref || r.vel.some((q, i) => Math.abs(q - r.ref[i]) > 1e-7)).slice(0, 2).map((r) => `salt ${r.s} ${r.vel} vs ${r.ref}`));
ok(resJ.every((r) => r.mem), 'long jump: LONG_JUMP_MID_JUMP remembered');
// ---- breaks -------------------------------------------------------------------------------------
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const ramBad = () => salts.slice(0, 4).some((s) => laneRam(s).d);
const jumpBad = () => salts.slice(0, 6).some((s) => { const j = laneJump(s); return j.leap !== 41 || !j.ref || j.vel.some((q, i) => Math.abs(q - j.ref[i]) > 1e-7); });
Gt.RAM_SPEED = 2.8; brk(ramBad(), 'ram charge speed 3.0 -> 2.8 is reported'); Gt.RAM_SPEED = 3.0;
Gt.PREPARE_RAM_DURATION = 19; brk(ramBad(), 'wind-up 20 -> 19 ticks is reported'); Gt.PREPARE_RAM_DURATION = 20;
Gt.ADULT_RAM_STRENGTH_MULTIPLIER = 2.0; brk(ramBad(), 'adult knockback multiplier 2.5 -> 2.0 is reported'); Gt.ADULT_RAM_STRENGTH_MULTIPLIER = 2.5;
Gt.DEFAULT_ATTACK_DAMAGE = 3; brk(ramBad(), 'ram damage 2 -> 3 is reported'); Gt.DEFAULT_ATTACK_DAMAGE = 2;
Gt.SCREAMING_RAM_COOLDOWN_MAX = 600; brk(salts.filter((q) => kindOf(q) === 'screaming').some((q) => laneRam(q).d), 'screaming cooldown 100-300 -> 100-600 is reported'); Gt.SCREAMING_RAM_COOLDOWN_MAX = 300;
Gt.LONG_JUMP_DELAY = 30; brk(jumpBad(), 'long jump delay 40 -> 30 is reported'); Gt.LONG_JUMP_DELAY = 40;
Gt.JUMP_GRAVITY = 0.07; brk(jumpBad(), 'long jump gravity 0.08 -> 0.07 is reported'); Gt.JUMP_GRAVITY = 0.08;
console.log(` assertions passed .... ${n - fails}`);
console.log(` failures ........... ${fails}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails ? 1 : 0);
