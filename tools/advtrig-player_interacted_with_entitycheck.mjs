#!/usr/bin/env node
// advtrig-player_interacted_with_entitycheck.mjs -- #7979 G17-AT17. minecraft:player_interacted_with_entity through the
// real call site (Use.entityUse -> PiglinBrain.playerInteract) on the real packed advancement nether/distract_piglin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

console.log('advtrig-player_interacted_with_entitycheck -- #7979');
const ASSETS = join(MCLITE_ROOT, 'assets');
const meta = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
const bin = readFileSync(join(ASSETS, 'advancements.bin')).toString('base64');

function scenarios(patch, matcherPatch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
            '14e_gamemode.js', '07q_effects.js', '07zzf_piglin.js', '14l_use.js', '02l_advancements.js'],
    initReg: false, patch });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  if (initRegistry) initRegistry(M);
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
  M.Adv.init({ advancements: bin, advancementsBytes: meta.rawBytes });
  if (matcherPatch) matcherPatch(M.Adv);
  const A = M.Adv, Iv = M.Inventory;
  const id = 'nether/distract_piglin';
  const run = (mutate) => {
    const P = M.Player = { x: 0, y: 64, z: 0, advancements: new A.Tracker({}) };
    const e = { type: 'piglin', x: 1, y: 64, z: 0, baby: false, removed: false, pgClock: 100, maxHealth: 16, health: 16 };
    const st = Iv.stack('gold_ingot', 3, 0, null);
    if (mutate) mutate(P, e, st);
    M.Use.entityUse(P, e, st);
    return P.advancements.getProgress(A.manager.get('minecraft:' + id)).isDone();
  };
  ok(run(), 'ingot to adult piglin completes distract_piglin');
  ok(!run((P, e) => { e.baby = true; }), 'baby piglin: entity predicate is_baby=false must not match');
  ok(!run((P, e) => { P.equipment = null; e.pgHitByPlayerUntil = 1000; }), 'refused interaction (no consume) must not trigger');
  return { fails, n };
}

const base = scenarios();
const fails = base.fails.slice();
const mutants = [
  ['matcher always false', null, (A) => { A.matchers['minecraft:player_interacted_with_entity'] = () => false; }],
  ['matcher ignores entity', null, (A) => { A.matchers['minecraft:player_interacted_with_entity'] = () => true; }],
  ['no call site', [['14l_use.js', "if (r && NS.Adv && NS.Adv.trigger && P.advancements) {   // Criteria.PLAYER", 'if (false) {   // Criteria.PLAYER']]],
];
let caught = 0;
for (const [name, p, mp] of mutants) {
  let bad;
  try { bad = scenarios(p ? (f, src) => { for (const [file, a, b] of p) if (f === file || f.endsWith(file)) { if (!src.includes(a)) throw new Error('anchor gone'); src = src.replace(a, b); } return src; } : undefined, mp).fails; }
  catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-player_interacted_with_entitycheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${base.n}`);
console.log(`advtrig-player_interacted_with_entitycheck: OK — ${caught} breaks caught`);
