# #10421 — switching the PC off the project (runbook; the tooling is all on master)

Built and checked (pcretirecheck, pcretirescriptcheck, pcverifycheck): `tools/infra/pcretire.mjs` (is each PC piece safe to retire),
`tools/infra/pcretire-script.mjs` (the elevated PowerShell that stops the VM / runners / usaged / phone services),
`tools/infra/pcverify.mjs` (reads `Get-Process vmmem,Runner.Worker,node`, passes only when none is from the project).

Left, and only a person at the PC can do it (nothing here can reach the machine):
1. Set `BRAIN_RUNNER=mirror` and `TEST_RUNNER=mirror` once A-C have run 24 h; `node tools/infra/pcretire.mjs` must say retire for every piece.
2. Run `node tools/infra/pcretire-script.mjs` elevated on PC.
3. Pipe the process list into `pcverify.mjs`; it must print a pass. Then a full day of landed PRs with the PC asleep; close #10421.

Live reading 13 Nov 2026 (`node tools/infra/pcretire.mjs`): RETIRE for all six pieces (brain VM, -land/-land2, phone relay, full-suite GPU runner,
usaged, idle DADS runners): hosted path on and no PC work for 24 h. Step 1 is therefore met; steps 2-3 need a person at the PC.
