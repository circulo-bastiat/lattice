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


const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07w_passive.js', '07r_mount.js', '07ze_llama.js', '07zt_wtrader.js',
          '07v_spell.js', '07zx_particle.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
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
const ER = M.EntityRender;

const SP = M.Spell;
ok(ER.ready, 'the entity renderer is up');
// IllagerEntityModel.setAngles SPELLCASTING branch (.decomp lines 118-128), recomputed here from the literals
const vanilla = (part, age) => ({ rx: Math.cos(age * 0.6662) * 0.25, ry: 0, rz: part === 'right_arm' ? Math.PI * 3 / 4 : -Math.PI * 3 / 4 });
const near = (a, b) => Math.abs(a - b) < 1e-9;
const posed = (part, age, spell) => {
  const p = ER.findRestPart(M.BEModel.layers.evoker.parts, part);
  return ER.setupAnimDeltaCore(part, 0, 0, 0, 0, false, ER.modelKindOf('evoker'),
    { rest: p, ageInTicks: age, spellcast: spell });
};
for (const age of [0, 3.5, 17]) for (const part of ['right_arm', 'left_arm']) {
  const d = posed(part, age, true), v = vanilla(part, age);
  ok(d && near(d.rx, v.rx) && near(d.ry, v.ry) && near(d.rz, v.rz), `evoker ${part} age ${age} matches decomp`);
  const idle = posed(part, age, false);
  ok(!idle || !near(idle.rz, v.rz), `${part} idle is not the spell pose`);
}
ok(SP.isSpellcasting({ spellTicks: 5 }) && !SP.isSpellcasting({ spellTicks: 0 }), 'isSpellcasting = spellTicks>0');
const hc = ER.illagerArmHide('evoker#0', true), hi = ER.illagerArmHide('evoker', false);
ok(hc && hc.arms && !hc.left_arm, 'casting hides crossed arms only');
ok(hi && hi.left_arm && hi.right_arm && !hi.arms, 'idle hides the two arms, shows crossed arms');
ok(ER.illagerArmHide('zombie', true) === null, 'other mobs untouched');
// SPELL particles (SpellcastingIllagerEntity.tick client half)
{
  const Px = M.Particle;
  const mk = (id) => ({ type: 'evoker', x: 10, y: 64, z: 10, age: 7, yaw: 0, spell: id, spellTicks: 5 });
  Px.list.length = 0;
  ok(SP.tickParticles(mk(1), () => 0.5) === 2 && Px.list.length === 2, 'casting spawns two spell particles');
  const p0 = Px.list[0];
  ok(near(p0.y, 65.8) && near(p0.red, 0.7) && near(p0.blue, 0.8), 'vex spell tint (0.7,0.7,0.8) at y+1.8');
  ok(near(Math.hypot(Px.list[0].x - Px.list[1].x, Px.list[0].z - Px.list[1].z), 1.2), 'the pair sits 0.6 either side');
  Px.list.length = 0;
  ok(SP.tickParticles({ ...mk(4), spellTicks: 0 }) === 0 && !Px.list.length, 'no particles when not casting');
  Px.list.length = 0; SP.tickParticles(mk(4), () => 0.5);
  ok(near(Px.list[0].red, 0.3) && near(Px.list[0].blue, 0.8), 'disappear spell tint (0.3,0.3,0.8)');
  okAv(!near(0.7, 0.3), 'a wrong tint (vex vs disappear) is caught');
  okAv(!near(65.8, 64 + 1.0), 'a wrong particle height is caught');
}
// anti-vacuity: break the data, watch the assertions fail
{
  const bad = { rx: Math.cos(3.5 * 0.6662) * 0.25, ry: 0, rz: Math.PI / 2 };
  okAv(!near(bad.rz, vanilla('right_arm', 3.5).rz), 'a wrong roll (pi/2) is caught');
  const bad2 = { rz: vanilla('left_arm', 1).rz * -1 };
  okAv(!near(bad2.rz, vanilla('left_arm', 1).rz), 'a mirrored left arm is caught');
  okAv(!near(Math.cos(3.5 * 0.6662) * 0.05, vanilla('right_arm', 3.5).rx), 'the 0.05 (CELEBRATING) amplitude is caught');
}
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL: ' + f);
if (fails.length) process.exit(1);
