// reinfscen.mjs — the ZOMBIE REINFORCEMENTS referee pack's scenes (infra I6, s152, 25 Sept 2026), shared by runreinf.mjs
// (the real 1.18.2 server) and reinfrefcheck.mjs (the engine).
// What it measures: ONE fist blow from a survival player on a NoAI caller (max health 100, spawn_reinforcements base set via
// NBT), 2 blocks +z of the player, inside a stone-ROOFED 85x85 flat arena (dark: sky blocked, no block light) — then the
// zombies/husks that appear (count, TYPE, horizontal distance from the caller) and the caller's live
// zombie.spawn_reinforcements value afterwards (the -0.05 "caller charge").
// Vanilla (.decomp ZombieEntity.java:274-316): after super.damage succeeds, target = getTarget() ?: attacker; iff HARD and
// nextFloat() < spawn_reinforcements and doMobSpawning: 50 tries of pos + nextInt(7,40)*nextInt(-1,1) per axis, placed iff
// SpawnHelper.canSpawn(ON_GROUND) && SpawnRestriction.canSpawn(ZOMBIE, REINFORCEMENT) (HostileEntity.canSpawnInDark — the
// light test) && no player within 7 && no entity/block/fluid overlap. The callee is ALWAYS `new ZombieEntity(world)` — a
// plain zombie, even when a husk calls. Caller and callee each get a -0.05 ADDITION modifier.
export const Y = -60;            // server.mjs flat preset: standing y (grass top is -61..-60)
export const HALF = 42;          // arena half-width (offsets reach 40)
export const DZ = 2;
export const SWEEP_DX = 1;      // the sweep scene's caller sits 1 block +x of the struck pig
export const SCENES = [
  { id: 'zombie_hard_b1', mob: 'zombie', diff: 'hard', base: 1, reps: 16 },
  { id: 'zombie_normal_b1', mob: 'zombie', diff: 'normal', base: 1, reps: 8 },
  { id: 'zombie_hard_nospawn', mob: 'zombie', diff: 'hard', base: 1, reps: 8, noSpawn: true },
  { id: 'zombie_hard_b0', mob: 'zombie', diff: 'hard', base: 0, reps: 8 },
  { id: 'husk_hard_b1', mob: 'husk', diff: 'hard', base: 1, reps: 12 },
  { id: 'zombie_hard_b05', mob: 'zombie', diff: 'hard', base: 0.5, reps: 24 },
  // noon, roof removed: open sky — HostileEntity.isSpawnDark refuses (sky light 15), so the 50 tries all fail
  // the JOIN: the caller is only the SWEEP victim of a diamond-sword blow on a pig 1 block -x of it (PlayerEntity.attack's
  // sweep deals DamageSource.player(this) — an attacker, so the reinforcement call runs). Named in Undead.OWED as unwired.
  { id: 'zombie_hard_sweep', mob: 'zombie', diff: 'hard', base: 1, reps: 8, sweep: true },
  { id: 'zombie_hard_b1_noon', mob: 'zombie', diff: 'hard', base: 1, reps: 12, open: true },
];
