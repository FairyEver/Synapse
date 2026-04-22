import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { SynapseCliDetectResult, SynapseCliId } from "../../../src/types/cli"
import { createMainLogger } from "../log-store"

const execFileAsync = promisify(execFile)
const logger = createMainLogger("service.cli-detect")

const CLI_DEFINITIONS: ReadonlyArray<{ id: SynapseCliId; label: string; bin: string }> = [
  { id: "claude-code", label: "Claude Code", bin: "claude" },
  { id: "codex", label: "Codex", bin: "codex" },
]

// 打包后的 Electron 应用 PATH 会被裁剪，需要通过 login shell 获取完整 PATH
async function whichBin(bin: string): Promise<string | null> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where", [bin], { timeout: 5000 })
      const firstLine = stdout.trim().split("\n")[0]
      return firstLine || null
    } catch {
      return null
    }
  }

  // macOS/Linux: 通过 login shell 确保能读到 ~/.zshrc / ~/.bash_profile 中的 PATH
  const shell = process.env.SHELL || "/bin/zsh"
  try {
    const { stdout } = await execFileAsync(shell, ["-l", "-c", `which ${bin}`], { timeout: 8000 })
    const firstLine = stdout.trim().split("\n")[0]
    return firstLine || null
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    logger.warn("whichBin failed.", {
      bin,
      shell,
      exitCode: e.code,
      stderr: e.stderr?.trim(),
      stdout: e.stdout?.trim(),
      error: e.message,
    })
    return null
  }
}

async function detectClis(): Promise<SynapseCliDetectResult[]> {
  const shell = process.env.SHELL || "/bin/zsh"
  logger.info("Starting CLI detection.", { platform: process.platform, shell, home: process.env.HOME })

  // 诊断：打印 login shell 实际拿到的 PATH
  try {
    const { stdout: pathOut } = await execFileAsync(shell, ["-l", "-c", "echo $PATH"], { timeout: 8000 })
    logger.info("Login shell PATH.", { path: pathOut.trim() })
  } catch (err) {
    logger.warn("Failed to get login shell PATH.", { error: String(err) })
  }

  const results = await Promise.all(
    CLI_DEFINITIONS.map(async ({ id, label, bin }) => {
      const binPath = await whichBin(bin)
      logger.info("CLI detection result.", { id, bin, installed: binPath !== null, path: binPath })
      return { id, label, installed: binPath !== null, path: binPath }
    }),
  )

  return results
}

export { CLI_DEFINITIONS, detectClis, whichBin }
