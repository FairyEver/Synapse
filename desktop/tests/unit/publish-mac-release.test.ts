import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { parse } from "yaml"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, "../..")
const scriptPath = path.join(desktopRoot, "scripts/release/publish-mac-release.mjs")

async function writeMacArtifacts(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.dmg"), "mac-dmg")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.dmg.blockmap"), "mac-dmg-blockmap")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.zip"), "mac-zip")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.zip.blockmap"), "mac-zip-blockmap")
  await writeFile(path.join(dir, "latest-mac.yml"), [
    "version: 0.2.214",
    "path: Synapse-0.2.214-mac-arm64.zip",
    "files:",
    "  - url: Synapse-0.2.214-mac-arm64.zip",
    "    sha512: maczipsha",
    "    size: 7",
    "  - url: Synapse-0.2.214-mac-arm64.dmg",
    "    sha512: macdmgsha",
    "    size: 7",
    "",
  ].join("\n"))
}

describe("publish-mac-release", () => {
  it("dry-runs a mac-only release without Windows metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-publish-mac-"))
    const artifactsDir = path.join(root, "release")
    const outDir = path.join(root, "cdn-release")
    await writeMacArtifacts(artifactsDir)

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub",
      "--dry-run",
    ], { cwd: desktopRoot })

    const latestMac = parse(await readFile(path.join(outDir, "latest-mac.yml"), "utf8"))
    expect(latestMac.path).toBe("v0.2.214/Synapse-0.2.214-mac-arm64.zip")
    expect(stdout).toContain("cos://release/v0.2.214/")
    expect(stdout).toContain("cos://release/latest-mac.yml")
    expect(stdout).toContain("Would prune old COS release versions after publish")
    expect(stdout).not.toContain("latest-windows.yml")
    expect(stdout).not.toContain("cos://release/latest.yml")
  })

  it("loads release credentials from an ignored env file without printing values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-publish-mac-env-"))
    const artifactsDir = path.join(root, "release")
    const outDir = path.join(root, "cdn-release")
    const envFile = path.join(root, ".env.release.local")
    await writeMacArtifacts(artifactsDir)
    await writeFile(envFile, [
      "TENCENT_CLOUD_SECRET_ID=secret-id-from-file",
      "TENCENT_CLOUD_SECRET_KEY=\"secret-key-from-file\"",
      "",
    ].join("\n"))

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--env-file",
      envFile,
      "--dry-run",
    ], { cwd: desktopRoot })

    expect(stdout).toContain(`Loaded env file: ${envFile}`)
    expect(stdout).not.toContain("secret-id-from-file")
    expect(stdout).not.toContain("secret-key-from-file")
  })

  it("skips the COS prune dry-run when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-publish-mac-skip-prune-"))
    const artifactsDir = path.join(root, "release")
    const outDir = path.join(root, "cdn-release")
    await writeMacArtifacts(artifactsDir)

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--dry-run",
      "--skip-cos-prune",
    ], { cwd: desktopRoot })

    expect(stdout).not.toContain("Would prune old COS release versions after publish")
  })
})
