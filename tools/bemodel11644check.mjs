#!/usr/bin/env node
// bemodel11644check.mjs — #11644: proves 15h_bemodel.js's dragon_head (DragonHeadEntityModel) and builtin-entity item
// path (BuiltinModelItemRenderer: BE.forItem / BE.TURN / BE.OWED), reachable from 15_hud's icon draw; SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['10_gfx.js', '15h_bemodel.js'], dom: false,
    patch: patch ? (f, s) => (f === '15h_bemodel.js' ? patch(s) : s) : undefined });
  initRegistry(M);
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
  const BE = M.BEModel, o = {};
  const f = BE.forItem('dragon_head');
  o.rule = !!f && f.layer === 'dragon_head' && f.tex === 'be_dragon_head';
  const L = BE.layer('dragon_head');
  o.layer = !!L;
  o.turn = BE.TURN.dragon_head === true && BE.TURN.player_head === true && BE.TURN.shield === true;
  o.skulls = ['player_head', 'zombie_head', 'creeper_head', 'skeleton_skull', 'wither_skeleton_skull'].every((n) => { const r = BE.forItem(n); return r && r.layer === n; });
  o.owed = BE.OWED.length === 0;
  o.other = BE.forItem('stone') === null;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const hud = readFileSync(join(MCLITE_ROOT, 'src', '15_hud.js'), 'utf8');
ok(/BE\.forItem\(name\)/.test(hud), 'reach: 15_hud icon draw calls BE.forItem');
ok(/BE\.TURN && BE\.TURN\[spec\.layer\]/.test(hud), 'reach: 15_hud reads BE.TURN');
const BR = [
  ['rule', "layer: 'dragon_head',           tex: 'be_dragon_head'", "layer: 'dragon_head',           tex: 'be_x'", ['rule']],
  ['rulere', '/^dragon_head$/', '/^dragon_headx$/', ['rule']],
  ['turn', 'wither_skeleton_skull: true, dragon_head: true', 'wither_skeleton_skull: true', ['turn']],
  ['skull', "layer: 'creeper_head',", "layer: 'zombie_head',", ['skulls']],
  ['owed', 'BE.OWED = [];', "BE.OWED = ['dragon_head'];", ['owed']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`bemodel11644check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
