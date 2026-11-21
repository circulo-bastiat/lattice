#!/usr/bin/env node
// golemsoundcheck.mjs — #738: IronGolemEntity attack/hurt/death/crack sounds. Anti-vacuity: re-run against a sabotaged table.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07y_equip.js', '07zzp_mobvoice.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')), mobSounds: { iron_golem: ['', 'entity.iron_golem.hurt', 'entity.iron_golem.death', 'entity.iron_golem.step', '1.0', '120', '1.0', 'neutral', '', '', ''] } });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init();
const played = [];
M.Sound = { play: (ev) => { played.push(ev); return true; } };
const REPAIR = 'entity.iron_golem.repair';
const SE = readFileSync(join(ROOT, '.decomp/net/minecraft/sound/SoundEvents.java'), 'utf8');
for (const n of Object.values(M.Combat.IRON_GOLEM_SOUND)) if (!SE.includes('register("' + n + '")')) { console.log('FAIL unknown sound ' + n); process.exit(1); }
function run() {
  const seen = new Set(); const g = () => ({ type: 'iron_golem', x: 0, y: 9, z: 0, health: 100, maxHealth: 100, hurtTime: 0 });
  const take = (f) => { played.length = 0; try { f(); } catch (x) { } played.forEach(s => seen.add(s)); return played.slice(); };
  take(() => M.Combat.mobAttack(g(), { x: 1, y: 9, z: 0, health: 20, maxHealth: 20, hurtTime: 0 }));
  const hurt = take(() => M.Combat.hurt(g(), 5, 100, true));
  const t = g(); t.health = 76; const crack = take(() => M.Combat.hurt(t, 5, 100, true));
  take(() => M.Combat.hurt(Object.assign(g(), { health: 1 }), 5, 100, true));
  return { seen, hurt, crack };
}
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
let r = run();
for (const k of ['attack', 'hurt', 'death', 'damage']) ok(r.seen.has('entity.iron_golem.' + k), 'missing ' + k);
ok(r.hurt.filter(s => s === 'entity.iron_golem.hurt').length === 1, 'hurt sound not played exactly once (#3604)');
ok(!r.hurt.includes('entity.iron_golem.damage'), 'crack sound on no crack change');
ok(r.crack.includes('entity.iron_golem.damage'), 'no crack sound on 76->71');
const T = M.Combat.IRON_GOLEM_SOUND, saved = Object.assign({}, T); let breaks = 0;
for (const k of Object.keys(saved)) { T[k] = 'x.' + k; const s = run(); if (!s.seen.has(saved[k])) breaks++; T[k] = saved[k]; }
ok(breaks === 4, 'sabotage caught only ' + breaks);
const useSrc = readFileSync(join(ROOT, 'src/14l_use.js'), 'utf8');
ok(useSrc.includes("'" + REPAIR + "'") && /itemName === 'iron_ingot'/.test(useSrc), 'iron ingot repair sound not wired in Use.entityUse');
ok(SE.includes('register("' + REPAIR + '")'), 'repair sound unknown');
const wired = (src) => src.includes("'" + REPAIR + "'") && /itemName === 'iron_ingot'/.test(src);
ok(!wired(useSrc.replace(REPAIR, 'x.repair')) && !wired(useSrc.replace("itemName === 'iron_ingot'", "itemName === 'x'")), 'repair sabotage not caught');
breaks += 2;
M.MobVoice.OWN.iron_golem = 0; const dbl = run().hurt.filter(s => s === 'entity.iron_golem.hurt').length; M.MobVoice.OWN.iron_golem = 1;
ok(dbl === 2, 'double-play sabotage not caught'); breaks++;
if (fails.length) { console.log('FAIL ' + fails.join('; ')); process.exit(1); }
console.log('golemsoundcheck: ok, ' + breaks + ' breaks caught');
