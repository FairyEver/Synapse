import { createHash } from "node:crypto"
import path from "node:path"
import type { ControlledProcessRunner } from "../runtime/process"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("live-machine-fingerprint")

/** Reads only fixed OS commands; raw hardware identifiers never leave this function. */
export function createMachineFingerprintReader(
  runner: Pick<ControlledProcessRunner, "run">,
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot ?? "C:\\Windows",
): () => Promise<string | null> {
  let cached: string | null = null
  let pending: Promise<string | null> | null = null
  async function read(): Promise<string | null> {
    if (platform !== "darwin" && platform !== "win32") return null
    try {
      const result = await runner.run({
        actor: { kind: "system", id: "live-machine-identity" },
        action: "shell.exec",
        command: platform === "darwin" ? "/usr/sbin/ioreg"
          : path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        args: platform === "darwin" ? ["-rd1", "-c", "IOPlatformExpertDevice"] : [
          "-NoProfile", "-NonInteractive", "-Command",
          "$ErrorActionPreference = 'Stop'; (Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID",
        ],
        pathStrategy: "replace",
        timeoutMs: 5_000,
        output: { stdout: "buffer", stderr: "ignore", maxBufferBytes: 64 * 1024 },
        metadata: { source: "live.machine-identity" },
      })
      if (result.timedOut || result.exitCode !== 0 || result.error || result.stdoutTruncated) {
        logger.warn("Machine identity lookup failed.", { platform, timedOut: result.timedOut, exitCode: result.exitCode })
        return null
      }
      const output = result.stdout ?? ""
      const uuid = (platform === "darwin"
        ? /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output)?.[1]
        : output.trim())?.toLowerCase()
      if (!uuid || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uuid)
        || /^(?:0|-)+$/.test(uuid) || /^(?:f|-)+$/.test(uuid)) {
        logger.warn("Machine identity is unavailable or invalid.", { platform })
        return null
      }
      return createHash("sha256").update(`synapse.live.machine.v1:${platform}:${uuid}`).digest("hex")
    } catch (error) {
      logger.warn("Machine identity lookup could not run.", {
        platform, errorName: error instanceof Error ? error.name : typeof error,
      })
      return null
    }
  }
  return () => {
    if (cached) return Promise.resolve(cached)
    pending ??= read().then((value) => { cached = value; return value }).finally(() => { pending = null })
    return pending
  }
}
