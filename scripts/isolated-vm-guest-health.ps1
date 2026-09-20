#requires -Version 5.1
[CmdletBinding()]
param([switch]$RepairClock, [switch]$FinishBootstrap)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = 'C:\Users\Administrator\AppData\Local\Temp\opencode\susu155-vm'
$Ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$sig = Get-AuthenticodeSignature -LiteralPath $Ssh
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Microsoft') { throw 'SSH signature rejected.' }
$State = [IO.File]::ReadAllText((Join-Path $Root 'state.json')) | ConvertFrom-Json
if ($State.VmUuid -ne '4c49765c-bae9-409e-a67f-c05c0427d2c1') { throw 'Wrong VM identity.' }
$argsSsh = @('-F', 'NUL', '-p', '22155', '-i', (Join-Path $Root 'builder_ed25519'),
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
    '-o', 'StrictHostKeyChecking=yes', '-o', ('UserKnownHostsFile=' + (Join-Path $Root 'known_hosts').Replace('\', '/')),
    '-o', 'GlobalKnownHostsFile=NUL', '-o', 'HostKeyAlgorithms=ssh-ed25519',
    '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3',
    'builder@127.0.0.1')
$guest = @'
set -eu
echo ===CLOCK_BEFORE===
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
cat /sys/devices/system/clocksource/clocksource0/available_clocksource
date -u
if [ __REPAIR_CLOCK__ = 1 ]; then
  if grep -qw acpi_pm /sys/devices/system/clocksource/clocksource0/available_clocksource; then
    printf 'acpi_pm\n' > /sys/devices/system/clocksource/clocksource0/current_clocksource
    # Keep both requested vCPUs without using the unstable NEM/KVM per-vCPU clock.
    printf 'GRUB_CMDLINE_LINUX="${GRUB_CMDLINE_LINUX} clocksource=acpi_pm tsc=unstable"\n' > /etc/default/grub.d/99-isolated-vm-clock.cfg
    update-grub
    date -u -s '__HOST_UTC__'
    systemctl restart systemd-timesyncd
  else
    echo ACPI_PM_UNAVAILABLE
    exit 1
  fi
fi
echo ===CLOCK_AFTER===
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
date -u
echo ===CLOUD_FINAL_JOURNAL===
journalctl -u cloud-final.service -b --no-pager -n 70
echo ===RUNCMD===
cat /var/lib/cloud/instance/scripts/runcmd
echo ===READY_SCRIPT===
cat /usr/local/sbin/isolated-vm-ready
echo ===CLOUD_ERRORS===
grep -n -E 'runcmd|scripts_user|Traceback|ProcessExecutionError|Exit code|Unexpected error' /var/log/cloud-init.log | tail -n 45
if [ __FINISH_BOOTSTRAP__ = 1 ]; then
  # cloud-init already mirrors output to the console. Avoid direct tty writes
  # during serial-getty startup; preserve original error logs for diagnosis.
  sed -i '\|^exec > /dev/ttyS0 2>&1$|d; s/^systemctl restart ssh$/systemctl reload ssh/' /usr/local/sbin/isolated-vm-ready
  echo ===RERUN_BOOTSTRAP===
  cloud-init single --name scripts_user --frequency always
  # cloud-init retains the first-run error in its aggregate status even after
  # this explicit successful retry. Do not erase history just to make it green.
  echo ===BOOTSTRAP_RETRY_SUCCEEDED===
fi
echo ===MONOTONIC_CLOCK===
cat /proc/uptime
sleep 5
cat /proc/uptime
cat /sys/devices/system/clocksource/clocksource0/current_clocksource
echo ===FAILED_GUEST_UNITS===
systemctl --failed --no-pager
echo ===HEALTH_END===
'@
$guest = $guest.Replace('__REPAIR_CLOCK__', [int]$RepairClock.IsPresent).Replace('__FINISH_BOOTSTRAP__', [int]$FinishBootstrap.IsPresent).Replace('__HOST_UTC__', [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss'))
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($guest -replace "`r`n", "`n")))
& $Ssh @argsSsh "echo $payload | base64 -d | sudo -n bash"
if ($LASTEXITCODE -ne 0) { throw "Guest health command exit $LASTEXITCODE" }
