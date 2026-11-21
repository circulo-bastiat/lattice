#!/usr/bin/env node
// stateport11755check.mjs — #11755: src/02s_state.js (net/minecraft/state) over a fake registry shaped like oak_stairs, and its reach into Commands.stateString.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'src/02s_state.js'), 'utf8');
const cmd = readFileSync(join(ROOT, 'src/15g_commands.js'), 'utf8');
const bp = readFileSync(join(ROOT, '.decomp/net/minecraft/state/property/BooleanProperty.java'), 'utf8');
const javaBoolOrder = /ImmutableSet\.of\(true, false\)|of\(true, false\)/.test(bp);
function scenario(code, cmdCode) { try { return scenario0(code, cmdCode); } catch (e) { return ['threw: ' + e.message]; } }
function scenario0(code, cmdCode) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  // block 1 = stairs: facing(N,S,W,E subset: north,south,west,east) stride 4... declaration order facing, half, waterlogged (last fastest)
  const names = ['facing', 'half', 'waterlogged'], vn = ['north', 'south', 'west', 'east', 'top', 'bottom', 'true', 'false'];
  const R = { ready: true, names: ['air', 'oak_stairs'], realFirst: [0, 1, 41], defaultState: [0, 3],
    propFirst: [0, 0, 3], propId: [0, 1, 2], propStride: [4, 2, 1], propValN: [4, 2, 2], propValOff: [0, 4, 6],
    propVals: [0, 1, 2, 3, 4, 5, 6, 7], propNames: names, valueNames: vn };
  // stairs: 4*2*2 = 16 states
  R.realFirst = [0, 1, 17];
  const NS = { Reg: R, States: { block: [0, 1] } };
  try { new Function('MCL', code)(NS); } catch (e) { return ['load: ' + e.message]; }
  const D = NS.StateDef, sm = D.StateManager.of(1);
  chk(javaBoolOrder, 'java BooleanProperty order parse');
  chk(sm.count === 16 && sm.getStates().length === 16, 'state count');
  chk(sm.getProperties().length === 3, 'property count');
  chk(sm.getProperty('waterlogged') instanceof D.BooleanProperty && sm.getProperty('waterlogged').getValues().join() === 'true,false', 'boolean values true,false');
  chk(sm.getProperty('facing') instanceof D.DirectionProperty && sm.getProperty('facing') instanceof D.EnumProperty, 'facing is DirectionProperty');
  chk(sm.getProperty('half') instanceof D.EnumProperty && !(sm.getProperty('half') instanceof D.DirectionProperty), 'half is plain EnumProperty');
  chk(D.DirectionProperty.HORIZONTAL('facing').getValues().join() === 'north,south,west,east', 'HORIZONTAL order');
  chk(D.DirectionProperty.of('d').getValues().join() === 'down,up,north,south,west,east', 'Direction order');
  chk(D.BooleanProperty.of('x').parse('false') === false && D.BooleanProperty.of('x').parse('q') === null, 'boolean parse');
  chk(sm.getDefaultState() === 4, 'default state');
  const s = 1 + 2 * 4 + 1 * 2 + 1;   // west, bottom, false
  chk(sm.get(s, 'facing') === 'west' && sm.get(s, 'half') === 'bottom' && sm.get(s, 'waterlogged') === 'false', 'get');
  const t = sm.with(s, 'facing', 'east');
  chk(t === 1 + 3 * 4 + 3 && sm.get(t, 'half') === 'bottom', 'with keeps other properties');
  let threw = 0; try { sm.with(s, 'facing', 'up'); } catch (e) { threw++; } try { sm.with(s, 'nope', 'x'); } catch (e) { threw++; }
  chk(threw === 2, 'with rejects bad value/property');
  chk(sm.stringify(s) === 'minecraft:oak_stairs[facing=west,half=bottom,waterlogged=false]', 'stringify ' + sm.stringify(s));
  // reach: Commands.stateString
  const ci = cmdCode.indexOf('C.stateString = function');
  chk(ci >= 0 && cmdCode.slice(ci, ci + 400).indexOf('StateDef.StateManager') > 0, 'Commands.stateString uses StateManager');
  return f;
}
const bad = scenario(src, cmd);
if (bad.length) { console.log('FAIL: ' + bad.join('; ')); process.exit(1); }
const breaks = [
  [s => s.replace("['true', 'false']", "['false', 'true']"), 'boolean order'],
  [s => s.replace("d !== 'down' && d !== 'up'", "d !== 'down'"), 'horizontal filter'],
  [s => s.replace("'down', 'up', 'north', 'south', 'west', 'east'", "'north', 'south', 'west', 'east', 'down', 'up'"), 'direction order'],
  [s => s.replace("(idx - cur) * R.propStride[k]", "(idx - cur)"), 'with stride'],
  [s => s.replace("this.first + NS.Reg.defaultState", "NS.Reg.defaultState"), 'default state'],
  [s => s.replace("parts.sort(", "parts.reverse("), 'sorted stringify'],
  [s => s.replace("if (idx < 0) throw", "if (false) throw"), 'bad value']
];
let caught = 0;
for (const [fn, why] of breaks) {
  const b = fn(src); if (b === src) { console.log('break did not apply: ' + why); process.exit(1); }
  if (scenario(b, cmd).length) caught++; else console.log('NOT caught: ' + why);
}
caught += scenario(src, cmd.replace('StateDef.StateManager', 'Nope')).length ? 1 : 0;
if (caught !== breaks.length + 1) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('PASS stateport11755check — ' + caught + ' breaks caught; 4 net/minecraft/state classes ported');
