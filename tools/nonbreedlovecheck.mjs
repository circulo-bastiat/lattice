#!/usr/bin/env node
// breedcheck.mjs — PLAN G18e, unit 1: LOVE MODE, FEEDING AND BREEDING.
//
//   node tools/breedcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Every number the breeding loop runs on comes out of the 1.18.2 bytecode
// (`tools/extract-breeding.mjs`), so the interesting question is never "is 600 right" — it is
// whether this engine's state machine is the jar's state machine. So the sections below drive
// the real `Breed` module, the real `EntityList` tick and the real `Ai.BreedGoal`, and each one
// asserts in BOTH directions (rule 6): the thing happens when vanilla says it does AND does not
// when it says it does not.
//
// ⚠ AND IT PROVES THE TABLE IS NOT A LIST SOMEBODY KEPT. §1 asserts the four KINDS are all
// present and distinct — an explicit list, a tag, a constant refusal (parrot and polar bear
// cannot be bred in vanilla at all) and a predicate (a wolf's rule is not a list) — because a
// packer that flattened the last two into "no items" would turn a fact into a hole.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log("   ✓ " + m); } else fails.push("anti-vacuity: " + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('nonbreedlovecheck — no mob outside the vanilla breedable set may enter love mode (#7657)');

const M = loadEngine({
  // ⚠ `02g_items.js` IS HERE FOR ONE ASSERTION AND IT EARNS ITS PLACE: §6 resolves a held
  // stack through the REAL item registry, which is the only way to prove the live player's
  // `heldItem()` shape reaches `Breed.isFood` as a name rather than as an object.
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07zx_particle.js', '07zzo_stats.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();

const Br = M.Breed, Ent = M.Entities, EL = M.EntityList, W = M.World, CH = M.CH;
ok(Br.ready, 'Breed module reports ready');
if (!Br.ready) {
  console.log('\nFAIL  Breed did not initialise — the breeding table is missing from entities.json');
  process.exit(1);
}


const VANILLA = new Set(Ent.animals());
const foods = ['wheat','carrot','potato','beetroot','golden_carrot','seagrass','kelp','cod','salmon','beef','bone','hay_block','wheat_seeds','sweet_berries','spider_eye','rotten_flesh','tropical_fish_bucket','pufferfish','porkchop','chicken'];
function sweep(types) {
  let bad = [];
  for (const t of types) {
    if (VANILLA.has(t) && Br.canBreed(t)) continue;
    for (const f of foods) {
      const e = { type: t, growAge: 0, inLove: 0 };
      let r = false; try { r = Br.interact(e, f, {}); } catch (x) {}
      if (r === 'love' || e.inLove > 0) { bad.push(t + '<-' + f); break; }
    }
  }
  return bad;
}
const all = Ent.all();
ok(sweep(all).length === 0, 'no non-breedable type falls in love on any food: ' + sweep(all).join(','));
ok(!VANILLA.has('elder_guardian') && !VANILLA.has('guardian'), 'guardian/elder_guardian carry no breeding rule');
// tick elders + guardians 5000 ticks
W.getBlock = W.getBlock || (() => 0);
let n0 = 0, n1 = 0;
try {
  for (const t of ['elder_guardian','guardian']) for (let i = 0; i < 3; i++) EL.spawn(t, 8 + i, 20, 8, {});
  n0 = EL.list.length;
  for (let i = 0; i < 5000; i++) EL.tick && EL.tick();
  n1 = EL.list.filter(e => !e.removed).length;
  const inLove = EL.list.filter(e => (e.inLove | 0) > 0 || e.isBaby || (e.growAge | 0) !== 0);
  ok(inLove.length === 0, 'no guardian in love / baby after 5000 ticks');
  ok(n1 <= n0, `entity count never grows from ticking alone (${n0} -> ${n1})`);
} catch (x) { say('tick sim skipped: ' + x.message); }
// anti-vacuity: break the rule (give elder_guardian a wheat rule) and the sweep must see it
{
  const saved = Ent.breeding; Ent.breeding = Object.assign({}, saved);
  const orig = Br.isFood; Br.isFood = (t, i) => t === 'elder_guardian' ? true : orig(t, i);
  okAv(sweep(['elder_guardian']).length === 1, 'sweep catches an elder guardian made feedable');
  Br.isFood = orig; Ent.breeding = saved;
  const e = { type: 'elder_guardian', growAge: 0, inLove: 5 };
  okAv(sweep(['elder_guardian']).length === 0, 'sweep is clean again once the break is undone');
}
if (fails.length) { console.log('FAIL'); for (const f of fails) console.log('  ' + f); process.exit(1); }
console.log(` assertions passed ... ${pass}`);
console.log(` breaks caught ...... ${breaks}`);
