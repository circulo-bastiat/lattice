// tools/infra/browserslots.mjs - #3921: the HOST BROWSER BUDGET. Every headless browser a runner starts takes a slot from
// a counter shared by ALL processes on the host (the full-suite and both land runners), so Dan's PC never runs more than
// `host.maxBrowsers` at once nor starts one under `host.minFreeGB` of free RAM. A slot is a file in
// os.tmpdir()/mclite-browsers named slot<i> (created with 'wx': atomic, so ten racing opens cannot exceed the cap) holding
// the owning process, the browser pid and the start time. reap() kills the browser of any slot whose owner is gone or older
// than 15 min and deletes the file: it never touches a browser that has no slot (Dan's own).
import { tmpdir, freemem, platform } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const DIR = join(process.env.MCLITE_BROWSER_DIR || tmpdir(), 'mclite-browsers');
export const MAX_AGE_MS = 15 * 60e3;
const roles = (() => { try { return JSON.parse(readFileSync(new URL('../brain/roles.json', import.meta.url), 'utf8')).host || {}; } catch { return {}; } })();
// every host is capped (#1935: the 6-core brain VM, several runners' browsers at once, starved the game into 'never reached the game'); only the RAM floor is Windows-only
export const limits = () => ({
  cap: Number(process.env.MCLITE_BROWSER_CAP) || (roles.maxBrowsers || 3),
  floorGB: process.env.MCLITE_MIN_FREE_GB !== undefined ? Number(process.env.MCLITE_MIN_FREE_GB) : (platform() === 'win32' ? roles.minFreeGB ?? 4 : 0),
  waitMs: Number(process.env.MCLITE_BROWSER_WAIT_MS) || 10 * 60e3,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const killTree = (pid) => { try { if (platform() === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };
const read = (f) => { try { return JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { return null; } };
export const slots = () => { try { return readdirSync(DIR).filter((f) => /^slot\d+$/.test(f)); } catch { return []; } };

/** Kill the browsers of dead/overdue owners. -> how many were reaped. `kill` is injectable for the check. */
export function reap({ now = Date.now(), kill = killTree, isAlive = alive } = {}) {
  let n = 0;
  for (const f of slots()) {
    const s = read(f);
    if (s && isAlive(s.owner) && now - s.start < MAX_AGE_MS) continue;
    if (s && s.browser) { kill(s.browser); n++; }
    if (s && s.dir) try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { unlinkSync(join(DIR, f)); } catch { /* raced */ }
  }
  return n;
}

/** Wait for a free slot and free RAM. -> release(). No governor (cap 0) -> a no-op release. Throws the host-load signature. */
export async function acquire(opts = {}) {
  const L = { ...limits(), ...opts };
  if (!L.cap) return Object.assign(() => {}, { attach() {} });
  mkdirSync(DIR, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    reap();
    if (freemem() >= L.floorGB * 2 ** 30) {
      for (let i = 0; i < L.cap; i++) {
        const f = join(DIR, 'slot' + i);
        try { writeFileSync(f, JSON.stringify({ owner: process.pid, browser: null, start: Date.now() }), { flag: 'wx' }); }
        catch { continue; }
        const release = () => { try { unlinkSync(f); } catch { /* already reaped */ } };
        release.attach = (browser, dir) => { try { writeFileSync(f, JSON.stringify({ owner: process.pid, browser, dir, start: Date.now() })); } catch { /* reaped */ } };
        process.once('exit', release);
        return release;
      }
    }
    if (Date.now() - t0 > L.waitMs) throw new Error(`never reached the game: host browser budget (cap ${L.cap}, ${slots().length} live, free ${(freemem() / 2 ** 30).toFixed(1)} GB, floor ${L.floorGB} GB) did not open in ${L.waitMs / 1000}s`);
    await sleep(L.poll || 1000);
  }
}

/** One evidence line for the runner logs (#3921 part 4). */
export const evidence = (reaped = 0) => `host: free RAM ${(freemem() / 2 ** 30).toFixed(1)} GB, live browsers ${slots().length}, reaped ${reaped}`;
export function logEvidence(tag, root) {
  const line = `${new Date().toISOString()} ${tag} ${evidence(reap())}`;
  console.log(line);
  try { const d = join(root, '_status'); mkdirSync(d, { recursive: true }); appendFileSync(join(d, `runner-${process.env.RUNNER_NAME || 'local'}.log`), line + '\n'); } catch { /* log is best effort */ }
}
