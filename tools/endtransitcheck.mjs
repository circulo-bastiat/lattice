#!/usr/bin/env node
// endtransitcheck.mjs - #10976 (G27b): the End portal block moves the live player (EndPortalBlock.onEntityCollision ->
// ServerPlayerEntity.moveToWorld), builds the End spawn platform, and the first exit shows the credits then respawns.
// Anti-vacuity: each rule is broken in a patched copy of src/07zzs_portal.js and must be caught ("<n> breaks caught").
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/07zzs_portal.js', import.meta.url), 'utf8');
const mk = (patch) => {
  const M = loadEngine({ extra: ['07_world.js', '07zzs_portal.js'], dom: false, patch: (f, t) => (f === '07zzs_portal.js' && patch ? patch(t) : t) });
  const W = M.World; W.init(1);
  const gen = (d) => { W.setDimension(d); for (let cx = -1; cx <= 7; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.getOrCreate(cx, cz); c.state = 3; } };
  gen('the_end'); gen('overworld');
  return M;
};
const verdict = (patch) => {
  const bad = [], M = mk(patch), W = M.World, P = M.Portal, S = M.States, obs = S.stateOf('obsidian');
  if (!P.liveEndWorld || !P.endTransit || !P.endPortalContact) return ['live API missing'];
  const p = { type: 'player', x: 5.5, y: 70, z: 5.5, width: 0.6, height: 1.8, seenCredits: false };
  M.Player = p;
  let credits = 0; P.onCredits = () => credits++;
  const near = { ...p, y: 69.9 };
  // box above the 0.75 top: not in shape
  p.y = 70.8; P.endPortalContact(p, 5, 70, 5); if (W.dimension !== 'overworld') bad.push('above the 12/16 top must not teleport');
  p.y = 70.2; P.endPortalContact(p, 5, 70, 5);
  if (W.dimension !== 'the_end') bad.push('overworld portal -> the_end, got ' + W.dimension);
  if (p.x !== 100.5 || p.y !== 50 || p.z !== 0.5) bad.push('arrival at END_SPAWN_POS centre: ' + [p.x, p.y, p.z]);
  if (W.getBlock(100, 48, 0) !== obs || W.getBlock(102, 48, -2) !== obs || W.getBlock(103, 48, 0) === obs) bad.push('platform floor 5x5 at y48');
  if (W.getBlock(100, 49, 0) !== 0 || W.getBlock(100, 51, 0) !== 0) bad.push('platform air above');
  if (p.yaw !== 90 || p.pYaw !== 90) bad.push('getTeleportTarget end branch rotation 90: ' + p.yaw);
  // riding entity is not moved
  const rider = { ...p, vehicle: {}, x: 100.5, y: 50, z: 0.5 };
  if (P.onEndPortalCollision(rider, { dimension: 'the_end', inShape: true, moveToWorld() {} })) bad.push('vehicle blocks');
  // first exit: credits once, respawn at the world-spawn column in the overworld
  p._sbLast = { stale: 1 };
  P.endPortalContact(p, 100, 50, 0);
  if (p._sbLast !== null) bad.push('PlayerManager.respawnPlayer(alive=true) resets _sbLast');
  if (p.y !== 64) bad.push('TeleportTarget y = max(height+1, 64): ' + p.y);
  if (W.dimension !== 'overworld') bad.push('the_end portal -> overworld');
  if (credits !== 1 || !p.seenCredits) bad.push('first exit shows credits once: ' + credits);
  if (p.x !== 0.5 || p.z !== 0.5) bad.push('exit lands at world spawn column: ' + [p.x, p.z]);
  // second round trip: no credits again
  p.x = 5.5; p.y = 70.2; p.z = 5.5; P.endPortalContact(p, 5, 70, 5);
  p.y = 50; P.endPortalContact(p, 100, 50, 0);
  if (credits !== 1) bad.push('credits only once, got ' + credits);
  // respawn point (bed/anchor) wins over the world-spawn column on End exit
  M.Sleep = { respawnPos: () => ({ x: 7.5, y: 80, z: 9.5 }) };
  p.x = 5.5; p.y = 70.2; p.z = 5.5; P.endPortalContact(p, 5, 70, 5);
  p.y = 50; P.endPortalContact(p, 100, 50, 0);
  if (p.x !== 7.5 || p.y !== 80 || p.z !== 9.5) bad.push('End exit uses respawnPos: ' + [p.x, p.y, p.z]);
  delete M.Sleep;
  // ungenerated platform chunk -> pending, then retried
  const W2 = W; W2.setDimension('the_end'); W2.chunks.delete(W2.key(6, 0)); W2.setDimension('overworld');
  p.x = 5.5; p.y = 70.2; p.z = 5.5; P.endPortalContact(p, 5, 70, 5);
  if (!P.endPlatformPending) bad.push('missing chunk leaves platform pending');
  W2.getOrCreate(6, 0).state = 3; P.tickEndPending();
  if (P.endPlatformPending || W.getBlock(102, 48, 0) !== obs) bad.push('pending platform completes once the chunk exists');
  return bad;
};
const base = verdict(null);
if (base.length) { console.log('endtransitcheck FAIL\n  ' + base.join('\n  ')); process.exit(1); }
const BREAKS = [
  ['dim target swapped', (t) => t.replace("ctx.dimension === 'the_end' ? 'overworld' : 'the_end'", "ctx.dimension === 'the_end' ? 'the_end' : 'overworld'")],
  ['no credits flag', (t) => t.replace('p.seenCredits = true;', '')],
  ['credits every time', (t) => t.replace('var first = !p.seenCredits;', 'var first = true;')],
  ['shape ignored', (t) => t.replace('e.y < by + 0.75', 'e.y < by + 5')],
  ['platform skipped', (t) => t.replace("if (to === 'the_end') {\n      Wd.setDimension('the_end'); p.dimension = 'the_end';\n      var W = P.liveEndWorld(); P.createEndSpawnPlatform(W);", "if (to === 'the_end') {\n      Wd.setDimension('the_end'); p.dimension = 'the_end';\n      var W = P.liveEndWorld();")],
  ['pending never retried', (t) => t.replace('P.endPlatformPending = false;\n  };', ';\n  };')],
  ['no rotation 90', (t) => t.replace('p.yaw = 90; p.pYaw = 90;', '')],
  ['_sbLast kept on respawn', (t) => t.replace('p._sbLast = null;', '')],
  ['respawn pos ignored', (t) => t.replace('if (sp) {', 'if (false) {')],
  ['target y no floor', (t) => t.replace('Math.max(NS.World.heightAt(x, z) + 1, 64)', 'NS.World.heightAt(x, z) + 1')],
  ['target x not centred', (t) => t.replace('x: spawn.x + 0.5', 'x: spawn.x')],
  ['wrong spawn x', (t) => t.replace('P.END_SPAWN_POS = { x: 100,', 'P.END_SPAWN_POS = { x: 99,')],
];
let caught = 0;
for (const [n, f] of BREAKS) {
  const t = f(SRC); let r;
  if (t === SRC) { console.log('  break "' + n + '" did not apply'); continue; }
  try { r = verdict((x) => f(x)); } catch (e) { r = ['threw']; }
  if (r.length) caught++; else console.log('  NOT caught: ' + n);
}
console.log('endtransitcheck: ' + (caught === BREAKS.length ? 'OK' : 'FAIL') + ' - ' + caught + ' breaks caught');
process.exit(caught === BREAKS.length ? 0 : 1);
