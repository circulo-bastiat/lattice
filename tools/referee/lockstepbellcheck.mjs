// lockstep-bell -- #6799 (G17-L148): lockstep scenario 'bell', 20 salts: raiders + villagers around a bell rung by hand / arrow / redstone.
// Reference = .decomp BellBlockEntity.tick/activate/raidersHearBell/applyGlowToRaiders: ringTicks counts to 50, resonate starts at ringTicks>=5 with a raider within 32,
// 40 ticks later every live raider within 48 gets Glowing 60; BellBlock.ring -> notifyMemoriesOfBell stamps HEARD_BELL_TIME on villagers within 32. Per tick the whole state is compared.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07s_raid.js', '07zv7_vbbell.js'], dom: false });
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const bes = new Map();
M.BlockEntities = { get: (x, y, z) => bes.get(x + ',' + y + ',' + z), create: (x, y, z, t) => { const b = { x, y, z, type: t }; bes.set(x + ',' + y + ',' + z, b); return b; } };
M.Effects = { addStatusEffect: (e, id, dur) => { (e.fx = e.fx || []).push([id, dur]); } };
M.EntityList = { list: [] };
const RT = ['pillager', 'vindicator', 'evoker', 'ravager', 'witch', 'illusioner'];
const SIDES = ['north', 'south', 'east', 'west'];
// independent reference of one bell
function ref(bx, by, bz, ents) {
  const s = { ringing: false, ticks: 0, resT: 0, res: false }, w = (e, d) => { const dx = e.x - (bx + .5), dy = e.y - (by + .5), dz = e.z - (bz + .5); return dx * dx + dy * dy + dz * dz < d * d; };
  const raider = (e, d) => !e.dead && RT.includes(e.type) && w(e, d);
  return {
    s, activate() { if (s.ringing) s.ticks = 0; else s.ringing = true; s.resT = 0; s.res = false; },
    tick() {
      if (s.ringing) s.ticks++;
      if (s.ticks >= 50) { s.ringing = false; s.ticks = 0; }
      if (s.ticks >= 5 && s.resT === 0 && ents.some((e) => raider(e, 32))) s.res = true;
      if (s.res) { if (s.resT < 40) s.resT++; else { ents.forEach((e) => { if (raider(e, 48)) e.rfx = (e.rfx || 0) + 60; }); s.res = false; } }
    },
  };
}
function lane(salt) {
  const r = stream(salt), bx = 10, by = 64, bz = -5, mode = salt % 3;   // 0 hand, 1 arrow, 2 redstone
  bes.clear();
  const ents = [];
  for (let i = 0; i < 2; i++) { const a = r() * 6.283, d = 20 + r() * 60; ents.push({ type: RT[Math.floor(r() * 6)], x: bx + .5 + Math.cos(a) * d, y: by + .5, z: bz + .5 + Math.sin(a) * d }); }
  for (let i = 0; i < 6; i++) { const a = r() * 6.283, d = r() * 50; ents.push({ type: 'villager', vbAge: 100 + i, x: bx + .5 + Math.cos(a) * d, y: by + .5, z: bz + .5 + Math.sin(a) * d }); }
  if (r() < .3) ents[0].dead = true;
  M.EntityList.list = ents;
  const R = ref(bx, by, bz, ents), side = SIDES[Math.floor(r() * 4)];
  M.VBBell.ring(bx, by, bz, side); R.activate();
  const be = bes.get(bx + ',' + by + ',' + bz);
  if (!be) return 'no bell entity';
  if (be.lastSideHit !== side) return `side ${be.lastSideHit} vs ${side}`;
  for (const e of ents) if (e.type === 'villager') {
    const near = (() => { const dx = e.x - (bx + .5), dy = e.y - (by + .5), dz = e.z - (bz + .5); return dx * dx + dy * dy + dz * dz < 1024; })();
    if (near !== (e.vbHeardBell === e.vbAge)) return `villager heard ${e.vbHeardBell} near=${near}`;
  }
  const rerings = mode === 1 ? [20] : mode === 2 ? [30] : [];
  for (let t = 1; t <= 130; t++) {
    if (rerings.includes(t)) { M.Bell.activate(bx, by, bz, side); R.activate(); }
    R.tick(); M.Bell.tick(be);
    const a = [be.ringing, be.ticks, be.resonateTime, be.resonating].join(), b = [R.s.ringing, R.s.ticks, R.s.resT, R.s.res].join();
    if (a !== b) return `tick ${t} state ${a} vs ref ${b}`;
  }
  for (const e of ents) {
    const g = (e.fx || []).reduce((n, f) => n + (f[0] === 'glowing' ? f[1] : 0), 0);
    if (g !== (e.rfx || 0)) return `${e.type} glow ${g} vs ${e.rfx || 0}`;
  }
  return null;
}
let glows = 0;
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `bell salt ${s}: ${r}`); if (M.EntityList.list.some((e) => e.rfx)) glows++; }
ok(glows > 5 && glows < 20, `salts exercise glow and no-glow (${glows} glowing)`);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const any = () => { for (let s = 0; s < 20; s++) if (lane(s)) return true; return false; };
{ const o = M.Effects.addStatusEffect; M.Effects.addStatusEffect = (e, id, d) => o(e, id, 100); brk(any(), 'glow duration 60 -> 100'); M.Effects.addStatusEffect = o; }
{ const o = M.Bell.isRaiderWithinRange; const t = M.Bell.tick; M.Bell.tick = (be) => { be.ticks >= 49 && (be.ticks = 49); t(be); if (be.ticks === 49 && be.ringing) be.ticks = 50; }; brk(any(), 'ring ends at 49 ticks'); M.Bell.tick = t; }
{ const o = M.VBBell.HEAR_DIST; M.VBBell.HEAR_DIST = 40; brk(any(), 'villager hearing radius 32 -> 40'); M.VBBell.HEAR_DIST = o; }
console.log(`lockstep-bell: ${21 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
