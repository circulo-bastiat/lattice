#!/usr/bin/env node
// advtrig-placed_blockcheck.mjs — G17-AT34. minecraft:placed_block: matcher + P.triggerPlaced (the call P.placeBlock
// makes after both placement paths). Completes husbandry/plant_seed; breaks its own matcher/call site.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(ROOT, 'src', f + '.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function grab(text, name) {
  const i = text.indexOf('P.' + name + ' = function');
  return text.slice(i, text.indexOf('\n  };', i) + 5);
}
function engine(adv, player) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', rd(f))(NS);
  new Function('MCL', adv)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  return NS;
}
let asserted = 0;
function verify(NS, player) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const adv = NS.Adv.manager.get('minecraft:husbandry/plant_seed');
  no(adv && Object.values(adv.criteria).some((c) => c.trigger === 'minecraft:placed_block'), 'advancement/criterion missing');
  let cell = 'minecraft:stone';
  const P = { advancements: new NS.Adv.Tracker({}), heldItem: () => ({ i: 1, n: 1 }) };
  NS.World = { getBlock: () => 1 };
  NS.States = { name: () => cell };
  NS.Items = { nameOf: () => 'wheat_seeds' };
  NS.Inventory = { isEmpty: () => false };
  new Function('NS', 'P', grab(player, 'triggerPlaced'))(NS, P);
  P.triggerPlaced(0, 64, 0);
  no(!P.advancements.getProgress(adv).isDone(), 'stone completed plant_seed');
  cell = 'wheat';
  P.triggerPlaced(0, 64, 0);
  no(P.advancements.getProgress(adv).isDone(), 'placing wheat did not complete plant_seed');
  const m = NS.Adv.matchers['minecraft:placed_block'];
  no(typeof m === 'function', 'no matcher');
  no(m && m({ block: 'minecraft:beetroots' }, { block: { id: 'minecraft:wheat' }, pos: [0, 0, 0] }) === false, 'wrong block passed');
  no(m && m({ block: 'minecraft:wheat' }, { block: { id: 'minecraft:wheat' }, pos: [0, 0, 0] }) === true, 'right block failed');
  no(m && m({ item: { items: ['minecraft:stick'] } }, { block: { id: 'minecraft:wheat' }, pos: [0, 0, 0], stack: { id: 'minecraft:dirt', count: 1 } }) === false, 'wrong item passed');
  const PL = player;
  no((PL.match(/P\.triggerPlaced\(bx, by, bz\);\n\s*P\.consumePlaced\(\)/g) || []).length === 2, 'placeBlock paths do not both call triggerPlaced before consumePlaced');
  return f;
}
const ADV = rd('02l_advancements'), PLY = rd('14_player');
const mut = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const fails = verify(engine(ADV), PLY);
const mutants = [
  ['matcher ignores block', () => verify(engine(mut(ADV, "if (has(cond.block) && !(b &&", "if (false && has(cond.block) && !(b &&")), PLY)],
  ['matcher always false', () => verify(engine(mut(ADV, "return P.location(cond.location, ctx, p[0]", "return false && P.location(cond.location, ctx, p[0]")), PLY)],
  ['no trigger in helper', () => verify(engine(ADV), mut(PLY, "NS.Adv.trigger(P, 'minecraft:placed_block'", "(0) && NS.Adv.trigger(P, 'minecraft:placed_block'"))],
  ['stacking path misses call', () => verify(engine(ADV), mut(PLY, "      P.triggerPlaced(bx, by, bz);\n", ""))],
];
let caught = 0;
for (const [name, fn] of mutants) {
  let bad; try { bad = fn(); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-placed_blockcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-placed_blockcheck: OK — ${caught} breaks caught`);
