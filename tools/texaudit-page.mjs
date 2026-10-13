// texaudit-page.mjs — open dist/mclite.html in headless Chromium on a FORCED backend and drive NS.L3Render (src/16z_l3render.js),
// the page-side half of GATE M's L3 pixel audit (#1529). Used by tools/texauditjob.mjs, never by the suite: it needs a browser
// and a minute or more per backend, and a browser is a background-job concern.
//
//   const page = await openAuditPage('webgl2' | 'webgpu', { port, timeoutMs });
//   page.backend   the backend the page ACTUALLY got ('webgl2' | 'webgpu'); a missing WebGPU adapter makes this 'webgl2'
//                  (the game falls back, Gfx.fallbackReason says why, page.fallback carries it) — the caller must compare it
//                  with what it asked for (page.requested) rather than report the pixels as WebGPU's
//   page.render(spec)  -> NS.L3Render.render(spec): { ok, backend, W, H, rgba (base64, row 0 = top), cullMode, error }
//   page.close()
//
// HOW THE BACKEND IS FORCED. The game reads `Settings.backend` ('auto' | 'webgl2' | 'webgpu', persisted in localStorage
// 'mclite.settings') into `Gfx.force` at boot (17_main.js), and `Gfx.init` (10_gfx.js) pins that backend: 'webgl2' directly,
// 'webgpu' tries WebGPU first and falls back to WebGL2 if it cannot start. The page is given that setting by an init script
// that runs BEFORE the page's own scripts (cdp.mjs `initScript`) — the same key Settings.load() reads, nothing else in it.
// The backend is only created once the title's Play runs (Main.play -> boot), which is called here directly, as smoke.mjs does.
// WebGPU in headless Chromium needs --enable-unsafe-webgpu and a software adapter (SwiftShader), both passed as flags.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { open } from './cdp.mjs';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'mclite.html');

/** base64 `rgba` of a render result -> Uint8Array(W*H*4) */
export const decodeRgba = (res) => new Uint8Array(Buffer.from(res.rgba, 'base64'));

export async function openAuditPage(backend, { port, timeoutMs } = {}) {
  if (backend !== 'webgl2' && backend !== 'webgpu') throw new Error('openAuditPage: backend must be webgl2 or webgpu, got ' + backend);
  const budget = timeoutMs || 180000;
  const initScript = 'try{localStorage.setItem("mclite.settings",' + JSON.stringify(JSON.stringify({ backend })) + ');}catch(e){}';
  const flags = backend === 'webgpu' ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] : [];
  const s = await open(FILE, { port, width: 640, height: 400, flags, initScript });
  if (!s) throw new Error('no Chromium found (cdp.mjs)');
  const fail = async (why) => {
    const info = await s.evaluate(() => ({
      problems: null, name: window.MCL && MCL.Gfx ? MCL.Gfx.name : '?', fallback: window.MCL && MCL.Gfx ? MCL.Gfx.fallbackReason : '',
      fatal: (document.getElementById('fatal') || {}).textContent || '',
    })).catch(() => null);
    const msg = `${why} (${backend}; page: ${JSON.stringify(info)}; problems: ${s.problems.slice(0, 5).join(' | ')})`;
    await s.close();
    throw new Error(msg);
  };

  const title = await s.waitFor(() => (window.MCL && MCL.Main && MCL.Main.play && MCL.Hud && MCL.Hud.mode === 'title') ? 1 : 0, budget);
  if (!title) return fail('the page never reached the title screen');
  await s.evaluate(() => { MCL.Main.play({}); return 1; });
  const up = await s.waitFor(() => (window.MCL && MCL.L3Render && MCL.L3Render.ready()) ? 1 : 0, budget);
  if (!up) return fail('NS.L3Render never became ready');

  const info = await s.evaluate(() => ({
    backend: MCL.L3Render.backend(),
    fallback: MCL.Gfx.fallbackReason || '',
    gpuReason: MCL.GfxGPU ? MCL.GfxGPU.failReason : '',
  }));
  if (!info || !info.backend) return fail('ready() but no active backend');

  const render = async (spec) => {
    // only plain data crosses: a mobl3check view also carries its raster arrays, which stay in node
    const v = spec.view;
    const slim = { layer: spec.layer, texKey: spec.texKey, res: spec.res,
                   view: { n: v.n, R: v.R, Up: v.Up, r0: v.r0, u1: v.u1, W: v.W, H: v.H } };
    const r = await s.send('Runtime.evaluate', {
      expression: 'MCL.L3Render.render(' + JSON.stringify(slim) + ')', awaitPromise: true, returnByValue: true,
    });
    if (!r || r.exceptionDetails) {
      const d = r && r.exceptionDetails;
      return { ok: false, backend: info.backend, W: v.W, H: v.H, rgba: '', cullMode: '',
               error: 'page threw: ' + ((d && ((d.exception && d.exception.description) || d.text)) || 'no result') };
    }
    return r.result.value;
  };

  return {
    pid: s.pid, requested: backend, backend: info.backend,
    fallback: info.backend === backend ? '' : [info.fallback, info.gpuReason].filter(Boolean).join(' | '),
    render, problems: s.problems, close: () => s.close(),
  };
}
