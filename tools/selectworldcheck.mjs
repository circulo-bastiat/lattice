#!/usr/bin/env node
// selectworldcheck.mjs — #11229: SELECT WORLD / EDIT WORLD / delete ConfirmScreen, driven with REAL clicks and key events in the
// BUILT dist/mclite.html at file:// (IndexedDB 'mclite.worlds'). Two worlds are created through Singleplayer -> Create New World -> Create world,
// edited, listed (name/date/mode), searched, played (own seed + own edits), renamed, deleted (with confirm) and re-created.
// ANTI-VACUITY: six mutated copies of the built page (dispatch, screen, writer, play, delete, search removed) must each fail the scenario.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { open, sleep } from './cdp.mjs';

const DIST = resolve('dist/mclite.html');
const E = (c) => new Function(c);
let pass = 0; const fails = [];

async function scenario(file, port, quiet) {
  const page = await open(file, { port, width: 900, height: 600 });
  if (!page) { console.log('SKIP  selectworldcheck: no Chromium'); process.exit(0); }
  const a = (c, m) => { if (!c) throw new Error(m); if (!quiet) { pass++; console.log('ok    ' + m); } };
  const title = async () => { await sleep(2500); await page.waitFor(() => !!(window.MCL && MCL.Main.titleShown && MCL.Hud.mode === 'title' && MCL.Hud.titleView === 'main'), 60000); };
  const playing = async () => { await sleep(3000); const r = await page.waitFor(() => !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20), 240000); if (!r) throw new Error('world never came up'); };
  const click = async (label, must = true) => {
    const r = await page.evaluate(new Function('return (' + `(() => { const h = MCL.Hud.hit.find((q) => q.label === ${JSON.stringify(label)}); return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2, d: !!h.disabled } : null; })()` + ')'));
    if (!r) { if (must) throw new Error('no "' + label + '" on screen: ' + await page.evaluate(() => MCL.Hud.mode + '/' + MCL.Hud.titleView + ' ' + MCL.Hud.hit.map((q) => q.label).join(',') + ' ' + (() => { try { MCL.Hud.hit = []; MCL.SelectWorld.draw(MCL.Hud.ctx, MCL.Hud.w, MCL.Hud.h, MCL.Hud.scale); return 'drawok'; } catch (e) { return e.stack + JSON.stringify(MCL.SelectWorld.list); } })())); return false; }
    await page.click(r.x, r.y); await sleep(350); return true;
  };
  const view = () => page.evaluate(() => MCL.Hud.titleView);
  const worlds = () => page.evaluate(() => MCL.Worlds.list().then((l) => l.map((r) => ({ id: r.id, name: r.name, seed: r.seed, mode: r.gameMode, t: r.lastPlayed }))));
  const shown = () => page.evaluate(() => MCL.SelectWorld.list.map((r) => r.name));
  const typeKeys = async (s) => { for (const ch of s) await page.key(ch, ch); await sleep(100); };
  const edit = (x, id) => E(`var S=MCL.Save,W=MCL.World;W.setBlock(${x},100,5,MCL.Reg.id[${JSON.stringify(id)}]);S.save(false);
    return MCL.Worlds.ready.then(function(){return new Promise(function(r){setTimeout(r,800)});}).then(function(){return 1;});`);
  const STATE = E(`var S=MCL.Save,W=MCL.World;return {seed:String(S.seed64),a:W.getBlock(10,100,5),b:W.getBlock(20,100,5),stone:MCL.Reg.id.stone,dirt:MCL.Reg.id.dirt};`);
  const reload = async () => { await page.evaluate(() => { setTimeout(() => location.reload(), 10); return 1; }); };
  const openSP = async () => { await click('Singleplayer'); a((await view()) === 'worlds', 'Singleplayer opens Select World'); await sleep(400); };
  const createWorld = async (seed) => {
    await openSP(); await click('Create New World'); a((await view()) === 'create', 'Create New World opens the create panel');
    await page.evaluate(E(`MCL.Hud.titleSeed=${JSON.stringify(seed)};return 1;`));
    await click('Create New World'); await playing();
  };
  try {
    await title();
    await openSP();
    a((await page.evaluate(() => MCL.SelectWorld.list.length)) === 0, 'no worlds before any is created');
    await page.key('Escape'); await sleep(200); a((await view()) === 'main', 'Escape returns to the title');
    // two worlds through the real path
    await createWorld('4242');
    await page.evaluate(edit(10, 'stone'));
    await reload(); await title();
    await createWorld('777');
    await page.evaluate(edit(20, 'dirt'));
    await reload(); await title();
    const ws = await worlds();
    a(ws.length === 2, 'two worlds stored (' + ws.length + ')');
    a(ws.some((w) => w.seed === '4242') && ws.some((w) => w.seed === '777'), 'each world has its own seed');
    a(ws.every((w) => w.mode !== undefined && w.mode !== null && w.t > 0), JSON.stringify(ws) + ' each world has a game mode and a last-played date');
    await openSP();
    const names = await shown();
    a(names.length === 2 && names[0] !== names[1], 'both worlds list (' + names.join(' | ') + ')');
    const n1 = ws.find((w) => w.seed === '4242').name, n2 = ws.find((w) => w.seed === '777').name;
    a(await page.evaluate(() => MCL.Hud.hit.filter((h) => h.id === 'world').length === 2), 'two list rows are clickable');
    // search box
    await typeKeys('zzzz'); a((await shown()).length === 0, 'search "zzzz" matches nothing');
    for (let i = 0; i < 4; i++) await page.key('Backspace');
    await sleep(100);
    await typeKeys('(2)'); a((await shown()).length === 1, 'search "(2)" filters to one world (' + (await shown()).join('|') + ')');
    for (let i = 0; i < 3; i++) await page.key('Backspace');
    await sleep(100); a((await shown()).length === 2, 'clearing the search restores both');
    a(!(await page.evaluate(() => MCL.Hud.hit.find((h) => h.id === 'play').disabled === false)), 'Play Selected World is inactive with nothing selected');
    // select + play world 1 (seed 4242, stone at x=10)
    await click('world:' + n1); await click('Play Selected World'); await playing();
    let st = await page.evaluate(STATE);
    a(st.seed === '4242' && st.a === st.stone && st.b !== st.dirt, 'Play Selected World loads the 4242 world with its edit and not the other\'s');
    await reload(); await title(); await openSP();
    await click('world:' + n2); await click('Play Selected World'); await playing();
    st = await page.evaluate(STATE);
    a(st.seed === '777' && st.b === st.dirt && st.a !== st.stone, 'Play Selected World loads the 777 world with its own edit');
    await reload(); await title(); await openSP();
    // edit: rename
    await click('world:' + n2); await click('Edit'); a((await view()) === 'editworld', 'Edit opens Edit World');
    for (let i = 0; i < 40; i++) await page.key('Backspace');
    await typeKeys('Renamed'); await click('Save'); await sleep(500);
    a((await view()) === 'worlds' && (await shown()).includes('Renamed'), 'rename shows in the list');
    a((await worlds()).some((w) => w.name === 'Renamed' && w.seed === '777'), 'rename is stored on the right world');
    // delete with confirm
    await click('world:Renamed'); await click('Delete'); a((await view()) === 'confirmdelete', 'Delete opens the confirm screen');
    await click('Cancel'); a((await view()) === 'worlds' && (await worlds()).length === 2, 'cancelling the confirm deletes nothing');
    await click('Delete'); await click('Delete'); await sleep(500);
    const after = await worlds();
    a(after.length === 1 && after[0].name === n1, 'confirmed delete removes only that world');
    // re-create world 1: same seed, fresh edits
    await click('world:' + n1); await click('Re-Create'); await playing();
    st = await page.evaluate(STATE);
    a(st.seed === '4242' && st.a !== st.stone, 'Re-Create builds a new world with the same seed and no edits');
    await page.evaluate(edit(11, 'dirt'));
    a((await worlds()).length === 2, 'Re-Create keeps the original and adds a world');
  } catch (e) { fails.push((quiet ? 'caught: ' : '') + e.message); return e.message; }
  finally { await page.close(); }
  return null;
}

const real = await scenario(DIST, 9471, false);
if (real) { console.log('FAIL selectworldcheck: ' + real); process.exit(1); }
const html = readFileSync(DIST, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'swc-'));
const mutants = [
  ['the Singleplayer dispatch removed', "if (NS.SelectWorld) NS.SelectWorld.open(); else H.titleView = 'create';", "H.titleView = 'create';"],
  ['the Select World screen removed', 'return NS.SelectWorld.draw(c, H.w, H.h, s);', 'return T.draw(c, H.w, H.h, s);'],
  ['the world writer call removed', 'if (NS.Worlds) NS.Worlds.mirror(payload,', 'if (false) NS.Worlds.mirror(payload,'],
  ['Play no longer installs the chosen world', 'return NS.Worlds.open(id).then(function () {', 'return Promise.resolve().then(function () {'],
  ['Delete no longer removes', 'return NS.Worlds.remove(id).then(function () { SW.confirm', 'return Promise.resolve().then(function () { SW.confirm'],
  ['the search filter removed', '!q || r.name.toLowerCase()', 'true || r.name.toLowerCase()'],
];
let caught = 0, n = 0;
for (const [name, from, to] of mutants) {
  if (!html.includes(from)) { fails.push('mutant target missing: ' + name); continue; }
  const f = join(dir, 'm' + n + '.html'); writeFileSync(f, html.split(from).join(to));
  const bad = await scenario(f, 9472 + n++, true);
  if (bad) { caught++; console.log('  ✓ break caught: ' + name + ' (' + bad + ')'); fails.pop(); } else fails.push('break NOT caught: ' + name);
}
console.log(`selectworldcheck: ${pass} assertions, ${caught} breaks caught`);
if (fails.length) { console.log('FAIL selectworldcheck'); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log('PASS selectworldcheck');
