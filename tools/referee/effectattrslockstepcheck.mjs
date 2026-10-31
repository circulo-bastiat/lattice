// effectattrs lockstep check -- #8768 (G17-L238): lockstep scenario 'effectattrs'.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js', '14i_hand.js', '14kb_fovmult.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Reg.buildPhysics(rdj('block-physics.json'));
M.Use.init(w);
const { EntityList: EL } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const fr = Math.fround;
// Reference = .decomp StatusEffects + StatusEffect.adjustModifierAmount (value * (amp+1)) + EntityAttributeInstance.computeValue
// (ADDITION first, then MULTIPLY_TOTAL as product of (1+amount)); Speed +0.2 / Slowness -0.15 on movement_speed MULTIPLY_TOTAL,
// Strength +3.0 / Weakness -4.0 attack_damage ADDITION (clamped 0..2048), Haste +0.1 / Mining Fatigue -0.1 attack_speed MULTIPLY_TOTAL.
const FX = { speed: ['ms', 0.2, 'T'], slowness: ['ms', -0.15, 'T'], strength: ['ad', 3.0, 'A'], weakness: ['ad', -4.0, 'A'], haste: ['as', 0.1, 'T'], mining_fatigue: ['as', -0.1, 'T'] };
function attr(base, which, fx) {
  let add = 0, mul = 1;
  for (const [n, amp] of fx) { const d = FX[n]; if (d[0] !== which) continue; const v = d[1] * (amp + 1); if (d[2] === 'A') add += v; else mul *= 1 + v; }
  return (base + add) * mul;
}
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const NAMES = Object.keys(FX), TICKS = 60, REMOVE = 30;
function lane(salt, kind) {
  EL.list.length = 0;
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(kind, 0.5, 40, 0.5); e.persistent = true; M.Player = { x: 30, y: 0, z: 30 };
  // 1-3 random effects from the six, random amplifier 0..3, one of them removed at REMOVE
  const fx = [], n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) { const nm = NAMES[Math.floor(r() * NAMES.length)]; if (!fx.some((f) => f[0] === nm)) fx.push([nm, Math.floor(r() * 4)]); }
  for (const [nm, amp] of fx) M.Effects.addStatusEffect(e, nm, 400, amp, false, true, true);
  const gone = fx[0][0];
  const sword = 'iron_sword', baseMs = 0.23, baseAd = 3, baseAs = 4, p = { sprinting: false, effects: e.effects };
  let refDist = 0, gotDist = 0;
  for (let t = 0; t < TICKS; t++) {
    if (t === REMOVE) { M.Effects.removeStatusEffect(e, gone); fx.splice(0, fx.length, ...fx.filter((f) => f[0] !== gone)); }
    const got = {
      ms: M.Ai.movementSpeedOf(e), pms: M.FovMult.speedAttr(p) / 0.1 * baseMs,
      ad: M.Effects.attackDamageBonus(e, baseAd), as: M.Hand.attackSpeedWithEffects(baseAs, e),
      brk: M.Mining.playerSpeed(S1, { haste: M.Effects.hasHaste(e) ? M.Effects.getHasteAmplifier(e) + 1 : 0, fatigue: (() => { const a = M.Effects.amplifierOf(e, 'mining_fatigue'); return a < 0 ? 0 : a <= 2 ? a + 1 : 4; })() }),
    };
    const ms = attr(baseMs, 'ms', fx), ad = Math.min(2048, Math.max(0, attr(baseAd, 'ad', fx)));
    const h = fx.find((f) => f[0] === 'haste'), f = fx.find((x) => x[0] === 'mining_fatigue');
    const ref = { ms, pms: ms, ad, as: attr(baseAs, 'as', fx) };
    refDist += ms; gotDist += got.ms;
    for (const k of ['ms', 'pms', 'ad', 'as']) if (Math.abs(ref[k] - got[k]) > 1e-6) return { t, n: k, ref: ref[k], got: got[k], fx: JSON.stringify(fx) };
    // break-speed multiplier vs bare-hand-on-stone base 1: Haste 1+0.2(a+1); Fatigue table by amplifier (default arm 8.1E-4)
    let b = M.Mining.playerSpeed(S1, {});
    if (h) b = fr(b * fr(1 + fr((h[1] + 1) * 0.2)));
    if (f) b = fr(b * fr([0.3, 0.09, 0.0027][f[1]] || 8.1E-4));
    if (Math.abs(b - got.brk) > 1e-6) return { t, n: 'brk', ref: b, got: got.brk, fx: JSON.stringify(fx) };
    EL.tick();
  }
  if (Math.abs(refDist - gotDist) > 1e-6) return { n: 'dist', ref: refDist, got: gotDist };
  return null;
}
const S1 = M.States.stateOf('stone');
let cases = 0;
for (const kind of ['zombie', 'husk']) {
  const bad = salts.map((s) => lane(s, kind)).filter(Boolean); cases++;
  ok(!bad.length, `${kind}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyBad = () => salts.some((s) => lane(s, 'zombie'));
const s0 = M.Effects.STRENGTH_PER_LEVEL; M.Effects.STRENGTH_PER_LEVEL = 1.3;
brk(anyBad(), 'Strength 3.0 -> 1.3 caught'); M.Effects.STRENGTH_PER_LEVEL = s0;
const ms0 = M.Ai.movementSpeedOf;
M.Ai.movementSpeedOf = (e) => { let b = ms0({ effects: null, type: e.type }); const a = M.Effects.amplifierOf(e, 'slowness'); const sp = M.Effects.amplifierOf(e, 'speed'); if (sp >= 0) b *= 1 + 0.2 * (sp + 1); if (a >= 0) b += -0.15 * (a + 1); return b; };
brk(anyBad(), 'Slowness MULTIPLY_TOTAL -> ADDITION caught'); M.Ai.movementSpeedOf = ms0;
console.log(`effectattrslockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
