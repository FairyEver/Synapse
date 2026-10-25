import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { parse as parseYaml } from "yaml"
import { test } from "node:test"
import { candidateUpdateExpression, installedPtyExpression, Inspector, isOwnedInspectorAddress, ownedProcessIds, parseAcceptanceMode, parseWindowsMetadata, readWindowsProductVersion, verifyFileSha512 } from "../windows-update-acceptance.mjs"

const digest = createHash("sha512").update("installer").digest("base64")
const metadata = (overrides = {}) => JSON.stringify({
  version: "1.0.79",
  path: "Synapse-1.0.79-win-x64.exe",
  sha512: digest,
  files: [{ url: "Synapse-1.0.79-win-x64.exe", sha512: digest, size: 9 }],
  ...overrides,
})

test("selects the expected Windows installer and SHA512 from vendor metadata", () => {
  assert.deepEqual(parseWindowsMetadata(metadata(), "1.0.79"), {
    version: "1.0.79", file: "Synapse-1.0.79-win-x64.exe", sha512: digest,
  })
})

test("accepts the published version-prefixed paths as well as local builder metadata", () => {
  const file = "v1.0.79/Synapse-1.0.79-win-x64.exe"
  assert.equal(parseWindowsMetadata(metadata({ path: file, files: [{ url: file, sha512: digest }] }), "1.0.79").file,
    "Synapse-1.0.79-win-x64.exe")
})

test("refuses a newer latest feed instead of silently testing a different old version", () => {
  assert.throws(() => parseWindowsMetadata(metadata({ version: "1.0.80" }), "1.0.79"), /version/i)
})

test("refuses absolute URLs, traversal, and non-installer paths", () => {
  for (const url of ["https://other.invalid/installer.exe", "../installer.exe", "Synapse-1.0.79-win-x64.exe/other", "installer.cmd"]) {
    assert.throws(() => parseWindowsMetadata(metadata({ files: [{ url, sha512: digest }] }), "1.0.79"), /installer|path/i)
  }
})

test("refuses missing or malformed digests and conflicting root metadata", () => {
  for (const sha512 of [undefined, "", "not-a-digest"]) {
    assert.throws(() => parseWindowsMetadata(metadata({ files: [{ url: "Synapse-1.0.79-win-x64.exe", sha512 }] }), "1.0.79"), /SHA512/i)
  }
  assert.throws(() => parseWindowsMetadata(metadata({ path: "other.exe" }), "1.0.79"), /path/i)
  assert.throws(() => parseWindowsMetadata(metadata({ sha512: createHash("sha512").update("other").digest("base64") }), "1.0.79"), /SHA512/i)
})

test("checks actual file bytes and rejects a corrupted downloaded installer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-windows-integrity-"))
  try {
    const file = path.join(root, "installer.exe")
    await writeFile(file, "installer")
    await verifyFileSha512(file, digest)
    await writeFile(file, "corrupted")
    await assert.rejects(verifyFileSha512(file, digest), /SHA512/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("retains the Windows process observer startup or timeout cause", () => {
  for (const code of ["ENOENT", "ETIMEDOUT"]) {
    const execute = () => ({ status: null, signal: "SIGTERM", error: Object.assign(new Error(`spawnSync powershell.exe ${code}`), { code }), stderr: "observer diagnostic" })
    assert.throws(() => ownedProcessIds("C:\\owned\\Synapse.exe", false, execute), (error) => error.message.includes(code) && error.message.includes("observer diagnostic"))
  }
})

test("refuses observer stderr even when PowerShell reports a successful exit", () => {
  const execute = () => ({ status: 0, stdout: "", stderr: "Get-CimInstance: query failed" })
  assert.throws(() => ownedProcessIds("C:\\owned\\Synapse.exe", false, execute), /query failed/)
})

test("distinguishes missing executable from a failed installed-version observation", () => {
  assert.equal(readWindowsProductVersion("C:\\owned\\Synapse.exe", () => ({ status: 0, stdout: "1.0.81\r\n", stderr: "" })), "1.0.81")
  assert.equal(readWindowsProductVersion("C:\\owned\\Synapse.exe", () => ({ status: 0, stdout: "missing\r\n", stderr: "" })), null)
  assert.throws(() => readWindowsProductVersion("C:\\owned\\Synapse.exe", () => ({ status: 0, stdout: "", stderr: "" })), /empty/)
  assert.throws(() => readWindowsProductVersion("C:\\owned\\Synapse.exe", () => ({ status: null, signal: "SIGTERM", error: Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), { code: "ETIMEDOUT" }), stdout: "", stderr: "" })), /ETIMEDOUT/)
  assert.throws(() => readWindowsProductVersion("C:\\owned\\Synapse.exe", () => ({ status: 0, stdout: "", stderr: "Get-Item: access denied" })), /access denied/)
})

test("gives the read-only Windows version observer a bounded cold-start budget", () => {
  let options
  readWindowsProductVersion("C:\\owned\\Synapse.exe", (_command, _args, supplied) => {
    options = supplied
    return { status: 0, stdout: "1.0.81\r\n", stderr: "" }
  })
  assert.equal(options.timeout, 60_000)
})

test("settles the old automatic check before changing feed and checking the candidate afresh", async () => {
  let settle
  const calls = []
  const service = {
    autoCheckPromise: new Promise((resolve) => { settle = resolve }),
    async checkForUpdates(options) {
      calls.push(["check", options])
      return this.autoCheckPromise
        ? { status: "idle", releaseVersion: null }
        : { status: "available", releaseVersion: "1.0.82" }
    },
    async downloadUpdate() { calls.push(["download"]) },
  }
  const completion = vm.runInNewContext(candidateUpdateExpression("1.0.82"), {
    process: { mainModule: { require: (name) => name === "electron-updater"
      ? { autoUpdater: { setFeedURL: () => calls.push(["feed"]) } }
      : { updateService: service } } },
  }).then((value) => ({ value }), (error) => ({ error }))
  await Promise.resolve()
  assert.deepEqual(calls, [])
  service.autoCheckPromise = null
  settle()
  assert.deepEqual(await completion, { value: true })
  assert.equal(calls[0][0], "feed")
  assert.equal(calls[1][0], "check")
  assert.equal(calls[1][1].refreshAvailable, true)
  assert.equal(calls[2][0], "download")
})

test("records the pending installed PTY step without changing its failure guard", async () => {
  const stages = []
  const workerThreads = { Worker: class AcceptanceWorker {} }
  const originalWorker = workerThreads.Worker
  let finishCreate
  let notifyCreate
  const createStarted = new Promise((resolve) => { notifyCreate = resolve })
  const terminal = {
    createSessionWithEphemeralEnvironment: () => new Promise((resolve) => {
      finishCreate = resolve
      notifyCreate()
    }),
    listSessions: () => [],
    flushPersistQueue: async () => undefined,
  }
  const completion = vm.runInNewContext(installedPtyExpression(), {
    process: {
      env: { ComSpec: "cmd.exe" },
      execArgv: ["--inspect-brk=127.0.0.1:19798"],
      stderr: { write: (line) => stages.push(JSON.parse(line).stage) },
      mainModule: { require: (name) => {
        if (name === "node:worker_threads") return workerThreads
        if (name === "node:path") return path
        if (name === "node:module") return { createRequire: () => ({ resolve: () => "/owned/node-pty/lib/index.js" }) }
        if (name === "electron") return { app: { getPath: () => "/owned/user-data", getAppPath: () => "/owned/app" } }
        throw new Error(`Unexpected PTY fixture module: ${name}`)
      } },
    },
    __updateAcceptanceRegistry: {
      get: () => terminal,
      getContext: () => ({
        permissionGuard: { check: async () => ({ allowed: true }) },
        auditSink: { record: () => undefined },
      }),
    },
    setTimeout,
  }).then((value) => ({ value }), (error) => ({ error }))
  await Promise.race([createStarted, completion.then(({ error }) => { throw error ?? new Error("PTY check finished before creation") })])
  try {
    assert.equal(stages.at(-1), "create_session")
    assert.notEqual(workerThreads.Worker, originalWorker)
  } finally {
    finishCreate({ id: "owned", status: "failed" })
  }
  assert.match((await completion).error.message, /Actual Windows PTY failed to start/)
  assert.equal(workerThreads.Worker, originalWorker)
})

test("binds the inspector URL to the exact endpoint emitted by the spawned child", () => {
  const owned = "ws://127.0.0.1:19798/256978e1-bbb9-47f4-a0dd-517461f6fae3"
  const startup = `\r\nDebugger listening on ${owned}\r\nFor help, see: https://nodejs.org/en/docs/inspector\r\n`
  assert.equal(isOwnedInspectorAddress(owned, startup), true)
  for (const other of ["ws://127.0.0.1:19798/another-process", "ws://0.0.0.0:19798/other", "ws://127.0.0.1:19799/other", "invalid"]) {
    assert.equal(isOwnedInspectorAddress(other, startup), false)
  }
  assert.equal(isOwnedInspectorAddress(owned, ""), false)
})

test("selects explicit diagnostic stages and rejects misspelled or combined modes before installation", () => {
  assert.equal(parseAcceptanceMode([]), "full")
  assert.equal(parseAcceptanceMode(["--observe-processes"]), "observer")
  assert.equal(parseAcceptanceMode(["--previous-startup-only"]), "previous-startup")
  assert.equal(parseAcceptanceMode(["--candidate-installed-only"]), "candidate-installed")
  assert.throws(() => parseAcceptanceMode(["--previous-startpu-only"]), /mode/i)
  assert.throws(() => parseAcceptanceMode(["--observe-processes", "--previous-startup-only"]), /mode/i)
})

test("keeps installed candidate diagnostics separate from the full update workflow gate", async () => {
  const workflow = parseYaml(await readFile(new URL("../../../../.github/workflows/desktop-update-acceptance.yml", import.meta.url), "utf8"))
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"])
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, "full")
  assert.ok(workflow.on.workflow_dispatch.inputs.mode.options.includes("candidate-installed"))
  const steps = workflow.jobs["windows-native-update"].steps
  assert.equal(steps.find((step) => step.name === "Verify actual installed cross-version update").if, "${{ inputs.mode == 'full' }}")
  assert.equal(steps.find((step) => step.name === "Diagnose installed candidate without a cross-version update").if, "${{ inputs.mode == 'candidate-installed' }}")
  assert.match(steps.find((step) => step.name === "Preserve acceptance evidence").with.name, /github.run_attempt/)
})

test("preserves the failing inspector method and installed startup stage", async () => {
  const socket = { send(message) {
    const { id } = JSON.parse(message)
    queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, error: { message: "Promise was collected" } }) }))
  } }
  const inspector = new Inspector(socket)
  await assert.rejects(inspector.evaluate("process.pid", "old main PID"), (error) =>
    error.message.includes("old main PID") && error.message.includes("Runtime.evaluate") && error.message.includes("Promise was collected"))
})

test("reads actual V8 startup snapshots without a collectible Promise wrapper and still awaits async work", { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, ["--inspect=127.0.0.1:0", "-e", `
    const vm = require('node:vm');
    globalThis.startupContext = vm.createContext({}, {name:'synapse-startup-pending',microtaskMode:'afterEvaluate'});
    vm.runInContext('globalThis.answer=42', globalThis.startupContext);
    setInterval(()=>{},1000);
  `], { stdio: ["ignore", "ignore", "pipe"] })
  let socket
  let startupTimer
  try {
    const address = await new Promise((resolve, reject) => {
      let startup = ""
      startupTimer = setTimeout(() => reject(new Error("Inspector fixture startup timed out")), 10_000)
      child.stderr.on("data", (chunk) => {
        startup += chunk.toString()
        const match = /Debugger listening on (ws:\/\/[^\s]+)/.exec(startup)
        if (match) resolve(match[1])
      })
      child.once("error", reject)
      child.once("exit", () => reject(new Error("Inspector fixture exited during startup")))
    })
    clearTimeout(startupTimer)
    socket = new WebSocket(address)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    const inspector = new Inspector(socket)
    const contexts = []
    inspector.listeners.add((message) => {
      if (message.method === "Runtime.executionContextCreated") contexts.push(message.params.context)
    })
    await inspector.command("Runtime.enable")
    assert.equal(await inspector.evaluate("new Promise(resolve=>setTimeout(()=>resolve(7),5))", "async fixture", true), 7)
    await assert.rejects(inspector.evaluate("Promise.reject(new Error('controlled async rejection'))", "async rejection", true), /controlled async rejection/)
    await assert.rejects(inspector.evaluate("Promise.resolve(1)", "unexpected async result"), /requires explicit Promise waiting/)
    const deadline = Date.now() + 5000
    while (!contexts.some((context) => context.name === "synapse-startup-pending") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const context = contexts.find((value) => value.name === "synapse-startup-pending")
    assert.ok(context, "Actual V8 fixture context missing")
    const command = inspector.command.bind(inspector)
    inspector.command = (method, params = {}) => command(method, method === "Runtime.evaluate" ? { ...params, contextId: context.id } : params)
    const result = inspector.evaluate("answer", "startup snapshot").then((value) => ({ value }), (error) => ({ error: error.message }))
    await inspector.command("HeapProfiler.collectGarbage")
    const outcome = await result
    assert.equal(outcome.value, 42, outcome.error)
  } finally {
    clearTimeout(startupTimer)
    socket?.close()
    child.kill()
  }
})
