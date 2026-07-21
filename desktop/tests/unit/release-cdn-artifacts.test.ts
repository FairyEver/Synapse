import { execFile } from "node:child_process"
import { access, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { parse } from "yaml"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, "../..")
const scriptPath = path.join(desktopRoot, "scripts/release/prepare-cdn-release-artifacts.mjs")
const packageJsonPath = path.join(desktopRoot, "package.json")

async function writeFixtureArtifacts(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "Synapse-0.2.214-win-x64.exe"), "win-installer")
  await writeFile(path.join(dir, "Synapse-0.2.214-win-x64.exe.blockmap"), "win-blockmap")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.dmg"), "mac-dmg")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.dmg.blockmap"), "mac-dmg-blockmap")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.zip"), "mac-zip")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.zip.blockmap"), "mac-zip-blockmap")
  await writeFile(path.join(dir, "latest.yml"), [
    "version: 0.2.214",
    "path: Synapse-0.2.214-win-x64.exe",
    "files:",
    "  - url: Synapse-0.2.214-win-x64.exe",
    "    sha512: winsha",
    "    size: 13",
    "",
  ].join("\n"))
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

describe("prepare-cdn-release-artifacts", () => {
  it("disables generic provider multi-range requests for Tencent CDN differential updates", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))
    const [publishConfig] = packageJson.build.publish

    expect(publishConfig.provider).toBe("generic")
    expect(publishConfig.useMultipleRangeRequest).toBe(false)
  })

  it("copies immutable assets and rewrites updater metadata to versioned paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-release-cdn-"))
    const artifactsDir = path.join(root, "release-artifacts")
    const outDir = path.join(root, "cdn-release")
    await writeFixtureArtifacts(artifactsDir)

    await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub/",
    ], { cwd: desktopRoot })

    await expect(stat(path.join(outDir, "v0.2.214/Synapse-0.2.214-win-x64.exe"))).resolves.toBeTruthy()
    await expect(stat(path.join(outDir, "v0.2.214/Synapse-0.2.214-mac-arm64.dmg"))).resolves.toBeTruthy()

    const latest = parse(await readFile(path.join(outDir, "latest.yml"), "utf8"))
    expect(latest.path).toBe("v0.2.214/Synapse-0.2.214-win-x64.exe")
    expect(latest.files[0].url).toBe("v0.2.214/Synapse-0.2.214-win-x64.exe")

    const latestWindows = parse(await readFile(path.join(outDir, "latest-windows.yml"), "utf8"))
    expect(latestWindows).toEqual(latest)

    const latestMac = parse(await readFile(path.join(outDir, "latest-mac.yml"), "utf8"))
    expect(latestMac.path).toBe("v0.2.214/Synapse-0.2.214-mac-arm64.zip")
    expect(latestMac.files.map((file: { url: string }) => file.url)).toEqual([
      "v0.2.214/Synapse-0.2.214-mac-arm64.zip",
      "v0.2.214/Synapse-0.2.214-mac-arm64.dmg",
    ])

    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"))
    expect(manifest.version).toBe("0.2.214")
    expect(manifest.versionPrefix).toBe("v0.2.214")
    expect(manifest.metadataUrls).toEqual([
      "https://desktop.release.synapse.d2.pub/latest.yml",
      "https://desktop.release.synapse.d2.pub/latest-windows.yml",
      "https://desktop.release.synapse.d2.pub/latest-mac.yml",
    ])
    expect(manifest.assetUrls).toContain("https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe")

    const releaseBody = await readFile(path.join(outDir, "release-body.md"), "utf8")
    expect(releaseBody).toContain("Synapse v0.2.214")
    expect(releaseBody).toContain("https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.dmg")
    expect(releaseBody).toContain("https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe")
    expect(releaseBody).toContain("一键更新：https://synapse.d2.pub/desktop/update")
    expect(releaseBody).not.toContain("synapse://")
    expect(releaseBody).not.toMatch(/https:\/\/synapse\.d2\.pub\/desktop\/update[?#]/)
  })

  it("prepares mac-only artifacts without writing Windows metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-release-cdn-mac-"))
    const artifactsDir = path.join(root, "release-artifacts")
    const outDir = path.join(root, "cdn-release")
    await writeFixtureArtifacts(artifactsDir)

    await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub/",
      "--platform",
      "mac",
    ], { cwd: desktopRoot })

    await expect(stat(path.join(outDir, "v0.2.214/Synapse-0.2.214-mac-arm64.dmg"))).resolves.toBeTruthy()
    await expect(access(path.join(outDir, "v0.2.214/Synapse-0.2.214-win-x64.exe"))).rejects.toThrow()
    await expect(access(path.join(outDir, "latest.yml"))).rejects.toThrow()
    await expect(access(path.join(outDir, "latest-windows.yml"))).rejects.toThrow()

    const latestMac = parse(await readFile(path.join(outDir, "latest-mac.yml"), "utf8"))
    expect(latestMac.path).toBe("v0.2.214/Synapse-0.2.214-mac-arm64.zip")
    expect(latestMac.files.map((file: { url: string }) => file.url)).toEqual([
      "v0.2.214/Synapse-0.2.214-mac-arm64.zip",
      "v0.2.214/Synapse-0.2.214-mac-arm64.dmg",
    ])

    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"))
    expect(manifest.platform).toBe("mac")
    expect(manifest.artifactFiles).toEqual([
      "Synapse-0.2.214-mac-arm64.dmg",
      "Synapse-0.2.214-mac-arm64.dmg.blockmap",
      "Synapse-0.2.214-mac-arm64.zip",
      "Synapse-0.2.214-mac-arm64.zip.blockmap",
    ])
    expect(manifest.metadataUrls).toEqual([
      "https://desktop.release.synapse.d2.pub/latest-mac.yml",
    ])

    const releaseBody = await readFile(path.join(outDir, "release-body.md"), "utf8")
    expect(releaseBody).toContain("一键更新：https://synapse.d2.pub/desktop/update")
    expect(releaseBody).not.toContain("synapse://")
    expect(releaseBody).not.toMatch(/https:\/\/synapse\.d2\.pub\/desktop\/update[?#]/)
  })

  it("ignores stale artifacts from older versions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-release-cdn-stale-"))
    const artifactsDir = path.join(root, "release-artifacts")
    const outDir = path.join(root, "cdn-release")
    await writeFixtureArtifacts(artifactsDir)
    await writeFile(path.join(artifactsDir, "Synapse-0.2.213-mac-arm64.dmg"), "stale-mac-dmg")
    await writeFile(path.join(artifactsDir, "Synapse-0.2.213-mac-arm64.zip"), "stale-mac-zip")

    await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub/",
      "--platform",
      "mac",
    ], { cwd: desktopRoot })

    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"))
    expect(manifest.artifactFiles).toEqual([
      "Synapse-0.2.214-mac-arm64.dmg",
      "Synapse-0.2.214-mac-arm64.dmg.blockmap",
      "Synapse-0.2.214-mac-arm64.zip",
      "Synapse-0.2.214-mac-arm64.zip.blockmap",
    ])
    await expect(access(path.join(outDir, "v0.2.214/Synapse-0.2.213-mac-arm64.dmg"))).rejects.toThrow()
  })

  it("fails when metadata references a missing artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-release-cdn-missing-"))
    const artifactsDir = path.join(root, "release-artifacts")
    const outDir = path.join(root, "cdn-release")
    await mkdir(artifactsDir, { recursive: true })
    await writeFile(path.join(artifactsDir, "latest.yml"), [
      "version: 0.2.214",
      "path: Missing.exe",
      "files:",
      "  - url: Missing.exe",
      "    sha512: missing",
      "    size: 1",
      "",
    ].join("\n"))
    await writeFile(path.join(artifactsDir, "latest-mac.yml"), "version: 0.2.214\nfiles: []\n")

    await expect(execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub/",
    ], { cwd: desktopRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining("Metadata references missing artifact: Missing.exe"),
    })
  })
})
