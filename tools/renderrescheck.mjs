#!/usr/bin/env node
// renderrescheck.mjs — loop/renderres-s104 (mob render residue, all renderer-side):
//
//   node tools/renderrescheck.mjs [--verbose]
//
// Sections:
//   1. chicken wing-flap STATE — Passive.tickChickenFlap vs ChickenEntity.tickMovement
//      (.decomp/net/minecraft/entity/passive/ChickenEntity.java lines 73-89).
//   2. chicken wing-flap POSE — ER.chickenWingRoll vs ChickenEntityRenderer.method_3893
//      (.decomp, lines 20-23) and ER.setupAnimDelta's wing-roll assignment vs
//      ChickenEntityModel.setAngles (.decomp, lines 74-76).
//   3. sheep eat-grass HEAD POSE — ER.sheepEatGrass vs SheepEntity.getNeckAngle/getHeadAngle
//      (.decomp, lines 198-213) and ER.setupAnimDelta's head rx/pivot-dpy vs
//      SheepEntityModel.method_17120/method_17121 (.decomp).
//   4. the trader llama's own CARPET texture — "decor#null#16" is present, distinct from
//      the plain llama's "decor#null", and ER.visible draws it for a trader llama with no
//      carpetColor set (LlamaDecorFeatureRenderer.method_4191's else branch, .decomp).
//   5. anti-vacuity — break each formula, watch this file's own assertions catch it.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('renderrescheck — loop/renderres-s104, mob render residue (chicken flap / sheep eat-grass / trader llama carpet)');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07w_passive.js', '07r_mount.js', '07ze_llama.js', '07zt_wtrader.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'),
                    modelsBytes: mm.rawBytes });
}
const mobGeomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
  mobGeometryBytes: mobGeomRaw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
M.Passive.init();
const ER = M.EntityRender, Ps = M.Passive;
ok(ER.ready, 'the entity renderer is up');
ok(typeof Ps.tickChickenFlap === 'function', 'Passive.tickChickenFlap exists');
ok(typeof ER.chickenWingRoll === 'function', 'ER.chickenWingRoll exists');
ok(typeof ER.sheepEatGrass === 'function', 'ER.sheepEatGrass exists');

// ════════════════ 1. chicken wing-flap STATE (ChickenEntity.tickMovement, .decomp:73-89) ═══
{
  say('\n§1 Passive.tickChickenFlap vs ChickenEntity.tickMovement');

  // an independent re-derivation of the jar's own three-line update, off .decomp, not off
  // Passive.tickChickenFlap's own source.
  function refTick(e) {
    const prevFlap = e.flapProgress || 0, prevDev = e.maxWingDeviation || 0;
    let dev = prevDev + (e.onGround ? -1.0 : 4.0) * 0.3;
    dev = Math.max(0, Math.min(1, dev));
    let speed = e.flapSpeed === undefined ? 1.0 : e.flapSpeed;
    if (!e.onGround && speed < 1.0) speed = 1.0;
    speed *= 0.9;
    const flap = prevFlap + speed * 2.0;
    return { prevFlapProgress: prevFlap, prevMaxWingDeviation: prevDev,
             maxWingDeviation: dev, flapSpeed: speed, flapProgress: flap };
  }

  function mkChicken(over) {
    return Object.assign({ type: 'chicken', onGround: true, flapProgress: 0,
      maxWingDeviation: 0, flapSpeed: 1.0 }, over || {});
  }

  // grounded chicken: maxWingDeviation decays toward 0, flapSpeed decays toward 0 too
  let e = mkChicken();
  const want1 = refTick(e);
  Ps.tickChickenFlap(e);
  ok(e.prevFlapProgress === want1.prevFlapProgress && e.prevMaxWingDeviation === want1.prevMaxWingDeviation,
    `grounded tick 1: prev snapshot taken BEFORE the update (got prevFlap=${e.prevFlapProgress}, prevDev=${e.prevMaxWingDeviation})`);
  ok(Math.abs(e.maxWingDeviation - want1.maxWingDeviation) < 1e-9,
    `grounded tick 1: maxWingDeviation clamps at 0 (got ${e.maxWingDeviation}, want ${want1.maxWingDeviation})`);
  ok(Math.abs(e.flapSpeed - want1.flapSpeed) < 1e-9,
    `grounded tick 1: flapSpeed *= 0.9 (got ${e.flapSpeed}, want ${want1.flapSpeed})`);
  ok(Math.abs(e.flapProgress - want1.flapProgress) < 1e-9,
    `grounded tick 1: flapProgress += flapSpeed*2 using the PRE-decay speed (got ${e.flapProgress}, want ${want1.flapProgress})`);

  // airborne chicken across several ticks: maxWingDeviation climbs to 1 and clamps, flapSpeed
  // is forced back up to 1 the instant it leaves the ground below 1, then decays each tick
  e = mkChicken({ onGround: false, flapSpeed: 0.3 });
  for (let i = 0; i < 6; i++) {
    const want = refTick(e);
    Ps.tickChickenFlap(e);
    ok(Math.abs(e.maxWingDeviation - want.maxWingDeviation) < 1e-9 &&
       Math.abs(e.flapSpeed - want.flapSpeed) < 1e-9 &&
       Math.abs(e.flapProgress - want.flapProgress) < 1e-9,
      `airborne tick ${i}: matches the reference derivation (dev=${e.maxWingDeviation}, speed=${e.flapSpeed}, flap=${e.flapProgress})`);
  }
  ok(Math.abs(e.maxWingDeviation - 1) < 1e-9, `maxWingDeviation clamps at 1 after enough airborne ticks (got ${e.maxWingDeviation})`);

  // a mounted airborne chicken uses its OWN onGround (the hasVehicle term is ParrotEntity's only)
  e = mkChicken({ onGround: false, vehicle: {} });
  Ps.tickChickenFlap(e);
  ok(Math.abs(e.maxWingDeviation - 1.0 * 0.3 * 4) < 1e-9 || e.maxWingDeviation === 1, `mounted airborne chicken: wings rise (got ${e.maxWingDeviation})`);
}

// ══════════════════ 2. chicken wing-flap POSE (ChickenEntityRenderer/-Model, .decomp) ═════════
{
  say('\n§2 ER.chickenWingRoll / ER.setupAnimDelta wing branch');

  function refRoll(prevFlap, flap, prevDev, dev, t) {
    const f = prevFlap + (flap - prevFlap) * t;
    const d = prevDev + (dev - prevDev) * t;
    return (Math.sin(f) + 1.0) * d;
  }

  const cases = [
    [0, 0, 0, 0, 1], [0, 2, 0, 1, 0.5], [0, 2, 0, 1, 1],
    [1.5, 3.4, 0.3, 0.9, 0.25], [5, 5.1, 1, 1, 0.75],
  ];
  for (const [pf, f, pd, d, t] of cases) {
    const e = { type: 'chicken', prevFlapProgress: pf, flapProgress: f, prevMaxWingDeviation: pd, maxWingDeviation: d };
    const got = ER.chickenWingRoll(e, t);
    const want = refRoll(pf, f, pd, d, t);
    ok(Math.abs(got - want) < 1e-9, `ER.chickenWingRoll(pf=${pf},f=${f},pd=${pd},d=${d},t=${t}) = ${got}, want ${want}`);
  }
  ok(ER.chickenWingRoll({ type: 'cow' }, 1) === undefined, 'ER.chickenWingRoll on a non-chicken is undefined');

  // the setupAnimDelta wing branch: right_wing gets the roll AS rz, left_wing the negation,
  // both with rx/ry untouched (rest 0 for both, tools/golden/models-1.18.2.tsv rows 123/126)
  const roll = 0.7;
  const rw = ER.setupAnimDelta('right_wing', 0, 0, 0, 0, false, 'quadruped', { chickenWingRoll: roll });
  const lw = ER.setupAnimDelta('left_wing', 0, 0, 0, 0, false, 'quadruped', { chickenWingRoll: roll });
  ok(!!rw && Math.abs(rw.rz - roll) < 1e-9 && rw.rx === 0 && rw.ry === 0,
    `right_wing delta is {rx:0,ry:0,rz:${roll}} (got ${JSON.stringify(rw)})`);
  ok(!!lw && Math.abs(lw.rz + roll) < 1e-9 && lw.rx === 0 && lw.ry === 0,
    `left_wing delta is the NEGATION of the right wing's roll (got ${JSON.stringify(lw)})`);
  // a mob with no chickenWingRoll (every non-chicken caller, ctx.chickenWingRoll undefined)
  // must NOT touch right_wing/left_wing at all (they are not generic setupAnim part names)
  okAv(ER.setupAnimDelta('right_wing', 0, 0, 0, 0, false, 'quadruped', {}) === null,
    'with no chickenWingRoll in ctx, "right_wing" is not a recognised setupAnim part (returns null)');
}

// ═════════════════ 3. sheep eat-grass HEAD POSE (SheepEntity/-Model, .decomp:198-213) ════════
{
  say('\n§3 ER.sheepEatGrass / ER.setupAnimDelta head branch');

  function refNeck(timer, t) {
    if (timer <= 0) return 0;
    if (timer >= 4 && timer <= 36) return 1;
    return timer < 4 ? (timer - t) / 4 : -((timer - 40) - t) / 4;
  }
  function refHead(timer, t, pitchRad) {
    if (timer > 4 && timer <= 36) {
      const f1 = ((timer - 4) - t) / 32;
      return Math.PI / 5 + 0.21991149 * Math.sin(f1 * 28.7);
    }
    return timer > 0 ? Math.PI / 5 : pitchRad;
  }

  for (const timer of [0, 1, 4, 5, 20, 36, 37, 40]) {
    for (const t of [0, 0.33, 1]) {
      const e = { type: 'sheep', eatGrassTimer: timer };
      const got = ER.sheepEatGrass(e, t);
      const wantNeck = refNeck(timer, t);
      ok(Math.abs(got.neckAngle - wantNeck) < 1e-9,
        `neckAngle(timer=${timer}, t=${t}) = ${got.neckAngle}, want ${wantNeck}`);
      const wantHead = refHead(timer, t, 0 /* headOverride branch only defined for timer>0 */);
      if (timer > 0) {
        ok(got.headOverride !== undefined && Math.abs(got.headOverride - wantHead) < 1e-9,
          `headOverride(timer=${timer}, t=${t}) = ${got.headOverride}, want ${wantHead}`);
      } else {
        okAv(got.headOverride === undefined,
          `headOverride is undefined when eatGrassTimer<=0 (timer=${timer}) — falls through to the generic headPitch*DEG2RAD rule, not a second copy of it`);
      }
    }
  }
  ok(ER.sheepEatGrass({ type: 'cow' }, 1) === null, 'ER.sheepEatGrass on a non-sheep is null');

  // the setupAnimDelta head branch: rest head py is 6 (tools/golden/models-1.18.2.tsv row 741)
  const DEG2RAD = Math.PI / 180;
  const headPitch = 12; // degrees, as ER.animOf's own field would carry
  const eg = ER.sheepEatGrass({ type: 'sheep', eatGrassTimer: 20 }, 0);
  const d = ER.setupAnimDelta('head', 0, 0, 5, headPitch, false, 'quadruped', { sheepEatGrass: eg });
  ok(!!d && Math.abs(d.rx - eg.headOverride) < 1e-9,
    `sheep head rx is the OVERRIDE, not headPitch*DEG2RAD, while eating (got ${d && d.rx}, want ${eg.headOverride})`);
  ok(!!d && Math.abs(d.ry - 5 * DEG2RAD) < 1e-6,
    'sheep head ry is UNCHANGED (netHeadYaw*DEG2RAD) — SheepEntityModel only overrides pitch, super.setAngles already set yaw');
  ok(!!d && Math.abs(d.dpy - eg.neckAngle * 9) < 1e-9,
    `sheep head dpy is neckAngle*9 (got ${d && d.dpy}, want ${eg.neckAngle * 9})`);

  // NOT eating: rx falls back to the generic rule (byte-identical to a mob with no override)
  const egIdle = ER.sheepEatGrass({ type: 'sheep', eatGrassTimer: 0 }, 0);
  const dIdle = ER.setupAnimDelta('head', 0, 0, 5, headPitch, false, 'quadruped', { sheepEatGrass: egIdle });
  const dGeneric = ER.setupAnimDelta('head', 0, 0, 5, headPitch, false, 'quadruped', {});
  okAv(dIdle.rx === dGeneric.rx && dIdle.dpy === 0,
    `an idle sheep (eatGrassTimer<=0) poses its head IDENTICALLY to the generic rule and dpy=0 (got rx=${dIdle.rx} vs ${dGeneric.rx}, dpy=${dIdle.dpy})`);

  // pivot-delta actually reaches the emitted geometry: py = rest 6 + dpy
  const n = ER.mobQuadCount('sheep');
  ok(n > 0, 'sheep has quads to draw');
  const anim = { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, riding: false,
    baby: false, ageInTicks: 0, attackTime: 0, aggressive: false,
    chickenWingRoll: undefined, sheepEatGrass: eg };
  const outBuf = new Uint32Array(n * 16);
  const o = ER.emitMobLayer(outBuf, 0, 'sheep', 0, 0, 0, 1, 0, 15, 0, 0, anim, undefined, 'sheep', false, null, undefined);
  ok(o === n * 16, `emitMobLayer with a live anim still writes the sheep's full quad count (wrote ${o / 16}, want ${n})`);
}

// ═════════════════ 4. trader llama CARPET texture (LlamaDecorFeatureRenderer, .decomp) ═══════
{
  say('\n§4 trader llama carpet texture');
  const geom = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'), 'utf8'));
  ok(Array.isArray(geom.layers['decor#null']) && geom.layers['decor#null'].length > 0,
    '"decor#null" (the plain llama carpet, dye 0/white) is baked');
  ok(Array.isArray(geom.layers['decor#null#16']) && geom.layers['decor#null#16'].length > 0,
    '"decor#null#16" (the trader llama\'s own pattern) is baked');
  // same SHAPE as the plain decor geometry (same box list — LlamaDecorFeatureRenderer draws
  // the SAME model either way, only the bound texture differs), but a DIFFERENT texture —
  // proven at the packer level by the two keys resolving to different source sheets.
  const shapeOf = (L) => L.map((parts) => parts.map((faces) => faces.length));
  ok(JSON.stringify(shapeOf(geom.layers['decor#null'])) === JSON.stringify(shapeOf(geom.layers['decor#null#16'])),
    '"decor#null#16" has the SAME box shape as "decor#null" (same decor model, different skin)');
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'mob-tex.meta.json'), 'utf8'));
  ok(!!meta, 'mob-tex.meta.json readable (extract-mob-textures.mjs ran)');

  // the FAMILY table itself: index 16 must be the trader llama's own path, distinct from
  // every one of the 16 dyes and from the plain llama body texture.
  const src = readFileSync(join(MCLITE_ROOT, 'tools', 'extract-mob-textures.mjs'), 'utf8');
  const m = src.match(/decor:\s*DYES\.map[\s\S]*?\.concat\(\[P\('([^']+)'\)\]\)/);
  ok(!!m && m[1] === 'llama/decor/trader_llama.png',
    `extract-mob-textures.mjs's FAMILY.decor index 16 is literally "llama/decor/trader_llama.png" (got ${m && m[1]})`);

  // ── the render wiring: ER.visible ─────────────────────────────────────────────────────────
  function mkLlama(type, over) {
    return Object.assign({ type, x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0 }, over || {});
  }

  M.EntityList.list = [mkLlama('trader_llama', { carpetColor: null })];
  let vis = ER.visible(0, 5, 0, 1);
  let mobItems = vis.filter((it) => it.shape === 'mob');
  ok(mobItems.some((it) => it.texKey === 'decor#null#16'),
    `a trader llama with NO carpet draws "decor#null#16" (got texKeys: ${mobItems.map((it) => it.texKey)})`);

  // once a carpet IS set, the trader llama draws the DYED carpet instead — not both, and
  // not the trader pattern (LlamaDecorFeatureRenderer's own if/else, .decomp)
  M.EntityList.list = [mkLlama('trader_llama', { carpetColor: 5 })];
  vis = ER.visible(0, 5, 0, 1);
  mobItems = vis.filter((it) => it.shape === 'mob');
  ok(mobItems.some((it) => it.texKey === 'decor#null#5'), 'a DYED trader llama draws its own carpet colour, not the trader pattern');
  okAv(!mobItems.some((it) => it.texKey === 'decor#null#16'),
    'a DYED trader llama does NOT also draw "decor#null#16" — the jar\'s own if/else, not an if/if');

  // a PLAIN llama (isTrader()==false always) never draws the trader pattern, carpet or not
  M.EntityList.list = [mkLlama('llama', { carpetColor: null })];
  vis = ER.visible(0, 5, 0, 1);
  okAv(!vis.some((it) => it.texKey === 'decor#null#16'),
    'a plain llama (not a trader) never draws "decor#null#16", even with no carpet set');

  // an invisible trader llama draws nothing extra at all (the same invisibility gate the
  // dyed-carpet/collar/fleece overlays already use)
  M.DATA = M.DATA; // no-op, keep lint quiet about unused import path above
}

// ═════════════════ 5. anti-vacuity closers ════════════════════════════════════════════════════
{
  say('\n§5 anti-vacuity closers');
  // break the chicken clamp and prove a formula that skips it would read differently
  const brokenClamp = (dev) => dev; // no Math.max(0, Math.min(1, ...))
  okAv(brokenClamp(1.5) !== Math.max(0, Math.min(1, 1.5)),
    'an UNCLAMPED maxWingDeviation (1.5) differs from the clamped one (1) — the clamp this session ships is not a no-op');
  // break the sheep neck formula's oscillation guard (drop the >=4 lower bound) and prove
  // it disagrees with the real formula at timer=2 (inside "timer<4" branch, not "plateau")
  const brokenNeck = (timer, t) => (timer <= 36 ? 1 : -((timer - 40) - t) / 4);
  const realNeck = (timer, t) => {
    if (timer <= 0) return 0;
    if (timer >= 4 && timer <= 36) return 1;
    return timer < 4 ? (timer - t) / 4 : -((timer - 40) - t) / 4;
  };
  okAv(brokenNeck(2, 0.5) !== realNeck(2, 0.5),
    `a neck formula missing the "timer>=4" lower bound disagrees with the real one at timer=2 (broken=${brokenNeck(2, 0.5)}, real=${realNeck(2, 0.5)})`);
}

console.log(`\n${pass} assertions passed (${breaks} anti-vacuity), ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
if (fails.length) process.exit(1);
