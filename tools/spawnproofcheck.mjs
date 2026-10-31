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
// panda gene + axolotl variant rolls (#10231): PandaEntity.Gene.createRandom / initGenes and AxolotlEntity.Variant / shouldBabyBeDifferent parsed from .decomp
const pdSrc = vsrc('PandaEntity.java'), axSrc = vsrc('AxolotlEntity.java');
const geneId = {}; for (const m of pdSrc.match(/enum Gene \{[\s\S]*?;/)[0].matchAll(/(field_\d+)\((\d+), "/g)) geneId[m[1]] = +m[2];
const gcr = pdSrc.match(/static PandaEntity\.Gene createRandom[\s\S]*?\n        \}\n/)[0];
const gN = +gcr.match(/nextInt\((\d+)\)/)[1];
const geneWant = (r) => { for (const m of gcr.matchAll(/\$\$1 == (\d+)\) \{\s*return (field_\d+)/g)) if (r === +m[1]) return geneId[m[2]];
  const lt = [...gcr.matchAll(/\$\$1 < (\d+)\) \{\s*return (field_\d+)/g)].map((m) => [+m[1], geneId[m[2]]]), last = gcr.match(/\$\$1 < (\d+) \? (field_\d+) : (field_\d+)/);
  for (const [k, g] of lt) if (r < k) return g; return r < +last[1] ? geneId[last[2]] : geneId[last[3]]; };
const pdMut = pdSrc.match(/initGenes[\s\S]*?nextInt\((\d+)\) == 0\) \{\s*this\.setMainGene[\s\S]*?nextInt\((\d+)\) == 0\) \{\s*this\.setHiddenGene/).slice(1).map(Number);
const axVar = [...axSrc.match(/enum Variant \{[\s\S]*?;/)[0].matchAll(/field_\d+\((\d+), "\w+", (true|false)\)/g)].map((m) => [+m[1], m[2] === 'true']);
const axNat = axVar.filter((v) => v[1]).map((v) => v[0]), axUnn = axVar.filter((v) => !v[1]).map((v) => v[0]);
const axBlue = +axSrc.match(/shouldBabyBeDifferent[\s\S]*?nextInt\((\d+)\) == 0/)[1];
function pdAxDiff(mut = {}) {
  const f = [], EL = M.EntityList, Pd = M.Panda, Ax = M.Axolotl, genes = mut.genes || ((e, seq) => { const o = EL.randomOf; let i = 0; EL.randomOf = () => () => seq[i++]; try { EL.DEFAULTS.panda(e, {}); } finally { EL.randomOf = o; } });
  for (let a = 0; a < gN; a++) for (let b = 0; b < gN; b++) { const e = {}; genes(e, [(a + 0.5) / gN, (b + 0.5) / gN]);
    if (e.mainGene !== geneWant(a) || e.hiddenGene !== geneWant(b)) f.push(`panda gene roll (${a},${b}): engine ${e.mainGene}/${e.hiddenGene} != decomp ${geneWant(a)}/${geneWant(b)}`); }
  const init = mut.init || Pd.initGenes;
  for (const slot of [0, 1]) for (let k = 0; k < pdMut[slot]; k++) {   // mutation roll k of nextInt(N) on main (slot 0) / hidden (slot 1); every other roll 0.9, the mutated gene's roll 0.99 (normal)
    let i = 0; const c = {}, mk = () => ({ mainGene: 6, hiddenGene: 6 });
    init(c, mk(), mk(), () => { const j = i++; return j === 3 + slot ? (k + 0.5) / pdMut[slot] : (j === 4 && slot === 0 ? 0.9 : (j > 4 || (j === 4 && slot === 1) ? 0.99 : 0.9)); });
    const mutated = (slot ? c.hiddenGene : c.mainGene) !== 6;
    if (mutated !== (k === 0)) f.push(`panda initGenes ${slot ? 'hidden' : 'main'} 1/${pdMut[slot]} mutation roll ${k}: engine mutated=${mutated}`);
  }
  for (let r = 0; r < axNat.length; r++) { const v = Ax.randomNaturalVariant(() => (r + 0.5) / axNat.length); if (v !== axNat[r]) f.push(`axolotl natural roll ${r}: engine ${v} != decomp ${axNat[r]}`); }
  if (Ax.NATURAL_VARIANTS.length !== axNat.length) f.push(`axolotl natural variant count engine ${Ax.NATURAL_VARIANTS.length} != decomp ${axNat.length}`);
  const bc = mut.blue || axBlue;
  for (let k = 0; k < 2400; k++) { const seq = [(k + 0.5) / bc, 0.5, 0.2]; let i = 0; const c = {}; Ax.createChild(c, { axolotlVariant: 1 }, { axolotlVariant: 2 }, () => seq[i++] ?? 0.2);
    const blue = c.axolotlVariant === axUnn[0]; if (blue !== (k === 0)) { f.push(`axolotl 1/${bc} blue roll ${k}: engine blue=${blue}`); break; } }
  if (Ax.BLUE_BABY_CHANCE !== axBlue) f.push(`axolotl BLUE_BABY_CHANCE engine ${Ax.BLUE_BABY_CHANCE} != decomp ${axBlue}`);
  return f;
}
const vdiff = (rb = M.Rabbit, pr = parrotE(parrotN)) => variantDiff(rb, pr).concat(parrotN === 5 ? [] : [`parrot nextInt(${parrotN}) != engine 5`]);
// horse/donkey/mule roll (#10233): HorseEntity.initialize (colour+marking) and HorseBaseEntity.getChild*Bonus parsed from .decomp, engine driven with a recorded rng
const hbSrc = vsrc('HorseBaseEntity.java'), hSrc = vsrc('HorseEntity.java'), dSrc = vsrc('AbstractDonkeyEntity.java');
const hBody = (n) => hbSrc.match(new RegExp(n + '\\(\\) \\{[\\s\\S]*?\\n    }'))[0];
const hpB = hBody('getChildHealthBonus'), jpB = hBody('getChildJumpStrengthBonus'), spB = hBody('getChildMovementSpeedBonus');
const hHp = { base: +hpB.match(/(\d+\.\d+)F \+/)[1], ints: [...hpB.matchAll(/nextInt\((\d+)\)/g)].map((m) => +m[1]) };
const hJp = { base: +jpB.match(/return (\d+\.\d+)F/)[1], mul: [...jpB.matchAll(/nextDouble\(\) \* ([\d.]+)/g)].map((m) => +m[1]) };
const hSp = { base: +spB.match(/\((\d+\.\d+)F/)[1], mul: [...spB.matchAll(/nextDouble\(\) \* ([\d.]+)/g)].map((m) => +m[1]), scale: +spB.match(/\) \* ([\d.]+);/)[1] };
const enumN = (f) => [...vsrc(f).matchAll(/^    field_\d+\((\d+)\)/gm)].length;
const hColN = enumN('HorseColor.java'), hMarkN = enumN('HorseMarking.java');
const hAttrOrder = [...hSrc.match(/protected void initAttributes\(\) \{[\s\S]*?\n    }/)[0].matchAll(/getChild(\w+)Bonus/g)].map((m) => m[1]);
const dAttrOrder = [...dSrc.match(/protected void initAttributes\(\) \{[\s\S]*?\n    }/)[0].matchAll(/getChild(\w+)Bonus/g)].map((m) => m[1]);
const f32 = Math.fround;
function horseGold(type, u) {   // the vanilla draw sequence, in .decomp order; returns the rolled values and how many draws it took
  let k = 0; const nx = () => u[k++], ni = (n) => Math.floor(nx() * n), o = { };
  const roll = { Health: () => { let h = f32(hHp.base); for (const n of hHp.ints) h = f32(h + ni(n)); o.health = h; },
    MovementSpeed: () => { let v = f32(hSp.base); for (const m of hSp.mul) v += nx() * m; o.speed = v * hSp.scale; },
    JumpStrength: () => { let v = f32(jpB && hJp.base); for (const m of hJp.mul) v += nx() * m; o.jump = v; } };
  for (const a of type === 'horse' ? hAttrOrder : dAttrOrder) roll[a]();
  if (type === 'horse') { o.color = ni(hColN); o.marking = ni(hMarkN); }
  if (type !== 'horse') { o.speed = f32(donkeyFlat.speed); o.jump = donkeyFlat.jump; }
  o.used = k; return o;
}
function horseEng(type, u) {
  let k = 0; const EL = M.EntityList, old = EL.randomOf; EL.randomOf = () => () => u[k++];
  const e = { type }; try { EL.DEFAULTS[type](e, {}); } finally { EL.randomOf = old; }
  return { health: e.maxHealthAttr, speed: e.movementSpeedAttr, jump: e.jumpStrengthAttr, color: e.variant === undefined ? undefined : e.variant & 0xFF, marking: e.variant === undefined ? undefined : (e.variant >> 8) & 0xFF, used: k };
}
function horseDiff(eng = horseEng, gold = horseGold, tag = '') {
  const f = []; let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  for (const type of ['horse', 'donkey', 'mule']) for (let t = 0; t < 300; t++) {
    const u = Array.from({ length: 12 }, rnd), g = gold(type, u), e = eng(type, u);
    if (g.used !== e.used) { f.push(`${type}${tag} trial ${t}: engine drew ${e.used} rolls, vanilla ${g.used}`); break; }
    const bad = ['health', 'speed', 'jump', 'color', 'marking'].find((key) => !(g[key] === undefined ? e[key] === undefined : (typeof g[key] === 'number' && Math.abs(g[key] - e[key]) < 1e-6)));
    if (bad) { f.push(`${type}${tag} trial ${t}: ${bad} engine ${e[bad]} vanilla ${g[bad]}`); break; }
  }
  return f;
}
// donkey/mule: initAttributes rolls health only; speed/jump are the flat createAbstractDonkeyAttributes literals
const donkeyFlat = { speed: +dSrc.match(/field_23719, ([\d.]+)F/)[1], jump: +dSrc.match(/field_23728, ([\d.]+)\)/)[1] };
const donkeyFlatDiff = () => ['donkey', 'mule'].flatMap((t) => { const e = horseEng(t, Array(12).fill(0.5)); return (Math.abs(e.speed - f32(donkeyFlat.speed)) < 1e-6 && e.jump === donkeyFlat.jump) ? [] : [`${t}: flat speed/jump engine ${e.speed}/${e.jump} vanilla ${donkeyFlat.speed}/${donkeyFlat.jump}`]; });
const hdiff = (...a) => horseDiff(...a).concat(donkeyFlatDiff(), hColN === 7 && hMarkN === 5 ? [] : [`horse enum sizes ${hColN}/${hMarkN} != engine 7/5`]);
const pdax = (mut) => pdAxDiff(mut);
// fox type + cat variant (#10232): FoxEntity.Type.fromBiome and CatEntity.initialize parsed from .decomp, engine driven over every biome precipitation / moon phase / roll
const foxSrc = vsrc('FoxEntity.java'), catSrc = vsrc('CatEntity.java');
const precipNames = readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'world', 'biome', 'Biome.java'), 'utf8').match(/enum Precipitation[^{]*\{([\s\S]*?);/)[1].match(/field_\d+/g);
const foxSnowIdx = precipNames.indexOf(foxSrc.match(/getPrecipitation\(\) == Biome\.Precipitation\.(field_\d+) \? field_\d+ : field_\d+/)[1]);
const foxEnum = [...foxSrc.match(/enum Type \{([\s\S]*?);/)[1].matchAll(/(field_\d+)\((\d+), "(\w+)"\)/g)];
const foxIdOf = (fld) => +foxEnum.find((x) => x[1] === fld)[2];
const [, foxSnowF, foxRedF] = foxSrc.match(/getPrecipitation\(\) == Biome\.Precipitation\.field_\d+ \? (field_\d+) : (field_\d+)/);
const foxSnowId = foxIdOf(foxSnowF), foxRedId = foxIdOf(foxRedF);
const catBlk = catSrc.match(/getMoonSize\(\) > ([\d.]+)F\) \{\s*this\.setCatType\(this\.random\.nextInt\((\d+)\)\);\s*\} else \{\s*this\.setCatType\(this\.random\.nextInt\((\d+)\)\)/);
const catThr = +catBlk[1], catHi = +catBlk[2], catLo = +catBlk[3];
const catHut = +catSrc.match(/SWAMP_HUT[\s\S]*?setCatType\((\d+)\)/)[1];
const moonSizesC = readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'world', 'dimension', 'DimensionType.java'), 'utf8').match(/MOON_SIZES = new float\[\]\{([^}]*)\}/)[1].split(',').map((x) => parseFloat(x));
function fcDiff(foxFrom = (p) => M.Fox.fromBiome(p), catRoll = (phase, r, n) => { const e = {}, EL = M.EntityList, S = M.Sky, o = [EL.randomOf, S.dayTime]; EL.randomOf = () => () => (r + 0.5) / n; S.dayTime = phase * S.TICKS_PER_DAY; try { EL.DEFAULTS.cat(e); } finally { EL.randomOf = o[0]; S.dayTime = o[1]; } return e.catVariant; }) {
  const f = [];
  for (let p = 0; p < precipNames.length; p++) { const w = p === foxSnowIdx ? foxSnowId : foxRedId; if (foxFrom(p) !== w) f.push(`fox precipitation ${p}: engine type ${foxFrom(p)} vanilla ${w}`); }
  if (moonSizesC.length !== 8) f.push("MOON_SIZES unparsed");
  for (let ph = 0; ph < 8; ph++) { const n = moonSizesC[ph] > catThr ? catHi : catLo; for (let r = 0; r < n; r++) { const v = catRoll(ph, r, n); if (v !== r) f.push(`cat moon phase ${ph} roll ${r}/${n}: engine variant ${v}`); } }
  return f;
}
// tropical fish variant (#8816): TropicalFishEntity.initialize / COMMON_VARIANTS / Variety / DyeColor parsed from .decomp, Fish.chooseVariant driven over every roll
const tfSrc = vsrc('TropicalFishEntity.java');
const tfVar = Object.fromEntries([...tfSrc.match(/enum Variety \{([\s\S]*?);/)[1].matchAll(/(field_\d+)\((\d+), (\d+)\)/g)].map((x) => [x[1], [+x[2], +x[3]]]));
const tfDye = Object.fromEntries([...readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'util', 'DyeColor.java'), 'utf8').matchAll(/(field_\d+)\((\d+), "/g)].map((x) => [x[1], +x[2]]));
const tfCommon = [...tfSrc.match(/COMMON_VARIANTS = new int\[\]\{([\s\S]*?)\};/)[1].matchAll(/toVariant\(TropicalFishEntity\.Variety\.(field_\d+), DyeColor\.(field_\d+), DyeColor\.(field_\d+)\)/g)].map((x) => tfVar[x[1]][0] | tfVar[x[1]][1] << 8 | tfDye[x[2]] << 16 | tfDye[x[3]] << 24);
const tfInit = tfSrc.match(/nextFloat\(\) < ([\d.]+)\) \{[\s\S]*?\} else \{\s*this\.commonSpawn = false;\s*\$\$6 = this\.random\.nextInt\((\d+)\);\s*\$\$7 = this\.random\.nextInt\((\d+)\);\s*\$\$8 = this\.random\.nextInt\((\d+)\);\s*\$\$9 = this\.random\.nextInt\((\d+)\)/);
const tfP = +tfInit[1], tfN = tfInit.slice(2).map(Number);
function tfDiff(roll = (seq) => { const F = M.Fish, o = F.random; let i = 0; F.random = () => () => seq[i++]; F.random = (() => { const f = () => seq[i++]; return f; })(); const e = {}; try { F.chooseVariant(e, {}); } finally { F.random = o; } return e; }) {
  const f = [];
  if (tfCommon.length !== 22) f.push(`tropical_fish COMMON_VARIANTS unparsed (${tfCommon.length})`);
  const N = tfCommon.length;
  for (let i = 0; i < N; i++) { const e = roll([tfP / 2, (i + 0.5) / N]); if (e.fishVariant !== tfCommon[i] || e.fishCommonSpawn !== true) f.push(`tropical_fish common variant ${i}: engine ${e.fishVariant} != decomp ${tfCommon[i]}`); }
  const e1 = roll([tfP, 0.5]); if (e1.fishCommonSpawn !== false) f.push(`tropical_fish roll == ${tfP} must take the random branch (nextFloat < ${tfP})`);
  for (let k = 0; k < 4; k++) for (let r = 0; r < tfN[k]; r++) { const q = [0.5, 0.5, 0.5, 0.5].map((_, j) => (j === k ? r : 0) + 0.5).map((v, j) => v / tfN[j]); q.unshift(0.99); const e = roll(q); const w = [0, 0, 0, 0].map((_, j) => Math.floor(q[j + 1] * tfN[j])); const want = w[0] | w[1] << 8 | w[2] << 16 | w[3] << 24; if (e.fishVariant !== want || e.fishCommonSpawn !== false) f.push(`tropical_fish random variant draw ${k} value ${r}: engine ${e.fishVariant} != decomp ${want}`); }
  return f;
}
// llama (#10230): LlamaEntity.initialize / initializeStrength parsed, EL.DEFAULTS.llama + trader_llama driven over every roll
const llSrc = vsrc('LlamaEntity.java'), llStr = llSrc.match(/private void initializeStrength\(\) \{[\s\S]*?\n    }\n/)[0];
const [, llP, llHi, llLo] = llStr.match(/nextFloat\(\) < ([\d.]+)F \? (\d+) : (\d+)/), llBase = +llStr.match(/setStrength\((\d+) \+ this\.random\.nextInt/)[1];
const llInit = llSrc.match(/public EntityData initialize\([\s\S]*?\n    }\n/)[0], llVarN = +llInit.match(/this\.random\.nextInt\((\d+)\)/)[1];
const llPack = /instanceof LlamaEntity\.LlamaData/.test(llInit) && /\.variant;/.test(llInit);
const trSrc = vsrc('TraderLlamaEntity.java').match(/public EntityData initialize\([\s\S]*?\n    }\n/)[0], trNoBaby = /new PassiveEntity\.PassiveData\(false\)/.test(trSrc);
function llamaDiff(key = 'llama', fn) {
  const f = [], EL = M.EntityList, o = EL.randomOf, run = fn || ((e, opts) => EL.DEFAULTS[key](e, opts));
  const go = (seq, opts) => { const e = { maxHealthAttr: 1 }; let i = 0; EL.randomOf = () => () => seq[i++]; try { run(e, opts); } finally { EL.randomOf = o; } return { e, used: i }; };
  try {
    for (const fl of [0, 0.5 * +llP, +llP - 1e-9, +llP, 0.99]) {
      const n = fl < +llP ? +llHi : +llLo;
      for (let k = 0; k < n; k++) for (let v = 0; v < llVarN; v++) {
        const w = `${key} float ${fl} str roll ${k} var roll ${v}`, r = go([fl, (k + 0.5) / n, (v + 0.5) / llVarN], {});
        if (r.e.strength !== llBase + k) f.push(`${w}: strength ${r.e.strength} != ${llBase + k}`);
        if (r.e.variant !== v) f.push(`${w}: variant ${r.e.variant} != ${v}`);
        if (r.used !== 3) f.push(`${w}: ${r.used} draws != 3`);
        if (llPack) { const pd = { llamaVariant: (v + 1) % llVarN }, q = go([fl, (k + 0.5) / n, 0.99], { packData: pd, spawnIdx: 0 });
          if (q.e.variant !== pd.llamaVariant || q.used !== 2) f.push(`${w}: pack member variant ${q.e.variant} draws ${q.used} (inherit ${pd.llamaVariant}, 2 draws)`); }
      }
    }
    if (key === 'trader_llama' && trNoBaby) { const pd = {}, q = go([0.5, 0.5, 0.5, 0], { packData: pd, spawnIdx: 1 }); if (q.e.baby || q.e.isBaby || q.used !== 3) f.push(`trader_llama: rolled a baby / ${q.used} draws (PassiveData(false))`); }
  } finally { EL.randomOf = o; }
  return f;
}
const ldiff = (fn) => ['llama', 'trader_llama'].flatMap((k) => llamaDiff(k, fn && ((e, o) => fn(k, e, o))));
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
  if (mob === 'llama' || mob === 'trader_llama') { const vf = llamaDiff(mob); out[mob].checked.push('variant+strength roll vs .decomp (LlamaEntity.initialize/initializeStrength)'); out[mob].failed.push(...vf); out[mob].pass = out[mob].failed.length === 0; r.f.push(...vf); }
  if (mob === 'rabbit' || mob === 'parrot' || mob === 'fox' || mob === 'cat') { const vf = (mob === 'fox' || mob === 'cat' ? fcDiff() : vdiff()).filter((x) => x.startsWith(mob)); out[mob].checked.push(`variant roll vs .decomp (${mob})`); out[mob].failed.push(...vf); out[mob].pass = out[mob].failed.length === 0; r.f.push(...vf); }
  if (mob === 'tropical_fish') { const vf = tfDiff().map((x) => x); out[mob].checked.push('variant roll vs .decomp (TropicalFishEntity.initialize/COMMON_VARIANTS)'); out[mob].failed.push(...vf); out[mob].pass = out[mob].failed.length === 0; r.f.push(...vf); }
  if (mob === 'panda' || mob === 'axolotl') { const vf = pdAxDiff().filter((x) => x.startsWith(mob)); out[mob].checked.push(`gene/variant roll vs .decomp (${mob})`); out[mob].failed.push(...vf); out[mob].pass = out[mob].failed.length === 0; r.f.push(...vf); }
  if (mob === 'horse' || mob === 'donkey' || mob === 'mule') { const vf = hdiff().filter((x) => x.startsWith(mob)); out[mob].checked.push(`health/speed/jump${mob === 'horse' ? '/colour/marking' : ''} roll vs .decomp (${mob})`); out[mob].failed.push(...vf); out[mob].pass = out[mob].failed.length === 0; r.f.push(...vf); }
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
if (hdiff().length) { bad++; console.log('horse roll diff: ' + hdiff().slice(0, 3).join('; ')); }
if (fcDiff().length) { bad++; console.log('fox/cat variant diff: ' + fcDiff().slice(0, 3).join('; ')); }
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
{ const hE = (fn) => (t, u) => fn(horseEng(t, u), t, u);
  brk(hdiff(hE((e, t, u) => { const r = horseEng(t, u.slice(1)); return Object.assign(e, r, { used: r.used + 1 }); })).length > 0, 'horse roll count/offset');
  brk(hdiff(hE((e) => Object.assign(e, { health: e.health + 1 }))).length > 0, 'horse health');
  brk(hdiff(hE((e, t) => Object.assign(e, { jump: t === 'horse' ? e.speed : e.jump + 0.1 }))).length > 0, 'horse jump');
  brk(hdiff(hE((e) => Object.assign(e, { marking: e.marking === undefined ? e.marking : (e.marking + 1) % 5 }))).length > 0, 'horse marking');
  brk(hdiff(undefined, (t, u) => Object.assign(horseGold(t, u), { used: horseGold(t, u).used + 1 })).length > 0, 'horse oracle draw count');
  brk(hHp.ints.join() === '8,9' && hAttrOrder.join() === 'Health,MovementSpeed,JumpStrength' && dAttrOrder.join() === 'Health', 'horse decomp parsed'); }
brk(pdAxDiff({ blue: 2400 }).length > 0, 'axolotl 1/1200 constant');
brk(pdAxDiff({ genes: (e, q) => { e.mainGene = 0; e.hiddenGene = 0; } }).length > 0, 'panda gene roll');
brk(pdAxDiff({ init: (c, a, b, r) => { M.Panda.initGenes(c, a, b, () => { const v = r(); return v < 0.04 ? 0.5 : v; }); } }).length > 0, 'panda 1/32 constant');
brk(tfDiff((q) => { const e = {}; const F = M.Fish, o = F.random; let i = 0; F.random = () => q[i++]; try { F.chooseVariant(e, {}); } finally { F.random = o; } if (e.fishVariant === tfCommon[3]) e.fishVariant ^= 1 << 16; return e; }).length > 0, 'tropical common variant');
brk(tfDiff((q) => { const e = {}; const F = M.Fish, o = F.random; let i = 0; F.random = () => q[i++]; try { F.chooseVariant(e, {}); } finally { F.random = o; } if (!e.fishCommonSpawn) e.fishVariant = (e.fishVariant & 0xFF) | ((e.fishVariant >> 8 & 0xFF) % 5) << 8 | (e.fishVariant & ~0xFFFF); return e; }).length > 0, 'tropical random pattern');
brk(tfCommon.length === 22 && tfP === 0.9 && tfN.join() === '2,6,15,15', 'tropical literals parsed');
brk(fcDiff((p) => 0).length > 0, 'fox snow rule');
brk(fcDiff((p) => (p === 2 ? 0 : 1)).length > 0, 'fox red/snow swapped');
brk(fcDiff(undefined, (ph, r, n) => (ph === 0 ? (r + 1) % 11 : r)).length > 0, 'cat variant table');
brk(fcDiff(undefined, (ph, r, n) => (ph === 1 && r === 9 ? 10 : r)).length > 0, 'cat moon threshold');
brk(ldiff((k, e, o) => { const r = M.EntityList.randomOf(e); r(); M.EntityList.DEFAULTS[k](e, o); }).length > 0, 'llama extra draw');
brk(ldiff((k, e, o) => { M.EntityList.DEFAULTS[k](e, o); if (e.variant === 2) e.variant = 3; }).length > 0, 'llama variant');
brk(ldiff((k, e, o) => { M.EntityList.DEFAULTS[k](e, o); if (e.strength === 3) e.strength = 4; }).length > 0, 'llama strength');
brk(llPack && llVarN === 4 && +llHi === 5 && +llLo === 3 && trNoBaby, 'llama literals parsed');
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
