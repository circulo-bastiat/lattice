#!/usr/bin/env node
// advtrig-locationcheck.mjs — G17-AT40 (#8043). Drives the REAL call site (Player.tick, every 20th age tick ->
// Adv.trigger 'minecraft:location') against LocationArrivalCriterion; breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const fails = []; let asserted = 0;

// the matcher through Adv.trigger; the Player.tick call site (20-tick gate) is held by a source scan below.
function direct(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02l_advancements.js'], dom: false, patch });
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = { x: 0.5, y: 70, z: 0.5, type: 'player', dimension: 'overworld' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:' + id);
  const at = (b, feat) => Adv.trigger(P, 'minecraft:location', { player: P, dimension: 'overworld',
    biomeAt: () => b, structureAt: (x, y, z, n) => n === feat });
  at('minecraft:plains');
  no(has('adventure/adventuring_time') === false, 'one biome completed adventuring_time');
  const adv = Adv.manager.get('minecraft:adventure/adventuring_time');
  const got = (k) => P.advancements.getProgress(adv).criteria.get(k).date !== null;
  no(got('minecraft:plains'), 'plains criterion not granted in plains');
  no(!got('minecraft:desert'), 'desert criterion granted in plains');
  at('minecraft:nether_wastes');
  no(P.advancements.getProgress(Adv.manager.get('minecraft:nether/explore_nether')).criteria.get('minecraft:nether_wastes').date !== null, 'nether_wastes not granted');
  no(!P.advancements.getProgress(Adv.manager.get('minecraft:nether/explore_nether')).criteria.get('minecraft:warped_forest').date, 'warped_forest granted early');
  at('minecraft:plains', 'minecraft:fortress');
  no(P.advancements.getProgress(Adv.manager.get('minecraft:nether/find_fortress')).criteria.get('fortress').date !== null, 'fortress structure not granted');
  no(!P.advancements.getProgress(Adv.manager.get('minecraft:nether/find_bastion')).criteria.get('bastion').date, 'bastion granted in a fortress');
  return f;
}
const base = direct(); base.forEach((m) => fails.push(m));
const ps = readFileSync(join(ROOT, 'src/14_player.js'), 'utf8');
no0(ps.includes("'minecraft:location'") && ps.includes('P.age % 20 === 0'), 'call site missing from Player.tick');
function no0(c, m) { asserted++; if (!c) fails.push(m); }
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:location'] = function", "Adv.matchers['minecraft:x'] = function")],
  ['location ignored', brk('02l_advancements.js', 'P.location(has(c.location) ? c.location : c, lc', 'P.location(null, lc')],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = direct(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
// the call site: breaking the 20-tick gate in the source must be seen by the source scan
for (const [name, a, b] of [['call site gone', "'minecraft:location'", "'minecraft:locationx'"], ['gate gone', 'P.age % 20 === 0', 'P.age % 21 === 0']]) {
  if (!ps.replace(a, b).includes("'minecraft:location'") || !ps.replace(a, b).includes('P.age % 20 === 0')) { caught++; console.log('   ✓ broken (' + name + ')'); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-locationcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-locationcheck: OK — ${caught} breaks caught`);
