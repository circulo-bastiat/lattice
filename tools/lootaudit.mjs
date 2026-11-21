#!/usr/bin/env node
// lootaudit.mjs — GATE M (#1535), class LOOT. Every roster mob's entity loot table, read RAW out of the 1.18.2 jar
// (data/minecraft/loot_tables/entities/*.json, nothing the engine packed), against what `Loot.entityDrops` really drops.
//
//   node tools/lootaudit.mjs [--print] [--file] [--write]   (--write regenerates the ledger: only to LOWER it)
//
// Golden: per table and per SCENARIO (base, player kill, player + Looting III, player + burning, killed by a skeleton, killed by a
// skeleton + player) a static walk of the jar JSON gives each item that can drop and its max count (set_count max + looting_enchant
// max x level, limit_count, furnace_smelt on a burning victim). Engine: 30000 seeded rolls per mob and scenario.
// Ledger keys `mob|scenario|status|item`: missing (golden item never dropped), extra (engine dropped an item the jar cannot),
// over (a count above the jar's max), under (an item rolled 3000+ times never reached the jar's max count), notable (no table).
// tools/lootaudit-known.json may only shrink; --file files each NEW mob once (bug,mobs). Break proof (D-30) mutates inputs in memory.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { requireJar } from './paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRINT = process.argv.includes('--print'), FILE = process.argv.includes('--file');
console.log('lootaudit — GATE M loot: every roster mob\'s jar loot table vs Loot.entityDrops (ratchet)');
if (!existsSync(join(ROOT, 'assets', 'loot.bin'))) { console.log('lootaudit: SKIP — assets missing, run the build stages'); process.exit(process.env.CI || process.env.GITHUB_ACTIONS || process.env.MCLITE_REQUIRE_DATA ? 1 : 0); }

const M = loadEngine({ extra: ['02f_tags.js', '07d_mining.js', '07e_loot.js'], dom: false });
const L = M.Loot, ENT = JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'));
const roster = Object.keys(ENT.types);
const jar = new Jar(requireJar('1.18.2'));
const rawTable = (n) => { const f = 'data/minecraft/loot_tables/' + n.replace(/^minecraft:/, '') + '.json'; return jar.has(f) ? JSON.parse(jar.read(f).toString()) : null; };

const SCEN = {
  base: {}, player: { player: true }, looting3: { player: true, looting: 3 }, fire: { player: true, fire: true },
  skel: { killer: 'skeleton' }, skelplayer: { player: true, killer: 'skeleton' },
};
const SKELETONS = ['skeleton', 'stray', 'wither_skeleton'];
const SMELT = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato' };
const bare = (s) => String(s).replace(/^minecraft:/, '');

// ── golden: static walk of the raw table ─────────────────────────────────────────────────────
function cond(c, s) {
  switch (bare(c.condition)) {
    case 'killed_by_player': return !!s.player;
    case 'random_chance': return c.chance > 0;
    case 'random_chance_with_looting': return c.chance + (s.looting || 0) * (c.looting_multiplier || 0) > 0;
    case 'inverted': return !cond(c.term, s);
    case 'alternative': return (c.terms || []).some((t) => cond(t, s));
    case 'entity_properties': {
      const p = c.predicate || {};
      const subj = c.entity === 'killer' ? (s.player ? 'player' : s.killer) : 'this';
      if (!subj) return false;
      if (p.flags && p.flags.is_on_fire !== undefined && (subj === 'this' ? !!s.fire : false) !== !!p.flags.is_on_fire) return false;
      if (p.type !== undefined) { const tag = String(p.type).startsWith('#'); if (!tag || bare(p.type.slice(1)) !== 'skeletons' || !SKELETONS.includes(s.killer)) return false; }
      return true;
    }
    case 'damage_source_properties': return false;   // lightning / projectile sources: none of the scenarios supplies one
    default: return true;
  }
}
const all = (cs, s) => (cs || []).every((c) => cond(c, s));
const num = (v) => (v && typeof v === 'object') ? (v.max !== undefined ? v.max : v.n !== undefined ? v.n : 1) : (v === undefined ? 1 : v);
function walk(table, s, out, depth) {
  if (!table || depth > 4) return;
  for (const pool of table.pools || []) {
    if (!all(pool.conditions, s)) continue;
    const rolls = num(pool.rolls) + (num(pool.bonus_rolls) || 0) * (s.luck || 0);
    for (const e of pool.entries || []) entry(e, s, out, depth, rolls);
  }
}
function entry(e, s, out, depth, rolls) {
  if (!all(e.conditions, s)) return;
  const t = bare(e.type);
  if (t === 'alternatives' || t === 'group' || t === 'sequence') { for (const c of e.children || []) entry(c, s, out, depth, rolls); return; }
  if (t === 'loot_table') { const tt = rawTable(e.name), sub = new Map();
    if (tt) walk(tt, s, sub, depth + 1);
    const smelt = (e.functions || []).some((f) => bare(f.function) === 'furnace_smelt' && all(f.conditions, s));
    for (const [k, v] of sub) { const n = smelt && SMELT[k] ? SMELT[k] : k; out.set(n, (out.get(n) || 0) + v); }
    return; }
  if (t === 'empty' || t === 'dynamic') return;
  if (t === 'tag') { out.set('*' + bare(e.name), (out.get('*' + bare(e.name)) || 0) + 1); return; }
  let item = bare(e.name), max = 1, limit = Infinity;
  for (const f of e.functions || []) {
    if (!all(f.conditions, s)) continue;
    const fn = bare(f.function);
    if (fn === 'set_count') max = f.add ? max + num(f.count) : num(f.count);
    else if (fn === 'looting_enchant') { max += num(f.count) * (s.looting || 0); if (f.limit) limit = Math.min(limit, f.limit); }
    else if (fn === 'limit_count') limit = Math.min(limit, (f.limit && f.limit.max) || Infinity);
    else if (fn === 'furnace_smelt' && SMELT[item]) item = SMELT[item];
  }
  out.set(item, (out.get(item) || 0) + Math.min(max, limit));
  if (rolls > 1) out.set('~' + item, rolls);
}
const golden = new Map();   // mob -> scenario -> Map(item -> max count)
for (const t of roster) {
  const tb = rawTable('entities/' + t);
  if (!tb) { golden.set(t, null); continue; }
  const g = {};
  for (const [sn, s] of Object.entries(SCEN)) { const o = new Map(); walk(tb, s, o, 0); g[sn] = o; }
  golden.set(t, g);
}

// ── engine: seeded rolls ─────────────────────────────────────────────────────────────────────
const N = 30000;
function roll(t, s) {
  const seen = new Map();   // item -> {max, hits}
  const rng = L.rng(1842 + t.length * 7919);
  for (let i = 0; i < N; i++) {
    const d = L.entityDrops({ type: t, killedByPlayer: !!s.player, killer: s.killer ? { type: s.killer } : (s.player ? { type: 'player' } : undefined), isOnFire: !!s.fire, looting: s.looting || 0, rng });
    for (const x of d) { const r = seen.get(x.item) || { max: 0, hits: 0 }; r.max = Math.max(r.max, x.count); r.hits++; seen.set(x.item, r); }
  }
  return seen;
}
const engine = new Map();   // mob -> scenario -> Map
for (const t of roster) { if (!golden.get(t)) continue; const e = {}; for (const [sn, s] of Object.entries(SCEN)) e[sn] = roll(t, s); engine.set(t, e); }

function audit(roster, golden, engine) {
  const keys = new Set(); let okRows = 0, rows = 0;
  for (const t of roster) {
    const g = golden.get(t), e = engine.get(t);
    if (!g) { if (L.hasTable('entities/' + t)) keys.add(`${t}|all|extra|table`); continue; }
    if (!e) { keys.add(`${t}|all|notable|table`); continue; }
    for (const sn of Object.keys(SCEN)) {
      const gi = g[sn], ei = e[sn];
      for (const [item, max0] of gi) {
        if (item[0] === '~') continue;
        const rl = gi.get('~' + item) || 1, max = max0 * rl;
        if (item[0] === '*') { rows++; if ([...ei.keys()].some((k) => /music_disc/.test(k))) okRows++; else keys.add(`${t}|${sn}|missing|${item}`); continue; }
        rows++; const r = ei.get(item);
        if (!r) keys.add(`${t}|${sn}|missing|${item}`);
        else if (r.max > max) keys.add(`${t}|${sn}|over|${item}`);
        else if (r.hits >= 3000 && r.max < max0 && rl === 1) keys.add(`${t}|${sn}|under|${item}`);
        else okRows++;
      }
      for (const item of ei.keys()) if (!gi.has(item) && !(/music_disc/.test(item) && [...gi.keys()].some((k) => k[0] === '*'))) keys.add(`${t}|${sn}|extra|${item}`);
    }
  }
  return { keys, okRows, rows };
}
const R = audit(roster, golden, engine);
const withTable = [...golden.values()].filter(Boolean).length;
console.log(`roster ${roster.length} types, ${withTable} with a jar loot table: ${R.rows} item rows, ${R.okRows} ok, ${R.keys.size} ledger keys`);
if (PRINT) for (const k of [...R.keys].sort()) console.log('  ' + k);

// ── ratchet ──────────────────────────────────────────────────────────────────────────────────
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 80) fails.push(m); return c; };
const KP = join(ROOT, 'tools/lootaudit-known.json');
const known = existsSync(KP) ? JSON.parse(readFileSync(KP, 'utf8')) : { keys: [] };
function ratchet(keys, K) {
  const out = [], ks = new Set(K.keys);
  for (const k of keys) if (!ks.has(k)) out.push('NEW ' + k);
  for (const k of ks) if (!keys.has(k)) out.push('GONE ' + k + ' — fixed: delete it from tools/lootaudit-known.json');
  return out;
}
if (process.argv.includes('--write')) { writeFileSync(KP, JSON.stringify({ _: 'lootaudit ledger (#1535): mob|scenario|status|item keys where the engine drops differ from the jar loot table; may only shrink', keys: [...R.keys].sort() }, null, 1) + '\n'); console.log('wrote ' + KP); process.exit(0); }
const rep = ratchet(R.keys, known);
for (const f of rep) ok(false, f);
ok(withTable >= 60, 'at least 60 roster mobs have a jar loot table (got ' + withTable + ')');
ok(R.okRows >= 200, 'at least 200 item rows matched (got ' + R.okRows + ')');
ok(golden.get('zombie').player.has('rotten_flesh') && golden.get('blaze').base.size === 0 && golden.get('blaze').player.has('blaze_rod'), 'golden anchors (zombie flesh, blaze rod only on a player kill)');

// ── break proof ──────────────────────────────────────────────────────────────────────────────
const clone = (m) => { const n = new Map(); for (const [t, g] of m) n.set(t, g && Object.fromEntries(Object.entries(g).map(([s, x]) => [s, new Map(x)]))); return n; };
const mutE = (t, sn, f) => { const e = clone(engine); f(e.get(t)[sn]); return audit(roster, golden, e).keys; };
const mutG = (t, sn, f) => { const g = clone(golden); f(g.get(t)[sn]); return audit(roster, g, engine).keys; };
const BREAKS = [
  ['an engine drop vanishes', () => ratchet(mutE('zombie', 'player', (m) => m.delete('rotten_flesh')), known)],
  ['an engine invents a drop', () => ratchet(mutE('cow', 'base', (m) => m.set('diamond', { max: 1, hits: 5 })), known)],
  ['an engine count exceeds the jar max', () => ratchet(mutE('blaze', 'looting3', (m) => m.get('blaze_rod').max = 99), known)],
  ['an engine count never reaches the jar max', () => ratchet(mutE('skeleton', 'base', (m) => { const r = m.get('bone'); r.max = 0; r.hits = 999; }), known)],
  ['a jar drop is added', () => ratchet(mutG('cow', 'base', (m) => m.set('emerald', 1)), known)],
  ['a jar count grows', () => ratchet(mutG('skeleton', 'base', (m) => m.set('bone', 9)), known)],
  ['the engine has a table the jar lacks', () => { const g = clone(golden); g.set('cow', null); return ratchet(audit(roster, g, engine).keys, known); }],
  ['a stale ledger entry', () => ratchet(R.keys, { keys: known.keys.concat('cow|base|missing|leather') })],
];
for (const [label, f] of BREAKS) { const r = f(); if (ok(r.length > 0, 'break not caught: ' + label)) { caught++; console.log(' ✓ ' + label + ': ' + r[0]); } }

if (FILE && rep.length) {
  const mobs = new Map();
  for (const f of rep) if (f.startsWith('NEW ')) { const [t, sn, st, it] = f.slice(4).split('|'); mobs.set(t, `${t}: ${st} ${it} (${sn})`); }
  for (const [t, line] of mobs) spawnSync('node', ['tools/go.mjs', 'bug', '--title', `lootaudit: ${line}`, '--labels', 'bug,mobs', '--dedupe', 'lootaudit:' + t,
    '--body', `tools/lootaudit.mjs: ${line} differs from the jar's loot table (data/minecraft/loot_tables/entities/${t}.json).`], { cwd: ROOT, stdio: 'inherit' });
}
if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log(`\nlootaudit: ${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
