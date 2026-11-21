#!/usr/bin/env node
// spectator11611check.mjs — #11611: proves 15k_spectatormenu.js (TeleportSpectatorMenu) incl. reachability from 15_hud.js, with source breaks.
// #11725: also proves RootSpectatorCommandGroup (root teleport entry, enabled only with players), SpectatorMenuState (page/selected),
// SpectatorMenuCommand (prev/next/close/blank slots), SpectatorMenuCommandGroup (root->teleport switch), SpectatorMenuCloseCallback (onClose),
// TeleportToSpecificPlayerSpectatorCommand (onTeleport after confirm). The team-teleport menu class is not ported and is deliberately not cited.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const NS = {}; const o = {};
  let s = readFileSync(join(ROOT, 'src', '15k_spectatormenu.js'), 'utf8'); if (patch) s = patch(s);
  new Function('MCL', s)(NS);
  const SM = NS.SpectatorMenu;
  const ps = [{ id: 'b', name: 'B', mode: 0 }, { id: 'a', name: 'A', mode: 1 }, { id: 's', name: 'S', mode: 3 }];
  for (let i = 0; i < 8; i++) ps.push({ id: 'p' + i, name: 'P' + i, mode: 0 });
  let closed = 0, tp = [];
  const m = SM.make(ps, () => closed++, (p) => tp.push(p.id));
  o.filter = m.list.length === 10 && !m.list.some((c) => c.player.id === 's');
  o.sorted = m.list[0].player.id === 'a' && m.list[1].player.id === 'b';
  o.rootEn = m.root[0].enabled === true && SM.make([], null, null).root[0].enabled === false;
  o.slots = m.command(8).id === 'close' && m.command(7).id === 'next' && m.command(0).id === 'teleport';
  m.use(0); o.selFirst = m.selected === 0 && m.group === 'root';
  m.use(0); o.group = m.group === 'teleport' && m.page === 0 && m.selected === -1;
  o.nextEn = m.command(7).enabled === true && m.command(0).player.id === 'a';
  m.use(7); m.use(7); o.page1 = m.page === 1 && m.command(0).id === 'prev';
  o.page1b = m.command(1).player && m.command(1).player.id === m.list[7].player.id && m.command(7).enabled === false;
  m.use(0); m.use(0); o.prev = m.page === 0;
  m.use(1); o.noTpFirst = tp.length === 0; m.use(1); o.tp = tp.join() === 'b';
  m.use(8); m.use(8); o.close = closed === 1;
  o.blank = m.command(5).id !== 'blank' && SM.make([], null, null).command(3) === SM.BLANK;
  o.T = SM.T.teleport === 'spectatorMenu.teleport' && SM.PAGE === 6;
  const hud = readFileSync(join(ROOT, 'src', '15_hud.js'), 'utf8');
  o.reach = /NS\.SpectatorMenu/.test(hud) && hud.includes('H.drawSpectatorMenu');
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['spectFilter', 'p.mode !== 3', 'p.mode !== 2', ['filter']],
  ['sortOrder', '(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)', '(a.id > b.id ? -1 : a.id < b.id ? 1 : 0)', ['sorted']],
  ['rootEnabled', 'enabled: list.length > 0', 'enabled: true', ['rootEn']],
  ['pageSize', 'const PAGE = 6;', 'const PAGE = 5;', ['page1b', 'T']],
  ['nextEnabled', 'k < cmds().length', 'true', ['page1b']],
  ['confirmTwice', 'm.selected !== i || !c.enabled', 'false', ['selFirst', 'noTpFirst']],
  ['prevPage', 'm.page--;', 'm.page++;', ['prev']],
  ['closeCb', 'onClose(m)', 'void 0', ['close']],
  ['teleportCb', 'onTeleport(c.player)', 'void 0', ['tp']],
  ['groupSwitch', "m.group = 'teleport'", "m.group = 'root'", ['group']],
  ['closeSlot', "i === 8) return { id: 'close'", "i === 7) return { id: 'close'", ['slots']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`spectator11611check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
