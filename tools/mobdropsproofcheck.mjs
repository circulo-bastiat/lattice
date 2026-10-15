// mobdropsproofcheck (#7524): drops dimension of the mob proof. Per roster mob (tools/mobl3-mobs.json, 91): the engine's
// unconditional loot roll (entities/<mob>, ORIGIN context, like /loot ... loot) against the REAL 1.18.2 server's rolls
// (golden mob-loot.json from tools/referee/runloot.mjs): per item drop rate and mean count within Z=5 standard errors, and
// an item seen on one side only. A roster mob the server has no table for must have none in the engine either.
// Writes tools/mobproof/out/drops.json. NOT covered (ledger tools/mobdropsproof-known.json, shrink-only): the conditional
// parts (looting, fire, killed-by-player, baby, variants, XP) - listed per mob in notCovered; mobslootcheck and the
// piglin/wither/dolphin loot checks keep their own coverage until they are absorbed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const T = dirname(fileURLToPath(import.meta.url));
const roster = Object.keys(JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs);
const known = JSON.parse(readFileSync(join(T, 'mobdropsproof-known.json'), 'utf8'));
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-loot.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-loot.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('mobdropsproofcheck: SKIP (golden not generated -- run node tools/referee/runloot.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')).tables;

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07ox_enchhelper.js', '07e_loot.js'], dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
const L = M.Loot, N_E = 4000, Z = 5, SEED = 20261015;

function engineStats(mob, mut = {}) {
  const rng = L.rng(SEED), rec = { rolls: 0, items: {} };
  for (let i = 0; i < N_E; i++) {
    let drops = L.rollTable('entities/' + mob, { rng });
    if (mut.fn) drops = mut.fn(drops);
    rec.rolls++;
    const per = {};
    for (const s of drops) if (s.count > 0) { per[s.item] = (per[s.item] || 0) + s.count; for (const en of (s.ench || []).slice(1)) per[en.id] = (per[en.id] || 0) + 1; }   // runloot's parseItems loses each stack's first enchantment
    for (const [id, n] of Object.entries(per)) { const x = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0 }); x.total += n; x.sq += n * n; x.hits++; }
  }
  return rec;
}

function compare(mob, van, eng) {
  const out = [], nv = van.rolls, ne = eng.rolls;
  for (const id of new Set([...Object.keys(van.items), ...Object.keys(eng.items)])) {
    const v = van.items[id] || { total: 0, sq: 0, hits: 0 }, e = eng.items[id] || { total: 0, sq: 0, hits: 0 };
    const pv = v.hits / nv, pe = e.hits / ne;
    if ((v.hits === 0 && pe > 0.02) || (e.hits === 0 && pv > 0.02)) { out.push(`${mob}: ${id} drops ${(pe * 100).toFixed(1)}% in the engine, ${(pv * 100).toFixed(1)}% on the server`); continue; }
    const p = (v.hits + e.hits) / (nv + ne), seP = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
    if (Math.abs(pe - pv) > Z * seP + 1e-9) out.push(`${mob}: ${id} drop rate engine ${(pe * 100).toFixed(1)}% vs server ${(pv * 100).toFixed(1)}%`);
    const mv = v.total / nv, me = e.total / ne;
    const seM = Math.sqrt(Math.max(v.sq / nv - mv * mv, 0) / nv + Math.max(e.sq / ne - me * me, 0) / ne) || 1e-9;
    if (Math.abs(me - mv) > Z * seM + 1e-9) out.push(`${mob}: ${id} mean count engine ${me.toFixed(3)} vs server ${mv.toFixed(3)}`);
  }
  return out;
}

function checkMob(mob, mut = {}) {
  const van = golden[mob], has = L.hasTable('entities/' + mob);
  if (!van) return has ? [`${mob}: the engine has a loot table, the server none`] : [];
  if (!has) return [`${mob}: the server has a loot table, the engine none`];
  return compare(mob, van, engineStats(mob, mut));
}

const out = {}; let bad = 0;
for (const mob of roster) {
  const failed = checkMob(mob), has = !!golden[mob];
  out[mob] = { pass: failed.length === 0, checked: [has ? 'unconditional loot roll: per-item rate and mean count vs the real server' : 'no loot table on the server and none in the engine'], notCovered: has ? known.notCovered : ['no loot table in vanilla: nothing conditional to cover'], failed };
  for (const r of failed) if (!known.failedRows.includes(r)) { bad++; console.log('NEW RED ' + mob + ': ' + r); }
}
const seen = new Set(Object.values(out).flatMap((o) => o.failed));
for (const r of known.failedRows) if (!seen.has(r)) { bad++; console.log('STALE known row (fixed? remove it): ' + r); }
if (known.notCovered.length > known.max) { bad++; console.log('notCovered ledger grew'); }
mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(T, 'mobproof', 'out', 'drops.json'), JSON.stringify(out, null, 1));

let caught = 0;
const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
brk(checkMob('cow', { fn: (d) => d.map((s) => s.item === 'beef' ? { ...s, count: s.count + 1 } : s) }).length > 0, 'count +1');
brk(checkMob('cow', { fn: (d) => d.filter((s) => s.item !== 'leather') }).length > 0, 'lost item');
brk(checkMob('cow', { fn: (d) => d.concat([{ item: 'diamond', count: 1 }]) }).length > 0, 'spurious item');
brk(checkMob('zombie', { fn: (d) => d.concat([{ item: 'iron_ingot', count: 1 }]) }).length > 0, 'rare item always');
brk(checkMob('sheep', { fn: (d) => d.map((s) => s.item === 'mutton' ? { ...s, count: 3 } : s) }).length > 0, 'count fixed');
console.log(bad ? `FAIL ${bad} bad (${roster.length} mobs)` : `mobdropsproofcheck: ${roster.length} mobs, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
