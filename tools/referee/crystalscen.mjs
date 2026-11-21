// crystalscen.mjs — #6082: an end_crystal hit (EndCrystalEntity.damage: remove, then createExplosion(null, x,y,z, 6.0F, DESTROY)
// unless the source is explosive) vs the real 1.18.2 server. Shared by runcrystal.mjs (server) and crystalrefcheck.mjs (engine).
// Scene: a flat dirt slab (half-width W, 3 deep) under open air, the crystal standing on it at the origin cell (0,0,0) (y = slab
// top), a bedrock-free read box of (2R+1)^3 cells around it, and two NoAI pigs at z = +3 and +8 on the slab. The hit is an arrow
// shot at the crystal along +x (server) / EC.damage with a non-explosive source (engine).
export const R = 5, W = 10, N = 100, ENGINE_N = 300;
export const PIGS = [{ tag: 'p3', dz: 3 }, { tag: 'p8', dz: 8 }];
export function readCells() {
  const out = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) out.push([x, y, z]);
  return out;
}
