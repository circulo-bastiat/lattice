// tools/infra/hostload.mjs - #1632: is a red suite red because the PC ran out of memory/CPU, not because of the PR?
// The lander re-runs such a suite (after a pause) before it bounces a PR for it. 2 Oct 18:37Z: five PRs bounced at
// once with dozens of unrelated checks dying on "Zone Allocation failed" while ~10 brain runs started together.
export const HOST_LOAD = /Zone Allocation failed|VirtualAlloc failed|process out of memory|JavaScript heap out of memory|\bENOMEM\b|never reached the game|ECONNREFUSED 127\.0\.0\.1|Cannot allocate memory/i;
export const isHostLoad = (out) => HOST_LOAD.test(String(out || ''));
export const RETRIES = 2;            // extra attempts after the first red
export const PAUSE_MS = 120000;      // let the burst of runs finish before the next attempt
export const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
// run(): the suite once -> { status, stdout, stderr }. Returns the last result; `log` hears each retry.
export function withHostRetry(run, { log = () => {}, pause = PAUSE_MS, retries = RETRIES, wait = sleep } = {}) {
  let r = run(), tries = 0;
  while (r.status && isHostLoad((r.stdout || '') + (r.stderr || '')) && tries < retries) {
    tries++; log(`host-load signature in a red run; waiting ${pause / 1000}s and running again (${tries}/${retries})`);
    wait(pause); r = run();
  }
  r.retries = tries;
  return r;
}
