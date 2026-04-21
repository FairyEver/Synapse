import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { SynapseCliDetectResult, SynapseCliId } from "../../../src/types/cli"

const execFileAsync = promisify(execFile)

const CLI_DEFINITIONS: ReadonlyArray<{ id: SynapseCliId; label: string; bin: string }> = [
  { id: "claude-code", label: "Claude Code", bin: "claude" },
  { id: "codex", label: "Codex", bin: "codex" },
]

async function whichBin(bin: string): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where" : "which"
  try {
    const { stdout } = await execFileAsync(cmd, [bin], { timeout: 5000 })
    const firstLine = stdout.trim().split("\n")[0]
    return firstLine || null
  } catch {
    return null
  }
}

async function detectClis(): Promise<SynapseCliDetectResult[]> {
  return Promise.all(
    CLI_DEFINITIONS.map(async ({ id, label, bin }) => {
      const binPath = await whichBin(bin)
      return { id, label, installed: binPath !== null, path: binPath }
    }),
  )
}

export { CLI_DEFINITIONS, detectClis, whichBin }
