#!/usr/bin/env node
// serverconfig11751check.mjs — #11751: src/02q_serverconfig.js (net/minecraft/server config lists, progress logger).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02q_serverconfig.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.ServerConfig; }
function scenario(C) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const a = { id: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' }, b = { id: '853c80ef-3c37-49fd-aa49-938b674adae6', name: 'jeb_' };
  // ban list: round trip, expiry, defaults
  const st = { text: null }, bl = C.BannedPlayerList(st);
  bl.add(C.BannedPlayerEntry(a, null, null, null, 'griefing'));
  bl.add(C.BannedPlayerEntry(b, null, 'Server', new Date(Date.now() - 1000), null));
  chk(JSON.parse(st.text)[0].expires === 'forever' && JSON.parse(st.text)[0].reason === 'griefing', 'forever/reason written');
  chk(JSON.parse(st.text)[0].source === '(Unknown)', 'default source');
  const bl2 = C.BannedPlayerList(st); bl2.load();
  chk(bl2.contains(a) && bl2.get(a).reason === 'griefing', 'reload keeps ban');
  chk(bl2.get(b) === undefined && !bl2.contains(b), 'expired ban dropped on get');
  chk(bl2.getNames().join() === 'Notch', 'getNames after expiry: ' + bl2.getNames());
  chk(C.parseDate(C.formatDate(new Date(1e12))).getTime() === 1e12, 'date round trip');
  // reload of an entry with a bad uuid is skipped
  const bad = { text: JSON.stringify([{ uuid: 'zz', name: 'x' }, { uuid: a.id, name: 'Notch' }]) }, wl = C.Whitelist(bad); wl.load();
  chk(wl.isAllowed(a) && wl.values().length === 1, 'bad uuid entry skipped');
  // ops
  const ol = C.OperatorList({ text: null }); ol.add(C.OperatorEntry(a, 4, true)); ol.add(C.OperatorEntry(b, 2, false));
  chk(ol.canBypassPlayerLimit(a) && !ol.canBypassPlayerLimit(b), 'bypass');
  const o2 = C.OperatorList(ol.store); o2.load(); chk(o2.get(a).getPermissionLevel() === 4, 'op level reload');
  chk(C.OperatorEntry.fromJson({ uuid: a.id, name: 'x' }).permissionLevel === 0, 'op level default 0');
  // ip list
  const ip = C.BannedIpList({ text: null }); ip.add(C.BannedIpEntry('1.2.3.4'));
  chk(ip.isBanned('/1.2.3.4:25565') && !ip.isBanned('/1.2.3.5:1'), 'ip stringify');
  chk(C.BannedIpEntry('9.9.9.9').reason === 'Banned by an operator.', 'default reason');
  ip.remove('1.2.3.4'); chk(ip.isEmpty(), 'remove');
  // progress logger
  let t = 1000; const msgs = [], g = C.WorldGenerationProgressLogger(1, () => t, (m) => msgs.push(m));
  g.start(); for (let i = 0; i < 4; i++) g.setChunkStatus(null, 'full');
  chk(g.getProgressPercentage() === 44, 'progress 4/9 = 44, got ' + g.getProgressPercentage());
  t = 1100; g.setChunkStatus(null, 'full'); t = 1200; g.setChunkStatus(null, 'full'); chk(msgs.length === 1 && /55/.test(msgs[0]), 'one message, 500ms apart: ' + msgs);
  t = 1600; g.setChunkStatus(null, 'full'); chk(msgs.length === 2, 'second message after 500ms');
  t = 1700; g.stop(); chk(/700 ms/.test(msgs[2]), 'elapsed');
  let ran = 0; C.ServerTask(5, () => ran++).run(); chk(ran === 1, 'ServerTask');
  // queueing listener: deferred through the executor, order kept
  const tasks = [], seen = [], ql = C.QueueingWorldGenerationProgressListener.create({ start: (p) => seen.push('s' + p), setChunkStatus: (p, st) => seen.push(st), stop: () => seen.push('x') }, (t) => tasks.push(t));
  ql.start(7); ql.setChunkStatus(1, 'full'); ql.stop();
  chk(seen.length === 0 && tasks.length === 1, 'queue defers until executor runs');
  tasks.shift()(); chk(seen.join() === 's7,full,x', 'queue order: ' + seen);
  // server metadata round trip
  const md = C.ServerMetadata(); md.setDescription({ text: 'hi' }); const pl = C.ServerMetadata.Players(20, 3); pl.setSample([a]); md.setPlayers(pl); md.setVersion(C.ServerMetadata.Version('1.18.2', 758)); md.setFavicon('data:x');
  const js = JSON.parse(JSON.stringify(C.ServerMetadata.toJson(md))), md2 = C.ServerMetadata.fromJson(js);
  chk(js.version.protocol === 758 && js.players.sample[0].name === 'Notch', 'metadata json shape');
  chk(md2.getPlayers().getPlayerLimit() === 20 && md2.getPlayers().getSample()[0].id === a.id && md2.getVersion().getGameVersion() === '1.18.2' && md2.getFavicon() === 'data:x', 'metadata round trip');
  let thr = false; try { C.ServerMetadata.fromJson({ players: { max: 1 } }); } catch (e) { thr = true; } chk(thr, 'missing online throws');
  const mp = {}, ls = C.ServerConfigHandler.processSimpleListFile('# c\nFoo|a|b\n\n  Bar \n', mp);
  chk(ls.length === 5 && mp.foo.join() === 'Foo,a,b' && mp.bar && !mp['# c'], 'processSimpleListFile');
  const dd = new Date(5); chk(C.ServerConfigHandler.parseDate('garbage', dd) === dd, 'parseDate fallback');
  const L = C.LanServerPinger, an = L.createAnnouncement('Hi', '1.2.3.4:25565');
  chk(an === '[MOTD]Hi[/MOTD][AD]1.2.3.4:25565[/AD]', 'announcement');
  chk(L.parseAnnouncementMotd(an) === 'Hi' && L.parseAnnouncementAddressPort(an) === '1.2.3.4:25565', 'announcement parse');
  chk(L.parseAnnouncementMotd('x') === 'missing no' && L.parseAnnouncementMotd('[MOTD]abc') === 'missing no' && L.parseAnnouncementAddressPort('[MOTD]a[/MOTD]') === null, 'announcement bad');
  chk(L.parseAnnouncementAddressPort(an + an) === null, 'two MOTDs rejected');
  // chase protocol
  const H = C.Chase;
  chk(H.teleportCommand('o', 1.005, 64, -3.14159, 90, -45.5) === 't o 1.01 64.00 -3.14 90.00 -45.50\n', 'chase command HALF_UP: ' + H.teleportCommand('o', 1.005, 64, -3.14159, 90, -45.5));
  chk(H.fmtF(9.995, 2) === '10.00' && H.fmtF(0.125, 2) === '0.13', 'fmtF carry');
  const gp = H.getTeleportPosition([{ dimension: 'minecraft:the_end', x: 1, y: 2, z: 3, yaw: 4, pitch: 5 }, { dimension: 'minecraft:overworld' }]);
  chk(gp && gp.dimensionName === 'e' && H.getTeleportPosition([]) === null && H.getTeleportPosition([{ dimension: 'x:y' }]) === null, 'chase position pick');
  chk(H.parseMessage('t n 1.5 64 2 10 20') === '/execute in minecraft:the_nether run tp @s 1.500 64.000 2.000 10.000 20.000', 'chase parse: ' + H.parseMessage('t n 1.5 64 2 10 20'));
  const w = []; chk(H.parseMessage('t z 1 2 3 4 5') === null && H.parseMessage('q a', (m) => w.push(m)) === null && /Unknown message type 'q'/.test(w[0]) && H.parseMessage('t o 1 2', (m) => w.push(m)) === null && /Could not parse/.test(w[1]) && H.parseMessage('', () => {}) === null, 'chase parse rejects');
  chk(H.parseMessage('t o 0.1 0 0 0 0') === '/execute in minecraft:overworld run tp @s 0.100 0.000 0.000 0.000 0.000', 'chase float32 path');
  const FL = C.FunctionLoader, errs = [];
  const fm = FL.load([{ ns: 'minecraft', path: 'functions/a/b.mcfunction', lines: ['say hi'] }, { ns: 'p', path: 'functions/bad.mcfunction', lines: ['x'] }, { ns: 'p', path: 'functions/readme.txt', lines: [] }], (id, l) => { if (l[0] === 'x') throw new Error('boom'); return l.length; }, (m) => errs.push(m));
  chk(fm.size === 1 && fm.get('minecraft:a/b') === 1 && errs.length === 1 && /p:bad/.test(errs[0]), 'function loader id map/skip failed: ' + [...fm.keys()]);
  const DC = C.DataPackContents, SL = C.SaveLoader;
  chk(DC.getContents().join() === 'tags,loot_conditions,recipes,loot_tables,loot_functions,functions,advancements', 'datapack contents order');
  const res1 = {}, r1 = SL.ofLoaded(res1, () => { throw new Error('x'); });
  const res2 = {}, r2 = SL.ofLoaded(res2, () => 5);
  chk(!r1.ok && res1.closed === true && r2.ok && !res2.closed && (SL.close(r2), res2.closed === true), 'saveloader close on failure');
  const IS = C.IntegratedServer, IP = C.IntegratedPlayerManager, ist = { forcedGameMode: 'x' };
  IS.setDefaultGameMode(ist, 1);
  chk(ist.forcedGameMode === null && ist.defaultGameMode === 1, 'integrated setDefaultGameMode');
  chk(IS.isHost('DAN', 'dan') && !IS.isHost('x', null) && IS.OP_PERMISSION_LEVEL === 2 && IS.VIEW_DISTANCE === 10 && IS.adjustTrackingDistance(0.5, 7) === 3, 'integrated rules');
  const ud = { userData: 'old' };
  chk(IP.checkCanJoin('Dan', 'dan', ['Dan']) === 'multiplayer.disconnect.name_taken' && IP.checkCanJoin('Dan', 'dan', []) === null, 'name taken');
  chk(IP.savePlayerData(ud, 'dan', 'dan', 'new') === 'new' && IP.savePlayerData(ud, 'o', 'dan', 'z') === 'new', 'userData host only');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline:\n ' + base.join('\n ')); process.exit(1); }
const cuts = [
  (s) => s.replace("e.isInvalid = function () { return this.expiryDate == null ? false : this.expiryDate.getTime() < Date.now(); };", ''),
  (s) => s.replace("'Banned by an operator.' : reason", "'' : reason"),
  (s) => s.replace("if (!UUID_RE.test(String(j.uuid))) return null;", ''),
  (s) => s.replace("e.permissionLevel = j.level !== undefined ? j.level | 0 : 0;", 'e.permissionLevel = 1;'),
  (s) => s.replace("a.substring(0, a.indexOf(':'))", 'a'),
  (s) => s.replace('next += 500', 'next += 5000'),
  (s) => s.replace("generated * 100 / total", "generated * 100 / (total + 1)"),
  (s) => s.replace("'forever' :", "'never' :"),
  (s) => s.replace("if (!busy) { busy = true; executor(drain); }", 'executor(drain);'),
  (s) => s.replace("if (m.players.sample && m.players.sample.length > 0)", 'if (false)'),
  (s) => s.replace("protocol: m.version.protocolVersion", 'protocol: 0'),
  (s) => s.replace("l.charAt(0) !== '#' && ", ''),
  (s) => s.replace("catch (e) { return dflt; }", "catch (e) { return new Date(0); }"),
  (s) => s.replace("return b < a ? 'missing no'", "return false ? 'missing no'"),
  (s) => s.replace("if (s.indexOf('[/MOTD]', a + 7) >= 0) return null;", ''),
  (s) => s.replace("fp.charCodeAt(n) >= 53", "fp.charCodeAt(n) > 53"),
  (s) => s.replace("fmtF(f[3], 3) + ' ' + fmtF(f[4], 3)", "fmtF(f[4], 3) + ' ' + fmtF(f[3], 3)"),
  (s) => s.replace("if (t[0] !== 't') {", "if (false) {"),
  (s) => s.replace("{ o: 'minecraft:overworld', n:", "{ o: 'minecraft:overworld', n: 'x', m:"),
  (s) => s.replace("path.substring(10, path.length - 11)", "path.substring(9, path.length - 11)"),
  (s) => s.replace("if (!C.FunctionLoader.isFunctionPath(r.path)) return;", ''),
  (s) => s.replace("'loot_conditions', 'recipes'", "'recipes', 'loot_conditions'"),
  (s) => s.replace("catch (e) { resources.closed = true;", "catch (e) {"),
  (s) => s.replace("catch (e) { (logError", "catch (e) { throw e; (logError"),
  (s) => s.replace("st.forcedGameMode = null;", ''),
  (s) => s.replace("VIEW_DISTANCE: 10", 'VIEW_DISTANCE: 12'),
  (s) => s.replace("online.indexOf(name) >= 0)", 'false)'),
  (s) => s.replace("if (name === single) st.userData", 'if (true) st.userData'),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply', c.toString()); process.exit(1); } let r; try { r = scenario(load(s2)).length; } catch (e) { r = 1; } if (r) caught++; else console.log('uncaught cut', c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS serverconfig11751check — ' + caught + ' breaks caught');
