#!/usr/bin/env node
// lockstep-meleedamage -- #9201 (MOBPROOF-DAMAGE-1, part of #9188): engine side of the melee-damage lane, 20 salts x 3 difficulties. A zombie strikes the
// survival player through the REAL Combat.mobAttack at salted ticks; per tick the player's health, hurt window (invulnerable / lastHurt) and knockback
// velocity are compared exact (compareTraces) with the vanilla rules written from .decomp: PlayerEntity.damage scaling (EASY min(a/2+1,a), NORMAL a,
// HARD a*3/2), LivingEntity.damage window (timeUntilRegen 20, a hit while > 10 lands only its excess), takeKnockback(0.4) = v/2 - dir*0.4, vy min(0.4, vy/2+0.4).
// The real-server half (tick-by-tick against the 1.18.2 server) is still owed; notCovered in mobdamageproof.json keeps listing it.
import { harness } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const T = 120, DIFFS = ['easy', 'normal', 'hard'], SALTS = 20, ZOMBIE_DMG = 3;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const scale = (d, a) => d === 'easy' ? Math.min(a / 2 + 1, a) : d === 'hard' ? a * 3 / 2 : a;
// swing ticks: 10 salted ticks in [1, T), sorted; some land inside the 20-tick window
const swings = (salt) => { const r = stream(salt), s = new Set(); while (s.size < 10) s.add(1 + Math.floor(r() * (T - 1))); return s; };

const F = ['health', 'invulnerableTime', 'lastDamage', 'vel'];
function engine(salt, diff, patch) {
  const { M } = harness(), Sv = M.Survival, Cb = M.Combat, EL = M.EntityList;
  M.Diff.set(diff); EL.clear();
  const P = M.Player; Sv.respawnReset && Sv.respawnReset(P);
  Object.assign(P, { x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, health: 20, invulnerable: 0, lastHurt: 0, onGround: true, absorption: 0, armor: 0, armorToughness: 0, dead: false, knockbackResistance: 0 });
  const z = EL.spawn('zombie', 1, 64, 0); z.x = 1; z.y = 64; z.z = 0;
  const sw = swings(salt), rows = [];
  for (let t = 0; t < T; t++) {
    if (P.health <= 9) P.health = 20;   // keeps the lane alive: the death path is not this check's subject
    if (sw.has(t)) { if (patch) patch(P); Cb.mobAttack(z, P); }
    rows.push({ tick: t, health: P.health, invulnerableTime: P.invulnerable, lastDamage: P.lastHurt, vel: [P.vx, P.vy, P.vz] });
    if (P.invulnerable > 0) P.invulnerable--;   // Survival.tick line 1; the rest (regen, hunger) is not this lane
    P.vx = P.vy = P.vz = 0; if (t % 7 === 0) P.vy = 0;   // the lane has no physics: velocity is read the tick it is set
  }
  return rows;
}
// vanilla: the rules above; health is not reset between swings here, so the model carries it too
function vanilla(salt, diff) {
  const sw = swings(salt), rows = [];
  let hp = 20, inv = 0, last = 0, v = [0, 0, 0];
  for (let t = 0; t < T; t++) {
    v = [0, 0, 0];
    if (hp <= 9) hp = 20;
    if (sw.has(t)) {
      const a = scale(diff, ZOMBIE_DMG);
      let fresh = true, amt = a, ok = true;
      if (inv > 10) { if (a <= last) ok = false; else { amt = a - last; fresh = false; } }
      if (ok) {
        hp = Math.max(0, hp - amt);
        if (fresh) inv = 20;
        last = a;
        if (fresh) v = [-0.4, Math.min(0.4, 0 / 2 + 0.4), 0];   // zombie at +x of the player: away from it is -x
      }
    }
    rows.push({ tick: t, health: hp, invulnerableTime: inv, lastDamage: last, vel: v });
    if (inv > 0) inv--;
  }
  return rows;
}
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
let hits = 0;
for (let s = 0; s < SALTS; s++) for (const d of DIFFS) {
  const E = engine(s, d), V = vanilla(s, d), div = compareTraces(V, E, { fields: F });
  ok(div === null, `salt ${s} ${d}: first divergence ${JSON.stringify(div)}`);
  hits += E.filter((r) => r.vel[0] !== 0).length;
}
ok(hits > 0, 'no knockback ever observed');
// the three difficulties must really differ (vacuity)
const hp = (d) => engine(3, d).find((r) => r.health < 20).health;
ok(hp('easy') > hp('normal') && hp('normal') > hp('hard'), 'difficulty does not change damage');
// breaks
const V0 = vanilla(0, 'normal'), E0 = engine(0, 'normal');
const mut = (f, fn) => E0.map((r, t) => (t === E0.findIndex((q) => q.vel[0] !== 0) ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(V0, mut('health', (h) => h + 0.5), { fields: F })?.field === 'health', 'health');
caught(compareTraces(V0, mut('vel', (v) => [v[0] * 2, v[1], v[2]]), { fields: F })?.field === 'vel', 'knockback');
caught(compareTraces(V0, mut('invulnerableTime', (i) => i + 1), { fields: F })?.field === 'invulnerableTime', 'hurt timer');
caught(compareTraces(vanilla(0, 'hard'), E0, { fields: F }) !== null, 'wrong difficulty');
caught(compareTraces(V0, engine(0, 'normal', (P) => { P.armor = 20; }), { fields: F }) !== null, 'armour changes damage');
const N = SALTS * DIFFS.length + 8;
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
{ const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'mobproof', 'out'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'damage-melee.json'), JSON.stringify({ zombie: { pass: !bad, checked: ['melee damage by difficulty (easy/normal/hard) per tick', 'hurt window / lastDamage', 'knockback vector', 'armour'], failed: bad ? ['see lockstep-meleedamage'] : [] } })); }
console.log(`meleedamage: ${SALTS * DIFFS.length} runs, ${bad ? 'FAILED' : '0 divergences'}: ${N} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
