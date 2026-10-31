#!/usr/bin/env node
// mobdamageproof (#9188): damage dimension of the mob proof, STATIC half. Per roster mob it compares the engine's damage-relevant
// numbers with the jar goldens (entity-attributes-1.18.2.tsv: maxHealth, attackDamage, knockbackResistance, attackKnockback;
// entity-types-1.18.2.tsv: fireImmune). Writes tools/mobproof/out/damage.json { mob: { pass, checked, notCovered, failed } }.
// notCovered lists what only a tick-by-tick real-server lockstep can prove (each damage source, hurt timer, knockback, armor, drops).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, initRegistry } from './loadsrc.mjs';

const T = dirname(fileURLToPath(import.meta.url)), ROOT = join(T, '..');
if (!existsSync(join(ROOT, 'assets', 'entities.json'))) { console.log('mobdamageproof: SKIP — assets missing'); process.exit(1); }
const roster = Object.keys(JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs);
const rows = (f) => readFileSync(join(T, 'golden', f), 'utf8').split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
const attrs = new Map(rows('entity-attributes-1.18.2.tsv').filter((r) => r[0] !== 'type').map((r) => [r[0], r]));
const types = new Map(rows('entity-types-1.18.2.tsv').map((r) => [r[0], r]));

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js'], dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const Ent = M.Entities;
const num = (s) => (s === '' || s === undefined ? null : Number(s));

/** one mob's row from golden rows + engine accessors (pure in `E`, so the break proof can corrupt the engine side) */
function prove(mob, E) {
  const failed = [], checked = [], a = attrs.get(mob), t = types.get(mob);
  const eq = (what, got, want) => { checked.push(what); if (got !== want) failed.push(`${what}: engine ${got}, jar ${want}`); };
  if (a) {
    eq('maxHealth', E.hp(mob), num(a[2]));
    const at = E.attrs(mob) || {};
    if (num(a[4]) !== null && 'atk' in at) eq('attackDamage', at.atk, num(a[4]));
    if ('kbr' in at) eq('knockbackResistance', at.kbr, num(a[6]) || 0);
  } else checked.push('no living attributes in the jar (non-living)');
  if (t) eq('fireImmune', E.fire(mob), t[3] === '1');
  else checked.push('engine-only model key: the jar has no entity type of this name');
  return { pass: failed.length === 0, checked,
    notCovered: ['per-source damage tick-by-tick vs the real server (arrow, fall, drowning, explosion, cactus, starvation, void)', 'armor reduction, effects'],
    failed };
}
const E0 = { hp: (m) => Ent.maxHealth(m), attrs: (m) => Ent.attrsOf(m), fire: (m) => Ent.fireImmune(m) === true };
let bad = 0;
const out = {};
for (const m of roster) { out[m] = prove(m, E0); if (!out[m].pass) { bad++; console.log('x ' + m + ': ' + out[m].failed.join('; ')); } }
const envF = join(T, 'mobproof', 'out', 'damage-env.json');   // #9202: envdamagelockstepcheck's per-source lava/fire rows
if (existsSync(envF)) { const env = JSON.parse(readFileSync(envF, 'utf8')); for (const m in env) if (out[m]) { out[m].checked.push(...env[m].checked.map((c) => 'env ' + c)); out[m].envPass = env[m].pass; out[m].envFailed = env[m].failed; } }
const melF = join(T, 'mobproof', 'out', 'damage-melee.json');   // #9201: lockstep-meleedamage rows
const armF = join(T, 'mobproof', 'out', 'damage-armor.json');   // #9216: lockstep-zombie_armor rows
if (existsSync(armF)) { const a = JSON.parse(readFileSync(armF, 'utf8')); for (const m in a) if (out[m]) { out[m].checked.push(...a[m].checked.map((c) => 'armor ' + c)); out[m].armorPass = a[m].pass; out[m].armorFailed = a[m].failed; } }
if (existsSync(melF)) { const mel = JSON.parse(readFileSync(melF, 'utf8')); for (const m in mel) if (out[m]) { out[m].checked.push(...mel[m].checked.map((c) => 'melee ' + c)); out[m].meleePass = mel[m].pass; out[m].meleeFailed = mel[m].failed; } }
const expF = join(T, 'mobproof', 'out', 'damage-explosion.json');   // #9214: lockstep-explosiondamage rows
if (existsSync(expF)) { const ex = JSON.parse(readFileSync(expF, 'utf8')); for (const m in ex) if (out[m]) { out[m].checked.push(...ex[m].checked.map((c) => 'explosion ' + c)); out[m].explosionPass = ex[m].pass; out[m].explosionFailed = ex[m].failed; out[m].explosionKnown = ex[m].knownDivergences; } }
const arrF = join(T, 'mobproof', 'out', 'damage-arrow.json');   // #9213: lockstep-arrowdamage rows
if (existsSync(arrF)) { const arr = JSON.parse(readFileSync(arrF, 'utf8')); for (const m in arr) if (out[m]) { out[m].checked.push(...arr[m].checked.map((c) => 'arrow ' + c)); out[m].arrowPass = arr[m].pass; out[m].arrowFailed = arr[m].failed; } }
const magF = join(T, 'mobproof', 'out', 'damage-magic.json');   // #9215: magicthornsdamagecheck rows
if (existsSync(magF)) { const mg = JSON.parse(readFileSync(magF, 'utf8')); for (const m in mg) if (out[m]) { out[m].checked.push(...mg[m].checked.map((c) => 'magic/thorns ' + c)); out[m].magicPass = mg[m].pass; out[m].magicFailed = mg[m].failed; } }
const dthF = join(T, 'mobproof', 'out', 'damage-death.json');   // #9217: lockstep-mobdeath rows
if (existsSync(dthF)) { const dt = JSON.parse(readFileSync(dthF, 'utf8')); for (const m in dt) if (out[m]) { out[m].checked.push(...dt[m].checked.map((c) => 'death ' + c)); out[m].deathPass = dt[m].pass; out[m].deathFailed = dt[m].failed; } }
const mgF = join(T, 'mobproof', 'out', 'damage-magicserver.json');   // #9215: lockstep-magicdamage rows
if (existsSync(mgF)) { const mg = JSON.parse(readFileSync(mgF, 'utf8')); for (const m in mg) if (out[m]) { out[m].checked.push(...mg[m].checked.map((c) => 'magic-server ' + c)); out[m].magicServerPass = mg[m].pass; out[m].magicServerFailed = mg[m].failed; } }
const drF = join(T, 'mobproof', 'out', 'damage-drown.json');   // #9247: lockstep-drowndamage rows
if (existsSync(drF)) { const dr = JSON.parse(readFileSync(drF, 'utf8')); for (const m in dr) if (out[m]) { out[m].checked.push(...dr[m].checked.map((c) => 'drown ' + c)); out[m].drownPass = dr[m].pass; out[m].drownFailed = dr[m].failed; } }
const fallF = join(T, 'mobproof', 'out', 'damage-fall.json');   // #9246: lockstep-falldamage rows
if (existsSync(fallF)) { const fl = JSON.parse(readFileSync(fallF, 'utf8')); for (const m in fl) if (out[m]) { out[m].checked.push(...fl[m].checked.map((c) => 'fall ' + c)); out[m].fallPass = fl[m].pass; out[m].fallFailed = fl[m].failed; } }
const voidF = join(T, 'mobproof', 'out', 'damage-void.json');   // #9250: lockstep-voiddamage rows
if (existsSync(voidF)) { const vl = JSON.parse(readFileSync(voidF, 'utf8')); for (const m in vl) if (out[m]) { out[m].checked.push(...vl[m].checked.map((c) => 'void ' + c)); out[m].voidPass = vl[m].pass; out[m].voidFailed = vl[m].failed; } }
const fireF = join(T, 'mobproof', 'out', 'damage-fire.json');   // #10362: lockstep-firedamage rows
if (existsSync(fireF)) { const fi = JSON.parse(readFileSync(fireF, 'utf8')); for (const m in fi) if (out[m]) { out[m].checked.push(...fi[m].checked.map((c) => 'fire ' + c)); out[m].firePass = fi[m].pass; out[m].fireFailed = fi[m].failed; } }
mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(T, 'mobproof', 'out', 'damage.json'), JSON.stringify(out, null, 1));

// ── break proof (D-30) ───────────────────────────────────────────────────────────────────────
let caught = 0;
const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
const living = roster.find((m) => attrs.has(m) && num(attrs.get(m)[2]) > 0), imm = roster.find((m) => types.get(m) && types.get(m)[3] === '1');
brk(!!living && prove(living, { ...E0, hp: () => 999 }).pass === false, 'wrong health');
brk(!!imm && prove(imm, { ...E0, fire: () => false }).pass === false, 'lost fire immunity');
brk(!!living && prove(living, { ...E0, fire: () => !(types.get(living)[3] === '1') }).pass === false, 'invented fire immunity');
brk(!!living && prove(living, { ...E0, attrs: () => ({ kbr: 7 }) }).pass === false, 'wrong knockback resistance');
console.log(`${roster.length} mobs, ${roster.filter((m) => out[m].pass).length} static-green, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
