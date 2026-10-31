#!/usr/bin/env node
// potiontipcheck.mjs — #302 (G23). PotionUtil.buildTooltip lines (effects, No Effects, When Applied) vs .decomp.
//   node tools/potiontipcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02i_text.js', '14f_inventory.js', '14d_survival.js',
  '07zj_fish.js', '07q_effects.js', '07z_potion.js', '07ox_enchhelper.js', '07oy_enchtable.js', '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '14i_hand.js', '16_settings.js', '15_hud.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes,
              langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
const H = M.Hud, Inv = M.Inventory, Po = M.Potion;
const D = join(MCLITE_ROOT, '.decomp/net/minecraft');
let pass = 0; const fails = [];
let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   \u2713 ' + m); };
const texts = (L) => L.map((l) => l.text);
const J = (x) => JSON.stringify(x);
const pot = (item, id) => { const s = Inv.stack(item, 1); s.t = { Potion: 'minecraft:' + id }; return s; };

// expectation facts from the decompiled sources
const scale = (cls) => parseFloat(/buildTooltip\(\$\$0, \$\$2, ([0-9.]+)F\)/.exec(readFileSync(join(D, 'item/' + cls + '.java'), 'utf8'))[1]);
const SC = { potion: scale('PotionItem'), lingering_potion: scale('LingeringPotionItem'), tipped_arrow: scale('TippedArrowItem') };
const cat = readFileSync(join(D, 'entity/effect/StatusEffects.java'), 'utf8');
const harmful = new Set([...cat.matchAll(/"([a-z_]+)",\s*new \w+\(StatusEffectCategory\.field_18272/g)].map((m) => m[1]));
ok(SC.potion === 1 && SC.lingering_potion === 0.25 && SC.tipped_arrow === 0.125, 'decomp scales ' + J(SC));
ok(harmful.has('poison') && harmful.has('slowness') && !harmful.has('speed'), 'decomp harmful set parsed');

const run = (item, id) => H.stackTooltipLines(pot(item, id));
const sw = texts(run('potion', 'strong_swiftness'));
ok(J(sw) === J(['Potion', 'Speed II (1:30)', '', 'When Applied:', '+40% Speed']), 'Swiftness II: ' + J(sw));
ok(run('potion', 'strong_swiftness')[1].rgb === 0x5555FF && run('potion', 'strong_swiftness')[3].rgb === 0xAA00AA, 'swiftness colours');
ok(J(texts(run('potion', 'water'))) === J(['Potion', 'No Effects']), 'water: ' + J(texts(run('potion', 'water'))));
ok(run('potion', 'water')[1].rgb === 0xAAAAAA, 'No Effects grey');
const sl = run('potion', 'slowness');
ok(sl[1].text === 'Slowness (1:30)' && sl[1].rgb === 0xFF5555 && sl[4].text === '-15% Speed' && sl[4].rgb === 0xFF5555, 'slowness: ' + J(texts(sl)));
ok(texts(run('potion', 'strength')).slice(-1)[0] === '+3 Attack Damage', 'strength: ' + J(texts(run('potion', 'strength'))));
ok(texts(run('potion', 'weakness')).slice(-1)[0] === '-4 Attack Damage', 'weakness');
ok(texts(run('potion', 'luck')).slice(-1)[0] === '+1 Luck', 'luck');
ok(texts(run('potion', 'regeneration'))[1] === 'Regeneration (0:45)', 'regeneration');
ok(texts(run('potion', 'healing')).length === 2 && texts(run('potion', 'healing'))[1] === 'Instant Health', 'instant: no duration, no modifiers');
ok(texts(run('lingering_potion', 'swiftness'))[1] === 'Speed (0:45)', 'lingering 1/4: ' + J(texts(run('lingering_potion', 'swiftness'))));
ok(texts(run('tipped_arrow', 'swiftness'))[1] === 'Speed (0:22)', 'tipped arrow 1/8: ' + J(texts(run('tipped_arrow', 'swiftness'))));
ok(texts(run('splash_potion', 'long_swiftness'))[1] === 'Speed (8:00)', 'splash');
// every registered potion with effects produces a line per effect
for (const id of Object.keys(Po.POTIONS)) {
  const n = Po.POTIONS[id].effects.length, L = run('potion', id);
  ok(n === 0 ? L.length === 2 || id === 'empty' : L.length >= 1 + n, 'line count ' + id);
}

// anti-vacuity: corrupt each source of truth and show the check notices
{
  const save = Po.POTIONS.strong_swiftness.effects[0].amplifier; Po.POTIONS.strong_swiftness.effects[0].amplifier = 0;
  okAv(J(texts(run('potion', 'strong_swiftness'))) !== J(['Potion', 'Speed II (1:30)', '', 'When Applied:', '+40% Speed']), 'wrong amplifier is caught');
  Po.POTIONS.strong_swiftness.effects[0].amplifier = save;
}
{
  const m = M.Effects.ATTR_MODIFIERS.speed[0], sv = m.amount; m.amount = 0.3;
  okAv(texts(run('potion', 'strong_swiftness'))[4] !== '+40% Speed', 'wrong modifier amount is caught');
  m.amount = sv;
}
{
  const sv = Po.POTIONS.swiftness.effects[0].duration; Po.POTIONS.swiftness.effects[0].duration = 4800;
  okAv(texts(run('tipped_arrow', 'swiftness'))[1] !== 'Speed (0:22)', 'wrong duration is caught');
  Po.POTIONS.swiftness.effects[0].duration = sv;
}
okAv(texts(run('lingering_potion', 'swiftness'))[1] !== texts(run('potion', 'swiftness'))[1], 'lingering and potion scales differ');
console.log('\n================ potiontipcheck ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
for (const f of fails) console.log('   \u2717 ' + f);
process.exit(fails.length ? 1 : 0);
