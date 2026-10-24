#!/usr/bin/env node
// debugcmdcheck.mjs — #8233: /debug start|stop|report through the real dispatcher.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
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
const C = M.Commands;
M.Player = { x: 0, y: 64, z: 0 };
C.build();
const run = (l, o) => C.run(l, M.Player, o || {});
let clock = 0; C.nowMs = () => clock;

function suite(expectBroken, extraTick) {
  let bad = 0;
  const chk = (c, m) => { if (expectBroken) { if (!c) bad++; } else if (c) pass++; else fails.push(m); };
  M.Main = M.Main || {}; M.Main.ticks = 100; clock = 5000; C.debugState = null; C.debugLast = null;
  chk(!run('/debug stop').ok && /hasn't started/.test(run('/debug stop').lines.join('')), 'stop while idle fails');
  chk(!run('/debug report').ok, 'report with nothing fails');
  let r = run('/debug start');
  chk(r.ok && r.lines[0] === 'Started tick profiling', 'start prints');
  r = run('/debug start');
  chk(!r.ok && /already started/.test(r.lines.join('')), 'start twice fails');
  M.Main.ticks += 40 + (extraTick ? 1 : 0); clock += 2000;
  r = run('/debug stop');
  chk(r.ok && r.lines[0] === 'Stopped tick profiling after 2.00 seconds and 40 ticks (20.00 ticks per second)', 'stop exact: ' + r.lines.join('|'));
  chk(!run('/debug stop').ok, 'stop after stop fails');
  chk(run('/debug report').ok && C.debugLast.text.length > 0, 'report non-empty');
  chk(!run('/debug start', { level: 2 }).ok, 'level 2 refused');
  C.debugState = null;
  if (expectBroken) { breaks++; if (bad > 0) pass++; else fails.push('anti-vacuity: break not caught'); }
}
suite(false, false);
suite(true, true);
const b = C.debugState; // break: start allowed twice
const orig = C.debugState;
{
  const d = C.dispatcher.get('debug');
  new M.Brig.Builder(d).then(M.Brig.literal('start').executes(() => 0));
  suite(true, false);
}
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
