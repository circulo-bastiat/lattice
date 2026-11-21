#!/usr/bin/env node
// ravagercontrolscheck.mjs — #3762: RavagerEntity.updateGoalControls. Non-raider mob passenger => MOVE|LOOK|TARGET off; boat => JUMP off.
import { loadEngine } from './loadsrc.mjs';
console.log('ravagercontrolscheck — #3762');
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(patch) {
  const out = {};
  try {
    const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js'], dom: false, patch });
    const Ai = M.Ai;
    const mk = (rider, veh) => { const e = { type: 'ravager', passengers: rider ? [{ type: rider, ai: {} }] : [], vehicle: veh ? { type: veh } : null };
      const gs = Ai.ROSTER.ravager(e, { random: Math.random, players: () => [], golems: () => [] }); gs.beforeTick(); return gs.disabled; };
    out.zombie = mk('zombie'); out.pillager = mk('pillager'); out.none = mk(null); out.boat = mk(null, 'boat');
  } catch (err) { out.err = String(err); }
  return out;
}
const r = run();
if (r.err) { console.log('   ✗ ' + r.err); process.exit(1); }
ok(r.zombie === 15, 'zombie passenger disables MOVE|LOOK|JUMP|TARGET (got ' + r.zombie + ')');
ok(r.pillager === 0, 'pillager passenger keeps all controls (got ' + r.pillager + ')');
ok(r.none === 0, 'no passenger keeps all controls');
ok(r.boat === 4, 'boat disables JUMP only (got ' + r.boat + ')');
const brk = (name, from, to, key, val) => {
  let hit = false, rr = run((f, s) => { if (f === '07k_goals.js' && s.includes(from)) { hit = true; return s.replace(from, to); } return s; });
  if (hit && rr[key] !== val) { breaks++; console.log('   ✓ ' + name + ' caught'); } else fails.push('anti-vacuity: ' + name + ' not caught (matched=' + hit + ')');
};
brk('raider test gone', '!!Ai.RAIDER_TYPES[p.type]', 'false', 'pillager', 0);
brk('boat test gone', "v.type === 'boat'", 'false', 'boat', 4);
brk('hook gone', 'gs.disabled = (controlled', 'void (controlled', 'zombie', 15);
console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
