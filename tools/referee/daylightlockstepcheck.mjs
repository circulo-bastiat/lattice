// daylightlockstepcheck.mjs -- #6268 (G17-L36): lockstep scenario 'daylight': zombie sunlight burn, helmet durability, water exemption, 20 salts.
// Reference = ZombieEntity.tickMovement / MobEntity.isAffectedByDaylight (.decomp) fed the SAME pinned float stream as the engine;
// per tick fireTicks, helmet Damage (ArmorItems tag) and health are compared with lockstep/trace.mjs compareTraces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '09b_sky.js', '14j_combat.js'], dom: false });
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
M.Equip.init();
const { Combat: Cb, Equip: Eq, Items: IT } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 120;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const brightness = (l) => { const f = Math.fround(l / 15); return Math.fround(f / (4 - 3 * f)); };
// scenario: sky = light at the eyes (15 open, 0 under a roof), glass = the roof is glass (light 15 but canSeeSky false in vanilla), wet = in water
const SC = { open: { sky: 15, see: true }, roof: { sky: 0, see: false }, glass: { sky: 15, see: false }, water: { sky: 15, see: true, wet: true } };
const MAXD = (name) => IT.durability[IT.of(name)];
function reference(sc, helmet, salt, rnd) {
  let fire = 0, dmg = 0, helm = helmet, rows = [];
  for (let t = 0; t < TICKS; t++) {
    const b = brightness(sc.sky);
    const affected = b > 0.5 && Math.fround(rnd() * 30) < Math.fround((b - 0.4) * 2) && !sc.wet && sc.see;
    if (affected) {
      if (helm) { dmg += Math.floor(rnd() * 2); if (dmg >= MAXD(helm)) helm = null; }
      else fire = Math.max(fire, 160);
    }
    rows.push({ fire, dmg, helm });
    if (fire > 0) fire--;
  }
  return rows;
}
function engine(sc, helmet, rnd, hook) {
  const e = { type: 'zombie', x: 0.5, y: 64, z: 0.5, height: 1.95, width: 0.6, health: 20, dead: false, inWater: !!sc.wet, equip: {} };
  M.Sky.isDay = () => true; M.Sky.darknessNow = () => 0; M.Sky.weather = null;
  M.World = { getLight: () => sc.sky << 4, canSeeSky: hook ? () => sc.sky > 0 : () => sc.see, getBlock: () => 0 };
  if (helmet) Eq.setEquipped(e, IT.HEAD, { i: IT.of(helmet), c: 1, d: 0 });
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    Cb.tickDaylightBurn(e, rnd);
    const h = Eq.getEquipped(e, IT.HEAD);
    rows.push({ fire: e.remainingFireTicks | 0, dmg: h ? h.d | 0 : 0, helm: h ? helmet : null });
    if (e.remainingFireTicks > 0) e.remainingFireTicks--;
  }
  return rows;
}
const toRow = (r, t, helmet, which) => (which === 'server'
  ? serverRow(t, { Fire: r.fire, Health: 20, ArmorItems: [{}, {}, {}, r.helm ? { id: 'minecraft:' + r.helm, tag: { Damage: r.dmg } } : {}] })
  : engineRow(t, { fireTicks: r.fire, health: 20 }, {}));
const F = { fields: ['fireTicks', 'health'] };
function lane(name, helmet, hook) {
  const sc = SC[name], res = [];
  for (const salt of salts) {
    const R = reference(sc, helmet, salt, stream(salt)), E = engine(sc, helmet, stream(salt), hook);
    let d = compareTraces(R.map((r, t) => toRow(r, t, helmet, 'server')), E.map((r, t) => toRow(r, t, helmet, 'engine')), F);
    if (!d) for (let t = 0; t < TICKS; t++) if (R[t].dmg !== E[t].dmg || R[t].helm !== E[t].helm) { d = { tick: t, field: 'armour.Damage', a: R[t].dmg, b: E[t].dmg }; break; }
    res.push({ salt, d });
  }
  return res;
}
const clean = (res) => res.every((r) => !r.d);
const burnedSomewhere = (name, helmet) => salts.some((s) => reference(SC[name], helmet, s, stream(s)).some((r) => r.fire > 0 || r.dmg > 0));
for (const [n, h] of [['open', null], ['open', 'iron_helmet'], ['open', 'leather_helmet'], ['roof', null], ['glass', null], ['water', null]]) {
  const res = lane(n, h);
  ok(clean(res), `${n}/${h}: ${res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3)}`);
}
ok(burnedSomewhere('open', null) && burnedSomewhere('open', 'iron_helmet'), 'open sky burns / wears the helmet (not vacuous)');
ok(!burnedSomewhere('roof', null) && !burnedSomewhere('water', null), 'roof and water never burn');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk(!clean(lane('glass', null, true)), 'a roof test that ignores glass is reported');
const orig = Cb.DAYLIGHT_BURN_SECONDS; Cb.DAYLIGHT_BURN_SECONDS = 4;
brk(!clean(lane('open', null)), 'a 4 s burn is reported'); Cb.DAYLIGHT_BURN_SECONDS = orig;
const od = Eq.damageEquipped; Eq.damageEquipped = (e, s, a, r) => od(e, s, a + 1, r);
brk(!clean(lane('open', 'iron_helmet')), 'helmet damage +1 is reported'); Eq.damageEquipped = od;
console.log(`daylightlockstepcheck: ${6 * 20 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
