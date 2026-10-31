// tools/infra/gate.mjs - THE AUTOMATIC GATE (Dan, 28 Sept: "the check shouldn't be by their own whim, it should
// happen automatically"). build.mjs, suite.mjs and every go.mjs command call gate() before doing anything, so no
// session can build, test or hand in while (a) a message addressed to it is unanswered, or (b) its issue was closed
// or taken over. Nobody has to remember to run a check: making progress at all runs it.
// Cheap: one GitHub read per 30 s at most (cached in .git/mclite-gate.json). Never on the runners (GITHUB_ACTIONS),
// and any failure to reach GitHub lets work continue - a broken gate must never stop the game being built.
import { gitSync } from './gitenv.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statfsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const GB = 1024 ** 3;
const freeGB = (p) => { try { const s = statfsSync(p); return (s.bavail * s.bsize) / GB; } catch { return Infinity; } };

// DISK GUARD (28 Sept: a full C: took the Cowork VM down mid-fix). Stops work BEFORE a disk fills, and says why.
function diskGuard(root) {
  if (process.env.MCLITE_GATE_NODISK) return;                 // gateinfracheck: its cases test mail/yield, not the lander's free space
  const here = freeGB(root);
  if (here < 2) stop(5, `only ${here.toFixed(1)} GB free where this workspace lives (${root}). Nothing more is written until space is freed.`);
  for (const f of [join(root, '..', '_status', 'usage.json')]) {                 // the PC's own C: (usaged records it)
    try { const u = JSON.parse(readFileSync(f, 'utf8')); if (u.diskFreeGB != null && u.diskFreeGB < 8)
      stop(5, `Dan's PC has only ${u.diskFreeGB.toFixed(1)} GB free on its system drive (measured ${u.at}). Tell Dan; do not start builds or tests until it is freed.`); } catch {}
  }
}
function stop(code, why) { console.log(`\n⛔ ${why}\n`); process.exit(code); }

// WORK AUTOSAVE (same night: a session's finished fix lived only inside the VM when the VM died). Every 10 minutes the
// gate snapshots the working tree - committed or not - to wip/<branch> on GitHub, without touching the session's
// index or files. `go.mjs start` restores it for whoever resumes the issue. Nobody has to remember to push.
function autosave(root) {
  const cf = join(root, '.git', 'mclite-claim');
  const cloud = process.platform !== 'win32' && !(process.env.HOME || '').startsWith('/sessions/');   // cloud: pushes only its own branch
  if (!existsSync(cf) || cloud) return;
  const stamp = join(root, '.git', 'mclite-autosave');
  let last = 0; try { last = Number(readFileSync(stamp, 'utf8')); } catch {}
  if (Date.now() - last < 10 * 60e3) return;
  writeFileSync(stamp, String(Date.now()));
  const ref = readFileSync(cf, 'utf8').trim(), idx = join(root, '.git', 'mclite-wip-index');
  const g = (args, env = {}) => gitSync(args, { cwd: root, encoding: 'utf8', env, timeout: 60e3 });
  try {
    const E = { GIT_INDEX_FILE: idx };
    g(['read-tree', 'HEAD'], E); g(['add', '-A', '--', '.', ':!assets', ':!dist', ':!jars', ':!.mcdata', ':!.mcsnd', ':!.chromium', ':!.decomp'], E);
    const tree = g(['write-tree'], E).stdout.trim();
    const c = g(['-c', 'user.name=MC-Lite autosave', '-c', 'user.email=autosave@mclite.invalid', 'commit-tree', tree, '-p', 'HEAD', '-m', `WIP autosave of ${ref} ${new Date().toISOString()}`]).stdout.trim();
    if (c) spawnSync(process.execPath, [join(root, 'tools', 'go.mjs'), 'git-push', `${c}:refs/heads/wip/${ref}`, '--force', '--dir', root],
      { cwd: root, timeout: 90e3, env: { ...process.env, MCLITE_GATE: 'off' } });
  } catch {} finally { try { unlinkSync(idx); } catch {} }
}

export function gate(root) {
  if (process.env.GITHUB_ACTIONS || process.env.MCLITE_GATE === 'off') return;
  const gitDir = join(root, '.git');
  if (!existsSync(join(root, 'tools', 'go.mjs')) || !existsSync(gitDir)) return;
  diskGuard(root);
  autosave(root);
  const cacheF = join(gitDir, 'mclite-gate.json');
  let c = null;
  try { c = JSON.parse(readFileSync(cacheF, 'utf8')); } catch {}
  if (!c || Date.now() - c.at > 30e3) {
    const r = spawnSync(process.execPath, [join(root, 'tools', 'go.mjs'), 'gatecheck', '--dir', root],
      { encoding: 'utf8', timeout: 25e3, env: { ...process.env, MCLITE_GATE: 'off' } });
    try { c = { at: Date.now(), ...JSON.parse(r.stdout.trim().split('\n').pop()) }; } catch { return; }
    try { writeFileSync(cacheF, JSON.stringify(c)); } catch {}
  }
  if (c.yield) {
    console.log(`\n⛔ YIELD - ${c.yield}\nStop work on this issue now. Run: node tools/go.mjs start   (for a new issue)\n`);
    process.exit(4);
  }
  if (c.pending && c.pending.length) {
    const m = c.pending[0];
    console.log(`\n✉ A MESSAGE FOR YOU - answer it before anything else (nothing builds or runs until you do):\n\n   ${m.body.replace(/\n+/g, '\n   ')}\n\n` +
      `Answer: node tools/go.mjs reply ${m.id} "<your answer>" --dir ${root}${c.pending.length > 1 ? `   (${c.pending.length - 1} more waiting)` : ''}\n`);
    process.exit(3);
  }
}
