// lockstep-endgateway -- #7080 (G17-L217): lockstep scenario 'endgateway', 20 salts: cow, zombie, item and ender pearl walk/fall into an end_gateway with an ExitPortal.
// Reference = .decomp EndGatewayBlockEntity.serverTick/tryTeleportingEntity/startTeleportCooldown (age++, cooldown 100 then 40, random.nextInt(list) pick, 2400-tick self cooldown),
// exit = ExitPortal (exactTeleport) or best full cube +1. Per tick: age, cooldown, isRecentlyGenerated and every entity's exact doubles are compared.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07c_blockentity.js'], dom: false });
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const GX = 4, GY = 70, GZ = -3;
M.World = { TOP_Y: 256, getBlock: (x, y, z) => (y === 60 && Math.abs(x - 40) <= 6 && Math.abs(z - 40) <= 6 ? 1 : 0) };
const BE = M.BlockEntities;
let off = 0, cdOff = 0;
function lane(salt) {
  const r = stream(salt), exact = salt % 2 === 0, ex = 40, ey = 80, ez = 40;
  const mk = (type, t) => ({ type, x: GX + .1 + r() * .8, y: GY + 3 + r() * .5, z: GZ + .1 + r() * .8, vy: -0.08 - r() * .1, enter: 2 + Math.floor(r() * 60) + t });
  const ents = [mk('cow', 0), mk('zombie', 5), mk('item', 70), mk('ender_pearl', 130)];
  const rents = ents.map((e) => ({ ...e }));
  const be = { type: 'end_gateway', x: GX, y: GY, z: GZ, age: 0, teleportCooldown: 0, exitPortal: { x: ex, y: ey, z: ez }, exactTeleport: exact };
  const rs = { age: 0, cd: 0 };
  M.EntityList = { list: ents, random: stream(salt + 99) };
  const rr = stream(salt + 99);
  const step = (list, t) => list.forEach((e) => { if (t >= e.enter - 1 && e.y > GY + .2 && !e.done) { e.y = Math.max(GY + .2, e.y + e.vy); } else if (!e.done && t < e.enter - 1) { e.y = GY + 3; } });
  for (let t = 1; t <= 400; t++) {
    step(ents, t); step(rents, t);
    // reference serverTick
    const was = rs.cd > 0; rs.age++;
    if (was) rs.cd--; else {
      const inb = rents.filter((e) => !(e.pcd > 0) && e.x >= GX && e.x < GX + 1 && e.y >= GY && e.y < GY + 1 && e.z >= GZ && e.z < GZ + 1);
      if (inb.length) { rs.cd = 100; const e = inb[Math.floor(rr() * inb.length)]; e.pcd = 10; e.done = true; e.x = ex + .5; e.y = exact ? ey : 61; e.z = ez + .5; rs.cd = 40; }
      if (rs.age % 2400 === 0) rs.cd = 40;
    }
    BE.tickGateway(be);
    if (cdOff && be.teleportCooldown === 40) be.teleportCooldown = 40 + cdOff;
    if (off) ents.forEach((e) => { if (e.netherPortalCooldown > 0 && !e.shifted) { e.x += off; e.shifted = 1; } });
    ents.forEach((e, i) => { if (rents[i].done) e.done = true; });
    const a = [be.age, be.teleportCooldown, BE.gatewayRecentlyGenerated(be)].join(), b = [rs.age, rs.cd, rs.age < 200].join();
    if (a !== b) return `tick ${t} gateway ${a} vs ref ${b}`;
    for (let i = 0; i < ents.length; i++) {
      const p = [ents[i].x, ents[i].y, ents[i].z].join(), q = [rents[i].x, rents[i].y, rents[i].z].join();
      if (p !== q) return `tick ${t} ${ents[i].type} ${p} vs ref ${q}`;
    }
  }
  return rents.every((e) => e.done) ? null : 'not all entities teleported';
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `endgateway salt ${s}: ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const any = () => { for (let s = 0; s < 20; s++) if (lane(s)) return true; return false; };
cdOff = 1; brk(any(), 'teleport cooldown 40 -> 41'); cdOff = 0;
off = 1; brk(any(), 'exit offset moved by one block'); off = 0;
console.log(`lockstep-endgateway: ${21 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
