// hitboxscen.mjs — #9197: MOBPROOF hitbox Probe walk, shared by runhitbox.mjs (the real 1.18.2 server) and mobproofhitbox.mjs (the engine).
// Per mob (whole roster (#9205 widened 30 to all 91), alphabetical): summon NoAI/NoGravity at SPAWN, probe the AABB; tp to MOVED, probe again.
// The AABB is read with entity selectors: `execute if entity @e[tag=..,x=X,y=Y,z=Z,dx=0,dy=0,dz=0]` is true iff the mob's box
// intersects the 1-block cube [X,X+1]x[Y,Y+1]x[Z,Z+1]. A face is located by one cube just inside it (true) and one just outside (false).
export const COUNT = 100, EPS = 0.001;
export const ALIAS = { fish: 'cod' };                      // roster rows that are not their own EntityType
export const SKIP = new Set(['llama_decor', 'player', 'player_slim']);   // not summonable
export const first = (roster) => roster.filter((m) => !SKIP.has(m)).sort().slice(0, COUNT);
export const origin = (i) => ({ x: 8 + 16 * i, y: -60, z: 104 });
export const MOVE = { x: 3.5, y: 0.25, z: -2.75 };       // tp delta
/** the 12 probes of a box centred (cx,cy,cz) with the given width/height: [axis, side, inside?, selectorXYZ] */
export function probes(cx, cy, cz, w, h) {
  const hw = w / 2, out = [], lo = [cx - hw, cy, cz - hw], hi = [cx + hw, cy + h, cz + hw], mid = [cx - 0.5, cy + h / 2 - 0.5, cz - 0.5];
  for (let a = 0; a < 3; a++) for (const [side, edge, shift] of [['max', hi[a], 0], ['min', lo[a], -1]]) for (const inside of [true, false]) {
    const p = mid.slice(); p[a] = edge + shift + (side === 'max' ? (inside ? -EPS : EPS) : (inside ? EPS : -EPS));
    out.push({ axis: 'xyz'[a], side, inside, at: p });
  }
  return out;
}
export const fmt = (n) => n.toFixed(4);
