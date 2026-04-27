import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { createMainLogger } from "../log-store"

const execFileAsync = promisify(execFile)
const logger = createMainLogger("service.cli-detect")

function getCommonBinDirs(): string[] {
  const home = homedir()
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
  ]
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function whichViaShell(bin: string): Promise<string | null> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where", [bin], { timeout: 5000 })
      return stdout.trim().split("\n")[0] || null
    } catch {
      return null
    }
  }

  // macOS/Linux: -i 加载 ~/.zshrc，-l 加载 ~/.zprofile，确保拿到完整 PATH
  const shell = process.env.SHELL || "/bin/zsh"
  try {
    const { stdout } = await execFileAsync(shell, ["-i", "-l", "-c", `which ${bin}`], { timeout: 8000 })
    const firstLine = stdout.trim().split(/\n/).pop()?.trim() ?? ""
    if (firstLine && !firstLine.includes("not found") && firstLine.startsWith("/")) {
      return firstLine
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    logger.debug("Shell which lookup missed.", { bin, stdout: e.stdout?.trim() })
  }

  return null
}

async function whichViaCommonPaths(bin: string): Promise<string | null> {
  for (const dir of getCommonBinDirs()) {
    const fullPath = join(dir, bin)
    if (await isExecutable(fullPath)) {
      return fullPath
    }
  }
  return null
}

async function whichBin(bin: string): Promise<string | null> {
  // 先查常见路径（纯 fs 检查，毫秒级），再走 shell（需要加载 ~/.zshrc，慢）
  const fast = await whichViaCommonPaths(bin)
  if (fast) return fast

  const slow = await whichViaShell(bin)
  if (slow) {
    logger.info("Found via shell fallback.", { bin, path: slow })
  }
  return slow
}

export { whichBin }
