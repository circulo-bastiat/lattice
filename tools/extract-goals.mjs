#!/usr/bin/env node
// extract-goals.mjs — Ai.OWED D-383 / #213 (G18b-2). EVERY MOB'S registerGoals(), read out of .decomp.
//
//   node tools/extract-goals.mjs [--out FILE]   -> tools/golden/goals-1.18.2.tsv
//   (the committed golden is not rebuilt by the suite; goalrostercheck re-extracts to a temp file when .decomp is
//   present and fails on drift)
//
// One row per goal a spawned mob of that type ends up with:
//   <entity> <goalSelector|targetSelector> <priority> <YarnGoalClass> <args>
// `args` is the constructor argument list after the leading `this`, verbatim except that
//   * `Items.field_N` / `Blocks.field_N` become `item:<registry name>` / `block:<registry name>`, read off
//     the `register("name", …)` initialiser in .decomp Items.java / Blocks.java (nothing typed in);
//   * a class constant (`BREEDING_INGREDIENT`) is replaced by its own initialiser.
// The mob's goal list is what its OWN class chain builds: a subclass's initGoals() replaces the parent's
// unless it calls `super.initGoals()`, and `this.initCustomGoals()` resolves to the most-derived override
// (HorseBaseEntity, ZombieEntity). The class of each entity comes from entity-types-1.18.2.tsv (obf name)
// through .decomp/names.tsv, so the roster is never re-derived here.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

const DEC = join(ROOT, '.decomp');
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? process.argv[oi + 1] : join(ROOT, 'tools', 'golden', 'goals-1.18.2.tsv');
if (!existsSync(join(DEC, 'names.tsv'))) { console.log('extract-goals: no .decomp — nothing to do'); process.exit(process.argv.includes('--if-missing') ? 0 : 1); }

// yarn class path by simple name, and obf -> yarn
const yarnByObf = new Map();
for (const l of readFileSync(join(DEC, 'names.tsv'), 'utf8').split('\n')) {
  const f = l.split('\t');
  if (f[0] === 'class' && f[1]) yarnByObf.set(f[1], f[5]);
}
const srcCache = new Map();
const src = (yarn) => {
  if (!srcCache.has(yarn)) {
    const p = join(DEC, yarn + '.java');
    srcCache.set(yarn, existsSync(p) ? readFileSync(p, 'utf8') : null);
  }
  return srcCache.get(yarn);
};

function regNames(file, kind) {
  const t = readFileSync(join(DEC, 'net/minecraft', file), 'utf8');
  const m = new Map();
  const re = /public static final \w+ (field_\d+) = (?:register|method_\d+)\(\s*(?:\d+,\s*)?"([a-z0-9_]+)"/g;
  let x; while ((x = re.exec(t))) m.set(x[1], x[2]);
  return m;
}
const ITEMS = regNames('item/Items.java'), BLOCKS = regNames('block/Blocks.java');
if (ITEMS.size < 300 || BLOCKS.size < 800) { console.log('extract-goals: Items/Blocks register() scan too small ' + ITEMS.size + '/' + BLOCKS.size); process.exit(1); }

const superOf = (yarn) => { const s = src(yarn); const m = s && /\bclass \w+(?:<[^{]*?>)? extends ([\w.]+)/.exec(s); return m ? ('net/minecraft/' + null) && m[1] : null; };
// resolve a simple class name to a .decomp path via the imports of the referencing file, else same package
function resolve(fromYarn, simple) {
  const s = src(fromYarn);
  const imp = new RegExp('import (net\\.minecraft\\.[\\w.]*\\.' + simple + ');').exec(s);
  if (imp) return imp[1].replace(/\./g, '/');
  return fromYarn.replace(/\/[^/]+$/, '/') + simple;
}
function parentOf(yarn) {
  const s = src(yarn); if (!s) return null;
  const m = /\bclass \w+(?:<[^{]*?>)?\s+extends ([\w.]+)/.exec(s);
  return m ? resolve(yarn, m[1].split('.')[0]) : null;
}

/** the balanced body of `void name()` in a class, or null */
function methodBody(yarn, name) {
  const s = src(yarn); if (!s) return null;
  const re = new RegExp('(?:protected|public|private)\\s+void ' + name + '\\(\\)\\s*\\{');
  const m = re.exec(s); if (!m) return null;
  let d = 1, i = m.index + m[0].length;
  const st = i;
  for (; i < s.length && d; i++) { if (s[i] === '{') d++; else if (s[i] === '}') d--; }
  return s.slice(st, i - 1);
}
function constant(yarn, name) {
  for (let c = yarn; c; c = parentOf(c)) {
    const s = src(c); if (!s) continue;
    const m = new RegExp('static final \\w+ ' + name + ' = ([^;]*);').exec(s);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
  }
  return null;
}
function norm(yarn, a) {
  a = a.replace(/\s+/g, ' ').trim();
  a = a.replace(/\b([A-Z][A-Z_]+)\b/g, (w) => { const c = constant(yarn, w); return c ? c : w; });
  a = a.replace(/Items\.(field_\d+)/g, (_, f) => 'item:' + (ITEMS.get(f) || f));
  a = a.replace(/Blocks\.(field_\d+)\.asItem\(\)/g, (_, f) => 'item:' + (BLOCKS.get(f) || f));
  a = a.replace(/Blocks\.(field_\d+)/g, (_, f) => 'block:' + (BLOCKS.get(f) || f));
  a = a.replace(/Items\.([A-Z_]+)/g, (_, f) => 'item:' + f.toLowerCase());
  return a;
}
/** split the top-level args of "(...)" text */
function splitArgs(t) {
  const out = []; let d = 0, cur = '';
  for (const ch of t) {
    if (ch === '(' || ch === '<') d++; else if (ch === ')' || ch === '>') d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

/** top-level statements of a method body: split on `;` outside () and {} */
function statements(b) {
  const out = []; let d = 0, cur = '';
  for (const ch of b) {
    if (ch === '(' || ch === '{') d++; else if (ch === ')' || ch === '}') d--;
    if (ch === ';' && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return out;
}

/** the library goal a (possibly nested) goal class ultimately extends: `FoxEntity.MateGoal` -> AnimalMateGoal.
 *  Only the ten families the roster check compares are named; anything else answers ''. */
const FAMILIES = new Set(['SwimGoal', 'EscapeDangerGoal', 'AnimalMateGoal', 'TemptGoal', 'FollowParentGoal', 'FleeEntityGoal',
  'WanderAroundFarGoal', 'WanderAroundGoal', 'LookAtEntityGoal', 'LookAroundGoal', 'RevengeGoal']);
function familyOf(ctxClass, name) {
  if (FAMILIES.has(name)) return name;
  const inner = name.split('.').pop();
  // a top-level library goal (`StopAndLookAtEntityGoal extends LookAtEntityGoal`): read its own `extends`
  const lib = name.includes('.') ? null : 'net/minecraft/entity/ai/goal/' + name;
  if (name === 'FlyGoal') return '';   // flying wander (parrot's FlyOntoTree, wither's FlyGoal): a different mover, not the stroll
  if (lib && src(lib)) { const m = /\bclass \w+(?:<[^{]*?>)?\s+extends ([\w.]+)/.exec(src(lib)); return m ? familyOf(lib, m[1]) : ''; }
  for (let c = ctxClass; c; c = parentOf(c)) {
    const s = src(c); if (!s) continue;
    const m = new RegExp('\\bclass ' + inner + '(?:<[^{]*?>)?\\s+extends ([\\w.]+)').exec(s);
    if (!m) continue;
    const sup = m[1].split('.').pop();
    if (m[1].startsWith('net.minecraft.')) return FAMILIES.has(sup) ? sup : '';
    return familyOf(c, sup === inner ? '' : m[1]);
  }
  return '';
}

/** the arguments (after the outer-`this`) of the `super(...)` call in a nested goal's no-argument constructor */
function superArgs(ctxClass, name) {
  const inner = name.split('.').pop();
  for (let c = ctxClass; c; c = parentOf(c)) {
    const s = src(c); if (!s) continue;
    const at = s.search(new RegExp('\\bclass ' + inner + '\\b'));
    if (at < 0) continue;
    const m = new RegExp('\\b' + inner + '\\([^)]*\\)\\s*\\{\\s*super\\(([^;]*)\\);').exec(s.slice(at));
    if (!m) return [];
    const a = splitArgs(m[1]); a.shift(); return a;
  }
  return [];
}

/** goals of `method` as seen from the most-derived class `self`, starting the search at `at` */
function goals(self, at, method) {
  for (let c = at; c; c = parentOf(c)) {
    const b = methodBody(c, method);
    if (b === null) continue;
    const rows = [], fields = {};
    for (const st of statements(b)) {
      let m;
      if ((m = /^this\s*\.\s*(goalSelector|targetSelector)\s*\.\s*add\(\s*(\d+)\s*,\s*([\s\S]*)\)$/.exec(st))) {
        let e = m[3].trim();
        const fld = /^this\.(\w+)$/.exec(e);
        if (fld && fields[fld[1]]) e = fields[fld[1]];
        else if (fields['$' + e]) e = fields['$' + e];   // a local: `GoToWalkTargetGoal $$0 = new …; add(5, $$0)`
        const nm = /^new ([\w.]+)(?:<[^(]*>)?\(/.exec(e);
        if (!nm) { rows.push([m[1], +m[2], e.replace(/^this\./, 'field:'), '', '']); continue; }
        let d = 1, i = nm[0].length;
        for (; i < e.length && d; i++) { if (e[i] === '(') d++; else if (e[i] === ')') d--; }
        const args = splitArgs(e.slice(nm[0].length, i - 1));
        if (args[0] === 'this') args.shift();
        // a nested goal built with no arguments passes its own to `super(Outer.this, speed, …)`: read those
        if (!args.length) args.push(...superArgs(c, nm[1]));
        rows.push([m[1], +m[2], nm[1], args.map((a) => norm(c, a)).join(' ; '), familyOf(c, nm[1])]);
      } else if ((m = /^[\w.]+(?:<[^=]*>)?\s+(\$\$\d+)\s*=\s*(new [\s\S]*)$/.exec(st))) fields['$' + m[1]] = m[2];
      else if ((m = /^this\.(\w+)\s*=\s*(new [\s\S]*)$/.exec(st))) fields[m[1]] = m[2];
      else if ((m = /^super\.(\w+)\(\)$/.exec(st))) rows.push(...goals(self, parentOf(c), m[1]));
      else if ((m = /^this\.(\w+)\(\)$/.exec(st))) rows.push(...goals(self, self, m[1]));
    }
    return rows;
  }
  return [];
}

/** goals added LATER by a state change rather than by initGoals(): Cat/Ocelot's `fleeGoal`, added at priority 4
 *  by onTamedChanged()/updateFleeing() while the animal is untamed / not trusting. Row selector `goalSelector*`. */
function dynamicFlee(yarn) {
  for (const m of ['onTamedChanged', 'updateFleeing']) {
    for (let c = yarn; c; c = parentOf(c)) {
      const b = methodBody(c, m); if (b === null) continue;
      const a = /this\.fleeGoal\s*=\s*new ([\w.]+)<>\(([^;]*)\);/.exec(b), p = /goalSelector\.add\((\d+),\s*this\.fleeGoal\)/.exec(b);
      if (a && p) { const args = splitArgs(a[2]); args.shift(); return ['goalSelector*', +p[1], a[1], args.map((x) => norm(c, x)).join(' ; '), familyOf(c, a[1])]; }
      break;
    }
  }
  return null;
}

/** Fox: addTypeSpecificGoals() adds the three ActiveTargetGoals AFTER initGoals (red fox = first branch of the if). */
function typeSpecific(yarn) {
  const b = methodBody(yarn, 'addTypeSpecificGoals'), init = methodBody(yarn, 'initGoals');
  if (b === null || init === null) return [];
  const i = b.indexOf('{'), j = b.indexOf('} else');
  if (i < 0 || j < 0) return [];
  const fields = {};
  for (const st of statements(init)) { const m = /^this\.(\w+)\s*=\s*(new [\s\S]*)$/.exec(st); if (m) fields[m[1]] = m[2]; }
  const rows = [];
  for (const st of statements(b.slice(i + 1, j))) {
    const m = /^this\s*\.\s*(goalSelector|targetSelector)\s*\.\s*add\(\s*(\d+)\s*,\s*this\.(\w+)\)$/.exec(st);
    const e = m && fields[m[3]]; const nm = e && /^new ([\w.]+)(?:<[^(]*>)?\(/.exec(e);
    if (!nm) continue;
    let d = 1, k = nm[0].length;
    for (; k < e.length && d; k++) { if (e[k] === '(') d++; else if (e[k] === ')') d--; }
    const args = splitArgs(e.slice(nm[0].length, k - 1)); if (args[0] === 'this') args.shift();
    rows.push([m[1], +m[2], nm[1], args.map((a) => norm(yarn, a)).join(' ; '), familyOf(yarn, nm[1])]);
  }
  return rows;
}

const out = ['# goals-1.18.2.tsv — generated by tools/extract-goals.mjs from .decomp (Yarn 1.18.2). NOTHING TYPED IN.',
  '# entity\tselector\tpriority\tgoal\targs\tfamily   (family = the library goal it is or extends, or empty; args after `this`; item:/block: names read off Items.java/Blocks.java)'];
let ents = 0, rowsN = 0;
for (const l of readFileSync(join(ROOT, 'tools/golden/entity-types-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const f = l.split('\t'); const yarn = yarnByObf.get(f[6]);
  if (!yarn || !src(yarn)) continue;
  const rows = goals(yarn, yarn, 'initGoals');
  if (!rows.length) continue;
  rows.push(...typeSpecific(yarn));
  const dyn = dynamicFlee(yarn); if (dyn) rows.push(dyn);
  ents++;
  for (const r of rows) { out.push([f[0], ...r].join('\t')); rowsN++; }
}
// anchors that cannot be in doubt (D-263): cow's list is the one refereed by hand in D-423
const t = out.join('\n');
const need = ['cow\tgoalSelector\t3\tTemptGoal\t1.25 ; Ingredient.ofItems(item:wheat) ; false',
  'pig\tgoalSelector\t4\tTemptGoal\t1.2 ; Ingredient.ofItems(item:carrot_on_a_stick) ; false',
  'llama\tgoalSelector\t5\tTemptGoal\t1.25 ; Ingredient.ofItems(item:hay_block) ; false'];
for (const n of need) if (!t.includes(n)) { console.log('extract-goals: anchor missing: ' + n); process.exit(1); }
writeFileSync(OUT, t + '\n');
console.log('extract-goals: ' + ents + ' entities, ' + rowsN + ' goal rows -> ' + OUT);
