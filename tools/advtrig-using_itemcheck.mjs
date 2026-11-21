#!/usr/bin/env node
// advtrig-using_itemcheck.mjs — #7996 G17-AT30. minecraft:using_item: the matcher (UsingItemCriterion.Conditions.test)
// and the call site (ServerPlayerEntity.tick -> Use.holdTick while using), driven through the real Use.holdBegin/holdTick.
// Advancements on this trigger: adventure/spyglass_at_parrot, spyglass_at_ghast, spyglass_at_dragon.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
console.log('advtrig-using_itemcheck — using_item matcher + the per-tick hold call site');

function run(patch) {
  const f = [];
  let asserted = 0;
  const no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '07i_entitylist.js', '02l_advancements.js', '14l_use.js'], patch });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  M.Entities.init(); M.EntityList.init();
  const Iv = M.Inventory, Use = M.Use;
  const mk = () => ({ inventory: Iv.create(), slot: 0, x: 0, y: 64, z: 0, usingItem: false, useHand: 0, useTicks: 0 });
  const done = [];
  const isDone = (P, id) => P.advancements.getProgress(M.Adv.manager.get('minecraft:adventure/' + id)).isDone();
  const fresh = (item, target) => {
    const P = mk(); P.advancements = new M.Adv.Tracker({ onGrant: (a) => done.push(a.id) });
    Iv.setItem(P.inventory, 0, Iv.stack(item, 1, 0)); P.targetEntity = target || null;
    return P;
  };
  const hold = (P) => { Use.holdBegin(P, Iv.getItem(P.inventory, 0), 0); Use.holdTick(P, 1); };

  let P = fresh('spyglass', { type: 'parrot', x: 3, y: 64, z: 0 }); hold(P);
  no(isDone(P, 'spyglass_at_parrot'), 'spyglass held at a parrot did not complete spyglass_at_parrot');
  no(!isDone(P, 'spyglass_at_ghast') && !isDone(P, 'spyglass_at_dragon'), 'a parrot completed the ghast/dragon advancement');
  P = fresh('spyglass', { type: 'ghast', x: 3, y: 64, z: 0 }); hold(P);
  no(isDone(P, 'spyglass_at_ghast') && !isDone(P, 'spyglass_at_parrot'), 'spyglass at a ghast: wrong advancement set');
  P = fresh('spyglass', { type: 'ender_dragon', x: 3, y: 64, z: 0 }); hold(P);
  no(isDone(P, 'spyglass_at_dragon'), 'spyglass at the dragon did not complete spyglass_at_dragon');
  P = fresh('spyglass', null); hold(P);
  no(!isDone(P, 'spyglass_at_parrot'), 'looking at nothing completed spyglass_at_parrot');
  P = fresh('bow', { type: 'parrot', x: 3, y: 64, z: 0 }); P.inventory && Iv.setItem(P.inventory, 9, Iv.stack('arrow', 1, 0)); hold(P);
  no(!isDone(P, 'spyglass_at_parrot'), 'a non-spyglass hold completed spyglass_at_parrot');
  P = fresh('spyglass', { type: 'parrot', x: 3, y: 64, z: 0 });
  no(!isDone(P, 'spyglass_at_parrot'), 'setup: completed before any hold');
  Use.holdTick(P, 1);
  no(!isDone(P, 'spyglass_at_parrot'), 'a tick without usingItem completed the advancement');
  return { f, asserted };
}

const base = run();
const fails = base.f.slice();
const mut = (file, a, b) => (name, src) => { if (name !== file) return src; if (!src.includes(a)) throw new Error('anchor gone: ' + a); return src.replace(a, b); };
const mutants = [
  ['matcher accepts anything', mut('02l_advancements.js', 'return P.extended(c.player, lc, { \'this\': pl }) && P.item(c.item, lc, ctx.item);', 'return true;')],
  ['item predicate ignored', mut('02l_advancements.js', 'P.item(c.item, lc, ctx.item);', 'true;')],
  ['looking_at ignored', mut('02l_advancements.js', 'has(j.player.looking_at) && !P.entity', 'false && !P.entity')],
  ['call site gone', mut('14l_use.js', "if (P.usingItem && NS.Adv && NS.Adv.trigger && P.advancements)", 'if (false)')],
  ['fires without hold', mut('14l_use.js', "if (P.usingItem && NS.Adv && NS.Adv.trigger && P.advancements)", 'if (NS.Adv && NS.Adv.trigger && P.advancements)')],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch).f; } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-using_itemcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${base.asserted}`);
console.log(`advtrig-using_itemcheck: OK — ${caught} breaks caught`);
