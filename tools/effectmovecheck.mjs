#!/usr/bin/env node
// effectmovecheck.mjs — G23c (#295). The four movement effects, per tick, against vanilla's formulas.
//
//   node tools/effectmovecheck.mjs [--verbose]
//
// Every expectation is computed HERE in closed form from LivingEntity.java (.decomp), whose
// literals §0 reads out of the source text first, so a formula typed from memory fails §0:
//   travel:  d = 0.08; if (vy <= 0 && SLOW_FALLING) { d = 0.01; onLanding(); }
//            land:  LEVITATION ? vy += (0.05*(amp+1) - vy)*0.2 (+ onLanding) : vy -= d;  vy *= 0.98
//            water: DOLPHINS_GRACE ? f = 0.96F (horizontal only; y keeps 0.8F);  vy -= d/16
//   jump:    vy = 0.42*jumpFactor + (double)(0.1F * (float)(amp+1))
//   computeFallDamage: ceil((distance - 3 - (amp+1)) * multiplier)
//   SquidEntity.tickMovement (out of water): LEVITATION ? vy = 0.05*(amp+1) : vy -= 0.08;  vy *= 0.98
//
// Sections: 0 decomp literals · 1 player levitation · 2 player slow falling · 3 jump boost
// (player + mob) · 4 jump-boost fall damage · 5 dolphin's grace (player + mob) · 6 mob levitation/
// slow falling · 7 squid levitation · 8 anti-vacuity (each broken constant/read is caught).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
                 '02c_states.js', '03_section.js', '05_mesher.js', '14b_physics.js', '07q_effects.js',
                 '07zi_squid.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const gm = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));
const rm = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const PHYS = JSON.parse(readFileSync(join(ASSETS, 'block-physics.json'), 'utf8'));
NS.Reg.init({
  runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
  physics: { defaults: PHYS.defaults, exceptions: PHYS.exceptions },
});
NS.Blocks.init();
const Ph = NS.Physics, ES = NS.Effects, Sq = NS.Squid, SR = NS.States;

let pass = 0; const fails = [];
let MUTE = false, sectionOk = true;
const ok = (c, m) => { if (!c) sectionOk = false; if (MUTE) return c; if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const say = (s) => { if (VERBOSE && !MUTE) console.log('   ' + s); };
const f32 = Math.fround;

// ── the fake world: stone below y = 0, air above ─────────────────────────────────────────────
Ph.shapeAt = (x, y, z) => (y < 0 ? Ph.FULL_CUBE : null);
Ph.blockAt = (x, y, z) => (y < 0 ? SR.stateOf('stone') : 0);
let WET = false;   // the player's water law reads updateFluids; forced for §5 (encharmor's stub)
const realFluids = Ph.updateFluids;
Ph.updateFluids = (e) => (WET ? (e.inWater = true, e.eyeInWater = true, e) : realFluids(e));

const player = (over) => Object.assign({
  x: 0.5, y: 20, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, flying: false,
  inWater: false, noclip: false, height: Ph.H, eyeHeight: Ph.EYE, fallDistance: 0, effects: {},
}, over || {});
const mob = (over) => Object.assign({
  x: 0.5, y: 20, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, zza: 0, mobSpeed: 0.25, onGround: false,
  inWater: false, width: 0.6, height: 1.8, fallDistance: 0, effects: {},
}, over || {});
const CMD = (over) => Object.assign({ fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false }, over || {});
const give = (e, name, amp) => { ES.addStatusEffect(e, name, 1000, amp); return e; };

console.log('effectmovecheck — G23c (#295), movement effects in the physics');

// ═══════════ 0. the literals, read out of .decomp ═════════════════════════════════════════
const LE = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/LivingEntity.java'), 'utf8');
const SQ = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/passive/SquidEntity.java'), 'utf8');
const SE = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/effect/StatusEffects.java'), 'utf8');
const fld = {};
for (const m of SE.matchAll(/(field_\d+) = register\(\d+, "(\w+)"/g)) fld[m[2]] = m[1];
function sec0() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ok(new RegExp(`\\$\\$2 && this\\.hasStatusEffect\\(StatusEffects\\.${fld.slow_falling}\\)\\) \\{\\s*\\$\\$1 = ${esc(String(Ph.SLOW_FALL_GRAVITY))};\\s*this\\.onLanding\\(\\)`).test(LE),
     'travel: slow falling sets d = Ph.SLOW_FALL_GRAVITY and calls onLanding');
  ok(new RegExp(`\\$\\$29 \\+= \\(${esc(String(Ph.LEVITATION_STEP))} \\* \\(double\\)\\(this\\.getStatusEffect\\(StatusEffects\\.${fld.levitation}\\)\\.getAmplifier\\(\\) \\+ 1\\) - \\$\\$28\\.y\\) \\* 0\\.2;\\s*this\\.onLanding\\(\\)`).test(LE),
     'travel: levitation eases toward Ph.LEVITATION_STEP*(amp+1) by 0.2 and calls onLanding');
  ok(new RegExp(`hasStatusEffect\\(StatusEffects\\.${fld.dolphins_grace}\\)\\) \\{\\s*\\$\\$5 = ${esc(String(Ph.DOLPHIN_SLOWDOWN))}F;`).test(LE),
     'travel: dolphin\'s grace sets the water slowdown to Ph.DOLPHIN_SLOWDOWN');
  ok(new RegExp(`\\(double\\)\\(${esc(String(Ph.JUMP_BOOST_STEP))}F \\* \\(float\\)\\(this\\.getStatusEffect\\(StatusEffects\\.${fld.jump_boost}\\)\\.getAmplifier\\(\\) \\+ 1\\)\\)`).test(LE),
     'getJumpBoostVelocityModifier: (double)(Ph.JUMP_BOOST_STEP F * (float)(amp+1))');
  ok(new RegExp(`getStatusEffect\\(StatusEffects\\.${fld.jump_boost}\\);\\s*float \\$\\$3 = \\$\\$2 == null \\? 0\\.0F : \\(float\\)\\(\\$\\$2\\.getAmplifier\\(\\) \\+ 1\\);\\s*return MathHelper\\.ceil\\(\\(\\$\\$0 - 3\\.0F - \\$\\$3\\) \\* \\$\\$1\\)`).test(LE),
     'computeFallDamage: ceil((d - 3 - (amp+1)) * mult)');
  ok(new RegExp(`\\$\\$3 = 0\\.05 \\* \\(double\\)\\(this\\.getStatusEffect\\(StatusEffects\\.${fld.levitation}\\)\\.getAmplifier\\(\\) \\+ 1\\);`).test(SQ),
     'SquidEntity: levitation SETS vy = 0.05*(amp+1)');
}

// ═══════════ 1. player levitation ═════════════════════════════════════════════════════════
function sec1() {
  for (const amp of [0, 1, 4]) {
    const e = give(player(), 'levitation', amp);
    let y = e.y, vy = 0, good = true;
    for (let t = 0; t < 60; t++) {
      Ph.tick(e, CMD());
      y += vy; vy = (vy + (0.05 * (amp + 1) - vy) * 0.2) * Ph.DRAG_Y;
      if (!near(e.y, y) || !near(e.vy, vy) || e.fallDistance !== 0) { good = false; say(`lev ${amp} t${t}: y ${e.y} want ${y}`); break; }
    }
    ok(good, `levitation ${amp + 1}: 60-tick y trajectory matches vy += (0.05*(amp+1) - vy)*0.2, *0.98, fallDistance 0`);
    say(`levitation ${amp + 1}: y after 60 ticks ${e.y.toFixed(4)}`);
  }
}

// ═══════════ 2. player slow falling ═══════════════════════════════════════════════════════
function sec2() {
  const e = give(player({ y: 30 }), 'slow_falling', 0);
  let y = e.y, vy = 0, good = true, fdOk = true;
  for (let t = 0; t < 80; t++) {
    const y0 = e.y;
    Ph.tick(e, CMD());
    y += vy; vy = (vy - 0.01) * Ph.DRAG_Y;
    if (!near(e.fallDistance, y0 - e.y)) fdOk = false;
    if (!near(e.y, y) || !near(e.vy, vy)) { good = false; say(`slow t${t}: y ${e.y} want ${y}`); break; }
  }
  ok(good, 'slow falling: 80-tick y trajectory matches (vy - 0.01)*0.98');
  ok(fdOk, 'slow falling: onLanding resets fallDistance each tick, so it is only that tick\'s drop');
  // ascending (vy > 0) keeps the full 0.08: a jump with slow falling rises as a normal jump's first tick
  const j = give(player({ y: 0, onGround: true }), 'slow_falling', 0);
  Ph.tick(j, CMD({ jump: true }));
  ok(near(j.vy, (Ph.JUMP - 0.08) * Ph.DRAG_Y), `slow falling: vy > 0 after the jump keeps gravity 0.08 (${j.vy})`);
  // a long drop lands with no damage; the same drop without it hurts
  const drop = (eff) => { const d = player({ y: 25 }); if (eff) give(d, 'slow_falling', 0);
    for (let t = 0; t < 2000 && !d.onGround; t++) Ph.tick(d, CMD()); return d.pendingFallDamage || 0; };
  const a = drop(true), b = drop(false);
  ok(a === 0 && b > 0, `slow falling: a 25-block drop does ${a} damage (without it ${b})`);
}

// ═══════════ 3. jump boost (player + mob) ═════════════════════════════════════════════════
function sec3() {
  for (const amp of [-1, 0, 1, 3]) {
    const want = Ph.JUMP + (amp < 0 ? 0 : f32(f32(0.1) * (amp + 1)));
    const p = player({ y: 0, onGround: true }); if (amp >= 0) give(p, 'jump_boost', amp);
    Ph.tick(p, CMD({ jump: true }));
    ok(near(p.y, want) && near(p.vy, (want - 0.08) * Ph.DRAG_Y), `player jump, jump boost amp ${amp}: first tick rises ${want}`);
    const m = mob({ y: 0, onGround: true, jumping: true }); if (amp >= 0) give(m, 'jump_boost', amp);
    Ph.travelMob(m);
    ok(near(m.y, want), `mob jump, jump boost amp ${amp}: first tick rises ${want} (got ${m.y})`);
    say(`jump boost amp ${amp}: first-tick rise ${p.y}`);
  }
  ok(f32(f32(0.1) * 2) !== 0.2, 'the float product 0.1F*2 differs from the double 0.2 (the fround is observable)');
}

// ═══════════ 4. jump boost's fall damage ══════════════════════════════════════════════════
function sec4() {
  for (const amp of [-1, 0, 1, 2]) {
    const e = player({ y: 12.25 }); if (amp >= 0) give(e, 'jump_boost', amp);
    for (let t = 0; t < 200 && !e.onGround; t++) Ph.tick(e, CMD());
    const want = Math.max(0, Math.ceil(e.landedFrom - 3 - (amp + 1)));
    ok(e.landedFrom > 11 && e.pendingFallDamage === want,
       `jump boost amp ${amp}: a ${e.landedFrom && e.landedFrom.toFixed(3)}-block fall does ${e.pendingFallDamage} (want ${want})`);
  }
}

// ═══════════ 5. dolphin's grace ═══════════════════════════════════════════════════════════
function sec5() {
  // mob: vanilla's shape, f = 0.96 horizontally, 0.8 vertically, then -d/16
  for (const eff of [false, true]) {
    const m = mob({ inWater: true, vx: 0.5, vy: 0.1 }); if (eff) give(m, 'dolphins_grace', 0);
    let x = m.x, vx = 0.5, y = m.y, vy = 0.1, good = true; const f = eff ? 0.96 : 0.8;
    for (let t = 0; t < 30; t++) {
      Ph.travelMob(m);
      x += vx; vx *= f; y += vy; vy = vy * 0.8 - 0.08 / 16;
      if (!near(m.x, x) || !near(m.vx, vx) || !near(m.y, y, 1e-9)) { good = false; say(`mob dg=${eff} t${t}: x ${m.x} want ${x}, y ${m.y} want ${y}`); break; }
    }
    ok(good, `mob in water, dolphin's grace ${eff}: 30-tick x,y trajectory matches vx*${f}, vy*0.8 - 0.08/16`);
  }
  // player: the horizontal drag becomes 0.96, the vertical stays the water law's own
  WET = true;
  try {
    for (const eff of [false, true]) {
      const p = player({ vx: 0.5 }); if (eff) give(p, 'dolphins_grace', 0);
      let x = p.x, vx = 0.5, y = p.y, vy = 0, good = true; const f = eff ? 0.96 : Ph.WATER_FRICTION;
      for (let t = 0; t < 30; t++) {
        Ph.tick(p, CMD());
        x += vx; vx *= f; y += vy; vy *= 0.8; { const g = Ph.GRAVITY / 16; if (vy <= 0 && Math.abs(vy - 0.005) >= 0.003 && Math.abs(vy - g) < 0.003) vy = -0.003; else vy -= g; }
        if (!near(p.x, x) || !near(p.y, y)) { good = false; say(`player dg=${eff} t${t}: x ${p.x} want ${x}, y ${p.y} want ${y}`); break; }
      }
      ok(good, `player in water, dolphin's grace ${eff}: horizontal *${f}, vertical is the fluid-falling law (*0.8, gravity/16)`);
    }
  } finally { WET = false; }
}

// ═══════════ 6. mob levitation / slow falling (the generic land law) ═══════════════════════
function sec6() {
  const m = give(mob(), 'levitation', 1);
  let y = m.y, vy = 0, good = true;
  for (let t = 0; t < 40; t++) {
    Ph.travelMob(m);
    y += vy; vy = (vy + (0.05 * 2 - vy) * 0.2) * Ph.DRAG_Y;
    if (!near(m.y, y) || m.fallDistance !== 0) { good = false; break; }
  }
  ok(good, 'mob levitation II: 40-tick y trajectory matches, fallDistance 0');
  const s = give(mob(), 'slow_falling', 0);
  y = s.y; vy = 0; good = true;
  for (let t = 0; t < 40; t++) {
    Ph.travelMob(s);
    y += vy; vy = (vy - 0.01) * Ph.DRAG_Y;
    if (!near(s.y, y)) { good = false; break; }
  }
  ok(good, 'mob slow falling: 40-tick y trajectory matches (vy - 0.01)*0.98');
  const n = give(mob({ noGravity: true }), 'levitation', 0);
  Ph.travelMob(n); Ph.travelMob(n);
  ok(n.y > 20, 'levitation lifts even a noGravity mob (it is checked before hasNoGravity)');
}

// ═══════════ 7. squid levitation (SquidEntity.tickMovement, out of water) ═════════════════
function sec7() {
  for (const amp of [-1, 0, 2]) {
    const e = { type: 'squid', x: 0, y: 70, z: 0, vx: 0, vy: -0.3, vz: 0, inWater: false, effects: {} };
    Sq.spawnInit(e); e.vy = -0.3;
    if (amp >= 0) give(e, 'levitation', amp);
    Sq.tickMovement(e);
    const want = (amp >= 0 ? 0.05 * (amp + 1) : -0.3 - 0.08) * 0.98;
    ok(near(e.vy, want), `squid out of water, levitation amp ${amp}: vy = ${want} (got ${e.vy})`);
  }
}

const SECTIONS = [sec0, sec1, sec2, sec3, sec4, sec5, sec6, sec7];
const runSec = (s) => { sectionOk = true; s(); return sectionOk; };
for (const s of SECTIONS) { say(`\n${s.name}`); runSec(s); }

// ═══════════ 8. anti-vacuity: every break must turn a section red ═════════════════════════
let breaks = 0;
function breakIt(label, secs, apply) {
  const undo = apply();
  MUTE = true;
  let caught;
  try { caught = secs.some((s) => !runSec(s)); } catch (err) { caught = true; }
  finally { MUTE = false; undo(); }
  ok(caught, `anti-vacuity: ${label} is caught`);
  if (caught) { breaks++; console.log(`   ✓ break caught: ${label}`); }
}
const setK = (k, v) => () => { const o = Ph[k]; Ph[k] = v; return () => { Ph[k] = o; }; };
const hideEffect = (name) => () => { const o = ES.amplifierOf;
  ES.amplifierOf = (e, n) => (n === name ? -1 : o(e, n)); return () => { ES.amplifierOf = o; }; };
breakIt('levitation step 0.05 -> 0.04', [sec1, sec6], setK('LEVITATION_STEP', 0.04));
breakIt('slow-falling gravity 0.01 -> 0.02', [sec2, sec6], setK('SLOW_FALL_GRAVITY', 0.02));
breakIt('dolphin slowdown 0.96 -> 0.9', [sec5], setK('DOLPHIN_SLOWDOWN', 0.9));
breakIt('jump boost step 0.1 -> 0.2', [sec3], setK('JUMP_BOOST_STEP', 0.2));
breakIt('levitation read dropped', [sec1, sec6, sec7], hideEffect('levitation'));
breakIt('slow falling read dropped', [sec2, sec6], hideEffect('slow_falling'));
breakIt('dolphin\'s grace read dropped', [sec5], hideEffect('dolphins_grace'));
breakIt('jump boost read dropped (velocity and fall damage)', [sec3, sec4], hideEffect('jump_boost'));
breakIt('fall damage ignores jump boost', [sec4], () => { const o = Ph.jumpBoostLevel; let inJump = false;
  const oj = Ph.jumpBoostVelocity; Ph.jumpBoostVelocity = (e) => { inJump = true; try { return oj(e); } finally { inJump = false; } };
  Ph.jumpBoostLevel = (e) => (inJump ? o(e) : 0);
  return () => { Ph.jumpBoostLevel = o; Ph.jumpBoostVelocity = oj; }; });
breakIt('jump boost in double, not float', [sec3], () => { const o = Ph.jumpBoostVelocity;
  Ph.jumpBoostVelocity = (e) => 0.1 * Ph.jumpBoostLevel(e); return () => { Ph.jumpBoostVelocity = o; }; });

console.log('\n============== effectmovecheck ============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log(`${breaks} breaks caught`);
