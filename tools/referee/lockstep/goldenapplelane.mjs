// lockstep/goldenapplelane.mjs -- #9265 (G17-L69a-3): the ENGINE side of the 'goldenapple' lane: a NoAI zombie villager with Weakness,
// fed a golden apple (Use.entityUse -> ZVillager.interact) at lane tick `feedTick`. One ENTX-shaped entities list per tick,
// the same shape trace.mjs parseEntxLog gives the server: [[type, id, conv, [[rawEffectId, amplifier, duration]]]], conv -1 = not converting.
// Row n = the state after n ticks (the datapack logs at the start of each server tick); the apple is fed just before the tick that produces row feedTick-1.
import { engineZombieTrace, harnessM } from './zombielane.mjs';

export const EFFECT_RAW = { strength: 5, weakness: 18 };   // 1.18.2 registry raw ids
export const GOLDEN_FIELDS = ['pos', 'entities'];
export const FEED_X = 18.5;   // 4 blocks from the survival player (reach 6)
export function entxOf(e) {
  const fx = Object.keys(e.effects || {}).filter((n) => n in EFFECT_RAW).map((n) => [EFFECT_RAW[n], e.effects[n].amplifier, e.effects[n].duration]).sort((p, q) => p[0] - q[0]);
  return [['zombie_villager', e.id, e.converting && e.conversionTimer > 0 ? e.conversionTimer : -1, fx]];
}
export function engineGoldenAppleTrace(salt, feedTick = 10, opts = {}) {
  const M = harnessM();
  let fed = false;
  return engineZombieTrace(salt, { mob: 'zombie_villager', noAI: true, T: opts.T, dist: FEED_X - 11.5 + 4, build: null,
    onStart: (EL) => { const e = EL.list.find((x) => x.type === 'zombie_villager'); e.x = FEED_X; M.Effects.addStatusEffect(e, 'weakness', 1000000, 0); },
    extra: (EL, e, t) => {
      const row = { entities: entxOf(e) };
      // the apple lands between two ticks (a player's interaction runs outside the mob's tick): snapshot first, feed, and the NEXT tick counts down
      if (t + 2 === feedTick && !fed) { fed = true; (opts.feed || ((P, z) => M.ZVillager.interact(P, z, M.ZVillager.CURE_ITEM, opts.timer ? () => (opts.timer - M.ZVillager.CURE_TIMER_MIN + 0.5) / M.ZVillager.CURE_TIMER_RANGE : EL.random)))(M.Player, e); }
      return row;
    } });
}
// #9265: the server's entity Random is seeded from JVM class names (SeedAgent), the engine's from the salt stream, so the cure timer's draw cannot be equal across the two;
// the compare feeds the engine the timer the server drew (opts.timer) and everything after it (countdown, effects, the Strength duration) must then match per tick.
export const timerOf = (rows) => { const r = rows.find((x) => x[0][2] > 0); return r ? r[0][2] + 1 : 0; };   // the first converting row is one tick after the apple: N - 1
