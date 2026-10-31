#!/usr/bin/env node
// selectornbtcheck.mjs — #8121: @e[nbt={...}] (EntitySelectorOptions 'nbt', NbtPredicate subset match).
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
const W = M.World, EL = M.EntityList, C = M.Commands, B = M.Brig;
W.init(1337); M.Gen.init(1337, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
M.Player = { x: 300, y: 64, z: 0 };
C.build();
const sel = (str) => C.arg.entity(false).parse(new B.Reader(str));
const names = (str) => C.resolve(sel(str), { x: 300, y: 64, z: 0, name: 'Player' }).map(t => t.e.id);
function suite(tag, broken) {
  let bad = 0;
  const chk = broken ? (c, m) => { if (!c) bad++; } : ok;
  EL.clear();
  const a = EL.spawn('sheep', 300, 64, 0), b = EL.spawn('sheep', 302, 64, 0), c = EL.spawn('sheep', 304, 64, 0);
  a.woolColor = 'lime'; a.sheared = false;
  b.woolColor = 'lime'; b.sheared = true;
  c.woolColor = 'pink'; c.sheared = true;
  const ids = (x) => x.slice().sort().join();
  chk(ids(names('@e[type=sheep,nbt={Color:5b}]')) === ids([a.id, b.id]), 'Color:5b selects the two lime sheep');
  chk(ids(names('@e[type=sheep,nbt={Sheared:1b}]')) === ids([b.id, c.id]), 'Sheared:1b selects the two sheared');
  chk(ids(names('@e[type=sheep,nbt=!{Sheared:1b}]')) === ids([a.id]), 'negated form selects the unsheared');
  chk(ids(names('@e[type=sheep,nbt={Color:5b,Sheared:1b}]')) === ids([b.id]), 'two keys must both match');
  chk(ids(names('@e[type=sheep,nbt={Pos:[302.0d]}]')) === ids([b.id]), 'list subset: Pos contains 302');
  chk(names('@e[type=sheep,nbt={Pos:[999d]}]').length === 0, 'list subset with absent element selects none');
  if (broken) okAv(bad > 0, tag + ' (' + bad + ' assertions failed)');
}
suite('real', false);
const keep = C.entityNbt;
C.entityNbt = () => ({});
suite('empty entity nbt', true);
C.entityNbt = (t) => new Proxy({}, { get: () => 1, has: () => true });
suite('everything matches', true);
C.entityNbt = keep;
const gs = C.arg.entity; C.arg.entity = function () { const o = gs.apply(this, arguments); const p = o.parse; o.parse = function (r) { const x = p.apply(this, arguments); delete x.opts.nbt; return x; }; return o; };
suite('nbt option ignored', true);
C.arg.entity = gs;
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
