// xporbscen.mjs — #6086: XP ORB attraction / pickup / merge scenes (ExperienceOrbEntity.tick), shared by runxporb.mjs
// (real 1.18.2 server) and xporbrefcheck.mjs (engine). One lane per scene (z = k * PITCH), stone floor at local y=-1.
// Orbs are `summon`ed at tick 1 at local (0.5, 3, 0.5 + dz); a growbot player stands at local x = PX (or 40 = "far").
// Clock (as motionscen): k = 1: summon -> sample (log[k-1]) -> player step (moving) -> one world tick.
export const T = 100;
export const PITCH = 24;
export const SCALE = 10000;
export const FLOOR = -60;
const orbs = (n, value, dz = 0) => Array.from({ length: n }, () => ({ value, pos: [0.5, 3, 0.5 + dz] }));
export const SCENES = [
  { id: 'stand', mode: 'survival', px: 4.5, orbs: orbs(1, 3) },
  { id: 'creative', mode: 'creative', px: 4.5, orbs: orbs(1, 3) },
  { id: 'moving', mode: 'survival', px: 4.5, step: 0.15, orbs: orbs(1, 3) },
  // ids 40 apart merge (isMergeable, `(getId() - seed) % 40 == 0`): orb 1 and orb 41 of a same-spot batch
  { id: 'merge41', mode: 'survival', px: 40.5, orbs: orbs(41, 1) },
  { id: 'ten_by_3', mode: 'survival', px: 4.5, orbs: orbs(10, 3) },
  { id: 'far', mode: 'survival', px: 40.5, orbs: orbs(1, 3) },
];
export const PROBES = ['n', 'cnt', 'x', 'y', 'z', 'xp'];
export const origin = (k) => ({ x: 0, y: FLOOR, z: k * PITCH });
