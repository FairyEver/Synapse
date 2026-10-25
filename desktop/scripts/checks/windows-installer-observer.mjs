import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"

export function nativeInstallExpression() {
  return `(()=>{
    'use strict';
    const req=process.mainModule.require.bind(process.mainModule);const u=req('./services/update-service.js').updateService;
    if(u.getState().status!=='downloaded'||!u.installQuitHandlers?.canQuit())throw new Error('Production safe-quit gate rejected installation');
    const au=req('electron-updater').autoUpdater;const cp=req('node:child_process');const original=cp.spawn;
    const installerPath=au.installerPath;const elevatePath=req('node:path').join(process.resourcesPath,'elevate.exe');
    const isAdminRightsRequired=Boolean(au.downloadedUpdateHelper?.downloadedFileInfo?.isAdminRightsRequired);let observed=null;
    cp.spawn=function(...args){
      const startedAt=new Date().toISOString();const child=Reflect.apply(original,this,args);
      const kind=args[0]===installerPath?'installer':args[0]===elevatePath&&args[1]?.[0]===installerPath?'elevate':null;
      if(kind&&Number.isInteger(child.pid)&&child.pid>0)observed={pid:child.pid,startedAt,executablePath:args[0],kind};
      return child;
    };
    try{u.installQuitHandlers.allowQuit();au.quitAndInstall(true,true);return{isAdminRightsRequired,process:observed};}
    finally{cp.spawn=original;}
  })()`
}

const snapshotScript = String.raw`
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$owned = [System.Collections.Generic.List[object]]::new(); $root = $null
if ($env:SYNAPSE_ACCEPTANCE_INSTALLER_PID) {
  $submitted = [datetime]::Parse($env:SYNAPSE_ACCEPTANCE_INSTALLER_STARTED).ToUniversalTime()
  $rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate,CommandLine)
  $root = $rows | Where-Object { $_.ProcessId -eq [uint32]$env:SYNAPSE_ACCEPTANCE_INSTALLER_PID -and $_.ExecutablePath -ieq $env:SYNAPSE_ACCEPTANCE_INSTALLER_PATH -and $_.CreationDate -and [math]::Abs((([datetime]$_.CreationDate).ToUniversalTime() - $submitted).TotalMilliseconds) -le 5000 } | Select-Object -First 1
  if ($root) {
    $owned.Add($root)
    for ($index = 0; $index -lt $owned.Count; $index++) {
      if ($owned.Count -gt 256) { throw 'Owned process snapshot exceeds its limit' }
      $parent = $owned[$index]
      foreach ($row in $rows) {
        if ($row.ParentProcessId -eq $parent.ProcessId -and $row.CreationDate -and $row.CreationDate -ge $parent.CreationDate -and -not ($owned | Where-Object { $_.ProcessId -eq $row.ProcessId })) { $owned.Add($row) }
      }
    }
  }
}
$processes = @(foreach ($row in $owned) {
  $phase = 'other'
  if ($row.Name -imatch '^(powershell|pwsh)\.exe$') {
    foreach ($candidate in @('Get-Command','Get-ExecutionPolicy','Get-CimInstance')) { if ($row.CommandLine -imatch "\b$candidate\b") { $phase = $candidate; break } }
  }
  [pscustomobject]@{ pid = [uint32]$row.ProcessId; parentPid = [uint32]$row.ParentProcessId; name = $row.Name; startedAt = ([datetime]$row.CreationDate).ToUniversalTime().ToString('o'); phase = $phase }
})
$expectedDirectory = [IO.Path]::GetDirectoryName($env:SYNAPSE_ACCEPTANCE_EXE)
$registry = @(foreach ($hive in @('CurrentUser','LocalMachine')) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Enum]::Parse([Microsoft.Win32.RegistryHive], $hive), [Microsoft.Win32.RegistryView]::Registry64)
  $install = $null; $uninstall = $null
  try {
    $install = $base.OpenSubKey('Software\2a4aabde-040e-5b45-84b5-788fcece040c')
    $uninstall = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\2a4aabde-040e-5b45-84b5-788fcece040c')
    $locationMatches = $null; $uninstallMatches = $null; $version = $null
    if ($install) { $locationMatches = [string]::Equals([string]$install.GetValue('InstallLocation'), $expectedDirectory, [StringComparison]::OrdinalIgnoreCase) }
    if ($uninstall) {
      $match = [regex]::Match([string]$uninstall.GetValue('UninstallString'), '^"([^"]+)"')
      $uninstallMatches = $match.Success -and [string]::Equals([IO.Path]::GetDirectoryName($match.Groups[1].Value), $expectedDirectory, [StringComparison]::OrdinalIgnoreCase)
      $version = $uninstall.GetValue('DisplayVersion')
    }
    [pscustomobject]@{ hive = $hive; installLocationMatches = $locationMatches; uninstallLocationMatches = $uninstallMatches; displayVersion = $version }
  } finally { if ($install) { $install.Dispose() }; if ($uninstall) { $uninstall.Dispose() }; $base.Dispose() }
})
$rootStatus = 'not-observed'; $reason = 'identity-not-observed'
if (-not $env:SYNAPSE_ACCEPTANCE_INSTALLER_PID) { $reason = 'no-submitted-pid' }
if ($root) { $rootStatus = 'observed'; $reason = $null }
[pscustomobject]@{ snapshotAt = [datetime]::UtcNow.ToString('o'); rootStatus = $rootStatus; reason = $reason; processes = $processes; registry = $registry } | ConvertTo-Json -Compress -Depth 5
`

function exactFields(value, fields) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Malformed installer snapshot object")
  assert.deepEqual(Object.keys(value).sort(), fields.sort(), "Unexpected installer snapshot fields")
}

export function observeNativeInstaller(submission, executable, env, execute = spawnSync) {
  const identity = submission?.process
  try {
    assert.ok(submission && typeof submission.isAdminRightsRequired === "boolean" && (identity === null || (Number.isInteger(identity?.pid) && identity.pid > 0 && identity.pid <= 0xffffffff && Number.isFinite(Date.parse(identity.startedAt)) && typeof identity.executablePath === "string" && path.win32.isAbsolute(identity.executablePath) && ["installer", "elevate"].includes(identity.kind))), "Invalid installer submission")
    assert.ok(typeof executable === "string" && path.win32.isAbsolute(executable), "Invalid installer submission executable")
  } catch (cause) { throw new Error("Invalid installer submission", { cause }) }
  const startedAt = new Date().toISOString()
  try {
    const result = execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", snapshotScript], { encoding: "utf8", timeout: 60_000, env: { ...env, SYNAPSE_ACCEPTANCE_INSTALLER_PID: identity ? String(identity.pid) : "", SYNAPSE_ACCEPTANCE_INSTALLER_STARTED: identity?.startedAt ?? "", SYNAPSE_ACCEPTANCE_INSTALLER_PATH: identity?.executablePath ?? "", SYNAPSE_ACCEPTANCE_EXE: executable } })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `PowerShell snapshot failed (${result.status}, ${result.signal ?? "no signal"}): ${result.stderr?.trim().slice(0, 1000) ?? ""}`)
    assert.ok(!result.stderr?.trim(), `PowerShell snapshot reported an error: ${result.stderr?.trim().slice(0, 1000)}`)
    const snapshot = JSON.parse(result.stdout)
    exactFields(snapshot, ["snapshotAt", "rootStatus", "reason", "processes", "registry"])
    assert.ok(Number.isFinite(Date.parse(snapshot.snapshotAt)) && ["observed", "not-observed"].includes(snapshot.rootStatus), "Malformed installer snapshot status")
    assert.ok(Array.isArray(snapshot.processes) && snapshot.processes.length <= 256 && Array.isArray(snapshot.registry) && snapshot.registry.length === 2, "Malformed installer snapshot rows")
    const parents = new Map()
    for (const row of snapshot.processes) {
      exactFields(row, ["pid", "parentPid", "name", "startedAt", "phase"])
      const created = Date.parse(row.startedAt)
      assert.ok(Number.isInteger(row.pid) && row.pid > 0 && row.pid <= 0xffffffff && Number.isInteger(row.parentPid) && row.parentPid >= 0 && row.parentPid <= 0xffffffff && typeof row.name === "string" && /^[^\\/\r\n\0]{1,260}$/.test(row.name) && Number.isFinite(created) && !parents.has(row.pid) && ["Get-Command", "Get-ExecutionPolicy", "Get-CimInstance", "other"].includes(row.phase), "Malformed installer snapshot process")
      assert.ok(parents.size ? parents.has(row.parentPid) && created >= parents.get(row.parentPid) : identity && row.pid === identity.pid && Math.abs(created - Date.parse(identity.startedAt)) <= 5000 && row.name.toLowerCase() === path.win32.basename(identity.executablePath).toLowerCase(), "Unowned installer snapshot process")
      parents.set(row.pid, created)
    }
    assert.ok(snapshot.rootStatus === "observed" ? parents.size > 0 && snapshot.reason === null : parents.size === 0 && snapshot.reason === (identity ? "identity-not-observed" : "no-submitted-pid"), "Inconsistent installer snapshot identity")
    for (const [index, row] of snapshot.registry.entries()) {
      exactFields(row, ["hive", "installLocationMatches", "uninstallLocationMatches", "displayVersion"])
      assert.ok(row.hive === ["CurrentUser", "LocalMachine"][index] && [null, true, false].includes(row.installLocationMatches) && [null, true, false].includes(row.uninstallLocationMatches) && (row.displayVersion === null || typeof row.displayVersion === "string" && /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(row.displayVersion)), "Malformed installer snapshot registry")
    }
    const finishedAt = new Date().toISOString()
    return { startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), ...snapshot }
  } catch (cause) { throw new Error("Native installer snapshot unavailable", { cause }) }
}
