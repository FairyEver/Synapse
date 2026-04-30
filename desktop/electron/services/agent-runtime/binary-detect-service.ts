import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function getCommonBinDirs(): string[] {
  const home = homedir()
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local")
    const programData = process.env.ProgramData ?? process.env.PROGRAMDATA ?? "C:\\ProgramData"

    return [
      join(appData, "npm"),
      join(localAppData, "Volta", "bin"),
      join(localAppData, "Microsoft", "WindowsApps"),
      join(home, "scoop", "shims"),
      join(programData, "chocolatey", "bin"),
      join(home, ".bun", "bin"),
    ]
  }

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
    await access(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function binaryFileNames(bin: string): string[] {
  if (process.platform !== "win32" || /\.[A-Za-z0-9]+$/.test(bin)) {
    return [bin]
  }

  return [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, bin]
}

async function whichViaShell(bin: string): Promise<string | null> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where", [bin], { timeout: 5000 })
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? null
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
  } catch {
    return null
  }

  return null
}

async function whichViaCommonPaths(bin: string): Promise<string | null> {
  for (const dir of getCommonBinDirs()) {
    for (const fileName of binaryFileNames(bin)) {
      const fullPath = join(dir, fileName)
      if (await isExecutable(fullPath)) {
        return fullPath
      }
    }
  }
  return null
}

async function whichBin(bin: string): Promise<string | null> {
  // 先查常见路径（纯 fs 检查，毫秒级），再走 shell（需要加载 ~/.zshrc，慢）
  const fast = await whichViaCommonPaths(bin)
  if (fast) return fast

  const slow = await whichViaShell(bin)
  return slow
}

export { whichBin }
