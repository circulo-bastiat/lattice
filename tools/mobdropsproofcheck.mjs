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
import { engineGear } from './equipdropeng.mjs';
import { MOBS as EQ_MOBS } from './referee/equipdropscen.mjs';

const T = dirname(fileURLToPath(import.meta.url));
const roster = Object.keys(JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs);
const known = JSON.parse(readFileSync(join(T, 'mobdropsproof-known.json'), 'utf8'));
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-loot.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-loot.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('mobdropsproofcheck: SKIP (golden not generated -- run node tools/referee/runloot.mjs)'); process.exit(0); }
const goldenAll = JSON.parse(readFileSync(GOLDEN, 'utf8')), golden = goldenAll.tables, fireGolden = goldenAll.fireTables;
if (!fireGolden) { console.log('mobdropsproofcheck: SKIP (golden has no fireTables -- run node tools/referee/runloot.mjs --fire-only)'); process.exit(0); }
// #7859: Looting I-III golden (runlooting.mjs --roster: `execute as <player> run loot ... kill <mob>`, sword Looting 0..3)
const GL = [join(refDir, 'golden', 'looting-roster.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'looting-roster.json')].find((f) => existsSync(f));
if (!GL) { console.log('mobdropsproofcheck: SKIP (looting golden not generated -- run node tools/referee/runlooting.mjs --roster)'); process.exit(0); }
const goldL = JSON.parse(readFileSync(GL, 'utf8')).lanes;

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07ox_enchhelper.js', '07e_loot.js', '14j_combat.js'], dom: false });
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
// the golden's summoned slime/magma cube is size 1 (SlimeEntity/MagmaCubeEntity.getLootTableId): a size-1 magma cube has NO table (14j_combat slimeNoLoot, mobslootcheck)
// and a sheep is the default white one (a summon with NBT skips initialize), so its colour table is entities/sheep/white.
const L = M.Loot, N_E = 4000, Z = 5, SEED = 20261015;

function engineStats(mob, mut = {}, kctx = {}, looting = 0, table = 'entities/' + mob) {
  const rng = L.rng(SEED + looting), rec = { rolls: 0, items: {} };
  for (let i = 0; i < N_E; i++) {
    let drops = looting ? (mob === 'magma_cube' ? [] : L.entityDrops({ type: mob, table: mob === 'sheep' ? 'entities/sheep/white' : undefined, rng, looting: mut.looting === undefined ? looting : mut.looting, killedByPlayer: true, killer: { type: 'player' } })) : L.rollTable(table, { rng, ...kctx, ...(mut.ctx || {}) });
    if (mut.fn) drops = mut.fn(drops);
    rec.rolls++;
    const per = {};
    for (const s of drops) if (s.count > 0) { per[s.item] = (per[s.item] || 0) + s.count; for (const en of (s.ench || []).slice(1)) per[en.id] = (per[en.id] || 0) + 1; }   // runloot's parseItems loses each stack's first enchantment
    for (const [id, n] of Object.entries(per)) { const x = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0 }); x.total += n; x.sq += n * n; x.hits++; }
  }
  return rec;
}

function compare(mob, van, eng, floor = false) {
  const out = [], nv = van.rolls, ne = eng.rolls;
  for (const id of new Set([...Object.keys(van.items), ...Object.keys(eng.items)])) {
    const v = van.items[id] || { total: 0, sq: 0, hits: 0 }, e = eng.items[id] || { total: 0, sq: 0, hits: 0 };
    const pv = v.hits / nv, pe = e.hits / ne;
    if ((v.hits === 0 && pe > 0.02) || (e.hits === 0 && pv > 0.02)) { out.push(`${mob}: ${id} drops ${(pe * 100).toFixed(1)}% in the engine, ${(pv * 100).toFixed(1)}% on the server`); continue; }
    const p = (v.hits + e.hits) / (nv + ne), seP = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
    if (Math.abs(pe - pv) > Z * seP + 1e-9) out.push(`${mob}: ${id} drop rate engine ${(pe * 100).toFixed(1)}% vs server ${(pv * 100).toFixed(1)}%`);
    const mv = v.total / nv, me = e.total / ne;
    const seM = Math.max(Math.sqrt(Math.max(v.sq / nv - mv * mv, 0) / nv + Math.max(e.sq / ne - me * me, 0) / ne), floor ? Math.sqrt((mv + me) / 2 / Math.min(nv, ne)) : 0) || 1e-9;   // rare drop seen 0 times in 200 server rolls: Poisson floor
    if (Math.abs(me - mv) > Z * seM + 1e-9) out.push(`${mob}: ${id} mean count engine ${me.toFixed(3)} vs server ${mv.toFixed(3)}`);
  }
  return out;
}

function checkLooting(mob, mut = {}) {
  const out = [];
  for (const lvl of [1, 2, 3]) {
    const van = goldL['L' + lvl] && goldL['L' + lvl][mob];
    if (!van || !van.rolls) continue;
    for (const r of compare(mob, van, engineStats(mob, mut, {}, lvl), true)) out.push(r.replace(mob + ': ', mob + ' looting ' + lvl + ': '));
  }
  return out;
}

function checkMob(mob, mut = {}, kctx = {}) {
  const van = golden[mob], has = L.hasTable('entities/' + mob);
  if (!van) return has ? [`${mob}: the engine has a loot table, the server none`] : [];
  if (!has) return [`${mob}: the server has a loot table, the engine none`];
  return compare(mob, van, engineStats(mob, mut, kctx));
}

// XP amounts (#7863): a plain player kill per roster mob through the engine's real death path (Cb.dropLoot -> Xp.dropMobXp, as
// xprefcheck does), 4000 kills against the server's per-kill sums (golden mob-xp.json, runxp.mjs: 100 kills per mob, every orb's
// Value x Count): the support must match and the mean lie within Z standard errors. A mob with no plain variant in the golden
// (boss, non-living, one an arrow cannot kill) is named in its notCovered.
const XG = [join(refDir, 'golden', 'mob-xp.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-xp.json')].find((f) => existsSync(f));
const xpGold = XG ? JSON.parse(readFileSync(XG, 'utf8')).variants : {};
const X = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07d_mining.js', '07e_loot.js', '07i_entitylist.js',
    '07y_equip.js', '07m_breed.js', '07w_passive.js', '07zd_slime.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js', '07p_trade.js', '07zz_xporb.js'],
  initReg: false,
});
{
  const A = join(MCLITE_ROOT, 'assets');
  X.DATA = Object.assign({}, X.DATA, { entities: rdj('entities.json') });
  X.Entities.init();
  X.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  X.Loot.init({ loot: readFileSync(join(A, 'loot.bin')).toString('base64'), lootBytes: rdj('loot.meta.json').jsonBytes });
  X.Physics.shapeAt = (x, y, z) => (y < 64 ? X.Physics.FULL_CUBE : null);
  X.Physics.solidAt = (x, y, z) => X.Physics.shapeAt(x, y, z) !== null;
  X.Physics.grounded = (x, y, z, d) => y - d < 64;
  X.EntityList.init(); X.Equip.init(); X.Breed.init(); X.Passive.init(); X.Xp.init();
}
let px = 0;
function xpKills(mob, n, mut = {}) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const e = X.EntityList.spawn(mob, px, 64, 0);
    if (!e) return null;
    e.equip = []; e.growAge = 0; if ('baby' in e) e.baby = false; e.hasJockey = false;
    e.playerHitTimer = 100; e.attackingPlayer = true; e.lootDropped = false;
    const n0 = X.EntityList.list.length;
    X.Combat.dropLoot(e);
    let xp = 0;
    for (let j = n0; j < X.EntityList.list.length; j++) { const o = X.EntityList.list[j]; if (o && o.type === 'experience_orb' && Math.abs(o.x - px) < 2) xp += o.value * (o.pickingCount || 1); }
    out.push(mut.fn ? mut.fn(xp) : xp);
    X.EntityList.list.length = n0 - 1 >= 0 ? n0 - 1 : 0;   // drop the mob and its orbs/items: the list stays flat
  }
  return out;
}
const xstat = (a) => { const n = a.length, m = a.reduce((s, x) => s + x, 0) / n; return { n, m, v: a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, n - 1), sup: [...new Set(a)] }; };
function xpGoldFor(mob) { const g = xpGold[mob]; return g && g.mob === mob && g.values && g.values.length && !g.alive ? g.values : null; }
function checkXp(mob, mut = {}) {
  const gv = xpGoldFor(mob);
  if (!gv) return null;
  const ev = xpKills(mob, N_E, mut);
  if (!ev) return [`${mob}: the engine cannot spawn it for the XP kill`];
  const g = xstat(gv), e = xstat(ev), bad = [];
  if (e.sup.some((x) => !g.sup.includes(x))) bad.push(`${mob}: XP values engine {${e.sup.sort((a, b) => a - b)}} vs server {${g.sup.sort((a, b) => a - b)}}`);
  const se = Math.sqrt(g.v / g.n + e.v / e.n) || 1e-9;
  if (Math.abs(g.m - e.m) > Z * se + 1e-9) bad.push(`${mob}: XP mean engine ${e.m.toFixed(2)} vs server ${g.m.toFixed(2)}`);
  return bad;
}

// Burning mob (this_entity on_fire): the furnace_smelt cooked drops. `skipSmelt` is the mutation that never lights the mob.
// /loot kill rolls the victim's own table: a default sheep is white.
function checkFire(mob, skipSmelt = false) {
  const van = fireGolden[mob];
  return van ? compare(mob + ' (on fire)', van, engineStats(mob, {}, { isOnFire: !skipSmelt }, 0, mob === 'sheep' ? 'entities/sheep/white' : 'entities/' + mob)) : [];
}

// Variant column: the table the engine picks per entity state (Cb.lootTableId) vs the server's own variant tables, and the baby gate.
const VAR_COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
function variantRows(mut = {}) {
  const rows = [], Cb = M.Combat;
  const roll = (table) => { const rng = L.rng(SEED), rec = { rolls: 0, items: {} };
    for (let i = 0; i < N_E; i++) { rec.rolls++; const per = {}; for (const s of L.rollTable(table, { rng })) if (s.count > 0) per[s.item] = (per[s.item] || 0) + s.count;
      for (const [id, n] of Object.entries(per)) { const x = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0 }); x.total += n; x.sq += n * n; x.hits++; } }
    return rec; };
  for (const c of VAR_COLOURS) {
    const id = Cb.lootTableId({ type: 'sheep', woolColor: c, sheared: false }).replace(/^entities\//, '');
    if (id !== 'sheep/' + c) { rows.push(`sheep ${c}: engine picks ${id}`); continue; }
    if (!golden[id]) { rows.push(`sheep ${c}: no server table ${id}`); continue; }
    rows.push(...compare('sheep/' + c, golden[id], roll('entities/' + id)));
  }
  if (Cb.lootTableId({ type: 'sheep', woolColor: 'red', sheared: true }) !== 'entities/sheep') rows.push('sheared sheep must roll plain entities/sheep');
  for (const t of ['cow', 'sheep', 'pig', 'chicken', 'rabbit', 'zombie']) {
    const baby = Cb.shouldDropLoot(mut.baby ? { type: t, growAge: -24000, isBaby: true, ...mut.baby } : { type: t, growAge: -24000, isBaby: true });
    if (mut.babyLoots ? true : baby) rows.push(`${t}: a baby drops loot (LivingEntity.shouldDropLoot is !isBaby)`);
    if (!Cb.shouldDropLoot({ type: t, growAge: 0 })) rows.push(`${t}: an adult drops no loot`);
  }
  // slime/magma_cube size gate and rabbit/tropical_fish tables must exist on both sides
  for (const t of ['slime', 'magma_cube', 'rabbit', 'tropical_fish', 'pufferfish']) if (!!golden[t] !== L.hasTable('entities/' + t)) rows.push(`${t}: table present on one side only`);
  return rows;
}

function Cb_lootTableIdMut() { const Cb = M.Combat, o = Cb.lootTableId; Cb.lootTableId = (e) => 'entities/sheep'; const r = variantRows().length > 0; Cb.lootTableId = o; return r; }
// Killer-kind matrix (#7861). The golden is the server's /loot roll: ORIGIN only, so no killer and not killed by a player
// (runloot.mjs header). Every NON-player kill must therefore give the golden's rows, whatever hit: mob melee, explosion,
// fire, fall/void. A skeleton arrow differs only for the creeper (music disc: damage_source_properties + killer type).
const KILLS = {
  'mob melee': { killer: { type: 'zombie' }, damageSource: {} },
  'explosion': { damageSource: { is_explosion: true } },
  'fire': { damageSource: { is_fire: true } },
  'fall/void': { damageSource: { bypasses_armor: true, bypasses_magic: true } },
  'skeleton arrow': { killer: { type: 'skeleton' }, damageSource: { is_projectile: true } },
};
const PLAYER = { killedByPlayer: true, killer: { type: 'player' }, damageSource: {} };
function matrixRows(mut = {}) {
  const rows = [];
  for (const [kind, kctx] of Object.entries(KILLS)) for (const mob of roster) {
    if (!golden[mob] || !L.hasTable('entities/' + mob) || (kind === 'skeleton arrow' && mob === 'creeper')) continue;
    for (const r of compare(mob, golden[mob], engineStats(mob, mut, kctx))) rows.push(`[${kind}] ${r}`);
  }
  return rows;
}
const hitRate = (mob, item, kctx, mut = {}) => { const e = engineStats(mob, mut, kctx).items[item]; return e ? e.hits / N_E : 0; };
// #7865: spawn-time EQUIPMENT drops of the armed mobs (golden equip-drop.json from tools/referee/runequipdrop.mjs: NBT-less summons,
// real player kill). Per mob and gear id: drops per kill within Z=5 standard errors; pooled over all armed mobs within Z=4 (a base
// chance of 0.1 for 0.085 is only ~4 sigma pooled -- no single mob has the pieces for it). Skipped, said so, with no golden.
const EQ_GOLDEN = [join(refDir, 'golden', 'equip-drop.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'equip-drop.json')].find((f) => existsSync(f));
const eqGold = EQ_GOLDEN ? JSON.parse(readFileSync(EQ_GOLDEN, 'utf8')).mobs : null;
const eqMobs = eqGold ? EQ_MOBS.filter((m) => eqGold[m] && eqGold[m].kills > 0) : [];
const eqCache = {};
const eqEngine = (mob, mut) => mut ? engineGear(mob, N_E, mut) : (eqCache[mob] || (eqCache[mob] = engineGear(mob, N_E)));
function eqRate(label, hv, nv, he, ne, z) {
  const pv = hv / nv, pe = he / ne, p = (hv + he) / (nv + ne), se = Math.sqrt(p * (1 - p) * (1 / nv + 1 / ne)) || 1e-9;
  return Math.abs(pe - pv) > z * se + 1e-9 ? [`${label}: engine ${(pe * 100).toFixed(2)}% vs server ${(pv * 100).toFixed(2)}% per kill`] : [];
}
function eqCheck(mut) {
  const out = []; let hv = 0, nv = 0, he = 0, ne = 0;
  for (const mob of eqMobs) {
    const v = eqGold[mob], e = eqEngine(mob, mut);
    for (const id of new Set([...Object.keys(v.items), ...Object.keys(e.items)])) out.push(...eqRate(`${mob}: equipment drop ${id}`, v.items[id] || 0, v.kills, e.items[id] || 0, e.kills, 5));
    for (const id in v.items) hv += v.items[id]; for (const id in e.items) he += e.items[id];
    nv += v.kills; ne += e.kills;
  }
  if (nv) out.push(...eqRate('all armed mobs pooled: equipment drops', hv, nv, he, ne, 4));
  return out;
}
let bad = 0;
const eqRows = eqGold ? eqCheck() : [];
for (const r of matrixRows()) { bad++; console.log('NEW RED ' + r); }
// a player kill gives the player-only drops, a mob kill never does
for (const [mob, item] of [['zombie', 'iron_ingot'], ['skeleton', 'arrow'], ['rabbit', 'rabbit_foot'], ['wither_skeleton', 'wither_skeleton_skull']]) {
  if (!L.hasTable('entities/' + mob)) continue;
  const pl = hitRate(mob, item, { ...PLAYER, looting: 3 }), mb = hitRate(mob, item, KILLS['mob melee']);
  if (item !== 'arrow' && !(pl > 0 && pl > mb)) { bad++; console.log(`player-only ${mob}/${item}: player ${pl}, mob ${mb}`); }
}
const disc = (k) => Object.keys(engineStats('creeper', {}, k).items).filter((i) => i.startsWith('music_disc')).length;
if (!(disc(KILLS['skeleton arrow']) > 0 && disc(KILLS['mob melee']) === 0)) { bad++; console.log('creeper disc: only a skeleton-family killer drops one'); }

const out = {};
{ const v = variantRows(); for (const r of v) { bad++; console.log('NEW RED variants: ' + r); } out._variants = { pass: !v.length, failed: v }; }
for (const mob of roster) {
  const failed = checkMob(mob).concat(checkFire(mob), checkLooting(mob), eqRows.filter((r) => r.startsWith(mob + ':'))), has = !!golden[mob], xr = checkXp(mob);
  if (xr) failed.push(...xr);
  out[mob] = { pass: failed.length === 0, checked: [...(xr ? ['player-kill XP total: support and mean vs the real server'] : []), ...(fireGolden[mob] ? ['on-fire cooked drops (furnace_smelt) vs the real server'] : []), has ? 'unconditional loot roll + Looting I-III player kill: per-item rate and mean count vs the real server' : 'no loot table on the server and none in the engine'], notCovered: (has ? known.notCovered : ['no loot table in vanilla: nothing conditional to cover']).concat(xr ? [] : ['XP amounts (no plain-kill golden for this mob)']), failed };
  for (const r of failed) if (!known.failedRows.includes(r)) { bad++; console.log('NEW RED ' + mob + ': ' + r); }
}
for (const r of eqRows.filter((r) => !roster.some((m) => r.startsWith(m + ':')))) { bad++; console.log('NEW RED ' + r); }
const seen = new Set(Object.values(out).flatMap((o) => o.failed));
for (const r of known.failedRows) if (!seen.has(r)) { bad++; console.log('STALE known row (fixed? remove it): ' + r); }
if (known.notCovered.length > known.max) { bad++; console.log('notCovered ledger grew'); }
mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(T, 'mobproof', 'out', 'drops.json'), JSON.stringify(out, null, 1));

let caught = 0;
const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
brk(checkFire('cow', true).length > 0, 'smelt skipped (cow)');
brk(checkFire('pig', true).length > 0, 'smelt skipped (pig)');
brk(checkMob('cow', { fn: (d) => d.map((s) => s.item === 'beef' ? { ...s, count: s.count + 1 } : s) }).length > 0, 'count +1');
brk(checkLooting('zombie', { looting: 0 }).length > 0, 'looting ignored');
brk(checkLooting('cow', { looting: 0 }).length > 0, 'looting ignored (cow)');
{ const r = checkLooting('blaze', { looting: 4 }); brk(r.length > 0 && /^blaze looting/.test(r[0]), 'looting off by one names the mob'); }
brk(checkMob('cow', { fn: (d) => d.filter((s) => s.item !== 'leather') }).length > 0, 'lost item');
brk(checkMob('cow', { fn: (d) => d.concat([{ item: 'diamond', count: 1 }]) }).length > 0, 'spurious item');
brk(checkMob('zombie', { fn: (d) => d.concat([{ item: 'iron_ingot', count: 1 }]) }).length > 0, 'rare item always');
brk(checkMob('sheep', { fn: (d) => d.map((s) => s.item === 'mutton' ? { ...s, count: 3 } : s) }).length > 0, 'count fixed');
if (eqGold) brk(eqCheck((M2) => { const o = M2.Equip.DEFAULT_DROP_CHANCE; M2.Equip.DEFAULT_DROP_CHANCE = 0.1; return () => { M2.Equip.DEFAULT_DROP_CHANCE = o; }; }).length > 0, 'base drop chance 0.1');
else console.log('mobdropsproofcheck: equipment drops SKIPPED (golden not generated -- run node tools/referee/runequipdrop.mjs)');
brk(variantRows({ babyLoots: true }).length > 0, 'baby cow leather');
{ const sv = Cb_lootTableIdMut(); brk(sv, 'sheep colour table'); }
brk(matrixRows({ ctx: { killedByPlayer: true } }).some((r) => r.includes('zombie:')), 'killed_by_player forced: zombie');
brk(matrixRows({ ctx: { killedByPlayer: true } }).some((r) => r.includes('skeleton:')), 'killed_by_player forced: skeleton');
brk(matrixRows({ ctx: { killedByPlayer: true, looting: 3 } }).some((r) => r.includes('rabbit:')), 'killed_by_player forced: rabbit');
brk(checkXp('zombie', { fn: (x) => (x === 5 ? 3 : x) }).length > 0 && /zombie/.test(checkXp('zombie', { fn: (x) => (x === 5 ? 3 : x) }).join()), 'zombie drops 3 xp instead of 5, named');
console.log(bad ? `FAIL ${bad} bad (${roster.length} mobs)` : `mobdropsproofcheck: ${roster.length} mobs, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
