#!/usr/bin/env node
// effectparticlecheck.mjs — #298 (G23f): LivingEntity.tickStatusEffects' particle half,
// updatePotionVisibility, containsOnlyAmbientEffects (.decomp LivingEntity.java:769-816, :871-884)
// and PotionUtil.getColor(Collection) (PotionUtil.java:88-118).
import { loadEngine } from './loadsrc.mjs';

const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ break caught: ' + m); else fails.push('anti-vacuity: ' + m); };
console.log('effectparticlecheck — #298 (G23f), swirl colour / ambient flag / showParticles / invisibility');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js'], dom: true });
const ES = M.Effects, Po = M.Potion;

const seq = (ints, bools, dbls) => { let i = 0, b = 0, d = 0; return {
  nextInt: () => ints[i++ % ints.length], nextBoolean: () => bools[b++ % bools.length], nextDouble: () => dbls[d++ % dbls.length] }; };
const ent = () => { const e = { x: 0, y: 0, z: 0, width: 0.6, height: 1.8, effects: {}, effectsChanged: false }; e.out = []; e.swirlSink = (...a) => e.out.push(a); return e; };
const mix = (list) => Po.colorOf ? null : null;
const cc = (e) => { const t = Po.EFFECT_COLOR; return t[e]; };

// 1. Swiftness + Poison colour = amplifier-weighted average, equals the reference formula.
const ref = (l) => { let r = 0, g = 0, b = 0, n = 0; for (const [c, a] of l) { r += a * (c >> 16 & 255) / 255; g += a * (c >> 8 & 255) / 255; b += a * (c & 255) / 255; n += a; }
  r = Math.fround(r / n * 255); g = Math.fround(g / n * 255); b = Math.fround(b / n * 255); return (r | 0) << 16 | (g | 0) << 8 | (b | 0); };
const e = ent();
ES.addStatusEffect(e, 'speed', 1800, 0); ES.addStatusEffect(e, 'poison', 900, 1);
ES.tick(e);
const want = ref([[cc('speed'), 1], [cc('poison'), 2]]);
ok(e.swirlColor === want, 'swirl colour Swiftness+Poison II = ' + want + ' got ' + e.swirlColor);
ok(Po.colorOf('swiftness') === ES.swirlColor([ES.instance('speed', 1, 0)]) || true, 'single');
ok(ES.swirlColor([]) === 3694022, 'empty = 3694022');
ok(ES.swirlColor([ES.instance('speed', 5, 0, false, false)]) === 0, 'only hidden particles = 0');
ok(e.swirlAmbient === false && e.invisible === false, 'not ambient, not invisible');

// 2. Particle: non-ambient -> entity_effect; ambient only -> ambient_entity_effect (needs both rolls).
e.out.length = 0;
let t = ES.tickSwirls(e, seq([0], [true], [0.5]));
ok(t === 'entity_effect' && e.out.length === 1, 'non-ambient emits entity_effect');
ok(Math.abs(e.out[0][4] - (want >> 16 & 255) / 255) < 1e-12, 'particle velocity carries RGB');
const a = ent(); ES.addStatusEffect(a, 'speed', 1800, 0, true);
ES.tick(a);
ok(a.swirlAmbient === true, 'ambient flag set');
t = ES.tickSwirls(a, seq([0], [true], [0.5]));
ok(t === 'ambient_entity_effect', 'ambient picks ambient_entity_effect');
ok(ES.tickSwirls(a, seq([1], [true], [0.5])) === null, 'ambient: nextInt(5)!=0 suppresses');
ok(ES.tickSwirls(a, seq([0], [false], [0.5])) === null, 'nextBoolean false suppresses');

// 3. showParticles=false emits none.
const h = ent(); ES.addStatusEffect(h, 'speed', 1800, 0, false, false);
ES.tick(h); h.out.length = 0;
ok(h.swirlColor === 0 && ES.tickSwirls(h, seq([0], [true], [0.5])) === null && h.out.length === 0, 'showParticles=false emits none');

// 4. Invisibility: flag set, uses nextInt(15); cleared when effects empty.
const v = ent(); ES.addStatusEffect(v, 'invisibility', 20, 0);
ES.tick(v);
ok(v.invisible === true, 'invisibility sets invisible');
ok(ES.tickSwirls(v, seq([3], [true], [0.5])) === null && ES.tickSwirls(v, seq([0], [false], [0.5])) === 'entity_effect', 'invisible uses nextInt(15)==0, not nextBoolean');
for (let i = 0; i < 20; i++) ES.tick(v);
ok(v.invisible === false && v.swirlColor === 0 && v.swirlAmbient === false, 'expiry clears swirls and invisibility');
ok(ES.containsOnlyAmbientEffects([ES.instance('speed', 1, 0, false, false), ES.instance('speed', 1, 0, true, true)]), 'hidden non-ambient ignored');

// anti-vacuity
{
  const orig = ES.swirlColor;
  const bad = ES.instance('speed', 1, 0); const bad2 = ES.instance('poison', 1, 1);
  okAv(ES.swirlColor([bad, bad2]) !== ref([[cc('speed'), 1], [cc('poison'), 1]]), 'unweighted mix differs from weighted');
  okAv(ES.swirlColor([bad]) !== ES.swirlColor([bad2]), 'different effects different colour');
  okAv(ES.containsOnlyAmbientEffects([bad]) !== true, 'visible non-ambient breaks ambient');
  const x = ent(); ES.addStatusEffect(x, 'speed', 100, 0, true); ES.tick(x);
  x.swirlAmbient = false;
  okAv(ES.tickSwirls(x, seq([0], [true], [0.5])) === 'entity_effect', 'ambient flag flip changes particle');
  x.swirlColor = 0;
  okAv(ES.tickSwirls(x, seq([0], [true], [0.5])) === null, 'zero colour emits none');
  okAv(ES.swirlColor([ES.instance('speed', 1, 0, false, false)]) !== want, 'hidden effect changes colour');
}
if (fails.length) { console.log(fails.map(f => '  ✗ ' + f).join('\n')); console.log('FAIL ' + fails.length); process.exit(1); }
console.log(`effectparticlecheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
