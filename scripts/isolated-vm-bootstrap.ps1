#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'Boot', 'Verify', 'All')]
    [string]$Action = 'All',
    [ValidateRange(30, 3600)]
    [int]$WaitSeconds = 900
)

# This script owns only this new VM and this dedicated temporary subtree.
# No project executables, shared folders, guest additions, or host service changes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Parent = 'C:\Users\Administrator\AppData\Local\Temp\opencode'
$Root = Join-Path $Parent 'susu155-vm'
$VmName = 'Susu155-IsolatedBuild-20260920'
$VBox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$Ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$Keygen = 'C:\Windows\System32\OpenSSH\ssh-keygen.exe'
$Release = 'https://cloud-images.ubuntu.com/releases/noble/release-20260911/'
$ImageName = 'ubuntu-24.04-server-cloudimg-amd64.vmdk'
# Independently retrieved from the official HTTPS SHA256SUMS before this script ran.
$ExpectedHash = 'c1655a37ff4141e4f16effb7364a640188cc17ec7dfc869a1283aa724dcd6bc1'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Assert-Signed([string]$Path, [string]$Publisher) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch $Publisher) {
        throw "Signature rejected: $Path ($($signature.Status))"
    }
    Write-Host "SIGNATURE Valid $Path"
}

function New-OwnedDirectory([string]$Path) {
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $Path) -PathType Container)) {
        throw "Missing parent: $Path"
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        [void](New-Item -ItemType Directory -Path $Path)
    }
    if ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse point rejected: $Path"
    }
}

function Write-OwnedText([string]$Path, [string]$Text) {
    if (-not $Path.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Write outside owned subtree: $Path"
    }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $Path) -PathType Container)) {
        throw "Missing file parent: $Path"
    }
    [IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"), $Utf8)
}

function Invoke-VBox([string[]]$Arguments) {
    Write-Host ('VBOX ' + ($Arguments -join ' '))
    & $VBox @Arguments
    if ($LASTEXITCODE -ne 0) { throw "VBoxManage exit $LASTEXITCODE : $($Arguments -join ' ')" }
}

function Get-OwnedVmInfo {
    $lines = & $VBox showvminfo $script:State.VmUuid --machinereadable
    if ($LASTEXITCODE -ne 0) { throw 'Owned VM is not registered; no other VM will be used.' }
    $info = $lines -join "`n"
    if ($info -notmatch ('(?m)^name="' + [regex]::Escape($VmName) + '"$')) {
        throw 'VM identity mismatch.'
    }
    return $info
}

function Save-State {
    Write-OwnedText $StatePath ($script:State | ConvertTo-Json -Depth 5)
}

function Download-Official([string]$Url, [string]$Destination) {
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $Destination) -PathType Container)) {
        throw "Missing download parent: $Destination"
    }
    Write-Host "DOWNLOAD $Url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Timeout = 600000
    $request.ReadWriteTimeout = 120000
    $request.UserAgent = 'Susu155-IsolatedVM-Bootstrap/1.0'
    $response = $request.GetResponse()
    if ($response.ResponseUri.Scheme -ne 'https' -or $response.ResponseUri.Host -ne 'cloud-images.ubuntu.com') {
        $response.Dispose()
        throw 'Unexpected download redirect.'
    }
    $source = $response.GetResponseStream()
    $target = [IO.File]::Open($Destination, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $buffer = New-Object byte[] (1024 * 1024)
        [long]$total = 0
        [long]$nextProgress = 32MB
        while (($count = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $target.Write($buffer, 0, $count)
            $total += $count
            if ($total -ge $nextProgress) {
                Write-Host ("Downloaded {0:N0} / {1:N0} bytes" -f $total, $response.ContentLength)
                $nextProgress += 32MB
            }
        }
        if ($response.ContentLength -ge 0 -and $total -ne $response.ContentLength) {
            throw "Incomplete download: $total bytes"
        }
        Write-Host "DOWNLOAD COMPLETE $total bytes"
    } finally {
        $target.Dispose()
        $source.Dispose()
        $response.Dispose()
    }
}

function New-SeedIso {
    Assert-Signed 'C:\Windows\System32\imapi2fs.dll' 'Microsoft'
    Assert-Signed 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' 'Microsoft'
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class Susu155IsoWriter {
    public static void Save(object source, string path) {
        IStream stream = (IStream)source;
        IntPtr read = Marshal.AllocCoTaskMem(4);
        try {
            stream.Seek(0, 0, IntPtr.Zero);
            byte[] bytes = new byte[1024 * 1024];
            using (FileStream file = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) {
                for (;;) {
                    Marshal.WriteInt32(read, 0);
                    stream.Read(bytes, bytes.Length, read);
                    int count = Marshal.ReadInt32(read);
                    if (count == 0) break;
                    file.Write(bytes, 0, count);
                }
                file.Flush(true);
            }
        } finally { Marshal.FreeCoTaskMem(read); }
    }
}
'@
    $image = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    $image.ChooseImageDefaultsForMediaType(12)
    $image.FileSystemsToCreate = 3
    $image.VolumeName = 'cidata'
    $image.Root.AddTree($SeedDir, $false)
    $result = $image.CreateResultImage()
    [Susu155IsoWriter]::Save($result.ImageStream, $Iso)
    Write-Host "SEED ISO $Iso"
}

foreach ($tool in @($VBox, 'C:\Program Files\Oracle\VirtualBox\VBoxHeadless.exe',
        'C:\Program Files\Oracle\VirtualBox\VirtualBoxVM.exe',
        'C:\Program Files\Oracle\VirtualBox\VBoxRT.dll', 'C:\Program Files\Oracle\VirtualBox\VBoxVMM.dll')) {
    Assert-Signed $tool 'Oracle'
}
Assert-Signed $Ssh 'Microsoft'
Assert-Signed $Keygen 'Microsoft'
if (-not (Test-Path -LiteralPath $Parent -PathType Container)) { throw 'Approved temporary parent missing.' }
New-OwnedDirectory $Root
$StatePath = Join-Path $Root 'state.json'
$Image = Join-Path $Root $ImageName
$Disk = Join-Path $Root 'build-root.vdi'
$Iso = Join-Path $Root 'cidata.iso'
$SeedDir = Join-Path $Root 'seed'
$VmBase = Join-Path $Root 'machines'
$Serial = Join-Path $Root 'serial-console.log'
$Key = Join-Path $Root 'builder_ed25519'
$KnownHosts = Join-Path $Root 'known_hosts'

if (Test-Path -LiteralPath $StatePath) {
    $script:State = [IO.File]::ReadAllText($StatePath) | ConvertFrom-Json
    if ($State.VmName -ne $VmName -or $State.Root -ne $Root -or $State.ImageHash -ne $ExpectedHash) {
        throw 'Ownership manifest mismatch.'
    }
} else {
    if ($Action -notin @('All', 'Prepare')) { throw 'Prepare must run first.' }
    $registered = (& $VBox list vms) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $registered.Contains('"' + $VmName + '"')) {
        throw 'VM name already exists or registry unavailable; refusing to reuse it.'
    }
    $script:State = [pscustomobject][ordered]@{
        VmName = $VmName; VmUuid = [guid]::NewGuid().ToString(); Root = $Root
        ImageUrl = $Release + $ImageName; ImageHash = $ExpectedHash
        Disk = $Disk; SeedIso = $Iso; SerialLog = $Serial
        SshHost = '127.0.0.1'; SshPort = 22155; SshUser = 'builder'
        PrivateKey = $Key; KnownHosts = $KnownHosts; HostFingerprint = ''
        Phase = 'initialized'; CreatedUtc = [DateTime]::UtcNow.ToString('o')
    }
    Save-State
}

if ($Action -in @('Prepare', 'All') -and $State.Phase -eq 'initialized') {
    New-OwnedDirectory $SeedDir
    New-OwnedDirectory $VmBase
    if (-not (Test-Path -LiteralPath $Key)) {
        # Start-Process preserves the empty -N value on Windows PowerShell 5.1.
        $keyArgs = '-q -t ed25519 -N "" -C "susu155-ephemeral-builder" -f "' + $Key + '"'
        $process = Start-Process -FilePath $Keygen -ArgumentList $keyArgs -NoNewWindow -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "ssh-keygen exit $($process.ExitCode)" }
    }
    # Restrict this ephemeral private key to its owner. Never print/upload it.
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($owner)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Key -AclObject $acl
    $publicKey = [IO.File]::ReadAllText($Key + '.pub').Trim()
    if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+ ') { throw 'Invalid generated public key.' }

    $sums = Join-Path $Root 'SHA256SUMS'
    Download-Official ($Release + 'SHA256SUMS') $sums
    $hashLine = '(?m)^' + $ExpectedHash + ' \*?' + [regex]::Escape($ImageName) + '\r?$'
    if ([IO.File]::ReadAllText($sums) -notmatch $hashLine) { throw 'Official checksum disagrees with pinned digest.' }
    if (-not (Test-Path -LiteralPath $Image)) {
        $partial = $Image + '.partial'
        Download-Official ($Release + $ImageName) $partial
        $downloadHash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($downloadHash -ne $ExpectedHash) { throw "Image digest mismatch: $downloadHash" }
        Move-Item -LiteralPath $partial -Destination $Image
    }
    $actualHash = (Get-FileHash -LiteralPath $Image -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedHash) { throw "Image digest mismatch: $actualHash" }
    Write-Host "IMAGE SHA256 VERIFIED $actualHash"

    $userData = @'
#cloud-config
hostname: susu155-build
manage_etc_hosts: true
disable_root: true
ssh_pwauth: false
ssh_deletekeys: true
ssh_genkeytypes: [ed25519]
package_update: false
package_upgrade: false
growpart:
  mode: auto
  devices: ['/']
  ignore_growroot_disabled: false
resize_rootfs: true
users:
  - name: builder
    gecos: Ephemeral isolated builder
    groups: [adm, sudo]
    shell: /bin/bash
    lock_passwd: true
    sudo: ['ALL=(ALL) NOPASSWD:ALL']
    ssh_authorized_keys:
      - __PUBLIC_KEY__
write_files:
  - path: /etc/ssh/sshd_config.d/00-isolated-builder.conf
    owner: root:root
    permissions: '0644'
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      PubkeyAuthentication yes
      AllowUsers builder
      AllowAgentForwarding no
      X11Forwarding no
  - path: /usr/local/sbin/isolated-vm-ready
    owner: root:root
    permissions: '0700'
    content: |
      #!/bin/bash
      set -euo pipefail
      if ! swapon --noheadings --show=NAME | grep -q .; then
        if [ ! -e /swapfile ]; then
          fallocate -l 2G /swapfile
          chmod 0600 /swapfile
          mkswap /swapfile
        fi
        swapon /swapfile
        grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
      fi
      systemctl enable --now ssh
      systemctl reload ssh
      printf 'SUSU155_HOSTKEY __VM_UUID__ '
      cut -d ' ' -f 1-2 /etc/ssh/ssh_host_ed25519_key.pub
      ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
      uname -a
      free -h
      df -hT /
      printf 'SUSU155_READY __VM_UUID__\n'
runcmd:
  - [bash, /usr/local/sbin/isolated-vm-ready]
final_message: 'Susu155 isolated VM cloud-init complete after $UPTIME seconds'
'@
    $userData = $userData.Replace('__PUBLIC_KEY__', $publicKey).Replace('__VM_UUID__', $State.VmUuid)
    Write-OwnedText (Join-Path $SeedDir 'user-data') ($userData + "`n")
    Write-OwnedText (Join-Path $SeedDir 'meta-data') ("instance-id: " + $State.VmUuid + "`nlocal-hostname: susu155-build`n")
    Write-OwnedText (Join-Path $SeedDir 'network-config') @'
version: 2
ethernets:
  buildnet:
    match:
      macaddress: '08:00:27:15:50:01'
    dhcp4: true
    dhcp6: false
'@
    if (-not (Test-Path -LiteralPath $Iso)) { New-SeedIso }
    if (-not (Test-Path -LiteralPath $Disk)) {
        Invoke-VBox @('clonemedium', 'disk', $Image, $Disk, '--format', 'VDI', '--variant', 'Standard')
    }
    Invoke-VBox @('modifymedium', 'disk', $Disk, '--resize', '40960')
    Invoke-VBox @('createvm', '--name', $VmName, '--uuid', $State.VmUuid, '--platform-architecture', 'x86',
        '--ostype', 'Ubuntu_64', '--basefolder', $VmBase, '--register')
    $State.Phase = 'registered'
    Save-State
}

if ($Action -in @('Prepare', 'All') -and $State.Phase -eq 'registered') {
    $null = Get-OwnedVmInfo
    Invoke-VBox @('modifyvm', $State.VmUuid, '--memory', '2048', '--cpus', '2', '--vram', '16',
        '--ioapic', 'on', '--firmware', 'bios', '--graphicscontroller', 'vmsvga',
        '--accelerate-3d', 'off', '--paravirt-provider', 'kvm', '--nested-hw-virt', 'off',
        '--boot1', 'disk', '--boot2', 'none', '--boot3', 'none', '--boot4', 'none', '--rtc-use-utc', 'on',
        '--nic1', 'nat', '--nic-type1', '82540EM', '--mac-address1', '080027155001',
        '--cable-connected1', 'on', '--nic-promisc1', 'deny',
        '--nat-pf1', 'builder-ssh,tcp,127.0.0.1,22155,,22', '--nat-localhostreachable1', 'off',
        '--nic2', 'none', '--nic3', 'none', '--nic4', 'none',
        '--clipboard-mode', 'disabled', '--clipboard-file-transfers', 'disabled', '--drag-and-drop', 'disabled',
        '--usb-ohci', 'off', '--usb-ehci', 'off', '--usb-xhci', 'off', '--mouse', 'ps2', '--keyboard', 'ps2',
        '--audio-enabled', 'off', '--vrde', 'off', '--uart1', '0x3F8', '4', '--uart-mode1', 'file', $Serial)
    Invoke-VBox @('storagectl', $State.VmUuid, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci',
        '--portcount', '2', '--hostiocache', 'off', '--bootable', 'on')
    Invoke-VBox @('storageattach', $State.VmUuid, '--storagectl', 'SATA', '--port', '0', '--device', '0',
        '--type', 'hdd', '--medium', $Disk)
    Invoke-VBox @('storageattach', $State.VmUuid, '--storagectl', 'SATA', '--port', '1', '--device', '0',
        '--type', 'dvddrive', '--medium', $Iso)
    $State.Phase = 'prepared'
    Save-State
    Write-OwnedText (Join-Path $Root 'vm-settings.txt') (Get-OwnedVmInfo)
    Write-Host "PREPARED $VmName $($State.VmUuid)"
}

if ($Action -in @('Boot', 'All')) {
    if ($State.Phase -notin @('prepared', 'booting', 'ready')) { throw 'VM is not fully prepared.' }
    $info = Get-OwnedVmInfo
    if ($info -match '(?m)^VMState="poweroff"$') {
        $listener = @(Get-NetTCPConnection -LocalPort 22155 -State Listen -ErrorAction SilentlyContinue)
        if ($listener.Count -ne 0) { throw 'Local port 22155 already has a listener.' }
        $State.Phase = 'booting'
        Save-State
        Invoke-VBox @('startvm', $State.VmUuid, '--type', 'headless')
    } elseif ($info -notmatch '(?m)^VMState="running"$') {
        throw 'VM is neither powered off nor running; leaving its state untouched.'
    }
}

if ($Action -in @('Boot', 'Verify', 'All')) {
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    $hostKey = $null
    $keyPattern = 'SUSU155_HOSTKEY ' + [regex]::Escape($State.VmUuid) + ' (ssh-ed25519 [A-Za-z0-9+/=]+)'
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $Serial) {
            # VirtualBox keeps this serial output file open while the guest runs.
            $stream = [IO.File]::Open($Serial, 'Open', 'Read', 'ReadWrite')
            $reader = New-Object IO.StreamReader($stream)
            try { $console = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $match = [regex]::Match($console, $keyPattern)
            if ($match.Success) { $hostKey = $match.Groups[1].Value; break }
            # cloud-init also publishes its public host key directly to this
            # dedicated local console if a final-stage command fails.
            $standardKey = [regex]::Match($console,
                '-----BEGIN SSH HOST KEY KEYS-----\s+(ssh-ed25519 [A-Za-z0-9+/=]+) root@susu155-build\s+-----END SSH HOST KEY KEYS-----')
            if ($standardKey.Success) { $hostKey = $standardKey.Groups[1].Value; break }
        }
        $info = Get-OwnedVmInfo
        if ($info -notmatch '(?m)^VMState="running"$') { throw 'Guest stopped before publishing its SSH host key.' }
        Write-Host "WAIT serial host key $([DateTime]::UtcNow.ToString('o'))"
        Start-Sleep -Seconds 10
    }
    if (-not $hostKey) { throw "Timed out waiting for serial host key; preserve and inspect $Serial" }
    $knownLine = '[127.0.0.1]:22155 ' + $hostKey + "`n"
    if ((Test-Path -LiteralPath $KnownHosts) -and [IO.File]::ReadAllText($KnownHosts) -ne $knownLine) {
        throw 'Pinned SSH host key changed; refusing to replace it.'
    }
    Write-OwnedText $KnownHosts $knownLine
    $fingerprint = (& $Keygen -lf $KnownHosts -E sha256) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Host key fingerprint calculation failed.' }
    Write-Host "PINNED HOST KEY $fingerprint"
    $State.HostFingerprint = $fingerprint
    Save-State
    $sshArgs = @('-F', 'NUL', '-p', '22155', '-i', $Key,
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
        '-o', 'StrictHostKeyChecking=yes', '-o', ('UserKnownHostsFile=' + $KnownHosts.Replace('\', '/')),
        '-o', 'GlobalKnownHostsFile=NUL', '-o', 'HostKeyAlgorithms=ssh-ed25519',
        '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', '-o', 'LogLevel=ERROR',
        'builder@127.0.0.1')
    $command = 'set -eu; test -f /var/lib/cloud/instance/boot-finished; echo ===UNAME===; uname -a; echo ===MEMORY===; free -h; echo ===ROOTDISK===; df -hT /; lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS; echo ===CLOUD_INIT===; cloud-init status --long || true; echo ===SSH_POLICY===; sudo -n /usr/sbin/sshd -T | grep -E ''^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|allowusers) ''; echo ===IDENTITY===; id; sudo -n true; echo ===GUEST_HOSTKEY===; ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256; echo ===CLOCKSOURCE===; cat /sys/devices/system/clocksource/clocksource0/current_clocksource; echo ===ISOLATED_VM_READY==='
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = @(& $Ssh @sshArgs $command 2>&1)
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previous
        $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        if ($exitCode -eq 0 -and $text.Contains('===ISOLATED_VM_READY===')) {
            Write-OwnedText (Join-Path $Root 'guest-verification.txt') ($text + "`n")
            Write-Host $text
            $ready = $true
            break
        }
        Write-Host "WAIT SSH exit=$exitCode $text"
        Start-Sleep -Seconds 10
    }
    if (-not $ready) { throw 'SSH verification did not complete before deadline; VM retained.' }
    $cloudStatus = [regex]::Match($text, '(?m)^status: (.+)$').Groups[1].Value.Trim()
    $clockSource = [regex]::Match($text, '===CLOCKSOURCE===\s+(\S+)').Groups[1].Value
    $State | Add-Member -NotePropertyName CloudInitStatus -NotePropertyValue $cloudStatus -Force
    $State | Add-Member -NotePropertyName GuestClockSource -NotePropertyValue $clockSource -Force
    $State | Add-Member -NotePropertyName SshReadyUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    if ($cloudStatus -ne 'done') { Write-Warning "SSH is ready, but cloud-init aggregate status is '$cloudStatus'; see guest-verification.txt and original guest logs." }
    $State.Phase = 'ready'
    Save-State
    Write-OwnedText (Join-Path $Root 'vm-settings.txt') (Get-OwnedVmInfo)
    Get-NetTCPConnection -LocalPort 22155 -State Listen | Format-Table LocalAddress, LocalPort, OwningProcess
    Write-Host "READY state=$StatePath"
}
