// playerdrownlockstepcheck.mjs -- #6724 (G17-L128): lockstep scenario 'playerdrown', 20 salts.
// Reference = .decomp LivingEntity.baseTick / getNextAirUnderwater / getNextAirOnLand: submerged air-1 (Respiration r skips when nextInt(r+1)>0),
// at -20 air=0 + DROWN 2.0, Water Breathing leaves air unchanged, out of water +4 capped at 300. Player held 400 ticks (300 under, then out).
// Not covered (engine lacks them): turtle helmet water breathing, bubble particle count, conduit power.
import { loadEngine } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '14d_survival.js'], dom: false, initReg: true });
const Sv = M.Survival || M.Sv, ES = M.Effects;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 400, OUT_AT = 350;
const inWater = (t) => t <= OUT_AT;
function reference(salt, resp, wb) {
  const r = stream(salt), rows = []; let air = 300, hp = 20;
  for (let t = 1; t <= TICKS; t++) {
    if (inWater(t)) {
      if (!wb) {
        if (!(resp > 0 && Math.floor(r() * (resp + 1)) > 0)) air--;
        if (air === -20) { air = 0; hp -= 2; }
      }
    } else air = Math.min(air + 4, 300);
    rows.push({ t, air, hp });
  }
  return rows;
}
function engine(salt, resp, wb) {
  Math.random = stream(salt);
  const e = { type: 'player', air: 300, health: 20, maxHealth: 20, eyeInWater: true, respiration: resp, effects: {}, invulnerable: 0, armor: 0, armorToughness: 0 };
  if (wb) ES.addStatusEffect(e, 'water_breathing', 1000000, 0, false, true);
  const rows = [];
  for (let t = 1; t <= TICKS; t++) {
    e.eyeInWater = inWater(t); e.invulnerable = 0;
    Sv.tickAir(e);
    rows.push({ t, air: e.air, hp: e.health });
  }
  return rows;
}
function lane(salt, resp, wb) {
  const R = reference(salt, resp, wb), E = engine(salt, resp, wb);
  return compareTraces(R.map((r) => serverRow(r.t, { Air: r.air, Health: r.hp })), E.map((r) => engineRow(r.t, { air: r.air, health: r.hp })), { fields: ['air', 'health'] });
}
const salts = Array.from({ length: 20 }, (_, i) => i);
for (const [name, resp, wb] of [['plain', 0, false], ['respiration III', 3, false], ['water breathing', 0, true]]) {
  const bad = salts.map((s) => ({ s, d: lane(s, resp, wb) })).filter((x) => x.d);
  ok(!bad.length, name + ': ' + bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.d.tick} ${x.d.field} ${x.d.a} vs ${x.d.b}`));
}
const hp = engine(0, 0, false).filter((r, i, a) => i && a[i - 1].hp !== r.hp).map((r) => r.t);
ok(hp[0] === 320 && hp[1] === 340, 'first drown hit tick 320 then every 20: ' + hp.slice(0, 3));
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const o = Sv.DROWN_AT; Sv.DROWN_AT = -19;
brk(!!lane(0, 0, false), 'drown threshold -19 instead of -20'); Sv.DROWN_AT = o;
const oh = Sv.DROWN_DAMAGE; Sv.DROWN_DAMAGE = 3;
brk(!!lane(0, 0, false), 'drown damage 3'); Sv.DROWN_DAMAGE = oh;
const oa = Sv.AIR_REFILL; Sv.AIR_REFILL = 3;
brk(!!lane(0, 0, false), 'refill +3'); Sv.AIR_REFILL = oa;
console.log(`playerdrownlockstepcheck: ${60 + 4 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
