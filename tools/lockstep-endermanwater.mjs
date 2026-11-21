#!/usr/bin/env node
// lockstep-endermanwater -- #7084 (G17-L221): lockstep scenario 'endermanwater', 20 salts, 200 ticks. Three endermen over a flat stone floor: one rained on, one standing in a
// puddle (inWater), one in a dry arena (control). Engine = Enderman.applyWaterDamage -> Cb.hurt (DROWN, 1.0F) -> the non-LivingEntity-attacker teleport; reference = LivingEntity.baseTick
// (timeUntilRegen-- then isTouchingWaterOrRain && hurtByWater -> damage(DROWN,1)), LivingEntity.damage's grace rule (hit swallowed while timeUntilRegen>10 and amount<=lastDamage, so 1 HP
// lands every 10 ticks, not every tick), then EndermanEntity.damage's tail: nextInt(10)!=0 -> teleportRandomly (nextDouble-0.5)*64, y+nextInt(64)-32, nextDouble..., written out
// over java.util.Random (NS.JRandom), run on EVERY hurt call even when the grace swallowed the damage. Per tick: health, x/y/z (exact doubles), wet flag, angry (target) state.
// NOTE: engine ints are floor(double*n) not Random.nextInt, so the reference feeds the Java draw ORDER with ints encoded as (i+0.5)/n. teleportRandomly is ONE attempt in 1.18.2.
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = ['02f_tags.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14j_combat.js', '07l_spawn.js', '07zg_enderman.js'];
const SALTS = 20, TICKS = 200, FLOOR = 63;
const load = (patch) => {
  const M = loadEngine({ extra: BASE, dom: false, initReg: true, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.Enderman.init();
  const stone = M.States.stateOf('stone');
  Object.assign(M.World = M.World || {}, { getBlock: (x, y, z) => (y <= FLOOR ? stone : 0), setBlock() {}, getLight: () => 0, tickingAt: () => true, loadedAt: () => true, heightAt: () => FLOOR, BOTTOM_Y: -64 });
  M.Physics.shapeAt = (x, y, z) => { const st = M.World.getBlock(x, y, z); return st ? M.Physics.shapesForState(st) : null; };
  M.Sky = M.Sky || {};
  M.Sky.isEntityRainedOn = (e) => !!e.rained;
  return M;
};
const START = (i) => ({ x: 5 * i + 0.5, y: FLOOR + 1, z: 0.5 });
const cell = (hp, x, y, z, wet, angry) => [hp, x, y, z, wet, angry].join(',');

// reference: baseTick + damage(DROWN,1) + EndermanEntity.damage's tail, over java.util.Random. Also returns the draws in call order (ints encoded (i+0.5)/n) for the engine to consume.
function reference(JRandom, salt) {
  const r = new JRandom(1000 + salt), script = [];
  const es = [0, 1, 2].map((i) => Object.assign(START(i), { hp: 40, grace: 0, last: 0, wet: i < 2 }));
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    rows.push(es.map((e) => {
      if (e.grace > 0) e.grace--;
      if (e.wet) {
        // LivingEntity.damage: inside the grace window (timeUntilRegen > 10) only a bigger hit lands, and then only the difference
        if (e.grace > 10) { if (!(1 > e.last)) { /* swallowed */ } else { e.hp -= 1 - e.last; e.last = 1; } }
        else { e.hp -= 1; e.last = 1; e.grace = 20; }
        const roll = r.nextInt(10); script.push((roll + 0.5) / 10);
        if (roll !== 0) {
          const dx = r.nextDouble(), dy = r.nextInt(64), dz = r.nextDouble();
          script.push(dx, (dy + 0.5) / 64, dz);
          const nx = e.x + (dx - 0.5) * 64, ny = e.y + (dy - 32), nz = e.z + (dz - 0.5) * 64, by0 = Math.floor(ny);
          if (by0 >= FLOOR + 1) { e.x = nx; e.y = ny - (by0 - (FLOOR + 1)); e.z = nz; }   // else the teleport reverts
        }
      }
      return cell(e.hp, e.x, e.y, e.z, e.wet, false);
    }).join('|'));
  }
  return { rows, script };
}

function engine(M, script) {
  let k = 0;
  M.EntityList.random = () => { if (process.env.DBG) console.log("draw", k, script[k], new Error().stack.split("\n")[2].trim()); return script[k++]; };
  const mk = (i) => Object.assign(START(i), { type: 'enderman', width: 0.6, height: 2.9, dead: false, health: 40, maxHealth: 40, silent: true, rained: i === 0, inWater: i === 1, target: null });
  const es = [mk(0), mk(1), mk(2)];
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    rows.push(es.map((e) => {
      if (e.invulnerableTime > 0) e.invulnerableTime--;
      M.Enderman.applyWaterDamage(e);
      return cell(e.health, e.x, e.y, e.z, !!(e.inWater || e.rained), !!e.target);
    }).join('|'));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const M = load(patch), ref = reference(M.JRandom, s), eng = engine(M, ref.script);
    for (let i = 0; i < TICKS; i++) if (eng[i] !== ref.rows[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${eng[i]} ref ${ref.rows[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const P = (f0, a, b) => (f, s) => f === f0 ? s.replace(a, b) : s;
const breaks = [
  ['water damage 1.0 -> 2.0', P('07zg_enderman.js', 'Cb.hurt(e, 1.0, undefined', 'Cb.hurt(e, 2.0, undefined')],
  ['teleport gate rint(10) !== 0 -> !== 1', P('14j_combat.js', 'NS.Enderman.rint(10) !== 0', 'NS.Enderman.rint(10) !== 1')],
  ['teleport box 64 -> 32', P('07zg_enderman.js', 'Enderman.RANDOM_TP_XZ = 64.0', 'Enderman.RANDOM_TP_XZ = 32.0')],
  ['rain ignored', P('07zg_enderman.js', 'else if (!wet && Sky && Sky.isEntityRainedOn)', 'else if (false)')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`endermanwater: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
