// redstonescen.mjs — the REDSTONE TIMING scenarios, shared by the referee runner (runredstone.mjs, the real
// 1.18.2 server) and the engine check (redrefcheck.mjs). Infra I6, 24 Sept 2026.
//
// A scenario is a tiny circuit in LOCAL coordinates (x east, y up, floor of stone at y=-1), one TRIGGER cell that
// is toggled air <-> redstone_block at given ticks, and PROBES (block + property = value) sampled once per tick.
// Both sides run the same clock:
//   for k = 1..T:  apply the events for tick k  ->  sample every probe (log[k-1])  ->  one world tick
// On the server that is a `#minecraft:tick` function (functions run before the worlds tick, exactly where a
// player's packet lands); in the engine it is set+Behave.changed, sample, Behave.tick + BlockEntities.tick.
// So log[E-1] shows what a toggle at tick E did IMMEDIATELY, log[E-1+m] what it did after m world ticks.
// Every number the check compares is the SERVER's (D-329); this file only builds circuits.

export const T = 40;          // ticks logged per scenario
export const ON = 5, OFF = 22; // default trigger toggles

const W = { facing: 'west' };  // a diode/observer whose INPUT is the -x side (vanilla: input = pos.offset(FACING))
const wireX = { east: 'side', west: 'side', north: 'none', south: 'none', power: '0' };

function diodeLine(id, blocks, probes, events) { return { id, blocks, probes, events: events || [[ON, 1], [OFF, 0]] }; }

const S = [];
// 1. repeater delay 1..4, held on then off; and short pulses into it (pulse extension)
for (const d of [1, 2, 3, 4]) {
  S.push(diodeLine(`repeater_d${d}`,
    [[1, 0, 0, 'repeater', { ...W, delay: String(d) }], [2, 0, 0, 'redstone_wire', wireX]],
    [['rep', 1, 0, 0, 'repeater', 'powered', 'true'], ['wire', 2, 0, 0, 'redstone_wire', 'power', '15']]));
}
for (const [d, p] of [[1, 1], [4, 1], [2, 3], [4, 2], [3, 5]]) {
  S.push(diodeLine(`repeater_d${d}_pulse${p}`,
    [[1, 0, 0, 'repeater', { ...W, delay: String(d) }], [2, 0, 0, 'redstone_wire', wireX]],
    [['rep', 1, 0, 0, 'repeater', 'powered', 'true']], [[ON, 1], [ON + p, 0]]));
}
// 2. three delay-1 repeaters in a row
S.push(diodeLine('repeater_chain3',
  [[1, 0, 0, 'repeater', { ...W, delay: '1' }], [2, 0, 0, 'repeater', { ...W, delay: '1' }],
   [3, 0, 0, 'repeater', { ...W, delay: '1' }], [4, 0, 0, 'redstone_wire', wireX]],
  [['r1', 1, 0, 0, 'repeater', 'powered', 'true'], ['r3', 3, 0, 0, 'repeater', 'powered', 'true'],
   ['wire', 4, 0, 0, 'redstone_wire', 'power', '15']]));
// 3. comparator (compare and subtract), fed a full 15
for (const mode of ['compare', 'subtract']) {
  S.push(diodeLine(`comparator_${mode}`,
    [[1, 0, 0, 'comparator', { ...W, mode }], [2, 0, 0, 'redstone_wire', wireX]],
    [['cmp', 1, 0, 0, 'comparator', 'powered', 'true'], ['wire', 2, 0, 0, 'redstone_wire', 'power', '15']]));
}
// 4. torch inverter: repeater strongly powers a stone block carrying a wall torch
S.push(diodeLine('torch_inverter',
  [[1, 0, 0, 'repeater', { ...W, delay: '1' }], [2, 0, 0, 'stone', {}],
   [3, 0, 0, 'redstone_wall_torch', { facing: 'east' }], [4, 0, 0, 'redstone_wire', wireX]],
  [['torch', 3, 0, 0, 'redstone_wall_torch', 'lit', 'true'], ['wire', 4, 0, 0, 'redstone_wire', 'power', '15']]));
// 5. two inverters in series: the first (wall) torch strongly powers the block ABOVE it, which carries the second
S.push(diodeLine('torch_double',
  [[1, 0, 0, 'repeater', { ...W, delay: '1' }], [2, 0, 0, 'stone', {}],
   [3, 0, 0, 'redstone_wall_torch', { facing: 'east' }], [3, 1, 0, 'stone', {}],
   [4, 1, 0, 'redstone_wall_torch', { facing: 'east' }]],
  [['t1', 3, 0, 0, 'redstone_wall_torch', 'lit', 'true'], ['t2', 4, 1, 0, 'redstone_wall_torch', 'lit', 'true']]));
// 6. redstone lamp: directly beside the trigger, and at the end of a 3-wire run
S.push(diodeLine('lamp_direct', [[1, 0, 0, 'redstone_lamp', { lit: 'false' }]],
  [['lamp', 1, 0, 0, 'redstone_lamp', 'lit', 'true']]));
S.push(diodeLine('lamp_pulse1', [[1, 0, 0, 'redstone_lamp', { lit: 'false' }]],
  [['lamp', 1, 0, 0, 'redstone_lamp', 'lit', 'true']], [[ON, 1], [ON + 1, 0]]));
S.push(diodeLine('lamp_wire3',
  [[1, 0, 0, 'redstone_wire', wireX], [2, 0, 0, 'redstone_wire', wireX], [3, 0, 0, 'redstone_wire', wireX],
   [4, 0, 0, 'redstone_lamp', { lit: 'false' }]],
  [['w1', 1, 0, 0, 'redstone_wire', 'power', '15'], ['w3', 3, 0, 0, 'redstone_wire', 'power', '13'],
   ['lamp', 4, 0, 0, 'redstone_lamp', 'lit', 'true']]));
// 7. observer watching the trigger cell (facing = the side it watches), output wire behind it
S.push(diodeLine('observer',
  [[1, 0, 0, 'observer', { facing: 'west' }], [2, 0, 0, 'redstone_wire', wireX]],
  [['obs', 1, 0, 0, 'observer', 'powered', 'true'], ['wire', 2, 0, 0, 'redstone_wire', 'power', '15']]));
// 8. pistons: normal and sticky, pushing one stone; retract on OFF
for (const kind of ['piston', 'sticky_piston']) {
  S.push(diodeLine(kind,
    [[1, 0, 0, kind, { facing: 'east', extended: 'false' }], [2, 0, 0, 'stone', {}]],
    [['ext', 1, 0, 0, kind, 'extended', 'true'], ['head', 2, 0, 0, 'piston_head', null, null],
     ['moving2', 2, 0, 0, 'moving_piston', null, null], ['moving3', 3, 0, 0, 'moving_piston', null, null],
     ['stone2', 2, 0, 0, 'stone', null, null], ['stone3', 3, 0, 0, 'stone', null, null]]));
}
// 9. a piston fed a 1-tick pulse (vanilla: the sticky one spits its block)
for (const kind of ['piston', 'sticky_piston']) {
  S.push(diodeLine(`${kind}_pulse1`,
    [[1, 0, 0, kind, { facing: 'east', extended: 'false' }], [2, 0, 0, 'stone', {}]],
    [['ext', 1, 0, 0, kind, 'extended', 'true'], ['stone2', 2, 0, 0, 'stone', null, null],
     ['stone3', 3, 0, 0, 'stone', null, null]], [[ON, 1], [ON + 1, 0]]));
}
// 10. an observer watching an observer (the second sees the first's pulse), and a piston that pushes a
//     redstone block up to a lamp (the moving block's arrival is a neighbour update)
S.push(diodeLine('observer_chain',
  [[1, 0, 0, 'observer', { facing: 'west' }], [2, 0, 0, 'observer', { facing: 'west' }], [3, 0, 0, 'redstone_wire', wireX]],
  [['o1', 1, 0, 0, 'observer', 'powered', 'true'], ['o2', 2, 0, 0, 'observer', 'powered', 'true'],
   ['wire', 3, 0, 0, 'redstone_wire', 'power', '15']]));
S.push(diodeLine('piston_pushes_power',
  [[1, 0, 0, 'sticky_piston', { facing: 'east', extended: 'false' }], [2, 0, 0, 'redstone_block', {}],
   [4, 0, 0, 'redstone_lamp', { lit: 'false' }]],
  [['lamp', 4, 0, 0, 'redstone_lamp', 'lit', 'true'], ['rb3', 3, 0, 0, 'redstone_block', null, null]]));
// 11. things redstone OPENS or FIRES: iron door, iron trapdoor, fence gate, note block, dropper, powered rail
S.push(diodeLine('iron_door',
  [[1, 0, 0, 'iron_door', { facing: 'east', half: 'lower', hinge: 'left', open: 'false', powered: 'false' }],
   [1, 1, 0, 'iron_door', { facing: 'east', half: 'upper', hinge: 'left', open: 'false', powered: 'false' }]],
  [['open', 1, 0, 0, 'iron_door', 'open', 'true'], ['upper', 1, 1, 0, 'iron_door', 'open', 'true']]));
S.push(diodeLine('iron_trapdoor',
  [[1, 0, 0, 'iron_trapdoor', { facing: 'east', half: 'bottom', open: 'false', powered: 'false' }]],
  [['open', 1, 0, 0, 'iron_trapdoor', 'open', 'true'], ['pow', 1, 0, 0, 'iron_trapdoor', 'powered', 'true']]));
S.push(diodeLine('fence_gate',
  [[1, 0, 0, 'oak_fence_gate', { facing: 'east', open: 'false', powered: 'false' }]],
  [['open', 1, 0, 0, 'oak_fence_gate', 'open', 'true'], ['pow', 1, 0, 0, 'oak_fence_gate', 'powered', 'true']]));
S.push(diodeLine('note_block',
  [[1, 0, 0, 'note_block', { powered: 'false' }]],
  [['pow', 1, 0, 0, 'note_block', 'powered', 'true']]));
S.push(diodeLine('dropper',
  [[1, 0, 0, 'dropper', { facing: 'up', triggered: 'false' }]],
  [['trig', 1, 0, 0, 'dropper', 'triggered', 'true']]));
S.push(diodeLine('powered_rail',
  Array.from({ length: 11 }, (_, i) => [1 + i, 0, 0, 'powered_rail', { shape: 'east_west', powered: 'false' }]),
  [['r1', 1, 0, 0, 'powered_rail', 'powered', 'true'], ['r8', 8, 0, 0, 'powered_rail', 'powered', 'true']]));
export const SCENARIOS = S;

/** World placement of scenario i on the server: 16 blocks apart along x, floor at y=-61, circuits at y=-60. */
export const origin = (i) => ({ x: 4 + 16 * i, y: -60, z: 4 });

const stateStr = (name, props) => {
  const kv = Object.entries(props || {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}=${v}`);
  return `minecraft:${name}${kv.length ? '[' + kv.join(',') + ']' : ''}`;
};

/** The setup commands (RCON) and the datapack tick body for every scenario. */
export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(S.length - 1).x + 8;
  setup.push(`forceload add 0 0 ${maxX} 16`);
  setup.push(`fill 0 -61 0 ${maxX} -61 12 minecraft:stone`);
  // (one fill per scenario: a single fill of the whole strip is over /fill's 32768-block limit and FAILS)
  for (let x0 = 0; x0 <= maxX; x0 += 16) setup.push(`fill ${x0} -60 0 ${x0 + 15} -55 12 minecraft:air`);
  S.forEach((sc, i) => {
    const o = origin(i);
    for (const [x, y, z, name, props] of sc.blocks) setup.push(`setblock ${o.x + x} ${o.y + y} ${o.z + z} ${stateStr(name, props)}`);
    for (const [t, v] of sc.events) {
      step.push(`execute if score #t mclr matches ${t} run setblock ${o.x} ${o.y} ${o.z} minecraft:${v ? 'redstone_block' : 'air'}`);
    }
  });
  S.forEach((sc, i) => {
    const o = origin(i);
    for (const [label, x, y, z, name, prop, val] of sc.probes) {
      const key = `${sc.id}.${label}`;
      probes.push(key);
      const j = probes.length - 1;
      step.push(`execute store success score #p mclr if block ${o.x + x} ${o.y + y} ${o.z + z} ${stateStr(name, prop ? { [prop]: val } : {})}`);
      step.push(`execute if score #p mclr matches 1 run data modify storage mcliteref:red p${j} append value 1b`);
      step.push(`execute if score #p mclr matches 0 run data modify storage mcliteref:red p${j} append value 0b`);
    }
  });
  return { setup, step, probes };
}
