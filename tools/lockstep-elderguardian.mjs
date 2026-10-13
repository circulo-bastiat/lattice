#!/usr/bin/env node
// lockstep-elderguardian -- #6895 (G17-L178): lockstep scenario 'elderguardian', 20 salts, 2500 ticks. An elder guardian and a survival player 30 blocks away:
// ElderGuardianEntity.mobTick every 1200 ticks ((age + id) % 1200 == 0) gives mining_fatigue amp 2 for 6000 ticks (unless the player already has amp>=2 with
// duration >= 1200) and the ELDER_GUARDIAN_EFFECT packet (apparition ticks, silent flag). Compared per tick: effect amp/duration, packet, hitbox 2.35, attack 8.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 2500;

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07q_effects.js', '07k_goals.js', '07zzq_elderguardian.js'], dom: false });
  const id = (salt * 97) % 1200, e = { type: 'elder_guardian', id, age: 0, x: 0, y: 40, z: 0, silent: salt % 3 === 0 };
  const p = { x: 30, y: 40, z: 0, mode: salt % 7 === 0 ? 1 : 0, food: 20, health: 20, effects: {} };
  M.Effects.initEntity && M.Effects.initEntity(p);
  M.Ai.hasPositionTarget = () => true;
  M.ElderGuardian.players = () => [p];
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    M.Effects.tick(p);
    M.ElderGuardian.mobTick(e);
    e.age++;
    const c = M.Effects.getStatusEffect(p, 'mining_fatigue');
    rows.push([c ? c.amplifier + ':' + c.duration : '-', p.elderGuardianFx ? p.elderGuardianFx.ticks + ':' + p.elderGuardianFx.silent : '-'].join(','));
  }
  return rows;
}

function reference(salt) {
  const id = (salt * 97) % 1200, silent = salt % 3 === 0, survival = salt % 7 !== 0;
  let dur = 0, fx = '-';
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    if (dur > 0) dur--;
    if ((t + id) % 1200 === 0 && survival && !(dur >= 1200)) { dur = 6000; fx = '60:' + silent; }
    rows.push([dur > 0 ? '2:' + dur : '-', fx].join(','));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['curse interval 1200 -> 1000', (f, s) => f === '07zzq_elderguardian.js' ? s.replace('INTERVAL: 1200', 'INTERVAL: 1000') : s],
  ['amplifier 2 -> 1', (f, s) => f === '07zzq_elderguardian.js' ? s.replace('AMPLIFIER: 2', 'AMPLIFIER: 1') : s],
  ['duration 6000 -> 5000', (f, s) => f === '07zzq_elderguardian.js' ? s.replace('DURATION: 6000', 'DURATION: 5000') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`elderguardian: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
