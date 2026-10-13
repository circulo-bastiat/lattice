#!/usr/bin/env node
// destroyeggcheck.mjs — #879: ZombieEntity.DestroyEggGoal (StepAndDestroyBlockGoal/MoveToTargetPosGoal, .decomp):
// range-24 search for a turtle_egg with two air above, tickStepping every 6th counter tick plays
// entity.zombie.destroy_egg 0.5 HOSTILE, counter > 60 removes the egg and plays entity.turtle.egg_break 0.7 BLOCK
// (pitch 0.9..1.1 both); mobGriefing gate; wired into zombie/husk/zombie_villager/drowned rosters at priority 4.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js',
  '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zk_undead.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, S = M.States, R = M.Reg, U = M.Undead, EL = M.EntityList, Ai = M.Ai;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
W.init(1); M.Behave.init(W); EL.init(); Ai.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const played = [];
M.Sound = Object.assign(M.Sound || {}, {});
M.Sound.entitySound = (ev, x, y, z, volume, pitch, source) => played.push({ ev, volume, pitch, source });
const egg = S.stateOf('turtle_egg');

const run = (opts = {}) => {
  W.setBlock(0, 60, 0, egg); W.setBlock(0, 61, 0, 0); W.setBlock(0, 62, 0, 0);
  const z = EL.spawn('zombie', 0.5, 61, 0.5); z.onGround = true;
  const g = new U.DestroyEggGoal(z, { mobGriefing: () => opts.grief !== false }, 1.0, () => 0.5);
  played.length = 0;
  const out = { start: g.canUse() };
  if (out.start) {
    g.start();
    for (let i = 0; i < 70 && W.getBlock(0, 60, 0) === egg; i++) g.tick();
  }
  out.gone = W.getBlock(0, 60, 0) === 0;
  out.steps = played.filter((p) => p.ev === 'entity.zombie.destroy_egg');
  out.breaks = played.filter((p) => p.ev === 'entity.turtle.egg_break');
  W.setBlock(0, 60, 0, 0);
  return out;
};
const good = (o) => o.start && o.gone && o.steps.length === 11 && o.breaks.length === 1 &&
  o.steps.every((p) => p.volume === 0.5 && p.source === 'hostile' && Math.abs(p.pitch - 1) < 1e-9) &&
  o.breaks[0].volume === 0.7 && o.breaks[0].source === 'block' && Math.abs(o.breaks[0].pitch - 1) < 1e-9;
const o = run(); if (process.env.DBG) console.log(JSON.stringify(o));
ok(o.start, 'canUse finds an egg'); ok(o.gone, 'egg removed after counter > 60');
ok(o.steps.length === 11, `11 step sounds (counter 0,6..60) — got ${o.steps.length}`);
ok(o.breaks.length === 1, 'one break sound'); ok(good(o), 'full comparison');
ok(run({ grief: false }).start === false, 'mobGriefing false blocks the goal');
// search: egg with a block above is no target; egg 30 away is out of range
W.setBlock(0, 60, 0, egg); W.setBlock(0, 61, 0, S.stateOf('stone'));
{ const z = EL.spawn('zombie', 0.5, 61, 5.5); ok(!new U.DestroyEggGoal(z, {}, 1, Math.random).canUse(), 'covered egg is not a target'); }
W.setBlock(0, 61, 0, 0); W.setBlock(0, 60, 0, 0);
W.setBlock(0, 60, 0, egg);
{ const z = EL.spawn('zombie', 0.5, 61, 30.5); ok(!new U.DestroyEggGoal(z, {}, 1, Math.random).canUse(), 'egg beyond range 24 not found'); }
W.setBlock(0, 60, 0, 0);
// wiring
for (const t of ['zombie', 'husk', 'zombie_villager', 'drowned', 'zombified_piglin']) {
  const gs = Ai.ROSTER[t](EL.spawn(t, 5, 70, 5), EL.aiCtx ? EL.aiCtx(EL.spawn(t, 5, 70, 5)) : { players: () => [], random: Math.random });
  const en = (gs.entries || []).find((x) => (x.goal || x.g) instanceof U.DestroyEggGoal);
  ok(!!en, `${t} roster has a DestroyEggGoal`);
  ok(en && (en.priority === 4 || en.prio === 4), `${t} DestroyEggGoal at priority 4`);
}

const caught = (label, fn, restore) => {
  fn(); let bad; try { bad = !good(run()); } catch (e) { bad = true; } restore();
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
const sv = { es: M.Sound.entitySound, n: U.EGG_DESTROY_COUNTER, a: U.EGG_STEP_VOLUME, b: U.EGG_BREAK_VOLUME, s: U.EGG_SOUND_STEP, k: U.EGG_SOUND_BREAK, r: U.EGG_RANGE };
const rest = () => { M.Sound.entitySound = sv.es; U.EGG_DESTROY_COUNTER = sv.n; U.EGG_STEP_VOLUME = sv.a; U.EGG_BREAK_VOLUME = sv.b; U.EGG_SOUND_STEP = sv.s; U.EGG_SOUND_BREAK = sv.k; };
caught('sound layer removed', () => { M.Sound.entitySound = () => {}; }, rest);
caught('counter threshold 30', () => { U.EGG_DESTROY_COUNTER = 30; }, rest);
caught('step volume 1', () => { U.EGG_STEP_VOLUME = 1; }, rest);
caught('break volume 0.5', () => { U.EGG_BREAK_VOLUME = 0.5; }, rest);
caught('step event swapped', () => { U.EGG_SOUND_STEP = 'entity.zombie.step'; }, rest);
caught('break event swapped', () => { U.EGG_SOUND_BREAK = 'entity.zombie.death'; }, rest);

console.log('\n================ destroyeggcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
