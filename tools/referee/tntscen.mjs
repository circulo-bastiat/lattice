// tntscen.mjs — the TNT referee pack's scenarios (infra I6, 25 Sept 2026), shared by runtnt.mjs (the real 1.18.2
// server) and tntrefcheck.mjs (the engine: 07za_explosion.js + 07zc_tnt.js).
//
// PART A — BLAST SHAPE (random: 1536 rays, each `power * (0.7 + random * 0.6)`, Explosion.collectBlocksAndDamageEntities).
// Per case the scene is rebuilt, ONE TNT entity is summoned with Fuse:1 (TntEntity.tick: --fuse <= 0 -> discard + explode
// at getBodyY(0.0625), power 4, DESTROY) and, one tick later, every cell of an R-radius box around it is read (air or not)
// and the dropped items' Count summed. N trials per case; the check compares PER-CELL destruction rates (binomial, pooled
// 5 sigma), the destroyed-count mean (4 SE) and the dropped-item mean (4 SE). The origin cell (where the TNT sits) is
// cleared on both sides before the blast.
//   cube:<m>   a solid (2R+3)^3 cube of <m>, one air cell at its centre, the TNT on that cell's floor (NoGravity)
//   water      a stone cube whose centre cell is a WATER SOURCE (the TNT sits in water: every ray starts in a cell whose
//              resistance is max(stone? no - water 100) -> nothing breaks; the "TNT under water" rule)
//   crater     a dirt slab (2R+3) wide, R+1 deep, the TNT standing on its top face in open air
//
// PART B — FUSE TIMELINE (tick-exact, the redstone pack's `#minecraft:tick` clock). S stations 16 blocks apart on a
// stone floor; at tick 1 each gets a redstone block beside a TNT block (TntBlock.neighborUpdate -> primeTnt: fuse 80, the
// entity at the block's x+0.5,y,z+0.5 with motion (-sin r*0.02, 0.2, -cos r*0.02)) and a second TNT block 3 cells
// away on the far side (TntBlock.onDestroyedByExplosion: fuse = random(80/4) + 80/8 = 10..29). Per tick and station:
// the primed-entity count, whether the second block still stands, and station 0's entity Y (x1000, the fall).
export const R = 5;                          // read radius: the box is (2R+1)^3 = 1331 cells
export const N = 100;                        // trials per blast case on the server
export const ENGINE_N = 300;                 // trials per blast case in the engine
export const BLAST = [
  { id: 'cube:dirt', kind: 'cube', block: 'dirt' },
  { id: 'cube:stone', kind: 'cube', block: 'stone' },
  { id: 'cube:oak_planks', kind: 'cube', block: 'oak_planks' },
  { id: 'cube:end_stone', kind: 'cube', block: 'end_stone' },
  { id: 'cube:glass', kind: 'cube', block: 'glass' },
  { id: 'water', kind: 'water', block: 'stone' },
  { id: 'crater', kind: 'crater', block: 'dirt' },
];
export const S = 40;                         // fuse stations
export const T = 120;                        // fuse timeline ticks (80 + up to 29 + slack)
export const PITCH = 16;

/** Cells of one blast scene relative to the TNT's own cell (0,0,0): [dx,dy,dz,block]; everything else is air. */
export function blastScene(c) {
  const H = R + 1, out = [];
  if (c.kind === 'cube' || c.kind === 'water') {
    for (let x = -H; x <= H; x++) for (let y = -H; y <= H; y++) for (let z = -H; z <= H; z++) {
      if (x === 0 && y === 0 && z === 0) { if (c.kind === 'water') out.push([0, 0, 0, 'water']); continue; }
      out.push([x, y, z, c.block]);
    }
  } else if (c.kind === 'crater') {
    for (let x = -H; x <= H; x++) for (let y = -H; y <= -1; y++) for (let z = -H; z <= H; z++) out.push([x, y, z, c.block]);
  }
  return out;
}

/** Read-box cell order: x outer, y, z inner, each -R..R. */
export function readCells() {
  const out = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) out.push([x, y, z]);
  return out;
}

/** Fuse station k, relative to its origin: the lit TNT at (0,0,0), redstone block at (-1,0,0), second TNT at (3,0,0). */
export const STATION = { lit: [0, 0, 0], power: [-1, 0, 0], second: [3, 0, 0] };
