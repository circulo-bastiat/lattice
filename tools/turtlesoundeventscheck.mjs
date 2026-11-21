#!/usr/bin/env node
// turtlesoundeventscheck.mjs — #11700: SoundEvents ids used by 07zp_turtle.js (egg_crack/egg_hatch/egg_break,
// lay_egg) equal vanilla's SoundEvents registrations (.decomp) and are reached via eggRandomTick/eggBreak.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '14b_physics.js', '07zp_turtle.js'], dom: false });
const Tu = MCL.Turtle;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const vanilla = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/sound/SoundEvents.java'), 'utf8');
const reg = new Set([...vanilla.matchAll(/register\("([^"]+)"\)/g)].map(m => m[1]));
const src = readFileSync(join(MCLITE_ROOT, 'src/07zp_turtle.js'), 'utf8');

function run(consts, srcText) {
  const out = [];
  for (const [k, id] of Object.entries(consts)) {
    if (!reg.has(id)) out.push(k + ' not a vanilla SoundEvent: ' + id);
  }
  if (consts.EGG_HATCH_SOUND !== 'entity.turtle.egg_crack') out.push('hatch must be egg_crack');
  if (consts.EGG_BORN_SOUND !== 'entity.turtle.egg_hatch') out.push('born must be egg_hatch');
  if (consts.EGG_BREAK_SOUND !== 'entity.turtle.egg_break') out.push('break must be egg_break');
  const lay = (srcText.match(/entity\.turtle\.lay_egg/) || [])[0];
  if (!lay || !reg.has(lay)) out.push('lay_egg missing');
  return out;
}
const real = { EGG_HATCH_SOUND: Tu.EGG_HATCH_SOUND, EGG_BORN_SOUND: Tu.EGG_BORN_SOUND, EGG_BREAK_SOUND: Tu.EGG_BREAK_SOUND };
const errs = run(real, src);
ok(errs.length === 0, errs.join('; '));

// reachability: the real entry points emit these ids (stub world, sand below, sky window)
const set = [];
MCL.World = { setBlock: (x, y, z, s) => set.push(s), getBlock: () => 0 };
Tu.isSandBelow = () => true;
MCL.Behave = Object.assign({}, MCL.Behave, { setProp: (s) => s });
const st = MCL.States.stateOf('turtle_egg');
Tu.eggSounds.length = 0;
Tu.eggRandomTick(1, 64, 1, st, () => 0.5, 0.67);
Tu.eggBreak(1, 64, 1, st, () => 0.5);
const ids = Tu.eggSounds.map(s => s.ev);
ok(ids[0] === 'entity.turtle.egg_crack' && ids[1] === 'entity.turtle.egg_break', 'entry points emit crack then break: ' + ids);
ok(Tu.eggSounds.every(s => s.volume === 0.7 && s.pitch >= 0.9 && s.pitch <= 1.1), 'volume 0.7 pitch 0.9..1.1');

// breaks: each corruption must be caught
const bad = [
  { ...real, EGG_HATCH_SOUND: 'entity.turtle.egg_hatch' },
  { ...real, EGG_BORN_SOUND: 'entity.turtle.egg_born' },
  { ...real, EGG_BREAK_SOUND: 'entity.turtle.break' },
];
for (const b of bad) if (run(b, src).length) breaks++;
if (run(real, src.replace(/entity\.turtle\.lay_egg/g, 'entity.turtle.lay')).length) breaks++;
for (const f of fails) console.log('FAIL ' + f);
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length || breaks < 4 ? 1 : 0);
