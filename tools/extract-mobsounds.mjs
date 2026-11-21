#!/usr/bin/env node
// extract-mobsounds.mjs — #742. Every mob's VOICE (ambient / hurt / death / step), out of .decomp.
//
//   node tools/extract-mobsounds.mjs   -> tools/golden/mob-sounds-1.18.2.tsv
//
// For each entity type (tools/golden/entity-types-1.18.2.tsv, obf class -> Yarn via .decomp/names.tsv)
// the class chain is walked up (`extends`) until `getAmbientSound` / `getHurtSound` / `getDeathSound` /
// `getStepSound` / `playStepSound` / `getMinAmbientSoundDelay` / `getSoundVolume` is found. SoundEvents
// field -> registry name comes from `SoundEvents.java` (`field_N = register("entity.x.y")`).
// A method that returns several events (sheep-like branches, villager, panda...) lists them ALL,
// comma-separated, in source order; a single event is the simple case.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEC = join(ROOT, '.decomp');
const OUT = join(ROOT, 'tools', 'golden', 'mob-sounds-1.18.2.tsv');

const events = new Map();
for (const m of readFileSync(join(DEC, 'net/minecraft/sound/SoundEvents.java'), 'utf8').matchAll(/(field_\d+) = register\("([^"]+)"\)/g)) events.set(m[1], m[2]);

const byBase = new Map();
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.java') && p.includes('/entity/')) byBase.set(f.slice(0, -5), p);
  }
})(join(DEC, 'net/minecraft/entity'));

const yarn = new Map();
for (const l of readFileSync(join(DEC, 'names.tsv'), 'utf8').split('\n')) {
  const c = l.split('\t');
  if (c[0] === 'class') yarn.set(c[1], c[6]);
}

const METHODS = {
  ambient: 'getAmbientSound', hurt: 'getHurtSound', death: 'getDeathSound', step: 'getStepSound',
  stepPlay: 'playStepSound', delay: 'getMinAmbientSoundDelay', volume: 'getSoundVolume', pitch: 'getSoundPitch', cat: 'getSoundCategory',
  angry: 'getAngrySound', eat: 'getEatSound', walk: 'playWalkSound'
};
const cache = new Map();
function parse(name) {
  if (cache.has(name)) return cache.get(name);
  const p = byBase.get(name);
  const r = { name, parent: null, m: {} };
  cache.set(name, r);
  if (!p) return r;
  const src = readFileSync(p, 'utf8');
  const ex = src.match(new RegExp('class ' + name + '(?:<[^>]*>)? extends ([\\w.]+)'));
  if (ex) r.parent = ex[1].split('.').pop();
  for (const [k, meth] of Object.entries(METHODS)) {
    const re = new RegExp('(?:(?:public|protected|private)[^;{(]*|SoundEvent\\s+)\\b' + meth + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    let m;
    while ((m = re.exec(src))) {
      let i = re.lastIndex, d = 1;
      while (d && i < src.length) { const ch = src[i++]; if (ch === '{') d++; else if (ch === '}') d--; }
      const body = src.slice(re.lastIndex, i - 1);
      const evs = [...body.matchAll(/SoundEvents\.(field_\d+)/g)].map((x) => events.get(x[1]) || x[1]);
      const cat = (body.match(/SoundCategory\.(field_\d+)/) || [])[1];
      const ret = (body.match(/return\s+([-\d.]+)F?;/) || [])[1];
      r.m[k] = { cat, evs: [...new Set(evs)], ret, cls: name, step: k === 'stepPlay' ? (body.match(/playSound\([^,]+,\s*([\d.]+)F/) || [])[1] : undefined };
    }
  }
  return r;
}
function find(cls, k) {
  for (let c = parse(cls); c; c = c.parent ? parse(c.parent) : null) if (c.m[k]) return c.m[k];
  return null;
}

// playWalkSound calls super: the horse's gallop lives one class up from its breathe
function findAllEvs(cls, k) {
  const out = [];
  for (let c = parse(cls); c; c = c.parent ? parse(c.parent) : null) if (c.m[k]) for (const e of c.m[k].evs) if (!out.includes(e)) out.push(e);
  return out.join(',');
}
const rows = [];
for (const l of readFileSync(join(ROOT, 'tools/golden/entity-types-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const c = l.split('\t');
  const y = yarn.get(c[6]);
  const cls = y && y.replace(/^.*\//, '');
  if (!cls || !byBase.has(cls)) continue;
  const g = (k) => { const f = find(cls, k); return f ? f.evs.join(',') : ''; };
  const step = find(cls, 'stepPlay');
  const stepEv = g('step') || (step ? step.evs.join(',') : '');
  // a living mob overrides at least one of the four; pure projectiles/items have none anywhere
  // ParrotEntity.getAmbientSound returns getRandomSound() (a helper, not a SoundEvents.* literal): entity.parrot.ambient,
  // or 1/1000 an imitation from MOB_SOUNDS (MobVoice.PARROT_IMITATE) - #1227
  const row = [c[0], cls, cls === 'ParrotEntity' ? events.get('field_15132') : g('ambient'), g('hurt'), g('death'), stepEv, step ? step.step || '' : '',
    (find(cls, 'delay') || {}).ret || '', (find(cls, 'volume') || {}).ret || '',
    (find(cls, 'cat') || {}).cat === 'field_15251' ? 'hostile' : 'neutral',
    // PiglinBruteEntity.playAngrySound() is a void method (field_25729 = entity.piglin_brute.angry), not getAngrySound
    cls === 'PiglinBruteEntity' ? 'entity.piglin_brute.angry' : g('angry'), g('eat'), findAllEvs(cls, 'walk')];
  rows.push(row.join('\t'));
}
writeFileSync(OUT, '# mob-sounds-1.18.2.tsv — generated by tools/extract-mobsounds.mjs off .decomp (#742).\n' +
  '# type\tclass\tambient\thurt\tdeath\tstep\tstepVolume\tminAmbientDelay\tsoundVolume\tcategory\tangry\teat\twalk\n# comma = several events the method can return\n' + rows.join('\n') + '\n');
console.log('mob-sounds: ' + rows.length + ' rows');
