#!/usr/bin/env node
// statsites2check.mjs -- #11043 G26u: damage_absorbed / damage_resisted run through the real Survival.hurt
// (LivingEntity.applyDamage / modifyAppliedDamage); damage_blocked_by_shield, clean_armor/banner/shulker_box,
// enchant_item, sleep_in_bed are wired at their call sites (PlayerEntity.damageShield, CauldronBehavior,
// EnchantmentScreenHandler.onButtonClick, ServerPlayerEntity.trySleep). Breaks its own data: prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zzo_stats.js', '14_player.js'];
const run = (patch, f) => {
  const E = loadEngine({ extra: EXTRA, dom: false, patch });
  const P = E.Player; E.Stats.reset();
  P.health = 20; P.armor = 0; P.armorToughness = 0; P.invulnerable = 0; P.dead = false; P.absorption = 0; P.invulnerableGamemode = false;
  f(E, P);
  const g = (id) => E.Stats.get(E.Stats.custom(id));
  return { absorbed: g('damage_absorbed'), resisted: g('damage_resisted') };
};
const sub = (file, a, b) => (f, s) => f === file ? s.split(a).join(b) : s;
const absorb = (E, P) => { P.absorption = 3; E.Survival.hurt(P, 'generic', 5); };
const resist = (E, P) => { E.Effects.applyResistance = (e, d) => Math.fround(d - 1); E.Survival.hurt(P, 'generic', 5); };
ok(run(null, absorb).absorbed === 30, 'absorbed 3 of 5 -> 30');
ok(run(null, resist).resisted === 10, 'resisted 1 -> 10');
caught(run(sub('14d_survival.js', "'damage_absorbed'", "'damage_absorbedX'"), absorb).absorbed === 0, 'dropped damage_absorbed site');
caught(run(sub('14d_survival.js', "'damage_resisted'", "'damage_resistedX'"), resist).resisted === 0, 'dropped damage_resisted site');
caught(run(sub('14d_survival.js', 'Math.min(e.absorption, dealt)', 'Math.min(e.absorption, dealt) + 1'), absorb).absorbed !== 30, 'skewed absorbed count');

const real = (f) => readFileSync(MCLITE_ROOT + 'src/' + f, 'utf8');
const sites = [
  ['14d_survival.js', /onDamage\('damage_blocked_by_shield', amount\)/],
  ['14l_use.js', /cStat\('clean_armor'\)/], ['14l_use.js', /cStat\('clean_banner'\)/], ['14l_use.js', /cStat\('clean_shulker_box'\)/],
  ['14g_menu.js', /inc\('enchant_item'\)/], ['14m_sleep.js', /inc\('sleep_in_bed'\)/],
];
for (const [f, re] of sites) {
  ok(re.test(real(f)), f + ' has ' + re);
  caught(!re.test(real(f).replace(re, '')), 'dropping ' + re + ' from ' + f + ' detected');
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
