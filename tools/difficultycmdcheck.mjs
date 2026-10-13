#!/usr/bin/env node
// difficultycmdcheck.mjs — #5059: /difficulty (DifficultyCommand, level 2) through NS.Diff.set.
// Runs every form through the real dispatcher, asserts Diff.get() and the exact lang strings,
// the same-difficulty failure, tab completion, and that peaceful then despawns hostiles via the
// real Spawn.despawnTick. Each assertion block is repeated against a broken engine (anti-vacuity).
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
  '02i_text.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
{
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
M.Entities.init();
const W = M.World, EL = M.EntityList, Sp = M.Spawn, Diff = M.Diff, C = M.Commands;
W.init(1337); M.Gen.init(1337, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
Sp.init(); Sp.ready = false;
M.Player = { x: 300, y: 64, z: 0 };
C.build();
const run = (l, o) => C.run(l, M.Player, o || {});

function suite(tag, expectBroken) {
  let bad = 0;
  const chk = expectBroken ? (c, m) => { if (!c) bad++; } : ok;
  Diff.set('normal');
  let r = run('/difficulty');
  chk(r.ok && r.lines[0] === 'The difficulty is Normal', 'query prints "The difficulty is Normal"');
  r = run('/difficulty hard');
  chk(r.ok && Diff.get() === 'hard', 'set hard changes Diff');
  chk(r.lines[0] === 'The difficulty has been set to Hard', 'success string exact');
  r = run('/difficulty hard');
  chk(!r.ok && /did not change; it is already set to Hard/.test(r.lines.join('\n')), 'same difficulty fails with the vanilla message');
  r = run('/difficulty bogus');
  chk(!r.ok && Diff.get() === 'hard', 'unknown name is refused and changes nothing');
  chk(!run('/difficulty easy', { level: 1 }).ok && Diff.get() === 'hard', 'level 1 refused');
  chk(run('/difficulty easy', { level: 2 }).ok && Diff.get() === 'easy', 'level 2 allowed');
  const s = C.suggest ? C.suggest('/difficulty ', M.Player) : null;
  chk(s && ['peaceful', 'easy', 'normal', 'hard'].every(n => s.matches.map(x => x.text || x).includes(n)), 'tab completion lists the four names');
  EL.clear();
  const z = EL.spawn('zombie', 300, 64, 0);
  chk(run('/difficulty peaceful').ok && Diff.isPeaceful(), 'peaceful set');
  Sp.despawnTick();
  chk(z.removed === true, 'peaceful then despawns the hostile via the real spawn gate');
  Diff.set('normal'); EL.clear();
  if (expectBroken) okAv(bad > 0, tag + ' (' + bad + ' assertions failed)');
}
suite('real', false);

// breaks
const T = M.Text, tr = T.translate;
T.translate = function (k, a) { const s = tr.call(T, k, a); return k === 'commands.difficulty.success' ? s + '!' : s; };
suite('wrong feedback string', true);
T.translate = tr;

const set = Diff.set; Diff.set = function () { return Diff.value; };
suite('no-op set', true);
Diff.set = set;

const reg = C.build; /* unknown name accepted: add a literal the real table lacks */
new M.Brig.Builder(C.dispatcher.get('difficulty')).then(M.Brig.literal('bogus').executes(() => { Diff.value = 'bogus'; return 0; }));
suite('accepts unknown name', true);
C.ready = false; C.build();
Diff.set('normal');

console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
