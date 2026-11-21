#!/usr/bin/env node
// worldsstorecheck.mjs — #11245: two worlds with different seeds/edits stay separate through reload,
// in the BUILT dist/mclite.html at file:// (IndexedDB 'mclite.worlds', src/16c_worlds.js).
// Also: the single pre-store save is migrated to world 1 'New World' with its edits.
// Anti-vacuity: breaks copies of the built page (mirror writer, migration, open swap) and requires red.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { open, sleep } from './cdp.mjs';

const DIST = resolve('dist/mclite.html');
const E = (c) => new Function(c);
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log((m.startsWith('✓') ? '   ' : 'ok    ') + m); } else { fails.push(m); console.log('FAIL  ' + m); } return !!c; };

async function up(page) {
  await sleep(1200);
  await page.evaluate(() => { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  return page.waitFor(() => !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20), 180000);
}
async function reload(page) {
  await page.evaluate(() => { setTimeout(() => location.reload(), 10); return 1; });
  await sleep(2500);
  return up(page);
}
const EDIT = (x, id) => E(`var S=MCL.Save,W=MCL.World;var y=100;W.setBlock(${x},y,5,MCL.Reg.id[${JSON.stringify(id)}]);S.save(false);
  return MCL.Worlds.ready.then(function(){return new Promise(function(r){setTimeout(r,600)});}).then(function(){return S.count;});`);
const STATE = E(`var S=MCL.Save,W=MCL.World;return MCL.Worlds.list().then(function(l){return {seed:String(S.seed64),a:W.getBlock(10,100,5),b:W.getBlock(20,100,5),count:S.count,active:MCL.Worlds.active(),worlds:l.map(function(r){return [r.id,r.name,r.seed]})};});`);

/** the whole scenario against one html file; returns true iff every assertion held */
async function scenario(file, port, quiet) {
  var say = quiet ? () => {} : console.log;
  const local = []; const a = (c, m) => { if (!c) local.push(m); if (!quiet) ok(c, m); return c; };
  const page = await open(file, { port, width: 640, height: 400 });
  if (!page) { console.log('SKIP  worldsstorecheck: no Chromium'); process.exit(0); }
  try {
    if (!(await up(page))) { local.push('never up'); return local; }
    const stone = await page.evaluate(() => MCL.Reg.id.stone), dirt = await page.evaluate(() => MCL.Reg.id.dirt);
    await page.evaluate(EDIT(10, 'stone'));              // world 1: edit at x=10
    const s1 = await page.evaluate(STATE);
    a(s1.worlds.length === 1 && s1.worlds[0][1] === 'New World', 'the single save was migrated to world 1 "New World"');
    const A = s1.active, seedA = s1.seed;
    const B = await page.evaluate(E(`return MCL.Worlds.create({name:'Second',seed:777,gameMode:'creative'});`));
    await page.evaluate(E(`return MCL.Worlds.open(${JSON.stringify(B)}).then(function(){return 1});`));
    await reload(page);
    let s = await page.evaluate(STATE);
    say(JSON.stringify(s));
    a(s.active === B && s.seed === '777', 'world B opens with its own seed after reload');
    a(s.a !== stone, 'world B does not carry world A\'s edit');
    await page.evaluate(EDIT(20, 'dirt'));
    await page.evaluate(E(`return MCL.Worlds.open(${JSON.stringify(A)}).then(function(){return 1});`));
    await reload(page);
    s = await page.evaluate(STATE);
    a(s.active === A && s.seed === seedA, 'world A reopens with its own seed');
    a(s.a === stone && s.b !== dirt, 'world A keeps its edit and lacks B\'s');
    a(s.worlds.length === 2, 'both worlds listed (' + s.worlds.length + ')');
    await page.evaluate(E(`return MCL.Worlds.open(${JSON.stringify(B)}).then(function(){return 1});`));
    await reload(page);
    s = await page.evaluate(STATE);
    a(s.b === dirt && s.a !== stone && s.seed === '777', 'world B keeps its edit through a second reload');
    // rename / duplicate / delete
    const r = await page.evaluate(E(`var W=MCL.Worlds;return W.rename(${JSON.stringify(A)},'Renamed').then(function(){return W.duplicate(${JSON.stringify(A)})}).then(function(id){return W.remove(id).then(function(){return W.list()})}).then(function(l){return l.map(function(x){return x.name})});`));
    a(r.length === 2 && r.indexOf('Renamed') >= 0, 'rename + duplicate + delete behave (' + r.join('|') + ')');
  } catch (e) { local.push('threw ' + e.message); }
  finally { await page.close(); }
  return local;
}

const real = await scenario(DIST, 9461, false);
real.forEach((m) => ok(false, m));
// ---- anti-vacuity: break the built page three ways
const html = readFileSync(DIST, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'wsc-'));
const mutants = [
  ['the mirror writer call removed', 'if (NS.Worlds) NS.Worlds.mirror(payload,', 'if (false) NS.Worlds.mirror(payload,'],
  ['the migration init removed', 'if (NS.Worlds) NS.Worlds.init();', 'if (false) NS.Worlds.init();'],
  ['open() no longer installs the payload', 'if (rec.payload) ls(NS.Save.KEY, rec.payload); else ls(NS.Save.KEY, null);', ''],
];
let n = 0;
for (const [name, from, to] of mutants) {
  if (!html.includes(from)) { ok(false, 'mutant target missing: ' + name); continue; }
  const f = join(dir, 'm' + n + '.html'); writeFileSync(f, html.replace(from, to));
  const bad = await scenario(f, 9462 + n, true); n++; breaks++;
  ok(bad.length > 0, '✓ break caught: ' + name + (bad.length ? ' (' + bad[0] + ')' : ''));
}
console.log(`${breaks} breaks caught`);
console.log(fails.length ? `FAIL ${fails.length}` : `PASS ${pass} checks`);
process.exit(fails.length ? 1 : 0);
