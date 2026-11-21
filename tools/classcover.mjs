// Runtime coverage half of the class map (#11465): which src/ modules actually EXECUTE on the main thread when the built page
// boots, creates a world and plays. Static "wired" (classmap.mjs) over-reads: one live symbol makes a whole module wired.
//   node tools/classcover.mjs [--play seconds=20] [--out tools/classcover.json] [html]
// Output: { modules: { "07_world.js": [functionsRan, functionsTotal], ... } } from V8 precise coverage, split by the build's
// "/* ==== <file> ==== */" banners. CANNOT SEE: worker threads (worldgen/meshing run in blob workers), code that needs input this
// script does not send (GUIs; the dimension tour moves the player with Portal.moveToWorld, not by walking into a portal), and the unminified-only banner split (MIN builds drop no banners, so it holds).
import fs from 'node:fs'; import path from 'node:path';
import { open, sleep, startWorld } from './cdp.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// pure: map function ranges onto banner-delimited modules. fns: [{start,end,ran}], banners: [{name,at}] sorted by at.
export function attribute(fns, banners) {
  const mods = {};
  for (const b of banners) mods[b.name] = [0, 0];
  for (const f of fns) {
    let lo = -1;
    for (let i = 0; i < banners.length; i++) { if (banners[i].at <= f.start) lo = i; else break; }
    if (lo < 0) continue;
    const m = mods[banners[lo].name]; m[1]++; if (f.ran) m[0]++;
  }
  return mods;
}
export function findBanners(text) {
  const out = []; for (const m of text.matchAll(/\/\* ==== (\S+\.js) =+ \*\//g)) out.push({ name: m[1], at: m.index });
  return out;
}
export async function run(file, playSec) {
  const page = await open(file, { port: 9471, width: 640, height: 360 });
  if (!page) return null;
  await sleep(500);
  await page.send('Profiler.enable'); await page.send('Debugger.enable');
  await page.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
  await sleep(1500);
  const visited = [];
  const ok = await startWorld(page);
  if (ok) {
    await page.waitFor(() => MCL.World && MCL.World.stats2 && MCL.World.stats2.meshed > 0, 90000);
    for (const k of ['w', 'a', 's', 'd', ' ', 'e', 'Escape']) { try { await page.key(k); } catch {} await sleep(300); }
    await sleep(playSec * 1000);
    // dimension tour through the real Portal.moveToWorld (the call the portal tick makes); each stop plays a few seconds
    for (const d of ['the_nether', 'the_end', 'overworld']) {
      const moved = await page.evaluate(new Function('try { return MCL.Portal.moveToWorld(MCL.Player, ' + JSON.stringify(d) + '); } catch (e) { return String(e); }'));
      visited.push([d, moved]); await sleep(Math.min(8, playSec) * 1000);
    }
  }
  const cov = await page.send('Profiler.takePreciseCoverage');
  const fns = [];
  for (const s of cov.result) {
    let src = ''; try { src = (await page.send("Debugger.getScriptSource", { scriptId: s.scriptId })).scriptSource; } catch { continue; }
    const banners = findBanners(src); if (banners.length < 20) continue;
    const list = s.functions.map((f) => ({ start: f.ranges[0].startOffset, end: f.ranges[0].endOffset, ran: f.ranges[0].count > 0 }));
    fns.push({ banners, list });
  }
  await page.close();
  const mods = {};
  for (const x of fns) for (const [k, v] of Object.entries(attribute(x.list, x.banners))) { const m = (mods[k] ||= [0, 0]); m[0] += v[0]; m[1] += v[1]; }
  return { world: !!ok, playSec, dimensions: visited, modules: mods };
}
if (import.meta.url === 'file://' + process.argv[1]) {
  const a = process.argv.slice(2), g = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  const html = a.find((x) => x.endsWith('.html')) || path.join(ROOT, 'dist/mclite.html');
  const r = await run(html, Number(g('--play', 20)));
  if (!r) { console.log('SKIP no chrome'); process.exit(0); }
  fs.writeFileSync(path.join(ROOT, g('--out', 'tools/classcover.json')), JSON.stringify(r));
  const ms = Object.entries(r.modules), dead = ms.filter(([, v]) => v[1] && !v[0]).map(([k]) => k);
  console.log(`classcover: world=${r.world}, ${ms.length} modules, ${ms.length - dead.length} ran something, ${dead.length} never ran: ${dead.join(' ')}`);
}
