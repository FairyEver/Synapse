import { execFile } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, "../..")
const scriptPath = path.join(desktopRoot, "scripts/release/package-mac-release.mjs")

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.SYNAPSE_DESKTOP_PUBLIC_APP_URL
  delete env.SYNAPSE_DESKTOP_REQUIRE_PUBLIC_APP_URL
  return env
}

describe("package-mac-release", () => {
  it("loads the desktop public app URL from an env file before packaging", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-package-mac-env-"))
    const envFile = path.join(root, ".env.release.local")
    await writeFile(envFile, [
      "SYNAPSE_DESKTOP_PUBLIC_APP_URL=https://synapse.d2.pub",
      "TENCENT_CLOUD_SECRET_KEY=secret-key-from-file",
      "",
    ].join("\n"))

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--env-file",
      envFile,
      "--check",
    ], { cwd: desktopRoot, env: childEnv() })

    expect(stdout).toContain(`Loaded env file: ${envFile}`)
    expect(stdout).toContain("Desktop public app URL: https://synapse.d2.pub")
    expect(stdout).toContain("Release package preflight passed.")
    expect(stdout).not.toContain("secret-key-from-file")
  })

  it("fails preflight when the desktop public app URL is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-package-mac-missing-env-"))
    const envFile = path.join(root, ".env.release.local")
    await writeFile(envFile, "TENCENT_CLOUD_SECRET_KEY=secret-key-from-file\n")

    await expect(execFileAsync(process.execPath, [
      scriptPath,
      "--env-file",
      envFile,
      "--check",
    ], { cwd: desktopRoot, env: childEnv() })).rejects.toMatchObject({
      stderr: expect.stringContaining("SYNAPSE_DESKTOP_PUBLIC_APP_URL"),
    })
  })
})
