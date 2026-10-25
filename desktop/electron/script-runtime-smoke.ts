import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { runChromiumWorkerScript } from "../app-capabilities/script-runtime/main/chromium-worker-runner"
import { runNodeCliScript } from "../app-capabilities/script-runtime/main/node-cli-runner"
import type { ScriptRunOutcome } from "../app-capabilities/script-runtime/main/types"
import { ScriptRuntimeSmokeCheckFailure, type ScriptRuntimeSmokeCheck } from "./script-runtime-smoke-bootstrap"

const SMOKE_TIMEOUT_SECONDS = 10

export async function runScriptRuntimeSmoke(executablePath: string): Promise<void> {
  const root = await checkOperation("smoke_root_create", () => mkdtemp(path.join(tmpdir(), "synapse-script-runtime-脚本-")))
  try {
    await verifyChromiumWorker()
    await verifyNodeCli(executablePath, root)
  } finally {
    await checkOperation("smoke_root_cleanup", () => rm(root, { recursive: true, force: true }))
  }
}

async function verifyChromiumWorker(): Promise<void> {
  const success = await runWorker("worker_result", {
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
  assertSuccess(success, "worker_result")
  if (
    !isRecord(success.result)
    || success.result.input !== 42
    || success.result.processType !== "undefined"
    || success.result.requireType !== "undefined"
    || success.result.electronType !== "undefined"
    || success.result.documentType !== "undefined"
  ) {
    throw new ScriptRuntimeSmokeCheckFailure("worker_host_contract")
  }
  if (!success.logs.some((log) => log.label === "console" && log.value.includes("worker-log"))) {
    throw new ScriptRuntimeSmokeCheckFailure("worker_console_log")
  }

  const scriptError = await runWorker("worker_script_error", {
    source: "throw new Error('worker failure detail')",
    input: {},
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: new AbortController().signal,
  })
  assertFailure(scriptError, "SCRIPT_FAILED", "worker_script_error")

  const outputLimit = await runWorker("worker_output_limit", {
    source: "self.onmessage = () => postMessage('x'.repeat(1024 * 1024 + 1))",
    input: {},
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: new AbortController().signal,
  })
  assertFailure(outputLimit, "OUTPUT_TOO_LARGE", "worker_output_limit")

  const timeout = await runWorker("worker_timeout", {
    source: "self.onmessage = () => {}",
    input: {},
    timeoutSeconds: 1,
    abortSignal: new AbortController().signal,
  })
  assertFailure(timeout, "TIMEOUT", "worker_timeout")

  const cancellation = new AbortController()
  const cancelledRun = runWorker("worker_cancellation", {
    source: "self.onmessage = () => {}",
    input: {},
    timeoutSeconds: SMOKE_TIMEOUT_SECONDS,
    abortSignal: cancellation.signal,
  })
  setTimeout(() => cancellation.abort(), 50)
  assertFailure(await cancelledRun, "CANCELLED", "worker_cancellation")
}

async function verifyNodeCli(executablePath: string, root: string): Promise<void> {
  const cwd = path.join(root, "Unicode 工作目录")
  const resolvedCwd = await checkOperation("node_fixture_prepare", async () => {
    await mkdir(path.join(cwd, "node_modules", "local-value"), { recursive: true })
    const resolved = await realpath(cwd)
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
    return resolved
  })

  const commonjs = await runNode("node_commonjs_result", executablePath, {
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
  assertSuccess(commonjs, "node_commonjs_result")
  if (
    !isRecord(commonjs.result)
    || commonjs.result.value !== 42
    || commonjs.result.cwd !== resolvedCwd
    || commonjs.result.commonjs !== true
  ) {
    throw new ScriptRuntimeSmokeCheckFailure("node_commonjs_contract")
  }
  if (!commonjs.logs.some((log) => log.label === "stderr" && log.value.includes("node-log"))) {
    throw new ScriptRuntimeSmokeCheckFailure("node_stderr_log")
  }

  const esm = await runNode("node_esm_result", executablePath, {
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
  assertSuccess(esm, "node_esm_result")
  if (!isRecord(esm.result) || esm.result.value !== 42 || esm.result.esm !== true) {
    throw new ScriptRuntimeSmokeCheckFailure("node_esm_contract")
  }

  const outputLimit = await runNode("node_output_limit", executablePath, {
    source: "process.stdout.write(JSON.stringify('x'.repeat(1024 * 1024 + 1)))",
    input: {},
    cwd: resolvedCwd,
    moduleMode: "commonjs",
  })
  assertFailure(outputLimit, "OUTPUT_TOO_LARGE", "node_output_limit")

  const timeoutPidPath = path.join(cwd, "timeout.pid")
  const timeout = await runNode("node_timeout_result", executablePath, {
    source: `
      require("node:fs").writeFileSync(${JSON.stringify(timeoutPidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `,
    input: {},
    cwd: resolvedCwd,
    moduleMode: "commonjs",
    timeoutSeconds: 1,
  })
  assertFailure(timeout, "TIMEOUT", "node_timeout_result")
  await assertRecordedProcessStopped(timeoutPidPath, "node_timeout")

  const cancelPidPath = path.join(cwd, "cancel.pid")
  const cancellation = new AbortController()
  const cancelledRun = runNode("node_cancel_result", executablePath, {
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
  assertFailure(await cancelledRun, "CANCELLED", "node_cancel_result")
  await assertRecordedProcessStopped(cancelPidPath, "node_cancel")

  const names = await checkOperation("node_temp_list", () => readdir(resolvedCwd))
  if (names.some((name) => name.startsWith(".synapse-node-"))) {
    throw new ScriptRuntimeSmokeCheckFailure("node_temp_cleanup")
  }
}

function runWorker(
  check: ScriptRuntimeSmokeCheck,
  request: Parameters<typeof runChromiumWorkerScript>[0],
): Promise<ScriptRunOutcome> {
  return checkOperation(check, () => runChromiumWorkerScript(request))
}

function runNode(
  check: ScriptRuntimeSmokeCheck,
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
  return checkOperation(check, () => runNodeCliScript({
    source: request.source,
    input: request.input,
    timeoutSeconds: request.timeoutSeconds ?? SMOKE_TIMEOUT_SECONDS,
    abortSignal: request.abortSignal ?? new AbortController().signal,
    cwd: request.cwd,
    moduleMode: request.moduleMode,
  }, {
    executablePath,
    baseEnv: process.env,
  }))
}

function assertSuccess(
  outcome: ScriptRunOutcome,
  check: ScriptRuntimeSmokeCheck,
): asserts outcome is Extract<ScriptRunOutcome, { status: "success" }> {
  if (outcome.status !== "success") {
    throw new ScriptRuntimeSmokeCheckFailure(check, outcome.code)
  }
}

function assertFailure(
  outcome: ScriptRunOutcome,
  code: string,
  check: ScriptRuntimeSmokeCheck,
): void {
  if (outcome.status === "success" || outcome.code !== code) {
    throw new ScriptRuntimeSmokeCheckFailure(check, outcome.status === "success" ? "SUCCESS" : outcome.code)
  }
}

async function checkOperation<T>(check: ScriptRuntimeSmokeCheck, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    throw new ScriptRuntimeSmokeCheckFailure(check)
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
  throw new ScriptRuntimeSmokeCheckFailure("node_cancel_start")
}

async function assertRecordedProcessStopped(filePath: string, prefix: "node_timeout" | "node_cancel"): Promise<void> {
  const pid = Number.parseInt(await checkOperation(`${prefix}_pid_read`, () => readFile(filePath, "utf8")), 10)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isProcessAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new ScriptRuntimeSmokeCheckFailure(`${prefix}_process_stopped`)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
