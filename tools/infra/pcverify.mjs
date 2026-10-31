// #10421 (#10414 D): the DONE-WHEN measurement. Reads the PC's process listing (PowerShell `Get-Process | Format-Table Name,Path` / `Get-CimInstance Win32_Process | Select Name,CommandLine`, one process per line)
// and lists what of MC-Lite is still running: any vmmem, any Runner.Worker, any node whose line mentions the project. Empty list = the PC is off the project.
const PROJECT = /mclite|mc-lite|lattice|usaged|actions-runner|claude-sandbox|brain|_work/i;
export function leftovers(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim(); if (!l) continue;
    const name = l.split(/[\s,"]+/).filter(Boolean)[0] || '';
    if (/^vmmem/i.test(name)) out.push({ kind: 'vmmem', line: l });
    else if (/^Runner\.(Worker|Listener)/i.test(name)) out.push({ kind: 'runner', line: l });
    else if (/^node(\.exe)?$/i.test(name) && PROJECT.test(l)) out.push({ kind: 'node', line: l });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const left = leftovers(fs.readFileSync(process.argv[2] || 0, 'utf8'));
  for (const x of left) console.log(`LEFT ${x.kind}: ${x.line}`);
  console.log(left.length ? `${left.length} project process(es) still run on the PC` : 'PC is off the project: no vmmem, no Runner.Worker, no project node');
  process.exit(left.length ? 1 : 0);
}
