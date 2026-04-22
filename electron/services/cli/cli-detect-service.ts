import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { SynapseCliDetectResult, SynapseCliId } from "../../../src/types/cli"
import { createMainLogger } from "../log-store"

const execFileAsync = promisify(execFile)
const logger = createMainLogger("service.cli-detect")

const CLI_DEFINITIONS: ReadonlyArray<{ id: SynapseCliId; label: string; bin: string }> = [
  { id: "claude-code", label: "Claude Code", bin: "claude" },
  { id: "codex", label: "Codex", bin: "codex" },
]

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
  const result = await whichViaShell(bin)
  if (result) return result

  const fallback = await whichViaCommonPaths(bin)
  if (fallback) {
    logger.info("Found via common paths fallback.", { bin, path: fallback })
  }
  return fallback
}

async function detectClis(): Promise<SynapseCliDetectResult[]> {
  logger.info("Starting CLI detection.", {
    platform: process.platform,
    shell: process.env.SHELL,
    home: process.env.HOME,
  })

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
