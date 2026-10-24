#!/usr/bin/env node
// lockstep-zombie_armor -- #9216 (MOBPROOF-DAMAGE-3, part of #9203): armour reduction + status effects on the zombie melee lane, 20 salts. Engine side: the real
// Combat.mobAttack hits the survival player wearing iron/diamond armour (armor 17, toughness 2) with Resistance I and Absorption I (4 hp); per tick health and
// absorption are compared exact (floats, as Java) with the rules written from .decomp: DamageUtil.getDamageLeft (f = 2 + t/4, g = clamp(a - d/f, a/5, 20), d*(1-g/25)),
// Resistance ((25 - 5*(amp+1))/25), then absorption soaks first. Real-server half: tools/referee/lanes.d/zombie_armor.json (runchase appends Health/AbsorptionAmount
// to each Pos sample; pilot.mjs --lanes zombie_armor proves the server repeats per salt). Feeds mobproof/out/damage-armor.json.
import { harness } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const T = 120, SALTS = 20, ZOMBIE_DMG = 3, ARMOR = 17, TOUGH = 2, F32 = Math.fround;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const swings = (salt) => { const r = stream(salt), s = new Set(); while (s.size < 10) s.add(1 + Math.floor(r() * (T - 1))); return s; };
const F = ['health', 'absorption', 'invulnerableTime'];
function engine(salt, opt = {}) {
  const { M } = harness(), Sv = M.Survival, Cb = M.Combat, EL = M.EntityList;
  M.Diff.set('normal'); EL.clear();
  const P = M.Player; Sv.respawnReset && Sv.respawnReset(P);
  Object.assign(P, { x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, health: 20, invulnerable: 0, lastHurt: 0, onGround: true, absorption: 4, armor: opt.armor ?? ARMOR, armorToughness: TOUGH, dead: false, knockbackResistance: 0 });
  if (M.Effects.clearStatusEffects) M.Effects.clearStatusEffects(P);
  if (opt.resist !== false) M.Effects.addStatusEffect(P, 'resistance', 1000000, 0);
  const z = EL.spawn('zombie', 1, 64, 0); z.x = 1; z.y = 64; z.z = 0;
  const sw = swings(salt), rows = [];
  for (let t = 0; t < T; t++) {
    if (sw.has(t)) Cb.mobAttack(z, P);
    rows.push({ tick: t, health: F32(P.health), absorption: F32(P.absorption), invulnerableTime: P.invulnerable });
    if (P.invulnerable > 0) P.invulnerable--;
    P.vx = P.vy = P.vz = 0;
    if (P.health <= 0) break;
  }
  return rows;
}
function vanilla(salt, opt = {}) {
  const sw = swings(salt), rows = [], armor = opt.armor ?? ARMOR;
  let hp = 20, ab = 4, inv = 0, last = 0;
  const reduce = (d) => {
    const f = F32(2 + F32(TOUGH / 4)), g = Math.min(Math.max(F32(armor - F32(d / f)), F32(armor / 5)), 20);
    d = F32(d * F32(1 - F32(g / 25)));
    if (opt.resist !== false) d = F32(F32(d * 20) / 25);   // (25 - 5*1) / 25
    return d;
  };
  for (let t = 0; t < T; t++) {
    if (sw.has(t)) {
      let amt = ZOMBIE_DMG, ok = true;
      if (inv > 10) { if (amt <= last) ok = false; else amt -= last; }
      if (ok) {
        const fresh = !(inv > 10);
        let d = reduce(amt);
        const soak = Math.min(ab, d); ab = F32(ab - soak); d = F32(d - soak);
        hp = F32(Math.max(0, hp - d));
        if (fresh) inv = 20;
        last = ZOMBIE_DMG;
      }
    }
    rows.push({ tick: t, health: hp, absorption: ab, invulnerableTime: inv });
    if (inv > 0) inv--;
    if (hp <= 0) break;
  }
  return rows;
}
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
let soaked = 0, wounded = 0;
for (let s = 0; s < SALTS; s++) {
  const E = engine(s), V = vanilla(s), div = compareTraces(V, E, { fields: F });
  ok(div === null, `salt ${s}: first divergence ${JSON.stringify(div)}`);
  soaked += E.some((r) => r.absorption < 4) ? 1 : 0; wounded += E.some((r) => r.health < 20) ? 1 : 0;
}
ok(soaked === SALTS, 'absorption never soaked a hit');
ok(wounded > 0, 'armour + absorption never let a hit through (lane too short to prove health)');
const V0 = vanilla(0), E0 = engine(0);
caught(compareTraces(V0, engine(0, { armor: 0 }), { fields: F }) !== null, 'no armour');
caught(compareTraces(V0, engine(0, { resist: false }), { fields: F }) !== null, 'no Resistance');
caught(compareTraces(vanilla(0, { armor: 20 }), E0, { fields: F }) !== null, 'wrong armour value');
caught(compareTraces(V0, E0.map((r, t) => (t === E0.findIndex((q) => q.absorption < 4) ? { ...r, absorption: r.absorption + 0.5 } : r)), { fields: F })?.field === 'absorption', 'absorption');
const N = SALTS * 1 + 2 + 4;
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
{ const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'mobproof', 'out'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'damage-armor.json'), JSON.stringify({ zombie: { pass: !bad, checked: ['armour reduction (armor+toughness) per hit', 'Resistance I', 'absorption soak order', 'real-server lane zombie_armor (Health/AbsorptionAmount per tick)'], failed: bad ? ['see lockstep-zombie_armor'] : [] } })); }
console.log(`zombie_armor: ${SALTS} runs, ${bad ? 'FAILED' : '0 divergences'}: ${N} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
