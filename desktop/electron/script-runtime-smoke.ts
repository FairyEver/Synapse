import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { runChromiumWorkerScript } from "../app-capabilities/script-runtime/main/chromium-worker-runner"
import { runNodeCliScript } from "../app-capabilities/script-runtime/main/node-cli-runner"
import type { ScriptRunOutcome } from "../app-capabilities/script-runtime/main/types"

const SMOKE_TIMEOUT_SECONDS = 10

export async function runScriptRuntimeSmoke(executablePath: string): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-script-runtime-脚本-"))
  try {
    await verifyChromiumWorker()
    await verifyNodeCli(executablePath, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function verifyChromiumWorker(): Promise<void> {
  const success = await runChromiumWorkerScript({
    source: `
      console.log("worker-log");
      self.onmessage = (event) => {
        postMessage({
          input: event.data.value,
          processType: typeof process,
          requireType: typeof require,
          electronType: typeof electron,
          documentType: typeof document
        });
        postMessage({ ignored: true });
      };
    `,
    input: { value: 42 },
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: new AbortController().signal,
  })
  assertSuccess(success, "Chromium Worker result")
  if (
    !isRecord(success.result)
    || success.result.input !== 42
    || success.result.processType !== "undefined"
    || success.result.requireType !== "undefined"
    || success.result.electronType !== "undefined"
    || success.result.documentType !== "undefined"
  ) {
    throw new Error("Chromium Worker host contract changed")
  }
  if (!success.logs.some((log) => log.label === "console" && log.value.includes("worker-log"))) {
    throw new Error("Chromium Worker log contract changed")
  }

  const scriptError = await runChromiumWorkerScript({
    source: "throw new Error('worker failure detail')",
    input: {},
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: new AbortController().signal,
  })
  assertFailure(scriptError, "SCRIPT_FAILED", "Chromium Worker error")

  const outputLimit = await runChromiumWorkerScript({
    source: "self.onmessage = () => postMessage('x'.repeat(1024 * 1024 + 1))",
    input: {},
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: new AbortController().signal,
  })
  assertFailure(outputLimit, "OUTPUT_TOO_LARGE", "Chromium Worker output limit")

  const timeout = await runChromiumWorkerScript({
    source: "self.onmessage = () => {}",
    input: {},
    timeoutSeconds: 1,
    abortSignal: new AbortController().signal,
  })
  assertFailure(timeout, "TIMEOUT", "Chromium Worker timeout")

  const cancellation = new AbortController()
  const cancelledRun = runChromiumWorkerScript({
    source: "self.onmessage = () => {}",
    input: {},
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: cancellation.signal,
  })
  setTimeout(() => cancellation.abort(), 50)
  assertFailure(await cancelledRun, "CANCELLED", "Chromium Worker cancellation")
}

async function verifyNodeCli(executablePath: string, root: string): Promise<void> {
  const cwd = path.join(root, "Unicode 工作目录")
  await mkdir(path.join(cwd, "node_modules", "local-value"), { recursive: true })
  const resolvedCwd = await realpath(cwd)
  await writeFile(
    path.join(cwd, "node_modules", "local-value", "index.js"),
    "module.exports = 41\n",
    "utf8",
  )
  await writeFile(
    path.join(cwd, "esm-value.mjs"),
    "export default 40\n",
    "utf8",
  )

  const commonjs = await runNode(executablePath, {
    source: `
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        console.error("node-log");
        process.stdout.write(JSON.stringify({
          value: require("local-value") + JSON.parse(input).increment,
          cwd: process.cwd(),
          commonjs: typeof require === "function"
        }));
      });
    `,
    input: { increment: 1 },
    cwd: resolvedCwd,
    moduleMode: "commonjs",
  })
  assertSuccess(commonjs, "Node.js CommonJS")
  if (
    !isRecord(commonjs.result)
    || commonjs.result.value !== 42
    || commonjs.result.cwd !== resolvedCwd
    || commonjs.result.commonjs !== true
  ) {
    throw new Error("Node.js CommonJS, local node_modules, or Unicode cwd contract changed")
  }
  if (!commonjs.logs.some((log) => log.label === "stderr" && log.value.includes("node-log"))) {
    throw new Error("Node.js stderr log contract changed")
  }

  const esm = await runNode(executablePath, {
    source: `
      import value from "./esm-value.mjs";
      process.stdout.write(JSON.stringify({
        value: value + 2,
        esm: import.meta.url.startsWith("file:")
      }));
    `,
    input: {},
    cwd: resolvedCwd,
    moduleMode: "esm",
  })
  assertSuccess(esm, "Node.js ESM")
  if (!isRecord(esm.result) || esm.result.value !== 42 || esm.result.esm !== true) {
    throw new Error("Node.js ESM contract changed")
  }

  const outputLimit = await runNode(executablePath, {
    source: "process.stdout.write(JSON.stringify('x'.repeat(1024 * 1024 + 1)))",
    input: {},
    cwd: resolvedCwd,
    moduleMode: "commonjs",
  })
  assertFailure(outputLimit, "OUTPUT_TOO_LARGE", "Node.js output limit")

  const timeoutPidPath = path.join(cwd, "timeout.pid")
  const timeout = await runNode(executablePath, {
    source: `
      require("node:fs").writeFileSync(${JSON.stringify(timeoutPidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `,
    input: {},
    cwd: resolvedCwd,
    moduleMode: "commonjs",
    timeoutSeconds: 1,
  })
  assertFailure(timeout, "TIMEOUT", "Node.js timeout")
  await assertRecordedProcessStopped(timeoutPidPath, "timed-out Node.js process")

  const cancelPidPath = path.join(cwd, "cancel.pid")
  const cancellation = new AbortController()
  const cancelledRun = runNode(executablePath, {
    source: `
      require("node:fs").writeFileSync(${JSON.stringify(cancelPidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `,
    input: {},
    cwd: resolvedCwd,
    moduleMode: "commonjs",
    abortSignal: cancellation.signal,
  })
  await waitForFile(cancelPidPath)
  cancellation.abort()
  assertFailure(await cancelledRun, "CANCELLED", "Node.js cancellation")
  await assertRecordedProcessStopped(cancelPidPath, "cancelled Node.js process")

  const names = await readdir(resolvedCwd)
  if (names.some((name) => name.startsWith(".synapse-node-"))) {
    throw new Error("Node.js temporary script cleanup failed")
  }
}

function runNode(
  executablePath: string,
  request: {
    readonly source: string
    readonly input: Record<string, never> | { readonly increment: number }
    readonly cwd: string
    readonly moduleMode: "commonjs" | "esm"
    readonly timeoutSeconds?: number
    readonly abortSignal?: AbortSignal
  },
): Promise<ScriptRunOutcome> {
  return runNodeCliScript({
    source: request.source,
    input: request.input,
    timeoutSeconds: request.timeoutSeconds ?? SMOKE_TIMEOUT_SECONDS,
    abortSignal: request.abortSignal ?? new AbortController().signal,
    cwd: request.cwd,
    moduleMode: request.moduleMode,
  }, {
    executablePath,
    baseEnv: process.env,
  })
}

function assertSuccess(
  outcome: ScriptRunOutcome,
  label: string,
): asserts outcome is Extract<ScriptRunOutcome, { status: "success" }> {
  if (outcome.status !== "success") {
    throw new Error(`${label} failed with ${outcome.code}`)
  }
}

function assertFailure(
  outcome: ScriptRunOutcome,
  code: string,
  label: string,
): void {
  if (outcome.status === "success" || outcome.code !== code) {
    throw new Error(`${label} returned an unexpected outcome`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function waitForFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await readFile(filePath, "utf8")
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error("Node.js smoke process did not start")
}

async function assertRecordedProcessStopped(filePath: string, label: string): Promise<void> {
  const pid = Number.parseInt(await readFile(filePath, "utf8"), 10)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isProcessAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${label} was not cleaned up`)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
