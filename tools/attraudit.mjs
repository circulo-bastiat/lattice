#!/usr/bin/env node
// attraudit.mjs — GATE M (#1535), class ATTRIBUTES. Every roster type's attribute row (entity-attributes-1.18.2.tsv,
// read out of the jar's createAttributes() chain by extract-entityattrs.mjs) against what the engine really holds:
// `Entities.attrsOf(type)` for all five columns, and the LIVE entity `EL.spawn` builds for max health / health.
//
//   node tools/attraudit.mjs [--print] [--file] [--write]   (--write regenerates the ledger: only to LOWER it)
//
// Row statuses (ledger key `type|status|column`): missing (jar has attributes, engine has none), extra (engine has a row
// the jar does not), value (a column differs), live (the spawned entity's health differs from the jar's max health),
// threw (the type cannot be spawned). Ledger tools/attraudit-known.json may only shrink; --file files each NEW mob once
// (labels bug,mobs, de-duplicated by mob+class). Break proof (D-30): each mutation corrupts one input in memory.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRINT = process.argv.includes('--print'), FILE = process.argv.includes('--file');
console.log('attraudit — GATE M attributes: every roster type\'s jar attribute row vs the engine (ratchet)');
if (!existsSync(join(ROOT, 'assets', 'entities.json'))) { console.log('attraudit: FAIL — assets missing, run the build stages (a check that skips proves nothing)'); process.exit(1); }

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
const ENT = JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'));
const roster = Object.keys(ENT.types);
M.DATA = Object.assign({}, M.DATA, { entities: ENT });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const EL = M.EntityList, W = M.World, CH = M.CH;

// ── golden: the jar's attribute rows ─────────────────────────────────────────────────────────
const COLS = { maxHealth: 'hp', movementSpeed: 'speed', attackDamage: 'dmg', followRange: 'follow', knockbackResistance: 'kbRes', attackKnockback: 'atkKb' };
const golden = new Map();
{ let head = null;
  for (const l of readFileSync(join(ROOT, 'tools/golden/entity-attributes-1.18.2.tsv'), 'utf8').split('\n')) {
    if (!l || l[0] === '#') continue;
    const f = l.split('\t');
    if (!head) { head = f; continue; }
    const row = {}; head.forEach((h, i) => { if (COLS[h]) row[COLS[h]] = f[i] === '' || f[i] === undefined ? null : +f[i]; });
    if (row.hp !== null) golden.set(f[0], row);
  } }

// ── engine: spawn every rostered type once ───────────────────────────────────────────────────
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const STONE = M.States.stateOf('stone') | 0;
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 8, z, STONE);
const live = new Map();   // type -> {hp, health} | 'threw'
for (const t of roster) {
  if (!golden.has(t)) continue;
  let e; try { e = EL.spawn(t, 0, 9, 0); } catch (x) { live.set(t, 'threw'); continue; }
  live.set(t, e ? { hp: e.maxHealth, health: e.health } : 'threw');
}
const engine = new Map(roster.map((t) => [t, M.Entities.attrsOf(t) ? Object.assign({}, M.Entities.attrsOf(t)) : null]));
// vanilla rolls these mobs' max health per spawn (Horse/Llama initAttributes, Panda resetAttributes: weak gene -> 10), so the live column is a range, not the jar's base
const ROLLED = new Set(['horse', 'donkey', 'mule', 'llama', 'trader_llama', 'skeleton_horse', 'zombie_horse', 'panda']);
const same = (a, b) => (a === null || a === undefined) ? (b === null || b === undefined) : (b !== null && b !== undefined && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a)));

function audit(roster, golden, engine, live) {
  const keys = new Set(); let okRows = 0, rows = 0;
  for (const t of roster) {
    const g = golden.get(t), e = engine.get(t);
    if (!g) { if (e) keys.add(`${t}|extra|attrs`); continue; }
    if (!e) { keys.add(`${t}|missing|attrs`); rows += 6; continue; }
    for (const c of Object.values(COLS)) { rows++; if (same(g[c], e[c])) okRows++; else keys.add(`${t}|value|${c}`); }
    const l = live.get(t);
    rows++;
    if (l === 'threw' || !l) keys.add(`${t}|threw|spawn`);
    else if (!ROLLED.has(t) && (!same(g.hp, l.hp) || !same(g.hp, l.health))) keys.add(`${t}|live|hp`); else okRows++;
  }
  return { keys, okRows, rows };
}
const R = audit(roster, golden, engine, live);
console.log(`roster ${roster.length} types, ${golden.size} with a jar max health: ${R.rows} rows, ${R.okRows} ok, ${R.keys.size} ledger keys`);
if (PRINT) for (const k of [...R.keys].sort()) console.log('  ' + k);

// ── ratchet ──────────────────────────────────────────────────────────────────────────────────
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 80) fails.push(m); return c; };
const KP = join(ROOT, 'tools/attraudit-known.json');
const known = existsSync(KP) ? JSON.parse(readFileSync(KP, 'utf8')) : { keys: [] };
function ratchet(keys, K) {
  const out = [], ks = new Set(K.keys);
  for (const k of keys) if (!ks.has(k)) out.push('NEW ' + k);
  for (const k of ks) if (!keys.has(k)) out.push('GONE ' + k + ' — fixed: delete it from tools/attraudit-known.json');
  return out;
}
if (process.argv.includes('--write')) { writeFileSync(KP, JSON.stringify({ _: 'attraudit ledger (#1535): type|status|column keys that differ from the jar; may only shrink', keys: [...R.keys].sort() }, null, 1) + '\n'); console.log('wrote ' + KP); process.exit(0); }
const rep = ratchet(R.keys, known);
for (const f of rep) ok(false, f);
ok(golden.size >= 60, 'at least 60 roster types carry a jar max health (got ' + golden.size + ')');
ok(R.okRows >= 300, 'at least 300 attribute rows matched (got ' + R.okRows + ')');
ok(golden.get('zombie').hp === 20 && golden.get('wither').hp === 300 && golden.get('ender_dragon').hp === 200, 'golden anchors (zombie 20, wither 300, dragon 200)');

// ── break proof ──────────────────────────────────────────────────────────────────────────────
const mut = (m, t, f) => { const n = new Map(m); n.set(t, f(m.get(t))); return n; };
const BREAKS = [
  ['an engine max health changed', () => ratchet(audit(roster, golden, mut(engine, 'zombie', (a) => ({ ...a, hp: a.hp + 1 })), live).keys, known)],
  ['an engine speed changed', () => ratchet(audit(roster, golden, mut(engine, 'cow', (a) => ({ ...a, speed: a.speed * 2 })), live).keys, known)],
  ['an engine attribute row removed', () => ratchet(audit(roster, golden, mut(engine, 'creeper', () => null), live).keys, known)],
  ['a live entity spawns with other health', () => ratchet(audit(roster, golden, engine, mut(live, 'cow', (l) => ({ ...l, health: l.health - 1 }))).keys, known)],
  ['a live entity cannot be spawned', () => ratchet(audit(roster, golden, engine, mut(live, 'sheep', () => 'threw')).keys, known)],
  ['a jar row changes', () => ratchet(audit(roster, mut(golden, 'cow', (g) => ({ ...g, follow: 99 })), engine, live).keys, known)],
  ['an engine-only row appears', () => ratchet(audit(roster.concat('armor_stand_x'), golden, mut(engine, 'armor_stand_x', () => ({ hp: 1 })), live).keys, known)],
  ['a stale ledger entry', () => ratchet(R.keys, { keys: known.keys.concat('cow|value|hp') })],
];
for (const [label, f] of BREAKS) { const r = f(); if (ok(r.length > 0, 'break not caught: ' + label)) { caught++; console.log(' ✓ ' + label + ': ' + r[0]); } }

if (FILE && rep.length) {
  const mobs = new Map();
  for (const f of rep) if (f.startsWith('NEW ')) { const [t, st, c] = f.slice(4).split('|'); mobs.set(t, `${t}: ${st} ${c}`); }
  for (const [t, line] of mobs) spawnSync('node', ['tools/go.mjs', 'bug', '--title', `attraudit: ${line}`, '--labels', 'bug,mobs', '--dedupe', 'attraudit:' + t,
    '--body', `tools/attraudit.mjs: ${line} differs from the jar's createAttributes() (tools/golden/entity-attributes-1.18.2.tsv).`], { cwd: ROOT, stdio: 'inherit' });
}
if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log(`\nattraudit: ${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
