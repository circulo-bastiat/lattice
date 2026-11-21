#!/usr/bin/env node
// worldstate11769check.mjs — #11769: src/02q_worldstate.js (net/minecraft/world ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const nbt = readFileSync(ROOT + 'src/02n_nbt.js', 'utf8');
const src = readFileSync(ROOT + 'src/02q_worldstate.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', 'NS', nbt + '\n' + code + '\n')(M, M); return M; }
function scenario(M) {
  const W = M.WorldState, N = M.Nbt, f = [], chk = (c, m) => { if (!c) f.push(m); };
  const mem = () => { const m = new Map(); return { m, has: (k) => m.has(k), read: (k) => m.get(k), write: (k, v) => m.set(k, v) }; };
  // persistent states round trip through a manager
  const st = mem(), mgr = new W.PersistentStateManager(st);
  const ids = mgr.getOrCreate(W.IdCountsState.fromNbt, () => new W.IdCountsState(), 'idcounts');
  chk(ids.getNextMapId() === 0 && ids.getNextMapId() === 1 && ids.isDirty(), 'map ids start at 0');
  const fc = mgr.getOrCreate(W.ForcedChunkState.fromNbt, () => new W.ForcedChunkState(), 'chunks');
  fc.getChunks().add(W.ChunkPos.toLong(-3, 7)); fc.markDirty();
  const cu = mgr.getOrCreate(W.ChunkUpdateState.fromNbt, () => new W.ChunkUpdateState(), 'features');
  cu.add(5n); cu.add(6n); cu.markResolved(5n); cu.markDirty();
  mgr.save();
  chk(!ids.isDirty() && st.m.has('idcounts') && st.m.has('chunks'), 'save clears dirty and writes');
  const mgr2 = new W.PersistentStateManager(st);
  const ids2 = mgr2.get(W.IdCountsState.fromNbt, 'idcounts');
  chk(ids2 && ids2.getNextMapId() === 2, 'idcounts reload continues at 2');
  chk(mgr2.get(W.ForcedChunkState.fromNbt, 'chunks').getChunks().has(W.ChunkPos.toLong(-3, 7)), 'forced chunk reload');
  const cu2 = mgr2.get(W.ChunkUpdateState.fromNbt, 'features');
  chk(cu2.contains(5n) && !cu2.isRemaining(5n) && cu2.isRemaining(6n), 'chunk update state');
  chk(mgr2.get(W.IdCountsState.fromNbt, 'nope') === null, 'missing state is null');
  const clean = new W.IdCountsState(); const st2 = mem(); clean.save(st2, 'x'); chk(st2.m.size === 0, 'clean state is not written');
  // chunk long packing
  const l = W.ChunkPos.toLong(-1, 2); chk(W.ChunkPos.x(l) === -1 && W.ChunkPos.z(l) === 2, 'chunkpos pack');
  const s = W.ChunkSectionPos.asLong(-5, -4, 9); chk(W.ChunkSectionPos.unpackX(s) === -5 && W.ChunkSectionPos.unpackY(s) === -4 && W.ChunkSectionPos.unpackZ(s) === 9, 'section pack');
  chk(W.ChunkSectionPos.unpackY(W.ChunkSectionPos.offset(s, 1, 1, -1)) === -3 && W.ChunkSectionPos.unpackX(W.ChunkSectionPos.offset(s, 1, 1, -1)) === -4 && W.ChunkSectionPos.unpackZ(W.ChunkSectionPos.offset(s, 1, 1, -1)) === 8, 'section offset');
  // simulation distance: a ticket of level 31 spreads +1 per chunk to level 33
  const sim = new W.SimulationDistanceLevelPropagator(), c0 = W.ChunkPos.toLong(0, 0);
  const tk = W.ChunkTicket('player', 31, 0);
  sim.add(c0, tk); sim.updateLevels();
  chk(sim.getLevel(c0) === 31 && sim.getLevel(W.ChunkPos.toLong(1, 1)) === 32 && sim.getLevel(W.ChunkPos.toLong(2, -2)) === 33 && sim.getLevel(W.ChunkPos.toLong(3, 0)) === 33, 'ticket spread (square distance)');
  chk(sim.getTickingTicket(c0) === 'player/31' && sim.getTickingTicket(1n) === 'no_ticket', 'ticking ticket');
  const tk2 = W.ChunkTicket('x', 33, 1); sim.add(W.ChunkPos.toLong(1, 0), tk2); sim.updateLevels();
  chk(sim.getLevel(W.ChunkPos.toLong(1, 0)) === 32, 'weaker ticket keeps lower level');
  sim.remove(c0, tk); sim.updateLevels();
  chk(sim.getLevel(c0) === 33 && sim.getLevel(W.ChunkPos.toLong(1, 0)) === 33 && sim.getLevel(W.ChunkPos.toLong(1, 1)) === 33, 'removal raises levels ' + sim.getLevel(c0) + sim.getLevel(W.ChunkPos.toLong(1, 0)));
  sim.add(c0, W.ChunkTicket('player', 31, 0)); sim.updateLevels(); sim.updatePlayerTickets(30); sim.updateLevels();
  chk(sim.getLevel(c0) === 30, 'player tickets retargeted');
  // section propagator
  const sec = new W.SectionDistanceLevelPropagator(8);
  sec.getInitialLevel = (id) => id === W.ChunkSectionPos.asLong(0, 0, 0) ? 0 : 7;
  const lv = new Map(); sec.getLevel = (id) => lv.has(id) ? lv.get(id) : 7; sec.setLevel = (id, v) => lv.set(id, v);
  sec.update(W.ChunkSectionPos.asLong(0, 0, 0), 0, true); sec.applyPendingUpdates(100000);
  chk(sec.getLevel(W.ChunkSectionPos.asLong(1, 1, 1)) === 1 && sec.getLevel(W.ChunkSectionPos.asLong(0, 0, 3)) === 3 && !sec.hasPendingUpdates(), 'section spread');
  sec.getInitialLevel = () => 7; sec.update(W.ChunkSectionPos.asLong(0, 0, 0), 7, false); sec.applyPendingUpdates(100000);
  chk(sec.getLevel(W.ChunkSectionPos.asLong(0, 0, 0)) === 7 && sec.getLevel(W.ChunkSectionPos.asLong(0, 0, 2)) === 7, 'section removal');
  let th = false; try { new W.SectionDistanceLevelPropagator(254); } catch (e) { th = true; } chk(th, 'level count limit');
  // constants
  chk(W.YLevels.OVERWORLD_MIN_Y === -64 && W.YLevels.NETHER_LOGICAL_HEIGHT === 128 && W.YLevels.END_LOGICAL_HEIGHT === 256, 'ylevels');
  // mob spawner entry
  const e0 = W.MobSpawnerEntry(); chk(N.get(e0.getNbt(), 'id').value === 'minecraft:pig', 'default pig');
  const ec = N.compound(); N.put(ec, 'id', N.string('zombie')); chk(N.get(W.MobSpawnerEntry(ec).getNbt(), 'id').value === 'minecraft:zombie', 'id normalised');
  const eb = N.compound(); N.put(eb, 'id', N.string('Bad Id!')); chk(N.get(W.MobSpawnerEntry(eb).getNbt(), 'id').value === 'minecraft:pig', 'bad id falls back to pig');
  chk(W.MobSpawnerEntry.validateRange([0, 15]) && !W.MobSpawnerEntry.validateRange([0, 16]), 'spawn rule range');
  // timers
  const calls = []; const server = { getFunction: (n) => n === 'a:f' ? 'F' : null, execute: (x) => calls.push(x), getTag: (n) => ['T1', 'T2'] };
  const ser = W.TimerCallbackSerializer.INSTANCE;
  const c1 = ser.deserialize(ser.serialize(W.FunctionTimerCallback('a:f'))), c2 = ser.deserialize(ser.serialize(W.FunctionTagTimerCallback('a:t')));
  c1.call(server); W.FunctionTimerCallback('a:none').call(server); c2.call(server);
  chk(calls.join() === 'F,T1,T2', 'callbacks ' + calls.join());
  chk(N.get(ser.serialize(c2), 'Type').value === 'minecraft:function_tag', 'type tag');
  const bad = N.compound(); N.put(bad, 'Type', N.string('minecraft:nope')); chk(ser.deserialize(bad) === null, 'unknown callback type');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const cuts = [
  (s) => s.replace("lvl + 1; };\n  CPD.prototype.updateChunkLevel", "lvl + 2; };\n  CPD.prototype.updateChunkLevel"),
  (s) => s.replace("var v = (this.idCounts.has('map') ? this.idCounts.get('map') : -1) + 1", "var v = (this.idCounts.has('map') ? this.idCounts.get('map') : 0) + 1"),
  (s) => s.replace("if (!this.isDirty()) return;", ""),
  (s) => s.replace("this.setDirty(false);\n  };", "};"),
  (s) => s.replace("this.all.add(l); this.remaining.add(l);", "this.all.add(l);"),
  (s) => s.replace("this.remaining.delete(l);", ""),
  (s) => s.replace("if (v > 33) this.levels.delete(l)", "if (v > 31) this.levels.delete(l)"),
  (s) => s.replace("return v === undefined ? 33 : v; };", "return v === undefined ? 34 : v; };"),
  (s) => s.replace("if (tk.level < old) this.updateChunkLevel", "if (false) this.updateChunkLevel"),
  (s) => s.replace("this.updateChunkLevel(l, topLevel(t), false);", ""),
  (s) => s.replace("x.type === 'player'", "x.type === 'nope'"),
  (s) => s.replace("if (levelCount >= 254)", "if (levelCount >= 999)"),
  (s) => s.replace("var n = CP.toLong(x + dx, z + dz); if (n !== l) this.propagateLevel4", "var n = CP.toLong(x + dx, z + dz); if (n === l) this.propagateLevel4"),
  (s) => s.replace("if (best === 0) return best; }\n    }\n    return best;\n  };\n  SDL.prototype.getProp", "}\n    }\n    return best + 1;\n  };\n  SDL.prototype.getProp"),
  (s) => s.replace("SP.unpackY(l) + dy", "SP.unpackY(l) - dy"),
  (s) => s.replace("BigInt.asIntN(20, l)", "BigInt.asUintN(20, l)"),
  (s) => s.replace("'minecraft:' + cb.kind", "'' + cb.kind"),
  (s) => s.replace("if (f) server.execute(f);", "server.execute(f);"),
  (s) => s.replace("server.getTag(name).forEach(function (f) { server.execute(f); });", "server.getTag(name).slice(0, 1).forEach(function (f) { server.execute(f); });"),
  (s) => s.replace("if (!ctor) return null;", ""),
  (s) => s.replace("'minecraft:pig';\n    if (!id", "'minecraft:cow';\n    if (!id"),
  (s) => s.replace("r[0] >= 0 && r[1] <= 15", "r[0] >= 0 && r[1] <= 16"),
  (s) => s.replace("NETHER_LOGICAL_HEIGHT: 128", "NETHER_LOGICAL_HEIGHT: 256"),
  (s) => s.replace("if (this.store.has(name)) return", "if (false) return"),
];
let caught = 0;
cuts.forEach((cut, i) => {
  const mut = cut(src);
  if (mut === src) { console.log('FAIL cut ' + i + ' did not change the source'); process.exit(1); }
  let bad; try { bad = scenario(load(mut)).length > 0; } catch (e) { bad = true; }
  if (bad) caught++; else { console.log('FAIL cut ' + i + ' not caught'); process.exit(1); }
});
console.log("PASS worldstate11769check — " + caught + " breaks caught");
