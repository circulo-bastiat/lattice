#!/usr/bin/env node
// minecartaudit11581check.mjs — #11581: proves the 11 classes mapped to 07zzr_minecart.js through the module's real entry
// points (Mc.tick/damage/onActivatorRail/storageInteract/insideSound/commandExecute/detector*): DetectorRailBlock,
// MinecartInsideSoundInstance, Chest/Hopper/Minecart/SpawnerMinecartEntity, GenericContainerScreenHandler + HopperScreenHandler
// (the screen opened per cart type), ItemScatterer (inventory scattered on break), DataPool (weighted pick), CommandBlockExecutor.
// Each source break must fail its row.
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import fs from 'node:fs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, ...(patch ? { patch } : {}) });
  const R = M.Reg, B = M.Behave, Mc = M.Minecart, o = {};
  const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  const world = { getBlock: (x, y, z) => cells.get(k(x, y, z)) | 0, setBlock(x, y, z, id) { const old = cells.get(k(x, y, z)) | 0; cells.set(k(x, y, z), id); B.changed(x, y, z, old); return true; }, blockLightAt: () => 15 };
  B.init(world); M.Redstone.init(); Mc.world = world;
  const mk = (type, x = 0.5, y = 0, z = 0.5) => { const e = { id: 1, type, x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.98, height: 0.7, age: 0, removed: false, onGround: true, fallDistance: 0 }; Mc.init(e, {}); return e; };
  // DetectorRailBlock
  const det = R.realFirst[R.id.detector_rail] + R.defaultState[R.id.detector_rail];
  const stone = R.realFirst[R.id.stone] + R.defaultState[R.id.stone]; cells.set(k(0, -1, 0), stone); cells.set(k(0, 0, 0), det);
  const cart = mk('chest_minecart'); cart.inventory[0] = { item: 'apple', count: 1 };
  M.EntityList = { list: [cart], remove() {}, random: () => 0.5 };
  Mc.detectorUpdate(0, 0, 0);
  o.detPowers = B.propName(world.getBlock(0, 0, 0), 'powered') === 'true';
  o.detComparator = Mc.detectorComparator(0, 0, 0) === 1;
  cart.removed = true; Mc.detectorTick(0, 0, 0);
  o.detUnpowers = B.propName(world.getBlock(0, 0, 0), 'powered') === 'false';
  // MinecartInsideSoundInstance
  const voices = [];
  M.Sound = { loopVoice: (ev) => { const v = { ev, vol: -1, stopped: false, stop() { v.stopped = true; }, set(x) { v.vol = x; } }; voices.push(v); return v; } };
  const rc = mk('minecart'); rc.vx = 0.4; M.Player = { vehicle: rc, x: 0, y: 0, z: 0, eyeInWater: false };
  Mc.insideSound(rc);
  const [vi, vu] = voices;
  o.insideSound = voices.length === 2 && vi.ev === 'entity.minecart.inside' && vu.ev === 'entity.minecart.inside.underwater' && Math.abs(vi.vol - 0.3) < 1e-6 && vu.vol === 0;
  M.Player.eyeInWater = true; Mc.insideSound(rc);
  o.insideUnder = vi.vol === 0 && Math.abs(vu.vol - 0.3) < 1e-6;
  // MinecartEntity: activator ejects, ChestMinecart/HopperMinecart sizes
  const pl = { isPlayer: true, vehicle: null }; const mc = mk('minecart'); mc.cartPassengers = [pl]; pl.vehicle = mc;
  Mc.onActivatorRail(mc, true);
  o.mcEject = mc.cartPassengers.length === 0 && mc.cartWobbleStrength === 50;
  o.sizes = Mc.INVENTORY.chest_minecart === 27 && Mc.INVENTORY.hopper_minecart === 5 && mk('chest_minecart').inventory.length === 0;
  const hc = mk('hopper_minecart'); Mc.onActivatorRail(hc, true); const locked = hc.hopperEnabled === false; Mc.onActivatorRail(hc, false);
  o.hopperToggle = locked && hc.hopperEnabled === true;
  // SpawnerMinecartEntity + DataPool (weighted)
  const sp = mk('spawner_minecart');
  Mc.readSpawnerNbt(sp, { SpawnPotentials: [{ data: { entity: { id: 'minecraft:zombie' } }, weight: 1 }, { data: { entity: { id: 'minecraft:skeleton' } }, weight: 3 }], MinSpawnDelay: 5, MaxSpawnDelay: 9, SpawnCount: 2 });
  const L = sp.spawnerLogic;
  o.spawnerNbt = !!L && L.potentials.length === 2 && L.minDelay === 5 && L.maxDelay === 9 && L.count === 2;
  const w0 = M.wrand; const pick = (r) => { M.wrand = () => r; return Mc.pickPotential(L); };
  const a = pick(0.1), b = pick(0.9); M.wrand = w0;
  o.dataPool = a === 'zombie' && b === 'skeleton';
  o.spawnerWrite = Mc.writeSpawnerNbt(sp).SpawnPotentials.length === 2 && Mc.entityDataRequiresOperator('spawner_minecart') === true;
  // Generic/Hopper ScreenHandler: the opener per cart
  const opened = [];
  M.Hud = { openCartChest: (e) => { opened.push('chest'); return true; }, openCartHopper: (e) => { opened.push('hopper'); return true; } };
  Mc.storageInteract(mk('chest_minecart'), {}); Mc.storageInteract(mk('hopper_minecart'), {}); const none = Mc.storageInteract(mk('minecart'), {});
  o.screens = opened.join() === 'chest,hopper' && none === false;
  // ItemScatterer: inventory scattered on break, then emptied
  const drops = [];
  M.EntityList = { list: [], remove() {}, random: () => 0.5, dropStack: (x, y, z, item, n) => { drops.push(item + 'x' + n); } };
  const sc = mk('chest_minecart'); sc.inventory[0] = { item: 'cobblestone', count: 64 };
  Mc.dropItems(sc, {});
  o.scatterDrops = drops.filter((d) => d.startsWith('cobblestone')).reduce((s, d) => s + +d.split('x')[1], 0) === 64;
  o.scatterEmpty = sc.inventory.every((s) => !s);
  // CommandBlockExecutor
  const ran = [];
  M.Commands = { run: (cmd) => { ran.push(cmd); return { ok: true, result: 1, lines: ['done'] }; }, ruleGet: () => 'true' };
  M.Main = { ticks: 100 };
  const cb = mk('command_block_minecart'); cb.command = 'say hi';
  cb.age = 4; Mc.onActivatorRail(cb, true); const first = ran.length === 1 && cb.successCount === 1 && /done/.test(cb.lastOutput || '');
  cb.age = 6; M.Main.ticks = 101; Mc.onActivatorRail(cb, true); const limited = ran.length === 1;
  cb.age = 8; M.Main.ticks = 102; Mc.onActivatorRail(cb, true);
  o.commandExec = first && limited && ran.length === 2;
  return o;
}
const LBL = ['detPowers', 'detComparator', 'detUnpowers', 'insideSound', 'insideUnder', 'mcEject', 'sizes', 'hopperToggle', 'spawnerNbt', 'dataPool', 'spawnerWrite', 'screens', 'scatterDrops', 'scatterEmpty', 'commandExec'];
const base = trial(); 
for (const l of LBL) ok(base[l] === true, 'baseline row ' + l);
const SRC = fs.readFileSync(MCLITE_ROOT + 'src/07zzr_minecart.js', 'utf8');
const BR = [
  ['detPowers', /var now = Mc\.cartsIn\(x, y, z\)\.length > 0;/, 'var now = false;'],
  ['detComparator', /if \(Mc\.INVENTORY\[cs\[i\]\.type\] && cs\[i\]\.inventory\) return cartComparator\(cs\[i\]\);/, ''],
  ['detUnpowers', /if \(NS\.Behave\.propName\(st, 'powered'\) === 'true'\) Mc\.detectorUpdate\(x, y, z\);/, ''],
  ['insideSound', /\* 0\.75 : 0, sub/, '* 0.1 : 0, sub'],
  ['insideUnder', /vs\[0\]\.set\(sub \? 0 : v,/, 'vs[0].set(v,'],
  ['mcEject', /if \(hasPassengers\(e\)\) removeAllPassengers\(e\);/, ''],
  ['sizes', /Mc\.INVENTORY = \{ chest_minecart: 27,/, 'Mc.INVENTORY = { chest_minecart: 9,'],
  ['hopperToggle', /var en = !powered;/, 'var en = true;'],
  ['spawnerNbt', /if \(n\.MinSpawnDelay !== undefined\) \{/, 'if (false) {'],
  ['dataPool', /if \(r < 0\) return L\.potentials\[i\]\.id;/, 'return L.potentials[0].id;'],
  ['spawnerWrite', /return type === 'spawner_minecart' \|\| type === 'command_block_minecart';/, 'return false;'],
  ['screens', /\(hop \? NS\.Hud\.openCartHopper : NS\.Hud\.openCartChest\)/, 'NS.Hud.openCartChest'],
  ['scatterDrops', /EL\.dropStack\(px, py, pz, s\.item, n,/, 'EL.dropStack(px, py, pz, s.item, 0,'],
  ['scatterEmpty', /      inv\[i\] = null;\n/, ''],
  ['commandExec', /e\.age - e\.lastExecuted >= 4/, 'true'],
];
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, Bk;
  try { Bk = trial((f, s) => { const n = f === '07zzr_minecart.js' ? s.replace(re, rep) : s; if (n !== s) hit = true; return n; }); } catch (e) { Bk = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!Bk[key], 'anti-vacuity: break ' + key);
  if (!Bk[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `minecartaudit11581check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
