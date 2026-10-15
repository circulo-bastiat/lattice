#!/usr/bin/env node
// zpiglinspeedcheck.mjs — #1218: ZombifiedPiglinEntity.mobTick ATTACKING_SPEED_BOOST (+0.05 ADDITION, adults only,
// while hasAngerTime) -> 0.28 vs 0.23 base. Proves it can fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js', '14j_combat.js', '07zx_particle.js', '07zk_undead.js', '07k_goals.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
M.Breed = M.Breed || { ready: true, isBaby: (e) => (e.growAge | 0) < 0 };
const EL = M.EntityList, Ai = M.Ai;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const mk = (baby) => { const z = EL.spawn('zombified_piglin', 0, 64, 0); z.growAge = baby ? -24000 : 0; return z; };
const run = () => {
  const o = [];
  const a = mk(); a.angerTime = 0; o.push(near(Ai.movementSpeedOf(a), 0.23));
  a.angerTime = 100; o.push(near(Ai.movementSpeedOf(a), 0.28));
  a.angerTime = 0; o.push(near(Ai.movementSpeedOf(a), 0.23));
  const b = mk(true); b.angerTime = 100; o.push(near(Ai.movementSpeedOf(b), 0.23 * 1.5));
  const z = EL.spawn('zombie', 0, 64, 0); z.angerTime = 100; o.push(!near(Ai.movementSpeedOf(z), Ai.movementSpeedOf(z) + 0.05));
  const zb = EL.spawn('zombie', 0, 64, 0); zb.angerTime = 100; zb.growAge = 0; o.push(near(Ai.movementSpeedOf(zb), 0.23));
  return o;
};
const good = (o) => o.every(Boolean);
run().forEach((v, i) => ok(v, 'assertion #' + i));
{ const b = mk(true); b.angerTime = 100; ok(Ai.movementSpeedOf(b) > 0.3, "baby: 0.23*1.5, no boost"); }
const caught = (label, fn, restore) => {
  fn();
  let bad; try { bad = !good(run()); } catch (e) { bad = true; }
  restore();
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
{ const o = Ai.movementSpeedOf; caught('boost dropped', () => { Ai.movementSpeedOf = (e) => o({ ...e, angerTime: 0 }); }, () => { Ai.movementSpeedOf = o; }); }
{ const o = Ai.movementSpeedOf; caught('boost always on', () => { Ai.movementSpeedOf = (e) => o(e) + 0.05; }, () => { Ai.movementSpeedOf = o; }); }
{ const o = Ai.movementSpeedOf; caught('boost wrong size', () => { Ai.movementSpeedOf = (e) => o(e) + ((e.angerTime | 0) > 0 ? 0.01 : 0); }, () => { Ai.movementSpeedOf = o; }); }

console.log('\n================ zpiglinspeedcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
