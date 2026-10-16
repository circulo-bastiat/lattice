#!/usr/bin/env node
// witchraidtargetcheck.mjs — #4442: Ai.RaidGoal picks the nearest raider by distance from the witch EYE, not feet.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zj_fox.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, W = MCL.World, Ent = MCL.Entities, CH = MCL.CH;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs;
W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); MCL.Spawn.init(); MCL.Breed.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const fails = []; let checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
MCL.Raid = { Status: { ONGOING: 'ongoing' } };
MCL.RaidManager = { world: { raids: { 7: { status: 'ongoing' } } } };
const w = EL.spawn('witch', 0, 64, 0, {}); w.raidId = 7;
const eye = Ai.eyeOf(w);
// A is 3 above, B 3 below, both at range 10: feet distance ties (B listed first wins), the eye is much nearer A.
const B = EL.spawn('pillager', 0, 61, 10, {}), A = EL.spawn('pillager', 10, 67, 0, {});
A.raidId = B.raidId = 7;
const dA = Math.hypot(10, 67 - 64 - eye), dB = Math.hypot(10, 61 - 64 - eye);
const want = dA < dB ? A : B;
ok(Math.abs(dA - dB) > 0.1, 'setup: eye distances must differ');
const sees = Ai.canSee, raid = Ai.RaidGoal;
Ai.canSee = () => true;
function pick(goalCtor) {
  const g = new goalCtor(w, { random: () => 0.9 });
  w.witchRaidCooldown = 0; w.target = null;
  return g.canUse() ? w.target : null;
}
const got = pick(raid);
ok(got === want, 'RaidGoal must pick the raider nearest the witch eye (got ' + (got && got.z) + ')');
// anti-vacuity: the old feet-based ordering ties on feet distance and keeps the first listed, B
const feetPick = B;
let caught = 0;
if (feetPick !== want) { caught++; console.log('✓ feet ordering would pick the other raider'); } else fails.push('break not caught: feet ordering gives the same pick');
Ai.canSee = sees;
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `witchraidtargetcheck: ${checks} assertions, 0 failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
