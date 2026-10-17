#!/usr/bin/env node
// textselectorcheck.mjs — #8235: JSON text {"selector"} (SelectorText).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; void 0; } else fails.push('anti-vacuity: ' + m); };

const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '07zzo2_scoreboard.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
{
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
M.Entities.init();
const W = M.World, EL = M.EntityList, C = M.Commands, B = M.Brig;
W.init(1337); M.Gen.init(1337, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
M.Player = { x: 300, y: 64, z: 0 };
C.build();
const SB = M.Scoreboard, T = M.Text, src = { x: 300, y: 64, z: 0, name: 'Player' };
const flat = (j) => T.runs(T.resolve(T.fromJson(j), src)).map(r => r.text).join('');
function suite(tag, broken) {
  let bad = 0;
  const chk = broken ? (c, m) => { if (!c) bad++; } : ok;
  EL.clear(); SB.reset();
  const a = EL.spawn('pig', 300, 64, 0), b = EL.spawn('pig', 302, 64, 0);
  a.customName = 'Alpha'; b.customName = 'Beta';
  chk(flat({ selector: '@e[type=pig,sort=furthest]', separator: ' & ' }) === 'Beta & Alpha' || flat({ selector: '@e[type=pig]', separator: ' & ' }) === 'Alpha & Beta', 'custom separator');
  chk(flat({ selector: '@e[type=pig]' }) === 'Alpha, Beta', 'default separator');
  const runs = T.runs(T.resolve(T.fromJson({ selector: '@e[type=pig]' }), src));
  chk(runs.some(r => r.text === ', ' && r.style && r.style.color === 'gray'), 'default separator is gray');
  chk(flat({ selector: '@e[type=cow]' }) === '', 'zero matches is empty');
  const t = SB.addTeam('red'); t.color = 'red'; SB.joinTeam(SB.holderOf(a, 'x'), t);
  const r2 = T.runs(T.resolve(T.fromJson({ selector: '@e[type=pig,limit=1]' }), src));
  chk(r2.length === 1 && r2[0].text === 'Alpha' && r2[0].style && r2[0].style.color === 'red', 'team colour applied');
  let err = false; try { T.fromJson({ selector: '@x' }); } catch (e) { err = !!e.json; }
  chk(err, 'invalid selector is a json error');
  if (broken) okAv(bad > 0, tag + ' (' + bad + ' assertions failed)');
}
suite('real', false);
const kj = T.fromJson;
T.fromJson = (j) => { const c = kj(j); (function f(n) { if (n && n.separator) delete n.separator; })(c); return c; };
suite('separator ignored', true);
T.fromJson = kj;
const kt = SB.teamOf; SB.teamOf = () => null;
suite('team colour dropped', true);
SB.teamOf = kt;
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
