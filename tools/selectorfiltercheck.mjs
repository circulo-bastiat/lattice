#!/usr/bin/env node
// selectorfiltercheck.mjs - #8119: @e[name=,tag=,level=,gamemode=] against a scripted set,
// vs .decomp EntitySelectorOptions (name/tag/level/gamemode predicates and their errors).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02g_items.js', '02i_text.js', '14e_gamemode.js', '14h_brigadier.js', '15g_commands.js'], initReg: true });
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
M.Commands.build(); const B = M.Brig;
const parse = (s) => M.Commands.arg.entity(false, false).parse(new B.Reader(s));
const mk = (type, extra) => Object.assign({ type, x: 0, y: 0, z: 0 }, extra);
const player = { x: 0, y: 0, z: 0, mode: 0, xpLevel: 10 };
const ents = [mk('cow', { customName: 'Bessie', tags: ['farm', 'a'] }), mk('cow', { customName: 'Daisy', tags: [] }),
  mk('zombie', { tags: ['a'] })];
M.Player = player;
M.EntityList = { all: () => ents };
const src = { name: 'Steve', x: 0, y: 0, z: 0, entity: player };
const run = (s, drop) => {
  const sel = parse(s);
  if (drop) { delete sel.opts[drop]; if (drop === 'tag') delete sel.opts._tags; }
  return M.Commands.resolve(sel, src).map((t) => t.kind === 'player' ? 'P' : (t.e.customName || t.e.type));
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = [
  ['@e[name=Bessie]', ['Bessie'], 'name'], ['@e[name=!Bessie]', ['P', 'Daisy', 'zombie'], 'name'],
  ['@e[name="Daisy"]', ['Daisy'], 'name'], ['@e[name=Steve]', ['P'], 'name'],
  ['@e[tag=farm]', ['Bessie'], 'tag'], ['@e[tag=!a]', ['P', 'Daisy'], 'tag'],
  ['@e[tag=]', ['P', 'Daisy'], 'tag'], ['@e[tag=!]', ['Bessie', 'zombie'], 'tag'],
  ['@e[level=5..]', ['P'], 'level'], ['@e[level=11..]', [], 'level'], ['@e[level=..10]', ['P'], 'level'],
  ['@e[level=10]', ['P'], 'level'], ['@e[gamemode=survival]', ['P'], 'gamemode'],
  ['@e[gamemode=!survival]', [], 'gamemode'], ['@e[gamemode=creative]', [], 'gamemode'],
  ['@e[gamemode=!creative]', ['P'], 'gamemode'],
];
let breaks = 0;
for (const [s, want, key] of cases) {
  ok(same(run(s), want), `${s} -> ${JSON.stringify(run(s))} want ${JSON.stringify(want)}`);
  const broken = run(s, key);
  if (!same(broken, want)) breaks++; // dropping the option changes the result
}
const err = (s) => { try { parse(s); return null; } catch (e) { return e.key || e.message; } };
const errs = [['@e[gamemode=foo]', 'argument.entity.options.mode.invalid'], ['@e[name=a,name=b]', 'argument.entity.options.inapplicable'],
  ['@e[gamemode=creative,gamemode=survival]', 'argument.entity.options.inapplicable'], ['@e[level=-1]', 'argument.entity.options.level.negative'],
  ['@e[level=1,level=2]', 'argument.entity.options.inapplicable']];
for (const [s, k] of errs) ok(err(s) === k, `${s} error ${err(s)} want ${k}`);
ok(err('@e[name=!a,name=!b]') === null && err('@e[tag=a,tag=b]') === null, 'negated names and repeated tags are allowed');
// 4 families each must have at least one case that notices the option being dropped
const fam = {}; for (const [s, want, key] of cases) if (!same(run(s, key), want)) fam[key] = 1;
ok(Object.keys(fam).length === 4, 'every option family is load-bearing');
for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
