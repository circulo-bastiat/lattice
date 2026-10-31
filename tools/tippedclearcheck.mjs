#!/usr/bin/env node
// tippedclearcheck.mjs — ArrowEntity.tick (.decomp ArrowEntity.java:~96-100): a stuck arrow with CUSTOM effects
// loses its whole tip (potion + effects + colour) once inGroundTime >= 600; a base-potion-only tip is kept.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('tippedclearcheck — stuck tipped arrow loses its custom-effect tip at 600 ticks in the ground');
const M = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js', '07zx_particle.js', '07z_potion.js', '14j_combat.js', '14d_survival.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.Physics.shapeAt = (x, y, z) => (y < 64 ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < 64;
M.Physics.blockAt = () => 1;
M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, Cb = M.Combat;
const stuck = (tip) => {
  const a = EL.spawn('arrow', 0.5, 64, 0.5, { vx: 0, vy: 0, vz: 0, shooter: null, tip });
  a.stuck = true; a.groundState = 1; a.inGroundTime = 1; return a;
};
function run(tip, ticks) { const a = stuck(tip); for (let i = 0; i < ticks && !a.removed; i++) { a.inGroundTime = i + 1 > 1 ? a.inGroundTime : 1; Cb.tickArrow(a); } return a; }
const custom = [{ effect: 'strength', duration: 100, amplifier: 0 }];
{
  const a = stuck({ custom }); a.inGroundTime = 598;
  Cb.tickArrow(a); ok(a.tip, 'tip kept before 600 (inGroundTime ' + a.inGroundTime + ')');
  Cb.tickArrow(a); Cb.tickArrow(a);
  ok(a.inGroundTime >= 600 && a.tip === null, 'custom-effect tip cleared at inGroundTime >= 600, got ' + JSON.stringify(a.tip));
}
{
  const a = stuck({ potionId: 'poison' }); a.inGroundTime = 700;
  Cb.tickArrow(a); ok(a.tip && a.tip.potionId === 'poison', 'base-potion-only tip is NOT cleared (effects set empty)');
}
{
  const a = stuck({ potionId: 'poison', custom }); a.inGroundTime = 700;
  Cb.tickArrow(a); ok(a.tip === null, 'combined tip: base potion cleared too');
}
// anti-vacuity: break the rule and confirm the check notices
{
  const save = Cb.ARROW_TIP_CLEAR_TICKS; Cb.ARROW_TIP_CLEAR_TICKS = 100000;
  const a = stuck({ custom }); a.inGroundTime = 700; Cb.tickArrow(a);
  breaks++; if (a.tip !== null) { pass++; console.log('  ✓ break caught: clear disabled keeps the tip'); } else fails.push('anti-vacuity: disabling the clear did not keep the tip');
  Cb.ARROW_TIP_CLEAR_TICKS = save;
  const b = stuck({ custom }); b.inGroundTime = 700; Cb.tickArrow(b);
  breaks++; if (b.tip === null) { pass++; console.log('  ✓ break caught: restored rule clears'); } else fails.push('anti-vacuity: restoring the clear did not clear');
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
