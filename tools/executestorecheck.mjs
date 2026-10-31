#!/usr/bin/env node
// executestorecheck.mjs — G17-CMD14 (#8131): /execute store result|success score|bossbar|storage|entity through the
// real dispatcher; repeated with the runChain callback unhooked to prove the check can fail (anti-vacuity, D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js',
  '07zzo2_scoreboard.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
{
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
const SB = M.Scoreboard, C = M.Commands;
M.Player = { x: 0, y: 64, z: 0 };
C.build();
const run = (l) => C.run(l, M.Player, {});

function suite(broken) {
  const chk = (c, m) => { if (!broken) ok(c, m); };
  const chkP = (c, m) => { if (broken) { breaks++; if (c) fails.push('anti-vacuity: ' + m); } else ok(c, m); };
  SB.reset(); C.storage = {}; C.bossBars = {};
  run('/scoreboard objectives add obj dummy');
  const O = SB.get('obj');
  run('/time set 6000');
  let r = run('/execute store result score x obj run time query daytime');
  chkP(r.ok && SB.getScore('x', O) === 6000, 'result score = daytime, got ' + SB.getScore('x', O));
  r = run('/execute store success score y obj run time query daytime');
  chkP(SB.getScore('y', O) === 1, 'success score = 1');
  r = run('/execute store success score z obj run scoreboard players get nobody obj');
  chkP(SB.getScore('z', O) === 0, 'failed command stores success 0, got ' + SB.getScore('z', O));
  r = run('/execute store result storage t:s a.b float 0.5 run time query daytime');
  chkP(((C.storage['t:s'] || {}).a || {}).b === 3000, 'storage scaled float');
  r = run('/execute store result storage t:s c int 2 run time query daytime');
  chkP((C.storage['t:s'] || {}).c === 12000, 'storage int scaled');
  run('/bossbar add t:b "B"');
  r = run('/execute store result bossbar t:b value run time query daytime');
  chkP(C.bossBars['t:b'] && C.bossBars['t:b'].value === 100, 'bossbar value clamped to max 100, got ' + (C.bossBars['t:b'] || {}).value);
  r = run('/execute store result score x obj store result score w obj run time query daytime');
  chkP(SB.getScore('w', O) === 6000 && SB.getScore('x', O) === 6000, 'chained stores both written');
}

suite(false);
const rc = M.Brigadier ? null : null;
// break: unhook the callback by neutering derive's carry-over
const D0 = C.derive;
C.derive = function (s, p) { const o = D0(s, p); o.resultCb = null; return o; };
suite(true);
C.derive = D0;
if (breaks === 0) fails.push('no breaks caught');
console.log(fails.length ? fails.join('\n') : `executestorecheck: ${pass} checks passed, 0 failures\n${"✓ break caught\n".repeat(breaks)}${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
