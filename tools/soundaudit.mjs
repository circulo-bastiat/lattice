#!/usr/bin/env node
// soundaudit.mjs — GATE M (#1535), class SOUNDS. Every roster type's sound row (mob-sounds-1.18.2.tsv, read off .decomp by
// extract-mobsounds.mjs) against what the engine really plays: MobVoice.pick for ambient/hurt/death (every event it can
// return must be one the jar's method can return, and it must return one at all), the events actually sent to Sound.play
// by MobVoice.onDamage, the ambient delay, sound volume, SoundSource category and the step event.
//
//   node tools/soundaudit.mjs [--print] [--file] [--write]   (--write regenerates the ledger: only to LOWER it)
//
// Ledger key `type|status|role`: none (jar has events, engine plays none), stray (engine plays an event the jar's method
// cannot return), played (onDamage emitted something outside the jar's list), delay, volume, source, step, threw.
// Mobs in MobVoice.SKIP (evoker/ghast/shulker/husk) and MobVoice.OWN (snow_golem) have their own voice code and their own sound checks: not audited here. Ledger tools/soundaudit-known.json may only shrink; --file files each NEW mob once
// (labels bug,mobs, de-duplicated by mob+class). Break proof (D-30): each mutation corrupts one input in memory.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRINT = process.argv.includes('--print'), FILE = process.argv.includes('--file');
console.log('soundaudit — GATE M sounds: every roster type\'s jar sound row vs what the engine plays (ratchet)');
if (!existsSync(join(ROOT, 'assets', 'entities.json'))) { console.log('soundaudit: SKIP — assets missing, run the build stages'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02j_sounds.js', '14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
const ENT = JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'));
const roster = Object.keys(ENT.types);
M.DATA = Object.assign({}, M.DATA, { entities: ENT });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const EL = M.EntityList, W = M.World, CH = M.CH;

// ── golden ───────────────────────────────────────────────────────────────────────────────────
const G = new Map(); M.DATA.mobSounds = {};
for (const l of readFileSync(join(ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const f = l.split('\t'); M.DATA.mobSounds[f[0]] = f.slice(2); const L = (i) => (f[i] ? f[i].split(',') : []);
  G.set(f[0], { ambient: L(2), hurt: L(3), death: L(4), step: L(5), stepVol: f[6], delay: f[7], vol: f[8], cat: f[9] });
}
const MV = M.MobVoice, S = M.Sound;
W_init();
function W_init() {
  M.World.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  const STONE = M.States.stateOf('stone') | 0;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) M.World.setBlock(x, 8, z, STONE);
}
const live = new Map();
for (const t of roster) { if (!G.has(t) || !(G.get(t).ambient.length + G.get(t).hurt.length + G.get(t).death.length)) continue; try { live.set(t, EL.spawn(t, 0, 9, 0) || 'threw'); } catch (x) { live.set(t, 'threw'); } }
const N = 300;
// engine observation per type: what pick() returns over N rolls, what onDamage plays, delay/volume/source/step
function observe(t) {
  const e = live.get(t); if (!e || e === 'threw') return null;
  const o = { pick: { ambient: new Set(), hurt: new Set(), death: new Set() }, played: { hurt: new Set(), death: new Set() } };
  e.onGround = true; e.inWater = false; e.wet = false;
  for (const r of ['ambient', 'hurt', 'death']) for (let i = 0; i < N; i++) { let v; try { v = MV.pick(e, r); } catch (x) { v = 'threw'; } o.pick[r].add(v || null); }
  const real = S.play; let last = null, src = null, vol = null;
  S.play = (ev, op) => { last = ev; src = op && op.source; vol = op && op.volume; return true; };
  e.silent = false;
  for (const [r, dead] of [['hurt', false], ['death', true]]) for (let i = 0; i < 30; i++) { last = null; MV.onDamage(e, dead); o.played[r].add(last); if (r === 'hurt' && last) { o.src = src; o.vol = vol; } }
  // one step: walk 3 blocks on the ground
  last = null; e.onGround = true; e.inWater = false; e.wet = false; e.stepX = e.x = 0; e.stepZ = e.z = 0; e.stepDist = 0; e.stepNext = 1;
  const seen = new Set();
  for (let i = 1; i <= 6; i++) { e.x = i * 0.9; last = null; try { MV.tickStep(e); } catch (x) {} if (last) seen.add(last); }
  o.step = seen;
  S.play = real;
  o.delay = String(MV.delay(e)); o.source = MV.source(e);
  return o;
}
const obs = new Map(); for (const t of roster) if (live.has(t) && !MV.SKIP[t] && !MV.OWN[t]) obs.set(t, observe(t));
const sameNum = (a, b) => Math.abs(parseFloat(a) - parseFloat(b)) < 1e-6;

function audit(roster, G, obs) {
  const keys = new Set(); let rows = 0, okRows = 0; const row = (c, k) => { rows++; if (c) okRows++; else keys.add(k); };
  for (const t of roster) {
    const g = G.get(t); if (!g || MV.SKIP[t] || MV.OWN[t] || !live.has(t)) continue;
    const o = obs.get(t);
    if (!o) { keys.add(`${t}|threw|spawn`); continue; }
    for (const r of ['ambient', 'hurt', 'death']) {
      const got = [...o.pick[r]].filter(Boolean), bad = got.filter((x) => !g[r].includes(x) && !(t === 'parrot' && /^entity\.parrot\.imitate\./.test(x)) && !(t === 'piglin' && r === 'ambient' && /^entity\.piglin\./.test(x)));   // PiglinEntity.getAmbientSound picks by activity (admiring/retreat/jealous...); the jar ambient slot is empty   // ParrotEntity.getRandomSound imitates other mobs
      row(!(g[r].length && !got.length), `${t}|none|${r}`);
      row(!bad.length, `${t}|stray|${r}`);
    }
    for (const r of ['hurt', 'death']) row([...o.played[r]].every((x) => x === null ? g[r].length === 0 : g[r].includes(x)), `${t}|played|${r}`);
    row(sameNum(o.delay, g.delay || 80), `${t}|delay|ambient`);
    row(!g.hurt.length || o.vol === undefined || o.vol === null || !g.vol || sameNum(o.vol, g.vol) || t === 'slime' || t === 'magma_cube', `${t}|volume|hurt`);
    row(o.source === g.cat || (t === 'rabbit'), `${t}|source|category`);
    row(g.step.length && !MV.EVENTS_ONLY[t] ? o.step.size > 0 : true, `${t}|step|missing`);
    row([...o.step].every((x) => g.step.length ? (g.step.includes(x) || /swim|splash|entity\.(horse|turtle)\./.test(x)) : true), `${t}|step|stray`);
  }
  return { keys, okRows, rows };
}
const R = audit(roster, G, obs);
console.log(`roster ${roster.length} types, ${obs.size} audited: ${R.rows} rows, ${R.okRows} ok, ${R.keys.size} ledger keys`);
if (PRINT) for (const k of [...R.keys].sort()) console.log('  ' + k);

// ── ratchet ──────────────────────────────────────────────────────────────────────────────────
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 80) fails.push(m); return c; };
const KP = join(ROOT, 'tools/soundaudit-known.json');
const known = existsSync(KP) ? JSON.parse(readFileSync(KP, 'utf8')) : { keys: [] };
function ratchet(keys, K) {
  const out = [], ks = new Set(K.keys);
  for (const k of keys) if (!ks.has(k)) out.push('NEW ' + k);
  for (const k of ks) if (!keys.has(k)) out.push('GONE ' + k + ' — fixed: delete it from tools/soundaudit-known.json');
  return out;
}
if (process.argv.includes('--write')) { writeFileSync(KP, JSON.stringify({ _: 'soundaudit ledger (#1844): type|status|role keys where the engine\'s sounds differ from the jar; may only shrink', keys: [...R.keys].sort() }, null, 1) + '\n'); console.log('wrote ' + KP); process.exit(0); }
const rep = ratchet(R.keys, known);
for (const f of rep) ok(false, f);
ok(obs.size >= 60, 'at least 60 roster types audited (got ' + obs.size + ')');
ok(R.okRows >= 500, 'at least 500 sound rows matched (got ' + R.okRows + ')');
ok(G.get('zombie').hurt[0] === 'entity.zombie.hurt' && G.get('cow').delay === '120' && G.get('ender_dragon').vol === '5.0', 'golden anchors');

// ── break proof ──────────────────────────────────────────────────────────────────────────────
const mut = (m, t, f) => { const n = new Map(m); n.set(t, f(m.get(t))); return n; };
const clone = (o) => ({ ...o, pick: { ...o.pick }, played: { ...o.played } });
const BREAKS = [
  ['engine plays a stray hurt event', () => ratchet(audit(roster, G, mut(obs, 'zombie', (o) => { const c = clone(o); c.played = { ...o.played, hurt: new Set(['entity.cow.hurt']) }; return c; })).keys, known)],
  ['engine ambient picks a stray event', () => ratchet(audit(roster, G, mut(obs, 'cow', (o) => { const c = clone(o); c.pick = { ...o.pick, ambient: new Set(['entity.pig.ambient']) }; return c; })).keys, known)],
  ['engine goes silent on death', () => ratchet(audit(roster, G, mut(obs, 'pig', (o) => { const c = clone(o); c.pick = { ...o.pick, death: new Set([null]) }; return c; })).keys, known)],
  ['ambient delay differs', () => ratchet(audit(roster, G, mut(obs, 'cow', (o) => ({ ...clone(o), delay: '60' }))).keys, known)],
  ['hurt volume differs', () => ratchet(audit(roster, G, mut(obs, 'zombie', (o) => ({ ...clone(o), vol: 0.1 }))).keys, known)],
  ['sound category differs', () => ratchet(audit(roster, G, mut(obs, 'zombie', (o) => ({ ...clone(o), source: 'neutral' }))).keys, known)],
  ['step sound dropped', () => ratchet(audit(roster, G, mut(obs, 'zombie', (o) => ({ ...clone(o), step: new Set() }))).keys, known)],
  ['a jar row changes', () => ratchet(audit(roster, mut(G, 'cow', (g) => ({ ...g, hurt: ['entity.cow.moo'] })), obs).keys, known)],
  ['a stale ledger entry', () => ratchet(R.keys, { keys: known.keys.concat('cow|none|hurt') })],
];
for (const [label, f] of BREAKS) { const r = f(); if (ok(r.length > 0, 'break not caught: ' + label)) { caught++; console.log(' ✓ ' + label + ': ' + r[0]); } }

if (FILE && rep.length) {
  const mobs = new Map();
  for (const f of rep) if (f.startsWith('NEW ')) { const [t, st, c] = f.slice(4).split('|'); mobs.set(t, (mobs.get(t) || []).concat(`${st} ${c}`)); }
  for (const [t, l] of mobs) spawnSync('node', ['tools/go.mjs', 'bug', '--title', `soundaudit: ${t}: ${l.join(', ')}`, '--labels', 'bug,mobs', '--dedupe', 'soundaudit:' + t,
    '--body', `tools/soundaudit.mjs: ${t} sound rows differ from the jar (tools/golden/mob-sounds-1.18.2.tsv): ${l.join(', ')}.`], { cwd: ROOT, stdio: 'inherit' });
}
if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log(`\nsoundaudit: ${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
