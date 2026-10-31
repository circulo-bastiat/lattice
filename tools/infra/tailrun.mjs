// #10490: run a command, and when it fails throw an error that carries the tail of its output
// (prepDir used stdio:'ignore', so a failed asset build left only "Command failed").
import { spawnSync } from 'node:child_process';

export const tailLines = (s, n = 40) => String(s || '').split('\n').filter((l, i, a) => l.length || i < a.length - 1).slice(-n).join('\n');

export function runTail(cmd, args, opts = {}, n = 40) {
  const r = spawnSync(cmd, args, { ...opts, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) {
    const why = r.error ? String(r.error.message) : `exit ${r.status}${r.signal ? ' ' + r.signal : ''}`;
    throw new Error(`Command failed (${why}): ${cmd} ${args.join(' ')}\n--- last ${n} lines ---\n${tailLines((r.stdout || '') + (r.stderr || ''), n)}`);
  }
  return r;
}
