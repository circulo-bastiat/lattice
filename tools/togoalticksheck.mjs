// tools/togoalticksheck.mjs - #5498: Goal.toGoalTicks(n) = ceil(n/2) unless the goal overrides shouldRunEveryTick (Goal.java:47-50).
// The engine rolls every real tick, so a vanilla nextInt(toGoalTicks(N)) per 2-tick pass is 1/(2*ceil(N/2)) per tick.
// Each row: the vanilla N parsed from .decomp, the engine constant parsed from src. Mismatch = fail.
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const D = '.decomp/net/minecraft/entity/';
const ROWS = [
  ['pounce roll', D + 'ai/goal/PounceAtTargetGoal.java', /nextInt\(toGoalTicks\((\d+)\)\)/, 'src/07k_goals.js', /Ai\.LEAP_ROLL = (\d+);/],
  ['enderman pickup', D + 'mob/EndermanEntity.java', /nextInt\(toGoalTicks\((20)\)\)/, 'src/07zg_enderman.js', /PICKUP_CHANCE = (\d+);/],
  ['enderman place', D + 'mob/EndermanEntity.java', /nextInt\(toGoalTicks\((2000)\)\)/, 'src/07zg_enderman.js', /PLACE_CHANCE = (\d+);/],
  ['shulker peek', D + 'mob/ShulkerEntity.java', /nextInt\(toGoalTicks\((\d+)\)\)/, 'src/07zzk_shulker.js', /PEEK_INTERVAL = (\d+);/],
  ['slime face timer', D + 'mob/SlimeEntity.java', /ticksLeft = toGoalTicks\((\d+)\)/, 'src/07zd_slime.js', /ticksLeft = (\d+); }; *\/\/ toGoalTicks/],
  ['tempt cooldown', D + 'ai/goal/TemptGoal.java', /cooldown = toGoalTicks\((\d+)\)/, 'src/07k_goals.js', /TEMPT_COOLDOWN = (\d+);/],
  ['panda lie on back', D + 'passive/PandaEntity.java', /nextInt\(toGoalTicks\((400)\)\) == 1/, 'src/07zl_panda.js', /LIE_ON_BACK_START_CHANCE = 1 \/ (\d+);/],
  ['squid swim', D + 'passive/SquidEntity.java', /nextInt\(toGoalTicks\((\d+)\)\) == 0 \|\| !this\.squid\.touchingWater/, 'src/07zi_squid.js', /rint\(e, (\d+)\) === 0 \|\| !e\.inWater/],
  ['turtle go home', D + 'passive/TurtleEntity.java', /nextInt\(toGoalTicks\((\d+)\)\) != 0 \? false/, 'src/07zp_turtle.js', /GO_HOME_ROLL = (\d+);/],
];
const run = (rows, read) => {
  const bad = [];
  for (const [name, df, dre, ef, ere] of rows) {
    const n = (read(df).match(dre) || [])[1], e = (read(ef).match(ere) || [])[1];
    if (!n || !e) { bad.push(name + ': pattern not found'); continue; }
    const want = 2 * Math.ceil(+n / 2);
    if (+e !== want) bad.push(`${name}: vanilla toGoalTicks(${n}) -> ${want} real ticks, engine has ${e}`);
  }
  return bad;
};
const real = run(ROWS, rd); let caught = 0;
for (let i = 0; i < ROWS.length; i++) {
  const [name, , , ef, ere] = ROWS[i];
  const mut = (p) => { const s = rd(p); return p === ef ? s.replace(ere, (m, g) => m.replace(g, String(+g * 2 + 2))) : s; };
  if (run([ROWS[i]], mut).length) caught++; else console.log(' NOT CAUGHT:', name);
}
for (const x of real) console.log(' FAIL:', x);
console.log(`togoalticksheck: ${ROWS.length} rows, ${caught} breaks caught (of ${ROWS.length})`);
process.exit(real.length || caught < ROWS.length ? 1 : 0);
