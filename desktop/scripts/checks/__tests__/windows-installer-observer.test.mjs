import assert from "node:assert/strict"
import path from "node:path"
import vm from "node:vm"
import { test } from "node:test"
import { nativeInstallExpression, observeNativeInstaller } from "../windows-installer-observer.mjs"

const installerPath = "C:\\owned-cache\\Synapse-1.0.82-win-x64.exe"
const executable = "C:\\owned-install\\Synapse.exe"
const startedAt = "2026-10-25T04:09:09.000Z"
const submission = { isAdminRightsRequired: false, process: { pid: 201, startedAt, executablePath: installerPath, kind: "installer" } }
const snapshot = () => ({
  snapshotAt: "2026-10-25T04:12:17.000Z", rootStatus: "observed", reason: null,
  processes: [
    { pid: 201, parentPid: 100, name: "Synapse-1.0.82-win-x64.exe", startedAt, phase: "other" },
    { pid: 202, parentPid: 201, name: "powershell.exe", startedAt: "2026-10-25T04:09:10.000Z", phase: "Get-CimInstance" },
  ],
  registry: [
    { hive: "CurrentUser", installLocationMatches: true, uninstallLocationMatches: true, displayVersion: "1.0.79" },
    { hive: "LocalMachine", installLocationMatches: null, uninstallLocationMatches: null, displayVersion: null },
  ],
})
const reply = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: "" })

function installationFixture({ status = "downloaded", canQuit = true, elevated = false, failure, spawnFailure, unrelated = false, unbound = false } = {}) {
  const calls = []
  const receiver = {}
  const args = ["--updated", "/S", "--force-run"]
  const options = { detached: true, stdio: "ignore", env: undefined }
  const child = { pid: 201 }
  const cp = { spawn(command, passedArgs, passedOptions) {
    assert.equal(this, unbound ? undefined : receiver)
    assert.equal(passedArgs, args)
    assert.equal(passedOptions, options)
    calls.push(command)
    if (spawnFailure) throw spawnFailure
    return child
  } }
  const originalSpawn = cp.spawn
  const updater = {
    installerPath,
    downloadedUpdateHelper: { downloadedFileInfo: { isAdminRightsRequired: elevated } },
    quitAndInstall(silent, forceRun) {
      assert.equal(this, updater)
      calls.push([silent, forceRun])
      if (failure) throw failure
      if (unrelated) assert.equal(cp.spawn.call(receiver, "C:\\other\\Synapse-1.0.82-win-x64.exe", args, options), child)
      const command = elevated ? "C:\\owned-install\\resources\\elevate.exe" : installerPath
      if (elevated) args.unshift(installerPath)
      assert.equal(Reflect.apply(cp.spawn, unbound ? undefined : receiver, [command, args, options]), child)
    },
  }
  const service = { getState: () => ({ status }), installQuitHandlers: {
    canQuit: () => canQuit,
    allowQuit: () => calls.push("allowQuit"),
  } }
  const context = { process: { resourcesPath: "C:\\owned-install\\resources", mainModule: { require(name) {
    if (name === "electron-updater") return { autoUpdater: updater }
    if (name === "node:child_process") return cp
    if (name === "node:path") return path.win32
    if (name === "./services/update-service.js") return { updateService: service }
    throw new Error(`Unexpected require: ${name}`)
  } } } }
  return { run: () => vm.runInNewContext(nativeInstallExpression(), context), calls, cp, originalSpawn }
}

test("observes the original native installer spawn without changing arguments, receiver, return value or quit gates", () => {
  const fixture = installationFixture({ unrelated: true })
  const before = Date.now()
  const result = JSON.parse(JSON.stringify(fixture.run()))
  assert.equal(fixture.cp.spawn, fixture.originalSpawn)
  assert.deepEqual(fixture.calls, ["allowQuit", [true, true], "C:\\other\\Synapse-1.0.82-win-x64.exe", installerPath])
  assert.equal(result.isAdminRightsRequired, false)
  assert.equal(result.process.pid, 201)
  assert.equal(result.process.executablePath, installerPath)
  assert.equal(result.process.kind, "installer")
  assert.ok(Date.parse(result.process.startedAt) >= before && Date.parse(result.process.startedAt) <= Date.now())
  assert.deepEqual(Object.keys(result.process).sort(), ["executablePath", "kind", "pid", "startedAt"])
})

test("captures only the expected elevation helper launching the actual downloaded installer", () => {
  const fixture = installationFixture({ elevated: true })
  const result = fixture.run()
  assert.equal(result.isAdminRightsRequired, true)
  assert.equal(result.process.kind, "elevate")
  assert.equal(result.process.executablePath, "C:\\owned-install\\resources\\elevate.exe")
  assert.equal(fixture.cp.spawn, fixture.originalSpawn)
})

test("preserves undefined this for the stock BaseUpdater unbound spawn call", () => {
  const fixture = installationFixture({ unbound: true })
  assert.equal(fixture.run().process.pid, 201)
  assert.equal(fixture.cp.spawn, fixture.originalSpawn)
})

test("retains downloaded and production safe-quit rejection before any native installation", () => {
  for (const options of [{ status: "available" }, { canQuit: false }]) {
    const fixture = installationFixture(options)
    assert.throws(fixture.run, /safe-quit gate rejected/)
    assert.deepEqual(fixture.calls, [])
    assert.equal(fixture.cp.spawn, fixture.originalSpawn)
  }
})

test("restores spawn after native invocation or OS spawn throws without replacing the original error", () => {
  for (const field of ["failure", "spawnFailure"]) {
    const cause = new Error("owned failure")
    const fixture = installationFixture({ [field]: cause })
    assert.throws(fixture.run, (error) => error === cause)
    assert.equal(fixture.cp.spawn, fixture.originalSpawn)
  }
})

test("returns one bounded read-only snapshot with its call timing and finite owned process fields", () => {
  let calls = 0
  const env = { PATH: "owned-path", TEMP: "owned-temp" }
  const result = observeNativeInstaller(submission, executable, env, (command, args, options) => {
    calls += 1
    assert.equal(command, "powershell.exe")
    assert.deepEqual(args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"])
    assert.equal(options.timeout, 60_000)
    assert.equal(options.shell, undefined)
    assert.equal(options.env.PATH, "owned-path")
    assert.equal(options.env.SYNAPSE_ACCEPTANCE_INSTALLER_PID, "201")
    assert.equal(options.env.SYNAPSE_ACCEPTANCE_INSTALLER_PATH, installerPath)
    assert.equal(options.env.SYNAPSE_ACCEPTANCE_EXE, executable)
    return reply(snapshot())
  })
  assert.equal(calls, 1)
  assert.equal(result.rootStatus, "observed")
  assert.equal(result.processes[1].phase, "Get-CimInstance")
  assert.ok(result.durationMs >= 0)
  assert.ok(Date.parse(result.finishedAt) >= Date.parse(result.startedAt))
  assert.deepEqual(env, { PATH: "owned-path", TEMP: "owned-temp" })
})

test("does not infer failure or an exit code when the submitted installer is no longer observed", () => {
  const value = { ...snapshot(), rootStatus: "not-observed", reason: "identity-not-observed", processes: [] }
  const result = observeNativeInstaller(submission, executable, {}, () => reply(value))
  assert.equal(result.rootStatus, "not-observed")
  assert.equal(result.reason, "identity-not-observed")
  assert.equal("exitCode" in result, false)
  assert.equal("failed" in result, false)
})

test("makes an absent submitted PID explicit without pretending an installer was seen", () => {
  const value = { ...snapshot(), rootStatus: "not-observed", reason: "no-submitted-pid", processes: [] }
  const result = observeNativeInstaller({ isAdminRightsRequired: false, process: null }, executable, {}, () => reply(value))
  assert.equal(result.reason, "no-submitted-pid")
})

test("rejects unrelated descendants, reused PID chronology and fields outside the finite read contract", () => {
  const invalid = [
    (value) => { value.processes[1].parentPid = 999 },
    (value) => { value.processes[1].startedAt = "2026-10-24T00:00:00.000Z" },
    (value) => { value.processes[0].startedAt = "2026-10-24T00:00:00.000Z" },
    (value) => { value.processes[0].pid = 999 },
    (value) => { value.processes[1].phase = "raw arbitrary command" },
    (value) => { value.processes[1].commandLine = "private arguments" },
    (value) => { value.environment = { TOKEN: "private" } },
    (value) => { value.rootStatus = "failed" },
    (value) => { value.registry[0].installLocationMatches = "C:\\private" },
  ]
  for (const mutate of invalid) {
    const value = snapshot()
    mutate(value)
    assert.throws(() => observeNativeInstaller(submission, executable, {}, () => reply(value)), /snapshot/i)
  }
})

test("fails closed with the original process or parsing cause on unavailable observations", () => {
  const timeout = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })
  const invalid = [
    { status: null, signal: "SIGTERM", error: timeout, stdout: "", stderr: "" },
    { status: 1, stdout: "", stderr: "CIM unavailable" },
    { status: 0, stdout: "{}", stderr: "access denied" },
    { status: 0, stdout: "not json", stderr: "" },
    reply(null),
  ]
  for (const value of invalid) assert.throws(() => observeNativeInstaller(submission, executable, {}, () => value), (error) =>
    /snapshot/i.test(error.message) && error.cause instanceof Error)
  assert.throws(() => observeNativeInstaller(submission, executable, {}, () => { throw timeout }), (error) => error.cause === timeout)
})

test("rejects malformed submissions with their cause before starting PowerShell", () => {
  for (const process of [{ ...submission.process, pid: 0 }, { ...submission.process, startedAt: "invalid" }, { ...submission.process, executablePath: "relative.exe" }, { ...submission.process, executablePath: 123 }, { ...submission.process, kind: "other" }]) {
    assert.throws(() => observeNativeInstaller({ ...submission, process }, executable, {}, () => { assert.fail("Observer started for invalid identity") }), (error) => /submission/i.test(error.message) && error.cause instanceof Error)
  }
})
