// Isolated CPU/heap comparison: real terminal core, in-memory store, no spawned processes.
// node --expose-gc desktop/scripts/checks/terminal-resource-benchmark.mjs [--baseline-ref COMMIT]
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const desktop = path.join(root, "desktop")
const require = createRequire(path.join(desktop, "package.json"))
const ts = require("typescript")
const baseline = process.argv.includes("--baseline-ref") ? process.argv[process.argv.indexOf("--baseline-ref") + 1] : undefined
if (process.argv.includes("--baseline-ref") && !baseline) throw new Error("Missing baseline commit")
if (!global.gc) throw new Error("Run this benchmark with node --expose-gc")

require.extensions[".ts"] = (module, filename) => {
  const relative = path.relative(root, filename).split(path.sep).join("/")
  const source = baseline && relative.startsWith("desktop/")
    ? execFileSync("git", ["show", `${baseline}:${relative}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    : fs.readFileSync(filename, "utf8")
  module._compile(ts.transpileModule(source.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
}

const outputModule = require(path.join(desktop, "app-capabilities/terminal/main/output-buffer.ts"))
const createBuffer = outputModule.createTerminalOutputBuffer
let snapshotCalls = 0
let copiedChunks = 0
outputModule.createTerminalOutputBuffer = (options) => {
  const buffer = createBuffer(options)
  const snapshot = buffer.snapshot.bind(buffer)
  buffer.snapshot = () => {
    const chunks = snapshot()
    snapshotCalls += 1
    copiedChunks += chunks.length
    return chunks
  }
  return buffer
}
const emulatorModule = require(path.join(desktop, "app-capabilities/terminal/main/emulator.ts"))
const createEmulator = emulatorModule.createTerminalCoreEmulator
let emulators = []
let serializations = 0
emulatorModule.createTerminalCoreEmulator = (input) => {
  const emulator = createEmulator(input)
  const serialize = emulator.serialize.bind(emulator)
  emulator.serialize = () => { serializations += 1; return serialize() }
  emulators.push(emulator)
  return emulator
}
const { createTerminalService } = require(path.join(desktop, "app-capabilities/terminal/main/service.ts"))

function pty() {
  let onData
  return {
    write() {}, resize() {}, kill() {},
    onData(listener) { onData = listener; return { dispose() { onData = undefined } } },
    onExit() { return { dispose() {} } },
    emit(text) { onData?.(text) },
  }
}

async function harness(count, quotas = {}) {
  const children = []
  const store = { loadState: async () => ({ groups: [], sessions: [], output: [], checkpoints: [], operations: [], idempotency: [] }),
    saveState: async () => {}, saveRuntimeState: async () => {}, saveStructuralState: async () => {}, persistenceProtection: "available" }
  const service = createTerminalService({ store, spawnPty: () => { const child = pty(); children.push(child); return child },
    resolveDefaultShell: () => "/bin/zsh", resolveDefaultCwd: () => desktop, ...quotas })
  await service.start()
  const sessions = []
  for (let index = 0; index < count; index += 1) sessions.push(await service.createSession({ title: `benchmark-${index}` }))
  return { children, service, sessions }
}

const results = { revision: baseline ?? "working-tree", node: process.version, platform: `${process.platform}/${process.arch}` }
async function settledHeap() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    global.gc()
  }
  return process.memoryUsage().heapUsed
}
// Measure retained objects against the same process after release, excluding module startup garbage.
await settledHeap()
let buffer = createBuffer({ maxBytes: 10 * 1024 * 1024 })
for (let index = 0; index < 200_000; index += 1) buffer.append("benchmark", "x")
const retained = buffer.snapshot().length
const heapWithBuffer = await settledHeap()
results.tinyChunks = { appended: 200_000, retained }
let start = performance.now()
for (let index = 0; index < 2_000; index += 1) buffer.evictOldest()
results.tinyChunks.evict2000Ms = +(performance.now() - start).toFixed(2)
buffer = undefined
results.tinyChunks.heapMiB = +((heapWithBuffer - await settledHeap()) / 1048576).toFixed(2)

let fixture = await harness(8, { outputRetentionBytes: 1024, globalOutputRetentionBytes: 4096 })
snapshotCalls = 0
copiedChunks = 0
start = performance.now()
for (let index = 0; index < 100; index += 1) for (const child of fixture.children) child.emit("12345678")
results.globalEviction = { inputChunks: 800, elapsedMs: +(performance.now() - start).toFixed(2), snapshotCalls, copiedChunks }
await fixture.service.stop()
emulators = []
fixture = await harness(32)
const text = ("x".repeat(76) + "\r\n").repeat(5200)
for (const child of fixture.children) child.emit(text)
await Promise.all(emulators.map((emulator) => emulator.ready()))
await fixture.service.flushPersistQueue()
snapshotCalls = 0
copiedChunks = 0
serializations = 0
start = performance.now()
await fixture.service.renameSession({ sessionId: fixture.sessions[0].id, title: "renamed" })
results.rename32FullHistories = { elapsedMs: +(performance.now() - start).toFixed(2), serializations, snapshotCalls, copiedChunks }
await fixture.service.stop()
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
