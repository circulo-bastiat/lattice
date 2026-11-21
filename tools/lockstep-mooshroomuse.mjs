#!/usr/bin/env node
// lockstep-mooshroomuse -- #6896 (G17-L179): lockstep scenario 'mooshroomuse', 20 salts. A red mooshroom, a brown one, a cow and a scripted player with a
// bucket / bowl / flowers / shears / lightning, 60 ticks. The engine's real Mo.interact / Mo.onLightning / Mo.shear are compared per tick with
// MooshroomEntity.interactMob (bowl -> mushroom_stew or suspicious_stew{EffectId,EffectDuration}, stew effect cleared; brown + small flower stores the
// FlowerBlock effect*20 (instant effects raw) and consumes one, a second flower only particles), onStruckByLightning (flip once per bolt id),
// sheared (5 mushrooms of its type, cow replaces) and CowEntity.interactMob (bucket -> milk_bucket, not baby).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const SALTS = 20, TICKS = 60;
const A = join(MCLITE_ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const meta = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
// FlowerBlock(effect, seconds): ticks = seconds*20 unless the effect is instant (then seconds as is). 1.18.2 Blocks.java.
const FLOWERS = { dandelion: ['saturation', 7], poppy: ['night_vision', 5], blue_orchid: ['saturation', 7], allium: ['fire_resistance', 4], azure_bluet: ['blindness', 8],
  red_tulip: ['weakness', 9], orange_tulip: ['weakness', 9], white_tulip: ['weakness', 9], pink_tulip: ['weakness', 9], oxeye_daisy: ['regeneration', 8],
  cornflower: ['jump_boost', 6], lily_of_the_valley: ['poison', 12], wither_rose: ['wither', 8] };
// vanilla 1.18.2 StatusEffect raw ids (Registry order): the stew stores EffectId as this number
const RAW = { jump_boost: 8, regeneration: 10, fire_resistance: 12, blindness: 15, night_vision: 16, weakness: 18, poison: 19, wither: 20, saturation: 23 };
const names = Object.keys(FLOWERS);
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function script(salt) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n), ops = [];
  for (let t = 0; t < TICKS; t++) {
    const k = ni(6), who = ni(3);
    if (k === 0) ops.push(['bucket', who]);
    else if (k === 1) ops.push(['bowl', who]);
    else if (k === 2) ops.push(['flower', who, names[ni(names.length)]]);
    else if (k === 3) ops.push(['bolt', who, ni(4)]);
    else if (k === 4 && t > 40) ops.push(['shears', who]);
    else ops.push(['none']);
  }
  return ops;
}
const mk = (type, mt) => ({ type, mooshroomType: mt, isBaby: false, dead: false, x: 0, y: 64, z: 0, height: 1.4 });
const snap = (es, inv) => es.map((e) => [e.type, e.mooshroomType, e.stewEffect ? e.stewEffect.id + ':' + e.stewEffect.ticks : '-', e.lightningId, e.dead ? 'D' : 'L'].join(',')).join('|') + '#' + inv.join(',');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '07zn_mooshroom.js'], dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: meta('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: meta('recipes.meta.json').jsonBytes });
  const Mo = M.Mooshroom, es = [mk('mooshroom', 'red'), mk('mooshroom', 'brown'), mk('cow')], inv = [], rows = [];
  for (const op of script(salt)) {
    const e = es[op[1] || 0];
    if (op[0] === 'bolt') { if (e.type === 'mooshroom') Mo.onLightning(e, 'b' + op[2]); }
    else if (op[0] !== 'none') {
      const item = op[0] === 'flower' ? op[2] : op[0];
      const res = Mo.interact(e, item, {});
      if (res && res.swapTo) inv.push(res.swapTo + (res.tag ? JSON.stringify(res.tag.Effects[0]) : ''));
      else if (res && res.replaceWith) { for (let i = 0; i < res.drops[0].times; i++) inv.push(res.drops[0].item); e.dead = true; es[op[1]] = mk('cow'); }
      else if (res && res.consume) inv.push('-' + item);
    }
    rows.push(snap(es, inv));
  }
  return rows;
}

function reference(salt) {
  const es = [mk('mooshroom', 'red'), mk('mooshroom', 'brown'), mk('cow')], inv = [], rows = [];
  for (const op of script(salt)) {
    const e = es[op[1] || 0], moo = e.type === 'mooshroom';
    if (op[0] === 'bolt') { if (moo && e.lightningId !== 'b' + op[2]) { e.mooshroomType = e.mooshroomType === 'red' ? 'brown' : 'red'; e.lightningId = 'b' + op[2]; } }
    else if (op[0] === 'bucket') inv.push('milk_bucket');
    else if (op[0] === 'bowl' && moo) {
      if (e.stewEffect) { inv.push('suspicious_stew' + JSON.stringify({ EffectId: e.stewEffect.id, EffectDuration: e.stewEffect.ticks })); e.stewEffect = null; } else inv.push('mushroom_stew');
    } else if (op[0] === 'flower' && moo && e.mooshroomType === 'brown' && !e.stewEffect) {
      const f = FLOWERS[op[2]]; const instant = f[0] === 'saturation';
      e.stewEffect = { id: RAW[f[0]], ticks: instant ? f[1] : f[1] * 20 }; inv.push('-' + op[2]);
    } else if (op[0] === 'shears' && moo) { for (let i = 0; i < 5; i++) inv.push(e.mooshroomType + '_mushroom'); es[op[1]] = mk('cow'); }
    rows.push(snap(es, inv));
  }
  return rows;
}


function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}:\n engine ${a[i]}\n ref    ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['flower memory not cleared by the bowl', (f, s) => f === '07zn_mooshroom.js' ? s.replace('e.stewEffect = null; Mo.sound(e, \'entity.mooshroom.suspicious_milk\'', 'Mo.sound(e, \'entity.mooshroom.suspicious_milk\'') : s],
  ['lightning flips every strike', (f, s) => f === '07zn_mooshroom.js' ? s.replace('if (e.lightningId === boltId) return false;', '') : s],
  ['shear drops 5 -> 4', (f, s) => f === '07zn_mooshroom.js' ? s.replace('Mo.SHEAR_DROPS = 5', 'Mo.SHEAR_DROPS = 4') : s],
  ['stew duration for the flower changed', (f, s) => f === '07zn_mooshroom.js' ? s.replace('ticks: f.ticks', 'ticks: f.ticks + 20') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`mooshroomuse: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
