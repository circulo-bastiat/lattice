// tools/chunkstatus-steps.mjs - #9258 (C2ME-4a): vanilla 1.18.2 ChunkStatus steps as data. radius = the constructor's taskMargin (-1 for empty).
// engine = the src/ file that implements the step today, or 'none' where it is folded into another (see note).
export const STEPS = [
  { name: 'empty', radius: -1, engine: 'none', note: 'no work' },
  { name: 'structure_starts', radius: 0, engine: 'src/04r_structures.js' },
  { name: 'structure_references', radius: 8, engine: 'none', note: 'folded: startsOfRegion looks regions up on demand' },
  { name: 'biomes', radius: 8, engine: 'src/04g_biomes.js' },
  { name: 'noise', radius: 8, engine: 'src/04_worldgen.js' },
  { name: 'surface', radius: 8, engine: 'src/04h_surface.js' },
  { name: 'carvers', radius: 8, engine: 'src/04i_carvers.js' },
  { name: 'liquid_carvers', radius: 8, engine: 'none', note: 'folded into carvers (aquifer/lava level in 04i)' },
  { name: 'features', radius: 8, engine: 'src/04j_features.js' },
  { name: 'light', radius: 1, engine: 'src/04_worldgen.js' },
  { name: 'spawn', radius: 0, engine: 'none', note: 'runtime spawning, not worldgen' },
  { name: 'heightmaps', radius: 0, engine: 'src/04j_features.js' },
  { name: 'full', radius: 0, engine: 'none', note: 'status bump only' },
];
