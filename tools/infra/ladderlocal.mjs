// ladderlocal.mjs - #4975: the machine-local rungs of tools/infra/ladder.mjs. Each returns a log line when it acted, null when there was nothing to do.
import { readdirSync, rmSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';

export const LOW_GB = 20;
const freeGB = (p) => { try { const s = statfsSync(p); return (s.bavail * s.bsize) / 2 ** 30; } catch { return Infinity; } };
const old = (p, ms, now) => { try { return now - statSync(p).mtimeMs > ms; } catch { return false; } };

/** The brain's no-claim holds (~/.brain/noclaim-*): "nothing claimable" markers that keep a pool idle for 20 min each. */
export const clearNoclaim = (dir) => async () => {
  let gone = [];
  try { gone = readdirSync(dir).filter((f) => f.startsWith('noclaim-')); } catch {}
  for (const f of gone) rmSync(join(dir, f), { force: true });
  return gone.length ? `cleared ${gone.join(', ')}` : null;
};

/** Below LOW_GB free: delete session clones (the mc-N and mclite-work folders) and logs untouched for a day. A clone in use is touched by its session. */
export const freeDisk = ({ roots, logs = [], probe = homedir(), now = Date.now() }) => async () => {
  const f = freeGB(probe);
  if (f >= LOW_GB) return null;
  let n = 0;
  for (const r of roots) { let ds = []; try { ds = readdirSync(r); } catch {} for (const d of ds) if (old(join(r, d), 86400e3, now)) { rmSync(join(r, d), { recursive: true, force: true }); n++; } }
  for (const l of logs) { let fs = []; try { fs = readdirSync(l); } catch {} for (const x of fs) if (old(join(l, x), 2 * 86400e3, now)) { rmSync(join(l, x), { recursive: true, force: true }); n++; } }
  return `${f.toFixed(1)} GB free: removed ${n} stale folder(s)/log(s), now ${freeGB(probe).toFixed(1)} GB`;
};
export const diskRungVM = () => freeDisk({ roots: [join(tmpdir(), `mc-${process.getuid?.() ?? 'x'}`), join(homedir(), 'mc-work')], logs: [join(process.env.BRAIN_HOME || join(homedir(), '.brain'), 'logs')] });

/** The VM's runner services. #5105 (11 Oct): this rung runs INSIDE a brain job on one of those runners, so restarting the runner services killed the
 *  very pass that ran it - the ladder state was never saved, every later pass climbed to this rung again and killed itself before fill()
 *  (no worker 06:49Z-15:10Z). A runner that is running this code is alive; dead runners are the PC watcher's job (vmwatch restarts the VM).
 *  So on the VM this rung never restarts anything. */
export const restartRunners = () => async () => null;
