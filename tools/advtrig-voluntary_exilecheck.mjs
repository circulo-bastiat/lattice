#!/usr/bin/env node
// advtrig-voluntary_exilecheck.mjs — G17-AT45. minecraft:voluntary_exile: Adv.matchers + the RaidManager.startRaid call site.
// Drives startRaid with a Bad Omen player; asserts the trigger fires with the players, that a non-matching `player`
// condition does not, then breaks matcher and call site and requires the asserts to fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

function run(patch) {
  const M = loadEngine({ extra: ['07q_effects.js', '07s_raid.js', '02l_advancements.js', '07zzo_stats.js'], dom: false, patch });
  const am = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
  M.Adv.init({ advancements: readFileSync(join(ASSETS, 'advancements.bin')).toString('base64'), advancementsBytes: am.rawBytes });
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const A = M.Adv, ES = M.EntityStatus || M.Effects || M.ES;
  const users = Object.keys(A.data).filter((k) => JSON.stringify(A.data[k]).includes('minecraft:voluntary_exile'));
  // 1.18.2 packs NO advancement on this criterion (adventure/voluntary_exile uses player_killed_entity); the trigger is still fired.
  no(users.length === 0, 'unexpected packed users: ' + users.join(','));
  const seen = [], real = A.trigger;
  A.trigger = (p, id, ctx) => { seen.push([id, ctx]); return real(p, id, ctx); };
  const pl = { x: 0, y: 64, z: 0, health: 20, effects: [], advancements: new A.Tracker({}) };
  const ESm = M.Effects || ES;
  try { ESm.addStatusEffect(pl, 'bad_omen', 100, 0, false, true); } catch (e) { f.push('addStatusEffect: ' + e.message); }
  M.RaidManager.startRaid(M.RaidManager.create(), pl, { x: 0, y: 64, z: 0 }, 'normal', ESm);
  const done = (p, id) => p.advancements.getProgress(A.manager.get(id)).isDone();
  no(seen.length === 1 && seen[0][0] === 'minecraft:voluntary_exile' && seen[0][1] && seen[0][1].player === pl, 'startRaid did not trigger voluntary_exile with the player');
  no(!done(pl, 'minecraft:adventure/voluntary_exile'), 'player_killed_entity advancement must not complete from the exile trigger');
  const m = A.matchers['minecraft:voluntary_exile'];
  no(m && m({}, { player: pl }) === true, 'empty conditions should match');
  no(m && m({ player: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:pig' } }] }, { player: pl }) === false, 'non-matching player predicate matched');
  return f;
}

const fails = run();
const breaks = [
  ['matcher removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.matchers['minecraft:voluntary_exile'] = function", "var unused = function") : s],
  ['player predicate ignored', (f, s) => f === '02l_advancements.js' ? s.replace("return P.extended(c.player, { origin: pl ?", "return true || P.extended(c.player, { origin: pl ?") : s],
  ['call site removed', (f, s) => f === '07s_raid.js' ? s.replace("NS.Adv.trigger(player, 'minecraft:voluntary_exile'", "(function(){})(player, 'minecraft:voluntary_exile'") : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-voluntary_exilecheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 4');
console.log(`${caught} breaks caught (advtrig-voluntary_exilecheck OK)`);
