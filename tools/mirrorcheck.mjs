#!/usr/bin/env node
// mirrorcheck.mjs — #1017: invisible illusioner draws 4 mirror-image ghosts; any other invisible mob draws none.
//   IllusionerEntity.tickMovement (.decomp, :101-137), method_7065 (:144-158),
//   IllusionerEntityRenderer.method_3991 (draw 4 copies while isInvisible()).
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07w_passive.js', '07y_equip.js', '07r_mount.js', '07ze_llama.js', '07zt_wtrader.js', '07q_effects.js', '07v_spell.js', '07zx_particle.js', '07zzp_mobvoice.js',
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
{
  const im = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: im.rawBytes });
}
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
M.Passive.init();
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
const ER = M.EntityRender, SP = M.Spell, ES = M.Effects;
if (ES.init) ES.init();
const mk = (type, over) => Object.assign({ type, x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 1, width: 0.6, height: 1.95, hurtTime: 0, health: 32 }, over || {});
const drawn = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1).filter((it) => it.shape === 'mob').length; };

const ill = mk('illusioner');
ok(drawn(ill) === 1, 'a visible illusioner draws once');
ES.addStatusEffect(ill, 'invisibility', 1000, 0, false, false, false);
ok(ES.hasStatusEffect(ill, 'invisibility'), 'illusioner is invisible');
ok(drawn(ill) === 4, 'an invisible illusioner draws exactly 4 ghost copies (got ' + drawn(ill) + ')');
// #1261: each ghost carries the held-item layer while attacking (IllusionerEntityRenderer.method_3991 -> super.render per ghost)
{
  const IT = M.Items, Eq = M.Equip;
  const heldOf = (e) => { M.EntityList.list = [e]; return ER.visible(0, 5, 0, 1).filter((it) => it.held || it.ghost && it.shape !== 'mob' || it.shape === 'bow'); };
  const bowId = IT.of('bow');
  ok(IT.ready && Eq && BEready(), 'items/equip/model are ready for the held-item layer');
  ill.maxHealth = 32;
  Eq.setEquipped(ill, IT.MAINHAND, { i: bowId, n: 1 });
  ill.attacking = false;
  ok(heldOf(ill).length === 0, 'a non-attacking ghost illusioner holds nothing');
  ill.attacking = true;
  const h = heldOf(ill);
  const gs = new Set(h.map((it) => it.ghost));
  ok(h.length >= 4 && [1, 2, 3, 4].every((g) => gs.has(g)), 'every one of the 4 ghosts carries a held item when attacking (got ' + h.length + ')');
  const sv = ER.heldItemsFor; ER.heldItemsFor = () => [];
  okAv(heldOf(ill).length < 4, 'without the held-item layer the ghosts hold nothing');
  ER.heldItemsFor = sv;
  ill.attacking = false;
}
function BEready() { return M.BEModel.ready; }
const zom = mk('zombie');
ES.addStatusEffect(zom, 'invisibility', 1000, 0, false, false, false);
ok(drawn(zom) === 0, 'an invisible zombie draws nothing');

// tick half: hurtTime==1 re-rolls offsets, 16 puffs, sound
const sounds = [];
M.Sound = { play: (ev) => { sounds.push(ev); return true; } };
M.Particle.init();
ill.hurtTime = 1;
SP.tickMirror(ill, () => 0.99);
ok(ill.mirrorTicks === 3, 'hurtTime==1 sets mirrorTicks=3');
ok(M.Particle.list.length === 16, '16 cloud puffs (got ' + M.Particle.list.length + ')');
// #2846: CLOUD (CloudParticle.java): maxAge max(int(8/(r*0.8+0.3))*2.5,1), no gravity, drag 0.96, grey 0.7..1
ok(M.Particle.list.every((p) => p.type === 'cloud' && p.gravityStrength === 0 && p.velocityMultiplier === 0.96 &&
   p.maxAge === 17 && p.shade >= 0.7 && p.shade <= 1), 'puffs are type cloud with CloudParticle numbers');
okAv(M.Particle.list.every((p) => p.type !== 'smoke'), 'a smoke puff would be caught');
ok(sounds.includes('entity.illusioner.mirror_move'), 'mirror_move sound played');
const o = SP.mirrorOffsets(ill, 3);
ok(o.length === 4 && o.some((v) => v[0] !== 0 || v[2] !== 0), 'offsets are non-zero after the roll');
// age % 1200 == 0 also fires
ill.hurtTime = 0; ill.age = 1200; ill.mirrorTicks = 0; sounds.length = 0;
SP.tickMirror(ill, () => 0.5);
ok(sounds.length === 1, 'age%1200==0 fires the mirror move');
// not invisible: no tick effect
const vis = mk('illusioner', { hurtTime: 1 }); sounds.length = 0;
ok(SP.tickMirror(vis) === false && sounds.length === 0, 'a visible illusioner does not mirror-move');

// anti-vacuity: break each piece and watch the assertion fail
{
  const saved = SP.mirrorOffsets;
  SP.mirrorOffsets = () => [];
  okAv(drawn(ill) !== 4, 'with no offsets the ghost count is not 4');
  SP.mirrorOffsets = saved;
  const sv = ER.invisibleMob; ER.invisibleMob = () => false;
  okAv(drawn(ill) !== 4, 'without the invisibility gate the illusioner draws once, not 4');
  ER.invisibleMob = sv;
  M.Sound = { play: () => false }; sounds.length = 0; ill.age = 2400;
  SP.tickMirror(ill, () => 0.5);
  okAv(!sounds.includes('entity.illusioner.mirror_move'), 'a muted Sound records no mirror_move');
}

console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL: ' + f);
if (fails.length) process.exit(1);
