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
  } catch {
    return null
  }
}

async function detectClis(): Promise<SynapseCliDetectResult[]> {
  logger.info("Starting CLI detection.", { platform: process.platform, shell: process.env.SHELL })

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
