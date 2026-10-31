#!/usr/bin/env node
// extract-entity-motion-src.mjs — G17b-2 (#202): ground mobs that do NOT override LivingEntity.travel.
//
//   node tools/extract-entity-motion-src.mjs   -> tools/golden/entity-motion-src-1.18.2.tsv
//
// The bytecode extractor (extract-entity-motion.mjs) needs javap; this one needs only `.decomp/`
// (Yarn 1.18.2 source) and so runs anywhere. It is D-309's override test on name+descriptor, NOT a
// naive superclass walk: for every class from the mob's own up to LivingEntity it asks
//   (a) does the class DECLARE `travel(Vec3d)`?                        -> refuse
//   (b) does it implement ItemSteerable (whose default travel wins)?   -> refuse
//   (c) does it call setNoGravity(true)/hasNoGravity-gated motion?     -> refuse
//   (d) same for `tickMovement()`, which is what LivingEntity calls travel() from;
//   (e) does it declare `tick()` — and if so is `super.tick()` on the UNCONDITIONAL path (brace
//       depth 1 of the body, before any `return`)? Otherwise travel is never reached (ender_dragon's
//       shape)                                                         -> refuse
// A type passing all four adopts LivingEntity's generic 0.08 / 0.98 (read from LivingEntity.java
// itself, not typed here; D-390 shape). `--selftest` breaks its own data and prints "<n> breaks caught".
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DECOMP = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
const OUT = join(ROOT, 'tools', 'golden', 'entity-motion-src-1.18.2.tsv');

export const CANDIDATES = ['cave_spider', 'husk', 'stray', 'giant', 'zombie_villager', 'zombified_piglin', 'piglin',
  'piglin_brute', 'hoglin', 'zoglin', 'fox', 'goat', 'llama', 'trader_llama', 'donkey', 'mule', 'skeleton_horse',
  'zombie_horse', 'panda', 'polar_bear', 'rabbit', 'mooshroom', 'snow_golem', 'wandering_trader', 'silverfish',
  'endermite', 'enderman', 'wither_skeleton', 'slime', 'magma_cube'];

const files = new Map();   // ClassName -> path
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.java')) files.set(f.slice(0, -5), p);
  }
})(DECOMP);

const pascal = (n) => n.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('') + 'Entity';
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Body text of the first method matching `re` that sits at brace depth 1 (the outer class's own
 *  member, never a nested Goal/Control class's), brace matched, or null. */
function bodyOf(src, re) {
  let m = null, d0 = 0, last = 0;
  const g = new RegExp(re.source, 'g');
  for (let x; (x = g.exec(src));) {
    for (let k = last; k < x.index; k++) { if (src[k] === '{') d0++; else if (src[k] === '}') d0--; }
    last = x.index;
    if (d0 === 1) { m = x; break; }
  }
  if (!m) return null;
  let i = src.indexOf('{', m.index), d = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) return src.slice(start + 1, i);
  }
  return null;
}

/** Is `super.<call>();` at brace depth 0 of `body` with no `return` before it? */
function callsSuperUnconditionally(body, call) {
  let d = 0, out = '';
  for (const c of body) { if (c === '{') d++; if (d === 0) out += c; if (c === '}') d--; }
  const at = out.indexOf('super.' + call + '();');
  if (at < 0) return false;
  return !/\breturn\b/.test(out.slice(0, at));
}

/** The d-390 proof for one class name. Returns { ok, reason, chain }. */
export function proveGeneric(cls, read = (c) => (files.has(c) ? strip(readFileSync(files.get(c), 'utf8')) : null)) {
  const chain = [];
  let cond = false;
  for (let c = cls, hops = 0; c && hops < 24; hops++) {
    chain.push(c);
    const src = read(c);
    if (src == null) return { ok: false, reason: `no source for ${c}`, chain };
    if (c === 'LivingEntity') return { ok: true, cond, chain };
    if (/\bvoid\s+travel\s*\(\s*Vec3d\b/.test(src)) {
      // D-459 shape: HorseBaseEntity.travel gates its whole custom branch behind hasPassengers()
      // (riding, G25 - nothing here mounts anything) and otherwise runs super.travel unchanged.
      const t = bodyOf(src, /\bpublic\s+void\s+travel\s*\(\s*Vec3d\b/) || '';
      const gated = c === 'HorseBaseEntity' && /^\s*if \(this\.isAlive\(\)\) \{\s*if \(this\.hasPassengers\(\)[^{]*\{/.test(t) &&
        /\}\s*else\s*\{\s*this\.airStrafingSpeed = 0\.02F;\s*super\.travel\(\$\$0\);\s*\}\s*\}\s*$/.test(t);
      if (!gated) return { ok: false, reason: `${c} declares travel(Vec3d)`, chain };
      cond = true;
    }
    if (/\bimplements\b[^{]*\bItemSteerable\b/.test(src)) return { ok: false, reason: `${c} implements ItemSteerable (default travel)`, chain };
    if (/\bsetNoGravity\s*\(\s*true\s*\)/.test(src)) return { ok: false, reason: `${c} calls setNoGravity(true)`, chain };
    const tick = bodyOf(src, /\bpublic\s+void\s+tick\s*\(\s*\)/);
    if (tick != null && !callsSuperUnconditionally(tick, 'tick')) return { ok: false, reason: `${c}.tick() does not call super.tick() unconditionally`, chain };
    // LivingEntity.tickMovement is what calls travel(): an override that skips super never reaches it
    // (ender_dragon's shape, and the reason a tick()-only test is not enough).
    const tm = bodyOf(src, /\b(?:public|protected)\s+void\s+tickMovement\s*\(\s*\)/);
    if (tm != null && !callsSuperUnconditionally(tm, 'tickMovement')) return { ok: false, reason: `${c}.tickMovement() does not call super.tickMovement() unconditionally`, chain };
    const m = /\bclass\s+\w+(?:<[^>]*>)?\s+extends\s+(\w+)/.exec(src);
    if (!m) return { ok: false, reason: `${c} has no superclass`, chain };
    c = m[1];
  }
  return { ok: false, reason: 'chain too long', chain };
}

/** LivingEntity's own generic gravity/drag, read from travel()'s body. */
export function genericFrom(src) {
  const tr = bodyOf(strip(src), /\bpublic\s+void\s+travel\s*\(\s*Vec3d\b/);
  if (!tr) return null;
  const g = /double\s+\$\$\d+\s*=\s*0\.08;/.test(tr) ? 0.08 : null;
  const drag = /setVelocity\([^;]*\*\s*0\.98F,[^;]*\.z\s*\*/.test(tr) ? 0.98 : null;
  return g && drag ? { g, drag } : null;
}

export function run(candidates = CANDIDATES, read) {
  const gen = genericFrom(readFileSync(files.get('LivingEntity'), 'utf8'));
  if (!gen) throw new Error('LivingEntity.travel generic gravity/drag not readable');
  const rows = [], refused = [];
  for (const n of candidates) {
    const r = proveGeneric(pascal(n), read);
    if (r.ok) rows.push([n, pascal(n), gen.g, gen.drag, r.cond ? 'conditional-src:HorseBaseEntity.travel-D-459-G17b-2' : 'generic-src:LivingEntity.travel-G17b-2']);
    else refused.push(`${n}: ${r.reason}`);
  }
  return { rows, refused, gen };
}

/** Anti-vacuity (D-30): break the data, and every break must flip a verdict. */
function selftest(rows, refused) {
  const real = (c) => (files.has(c) ? strip(readFileSync(files.get(c), 'utf8')) : null);
  let bad = 0, caught = 0;
  const must = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };
  must(rows.length === CANDIDATES.length && refused.length === 0, `baseline: ${rows.length}/${CANDIDATES.length} accepted`);
  const mut = (cls, fn, why) => {
    const r = proveGeneric('ZombieEntity', (c) => { const t = real(c); return c === cls && t != null ? fn(t) : t; });
    if (!r.ok) caught++; else { bad++; console.log('FAIL break not caught: ' + why); }
  };
  mut('ZombieEntity', (t) => t.replace(/(void tickMovement\(\)\s*\{)/, '$1 if (this.age > 5) return;'), 'return before super.tickMovement()');
  mut('MobEntity', (t) => t.replace(/super\.tickMovement\(\);/, ''), 'MobEntity.tickMovement without super');
  const inject = (code) => (t) => t.replace(/\{/, '{\n' + code + '\n');
  mut('ZombieEntity', inject('public void travel(Vec3d $$0) { }'), 'travel override on the mob itself');
  mut('HostileEntity', inject('public void travel(Vec3d $$0) { }'), 'travel override mid-chain');
  mut('MobEntity', inject('public void travel(Vec3d $$0) { }'), 'travel override on MobEntity');
  mut('ZombieEntity', (t) => t.replace(/class ZombieEntity\s+extends/, 'class ZombieEntity implements ItemSteerable extends'), 'ItemSteerable default travel');
  mut('MobEntity', inject('void x() { this.setNoGravity(true); }'), 'setNoGravity(true)');
  mut('ZombieEntity', (t) => t.replace(/super\.tick\(\);/, ''), 'tick() without super.tick()');
  mut('ZombieEntity', (t) => t.replace(/(public void tick\(\)\s*\{)/, '$1 if (this.age > 5) return;'), 'return before super.tick()');
  mut('ZombieEntity', (t) => t.replace(/(public void tick\(\)\s*\{)([\s\S]*?)super\.tick\(\);/, '$1 if (this.age > 5) { super.tick(); }'), 'super.tick() only under a condition');
  const dragon = proveGeneric('EnderDragonEntity');
  if (!dragon.ok) caught++; else { bad++; console.log('FAIL ender_dragon must be refused'); }
  const cow = proveGeneric('CowEntity');
  must(cow.ok, 'unbroken cow still accepted');
  console.log(`${caught} breaks caught${bad ? `, ${bad} FAILURES` : ''}`);
  return bad ? 1 : 0;
}

// ── #5916 (G17-X13): projectile gravity/drag, replacing the hand-read 0.05/0.99 + arrow constants ──
// Two shapes, both walked name-by-name like proveGeneric (D-309): a ThrownEntity subclass takes its
// gravity from the nearest `float getGravity()` up the chain and its air drag from ThrownEntity.tick;
// a PersistentProjectileEntity subclass takes both from the literals in PersistentProjectileEntity.tick.
// `own: true` rows (potion, experience_bottle) must DECLARE getGravity themselves: a value merely
// inherited from ThrownEntity (snowball's 0.03) is refused for them, the D-309 inherited-not-overridden test.
export const PROJECTILES = [['potion', 'PotionEntity', true], ['experience_bottle', 'ExperienceBottleEntity', true],
  ['arrow', 'ArrowEntity', false], ['spectral_arrow', 'SpectralArrowEntity', false], ['trident', 'TridentEntity', false],
  // #205: inherit ThrownEntity.getGravity 0.03 / drag 0.99 (own=false: inheriting is the point; tick chain still proved unconditional)
  ['snowball', 'SnowballEntity', false], ['egg', 'EggEntity', false]];
  // ender_pearl is deliberately NOT here: its tick() is `if (dead owner) discard(); else super.tick()`, i.e. super.tick() is conditional, so the D-309 test refuses it (motion row stays hand-coded in EL.motionFor).
export const rd = (c) => (files.has(c) ? strip(readFileSync(files.get(c), 'utf8')) : null);
const chainOf = (cls, read) => {
  const out = [];
  for (let c = cls, h = 0; c && h < 12; h++) {
    const src = read(c); if (src == null) return null;
    out.push([c, src]);
    const m = /\bclass\s+\w+(?:<[^>]*>)?\s+extends\s+(\w+)/.exec(src);
    c = m && m[1];
  }
  return out;
};
export function projectileRow(cls, own, read = rd) {
  const ch = chainOf(cls, read);
  if (!ch) return { ok: false, reason: `no source chain for ${cls}` };
  const names = ch.map((x) => x[0]);
  const num = (t) => Number(t.replace(/[Ff]$/, ''));
  const tickOk = (src) => { const t = bodyOf(src, /\bpublic\s+void\s+tick\s*\(\s*\)/); return t == null || callsSuperUnconditionally(t, 'tick'); };
  const top = ch.findIndex(([c]) => c === 'ThrownEntity' || c === 'PersistentProjectileEntity');
  const below = top < 0 ? ch : ch.slice(0, top);   // the classes between the mob and the base that owns the motion
  const bad = below.find(([, src]) => !tickOk(src));
  if (bad) return { ok: false, reason: `${bad[0]}.tick() does not call super.tick() unconditionally` };
  if (below.some(([, src]) => /\bsetNoGravity\s*\(\s*true\s*\)/.test(src))) return { ok: false, reason: 'setNoGravity(true) in chain' };
  const thrown = ch.find(([c]) => c === 'ThrownEntity'), pers = ch.find(([c]) => c === 'PersistentProjectileEntity');
  if (thrown) {
    const g = ch.map(([c, src]) => [c, /\bfloat\s+getGravity\s*\(\s*\)\s*\{\s*return\s+([\d.]+F?)\s*;/.exec(src)]).find((x) => x[1]);
    const d = /\}\s*else\s*\{\s*\$\$\d+\s*=\s*([\d.]+F)\s*;\s*\}\s*this\.setVelocity\(\$\$\d+\.multiply/.exec(thrown[1]);
    if (!g || !d) return { ok: false, reason: 'ThrownEntity gravity/drag not readable' };
    if (own && g[0] !== cls) return { ok: false, reason: `${cls} inherits getGravity from ${g[0]} (not overridden)` };
    return { ok: true, g: num(g[1][1]), drag: num(d[1]), src: `thrown-src:${g[0]}.getGravity+ThrownEntity.tick-#5916` };
  }
  if (pers) {
    if (own) return { ok: false, reason: `${cls} is not a ThrownEntity` };
    const m = /float\s+\$\$\d+\s*=\s*([\d.]+F);\s*float\s+\$\$\d+\s*=\s*([\d.]+F);\s*if \(this\.isTouchingWater\(\)\)[\s\S]*?this\.setVelocity\(\$\$\d+\.multiply\(\(double\)\$\$\d+\)\);\s*if \(!this\.hasNoGravity\(\) && !\$\$\d+\) \{[^}]*?\.y - ([\d.]+F)/.exec(pers[1]);
    if (!m || m[2] !== m[3]) return { ok: false, reason: 'PersistentProjectileEntity.tick drag/gravity not readable' };
    return { ok: true, g: num(m[3]), drag: num(m[1]), src: 'projectile-src:PersistentProjectileEntity.tick-#5916' };
  }
  return { ok: false, reason: `${names.join('>')} reaches neither ThrownEntity nor PersistentProjectileEntity` };
}
export function projectileRows(read = rd) {
  const rows = [], refused = [];
  for (const [n, cls, own] of PROJECTILES) {
    const r = projectileRow(cls, own, read);
    if (r.ok) rows.push([n, cls, r.g, r.drag, r.src]); else refused.push(`${n}: ${r.reason}`);
  }
  return { rows, refused };
}

function projSelftest() {
  let bad = 0, caught = 0;
  const base = projectileRows();
  if (base.rows.length !== PROJECTILES.length) { bad++; console.log('FAIL projectile baseline: ' + base.refused.join('; ')); }
  const mut = (cls, fn, why) => {
    const r = projectileRows((c) => { const t = rd(c); return c === cls && t != null ? fn(t) : t; });
    const same = JSON.stringify(r.rows) === JSON.stringify(base.rows) && !r.refused.length;
    if (!same) caught++; else { bad++; console.log('FAIL break not caught: ' + why); }
  };
  mut('PotionEntity', (t) => t.replace(/0\.05F/, '0.06F'), 'potion gravity literal changed');
  mut('PotionEntity', (t) => t.replace(/protected float getGravity\(\)[\s\S]*?\n    \}/, ''), 'potion getGravity removed (inherited 0.03 is not an override)');
  mut('ExperienceBottleEntity', (t) => t.replace(/0\.07F/, '0.08F'), 'bottle gravity changed');
  mut('ThrownEntity', (t) => t.replace(/0\.99F/, '0.98F'), 'thrown drag changed');
  mut('SnowballEntity', (t) => t.replace(/(public class SnowballEntity[^{]*\{)/, '$1 protected float getGravity() { return 0.05F; }'), 'snowball gains a getGravity override');
  mut('EggEntity', (t) => t.replace(/(public class EggEntity[^{]*\{)/, '$1 public void tick() { }'), 'egg tick override without super.tick()');
  mut('PersistentProjectileEntity', (t) => t.replace(/0\.99F/, '0.97F'), 'arrow drag changed');
  mut('PersistentProjectileEntity', (t) => t.replace(/y - 0\.05F/, 'y - 0.06F'), 'arrow gravity changed');
  mut('TridentEntity', (t) => t.replace(/super\.tick\(\);/, ''), 'trident tick without super.tick()');
  const sn = projectileRow('SnowballEntity', true);
  if (!sn.ok) caught++; else { bad++; console.log('FAIL snowball must be refused as an own override'); }
  console.log(`${caught} breaks caught${bad ? `, ${bad} FAILURES` : ''}`);
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(DECOMP)) { console.log('SKIP - no .decomp'); process.exit(0); }
  const { rows, refused, gen } = run();
  if (process.argv.includes('--selftest')) process.exit(selftest(rows, refused) || projSelftest() ? 1 : 0);
  const pr = projectileRows();
  if (pr.refused.length) { pr.refused.forEach((r) => console.log('  projectile refused ' + r)); process.exit(1); }
  // arrow/spectral_arrow already live in entity-motion-1.18.2.tsv (D-402); entlistcheck compares them to this extractor
  rows.push(...pr.rows.filter((r) => r[0] !== 'arrow' && r[0] !== 'spectral_arrow'));
  const out = ['# entity-motion-src-1.18.2.tsv — generated by tools/extract-entity-motion-src.mjs from .decomp (G17b-2, #202).',
    '# name\tclass\tgravity\tdrag\tsource   — types whose whole chain provably does not override LivingEntity.travel (D-309 name+descriptor test, super.tick() unconditional).',
    ...(refused.length ? ['# refused: ' + refused.join('; ')] : []),
    ...rows.map((r) => r.join('\t'))];
  writeFileSync(OUT, out.join('\n') + '\n');
  console.log(`generic ${gen.g}/${gen.drag}: ${rows.length} rows, ${refused.length} refused`);
  refused.forEach((r) => console.log('  refused ' + r));
}
