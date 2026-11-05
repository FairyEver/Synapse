// Controlled terminal core + relay comparison. No application, PTY, browser or disk store.
// node --expose-gc desktop/scripts/checks/terminal-projection-benchmark.mjs [--baseline-ref COMMIT]
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
if (!global.gc) throw new Error("Run with node --expose-gc")
const source = (filename) => baseline
  ? execFileSync("git", ["show", `${baseline}:${path.relative(root, filename).split(path.sep).join("/")}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  : fs.readFileSync(filename, "utf8")
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(
  source(filename).replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href)),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText, filename)

const results = { revision: baseline ?? "working-tree", node: process.version, platform: `${process.platform}/${process.arch}` }
const { createTerminalCoreEmulator } = require(path.join(desktop, "app-capabilities/terminal/main/emulator.ts"))
// Warm the shared xterm decoder/parser before measuring; source loading/JIT are not the workload.
const warmup = createTerminalCoreEmulator({ cols: 80, rows: 24, sizeRevision: 1 })
for (let seq = 1; seq <= 256; seq += 1) await warmup.accept("w".repeat(1022) + "\r\n", seq)
warmup.dispose()
let paused = false
let pauses = 0
const emulator = createTerminalCoreEmulator({ cols: 80, rows: 24, sizeRevision: 1,
  onBackpressure(value) { paused = value; if (value) pauses += 1 },
})
let pendingBytes = 0
let pendingTasks = 0
let peakBytes = 0
let peakTasks = 0
const writes = []
global.gc()
const cpuStart = process.cpuUsage()
const started = performance.now()
for (let seq = 1; seq <= 4096; seq += 1) {
  // A cooperative fake native producer observes pause before reading another chunk.
  if (paused) await emulator.ready()
  const data = String(seq).padStart(6, "0") + "x".repeat(1016) + "\r\n"
  pendingBytes += Buffer.byteLength(data)
  pendingTasks += 1
  peakBytes = Math.max(peakBytes, pendingBytes)
  peakTasks = Math.max(peakTasks, pendingTasks)
  writes.push(emulator.accept(data, seq).finally(() => { pendingBytes -= Buffer.byteLength(data); pendingTasks -= 1 }))
}
await Promise.all(writes)
await emulator.ready()
const wallMs = performance.now() - started
const cpu = process.cpuUsage(cpuStart)
const snapshot = await emulator.captureSnapshot(2 * 1024 * 1024)
if (snapshot.throughOutputSeq !== 4096 || !snapshot.serialized?.includes("004096")) throw new Error("Final terminal watermark/content mismatch")
results.parser4MiB = { chunks: 4096, peakPendingBytes: peakBytes, peakPendingTasks: peakTasks, pauses,
  wallMs: +wallMs.toFixed(2), cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(2),
  finalSeq: snapshot.throughOutputSeq }
emulator.dispose()

let batches = 0
let deliveredChunks = 0
let visibleDeliveries = 0
let hiddenDeliveries = 0
const emit = (batch, recipients) => {
  batches += 1
  deliveredChunks += batch.chunks?.length ?? 1
  if (recipients.has(1)) visibleDeliveries += 1
  if (recipients.has(2)) hiddenDeliveries += 1
}
let relay
if (baseline) {
  const ipc = source(path.join(desktop, "app-capabilities/terminal/main/ipc.ts"))
  if (!ipc.includes('windowManager.broadcast(ipcOperationIdToChannel(terminalIpcModule.events.data.operationId), payload)')) throw new Error("Baseline relay differs; inspect before comparing")
  relay = { append(chunk) { emit({ sessionId: chunk.sessionId, chunk }, new Set([1, 2])) }, flushSession() {} }
} else {
  const { createTerminalRendererOutputRelay } = require(path.join(desktop, "app-capabilities/terminal/main/renderer-output-relay.ts"))
  relay = createTerminalRendererOutputRelay(emit)
  relay.report(1, ["visible"])
  relay.report(2, [])
}
const relayStart = performance.now()
for (const sessionId of ["visible", "background"]) {
  for (let seq = 1; seq <= 2000; seq += 1) relay.append({ sessionId, seq, data: "status\r\n", source: "pty", createdAt: "now" })
  relay.flushSession(sessionId)
}
results.relay4000Chunks = { batches, deliveredChunks, visibleDeliveries, hiddenDeliveries, elapsedMs: +(performance.now() - relayStart).toFixed(2) }

// Renderer cache policy only: live xterm/WebGL instances are verified by the DOM regression suite.
const workspaces = Array.from({ length: 32 }, (_, index) => ({ id: `w${index}`, layout: { type: "leaf", paneId: `p${index}`, sessionId: `s${index}` } }))
let recent = []
let maxCached = 0
if (baseline) {
  const renderer = source(path.join(desktop, "app-capabilities/terminal/renderer/index.tsx"))
  if (!renderer.includes("new Set(current)") || !renderer.includes("mountedWorkspaceIds")) throw new Error("Baseline cache differs; inspect before comparing")
  for (const workspace of workspaces) { recent = [...new Set([...recent, workspace.id])]; maxCached = Math.max(maxCached, recent.length) }
} else {
  const { retainedTerminalWorkspaces } = require(path.join(desktop, "app-capabilities/terminal/renderer/terminal-workspace-cache.ts"))
  for (const workspace of workspaces) { recent = retainedTerminalWorkspaces(recent, workspace.id, workspaces); maxCached = Math.max(maxCached, recent.length) }
}
results.cachePolicy32Tabs = { maxRetainedWorkspaces: maxCached, finalRetainedWorkspaces: recent.length, measurement: "policy count; not GPU memory" }
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
