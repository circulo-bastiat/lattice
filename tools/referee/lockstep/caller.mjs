// caller.mjs - #9324 (Dan, 21 Oct: "i told it to leave my pc, why is my memory and cpu hammered"): orphaned lockstep pilots.
// prelaunch.mjs ran `suite --only lockstep-X` with a 540 s spawnSync timeout; the timeout killed suite.mjs only, so the check, its
// pilot and up to 3 Minecraft servers (2 cores, 1.5 GB each) ran on with ppid 1 after the run that wanted them had ended
// (3 such trees found on the brain VM at 19:00Z). A pilot now watches its caller: when its parent OR grandparent dies
// (re-parented away from what it started under), it kills every salt's whole process tree and exits.
import { readFileSync, readdirSync } from 'node:fs';

/** Parent pid of `pid` read from /proc (Linux); null when unreadable (gone, or no /proc: Windows/macOS). */
export function ppidOf(pid, read = (p) => readFileSync(p, 'utf8')) {
  try { const s = read(`/proc/${pid}/stat`); return Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]); } catch { return null; }
}
/** The caller is gone when our parent changed, or our parent's parent changed (a killed suite.mjs leaves the check orphaned).
 *  g0 null = /proc unreadable at start: only the parent is watched (never a false kill on a platform without /proc). */
export function callerLost({ p0, g0, ppid, gpid }) {
  if (ppid !== p0) return true;
  return g0 !== null && gpid !== g0;
}
/** Every descendant of `pid` (from /proc), deepest first. */
export function descendants(pid, list = () => readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number), pp = ppidOf) {
  const kids = new Map();
  for (const p of list()) { const q = pp(p); if (q !== null) { if (!kids.has(q)) kids.set(q, []); kids.get(q).push(p); } }
  const out = [], walk = (p) => { for (const c of kids.get(p) || []) { walk(c); out.push(c); } };
  walk(pid); return out;
}
/** SIGKILL `pid`, its process group and every descendant (a JVM a salt started in its own group included). */
export function killTree(pid, kill = process.kill.bind(process)) {
  let all = []; try { all = descendants(pid); } catch { /* no /proc */ }
  for (const p of [...all, pid]) { try { kill(p, 'SIGKILL'); } catch { /* gone */ } }
  try { kill(-pid, 'SIGKILL'); } catch { /* not a group leader */ }
}
/** Watch the caller every `ms`; `onLost` runs once when it is gone. Also runs `onLost` on SIGTERM/SIGINT/SIGHUP. */
export function watchCaller(onLost, ms = 5000) {
  const p0 = process.ppid, g0 = ppidOf(p0); let done = false;
  const fire = (why) => { if (done) return; done = true; try { onLost(why); } finally { process.exit(why === 'caller' ? 1 : 143); } };
  setInterval(() => { if (callerLost({ p0, g0, ppid: process.ppid, gpid: ppidOf(p0) })) fire('caller'); }, ms).unref();
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => fire(s));
}
