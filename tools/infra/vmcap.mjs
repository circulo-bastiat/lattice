// tools/infra/vmcap.mjs - #10414 step 2: the hard memory ceiling on the brain VM while the move to hosted jobs is built.
// Pure plan(); ramwatch.tick() applies it with Set-VMMemory (a live change, dynamic memory only). Cores need the VM off: `manage.cmd cores 4`.
export const MAX_MB = 8192, MIN_FREE_MB = 6144;   // night (02:00-13:00 ET weekdays) used to go to 12 GB
/** rec = the ram.json record. -> {set: MB|null, why}. Lowers the max only; never raises it, never touches a stopped VM. */
export function plan(rec, cap = MAX_MB) {
  if (!rec || !(rec.vmMaxMB > 0)) return { set: null, why: 'no VM' };
  if (rec.vmMaxMB <= cap) return { set: null, why: 'already capped' };
  const floor = Math.max(cap, Math.ceil((rec.vmAssignedMB || 0) / 256) * 256);   // Hyper-V refuses a max below what is assigned
  return { set: floor, why: `max ${rec.vmMaxMB} MB > cap ${cap} MB` };
}
export function psCommand(mb) { return `Get-VM | Select-Object -First 1 | Set-VMMemory -MaximumBytes ${Math.round(mb)}MB`; }

export const MAX_CORES = 4;   // by day it had 6, weekday nights 11
/** rec.vmCores / rec.vmState ('Off'|'Running'|...). -> {set: n|null, why}. Hyper-V changes the count only while the VM is off; lowers only. */
export function planCores(rec, cap = MAX_CORES) {
  if (!rec || !(rec.vmCores > 0)) return { set: null, why: 'no VM' };
  if (rec.vmCores <= cap) return { set: null, why: 'already capped' };
  if (String(rec.vmState) !== 'Off') return { set: null, why: 'VM running: apply at the next stop' };
  return { set: cap, why: `cores ${rec.vmCores} > cap ${cap}` };
}
export function psCoresCommand(n) { return `Get-VM | Select-Object -First 1 | Set-VMProcessor -Count ${Math.round(n)}`; }
