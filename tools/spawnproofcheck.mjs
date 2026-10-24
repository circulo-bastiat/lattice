#!/usr/bin/env node
// spawnproofcheck (#7525): spawn dimension of the mob proof. Per roster mob (tools/mobl3-mobs.json): every biome `spawners` row and
// structure `spawn_overrides` row naming it (weight, min/max group, category) from the vanilla worldgen data vs the engine's
// Biomes.spawners / Structures.defs, no engine-only rows, Spawn.canPlace rule present and Spawn.LOCATION == SpawnRestriction in .decomp.
// Light rule per mob (#8812): tools/spawnlight-decomp.mjs vs the engine rule source. Oracle = .mcdata + .decomp. Writes tools/mobproof/out/spawn.json. Also despawn rules per mob (SpawnGroup ranges, persistence, canImmediatelyDespawn kind). Not covered (moon/y rules, caps, eggs/spawners,
// variants, equipment): other checks own those (spawnrulecheck, spawncapcheck, despawncheck, lockstep-spawn*) - listed per mob; ledger
// tools/spawnproof-known.json is shrink-only.
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { MCDATA } from './paths.mjs';
import { parseSpawnLocations, readDecomp, decompPresent } from './spawnloc-decomp.mjs';
import { parseSpawnLight } from './spawnlight-decomp.mjs';

const T = dirname(fileURLToPath(import.meta.url)), ROOT = join(T, '..');
const WG = join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen');
if (!existsSync(join(ROOT, 'assets', 'entities.json')) || !existsSync(join(WG, 'biome')) || !decompPresent()) { console.log('spawnproofcheck: SKIP — assets, .mcdata or .decomp missing'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const roster = Object.keys(JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs);
const known = JSON.parse(readFileSync(join(T, 'spawnproof-known.json'), 'utf8'));

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ dom: true, extra: ['09b_sky.js', '14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init();
M.Gen.init(1, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const B = M.Biomes, ST = M.Structures;
const jd = (d) => Object.fromEntries(readdirSync(join(WG, d)).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(WG, d, f), 'utf8'))]));
const bare = (t) => String(t).replace(/^minecraft:/, '');
const flat = (sp) => { const o = {}; for (const c of Object.keys(sp || {})) for (const e of (Array.isArray(sp[c]) ? sp[c] : (sp[c].spawns || []))) o[`${c}|${bare(e.type)}`] = `${e.weight}/${e.minCount}/${e.maxCount}`; return o; };

const golden = new Map(), engine = new Map();
for (const [n, j] of Object.entries(jd('biome'))) { const f = flat(j.spawners); for (const k in f) golden.set(`biome:${n}|${k}`, f[k]); }
for (const [n, j] of Object.entries(jd('configured_structure_feature'))) for (const c of Object.keys(j.spawn_overrides || {}))
  for (const e of j.spawn_overrides[c].spawns) golden.set(`struct:${n}|${c}|${bare(e.type)}`, `${e.weight}/${e.minCount}/${e.maxCount}`);
for (let i = 0; i < B.count; i++) { const f = flat(B.spawners(i)); for (const k in f) engine.set(`biome:${bare(B.name(i))}|${k}`, f[k]); }
for (const n of Object.keys(ST.defs)) { const ov = ST.defs[n].spawnOverrides; if (!ov) continue;
  for (const c of Object.keys(ov)) for (const e of ov[c].spawns) engine.set(`struct:${n}|${c}|${bare(e.type)}`, `${e.weight}/${e.minCount}/${e.maxCount}`); }
const locG = parseSpawnLocations(readDecomp()).table;
const ruleE = (t) => M.Spawn.canPlace(t), locE = (t) => M.Spawn.locationOf(t);
// light rule per mob (#8812): vanilla class from the SpawnRestriction predicate's body in .decomp (dark = isSpawnDark/canSpawnInDark,
// bright = isLightLevelValidForNaturalSpawn/isValidNaturalSpawn, own = the mob's own light read, none) vs the class of the engine rule's source.
const lightG = parseSpawnLight(readDecomp());
const nocomment = (f) => Function.prototype.toString.call(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
// engine rule source, following delegation one hop at a time: Spawn.RULES.<other>, NS.<Mod>.<fn>
function ruleSrc(t, seen = new Set()) {
  const f = M.Spawn.RULES[t]; if (!f || seen.has(f)) return '';
  seen.add(f); let src = nocomment(f);
  for (const m of src.matchAll(/Spawn\.RULES\.(\w+)/g)) src += '\n' + ruleSrc(m[1], seen);
  for (const m of src.matchAll(/NS\.(\w+)\.(\w+)/g)) { const g = M[m[1]] && M[m[1]][m[2]]; if (typeof g === 'function' && !seen.has(g)) { seen.add(g); src += '\n' + nocomment(g); } }
  return src;
}
const lightOf = (src) => /isDarkEnoughToSpawn/.test(src) ? 'dark' : /isBrightEnoughToSpawn/.test(src) ? 'bright' : /getLight\(|rawBrightness|getSkyLight|blockLight|Brightness/.test(src) ? 'own' : 'none';
const lightE = (t) => M.Spawn.RULES[t] ? lightOf(ruleSrc(t)) : null;
const mobOf = (k) => k.split('|')[2];

// failed rows + checked count for one mob
function proveMob(mob, g = golden, e = engine, rule = ruleE, loc = locE, light = lightE, lg = lightG) {
  const f = []; let n = 0, listed = false;
  for (const [k, v] of g) if (mobOf(k) === mob) { listed = true; n++; const x = e.get(k); if (x === undefined) f.push(`${k} missing (vanilla ${v})`); else if (x !== v) f.push(`${k} engine ${x} vanilla ${v}`); }
  for (const k of e.keys()) if (mobOf(k) === mob && !g.has(k)) { n++; f.push(`${k} engine-only`); }
  if (listed) {
    if (!rule(mob)) f.push(`${mob}: listed in a spawn table but no Spawn.RULES`);
    if (loc(mob) !== (locG[mob] || 'none')) f.push(`${mob}: location ${loc(mob)} != SpawnRestriction ${locG[mob] || 'none'}`);
    n += 2;
  }
  if (lg[mob] && light(mob) !== null) { n++; if (light(mob) !== lg[mob]) f.push(`${mob}: light rule ${light(mob)} != vanilla ${lg[mob]}`); }
  return { f, n, listed };
}

// despawn rules per mob, parsed from .decomp: SpawnGroup (ranges, rare=persistent) + first canImmediatelyDespawn override up the extends-chain
const DE = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
const sgSrc = readFileSync(join(DE, 'SpawnGroup.java'), 'utf8');
const grpName = {}, grpG = {};
for (const m of sgSrc.matchAll(/(field_\d+)\("(\w+)",\s*(-?\d+),\s*(true|false),\s*(true|false),\s*(\d+)\)/g)) {
  grpName[m[1]] = m[2]; grpG[m[2]] = { noDespawn: +(sgSrc.match(/despawnStartRange = (\d+)/) || [])[1], despawn: +m[6], persistent: m[5] === 'true' }; }
const ext = {}, ovr = {};
(function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.java')) {
  const s = readFileSync(p, 'utf8'), m = s.match(/class (\w+)(?:<[^{]*?>)? extends (\w+)/); if (m) ext[m[1]] = m[2];
  if (/boolean canImmediatelyDespawn\(/.test(s) || (f.name === 'WitherEntity.java' && /void checkDespawn\(/.test(s))) ovr[f.name.slice(0, -5)] = 1; } } })(DE);
const etSrc = readFileSync(join(DE, 'EntityType.java'), 'utf8');
const despG = new Map();
for (const m of etSrc.matchAll(/"([a-z_]+)",\s*EntityType\.Builder\.(?:<[^>]*>)?create\(\s*(\w+)::new,\s*SpawnGroup\.(field_\d+)/g)) {
  let c = m[2], o = null, isMob = false; for (let i = 0; c && i < 14; i++) { if (!o && ovr[c]) o = c; if (c === 'MobEntity') { isMob = true; break; } c = ext[c]; }
  if (!isMob) continue;
  despG.set(m[1], `${grpName[m[3]]}|${JSON.stringify(grpG[grpName[m[3]]])}|${o}`); }
const despE = (mob) => { const t = M.Spawn.DESPAWN_TYPES[mob]; if (!t) return undefined; const c = M.Spawn.CATEGORY[t[0]];
  const KIND = { mob: 'MobEntity', animal: 'AnimalEntity', never: null, cat: 'CatEntity', ocelot: 'OcelotEntity', chicken: 'ChickenEntity', fish: null, unpersisted: null, zvillager: 'ZombieVillagerEntity', raider: 'RaiderEntity' };
  return `${t[0]}|${JSON.stringify({ noDespawn: c.noDespawn, despawn: c.despawn, persistent: c.persistent })}|${t[1]}`; };
// compare group + ranges + persistence exactly; override class is compared via the kind it maps to
const KINDOF = { MobEntity: 'mob', AnimalEntity: 'animal', GolemEntity: 'never', WitherEntity: 'never', VillagerEntity: 'never', WanderingTraderEntity: 'never', CatEntity: 'cat', OcelotEntity: 'ocelot', ChickenEntity: 'chicken', FishEntity: 'fish', AxolotlEntity: 'fish', HoglinEntity: 'unpersisted', PiglinEntity: 'unpersisted', ZombieVillagerEntity: 'zvillager', RaiderEntity: 'raider' };
const despGold = (mob) => { const v = despG.get(mob); if (!v) return undefined; const i = v.lastIndexOf('|'); return v.slice(0, i) + '|' + KINDOF[v.slice(i + 1)]; };
function proveDespawn(mob, eng = despE) { const g = despGold(mob), e = eng(mob);
  if (g === undefined) return e === undefined ? [] : [`${mob}: despawn rules in engine but not a MobEntity in .decomp`];
  return e === g ? [] : [`${mob}: despawn rules engine ${e} != decomp ${g}`]; }
// Y-range / sea-level rules per mob: numbers parsed from the .decomp source vs the same numbers read from the engine rule.
const DC = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
const dsrc = (f, name) => { const t = readFileSync(join(DC, f), 'utf8'), i = t.indexOf(name); return i < 0 ? '' : t.slice(i, i + 1500); };
const sq = (s) => String(s).replace(/\s+/g, '');
// decomp side: canonical string per mob
const yG = {
  squid: () => { const d = sq(dsrc('mob/WaterCreatureEntity.java', 'boolean canSpawn')); return /getSeaLevel\(\)/.test(d) && /\$\$5-13/.test(d) && /getY\(\)>=\$\$6/.test(d) && /getY\(\)<=\$\$5/.test(d) ? 'sea-13..sea' : 'unparsed'; },
  glow_squid: () => { const m = sq(dsrc('passive/GlowSquidEntity.java', 'boolean canSpawn')).match(/getY\(\)<=\$\$1\.getSeaLevel\(\)-(\d+)/); return m ? `y<=sea-${m[1]}` : 'unparsed'; },
  bat: () => { const m = sq(dsrc('passive/BatEntity.java', 'boolean canSpawn')).match(/getY\(\)>=\$\$1\.getSeaLevel\(\)\)\{returnfalse/); return m ? 'refuse y>=sea' : 'unparsed'; },
  slime: () => { const d = sq(dsrc('mob/SlimeEntity.java', 'boolean canSpawn')); const a = d.match(/getY\(\)>(\d+)&&\$\$3\.getY\(\)<(\d+)/), b = d.match(/&&\$\$3\.getY\(\)<(\d+)\)\{returncanMobSpawn/); return a && b ? `swamp ${a[1]}<y<${a[2]}; chunk y<${b[1]}` : 'unparsed'; },
  drowned: () => { const d = sq(dsrc('mob/DrownedEntity.java', 'boolean canSpawn')), v = sq(dsrc('mob/DrownedEntity.java', 'boolean isValidSpawnDepth')).match(/getY\(\)<\$\$0\.getSeaLevel\(\)-(\d+)/); return /nextInt\(40\)==0&&isValidSpawnDepth/.test(d) && v ? `ocean y<sea-${v[1]}` : 'unparsed'; },
  dolphin: () => { const r = readFileSync(join(DC, 'SpawnRestriction.java'), 'utf8'); return /field_6087, [^;]*WaterCreatureEntity::canSpawn/.test(r) || /DolphinEntity|field_6087/.test(r) ? 'sea-13..sea' : 'unparsed'; },
};
// engine side: same shape, from the engine functions themselves
const SEA = M.Spawn.SEA_LEVEL, fsrc = (f) => sq(f.toString());
const yE = {
  squid: () => { const f = fsrc(M.Squid.canSpawn); return /y<sl-13\|\|y>sl/.test(f) && M.Squid.canSpawn.length >= 3 && SEA === 63 ? 'sea-13..sea' : 'differs:' + f.slice(0, 80); },
  glow_squid: () => { const m = fsrc(M.Squid.glowCanSpawn).match(/y>sl-(\d+)/); return m ? `y<=sea-${m[1]}` : 'differs'; },
  bat: () => (M.Bat.lightRule(SEA, 0, SEA, () => 0, true) === false && M.Bat.lightRule(SEA - 1, 0, SEA, () => 0, true) === true) ? 'refuse y>=sea' : 'differs',
  slime: () => { const f = sq(M.Spawn.RULES.slime.toString()); const a = f.match(/y>(\d+)&&y<(\d+)/), b = f.match(/y<(\d+)\)returncheckMobSpawnRules/); return a && b ? `swamp ${a[1]}<y<${a[2]}; chunk y<${b[1]}` : 'differs'; },
  drowned: () => { const f = sq(M.Spawn.RULES.drowned.toString()), m = f.match(/rnd\(40\)!==0\)returnfalse;returny<Spawn\.SEA_LEVEL-(\d+)/); return m ? `ocean y<sea-${m[1]}` : 'differs'; },
  dolphin: () => M.Spawn.RULES.dolphin.toString().includes('Squid.canSpawn') ? 'sea-13..sea' : 'differs',
};
function proveY(mob, yg = yG, ye = yE) {
  if (!yg[mob]) return [];
  const g = yg[mob](), e = ye[mob]();
  return g === e ? [] : [`${mob}: y/sea-level rule engine '${e}' != decomp '${g}'`];
}
// variant rolls (#8816): decomp RabbitEntity.chooseType / ParrotEntity.initialize parsed, engine driven over every roll
const vsrc = (f) => readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'entity', 'passive', f), 'utf8');
const rbSrc = vsrc('RabbitEntity.java').match(/private int chooseType[\s\S]*?\n    }\n/)[0];
const [, snowLo, snowHi] = rbSrc.match(/\$\$2 < (\d+) \? (\d+) : (\d+)/);
const rbDesert = +rbSrc.match(/field_9368\) \{\s*return (\d+)/)[1];
const rbT = rbSrc.match(/\$\$2 < (\d+) \? (\d+) : \(\$\$2 < (\d+) \? (\d+) : (\d+)\)/).slice(1).map(Number);
const parrotN = +vsrc('ParrotEntity.java').match(/setVariant\(this\.random\.nextInt\((\d+)\)\)/)[1];
const rabbitVal = (rb, precip, cat, roll) => rb.chooseType(precip, cat, () => (roll + 0.5) / 100);
function variantDiff(rb, parrotRoll) {
  const f = [], T = rb.TYPE, nm = { 0: T.BROWN, 1: T.WHITE, 2: T.BLACK, 3: T.WHITE_SPOTTED, 4: T.GOLD, 5: T.SALT };
  for (let r = 0; r < 100; r++) {
    const g = [r < +snowLo ? +snowHi : 0, 0];
    const wantSnow = r < +snowLo ? +snowHi : +rbSrc.match(/\$\$2 < \d+ \? \d+ : (\d+)/)[1];
    const wantDesert = rbDesert, wantOther = r < rbT[0] ? rbT[1] : (r < rbT[2] ? rbT[3] : rbT[4]);
    if (rabbitVal(rb, 2, 'plains', r) !== nm[wantSnow]) f.push(`rabbit snow roll ${r}: engine ${rabbitVal(rb, 2, 'plains', r)} vanilla ${nm[wantSnow]}`);
    if (rabbitVal(rb, 0, 'desert', r) !== nm[wantDesert]) f.push(`rabbit desert roll ${r}`);
    if (rabbitVal(rb, 0, 'plains', r) !== nm[wantOther]) f.push(`rabbit other roll ${r}: engine ${rabbitVal(rb, 0, 'plains', r)} vanilla ${nm[wantOther]}`);
  }
  for (let r = 0; r < parrotN; r++) { const v = parrotRoll(r); if (v !== r) f.push(`parrot roll ${r}: engine variant ${v}`); }
  return f;
}
const parrotE = (n) => (r) => { const e = {}; const EL = M.EntityList, o = EL.randomOf; EL.randomOf = () => () => (r + 0.5) / n; try { EL.DEFAULTS.parrot(e, {}); } finally { EL.randomOf = o; } return e.parrotVariant; };
const vdiff = (rb = M.Rabbit, pr = parrotE(parrotN)) => variantDiff(rb, pr).concat(parrotN === 5 ? [] : [`parrot nextInt(${parrotN}) != engine 5`]);
// ── spawn equipment roll (initEquipment) per mob: parsed from .decomp vs the engine's Equipment/Piglin tables ──
const MOBD = join(ROOT, '.decomp', 'net', 'minecraft', 'entity', 'mob'), ITEMS_J = join(ROOT, '.decomp', 'net', 'minecraft', 'item', 'Items.java');
const itemName = {}; for (const m of readFileSync(ITEMS_J, 'utf8').matchAll(/(field_\d+)\s*=\s*register\(\s*"(\w+)"/g)) itemName[m[1]] = m[2];
const camel = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('') + 'Entity';
const src = (cls) => { const f = join(MOBD, cls + '.java'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
const body = (t) => { const i = t.indexOf('void initEquipment(LocalDifficulty'); if (i < 0) return null; let d = 0, j = t.indexOf('{', i); const a = j;
  for (; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}' && --d === 0) break; } return t.slice(a, j + 1); };
// spec: { main: fixed mainhand item, base: reaches MobEntity's armour roll, zw: zombie weapon chance normal/hard, dw: drowned 'chance/nextInt/trident<' , pg: piglin 'crossbow/armour' }
function decompSpec(id) {
  let cls = camel(id), t = src(cls); if (!t) return null;
  const spec = { main: null, base: false, zw: null, dw: null, pg: null }; let own = true, found = false;
  for (let hop = 0; t && hop < 6; hop++) {
    const b = body(t);
    if (b) { found = true;
      const w = /equipStack\(EquipmentSlot\.field_6173, new ItemStack\(Items\.(field_\d+)\)\)/.exec(b);
      if (w && own && !/nextFloat|nextInt/.test(b.split(w[0])[0].replace(/super\.initEquipment/, ''))) spec.main = itemName[w[1]];
      if (/GOLDEN|Items\.field_8825/.test(b) && id === 'piglin_brute') spec.main = itemName.field_8825;
      const z = /nextFloat\(\) < \(this\.world\.getDifficulty\(\) == Difficulty\.field_5807 \? ([\d.]+)F : ([\d.]+)F\)/.exec(b);
      if (z && !spec.zw && t.includes('class ZombieEntity')) spec.zw = `${z[2]}/${z[1]}`;
      if (id === 'drowned' && own) { const c = /nextFloat\(\) > ([\d.]+)\)/.exec(b), n = /nextInt\((\d+)\)/.exec(b), k = /\$\$1 < (\d+)/.exec(b);
        spec.dw = `${c[1]}/${n[1]}/${k[1]}/${itemName[/Items\.(field_\d+)/.exec(b.slice(b.indexOf('if ($$1 <')))[1]]}`; }
      if (/super\.initEquipment/.test(b)) { own = false; } else { spec.base = hop > 0 ? spec.base : false; break; }
    }
    const sup = /class \w+ extends (\w+)/.exec(t); if (!sup) break; t = src(sup[1]); if (sup[1] === 'MobEntity') { spec.base = found; break; }
    if (!t) break;
  }
  if (!found) { const w = /EntityData initialize\([\s\S]*?equipStack\(EquipmentSlot\.field_6173, new ItemStack\(Items\.(field_\d+)\)\)/.exec(src(cls));   // weapon given in initialize itself (illusioner)
    if (w) return Object.assign(spec, { main: itemName[w[1]] }); }
  if (!found) return { main: null, base: false, zw: null, dw: null, pg: null, none: true };
  if (id === 'piglin') { const t0 = src('PiglinEntity'); spec.pg = `${/nextFloat\(\) < ([\d.]+)\s*\?\s*new ItemStack\(Items\.field_8399\)/.exec(t0)[1]}/${/world\.random\.nextFloat\(\) < ([\d.]+)F/.exec(t0)[1]}`; }
  return spec;
}
const probeZombie = (id) => {
  const Eq = M.Equip; if (!Eq.ZOMBIE_WEAPON[id]) return null;
  const o = M.Diff.value, oi = M.Items, os = Eq.stackOf, got = [], IT = { ready: true, MAINHAND: 0, nameOf: () => null };
  M.Items = IT; Eq.stackOf = (n) => ({ n });   // the roll only needs a stack to appear in the mainhand
  for (const d of ['normal', 'hard']) { M.Diff.value = d; let lo = 0, hi = 1;   // bisect the nextFloat() < threshold boundary
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2, e = { type: id, equip: [] }; Eq.rollZombieWeapon(e, () => mid); if (e.equip[IT.MAINHAND]) lo = mid; else hi = mid; }
    got.push(+lo.toFixed(4)); }
  M.Diff.value = o; M.Items = oi; Eq.stackOf = os; return `${got[0]}/${got[1]}`;
};
function engineSpec(id) {
  const Eq = M.Equip, Pg = M.Piglin; const spec = { main: null, base: false, zw: null, dw: null, pg: null };
  if (Eq.WEAPON_FOR[id]) spec.main = Eq.WEAPON_FOR[id];
  if (id === 'piglin_brute') spec.main = 'golden_axe';
  spec.base = !!(Eq.WEAPON_FOR[id] || Eq.ZOMBIE_WEAPON[id] || id === 'drowned') && !Eq.NO_BASE_ARMOR[id];
  spec.zw = probeZombie(id);
  if (id === 'drowned') spec.dw = `${Eq.DROWNED_WEAPON_CHANCE}/16/${Eq.DROWNED_TRIDENT_ROLL}/trident`;
  if (id === 'piglin') spec.pg = `${Pg.CROSSBOW_CHANCE}/${Pg.ARMOR_CHANCE}`;
  return spec;
}
const eqRow = (id, d = decompSpec(id), e = engineSpec(id)) => ({ d, f: !d || d.none && !e.main && !e.base && !e.zw ? [] :
  ['main', 'base', 'zw', 'dw', 'pg'].filter((k) => String(d[k]) !== String(e[k])).map((k) => `${id}: equipment ${k} engine ${e[k]} vanilla ${d[k]}`) });
// baby chance per mob: engine constant vs the literal parsed from .decomp initialize (ZombieEntity.shouldBeBaby, PiglinEntity/HoglinEntity.initialize).
// Passive pack babies are literals inside EL.spawn (no table), so they stay in notCovered.
const bsrc = (c) => readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'entity', 'mob', c + '.java'), 'utf8');
const lit = (src, re) => { const m = re.exec(src); return m ? Number(m[1]) : NaN; };
const zombieG = lit(bsrc('ZombieEntity'), /shouldBeBaby\([^)]*\)\s*\{\s*return [^<]*<\s*([0-9.]+)F/);
const pigG = lit(bsrc('PiglinEntity'), /initialize[\s\S]*?nextFloat\(\)\s*<\s*([0-9.]+)F/), hogG = lit(bsrc('HoglinEntity'), /initialize[\s\S]*?nextFloat\(\)\s*<\s*([0-9.]+)F/);
const zfam = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin']);   // ZombieEntity subclasses, none overrides the roll
const babyG = (m) => zfam.has(m) ? zombieG : m === 'piglin' ? pigG : m === 'hoglin' ? hogG : undefined;
const babyE = (m) => zfam.has(m) ? (M.EntityList.ZOMBIE_BABY_ROLL[m] ? M.Undead.BABY_CHANCE : undefined) : m === 'piglin' ? M.Piglin.BABY_CHANCE : m === 'hoglin' ? M.Hoglin.BABY_CHANCE : undefined;
const babyRow = (m, e = babyE(m)) => { const g = babyG(m); return g === e ? [] : [`${m}: baby chance engine ${e} vanilla ${g}`]; };

// Moon-phase / slime-chunk / halloween / magma rules (#8904): decision oracle built from constants parsed out of .decomp on every run,
// compared with the engine's Spawn.RULES over a grid (moon phase, y, light, biome, chunk, 64 seeds); the same random stream feeds both.
const slimeD = sq(readFileSync(join(DC, 'mob', 'SlimeEntity.java'), 'utf8').replace(/^[\s\S]*?boolean canSpawn/, '').slice(0, 1500));
const batD = readFileSync(join(DC, 'passive', 'BatEntity.java'), 'utf8'), batQ = sq(batD);
const moonSizesD = (readFileSync(join(DC, '..', 'world', 'dimension', 'DimensionType.java'), 'utf8').match(/MOON_SIZES = new float\[\]\{([^}]*)\}/) || [, ''])[1].split(',').map((v) => parseFloat(v));
const crD = sq(readFileSync(join(DC, '..', 'world', 'gen', 'random', 'ChunkRandom.java'), 'utf8').replace(/^[\s\S]*?getSlimeRandom/, '').slice(0, 400));
const pm = (re, src) => { const m = re.exec(src); return m ? m.slice(1) : null; };
const sl = {
  salt: pm(/getSeed\(\),(\d+)L\)\.nextInt\((\d+)\)==0/, slimeD), swamp: pm(/getY\(\)>(\d+)&&\$\$3\.getY\(\)<(\d+)&&\$\$4\.nextFloat\(\)<([\d.]+)F&&\$\$4\.nextFloat\(\)([<>]=?)\$\$1\.getMoonSize\(\)&&\$\$1\.getLightLevel\(\$\$3\)<=\$\$4\.nextInt\((\d+)\)/, slimeD),
  chunk: pm(/\$\$4\.nextInt\((\d+)\)==0&&\$\$6&&\$\$3\.getY\(\)<(\d+)/, slimeD), cr: pm(/\+\(long\)\(\$\$0\*\$\$0\*(\d+)\)\+\(long\)\(\$\$0\*(\d+)\)\+\(long\)\(\$\$1\*\$\$1\)\*(\d+)L\+\(long\)\(\$\$1\*(\d+)\)\^\$\$3/, crD),
  bat: pm(/isTodayAroundHalloween\(\)\)\{\$\$6=(\d+);\}elseif\(\$\$4\.nextBoolean\(\)\)\{returnfalse;\}return\$\$5>\$\$4\.nextInt\(\$\$6\)\?false:/, batQ), batInit: pm(/int\$\$6=(\d+);/, batQ),
  hal: pm(/\$\$2==(\d+)&&\$\$1>=(\d+)\|\|\$\$2==(\d+)&&\$\$1<=(\d+)/, batQ),
};
const JR = (seed) => { let x = BigInt(seed) & ((1n << 48n) - 1n); return { next: () => (x = (x * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n), x) , f() { return Number(this.next() >> 24n) / 16777216; }, i(n) { return Math.floor(this.f() * n); } }; };
function slimeOracle(P, g, wr, ri) {   // P = parsed decomp constants; wr()=nextFloat, ri(n)=nextInt
  if (g.peaceful) return false;
  const [lo, hi, pr, op, lb] = P.swamp, moon = moonSizesD[g.moon];
  if (g.swamp && g.y > +lo && g.y < +hi && wr() < +pr && (op === '<' ? wr() < moon : wr() > moon) && g.light <= ri(+lb)) return true;
  const [t1, t2, t3, t4] = P.cr.map(BigInt), cx = BigInt(g.cx), cz = BigInt(g.cz);
  const sd = BigInt.asIntN(64, BigInt(g.seed) + BigInt.asIntN(32, cx * cx * t1) + BigInt.asIntN(32, cx * t2) + BigInt.asIntN(32, cz * cz) * t3 + BigInt.asIntN(32, cz * t4));
  const r = new M.Noise.LegacyRandom(BigInt.asIntN(64, sd ^ BigInt(P.salt[0])));
  const sc = r.nextInt(+P.salt[1]) === 0;
  return ri(+P.chunk[0]) === 0 && sc && g.y < +P.chunk[1];
}
function batOracle(P, g, ri, rb) {
  if (g.y >= 63) return false;   // BatEntity.canSpawn: getSeaLevel() (63, proved by yG.bat)
  let b = +P.batInit[0]; if (g.hal) b = +P.bat[0]; else if (rb()) return false;
  return !(g.light > ri(b));
}
function proveGrid(P, eng) {
  const f = [], seen = {};
  if (!P.salt || !P.swamp || !P.chunk || !P.cr || !P.bat || !P.hal || moonSizesD.length !== 8) return ['moon/chunk rules: decomp constants unparsed'];
  const W = M.World, S = M.Sky, EL = M.EntityList, save = { gl: W.getLight, ba: W.biomeAt, bn: M.Biomes.name, br: M.Biomes.ready, wr: EL.wr, dn: S.darknessNow, th: S.isThundering, dt: S.dayTime, sd: W.seed64, dv: M.Diff.value, hl: M.Bat.isHalloween };
  try {
    M.Biomes.ready = true; W.biomeAt = () => 0; S.darknessNow = () => 0; S.isThundering = () => false;
    const rules = eng || M.Spawn.RULES;
    for (let moon = 0; moon < 8; moon++) for (const y of [-20, 39, 40, 50, 51, 62, 63, 69, 70, 100]) for (const light of [0, 3, 7, 15]) for (const swamp of [0, 1]) for (const [cx, cz] of [[0, 0], [5, -7], [-123, 456], [1000, 1000]]) for (const halloween of [0, 1]) for (let seed = 1; seed <= 64; seed++) {
      const g = { moon, y, light, swamp: !!swamp, cx, cz, seed: BigInt(seed) * 7919n, hal: !!halloween, peaceful: seed % 16 === 0 };
      const mk = () => JR(seed * 31 + moon);
      M.Biomes.name = () => swamp ? 'minecraft:swamp' : 'minecraft:plains'; W.getLight = () => light; W.seed64 = g.seed; S.dayTime = moon * S.TICKS_PER_DAY; M.Diff.value = g.peaceful ? 'peaceful' : 'normal'; M.Bat.isHalloween = () => g.hal;
      let r = mk(); EL.wr = () => r.f();
      const ri = (n) => r.i(n);
      const eS = !!rules.slime(cx * 16, y, cz * 16, 'spawner', ri);
      r = mk(); const oS = slimeOracle(P, g, () => r.f(), (n) => r.i(n));
      if (eS !== oS && !seen.s) { seen.s = 1; f.push(`slime: engine ${eS} != decomp ${oS} at ${JSON.stringify(g, (k, v) => typeof v === 'bigint' ? String(v) : v)}`); }
      r = mk(); const eB = !!rules.bat(cx * 16, y, cz * 16, 'spawner', ri);
      r = mk(); const oB = batOracle(P, g, (n) => r.i(n), () => r.i(2) === 1);
      if (eB !== oB && !seen.b) { seen.b = 1; f.push(`bat: engine ${eB} != decomp ${oB} at ${JSON.stringify(g, (k, v) => typeof v === 'bigint' ? String(v) : v)}`); }
      const eM = !!rules.magma_cube(cx * 16, y, cz * 16, 'spawner', ri), oM = !g.peaceful;
      if (eM !== oM && !seen.m) { seen.m = 1; f.push(`magma_cube: engine ${eM} != decomp ${oM} (canMagmaCubeSpawn = difficulty != PEACEFUL) at y ${y}`); }
    }
    const [m1, d1, m2, d2] = P.hal.map(Number);
    for (let mo = 1; mo <= 12; mo++) for (let d = 1; d <= 28; d++) { const e = M.Bat.isHalloween(new Date(2026, mo - 1, d)); S.dayTime = S.dayTime; }
    M.Bat.isHalloween = save.hl;
    for (let mo = 1; mo <= 12; mo++) for (let d = 1; d <= 28; d++) { const e = M.Bat.isHalloween(new Date(2026, mo - 1, d)), o = (mo === m1 && d >= d1) || (mo === m2 && d <= d2); if (e !== o && !seen.h) { seen.h = 1; f.push(`bat halloween window engine ${e} != decomp ${o} at ${mo}/${d}`); } }
    for (const d of [[10, 31], [11, 3], [11, 4], [10, 19], [10, 20]]) { const e = M.Bat.isHalloween(new Date(2026, d[0] - 1, d[1])), o = (d[0] === m1 && d[1] >= d1) || (d[0] === m2 && d[1] <= d2); if (e !== o && !seen.h) { seen.h = 1; f.push(`bat halloween edge engine ${e} != decomp ${o} at ${d}`); } }
  } finally { W.getLight = save.gl; W.biomeAt = save.ba; M.Biomes.name = save.bn; M.Biomes.ready = save.br; EL.wr = save.wr; S.darknessNow = save.dn; S.isThundering = save.th; S.dayTime = save.dt; W.seed64 = save.sd; M.Diff.value = save.dv; M.Bat.isHalloween = save.hl; }
  return f;
}
const gridF = proveGrid(sl);
// floor-block rule (allowsSpawning) per (mob, block state): Blocks.java overrides + AbstractBlock default (sturdy top, luminance < 14) vs Spawn.floorAllows
M.Behave.init(M.World);
const blSrc = readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'block', 'Blocks.java'), 'utf8');
const entTypeId = {};   // EntityType field -> id, for the two type-gated predicates
for (const m of etSrc.matchAll(/(field_\d+)\s*=\s*register\(\s*"([a-z_]+)"/g)) entTypeId[m[1]] = m[2];
const polarG = entTypeId[(blSrc.match(/\$\$3 == EntityType\.(field_\d+)\)\s*\n?\s*\.(?:solidBlock|\w+)/) || blSrc.match(/\$\$3 == EntityType\.(field_\d+)/))[1]];
const leafTypes = (blSrc.match(/canSpawnOnLeaves[\s\S]*?\{\s*return ([^;]*);/)[1].match(/EntityType\.(field_\d+)/g) || []).map((x) => entTypeId[x.slice(11)]);
const fireImmuneG = new Set(); { const parts = etSrc.split(/\n\s*public static final EntityType<[^\n]*=\s*register\(/); for (const q of parts.slice(1)) { const id = (q.match(/^\s*"([a-z_]+)"/) || [])[1]; if (id && /makeFireImmune\(\)/.test(q)) fireImmuneG.add(id); } }
const blkPred = {};   // block id -> never | always | leaves | polar | fire
{ const parts = blSrc.split(/\bregister\(\s*(?=")/).slice(1);
  for (const q of parts) { const id = q.match(/^"([a-z_]+)"/)[1], body = q.split(/\n\s*public static final Block |\n    (?:private|public) static (?!final Block)/)[0];
    let k = null, m;
    if (/createLeavesBlock\(/.test(body)) k = 'leaves'; else if (/createStainedGlassBlock\(/.test(body)) k = 'never';
    else if ((m = body.match(/\.allowsSpawning\(\s*(?:Blocks::(\w+)|\(\$\$0x, \$\$1x, \$\$2, \$\$3\) -> (\$\$3 == EntityType\.\w+|\$\$3\.isFireImmune\(\)))\s*\)/))) k = m[1] === 'canSpawnOnLeaves' ? 'leaves' : m[1] || (m[2].includes('isFireImmune') ? 'fire' : 'polar');
    if (k) blkPred[id] = k; } }
function floorExpected(kind, mob, st) {
  if (kind === 'never') return false; if (kind === 'always') return true;
  if (kind === 'leaves') return leafTypes.includes(mob); if (kind === 'polar') return mob === polarG; if (kind === 'fire') return fireImmuneG.has(mob);
  return st;   // default: sturdy top face && luminance < 14, computed by the caller
}
function proveFloor(eng = (mob, id) => M.Spawn.floorAllows(mob, 0, 1, 0), gold = floorExpected) {
  const S = M.States, R = M.Reg, W = M.World, saved = W.getBlock; const f = []; let n = 0, state = 0;
  W.getBlock = (x, y, z) => (y === 0 ? state : 0);
  try {
    const mobs = roster.filter((m) => ruleE(m));
    for (let st = 1; st < S.block.length && st < 20344; st++) {
      const name = R.names[S.block[st]]; state = st;
      const kind = blkPred[name] || 'default';
      const base = kind === 'default' ? ((M.Behave.faceSturdy(st, 1) || name === 'soul_sand') && S.emit[st] < 14) : null;
      for (const mob of mobs) { n++; const g = gold(kind, mob, base), e = eng(mob, name); if (g !== e) f.push(`${mob} on ${name}#${st}: floorAllows ${e} != Blocks.java ${g}`); }
    }
  } finally { W.getBlock = saved; }
  return { f, n };
}

const lg_ = (m) => lightG[m] ? { engine: lightE(m), vanilla: lightG[m] } : 'no vanilla SpawnRestriction predicate';
const out = {}; let bad = 0;
for (const x of gridF) { bad++; console.log('NEW RED grid: ' + x); }
for (const mob of roster) {
  const r = proveMob(mob), q = eqRow(mob); r.f.push(...q.f, ...proveDespawn(mob), ...babyRow(mob));
  const yf = proveY(mob); r.f.push(...yf); if (yG[mob]) { r.n++; r.y = yG[mob](); }
  out[mob] = { baby: babyG(mob) === undefined ? null : { engine: babyE(mob), vanilla: babyG(mob) }, pass: r.f.length === 0, checked: [q.d && !q.d.none ? `equipment roll ${JSON.stringify(q.d)}` : 'no initEquipment override in .decomp', 'despawn rules (SpawnGroup immediate/start range, persistence, canImmediatelyDespawn override)', r.listed ? `${r.n} spawn rows/rules (biome+structure weight, group, category; rule; location)` + (r.y ? '; y/sea-level rule ' + r.y : '') : (r.y ? 'y/sea-level rule ' + r.y + '; ' : '') + 'no vanilla biome/structure spawn row: engine has none either'],
    light: lg_(mob), notCovered: known.notCovered, failed: r.f };
  if (mob === 'rabbit' || mob === 'parrot') { const vf = vdiff().filter((x) => x.startsWith(mob)); out[mob].checked.push(`variant roll vs .decomp (${mob})`); out[mob].failed.push(...vf); out[mob].pass = out[mob].failed.length === 0; r.f.push(...vf); }
  for (const x of r.f) if (!known.failedRows.includes(x)) { bad++; console.log('NEW RED ' + mob + ': ' + x); }
}
const fl = proveFloor(); for (const x of fl.f.slice(0, 20)) console.log('FLOOR ' + x); if (fl.f.length) { bad++; console.log(`floor-block rule: ${fl.f.length} divergences of ${fl.n} (mob, state) pairs`); }
const seen = new Set(Object.values(out).flatMap((o) => o.failed));
for (const x of known.failedRows) if (!seen.has(x)) { bad++; console.log('STALE known row (fixed? remove it): ' + x); }
for (const mob of roster) if (!out[mob]) { bad++; console.log('no row ' + mob); }
if (known.notCovered.length > known.max) { bad++; console.log('notCovered ledger grew'); }
mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(T, 'mobproof', 'out', 'spawn.json'), JSON.stringify(out, null, 1));

let caught = 0;
if (vdiff().length) { bad++; console.log('variant diff: ' + vdiff().slice(0, 3).join('; ')); }
const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
const cp = (m, fn) => { const n = new Map(m); fn(n); return n; };
brk(proveY('squid', yG, Object.assign({}, yE, { squid: () => 'sea-12..sea' })).length > 0, 'y rule');
brk(proveY('glow_squid', Object.assign({}, yG, { glow_squid: () => 'y<=sea-30' })).length > 0, 'glow y rule');
brk(eqRow('skeleton', undefined, Object.assign(engineSpec('skeleton'), { main: 'crossbow' })).f.length > 0, 'equipment weapon');
brk(eqRow('husk', undefined, Object.assign(engineSpec('husk'), { zw: '0.02/0.05' })).f.length > 0, 'equipment zombie chance');
brk(eqRow('vindicator', undefined, Object.assign(engineSpec('vindicator'), { base: true })).f.length > 0, 'equipment base armour');
brk(proveMob('zombie', golden, cp(engine, (n) => n.set('biome:plains|monster|zombie', '1/4/4'))).f.length > 0, 'weight');
brk(proveMob('horse', golden, cp(engine, (n) => n.delete('biome:plains|creature|horse'))).f.length > 0, 'entry removed');
brk(proveMob('ghast', golden, cp(engine, (n) => n.set('biome:plains|monster|ghast', '1/1/1'))).f.length > 0, 'engine-only');
brk(proveMob('horse', cp(golden, (n) => n.set('biome:plains|creature|horse', '5/2/7'))).f.length > 0, 'group max');
brk(proveMob('zombie', golden, engine, (t) => t !== 'zombie' && ruleE(t)).f.length > 0, 'rule lost');
brk(proveMob('cow', golden, engine, ruleE, (t) => t === 'cow' ? 'in_water' : locE(t)).f.length > 0, 'location');
brk(proveMob('zombie', golden, engine, ruleE, locE, (t) => t === 'zombie' ? 'bright' : lightE(t)).f.length > 0, 'light rule flipped');
brk(proveMob('cow', golden, engine, ruleE, locE, lightE, Object.assign({}, lightG, { cow: 'dark' })).f.length > 0, 'vanilla light flipped');
brk(proveMob('guardian', golden, cp(engine, (n) => n.delete('struct:monument|monster|guardian'))).f.length > 0, 'structure override removed');
brk(vdiff(Object.assign({}, M.Rabbit, { chooseType: (p, c, rn) => { const v = M.Rabbit.chooseType(p, c, rn); return v === 0 ? 5 : v; } })).length > 0, 'rabbit variant');
brk(vdiff(M.Rabbit, (r) => (r + 1) % 5).length > 0, 'parrot variant');
brk(proveDespawn('cow', (m) => despE(m === 'cow' ? 'zombie' : m)).length > 0, 'despawn rules');
brk(proveDespawn('cod', (m) => despE(m).replace('64', '128')).length > 0, 'despawn range');
brk(!Number.isNaN(zombieG) && !Number.isNaN(pigG) && !Number.isNaN(hogG), 'baby literals parsed');
{ const P2 = (o) => Object.assign({}, sl, o);
  brk(proveGrid(P2({ salt: ['987234912', sl.salt[1]] })).length > 0, 'slime salt');
  brk(proveGrid(P2({ swamp: sl.swamp.map((v, i) => i === 3 ? (v === '<' ? '>' : '<') : v) })).length > 0, 'moon comparison flipped');
  brk(proveGrid(P2({ hal: ['10', '21', '11', '3'] })).length > 0, 'halloween window');
  brk(proveGrid(P2({ chunk: [sl.chunk[0], '41'] })).length > 0, 'slime chunk y');
  brk(proveGrid(sl, Object.assign({}, M.Spawn.RULES, { magma_cube: () => true })).length > 0, 'magma peaceful'); }
brk(babyRow('zombie', 0.06).length > 0, 'zombie baby chance');
brk(babyRow('piglin', 0.25).length > 0, 'piglin baby chance');
brk(babyRow('hoglin', null).length > 0, 'hoglin baby chance missing');
brk(Object.keys(blkPred).length >= 25, 'Blocks.java overrides parsed');
brk(proveFloor(undefined, (k, m, b) => k === 'never' && m === 'zombie' ? true : floorExpected(k, m, b)).f.length > 0, 'floor oracle mutated');
brk(proveFloor((m, id) => id === 'magma_block' ? true : M.Spawn.floorAllows(m, 0, 1, 0)).f.length > 0, 'floor engine mutated');
console.log(bad ? `FAIL ${bad} bad (${roster.length} mobs)` : `spawnproofcheck: ${roster.length} mobs, ${fl.n} floor (mob,state) pairs, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
