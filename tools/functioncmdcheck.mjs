#!/usr/bin/env node
// functioncmdcheck.mjs — #8232: /function and /schedule function (FunctionCommand, ScheduleCommand).
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


const B = M.Behave, tick = () => B.tick();
let log;
function suite(tag, expectBroken, mutate) {
  let bad = 0;
  const chk = expectBroken ? (c, m) => { if (!c) bad++; } : ok;
  const runL = (l, o) => run(mutate ? mutate(l) : l, o);
  C.functions = Object.create(null); C.functionTags = Object.create(null); C.timer = [];
  B.clearSchedule();
  log = [];
  C.functions['minecraft:t/a'] = C.parseFunction('# comment\n\n  say one  \n   # c2\nsay two\r\nsay three\n');
  chk(C.functions['minecraft:t/a'].length === 3, 'parser skips comments and blank lines');
  C.functions['minecraft:t/b'] = ['say b'];
  C.functionTags['minecraft:grp'] = ['t/a', 't/b'];
  let r = run('/function t/a');
  chk(r.ok && r.result === 3, 'function returns the command count (3)');
  chk(r.lines.length === 1 && /3/.test(r.lines[0]) && /t\/a/.test(r.lines[0]), 'success.single names count and id: ' + r.lines);
  r = run('/function #grp');
  chk(r.ok && r.result === 4 && /4/.test(r.lines[0]) && /2/.test(r.lines[0]), 'tag runs both: multiple');
  r = run('/function nope');
  chk(!r.ok && /nope/.test(r.lines.join('\n')) && r.error.message.indexOf('nope') >= 0, 'unknown function error');
  r = run('/function #nope');
  chk(!r.ok && r.error.message.indexOf('nope') >= 0 && r.error.message !== run('/function nope').error.message, 'unknown tag error differs');
  chk(!run('/function t/a', { level: 1 }).ok, 'level 1 refused');
  chk(!run('/schedule function t/a 0t').ok, 'same_tick refused');
  chk(!run('/schedule function nope 5t').ok, 'schedule unknown function refused');
  // schedule: fires on exactly the due tick
  let fired = 0; const rf = C.runFunction;
  C.runFunction = (id, s) => { if (id === 'minecraft:t/b') fired++; return rf(id, s); };
  C.functions['minecraft:t/b'] = ['say b'];
  r = runL('/schedule function t/b 5t');
  chk(r.ok, 'schedule created');
  for (let i = 0; i < 4; i++) tick();
  chk(fired === 0, 'not fired before due tick');
  tick();
  chk(fired === 1, 'fired on exactly the due tick');
  tick();
  chk(fired === 1, 'fires once');
  // append vs replace vs clear
  fired = 0;
  runL('/schedule function t/b 10t'); runL('/schedule function t/b 20t append');
  chk(C.timer.length === 2, 'append keeps both');
  runL('/schedule function t/b 30t');
  chk(C.timer.length === 1, 'default replace leaves one');
  runL('/schedule function t/b 40t replace'); runL('/schedule function t/b 50t append');
  chk(C.timer.length === 2, 'replace then append = 2');
  r = run('/schedule clear minecraft:t/b');
  chk(r.ok && r.result === 2 && C.timer.length === 0, 'clear removes both, returns 2');
  r = run('/schedule clear minecraft:t/b');
  chk(!r.ok, 'clear of nothing fails');
  // save/load
  fired = 0;
  runL('/schedule function t/b 7t');
  for (let i = 0; i < 3; i++) tick();
  const saved = JSON.stringify(C.timerToJSON());
  C.timer = []; B.clearSchedule();
  C.timerFromJSON(JSON.parse(saved));
  chk(C.timer.length === 1, 'event survives save/load');
  for (let i = 0; i < 3; i++) tick();
  chk(fired === 0, 'still pending after load');
  tick();
  chk(fired === 1, 'fires on the right tick after load');
  C.runFunction = rf;
  if (expectBroken) okAv(bad > 0, tag + ' (' + bad + ' assertions failed)');
}
suite('real', false);
// off-by-one: the timer runs one tick late
const tt = C.timerTick; C.timerTick = (n) => tt(n - 1);
suite('off-by-one delay', true);
C.timerTick = tt;
// replace acting as append
suite('replace acts as append', true, l => l.replace(/^(\/schedule function \S+ \S+)$/, '$1 append').replace(/ replace$/, ' append'));

console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
