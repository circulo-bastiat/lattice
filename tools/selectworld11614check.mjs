#!/usr/bin/env node
// selectworld11614check.mjs — #11614: proves 15mw_selectworld.js (SelectWorldScreen/WorldListWidget/EditWorldScreen/ConfirmScreen) incl. reachability, with source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
async function trial(patch) {
  const o = {}; const calls = [];
  let recs = [{ id: 'w1', name: 'Alpha', lastPlayed: 1, gameMode: 'survival', seed: 1, version: 'v' },
    { id: 'w2', name: 'Beta', lastPlayed: 2, gameMode: 1, seed: 2, version: 'v' }];
  const NS = { Hud: { titleView: 'main', hit: [] },
    Worlds: { init: async () => {}, list: async () => recs.slice(),
      remove: async (id) => { calls.push('rm:' + id); recs = recs.filter((r) => r.id !== id); },
      rename: async (id, n) => { calls.push('rn:' + id + ':' + n); recs.find((r) => r.id === id).name = n; },
      duplicate: async (id) => { calls.push('dup:' + id); }, open: async (id) => { calls.push('open:' + id); } } };
  let s = rd('15mw_selectworld.js'); if (patch) s = patch(s);
  new Function('MCL', s)(NS);
  const SW = NS.SelectWorld, H = NS.Hud; SW.reload = () => calls.push('reload');
  await SW.open();
  o.open = H.titleView === 'worlds' && SW.list.length === 2 && SW.sel === -1;
  SW.search = 'alp'; SW.apply(); o.filter = SW.list.length === 1 && SW.list[0].id === 'w1';
  SW.search = 'W2'; SW.apply(); o.filterId = SW.list.length === 1 && SW.list[0].id === 'w2';
  SW.search = ''; SW.apply();
  o.modeName = SW.modeName(1) === 'Creative Mode' && SW.modeName('survival') === 'Survival Mode';
  o.date = SW.date(new Date(2022, 2, 5, 15, 7).getTime()) === '3/5/22 3:07 PM' && /12:00 AM/.test(SW.date(new Date(2022, 0, 1, 0, 0).getTime()));
  o.unique = SW.uniqueName('Alpha') === 'Alpha (2)' && SW.uniqueName('Gamma') === 'Gamma';
  let L = SW.layout(400, 300);
  o.layNone = L.buttons.find((b) => b.id === 'play').active === false && L.buttons.find((b) => b.id === 'create').active === true;
  SW.key('ArrowDown'); SW.key('ArrowDown'); SW.key('ArrowDown'); o.down = SW.sel === 1;
  SW.key('ArrowUp'); SW.key('ArrowUp'); o.up = SW.sel === 0;
  L = SW.layout(400, 300); o.layHas = L.buttons.find((b) => b.id === 'edit').active === true;
  SW.key('x'); SW.key('Backspace'); o.typing = SW.search === ''; SW.sel = 0;
  SW.press('edit'); o.editView = H.titleView === 'editworld' && SW.edit.id === 'w1';
  SW.key('!'); SW.key('Backspace'); SW.key('Backspace'); SW.key('Z'); o.editName = SW.edit.name === 'AlphZ';
  const EL = SW.editLayout(400, 300); o.editLay = EL.buttons.length === 8 && EL.buttons.find((b) => b.id === 'backup').active && !EL.buttons.find((b) => b.id === 'optimize').active;
  await SW.press('backup'); await Promise.resolve(); o.backup = calls.includes('dup:w1');
  SW.edit.name = '  '; SW.doSave(); o.emptyName = !calls.some((c) => c.startsWith('rn:'));
  SW.edit.name = 'New'; await SW.doSave(); o.save = calls.includes('rn:w1:New') && H.titleView === 'worlds' && SW.edit === null;
  SW.sel = 0; SW.press('edit'); SW.key('Escape'); o.editEsc = H.titleView === 'worlds' && SW.edit === null;
  SW.press('delete'); o.confView = H.titleView === 'confirmdelete' && SW.confirm.id === SW.selected().id;
  o.confLay = SW.confirmLayout(400, 300).length === 2;
  SW.press('no'); o.confNo = H.titleView === 'worlds' && SW.confirm === null && !calls.some((c) => c.startsWith('rm:'));
  SW.press('delete'); SW.key('Escape'); o.confEsc = H.titleView === 'worlds';
  SW.press('delete'); const id = SW.confirm.id; await SW.doDelete(id);
  o.del = calls.includes('rm:' + id) && SW.list.length === 1 && SW.sel === -1 && H.titleView === 'worlds';
  SW.sel = 0; await SW.play(SW.list[0].id); o.play = calls.includes('open:' + SW.list[0].id) && calls.includes('reload');
  SW.key('Escape'); o.esc = H.titleView === 'main';
  H.titleView = 'worlds'; SW.press('cancel'); o.cancel = H.titleView === 'main';
  // draw hit regions
  const noop = new Proxy(function () {}, { get: () => noop, set: () => true, apply: () => noop });
  NS.Gui = { text() {}, textWidth: () => 10 }; NS.Options = { drawButton() {} }; NS.Title = { drawPanorama() {} };
  H.titleView = 'worlds'; SW.sel = 0; H.hit = []; SW.draw(noop, 800, 600, 2);
  o.drawHits = H.hit.some((h) => h.id === 'play') && H.hit.some((h) => h.id === 'world');
  H.titleView = 'confirmdelete'; SW.confirm = { id: 'a', name: 'A' }; H.hit = []; SW.draw(noop, 800, 600, 2);
  o.drawConf = H.hit.some((h) => h.id === 'yes') && H.hit.some((h) => h.id === 'no');
  const t = rd('15m_title.js'), hud = rd('15_hud.js');
  o.reach = /NS\.SelectWorld\.open\(\)/.test(t) && hud.includes('NS.SelectWorld.draw(') && hud.includes('NS.SelectWorld.key(');
  return o;
}
const A = await trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k);
const BR = [
  ['filterName', 'r.name.toLowerCase().indexOf(q) >= 0', 'false', ['filter']],
  ['filterId', 'r.id.toLowerCase().indexOf(q) >= 0', 'false', ['filterId']],
  ['modeName', "['survival', 'creative', 'adventure', 'spectator'][m]", "['survival', 'survival', 'adventure', 'spectator'][m]", ['modeName']],
  ['dateAmPm', "(hr < 12 ? 'AM' : 'PM')", "(hr < 12 ? 'PM' : 'AM')", ['date']],
  ['uniqueName', "base + ' (' + i + ')'", "base + '-' + i", ['unique']],
  ['playNeedsSel', "{ id: 'play', label: T.play, x: cx - 154, y: gh - b, w: 150, active: has }", "{ id: 'play', label: T.play, x: cx - 154, y: gh - b, w: 150, active: true }", ['layNone']],
  ['arrowDown', 'Math.min(SW.list.length - 1, SW.sel + 1)', 'SW.sel + 1', ['down']],
  ['arrowUp', 'Math.max(0, SW.sel - 1)', 'SW.sel - 1', ['up']],
  ['editView', "h.titleView = 'editworld'", "h.titleView = 'worlds'", ['editView']],
  ['editTyping', 'SW.edit.name += key', 'void 0', ['editName']],
  ['optimizeEnabled', "{ id: 'optimize', label: T.optimize, x: cx - 100, y: y + 101, w: 200, active: false }", "{ id: 'optimize', label: T.optimize, x: cx - 100, y: y + 101, w: 200, active: true }", ['editLay']],
  ['backup', 'Worlds.duplicate(SW.edit.id)', 'Worlds.duplicate("zz")', ['backup']],
  ['emptyName', 'if (!nm) return;', '', ['emptyName']],
  ['saveRename', 'Worlds.rename(e.id, nm)', 'Worlds.rename(e.id, "q")', ['save']],
  ['confirmNo', "SW.confirm = null; h.titleView = 'worlds'; }\n  };", "h.titleView = 'confirmdelete'; }\n  };", ['confNo']],
  ['confirmEsc', "if (key === 'Escape') { SW.confirm = null;", "if (key === 'Never') { SW.confirm = null;", ['confEsc']],
  ['doDelete', 'Worlds.remove(id)', 'Worlds.remove("zz")', ['del']],
  ['playOpen', 'NS.Worlds.open(id)', 'NS.Worlds.open("zz")', ['play']],
  ['cancelBack', "id === 'cancel') h.titleView = 'main'", "id === 'cancel') h.titleView = 'worlds'", ['cancel']],
  ['escMain', "if (key === 'Escape') { h.titleView = 'main'; return true; }", "if (key === 'Escape') { return true; }", ['esc']],
  ['drawRows', "'world:' + rr.name, 'world'", "'world:' + rr.name, 'row'", ['drawHits']],
  ['drawConfirm', "buttons(SW.confirmLayout(gw, gh))", "void 0", ['drawConf']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = await trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`selectworld11614check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
