#!/usr/bin/env node
// levelupcheck.mjs — G21: PlayerEntity.addExperienceLevels plays entity.player.levelup
// (multiple of 5, volume min(level/30,1)*0.75, at most once per 100 ticks of age).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
let pass = 0, caught = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js',
          '14e_gamemode.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07d_mining.js', '07e_loot.js', '07y_equip.js',
          '07m_breed.js', '07w_passive.js', '14d_survival.js', '14j_combat.js', '07p_trade.js',
          '07zz_xporb.js', '14h_brigadier.js', '15g_commands.js']
});
const Sv = M.Survival, C = M.Commands;
C.build();
const plays = [];
M.Sound.play = (ev, o) => { plays.push([ev, o]); return true; };

const mk = () => {
  const P = { type: 'player', x: 1, y: 70, z: 2, width: 0.6, height: 1.8, dead: false,
              inventory: M.Inventory.create(), slot: 0, syncHotbar() {} };
  Sv.init(P); M.Gamemode.set(P, M.Gamemode.SURVIVAL); M.Player = P; P.age = 1000;
  return P;
};
const at = (P, lvl) => { P.xpTotal = Sv.totalXpFor(lvl); Sv.syncXp(P); };
const levelPlays = () => plays.filter((p) => p[0] === 'entity.player.levelup');
const near = (a, b) => Math.abs(a - b) < 1e-9;

// returns true when every expectation holds (used for the real run and the mutants)
function scenario() {
  const bad = [];
  const t = (c, m) => { if (!c) bad.push(m); };
  let P;
  plays.length = 0;
  P = mk(); at(P, 4); plays.length = 0;
  Sv.addXp(P, Sv.xpNeeded(4));
  t(P.xpLevel === 5 && levelPlays().length === 1 && near(levelPlays()[0][1].volume, 5 / 30 * 0.75), '4->5 plays once at 5/30*0.75');
  t(levelPlays().length && levelPlays()[0][1].pitch === 1 && levelPlays()[0][1].source === 'player', 'pitch 1, player category');
  // another multiple of 5 inside 100 ticks stays silent
  at(P, 9); plays.length = 0; P.age += 50;
  Sv.addXp(P, Sv.xpNeeded(9));
  t(P.xpLevel === 10 && levelPlays().length === 0, '10 within 100 ticks is silent');
  P.age += 60; at(P, 9); plays.length = 0;
  Sv.addXp(P, Sv.xpNeeded(9));
  t(levelPlays().length === 1 && near(levelPlays()[0][1].volume, 10 / 30 * 0.75), '9->10 after the gate plays at 10/30*0.75');
  P = mk(); at(P, 34); plays.length = 0;
  Sv.addXp(P, Sv.xpNeeded(34));
  t(levelPlays().length === 1 && near(levelPlays()[0][1].volume, 0.75), '34->35 plays at 0.75');
  P = mk(); at(P, 5); plays.length = 0;
  Sv.addXp(P, Sv.xpNeeded(5));
  t(levelPlays().length === 0, 'a non-multiple (6) never plays');
  // crossing several levels at once plays a single sound (gate)
  P = mk(); plays.length = 0; Sv.addXp(P, Sv.totalXpFor(11));
  t(levelPlays().length === 1 && near(levelPlays()[0][1].volume, 5 / 30 * 0.75), '0->11 in one gain: one sound, at level 5');
  // /xp add levels uses the same path
  P = mk(); plays.length = 0;
  const r = C.run('/experience add @s 5 levels', P, { level: 4 });
  t(r.ok && P.xpLevel === 5 && levelPlays().length === 1 && near(levelPlays()[0][1].volume, 5 / 30 * 0.75), '/xp add 5 levels sounds');
  // losing levels never plays
  P = mk(); at(P, 10); plays.length = 0; Sv.addLevels(P, -5);
  t(P.xpLevel === 5 && levelPlays().length === 0, 'losing levels is silent');
  return bad;
}

const real = scenario();
ok(real.length === 0, 'real engine: ' + real.join('; '));

// the clip is packed: pack-sounds keeps entity.player.*
{
  const src = readFileSync(join(ROOT, 'tools', 'pack-sounds.mjs'), 'utf8');
  const m = src.match(/const ENTITY_KEEP = (\/.*\/);/);
  ok(m && eval(m[1]).test('entity.player.levelup'), 'pack-sounds ENTITY_KEEP selects entity.player.levelup');
}

// anti-vacuity: each broken rule must be caught by the scenario
const real_ = Sv.levelUpSound;
const mutants = {
  'every level plays': (e, l, d) => real_(e, l - l % 5, d) || (d > 0 && (M.Sound.play('entity.player.levelup', { x: 0, y: 0, z: 0, source: 'player', volume: 1, pitch: 1 }), true)),
  'no 100-tick gate': (e, l, d) => { e.lastPlayedLevelUpSoundTime = -1e9; return real_(e, l, d); },
  'volume not scaled': (e, l, d) => { const p = M.Sound.play; M.Sound.play = (ev, o) => { o.volume = 0.75; return p(ev, o); }; try { return real_(e, l, d); } finally { M.Sound.play = p; } },
};
for (const [name, fn] of Object.entries(mutants)) {
  Sv.levelUpSound = fn;
  const bad = scenario();
  Sv.levelUpSound = real_;
  if (bad.length) caught++; else fails.push('mutant not caught: ' + name);
}

console.log((fails.length ? 'FAIL' : 'PASS') + '  levelupcheck — ' + pass + ' assertions, ' + fails.length + ' failures, ' + caught + ' breaks caught');
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
