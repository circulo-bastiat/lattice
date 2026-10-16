#!/usr/bin/env node
// armorstandcheck -- #4392: ArmorStandEntity.damage via Combat.hurt (hit sound+hitTime, 2nd punch <=5 ticks drops, explosion, creative).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('armorstandcheck -- #4392, ArmorStandEntity.damage');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({
    extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
            '14e_gamemode.js', '07zzp_mobvoice.js', '07q_effects.js', '07b_behaviour.js', '14j_combat.js', '14d_survival.js'],
    initReg: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Combat.init();
  const Cb = M.Combat, EL = M.EntityList, B = M.Behave;
  M.Items.index = Object.assign(M.Items.index || {}, { armor_stand: 5 });
  const dust = []; M.Particle = { spawnBlockDust: (...a) => dust.push(a) }; M.States = { stateOf: () => 7 };
  const sounds = []; M.Sound = { play: (ev) => sounds.push(ev) };
  const P = M.Player = { x: 2, y: 64, z: 0, inventory: null, slot: 0 };
  const items = () => EL.list.filter((x) => x.type === 'item');
  const mk = () => { const e = { type: 'armor_stand', x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, width: 0.5, height: 1.975, health: 20, maxHealth: 20,
    removed: false, equip: [] }; EL.list.push(e); return e; };

  EL.list.length = 0; B.gameTime = 100;
  let e = mk(); e.equip[5] = { i: 1, n: 1 };
  Cb.hurt(e, 1, undefined, true);
  ok(!e.removed && e.lastHitTime === 100 && sounds.includes('entity.armor_stand.hit'), 'first punch: hit sound + hitTime, still standing');
  B.gameTime = 103; Cb.hurt(e, 1, undefined, true);
  ok(e.removed && sounds.includes('entity.armor_stand.break'), 'second punch within 5 ticks breaks it');
  ok(dust.length === 10 && dust[0][6] === 7, 'break spawns 10 oak_planks particles (got ' + dust.length + ')');
  ok(items().length === 2, 'drops the armor_stand item + the worn helmet (got ' + items().length + ')');
  ok(items().every((it) => Math.abs(it.x - 0.5) <= 0.25 + 1e-9 && Math.abs(it.z - 0.5) <= 0.25 + 1e-9 && it.y > 64.1 && it.y < 66.4),
    'drops are block-centre jittered (Block.dropStack)');
  EL.list.length = 0; B.gameTime = 100; M.Commands = { ruleGet: () => 'false' };
  e = mk(); e.equip[5] = { i: 1, n: 1 }; Cb.hurt(e, 1, undefined, true); B.gameTime = 103; Cb.hurt(e, 1, undefined, true);
  ok(e.removed && items().length === 0, 'doTileDrops=false: no item entities (got ' + items().length + ')');
  M.Commands = undefined;

  EL.list.length = 0; B.gameTime = 200; e = mk();
  Cb.hurt(e, 1, undefined, true); B.gameTime = 210; Cb.hurt(e, 1, undefined, true);
  ok(!e.removed, 'a second punch after >5 ticks only re-arms');

  EL.list.length = 0; e = mk(); Cb.hurt(e, 4, undefined, false, { explosive: true, source: 'explosion' });
  ok(e.removed && sounds.includes('entity.armor_stand.break'), 'explosion breaks it');
  EL.list.length = 0; e = mk(); ok(Cb.hurt(e, 4, undefined, false, { source: 'fall' }) === false && !e.removed, 'non-player non-arrow damage ignored');
  EL.list.length = 0; e = mk(); ok(Cb.hurt(e, 1, undefined, false, { source: 'projectile' }) === false && !e.removed && items().length === 0, 'non-persistent projectile (spit/skull) does not hurt a stand');
  EL.list.length = 0; e = mk(); Cb.hurt(e, 1, undefined, false, { source: 'projectile', persistent: true });
  ok(e.removed, 'arrow (persistent projectile) breaks it');
  EL.list.length = 0; e = mk(); Cb.hurt(e, 4, undefined, false, { source: 'outOfWorld' });
  ok(e.removed, 'void kills it');

  EL.list.length = 0; B.gameTime = 300; e = mk(); P.mode = M.Gamemode.ADVENTURE; sounds.length = 0;
  ok(Cb.hurt(e, 1, undefined, true) === false && !e.removed && e.lastHitTime === undefined && sounds.length === 0, 'adventure punch ignored: no sound, no hitTime');
  delete P.mode;

  EL.list.length = 0; e = mk(); M.Gamemode.isCreative = () => true;
  Cb.hurt(e, 1, undefined, true);
  ok(e.removed && items().length === 0, 'creative punch kills without a drop');
  EL.list.length = 0; e = mk(); sounds.length = 0; M.World = { getBlock: () => 0 }; M.MobVoice.onFall(e, 1);
  ok(sounds.includes('entity.armor_stand.fall'), 'landing plays entity.armor_stand.fall (#4820)');
  return { fails, n };
}

const base = scenarios();
for (const f of base.fails) console.log('FAIL', f);
let caught = 0;
const breaks = [
  ['tiledrops', "=== 'false') return;\n      EL.popResource", "=== 'zzz') return;\n      EL.popResource"],
  ['dispatch', "e.type === 'armor_stand') return Cb.armorStandDamage", "e.type === 'armor_stand_x') return Cb.armorStandDamage"],
  ['5-tick window', 't - (e.lastHitTime || 0) > 5', 't - (e.lastHitTime || 0) > -1'],
  ['particles', 'standOnBreak(e);\n      standBreakParticles(e);', 'standOnBreak(e);'],
  ['explosive', 'if (src && src.explosive) { standOnBreak', 'if (false) { standOnBreak'],
  ['adventure', 'G.blockPlacingRestricted(atk.mode)', 'false'],
  ['persistent', "s === 'projectile' && !!src.persistent", "s === 'projectile'"],
  ['creative', 'G.isCreative(atk)', 'false'],
  ['fall sound', "e.type === 'armor_stand') { if (NS.Sound", "e.type === 'armor_stand_x') { if (NS.Sound"],
];
for (const [label, a, z] of breaks) if (scenarios((f, t) => f === (label === 'fall sound' ? '07zzp_mobvoice.js' : '14j_combat.js') ? t.replace(a, z) : t).fails.length) { caught++; console.log('   ✓ break caught: ' + label); }
console.log(`armorstandcheck: ${base.n} assertions, ${base.fails.length} failures, ${caught} breaks caught`);
process.exit(base.fails.length || caught < breaks.length ? 1 : 0);
