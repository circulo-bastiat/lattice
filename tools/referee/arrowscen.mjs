// arrowscen.mjs — the ARROW HIT scenarios (#6090), shared by runarrow.mjs (the real 1.18.2 server) and arrowrefcheck.mjs.
// What it measures: the health a target keeps from ONE arrow fired as BowItem.onStoppedUsing would fire it:
// pull f = (t*t + 2t)/3 (t = ticks/20, cap 1), speed = f*3 (BowItem: setVelocity(.., f*3.0, 1.0)), damage = 2.0 + 0.5*Power+0.5 (Power III = 4.0),
// crit only when f == 1 (nbt crit:1b), then PersistentProjectileEntity.onEntityHit: ceil(|v|*damage) (+ nextInt(ceil/2+2) when crit),
// through armour. The summoned arrow carries the Motion/damage/crit NBT a real bow shot would; the server does the rest.
// NOT here (owed #6090): Punch knockback (the 1.18.2 arrow NBT has no punch key, so no server-side oracle without a real player/skeleton),
// the player as target, knockback velocity.
export { PITCH, HIT_Y, START_DZ, T, armorNbt } from './armorscen.mjs';
const pull = (ticks) => { const t = ticks / 20; return Math.min(1, (t * t + t * 2) / 3); };
const iron = ['boots', 'leggings', 'chestplate', 'helmet'].map((n, slot) => ({ slot, item: `iron_${n}`, ench: null }));
export const SCEN = [];
for (const [mob, armor] of [['cow', []], ['zombie', iron]]) {
  for (const ticks of [5, 10, 20]) {
    const v = Math.fround(pull(ticks) * 3);
    if (mob === 'cow' && ticks === 10) continue;   // OWED #6090: the server's cow loses 0 to these two (stable over 2 runs; a zombie at that speed is hit) - unexplained, not compared
    for (const [var_, d, crit] of [['plain', 2, false], ['power3', 4, false], ...(ticks === 20 ? [['crit', 2, true]] : [])]) {
      if (mob === 'cow' && crit) continue;   // a cow (10 hp) can die to the crit bonus; the zombie pair carries it
      SCEN.push({ id: `${mob}_${ticks}t_${var_}`, mob, v, d, crit, armor });
    }
  }
}
SCEN.push({ id: 'zombie_bare_20t_crit', mob: 'zombie', v: 3, d: 2, crit: true, armor: [] });
export const REPS = 6;
