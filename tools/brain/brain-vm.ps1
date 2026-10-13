# brain-vm.ps1 - repair the Ubuntu sandbox VM after its folder moved into Projects, size it for the brain, and run
# brain-vm-setup.sh inside it (#86). Run elevated by BRAIN-SETUP.cmd. Idempotent. Log: _status\brain-vm.log
$ErrorActionPreference = 'Continue'
$Proj = Split-Path -Parent $PSScriptRoot
$TV   = Join-Path $Proj 'tentativevirtualmachine'
$Name = 'claude-sandbox'
Start-Transcript -Path (Join-Path $Proj '_status\brain-vm.log') -Force | Out-Null
function Ok($m){ Write-Host "[ok] $m" }  function Bad($m){ Write-Host "FAILED $m" }
Write-Host "== brain-vm $(Get-Date -Format s) root=$TV"

# 1. vm-state.json still names the old folder (Downloads\tentativevirtualmachine) - point it at this one
$sf = Join-Path $TV 'host\vm-state.json'
$st = Get-Content $sf -Raw | ConvertFrom-Json
$st.root = $TV; $st.keyPath = Join-Path $TV 'host\keys\claudevm_ed25519'; $st.knownHosts = Join-Path $TV 'host\keys\known_hosts'
$st | ConvertTo-Json | Set-Content $sf -Encoding UTF8; Ok 'vm-state.json points at Projects'

# 2. the VM itself: registered? disks where they are now?
$vm = Get-VM -Name $Name -ErrorAction SilentlyContinue
if (-not $vm) {
  $vmcx = Get-ChildItem (Join-Path $TV "vm\$Name") -Recurse -Filter *.vmcx -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($vmcx) { try { Import-VM -Path $vmcx.FullName -Register -ErrorAction Stop | Out-Null; Ok "re-registered $Name" } catch { Bad "Import-VM: $_" } }
  else { Bad "no $Name VM and no .vmcx under vm\$Name - run tentativevirtualmachine\1-INSTALL.cmd"; Stop-Transcript; exit 1 }
  $vm = Get-VM -Name $Name
}
if ($vm.State -ne 'Off') { Stop-VM -Name $Name -Force -ErrorAction SilentlyContinue }
foreach ($d in Get-VMHardDiskDrive -VMName $Name) {
  if (Test-Path $d.Path) { Ok "disk ok $($d.Path)"; continue }
  $new = Join-Path (Join-Path $TV 'vm') (Split-Path $d.Path -Leaf)
  if (-not (Test-Path $new)) { Bad "disk missing: $($d.Path) (not at $new either)"; continue }
  if ($new -like '*.avhdx') { try { Set-VHD -Path $new -ParentPath (Join-Path $TV "vm\$Name.vhdx") -ErrorAction Stop; Ok 'checkpoint disk re-parented' } catch { Bad "Set-VHD: $_" } }
  Set-VMHardDiskDrive -VMHardDiskDrive $d -Path $new; Ok "disk -> $new"
}
# 3. size: 4 workers + a commander need more than the 2 vCPU / 8 GB it was built with
Set-VMProcessor -VMName $Name -Count 6
Set-VMMemory -VMName $Name -DynamicMemoryEnabled $true -MaximumBytes 12GB -ErrorAction SilentlyContinue
Set-VM -Name $Name -AutomaticStartAction Start -AutomaticStopAction Save -ErrorAction SilentlyContinue   # comes back after a reboot
try { Start-VM -Name $Name -ErrorAction Stop; Ok 'VM started (6 vCPU, up to 12 GB)' } catch { Bad "Start-VM: $_"; Stop-Transcript; exit 1 }

# 4. the bridge task still runs the old folder's bridge.ps1 - re-register it here
$task = 'ClaudeVM Bridge'
Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
$act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$TV\host\bridge.ps1`""
$prn = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $task -Action $act -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Principal $prn -Settings $set | Out-Null
Start-ScheduledTask -TaskName $task; Ok 'bridge re-registered at Projects\tentativevirtualmachine'

# 5. wait for the guest's IP, then push the secrets + setup script and run it
$ip = $null
for ($i = 0; $i -lt 60 -and -not $ip; $i++) { Start-Sleep 3; $ip = (Get-VMNetworkAdapter -VMName $Name).IPAddresses | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1 }
if (-not $ip) { Bad 'the VM never got an IP (3 min)'; Stop-Transcript; exit 1 }
$st.guestIp = $ip; $st | ConvertTo-Json | Set-Content $sf -Encoding UTF8; Ok "guest ip $ip"
$ssh = @('-i', $st.keyPath, '-o', "UserKnownHostsFile=$($st.knownHosts)", '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')
$u = "claude@$ip"
& ssh @ssh $u 'mkdir -p ~/brain-secrets/tokens'
& scp @ssh (Join-Path $Proj '_secrets\github-token.txt') "${u}:brain-secrets/github-token"
Get-ChildItem (Join-Path $Proj '_secrets\brain-tokens') -Filter *.txt -ErrorAction SilentlyContinue | ForEach-Object { & scp @ssh $_.FullName "${u}:brain-secrets/tokens/$($_.Name)" }
& scp @ssh (Join-Path $Proj '_setup\brain-vm-setup.sh') "${u}:brain-secrets/vm-setup.sh"
$pw = Join-Path $TV 'host\keys\guest-password.txt'; if (Test-Path $pw) { & scp @ssh $pw "${u}:brain-secrets/sudo-pass" }
& ssh @ssh $u 'bash ~/brain-secrets/vm-setup.sh 2>&1 | tail -40; echo ntfy topic: $(cat ~/.brain/ntfy-topic)'
if ($LASTEXITCODE -eq 0) { Ok 'brain set up in the VM' } else { Bad "vm-setup.sh exit $LASTEXITCODE" }
Write-Host '== ntfy: install the free "ntfy" app on your iPhone and subscribe to the topic printed above'
Stop-Transcript | Out-Null
