// despawnscen.mjs — infra I6 (s149): the DESPAWN pack's lanes, shared by rundespawn.mjs (the real
// 1.18.2 server) and despawnrefcheck.mjs (the engine). Every lane is a sealed 1-wide, 3-tall stone
// tunnel along z (z -4..4) at x = D (distance from the player along x), lanes stacked 4 blocks apart
// in y; night, no sky light inside, block light 0 unless `light` puts light blocks at eye height.
// PER lane PER round: N un-persistent /summon'ed mobs; survivors counted at the CHECKPOINTS.
// The question: MobEntity.checkDespawn (.decomp MobEntity.java:655-683) — the 128 instant band,
// the 32 no-despawn band, the >600 idle gate + 1/800 roll, HostileEntity's +2 in light > 0.5
// (HostileEntity.java:43-48), RaiderEntity's +2 always, and which kinds never despawn.
export const PLAYER = { x: 0.5, y: -6, z: 0.5 };
export const N = 12;
export const ROUNDS = 3;
export const CHECKPOINTS = [5, 300, 700, 1000, 1300, 1600];
// no iron_golem: 1.4 wide in a 1-wide tunnel it suffocates (seen: 36 -> 4 by t1000), which is the harness, not despawning.
const MOBS = ['zombie', 'skeleton', 'pillager', 'cow', 'chicken', 'villager', 'bat'];
// the i-th mob's z: cell centres -3.5..4.5 — a mob wider than 0.1 placed at 4.75 overlapped the z=5 wall and
// suffocated (one death per lane per round, and every hurt resets despawnCounter).
export const zOf = (i) => -3.5 + (i * 8) / (N - 1);
export const LANES = [];
for (const D of [20, 48, 140]) {
  const list = MOBS.map((mob) => ({ mob, light: 0 }));
  if (D === 48) list.push({ mob: 'zombie', light: 12 }, { mob: 'zombie', light: 11 });   // the > 0.5 brightness edge
  list.forEach((l, k) => LANES.push({ id: `${l.mob}${l.light ? '_L' + l.light : ''}@${D}`, mob: l.mob, light: l.light, D, y0: -24 + 4 * k }));
}
