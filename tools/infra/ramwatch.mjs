// tools/infra/ramwatch.mjs - #10414 step 1: what the PC's RAM/CPU is spent on, per consumer, readable by a Linux session.
// usaged.mjs calls tick() every 5 min on the host. Windows only (PowerShell); elsewhere it skips. Publishes
// <Projects>/_status/ram.json and the repo variable MCLITE_RAM. Numbers only: no command lines, no account names.
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gh, projectsDirs } from './gh.mjs';
import { plan, psCommand, planCores, psCoresCommand } from './vmcap.mjs';

const PS = `$ErrorActionPreference='SilentlyContinue'
$os=Get-CimInstance Win32_OperatingSystem
$p=Get-Process
$g=@{vm=0;lander=0;browser=0;java=0;node=0}
$cpu=@{vm=0;lander=0;browser=0;java=0;node=0}
foreach($x in $p){ $k=switch -Regex ($x.ProcessName){'^vmmem'{'vm'} 'chrome|chromium|msedge|headless_shell|firefox'{'browser'} '^java'{'java'} '^node'{'node'} 'Runner\\.(Listener|Worker)'{'lander'}}
 if($k){$g[$k]+=$x.WorkingSet64/1MB; $cpu[$k]+=$x.CPU} }
$vm=Get-VM | Select-Object -First 1
[pscustomobject]@{totalMB=[int]($os.TotalVisibleMemorySize/1KB);freeMB=[int]($os.FreePhysicalMemory/1KB);
 cpuPct=[int](Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue;
 mb=$g; cpuSec=$cpu; vmAssignedMB=[int]($vm.MemoryAssigned/1MB); vmMaxMB=[int]($vm.MemoryMaximum/1MB); vmCpuPct=$vm.CPUUsage; vmState=[string]$vm.State; vmCores=[int](Get-VMProcessor -VMName $vm.Name).Count} | ConvertTo-Json -Compress`;

export async function tick() {
  if (process.platform !== 'win32') return { skipped: 'not Windows' };
  const r = spawnSync('powershell', ['-NoProfile', '-Command', PS], { encoding: 'utf8', timeout: 60e3 });
  let rec; try { rec = JSON.parse(r.stdout); } catch { return { skipped: 'ram read failed' }; }
  rec.at = new Date().toISOString();
  const cap = plan(rec);   // #10414 step 2
  if (cap.set) { spawnSync('powershell', ['-NoProfile', '-Command', psCommand(cap.set)], { encoding: 'utf8', timeout: 60e3 }); rec.vmMaxMB = cap.set; }
  const cores = planCores(rec);   // only acts while the VM is off
  if (cores.set) { spawnSync('powershell', ['-NoProfile', '-Command', psCoresCommand(cores.set)], { encoding: 'utf8', timeout: 60e3 }); rec.vmCores = cores.set; }
  const dir = projectsDirs().map((d) => join(d, '_status'))[0];
  if (dir) { mkdirSync(dir, { recursive: true }); const f = join(dir, 'ram.json'); writeFileSync(f + '.tmp', JSON.stringify(rec)); renameSync(f + '.tmp', f); }
  const value = JSON.stringify(rec);
  const u = await gh('PATCH', '/repos/{repo}/actions/variables/MCLITE_RAM', { name: 'MCLITE_RAM', value }, { ok404: true });
  if (u === null) await gh('POST', '/repos/{repo}/actions/variables', { name: 'MCLITE_RAM', value });
  return { freeMB: rec.freeMB, vmMB: rec.mb?.vm };
}
