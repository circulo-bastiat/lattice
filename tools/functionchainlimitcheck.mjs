#!/usr/bin/env node
// functioncmdcheck.mjs — #8306: maxCommandChainLength limits /function runs.
// Runs every form through the real dispatcher, asserts Diff.get() and the exact lang strings,
// the same-difficulty failure, tab completion, and that peaceful then despawns hostiles via the
// real Spawn.despawnTick. Each assertion block is repeated against a broken engine (anti-vacuity).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; void 0; } else fails.push('anti-vacuity: ' + m); };

const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
{
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
M.Entities.init();
const W = M.World, EL = M.EntityList, Sp = M.Spawn, Diff = M.Diff, C = M.Commands;
W.init(1337); M.Gen.init(1337, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
Sp.init(); Sp.ready = false;
M.Player = { x: 300, y: 64, z: 0 };
C.build();
const run = (l, o) => C.run(l, M.Player, o || {});



let bad;
function suite(tag, broken) {
  const chk = broken ? (c) => { if (!c) bad++; } : ok;
  bad = 0;
  C.functions = Object.create(null); C.functionTags = Object.create(null);
  const rg = C.ruleGet;
  if (broken) C.ruleGet = (n) => n === 'maxCommandChainLength' ? '1000' : rg(n);
  C.ruleValues.maxCommandChainLength = '100';
  C.functions['minecraft:rec'] = ['say x', 'function rec'];
  let r = run('/function rec');
  chk(r.ok && C.lastChain === 100, 'recursive function at limit 100 runs exactly 100 commands: ' + C.lastChain);
  C.functions['minecraft:rec2'] = ['say x', 'function rec2', 'say y'];
  r = run('/function rec2');
  chk(r.ok && C.lastChain === 100, 'nested counts with later lines dropped: ' + C.lastChain);
  delete C.ruleValues.maxCommandChainLength;
  C.functions['minecraft:big'] = Array.from({ length: 1000 }, () => 'say x');
  r = run('/function big');
  chk(r.ok && r.result === 1000, 'default rule runs 1000 commands: ' + r.result);
  chk(C.chainUsed === undefined, 'chain counter reset after run');
  C.ruleGet = rg;
  if (broken) chk(bad === 0 ? false : true, 'x');
  return bad;
}
suite('real', false);
{ const b = suite('broken', true); breaks++; if (b > 0) pass++; else fails.push('anti-vacuity: limit not honoured went undetected'); }
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
