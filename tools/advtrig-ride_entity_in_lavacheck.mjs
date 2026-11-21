#!/usr/bin/env node
// advtrig-ride_entity_in_lavacheck.mjs — G17-AT10 (#7757). Drives the REAL call site (P.tickVehicleInLavaRiding, the
// port of ServerPlayerEntity.tickVehicleInLavaRiding) against TravelCriterion; breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '14_player.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player;
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const id = 'nether/ride_strider_in_overworld_lava';
  const has = () => done.includes('minecraft:' + id);
  const strider = { type: 'strider', inLava: true };
  P.dimension = 'overworld'; P.vehicle = strider; P.x = 0.5; P.y = 40; P.z = 0.5;
  P.tickVehicleInLavaRiding();                       // first tick only records the start
  no(!has(), 'completed on the first tick');
  P.x = 20.5; P.tickVehicleInLavaRiding();
  no(!has(), 'completed after 20 blocks');
  P.dimension = 'nether'; P.x = 90.5; P.tickVehicleInLavaRiding();
  no(!has(), 'completed in the nether');
  P.dimension = 'overworld'; P.tickVehicleInLavaRiding();
  no(has(), 'not completed after 90 blocks in the overworld');
  strider.inLava = false; P.tickVehicleInLavaRiding();
  no(P.vehicleInLavaRidingPos === null, 'start not cleared when the vehicle left the lava');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14_player.js', "'minecraft:ride_entity_in_lava', {", "'minecraft:ride_entity_in_lava_x', {")],
  ['distance ignored', brk('02l_advancements.js', 'P.distance(c.distance, s[0]', 'true || P.distance(c.distance, s[0]')],
  ['player location ignored', brk('02l_advancements.js', 'P.extended(c.player, lc, { \'this\': pl }) && P.location(c.start_position', 'P.location(c.start_position')],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:ride_entity_in_lava'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-ride_entity_in_lavacheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-ride_entity_in_lavacheck: OK — ${caught} breaks caught`);
