#!/usr/bin/env node
// combatmutantscheck.mjs — #11504: assertions for the 7 mutation survivors in src/14j_combat.js (eye height, wetExtinguish,
// impaling gate, dragon thorns gate, enderman projectile teleport, bat wake, stuck-arrow timer).
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const load = (patch) => loadEngine({ extra: ['02f_tags.js', '14j_combat.js'], patch });
function scenario(NS) {
  const Cb = NS.Combat, o = {};
  NS.Sound = { play: () => {} };
  NS.Breed = { isBaby: (e) => !!e.baby };
  o.eyeAdult = Cb.eyeHeightOf({ type: 'chicken', height: 0.8 });
  o.eyeBaby = Cb.eyeHeightOf({ type: 'chicken', baby: true, height: 0.4 });
  o.dryOut = Cb.wetExtinguish({ remainingFireTicks: 0, inWater: true, x: 0, y: 0, z: 0, type: 'zombie' });
  o.dryNotBurn = Cb.wetExtinguish({ remainingFireTicks: 50, inWater: false, x: 0, y: 0, z: 0, type: 'zombie' });
  const w = { remainingFireTicks: 50, inWater: true, x: 0, y: 0, z: 0, type: 'zombie' };
  o.wetOut = Cb.wetExtinguish(w) && w.remainingFireTicks === -1;
  const st = (id, lvl) => ({ t: { Enchantments: [{ id, lvl }] } });
  o.impUndead = Cb.damageBonus(st('minecraft:impaling', 3), 'undead');
  o.impAquatic = Cb.damageBonus(st('minecraft:impaling', 3), 'aquatic');
  o.smiteAquatic = Cb.damageBonus(st('minecraft:smite', 3), 'aquatic');
  // dragon: a non-thorns source with an attacker must not take the thorns path
  let parts = 0;
  const dragon = { body: {}, health: 200, damagePart: () => { parts++; return true; } };
  const dr = { type: 'ender_dragon', dragon, health: 200, maxHealth: 200, x: 0, y: 0, z: 0 };
  try { Cb.hurt(dr, 4, 0, false, { source: 'magic', attacker: {} }); } catch (e) { /* later path may throw; only damagePart matters */ }
  o.magicParts = parts;
  const dr2 = { type: 'ender_dragon', dragon, health: 200, maxHealth: 200, x: 0, y: 0, z: 0 };
  try { Cb.hurt(dr2, 4, 0, false, { source: 'thorns', attacker: {} }); } catch (e) { /* ignore */ }
  o.thornParts = parts - o.magicParts;
  // enderman projectile
  NS.Enderman = { ready: true, teleportRandomly: () => true };
  const en = { type: 'enderman', health: 40, maxHealth: 40, x: 0, y: 0, z: 0 };
  o.endTp = Cb.hurt(en, 4, 0, false, { source: 'projectile' });
  // bat wake
  let woke = 0; NS.Bat = { onDamage: () => { woke++; } };
  try { Cb.hurt({ type: 'bat', health: 6, maxHealth: 6, x: 0, y: 0, z: 0 }, 1, 0, false, {}); } catch (e) { /* ignore */ }
  o.batWoke = woke;
  woke = 0;
  try { Cb.hurt({ type: 'zombie', health: 20, maxHealth: 20, x: 0, y: 0, z: 0 }, 1, 0, false, {}); } catch (e) { /* ignore */ }
  o.zombieWoke = woke;
  // stuck arrows
  const s1 = { stuckArrows: 3, stuckArrowTimer: 0 }; Cb.tickStuckObjects(s1);
  o.stuckFresh = s1.stuckArrows + ':' + s1.stuckArrowTimer;
  const s2 = { stuckArrows: 3, stuckArrowTimer: 100 }; Cb.tickStuckObjects(s2);
  o.stuckRun = s2.stuckArrows + ':' + s2.stuckArrowTimer;
  return o;
}
console.log('combatmutantscheck — #11504');
const base = scenario(load());
const want = { eyeAdult: Math.fround(0.8 * 0.92), eyeBaby: Math.fround(0.4 * 0.85), dryOut: false, dryNotBurn: false, wetOut: true,
  impUndead: 0, impAquatic: 7.5, smiteAquatic: 0, magicParts: 0, thornParts: 1, endTp: true, batWoke: 1, zombieWoke: 0,
  stuckFresh: '3:539', stuckRun: '3:99' };
for (const k of Object.keys(want)) ok(String(base[k]) === String(want[k]), k + ': got ' + base[k] + ' want ' + want[k]);
const brk = (name, from, to, key) => {
  let hit = false, rr;
  try { rr = scenario(load((f, s) => { if (f === '14j_combat.js' && s.includes(from)) { hit = true; return s.replace(from, to); } return s; })); } catch (e) { rr = null; }
  if (hit && (!rr || String(rr[key]) !== String(want[key]))) { breaks++; console.log('   ✓ ' + name + ' caught'); } else fails.push('anti-vacuity: "' + name + '" not caught (matched=' + hit + ')');
};
brk('eye negate', "if (B) return Math.fround(baby ||", "if (!B) return Math.fround(baby ||", 'eyeAdult');
brk('wet return', "|| !(e.inPowderSnow || Cb.isWet(e))) return false;", "|| !(e.inPowderSnow || Cb.isWet(e))) return !false;", 'dryNotBurn');
brk('impaling ||', "'minecraft:impaling' && mobType", "'minecraft:impaling' || mobType", 'smiteAquatic');
brk('thorns ||', "if (src && src.source === 'thorns' && src.attacker) {", "if (src || src.source === 'thorns' && src.attacker) {", 'magicParts');
brk('enderman return', "if (EM.teleportRandomly(e)) return true;", "if (EM.teleportRandomly(e)) return !true;", 'endTp');
brk('bat flip', "if (e.type === 'bat' && NS.Bat)", "if (e.type !== 'bat' && NS.Bat)", 'batWoke');
brk('stuck negate', "if (!(e[t[i]] > 0)) e[t[i]]", "if (!!(e[t[i]] > 0)) e[t[i]]", 'stuckFresh');
console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
