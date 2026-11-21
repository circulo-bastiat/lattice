#!/usr/bin/env node
// endgatewaycheck.mjs -- #5576: EndGatewayBlockEntity (age, cooldown-gated teleport, synced event, save round-trip).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js'], dom: false });
initRegistry(M);
const BE = M.BlockEntities; BE.init();
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(noCooldown) {
  const f = []; const chk = (c, m) => { if (!c) f.push(m); };
  BE.ready = true;
  const e = BE.create(10, 70, 10, 'end_gateway');
  chk(e && e.age === 0, 'created with age 0');
  e.exitPortal = { x: 100, y: 60, z: 100 }; e.exactTeleport = true;
  const mk = () => ({ x: 10.5, y: 70.2, z: 10.5, dead: false });
  let ents = [mk()];
  BE.gateway.entities = () => ents.filter(o => o.x === 10.5);
  BE.gateway.events.length = 0;
  const a = ents[0];
  BE.tickGateway(e);
  chk(Math.abs(a.x - 100.5) < 1e-9 && a.y === 60, 'first entity teleported to exit');
  chk(e.teleportCooldown === 40 || noCooldown, 'cooldown 40 after teleport (startTeleportCooldown)');
  if (noCooldown) e.teleportCooldown = 0;
  const b = mk(); ents.push(b);
  for (let i = 0; i < 39; i++) BE.tickGateway(e);
  chk(b.x === 10.5, 'second entity within 40 ticks NOT teleported');
  chk(BE.gateway.events.length === 1 && BE.gateway.events[0].type === 1, 'synced event 1 fired once');
  const r = BE.serializeAll().find(x => x.type === 'end_gateway');
  chk(r && r.age === e.age && r.exitPortal.x === 100 && r.exactTeleport === true, 'Age/ExitPortal/Exact serialize');
  BE.remove(10, 70, 10);
  BE.restoreAll([JSON.parse(JSON.stringify(r))]);
  const e2 = BE.get(10, 70, 10);
  chk(e2 && e2.age === e.age && e2.exitPortal.z === 100 && e2.exactTeleport, 'round-trip through save');
  BE.remove(10, 70, 10);
  return f;
}
{ const f = run(false); f.forEach(m => fails.push(m)); pass += f.length ? 0 : 1; }
// anti-vacuity: stripping the cooldown must make the double-teleport assertion fail
const orig = BE.gatewayStartCooldown;
const saved = BE.gatewayTeleport;
BE.gatewayTeleport = function (e, ent) { const r = saved(e, ent); e.teleportCooldown = 0; return r; };
const broke = run(true).some(m => /second entity/.test(m));
BE.gatewayTeleport = saved;
let breaks = 0; if (broke) breaks++; else fails.push('anti-vacuity: removing cooldown not caught');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `endgatewaycheck: ${pass} passed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
