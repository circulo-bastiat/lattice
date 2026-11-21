// vmcapcheck (#10414): the VM memory cap lowers an over-cap max, never raises, never goes below assigned; each rule is then broken.
import { plan, psCommand, MAX_MB, planCores, MAX_CORES, psCoresCommand } from './infra/vmcap.mjs';
function verdict(p) {
  const bad = [];
  if (p({ vmMaxMB: 12288, vmAssignedMB: 4000 }).set !== MAX_MB) bad.push('12 GB max not lowered to the cap');
  if (p({ vmMaxMB: 4096, vmAssignedMB: 2000 }).set !== null) bad.push('a max under the cap was raised');
  if (p({ vmMaxMB: MAX_MB, vmAssignedMB: 2000 }).set !== null) bad.push('a max at the cap was rewritten');
  if (p({ vmMaxMB: 12288, vmAssignedMB: 10000 }).set < 10000) bad.push('cap set below the assigned memory');
  if (p(null).set !== null || p({ vmMaxMB: 0 }).set !== null) bad.push('no VM still produced an action');
  if (!/Set-VMMemory -MaximumBytes 8192MB/.test(psCommand(8192))) bad.push('powershell command wrong');
  return bad;
}
function coreVerdict(p) {
  const bad = [];
  if (p({ vmCores: 6, vmState: 'Off' }).set !== MAX_CORES) bad.push('6 cores on a stopped VM not lowered');
  if (p({ vmCores: 11, vmState: 'Running' }).set !== null) bad.push('core change attempted on a running VM');
  if (p({ vmCores: 2, vmState: 'Off' }).set !== null) bad.push('core count was raised');
  if (p(null).set !== null) bad.push('no VM produced a core action');
  if (!/Set-VMProcessor -Count 4/.test(psCoresCommand(4))) bad.push('core powershell wrong');
  return bad;
}
const breaks = [
  (r) => ({ ...plan(r), set: r && r.vmMaxMB ? 99999 : null }),
  (r) => ({ set: r && r.vmMaxMB ? MAX_MB : null }),
  (r) => (r && r.vmMaxMB > 0 ? { set: Math.min(MAX_MB, r.vmAssignedMB - 1000) } : { set: null }),
  (r) => ({ set: r ? MAX_MB : 1 }),
];
const cbreaks = [
  (r) => ({ set: r && r.vmCores ? MAX_CORES : null }),
  (r) => ({ set: r && r.vmCores > 0 ? 8 : null }),
  (r) => ({ set: r && r.vmCores > MAX_CORES ? MAX_CORES : r && r.vmCores ? 8 : null }),
  (r) => ({ set: r ? MAX_CORES : 1 }),
];
const bad = [...verdict(plan), ...coreVerdict(planCores)]; bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach((b, i) => { if (verdict(b).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
cbreaks.forEach((b, i) => { if (coreVerdict(b).length) caught++; else console.log('NOT CAUGHT: core break #' + (i + 1)); });
console.log(`vmcapcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length + cbreaks.length})`);
process.exit(bad.length || caught < breaks.length + cbreaks.length ? 1 : 0);
