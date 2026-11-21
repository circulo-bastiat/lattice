#!/usr/bin/env node
// serverworldport11753check.mjs — #11753: src/02r_serverworld.js against .decomp/net/minecraft/server/world, and its reach into Main.worldTick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = f => readFileSync(join(ROOT, '.decomp/net/minecraft/', f), 'utf8');
const src = readFileSync(join(ROOT, 'src/02r_serverworld.js'), 'utf8');
const mainSrc = readFileSync(join(ROOT, 'src/17_main.js'), 'utf8');
const tt = rd('server/world/ChunkTicketType.java');
const truth = [...tt.matchAll(/ChunkTicketType<\w+> (\w+) = create\("(\w+)", [^;]*?(?:, (\d+))?\);/g)].map(m => [m[1], m[2], +(m[3] || 0)]);
const dts = rd('world/chunk/ChunkStatus.java').match(/DISTANCE_TO_STATUS = ImmutableList\.of\(([\s\S]*?)\);/)[1].split(',').map(s => s.trim()).filter(Boolean).length;
const lt = rd('server/world/ChunkHolder.java').match(/enum LevelType \{([^}]*)\}/)[1].split(';')[0].split(',').length;
function scenario(code, mainCode) { try { return scenario0(code, mainCode); } catch (e) { return ['threw: ' + e.message]; } }
function scenario0(code, mainCode) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const NS = {}; try { new Function('MCL', code)(NS); } catch (e) { return ['load: ' + e.message]; }
  const S = NS.ServerWorld, T = S.TicketTypes;
  chk(truth.length === 8, 'java ticket-type parse ' + truth.length);
  truth.forEach(([k, name, exp]) => chk(T[k] && T[k].name === name && T[k].getExpiryTicks() === exp, 'ticket type ' + k));
  chk(S.MAX_LEVEL === 33 + dts, 'MAX_LEVEL ' + S.MAX_LEVEL + ' vs 33+' + dts);
  chk(S.DISTANCE_TO_STATUS.length === dts, 'DISTANCE_TO_STATUS size');
  chk(S.NEARBY_PLAYER_TICKET_LEVEL === 31, 'nearby player level');
  chk(S.LevelType.length === lt, 'LevelType count');
  chk(S.getLevelType(31) === 'ENTITY_TICKING' && S.getLevelType(32) === 'TICKING' && S.getLevelType(33) === 'BORDER' && S.getLevelType(34) === 'INACCESSIBLE' && S.getLevelType(0) === 'ENTITY_TICKING', 'getLevelType');
  chk(S.getTargetStatusForLevel(32) === 'full' && S.getTargetStatusForLevel(34) === 'features' && S.getTargetStatusForLevel(37) === 'structure_starts', 'target status');
  chk(S.trackingFromLevelType('ENTITY_TICKING') === 'TICKING' && S.trackingFromLevelType('TICKING') === 'TRACKED' && S.trackingFromLevelType('BORDER') === 'TRACKED' && S.trackingFromLevelType('INACCESSIBLE') === 'HIDDEN', 'tracking status');
  // tickets
  const M = new S.ChunkTicketManager(), key = '0,0';
  M.addTicket(key, new S.ChunkTicket(T.PLAYER, 31, { x: 0, z: 0 }));
  M.addTicket(key, new S.ChunkTicket(T.POST_TELEPORT, 33, 7));
  chk(M.getLevelAt(key) === 31, 'best ticket level');
  chk(M.holders.get(key) && M.holders.get(key).getLevelType() === 'ENTITY_TICKING', 'holder created at level 31');
  for (let i = 0; i < 5; i++) M.purge();
  chk(M.tickets.get(key).a.length === 2, 'post_teleport still alive after 5 ticks');
  M.purge();
  chk(M.getLevelAt(key) === 31 && M.tickets.get(key).a.length === 1, 'post_teleport expires after 5 ticks, player stays');
  M.removeTicket(key, new S.ChunkTicket(T.PLAYER, 31, { x: 0, z: 0 }));
  chk(M.getLevelAt(key) === S.MAX_LEVEL + 1 && !M.holders.has(key), 'last ticket gone unloads');
  const a = new S.ChunkTicket(T.PLAYER, 31, { x: 0, z: 0 }), b = new S.ChunkTicket(T.START, 31, 0);
  chk(new S.ChunkTicket(T.PLAYER, 30, { x: 5, z: 5 }).compareTo(a) < 0 && a.compareTo(b) !== 0, 'ticket order');
  // queue
  const Q = new S.LevelPrioritizedQueue('q', 2);
  Q.add('hi', 'p1', 5); Q.add(null, 'p1', 5); Q.add('lo', 'p2', 20);
  let p = Q.poll();
  chk(p.length === 2 && p[0].left === 'hi' && typeof p[1].right === 'function', 'poll lowest level first, null = blocker');
  p[1].right(); chk(Q.getBlockingChunks().length === 1, 'blocking recorded');
  Q.updateLevel(20, 'p2', 3); chk(Q.first === 3, 'updateLevel moves');
  chk(Q.poll()[0].left === 'lo' && Q.poll() === null, 'drain');
  const Q2 = new S.LevelPrioritizedQueue('q2', 0); Q2.add('x', 'p', 1); chk(Q2.poll() === null, 'maxBlocking 0 blocks poll');
  // task system
  const actor = { name: 'a' }, sys = new S.ChunkTaskPrioritySystem([actor], 4), ran = [];
  sys.send(actor, S.ChunkTaskPrioritySystem.createMessage(() => ran.push('far'), 'a', () => 40));
  sys.send(actor, S.ChunkTaskPrioritySystem.createMessage(() => ran.push('near'), 'b', () => 2));
  sys.run(actor); chk(ran.join() === 'near,far', 'task system level order');
  let th = false; try { sys.getQueue({}); } catch (e) { th = true; } chk(th, 'unknown actor refused');
  // watching
  const W = new S.PlayerChunkWatchingManager(), pl = {};
  chk(W.isWatchInactive(pl) === true && W.isWatchDisabled(pl) === false, 'unknown player');
  W.add(0, pl, false); W.disableWatch(pl); chk(W.isWatchDisabled(pl) && W.getPlayersWatchingChunk(0).length === 1, 'disable'); W.enableWatch(pl); chk(!W.isWatchDisabled(pl), 'enable'); W.remove(0, pl); chk(!W.getPlayersWatchingChunk(0).length, 'remove');
  th = false; try { S.EntityTrackingListener({ getPlayer() {} }); } catch (e) { th = true; } chk(th, 'incomplete tracking listener refused');
  // entity manager
  const ev = [], E = new S.ServerEntityManager({ startTracking: e => ev.push('t+' + e.uuid), stopTracking: e => ev.push('t-' + e.uuid), startTicking: e => ev.push('k+' + e.uuid), stopTicking: e => ev.push('k-' + e.uuid) });
  const e1 = { uuid: 1, x: 0, y: 0, z: 0 }, pe = { uuid: 2, x: 0, y: 0, z: 0, isPlayer: true };
  E.addEntity(e1); E.addEntity(pe);
  chk(ev.join() === 't+2,k+2', 'player ticks in a hidden section, mob does not');
  chk(E.addEntity({ uuid: 1, x: 0, y: 0, z: 0 }) === false, 'duplicate uuid refused');
  E.updateTrackingStatus('0,0,0', 'TICKING'); chk(ev.slice(2).join() === 't+1,k+1', 'section goes ticking');
  e1.x = 32; E.updateEntityPosition(e1); chk(ev.slice(4).join() === 't-1,k-1', 'entity moves to hidden section');
  E.removeEntity(pe); chk(ev.slice(6).join() === 'k-2,t-2', 'remove stops ticking before tracking');
  // lighting
  const order = [], L = new S.ServerLightingProvider(() => order.push('light'));
  L.enqueue('POST_UPDATE', () => order.push('post')); L.enqueue('PRE_UPDATE', () => order.push('pre')); L.tick();
  chk(order.join() === 'pre,light,post', 'light stage order ' + order.join());
  // wiring
  chk(/NS\.ServerWorld\) NS\.ServerWorld\.tick\(\)/.test(mainCode), '17_main does not tick ServerWorld');
  return f;
}
const bad = scenario(src, mainSrc);
if (bad.length) { console.log('FAIL: ' + bad.join('; ')); process.exit(1); }
const breaks = [
  [s => s.replace("'post_teleport', cmpNum, 5", "'post_teleport', cmpNum, 6"), 'expiry'],
  [s => s.replace("SW.MAX_LEVEL = 33 + 13", "SW.MAX_LEVEL = 33 + 12"), 'max level'],
  [s => s.replace("33 - level + 1", "33 - level"), 'level type'],
  [s => s.replace("byDistanceFromFull(level - 33)", "byDistanceFromFull(level - 32)"), 'target status'],
  [s => s.replace("e !== 0 && age - this.tickCreated > e", "e !== 0 && age - this.tickCreated < e"), 'isExpired'],
  [s => s.replace("this.first = Math.min(this.first, level)", "this.first = level"), 'queue first level'],
  [s => s.replace("this.nBlocking >= this.maxBlocking ||", ""), 'maxBlocking'],
  [s => s.replace("e.isPlayer ? 'TICKING' : s", "s"), 'player status'],
  [s => s.replace("if (shouldTick(st)) this._stopTicking(e); if (shouldTrack(st)) this._stopTracking(e);", "if (shouldTrack(st)) this._stopTracking(e); if (shouldTick(st)) this._stopTicking(e);"), 'remove order'],
  [s => s.replace("if (p[i][0] === 'PRE_UPDATE') p[i][1]();\n    this.doLightUpdates();", "this.doLightUpdates();\n    for (i = 0; i < n; i++) if (p[i][0] === 'PRE_UPDATE') p[i][1]();"), 'light order'],
  [s => s.replace("this.watching.has(p) ? this.watching.get(p) : true", "false"), 'watch inactive default']
];
let caught = 0;
for (const [fn, why] of breaks) {
  const b = fn(src); if (b === src) { console.log('break did not apply: ' + why); process.exit(1); }
  if (scenario(b, mainSrc).length) caught++; else console.log('NOT caught: ' + why);
}
caught += scenario(src, mainSrc.replace('NS.ServerWorld.tick()', 'void 0')).length ? 1 : 0;
if (caught !== breaks.length + 1) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('PASS serverworldport11753check — ' + caught + ' breaks caught; 10 server/world classes ported');
