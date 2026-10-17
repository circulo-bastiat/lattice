#!/usr/bin/env node
// advtrig-player_hurt_entitycheck.mjs -- #7742 G17-AT2. minecraft:player_hurt_entity through the real call sites
// (Cb.arrowStrikeEntity, Cb.tridentHit) on the real packed advancements; breaks its own matcher/call sites.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

console.log('advtrig-player_hurt_entitycheck -- #7742');
const ASSETS = join(MCLITE_ROOT, 'assets');
const meta = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
const bin = readFileSync(join(ASSETS, 'advancements.bin')).toString('base64');

function scenarios(patch, matcherPatch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({
    extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
            '14e_gamemode.js', '07q_effects.js', '07zzr_minecart.js', '07za_explosion.js', '14j_combat.js', '14d_survival.js', '02l_advancements.js'],
    initReg: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Combat.init();
  M.Adv.init({ advancements: bin, advancementsBytes: meta.rawBytes });
  if (matcherPatch) matcherPatch(M.Adv);
  const Cb = M.Combat, A = M.Adv;
  const P = M.Player = { x: 2, y: 64, z: 0, inventory: null, slot: 0 };
  P.advancements = new A.Tracker({});
  const done = (id) => P.advancements.getProgress(A.manager.get('minecraft:' + id)).isDone();
  const mk = () => { const c = { type: 'minecart', x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, width: 0.98, height: 0.7, cartWobbleSide: 1,
    cartWobbleTicks: 0, cartDamageWobble: 0, cartWobbleStrength: 0, cartFuse: -1, removed: false }; M.EntityList.list.push(c); return c; };
  const arrow = (type) => ({ type, x: 0, y: 70, z: 0, vx: 0, vy: -3, vz: 0, shooter: P, isOnFire: false });

  ok(!done('adventure/shoot_arrow') && !done('adventure/throw_trident'), 'starts incomplete');
  // a non-projectile (melee) hit does not complete either
  Cb.playerHurtTrigger(P, mk(), P, 3, false);
  ok(!done('adventure/shoot_arrow') && !done('adventure/throw_trident'), 'melee hit completed a projectile advancement');
  // a trident-typed projectile is not an arrow
  const wrong = arrow('trident'); wrong.dealtDamage = false;
  Cb.tridentHit(wrong, mk());
  ok(done('adventure/throw_trident') && !done('adventure/shoot_arrow'), 'trident hit: throw_trident only');
  ok(Cb.arrowStrikeEntity(arrow('arrow'), 0, 64.3, 0, 0, -1, 0) === true, 'arrow strikes the target');
  ok(done('adventure/shoot_arrow'), 'arrow hit completes shoot_arrow');
  return { fails, n };
}

const base = scenarios();
const fails = base.fails.slice();
const mutants = [
  ['matcher always false', null, (A) => { A.matchers['minecraft:player_hurt_entity'] = () => false; }],
  ['matcher ignores damage', null, (A) => { A.matchers['minecraft:player_hurt_entity'] = () => true; }],
  ['no call site', [['14j_combat.js', 'Cb.playerHurtTrigger = function (P, t, direct, dealt, projectile) {', 'Cb.playerHurtTrigger = function (P, t, direct, dealt, projectile) { return;']]],
  ['direct entity lost', [['14j_combat.js', 'source: sub(direct)', 'source: null']]],
];
let caught = 0;
for (const [name, p, mp] of mutants) {
  let bad;
  try { bad = scenarios(p ? (f, src) => { for (const [file, a, b] of p) if (f === file || f.endsWith(file)) { if (!src.includes(a)) throw new Error('anchor gone'); src = src.replace(a, b); } return src; } : undefined, mp).fails; }
  catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-player_hurt_entitycheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${base.n}`);
console.log(`advtrig-player_hurt_entitycheck: OK — ${caught} breaks caught`);
