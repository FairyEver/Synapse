import { app, safeStorage } from "electron"
import pty from "node-pty"
import headless from "@xterm/headless"
import serializeAddon from "@xterm/addon-serialize"

const { Terminal } = headless
const { SerializeAddon } = serializeAddon

const TIMEOUT_MS = 10_000
const MARKER = "__SYNAPSE_TERMINAL_RUNTIME_SPIKE__"
const COMMAND_MARKER = "__SYNAPSE_TERMINAL_ATOMIC_COMMAND__"
const activePtys = new Set()

function spawnPty(file, args, options) {
  const instance = pty.spawn(file, args, options)
  activePtys.add(instance)
  instance.onExit(() => activePtys.delete(instance))
  return instance
}

function finish(exitCode) {
  for (const instance of activePtys) {
    try {
      instance.kill()
    } catch {
      // Best-effort spike cleanup.
    }
  }
  app.exit(exitCode)
  setTimeout(() => process.exit(exitCode), 250)
}

async function runStage(name, verify) {
  process.stderr.write(`[terminal-runtime] ${name}\n`)
  return verify()
}

function waitForOutput(instance, predicate, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => {
      subscription.dispose()
      reject(new Error("Terminal runtime spike timed out"))
    }, timeoutMs)
    const subscription = instance.onData((chunk) => {
      output += chunk
      if (!predicate(output)) return
      clearTimeout(timer)
      subscription.dispose()
      resolve(output)
    })
  })
}

function waitForExit(instance, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Terminal exit spike timed out")), timeoutMs)
    instance.onExit((event) => {
      clearTimeout(timer)
      resolve(event)
    })
  })
}

async function verifyHeadlessEmulator() {
  const before = process.memoryUsage().heapUsed
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 2_000, allowProposedApi: true })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  await new Promise((resolve) => terminal.write(`hello\r\n\x1b[?2004h`, resolve))
  if (!terminal.modes.bracketedPasteMode) throw new Error("Headless emulator did not track bracketed paste mode")
  const serialized = serializer.serialize()
  if (!serialized.includes("hello")) throw new Error("Headless emulator serialization lost screen content")
  terminal.dispose()
  const heapDelta = Math.max(0, process.memoryUsage().heapUsed - before)
  if (heapDelta > 32 * 1024 * 1024) throw new Error("Headless emulator exceeded the spike heap bound")
  return { implementation: "@xterm/headless", serialization: true, heapDelta }
}

async function verifyQueuedInputAndResize() {
  const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh"
  const instance = spawnPty(shell, [], { cols: 80, rows: 24, cwd: app.getPath("temp"), env: process.env })
  const output = waitForOutput(instance, (value) => value.includes(MARKER))
  instance.write(process.platform === "win32" ? `echo ${MARKER}\r` : `printf '${MARKER}\\n'\r`)
  instance.resize(100, 30)
  await output
  const exited = waitForExit(instance)
  instance.kill(process.platform === "win32" ? undefined : "SIGHUP")
  await exited
  return { queuedInput: true, resize: true, normalStop: true }
}

async function verifyRawBufferWrite() {
  const expected = Buffer.from([0, 1, 2, 3, 4, 127, 195, 169, 255])
  const code = `
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    const chunks = []
    let total = 0
    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
      total += chunk.length
      if (total < ${expected.byteLength}) return
      process.stdout.write(Buffer.concat(chunks).subarray(0, ${expected.byteLength}).toString('hex'))
      process.exit(0)
    })
    process.stdout.write('READY')
  `
  const instance = spawnPty(process.execPath, ["-e", code], {
    cols: 80,
    rows: 24,
    cwd: app.getPath("temp"),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  })
  const expectedHex = expected.toString("hex")
  const exited = waitForExit(instance)
  await waitForOutput(instance, (value) => value.includes("READY"))
  const output = waitForOutput(instance, (value) => value.toLowerCase().includes(expectedHex))
  instance.write(expected)
  await output
  await exited
  return { bufferApi: true, exactBytes: expectedHex }
}

async function verifyOrderedCommandSubmission() {
  const instruction = "请在下载文件夹创建一个完整可用的番茄钟，并验证计时、模式切换和声音提醒。".repeat(16)
  const code = `
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    let input = Buffer.alloc(0)
    process.stdin.on('data', (chunk) => {
      const bytes = Buffer.from(chunk)
      const enterIndex = bytes.indexOf(13)
      if (enterIndex < 0) {
        input = Buffer.concat([input, bytes])
        return
      }
      if (enterIndex !== 0) process.exit(3)
      const received = input.toString('utf8')
      if (received !== ${JSON.stringify(instruction)}) process.exit(2)
      process.stdout.write('${COMMAND_MARKER}')
      process.exit(0)
    })
    process.stdout.write('READY')
  `
  const instance = spawnPty(process.execPath, ["-e", code], {
    cols: 80,
    rows: 24,
    cwd: app.getPath("temp"),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  })
  const exited = waitForExit(instance)
  await waitForOutput(instance, (value) => value.includes("READY"))
  const output = waitForOutput(instance, (value) => value.includes(COMMAND_MARKER))
  instance.write(instruction)
  await new Promise((resolve) => setTimeout(resolve, 10))
  instance.write("\r")
  await output
  const exit = await exited
  if (exit.exitCode !== 0) throw new Error("Ordered command submission changed the UTF-8 instruction or coalesced Enter")
  return { orderedCommand: true, utf8Bytes: Buffer.byteLength(instruction) }
}

async function verifyForceStop() {
  if (process.platform === "win32") return { supported: false, reason: "distinct_force_path_unproven" }
  const instance = spawnPty("/bin/sh", [], { cols: 80, rows: 24, cwd: app.getPath("temp"), env: process.env })
  const exited = waitForExit(instance)
  instance.kill("SIGKILL")
  await exited
  return { supported: true, signal: "SIGKILL" }
}

try {
  const electronReady = await Promise.race([
    app.whenReady().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  const result = {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    safeStorage: electronReady
      ? safeStorage.isEncryptionAvailable() ? "available" : "unavailable"
      : "deferred_app_ready_unavailable",
    emulator: await runStage("headless-emulator", verifyHeadlessEmulator),
    pty: await runStage("queued-input-resize-normal-stop", verifyQueuedInputAndResize),
    command: await runStage("ordered-command-submission", verifyOrderedCommandSubmission),
    raw: await runStage("raw-buffer-write", verifyRawBufferWrite),
    forceStop: await runStage("force-stop", verifyForceStop),
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  finish(0)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  finish(1)
}
