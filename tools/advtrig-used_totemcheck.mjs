#!/usr/bin/env node
// advtrig-used_totemcheck.mjs — G17-AT5 (#7752). Drives the REAL call site (Survival.tryUseTotem) against
// UsedTotemCriterion; adventure/totem_of_undying completes, a non-matching item does not; breaks its own matcher.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07q_effects.js', '07zx_particle.js', '14f_inventory.js', '14d_survival.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player', health: 0, equip: [null, null] };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const adv = Adv.manager.get('minecraft:adventure/totem_of_undying');
  const got = () => done.includes('minecraft:adventure/totem_of_undying');
  // no totem held: death not cancelled, nothing granted
  no(!MCL.Survival.tryUseTotem(P, {}) && !got(), 'granted without a totem');
  // a different item in the trigger must not satisfy the item condition
  Adv.trigger(P, 'minecraft:used_totem', { player: P, item: { id: 'minecraft:stick', count: 1 } });
  no(!got(), 'non-matching item completed totem_of_undying');
  P.equip[0] = { i: MCL.Items.of('totem_of_undying'), n: 1 };
  no(MCL.Survival.tryUseTotem(P, {}), 'totem not consumed');
  no(got(), 'totem_of_undying not completed by the real call site');
  no(adv && P.advancements.getProgress(adv).isDone(), 'progress not done');
  return f;
}
run().forEach((m) => fails.push(m));
const ad = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14d_survival.js', "'minecraft:used_totem', {", "'minecraft:used_totem_x', {")],
  ['item condition ignored', brk('02l_advancements.js', 'P.item(c.item, null, ctx.item)', 'true')],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:used_totem'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-used_totemcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-used_totemcheck: OK — ${caught} breaks caught`);
