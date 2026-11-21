// raidscen.mjs — infra W (25 Sept 2026): scenarios for the RAID pack (wave composition per
// difficulty) vs the real 1.18.2 server. `/raid start <omenlvl>` (RaidCommand.executeStart,
// .decomp `RaidCommand.java:113-131`) calls the SAME `RaidManager.startRaid(ServerPlayerEntity)`
// the real Bad-Omen-near-a-POI path calls (`StatusEffects.java:104-105`) — and when the player
// has zero occupied POIs within 64 blocks (`RaidManager.java:88-107`), `$$8` (the raid center)
// falls back to the player's own block pos outright, no POI/village/worldgen needed at all. So
// every rep here is: teleport the growbot to a fresh flat-world spot (far enough apart that
// `ServerWorld.getRaidAt`'s own 96-block reuse radius — `Rd.RAID_REUSE_DIST_SQ`, engine-side —
// never merges two reps into one raid), then `execute as <bot> run raid start <omenlvl>`.
//
// waveCount is NOT read off the server per rep — `Raid.getMaxWaves` (.decomp
// `Raid.java:764-774`) is a per-difficulty CONSTANT (3/5/7), not runtime data, so it is asserted
// directly against the engine's `Rd.MAX_WAVES` table in raidrefcheck.mjs, the same way this
// pack treats `Raid.Member`'s per-wave count arrays as constants to diff line-for-line rather
// than something to "measure" 100 times.
export const SCEN = [
  { id: 'easy_omen1', difficulty: 'easy', omenLevel: 1, waveCount: 3, extraWave: false, reps: 3 },
  { id: 'normal_omen1', difficulty: 'normal', omenLevel: 1, waveCount: 5, extraWave: false, reps: 3 },
  { id: 'hard_omen1', difficulty: 'hard', omenLevel: 1, waveCount: 7, extraWave: false, reps: 2 },
  // Bad Omen II (or higher) -- `Raid.hasExtraWave` (badOmenLevel > 1, .decomp `Raid.java:423-425`,
  // engine `Rd.hasExtraWave`) -- one extra group after the final wave, reusing the final wave's
  // own Member counts (`Raid.getCount`'s `isExtraWave` branch, engine `Rd.getCount`).
  { id: 'normal_omen2', difficulty: 'normal', omenLevel: 2, waveCount: 5, extraWave: true, reps: 2 },
];

// Raider types this pack counts every wave (ravager riders -- pillager/evoker/vindicator on the
// hard-wave ravager -- are counted the SAME way, by their own entity type, since
// `Raid.spawnNextWave` gives the rider the SAME `Wave` tag as its mount, .decomp
// `Raid.java:519` / engine `Rd.spawnNextWave`'s rider block).
export const RAIDER_TYPES = ['pillager', 'vindicator', 'ravager', 'witch', 'evoker'];
