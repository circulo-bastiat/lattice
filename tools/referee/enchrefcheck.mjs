#!/usr/bin/env node
// enchrefcheck.mjs — infra I6 (24 Sept 2026): EnchantmentHelper.enchant, the ENGINE's two ports of it against the
// REAL 1.18.2 server (tools/referee/runenchant.mjs -> golden/enchanting.json):
//   trade:<item>        Trade.resolveOffers on a sell_enchanted_tool_for_emeralds row (EnchHelper.enchant,
//                       07ox_enchhelper.js; level 5 + nextInt(15)) vs enchant_with_levels uniform 5..19
//   mob:<item>:<level>  Equip.rollEnchants (07y_equip.js, the mob-gear roll) vs enchant_with_levels <level>
//
//   node tools/referee/runenchant.mjs          # once per machine/store (~3.5 min, the real server)
//   node tools/referee/enchrefcheck.mjs [--verbose]
//
// Per case: every enchantment's presence rate and the number-of-enchantments distribution (exact two-sided
// binomial, P < 1e-5 fails), each enchantment's LEVEL as a mean (>= 20 samples each side, 5 sigma). The engine
// rolls N_E = 20000 per case. Anti-vacuity (D-30/D-305): three in-memory breaks of the engine's samples.
// No golden -> SKIP, exit 0. Golden: <referee dir>/golden, else ../mclite-store/golden (never committed, D-6).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'enchanting.json'),
  join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'enchanting.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('enchrefcheck: SKIP (golden not generated -- run node tools/referee/runenchant.mjs)');
  process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let pass = 0, breaks = 0;
const fails = [];
const ok = (list, c, m) => { if (c) pass++; else list.push(m); return c; };

const BASE_MODS = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js',
  '07j_entityrender.js', '14j_combat.js', '07zw_mobnbt.js', '07w_passive.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const MCL = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false });
initRegistry(MCL);
{
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
const Trade = MCL.Trade, Eq = MCL.Equip;

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N_E = 20000, Z = 5, P_FAIL = 1e-5, MIN_MEAN_N = 20;
const bare = (id) => String(id || '').replace(/^minecraft:/, '');
// Equip.rollEnchants' slotKind: the weapon table the engine owns, else the armour piece's slot.
const ARMOR_SLOT = { boots: 'FEET', leggings: 'LEGS', chestplate: 'CHEST', helmet: 'HEAD' };
function slotKindOf(item) {
  if (Eq.MAINHAND_SLOTKIND && Eq.MAINHAND_SLOTKIND[item]) return Eq.MAINHAND_SLOTKIND[item];
  const m = /_(boots|leggings|chestplate|helmet)$/.exec(item);
  return m ? ARMOR_SLOT[m[1]] : null;
}
function engineSamples(key, c) {
  const rng = mulberry(20260924 ^ (key.length * 2654435761));
  const out = [];
  try {
    if (key.startsWith('trade:')) {
      const row = { profession: 'referee', level: 1, kind: 'sell_enchanted_tool_for_emeralds', item: c.item,
        basePrice: 1, maxUses: 3, xp: 1, priceMult: 0.2 };
      for (let n = 0; n < N_E; n++) {
        const o = Trade.resolveOffers([row], {}, rng)[0];
        if (!o) return { error: 'Trade.resolveOffers gave no offer' };
        out.push(((o.tag && o.tag.Enchantments) || []).map((e) => `${bare(e.id)}:${e.lvl}`).sort());
      }
    } else {
      const kind = slotKindOf(c.item);
      if (!kind) return { error: `no Equip slot kind for ${c.item}` };
      for (let n = 0; n < N_E; n++) out.push(Eq.rollEnchants(c.item, kind, c.levels[0], rng).map((e) => `${bare(e.id)}:${e.lvl}`).sort());
    }
  } catch (err) { return { error: String(err && err.message || err).slice(0, 120) }; }
  return out;
}
const lgam = (() => { const c = [0]; return (n) => { while (c.length <= n) c.push(c[c.length - 1] + Math.log(c.length)); return c[n]; }; })();
function binomTwoSided(k, n, p) {
  const lp = Math.log(p), lq = Math.log(1 - p);
  const pmf = (i) => Math.exp(lgam(n) - lgam(i) - lgam(n - i) + i * lp + (n - i) * lq);
  let lo = 0, hi = 0;
  for (let i = 0; i <= k; i++) lo += pmf(i);
  for (let i = k; i <= n; i++) hi += pmf(i);
  return Math.min(1, 2 * Math.min(lo, hi));
}
function summarize(samples) {
  const rate = {}, lvl = {};
  for (const s of samples) {
    const nk = `count=${s.length}`;
    rate[nk] = (rate[nk] || 0) + 1;
    for (const f of s) {
      const [id, l] = f.split(':');
      rate[id] = (rate[id] || 0) + 1;
      const q = lvl[id] || (lvl[id] = { n: 0, sum: 0, sq: 0 }); q.n++; q.sum += +l; q.sq += l * l;
    }
  }
  return { n: samples.length, rate, lvl };
}
function compareCase(key, eng, gold) {
  const f = [];
  const E = summarize(eng), G = summarize(gold);
  for (const k of new Set([...Object.keys(E.rate), ...Object.keys(G.rate)])) {
    const ke = E.rate[k] || 0, kg = G.rate[k] || 0;
    const p = Math.min(Math.max(ke / E.n, 0.5 / E.n), 1 - 0.5 / E.n);
    ok(f, binomTwoSided(kg, G.n, p) >= P_FAIL, `${key}: ${k} on ${(100 * ke / E.n).toFixed(1)}% (engine) vs ${(100 * kg / G.n).toFixed(1)}% (vanilla, ${kg}/${G.n})`);
  }
  for (const k of Object.keys(G.lvl)) {
    const qe = E.lvl[k], qg = G.lvl[k];
    if (!qe || qe.n < MIN_MEAN_N || qg.n < MIN_MEAN_N) continue;
    const me = qe.sum / qe.n, mg = qg.sum / qg.n, ve = Math.max(0, qe.sq / qe.n - me * me);
    const vg = Math.max(0, qg.sq / qg.n - mg * mg), v = Math.max(ve, vg);   // pooled: a level that never varies on one side
    ok(f, Math.abs(me - mg) <= Z * Math.sqrt(v / qg.n + v / qe.n) + 1e-9, `${key}: ${k} level mean ${me.toFixed(2)} (engine) vs ${mg.toFixed(2)} (vanilla)`);
  }
  return f;
}

console.log(`enchrefcheck — engine x${N_E} vs the real 1.18.2 server (${golden.per}/case, ${golden.generatedAt}; ${GOLDEN})`);
const cache = {};
for (const key of Object.keys(golden.cases).sort()) {
  const c = golden.cases[key];
  const eng = cache[key] = engineSamples(key, c);
  if (!Array.isArray(eng)) { ok(fails, false, `${key}: the engine cannot roll it (${eng.error})`); continue; }
  const f = compareCase(key, eng, c.samples);
  fails.push(...f);
  if (VERBOSE) console.log(`  ${f.length ? '✗' : '✓'} ${key}${f.length ? ' — ' + f.length : ''}`);
}

function breakCaught(label, key, mutate) {
  if (!Array.isArray(cache[key])) { fails.push(`anti-vacuity: ${key} not rollable, break "${label}" cannot run`); return; }
  const base = compareCase(key, cache[key], golden.cases[key].samples).length;
  const after = compareCase(key, cache[key].map((s) => mutate(s.slice())), golden.cases[key].samples).length;
  if (after > base) breaks++; else fails.push(`anti-vacuity: break "${label}" on ${key} NOT caught (${base} -> ${after})`);
}
breakCaught('unbreaking never drawn', 'trade:diamond_pickaxe', (s) => s.filter((f) => !f.startsWith('unbreaking:')));
breakCaught('every level +1', 'mob:golden_helmet:22', (s) => s.map((f) => { const [i, l] = f.split(':'); return `${i}:${+l + 1}`; }));
breakCaught('only ever one enchantment', 'trade:iron_sword', (s) => s.slice(0, 1));

const uniq = [...new Set(fails)];
console.log(`  ${Object.keys(golden.cases).length} cases · ${pass} comparisons pass · ${uniq.length} mismatch(es) · ${breaks}/3 breaks caught`);
for (const m of uniq.slice(0, VERBOSE ? 400 : 60)) console.log('FAIL  ' + m);
if (!VERBOSE && uniq.length > 60) console.log(`  … ${uniq.length - 60} more (--verbose)`);
for (let i = 0; i < breaks; i++) console.log('  ✓ anti-vacuity break caught');
// suite.mjs reads these two lines (`assertions passed ... N`, `failures ... N`)
console.log(`\n  assertions passed .. ${pass}\n  failures ........... ${uniq.length}\n  breaks caught ...... ${breaks}`);
process.exit(uniq.length ? 1 : 0);
