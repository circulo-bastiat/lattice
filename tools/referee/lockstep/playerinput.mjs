// lockstep/playerinput.mjs -- #6988 (G17): the player MOVEMENT-INPUT driver for the lockstep player lane (#5381).
// Script op { tick, op: 'input', fwd, strafe, jump, sneak, sprint } SETS the held input from that tick on (until the next input step).
//   server side: one ServerboundPlayerInput/PlayerMove/PlayerCommand packet set per tick (inputPackets) -- the bot sends them to the real 1.18.2 server
//   engine side: a headless stepper runs NS.Player.tick() with a stubbed NS.Input, and emits per tick pos/vel/onGround/food/saturation/exhaustion
import { loadEngine } from '../../loadsrc.mjs';
import { compareTraces } from './trace.mjs';

export const INPUT_FIELDS = ['fwd', 'strafe', 'jump', 'sneak', 'sprint'];
export function validateInputs(script, T) {
  const errs = [];
  script.filter((s) => s && s.op === 'input').forEach((s, i) => {
    if (!Number.isInteger(s.tick) || s.tick < 0 || s.tick >= T) errs.push(`input ${i}: tick ${s.tick} outside 0..${T - 1}`);
    if (![undefined, -1, 0, 1].includes(s.fwd) || ![undefined, -1, 0, 1].includes(s.strafe)) errs.push(`input ${i}: fwd/strafe must be -1, 0 or 1`);
    if (s.sneak && s.sprint) errs.push(`input ${i}: sneak and sprint together`);
  });
  return errs;
}
// the held input at `tick` = the last input step at or before it
export function heldInput(script, tick) {
  const h = { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  for (const s of script.filter((x) => x.op === 'input' && x.tick <= tick).sort((a, b) => a.tick - b.tick)) for (const k of INPUT_FIELDS) h[k] = s[k] === undefined ? (typeof h[k] === 'number' ? 0 : false) : s[k];
  return h;
}
// per-tick packets for the server bot: PlayerInput (sideways, forward, jump, sneak), then PlayerCommand start/stop sneaking/sprinting on edges
export function inputPackets(script, T) {
  const out = []; let prev = heldInput(script, -1);
  for (let t = 0; t < T; t++) {
    const h = heldInput(script, t), p = [{ type: 'player_input', sideways: h.strafe, forward: h.fwd, jump: h.jump, sneak: h.sneak }];
    if (h.sneak !== prev.sneak) p.push({ type: 'player_command', mode: h.sneak ? 'press_shift_key' : 'release_shift_key' });
    if (h.sprint !== prev.sprint) p.push({ type: 'player_command', mode: h.sprint ? 'start_sprinting' : 'stop_sprinting' });
    out.push(p); prev = h;
  }
  return out;
}
// server-side logging lines: player Pos, Motion, OnGround, foodLevel, foodSaturationLevel, foodExhaustionLevel
export const logInputCommands = (bot) => ['Pos', 'Motion', 'OnGround', 'foodLevel', 'foodSaturationLevel', 'foodExhaustionLevel']
  .map((k) => `data modify storage mclite:lane p${k} append from entity ${bot} ${k === 'OnGround' ? 'OnGround' : k}`);

// headless engine stepper. `world` = optional (x,y,z)->state fn; default is a flat stone floor under y=0.
let H = null;
export function stepper(opts = {}) {
  if (!H) {
    const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '14b_physics.js', '14d_survival.js', '14e_gamemode.js', '14_player.js'], dom: false, initReg: true });
    H = { M, input: { uiOpen: false, locked: true, sprintLatch: false, held: {}, down(c) { return !!this.held[c]; }, sneakOn() { return this.down("ShiftLeft"); }, sprintOn() { return this.down("ControlLeft") || this.sprintLatch; } } };
    M.Input = H.input;
  }
  const { M, input } = H, P = M.Player, stone = M.States.stateOf('stone');
  const floorY = opts.floorY === undefined ? 0 : opts.floorY;
  const get = (x, y, z) => (opts.world ? opts.world(x, y, z) : (y < floorY ? stone : 0));
  M.World = Object.assign(M.World || {}, { getBlock: get, get, getLight: () => 0 });
  M.Physics.shapeAt = (x, y, z) => { const id = get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
  M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
  P.init(); M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  Object.assign(P, { x: opts.x ?? 0.5, y: floorY, z: opts.z ?? 0.5, vx: 0, vy: 0, vz: 0, yaw: opts.yaw ?? 0, pitch: 0, onGround: true, dead: false });
  const snap = (tick) => ({ tick, pos: [P.x, P.y, P.z], vel: [P.vx, P.vy, P.vz], onGround: !!P.onGround, food: P.food, saturation: P.saturation, exhaustion: P.exhaustion });
  return {
    P, snapshot: snap,
    setInput(h) { input.held = { KeyW: h.fwd > 0, KeyS: h.fwd < 0, KeyD: h.strafe > 0, KeyA: h.strafe < 0, Space: h.jump, ShiftLeft: h.sneak, ControlLeft: h.sprint }; },
    step() { P.tick(); }
  };
}
export function enginePlayerTrace(script, T, opts) {
  const s = stepper(opts), rows = [];
  for (let t = 0; t < T; t++) { s.setInput(heldInput(script, t)); rows.push(s.snapshot(t)); s.step(); }
  return rows;
}
export const compareInputTraces = (A, B) => compareTraces(A, B, { fields: ['pos', 'vel', 'onGround', 'food', 'saturation', 'exhaustion'] });
