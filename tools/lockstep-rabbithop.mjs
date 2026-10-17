#!/usr/bin/env node
// lockstep-rabbithop -- #6889 (G17-L172): lockstep scenario rabbithop, 20 salts x 1200 ticks.
// Reference = RabbitEntity.mobTick / tickMovement / doScheduleJump / startJump / getJumpVelocity / jump() / tryAttack
// (.decomp RabbitEntity.java:108-260,299) written as an independent state machine on one java.util.Random stream
// (moreCarrotTicks -= nextInt(3)); a normal rabbit and a killer bunny (99) run side by side, ground/speed/target scripted per tick.
// Compared per tick: ticksUntilJump, jumpTicks/jumpDuration, jumping, lastOnGround, moreCarrotTicks, jump velocity, kick, yaw.
// Escape speed 2.2 -> reschedule 1 tick; killer damage 8 / normal none.  OWED: carrot-age eating and the wolf flee goal as lockstep (see rabbitcheck).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '14j_combat.js', '07zh_rabbit.js'], dom: false });
const Rb = M.Rabbit, Ai = M.Ai, Ent = M.Entities;
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); Ent.attrs = M.DATA.entities.attrs;
const BASE = 0.3, TICKS = 1200;
const mkE = (type, salt) => ({ type: 'rabbit', rabbitType: type, x: 0, y: 64, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, onGround: true, jumping: false, mobSpeed: 0, moveMod: 0,
  random: new M.JRandom(salt * 31 + type), moreCarrotTicks: 0 });
function ref(salt, type) {
  const rnd = new M.JRandom(salt * 31 + type), sc = new M.JRandom(salt * 977 + 5), out = [];
  const s = { tu: 0, jt: 0, jd: 0, jumping: false, last: false, more: 0, yaw: 0, vx: 0, vz: 0, jv: 0, active: false };
  let og = true, air = 0, mm = 0, tz = 9, col = false, ty = 64;
  for (let t = 0; t < TICKS; t++) {
    if (t % 40 === 0) { mm = [0, 0.6, 1, 2.2][sc.nextInt(4)]; tz = 1 + sc.nextInt(7); col = sc.nextInt(4) === 0; ty = 64 + sc.nextInt(3); if (sc.nextInt(5) === 0) s.more = 40; }
    const speed = mm, ang = Math.PI / 2;
    if (s.tu > 0) s.tu--;
    if (s.more > 0) { s.more -= rnd.nextInt(3); if (s.more < 0) s.more = 0; }
    let ev = null;
    const start = () => {
      s.jumping = true; s.jd = 10; s.jt = 0;
      s.jv = (col || (speed > 0 && ty > 64.5)) ? 0.5 : (speed <= 0.6 ? 0.2 : 0.3);
      if (speed > 0 && s.vx * s.vx + s.vz * s.vz < 0.01) { s.vx += Math.sin(s.yaw) * 0.1; s.vz -= Math.cos(s.yaw) * 0.1; }
    };
    if (og) {
      if (!s.last) { s.jumping = false; s.tu = speed < 2.2 ? 10 : 1; }
      if (type === 99 && s.tu === 0 && tz * tz < 16) { s.yaw = Math.atan2(0, -tz); start(); s.last = true; }
      if (!s.active) { if (speed > 0 && s.tu === 0) start(); }
    }
    s.last = og;
    if (s.jt !== s.jd) s.jt++; else if (s.jd !== 0) { s.jt = 0; s.jd = 0; s.jumping = false; }
    out.push(JSON.stringify([s.tu, s.jt, s.jd, s.jumping, s.last, s.more, s.jv, +s.vx.toFixed(9), +s.vz.toFixed(9), +s.yaw.toFixed(9)]));
    if (s.jumping && og) { og = false; air = 3 + sc.nextInt(4); } else if (!og && --air <= 0) og = true;
    if (!og) { s.vx = 0; s.vz = 0; }
  }
  return out;
}
function engine(salt, type) {
  const e = mkE(type, salt), sc = new M.JRandom(salt * 977 + 5), out = [];
  let og = true, air = 0, mm = 0, tz = 9;
  if (type === 99) Rb.setRabbitType(e, 99);
  for (let t = 0; t < TICKS; t++) {
    if (t % 40 === 0) { mm = [0, 0.6, 1, 2.2][sc.nextInt(4)]; tz = 1 + sc.nextInt(7); e.horizontalCollision = sc.nextInt(4) === 0; e.moveTargetY = 64 + sc.nextInt(3); if (sc.nextInt(5) === 0) e.moreCarrotTicks = 40; }
    e.onGround = og; e.moveMod = mm; e.mobSpeed = mm * BASE; e.target = { x: 0, y: 64, z: tz };
    Rb.mobTick(e);
    out.push(JSON.stringify([e.rabbitTicksUntilJump | 0, e.rabbitJumpTicks | 0, e.rabbitJumpDuration | 0, !!e.jumping, !!e.rabbitLastOnGround, e.moreCarrotTicks, e.jumpVelocity || 0,
      +e.vx.toFixed(9), +e.vz.toFixed(9), +e.yaw.toFixed(9)]));
    if (e.jumping && og) { og = false; air = 3 + sc.nextInt(4); } else if (!og && --air <= 0) og = true;
    if (!og) { e.vx = 0; e.vz = 0; }
  }
  return out;
}
function run() {
  for (let s = 0; s < 20; s++) for (const ty of [0, 99]) {
    const a = engine(s, ty), b = ref(s, ty);
    for (let t = 0; t < TICKS; t++) if (a[t] !== b[t]) return `salt ${s} type ${ty} tick ${t}: engine ${a[t]} != ref ${b[t]}`;
  }
  const dmgs = [];
  const k = mkE(99, 1); Rb.setRabbitType(k, 99); dmgs.push(k.attackDamage);
  const n = Ent.attrsOf('rabbit');
  if (k.attackDamage !== 8) return `killer bunny damage ${k.attackDamage} != 8`;
  if (!n || n.dmg !== null) return `rabbit ATTACK_DAMAGE ${n && n.dmg} != none (createRabbitAttributes has none; tryAttack 3 is unreachable, no attack goal)`;
  return null;
}
let fails = 0, breaks = 0;
const base = run();
if (base) { fails++; console.log('  FAIL ' + base.slice(0, 500)); }
const mut = (name, o, k, v) => { const old = o[k]; o[k] = v; const r = run(); o[k] = old; if (r) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); } };
const realSet = Rb.setRabbitType;
mut('killer damage 8 -> 7', Rb, 'setRabbitType', (e, t) => { realSet(e, t); if (t === 99) e.attackDamage = 7; });
const realDo = Rb.doScheduleJump;
mut('flee reschedule 1 -> 2', Rb, 'doScheduleJump', (e) => { realDo(e); if (e.rabbitTicksUntilJump === 1) e.rabbitTicksUntilJump = 2; });
mut('walk reschedule 10 -> 9', Rb, 'doScheduleJump', (e) => { realDo(e); if (e.rabbitTicksUntilJump === 10) e.rabbitTicksUntilJump = 9; });
const realJv = Rb.jumpVelocity;
mut('jump velocity 0.3 -> 0.31', Rb, 'jumpVelocity', (e) => { const v = realJv(e); return v === 0.3 ? 0.31 : v; });
const realMt = Rb.mobTick; Rb.__orig = realMt;
mut('killer lunge range 4 -> 5', Rb, 'mobTick', (e) => { const t = e.target; if (e.rabbitType === 99 && t && t.z === 4) t.z = 3; return realMt(e); });
console.log(`lockstep-rabbithop: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
