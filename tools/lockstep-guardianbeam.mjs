#!/usr/bin/env node
// lockstep-guardianbeam -- #8652 (G18b-L38): guardian / elder guardian vs a player standing in water at 6, 12 and 20 blocks, 20 salts x 900 ticks (engine side).
// GuardianEntity.FireBeamGoal: beamTicks -10 at start, beam target set at 0, damage at getWarmupTime (80 guardian, 60 elder);
// magic damage 1.0 (+2 HARD, +2 elder) then the plain mob hit; DamageSource.thorns reflect from the guardian's spikes.
// Per tick: beamTicks, target id, player health lost, guardian health, spikesRetracted. Vanilla GuardianEntity / ElderGuardianEntity.
import { harness, buildLane } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const { M, w, cells } = harness();
const EL = M.EntityList, P = M.Player, Gd = M.Guardian;
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (s) => { let a = (s + 1) * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const T = 900, DISTS = [6, 12, 20];

function run(salt, mob, dist) {
  const r = stream(salt); EL.random = r; Math.random = r;
  if (M.wrandReset) M.wrandReset();
  buildLane({ w, cells, M }, true);
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  if (M.Particle && M.Particle.clear) M.Particle.clear();
  P.dead = false; P.invulnerable = 0; P.lastHurt = 0; P.exhaustion = 0;
  const g = EL.spawn(mob, 0.5, 0, 0.5);
  g.persistent = true; g.vx = g.vy = g.vz = 0;
  const rows = [];
  for (let t = 0; t < T; t++) {
    P.x = 0.5 + dist; P.y = 0; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.health = 20; P.invulnerable = 0;
    EL.tick();
    const fb = g.ai && g.ai.entries.map((en) => en.goal).find((x) => x && typeof x.beamTicks === 'function');
    rows.push({ tick: t, beam: fb ? fb.beamTicks() : 0, target: g.target ? (g.target === P ? 'player' : String(g.target.id)) : null,
      lost: +(20 - P.health).toFixed(6), hp: g.health, spikes: g.spikesRetracted ? 1 : 0 });
  }
  return rows;
}
run(0, 'guardian', 6);
const F = ['beam', 'target', 'lost', 'hp', 'spikes'];
let fired = 0, total = 0;
const base = run(0, 'guardian', 6);
for (const mob of ['guardian', 'elder_guardian']) for (const dist of DISTS) {
  for (let s = 0; s < 20; s++) {
    total++;
    const a = run(s, mob, dist), b = run(s, mob, dist);
    const d = compareTraces(a, b, { fields: F });
    ok(d === null, `${mob} ${dist} salt ${s}: repeatable ${d && JSON.stringify(d).slice(0, 300)}`);
    const hit = a.findIndex((x) => x.lost > 0);
    if (hit >= 0) {
      fired++;
      const w0 = Gd.getWarmupTime({ type: mob });
      ok(a[hit].beam >= w0 || a[hit - 1].beam >= w0 - 1, `${mob} ${dist} salt ${s}: damage at beam ${a[hit].beam}, warmup ${w0}`);
      ok(a[hit].lost >= 1, `${mob} ${dist} salt ${s}: damage ${a[hit].lost}`);
    }
  }
}
ok(fired > 0, 'some beam landed');
const mut = (f, fn) => base.map((r, t) => (t === 200 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(base, mut('beam', (v) => v + 1), { fields: F })?.field === 'beam', 'beam +1');
caught(compareTraces(base, mut('lost', (v) => v + 1), { fields: F })?.field === 'lost', 'lost +1');
const cw = Gd.WARMUP_GUARDIAN; Gd.WARMUP_GUARDIAN = 60;
let alt = []; for (let s = 0; s < 20; s++) alt.push(run(s, 'guardian', 6));
Gd.WARMUP_GUARDIAN = cw;
let diff = false; for (let s = 0; s < 20; s++) if (compareTraces(run(s, 'guardian', 6), alt[s], { fields: F }) !== null) diff = true;
caught(diff || fired === 0, 'warmup 80 changed to 60');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${total * 2 + 4} assertions, ${bad} failures, ${breaks} breaks caught (20 salts x ${T} ticks x 6 lanes; ${fired} of ${total} landed a beam)`);
process.exit(bad ? 1 : 0);
