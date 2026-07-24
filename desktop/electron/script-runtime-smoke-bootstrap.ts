import { writeFile } from "node:fs/promises"

export type ScriptRuntimeSmokeBootstrapConfig = {
  readonly resultPath: string
}

type SmokeStage =
  | "result_create"
  | "app_ready"
  | "runtime"
  | "result_complete"

type SmokeLogger = {
  warn(message: string, details: { readonly stage: SmokeStage; readonly reason: string }): void
}

export function resolveScriptRuntimeSmokeBootstrap(
  env: NodeJS.ProcessEnv,
): ScriptRuntimeSmokeBootstrapConfig | null {
  const resultPath = env.SYNAPSE_SCRIPT_RUNTIME_SMOKE_RESULT
  return env.SYNAPSE_SCRIPT_RUNTIME_SMOKE === "1" && resultPath
    ? { resultPath }
    : null
}

export async function startScriptRuntimeSmokeBootstrap(options: {
  readonly config: ScriptRuntimeSmokeBootstrapConfig
  readonly executablePath: string
  readonly whenReady: () => Promise<unknown>
  readonly runSmoke: (executablePath: string) => Promise<void>
  readonly exit: (code: number) => void
  readonly logger: SmokeLogger
  readonly stdout?: Pick<NodeJS.WriteStream, "write">
  readonly stderr?: Pick<NodeJS.WriteStream, "write">
  readonly writeResult?: typeof writeFile
}): Promise<void> {
  const writeResult = options.writeResult ?? writeFile
  let stage: SmokeStage = "result_create"
  let resultCreated = false
  try {
    await writeSmokeResult(writeResult, options.config.resultPath, {
      stage: "result_create",
      reason: "started",
    }, "wx")
    resultCreated = true

    stage = "app_ready"
    await options.whenReady()
    stage = "runtime"
    await options.runSmoke(options.executablePath)
    stage = "result_complete"
    await writeSmokeResult(writeResult, options.config.resultPath, {
      stage: "result_complete",
      reason: "ok",
    }, "a")
    const stdout = options.stdout ?? process.stdout
    stdout.write("synapse-script-runtime-packaged-smoke-ok\n")
    options.exit(0)
  } catch (error) {
    const reason = smokeFailureReason(stage, error)
    options.logger.warn("Packaged script runtime smoke failed.", { stage, reason })
    if (resultCreated) {
      try {
        await writeSmokeResult(writeResult, options.config.resultPath, { stage, reason }, "a")
      } catch (resultError) {
        options.logger.warn("Packaged script runtime smoke result write failed.", {
          stage: "result_complete",
          reason: smokeFailureReason("result_complete", resultError),
        })
      }
    }
    const stderr = options.stderr ?? process.stderr
    stderr.write("Packaged script runtime smoke failed.\n")
    options.exit(1)
  }
}

async function writeSmokeResult(
  writer: typeof writeFile,
  path: string,
  result: { readonly stage: SmokeStage; readonly reason: string },
  flag: "wx" | "a",
): Promise<void> {
  await writer(path, `${JSON.stringify(result)}\n`, {
    encoding: "utf8",
    flag,
  })
}

function smokeFailureReason(stage: SmokeStage, error: unknown): string {
  if (stage === "runtime") return "smoke_failed"
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : ""
  switch (code) {
    case "EEXIST": return "already_exists"
    case "EACCES":
    case "EPERM": return "permission_denied"
    case "ENOENT": return "not_found"
    case "EIO": return "io"
    default: return stage === "app_ready" ? "app_ready_failed" : "unknown"
  }
}
