#!/usr/bin/env node
// statscheck.mjs -- G26a: src/07zzo_stats.js against Stats.java / StatFormatter.java and the
// .mcdata registries (custom_stat, stat_type), the counters, and the save round trip.
//   node tools/statscheck.mjs
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const dec = (f) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/stat/' + f, 'utf8');
const reg = JSON.parse(readFileSync(MCLITE_ROOT + '.mcdata/1.18.2/_registries.json', 'utf8'));
const javaRows = [...dec('Stats.java').matchAll(/register\("(\w+)", StatFormatter\.(\w+)\)/g)].map((m) => [m[1], m[2]]);
const CODE = { DEFAULT: 'D', DIVIDE_BY_TEN: 'V', DISTANCE: 'S', TIME: 'T' };
const javaTypes = [...dec('Stats.java').matchAll(/registerType\("(\w+)"/g)].map((m) => m[1]);

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07zzo_stats.js'] });
const St = M.Stats;

function verify(S, tag) {
  const ids = S.CUSTOM.map((r) => r[0]);
  ok(JSON.stringify(ids.slice().sort()) === JSON.stringify(reg.custom_stat.slice().sort()), tag + ': custom stat ids == .mcdata custom_stat');
  ok(JSON.stringify(S.CUSTOM.map((r) => [r[0], r[1]])) === JSON.stringify(javaRows.map((r) => [r[0], CODE[r[1]]])), tag + ': ids+formatters == Stats.java');
  ok(JSON.stringify(S.TYPES.map((t) => t[0]).sort()) === JSON.stringify(reg.stat_type.slice().sort()), tag + ': stat types == .mcdata stat_type');
  ok(JSON.stringify(S.TYPES.map((t) => t[0])) === JSON.stringify(javaTypes), tag + ': stat types order == Stats.java');
}
verify(St, 'engine');
ok(St.CUSTOM.length === 75, '75 custom stats');

// formatters (StatFormatter.java)
const F = (id, n) => St.format(id, n);
ok(F('jump', 1234567) === '1,234,567', 'DEFAULT groups thousands');
ok(F('damage_dealt', 25) === '2.50', 'DIVIDE_BY_TEN');
ok(F('walk_one_cm', 50) === '50 cm' && F('walk_one_cm', 51) === '0.51 m', 'DISTANCE cm/m');
ok(F('walk_one_cm', 60000) === '0.60 km' || F('walk_one_cm', 60000) === '0.60 km', 'DISTANCE km');
ok(F('walk_one_cm', 200000) === '2.00 km', 'DISTANCE km 2');
ok(F('play_time', 20) === '1.0 s' && F('play_time', 30) === '1.5 s', 'TIME seconds (Java double toString)');
ok(F('play_time', 1200 * 2) === '2.00 m' && F('play_time', 72000) === '1.00 h', 'TIME m/h');
ok(F('play_time', 72000 * 24) === '1.00 d', 'TIME d');

// counters
St.reset();
ok(St.getCustom('jump') === 0, 'fresh counter is 0');
St.inc('jump'); St.inc('jump');
ok(St.getCustom('jump') === 2, 'inc twice');
ok(St.custom('walk_one_cm') === 'minecraft.custom:minecraft.walk_one_cm', 'Stat.getName');
St.inc('deaths', 2147483647); St.inc('deaths', 5);
ok(St.getCustom('deaths') === 2147483647, 'saturates at Integer.MAX_VALUE');
St.reset();
St.onMove(1, { sprinting: true }); St.onMove(1, {}); St.onMove(0.5, { sneaking: true }); St.onMove(1, { swimming: true });
ok(St.getCustom('sprint_one_cm') === 100 && St.getCustom('walk_one_cm') === 100 && St.getCustom('crouch_one_cm') === 50 && St.getCustom('swim_one_cm') === 100, 'onMove buckets');
St.reset();
St.travel({ inWater: true }, 1, 0.5, 0); St.travel({ inWater: true, submerged: true }, 0, 3, 4); St.travel({ inWater: true, swimming: true }, 0, 3, 4);
St.travel({ climbing: true }, 0.3, 0.2, 0); St.travel({ climbing: true }, 0, -0.2, 0); St.travel({ fallFlying: true }, 0, 3, 4);
St.travel({}, 0.2, 0, 0); St.travel({}, 0.3, 0, 0); St.onFall(1.9); St.onFall(3.5);
ok(St.getCustom('walk_on_water_one_cm') === 100 && St.getCustom('walk_under_water_one_cm') === 500 && St.getCustom('swim_one_cm') === 500
  && St.getCustom('climb_one_cm') === 20 && St.getCustom('aviate_one_cm') === 500 && St.getCustom('fly_one_cm') === 30 && St.getCustom('fall_one_cm') === 350, 'travel classification');
St.reset(); St.onJump(); ok(St.getCustom('jump') === 1, 'onJump');
St.onTick(true); St.onTick(false);
ok(St.getCustom('play_time') === 2 && St.getCustom('sneak_time') === 1 && St.getCustom('time_since_death') === 2, 'onTick');
ok(St.getCustom('time_since_rest') === 2, 'rest counts awake');
St.onTick(false, false, true); ok(St.getCustom('time_since_rest') === 2 && St.getCustom('time_since_death') === 3, 'rest frozen while sleeping');
St.onTick(false, true);
ok(St.getCustom('time_since_death') === 3 && St.getCustom('play_time') === 4, 'onTick: dead player keeps play_time but not time_since_death');
St.onDeath(); ok(St.getCustom('deaths') === 1 && St.getCustom('time_since_death') === 0 && St.getCustom('time_since_rest') === 0, 'onDeath resets both');

St.onTick(false); St.onTick(false, true, false); St.onTick(false, false, true);
ok(St.getCustom('time_since_death') === 2 && St.getCustom('time_since_rest') === 2, 'dead/asleep ticks skip time_since_*');
St.onSleep(); ok(St.getCustom('time_since_rest') === 0 && St.getCustom('time_since_death') === 2, 'onSleep resets rest only');
St.onTick(false); St.onDeath(); ok(St.getCustom('time_since_rest') === 0, 'onDeath resets time_since_rest');

// save round trip
const j = JSON.parse(JSON.stringify(St.toJSON()));
St.reset(); St.fromJSON(j);
ok(St.getCustom('jump') === 1 && St.getCustom('play_time') === 8, 'save round trip');
St.fromJSON({ 'bad key': 5, 'minecraft.custom:minecraft.jump': -3, 'minecraft.custom:minecraft.drop': 7 });
ok(St.getCustom('jump') === 0 && St.getCustom('drop') === 7, 'fromJSON rejects junk');

{ const sv = St.travel; St.travel = () => 0; St.reset(); St.travel({ climbing: true }, 0, 1, 0);
  caught(St.getCustom('climb_one_cm') === 0, 'neutered travel counts nothing'); St.travel = sv; }
// anti-vacuity: break the data, the verifier must notice
{
  const bad = { CUSTOM: St.CUSTOM.map((r) => r.slice()), TYPES: St.TYPES.slice() };
  const n0 = fails.length;
  bad.CUSTOM[0][0] = 'not_a_stat'; verify(bad, 'broken-id');
  caught(fails.length > n0, 'renamed id detected'); fails.length = n0; pass += 0;
  const bad2 = { CUSTOM: St.CUSTOM.map((r) => r.slice()), TYPES: St.TYPES.slice() };
  bad2.CUSTOM[10][1] = bad2.CUSTOM[10][1] === 'D' ? 'T' : 'D'; verify(bad2, 'broken-fmt');
  caught(fails.length > n0, 'swapped formatter detected'); fails.length = n0;
  const bad3 = { CUSTOM: St.CUSTOM.slice(1), TYPES: St.TYPES.slice(1) }; verify(bad3, 'dropped');
  caught(fails.length > n0, 'dropped row/type detected'); fails.length = n0;
  const save = St.inc; St.inc = () => 0; St.reset(); St.onJump();
  caught(St.getCustom('jump') === 0, 'neutered counter reads 0 (counter assertions can fail)'); St.inc = save;
}

// #541: movement/jump stats must also run for creative/spectator (increaseTravelMotionStats has no gamemode gate).
{
  const src = readFileSync(MCLITE_ROOT + 'src/14_player.js', 'utf8');
  const hasCreativeBranch = (t) => /\} else if \(Sv\) \{[\s\S]{0,900}Sv\.movement\(P, cdist[\s\S]{0,400}Sv\.jumped\(P/.test(t);
  ok(hasCreativeBranch(src), 'player tick feeds Sv.movement/jumped when invulnerableGamemode (#541)');
  caught(!hasCreativeBranch(src.replace('} else if (Sv) {', '} else if (false) {').replace('Sv.movement(P, cdist', 'Sv.x(P, cdist')), 'removed creative movement branch detected');
}

for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
