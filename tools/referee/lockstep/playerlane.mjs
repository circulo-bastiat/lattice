// lockstep/playerlane.mjs -- #6349 (G17-L60): the SCRIPTED-PLAYER lane type. A script of {tick, op} steps drives a survival player
// on the real 1.18.2 server (look / give / use item) and the engine (NS) the same way; both emit one trace row per tick holding
// the player (pos, health) and every tracked entity (pos, velocity), compared with trace.mjs' comparator.
//   script = [{ tick, op: 'look', yaw, pitch } | { tick, op: 'give', item, count? } | { tick, op: 'use' }]
// Tick clock = chasescen's: the datapack tick function runs before the world tick, row i = state after i world ticks.
import { compareTraces } from './trace.mjs';

const OPS = new Set(['look', 'give', 'use']);
export function validateScript(script, T) {
  const errs = [];
  script.forEach((s, i) => {
    if (!s || !OPS.has(s.op)) errs.push(`step ${i}: unknown op ${s && s.op}`);
    else if (!Number.isInteger(s.tick) || s.tick < 0 || s.tick >= T) errs.push(`step ${i}: tick ${s.tick} outside 0..${T - 1}`);
    else if (s.op === 'look' && !(Number.isFinite(s.yaw) && Number.isFinite(s.pitch))) errs.push(`step ${i}: look needs yaw+pitch`);
    else if (s.op === 'give' && !/^[a-z_]+$/.test(s.item || '')) errs.push(`step ${i}: give needs item`);
  });
  return errs;
}
export const stepsAt = (script, tick) => script.filter((s) => s.tick === tick);

// server side: mcfunction lines run by the tick function when #t == tick (look + give; 'use' is a packet, see usePackets)
export function serverCommands(script, bot) {
  const out = {};
  for (const s of script) {
    if (s.op === 'look') (out[s.tick] = out[s.tick] || []).push(`tp ${bot} ~ ~ ~ ${s.yaw} ${s.pitch}`);
    if (s.op === 'give') (out[s.tick] = out[s.tick] || []).push(`give ${bot} minecraft:${s.item} ${s.count || 1}`);
  }
  return out;
}
export const usePackets = (script) => script.filter((s) => s.op === 'use').map((s) => s.tick);
// per-tick logging lines: player Pos/Health and every entity of `types` (Pos, Motion) appended to storage lists
export function logCommands(bot, types) {
  const l = [`data modify storage mclite:lane player append from entity ${bot} Pos`, `data modify storage mclite:lane health append from entity ${bot} Health`];
  for (const t of types) l.push(`data modify storage mclite:lane ${t}Pos append from entity @e[type=minecraft:${t},limit=1,sort=nearest] Pos`, `data modify storage mclite:lane ${t}Vel append from entity @e[type=minecraft:${t},limit=1,sort=nearest] Motion`);
  return l;
}

// engine side: drive NS with the same script. api = { look(yaw,pitch), give(item,count), use(), step(), snapshot() -> {player:{x,y,z,health}, entities:[{type,x,y,z,vx,vy,vz}]} }
export function driveEngine(script, T, api) {
  const rows = [];
  for (let t = 0; t < T; t++) {
    for (const s of stepsAt(script, t)) { if (s.op === 'look') api.look(s.yaw, s.pitch); else if (s.op === 'give') api.give(s.item, s.count || 1); else api.use(); }
    rows.push(laneRow(t, api.snapshot()));
    api.step();
  }
  return rows;
}
export function laneRow(tick, snap) {
  const p = snap.player;
  return { tick, pos: [p.x, p.y, p.z], health: p.health,
    entities: snap.entities.map((e) => ({ type: e.type, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz] })) };
}
// first divergence over player pos/health and each entity's pos/vel; entities compared in order
export function compareLane(A, B) {
  const flat = (R) => R.map((r) => { const o = { tick: r.tick, pos: r.pos, health: r.health, nEnt: r.entities.length }; r.entities.forEach((e, i) => { o['e' + i + 'pos'] = e.pos; o['e' + i + 'vel'] = e.vel; }); return o; });
  const a = flat(A), b = flat(B), fields = new Set();
  for (const r of a.concat(b)) for (const k of Object.keys(r)) if (k !== 'tick') fields.add(k);
  return compareTraces(a, b, { fields: [...fields] });
}
