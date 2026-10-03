import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { constants } from "node:fs"
import { mkdtemp, open, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readGitConfigurationSnapshot, readGitMetadataSnapshot, standardGitConfigurationLocations, standardGitConfigurationPaths } from "../mobile-workspace-files-git-config"
import { gitConversionTextStats } from "../mobile-workspace-files-git"
import { MobileWorkspaceFilesError, readDiskFile } from "../mobile-workspace-files-paths"
import { MOBILE_WORKSPACE_FILES_LIMITS as L } from "@synapse/shared/mobile-live-constants"

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, open: vi.fn(actual.open) }
})
const originalOpen = vi.mocked(open).getMockImplementation()!
const execute = promisify(execFile), roots: string[] = []
afterEach(async () => { vi.mocked(open).mockImplementation(originalOpen); vi.mocked(open).mockClear(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synapse-mobile-config-")))
  roots.push(root)
  return { root, target: path.join(root, "config"), signal: new AbortController().signal }
}

describe("mobile immutable Git configuration reads", () => {
  it("bounds pointer bytes at four KiB and closes an immutable descriptor cancelled after open", async () => {
    const f = await fixture(), authorized = vi.fn(async () => {})
    await writeFile(f.target, "x".repeat(L.maxPathBytes))
    expect(await readGitMetadataSnapshot(f.target, authorized, f.signal, L.maxPathBytes)).toMatchObject({ text: "x".repeat(L.maxPathBytes), sizeBytes: L.maxPathBytes })
    vi.mocked(open).mockClear()
    await writeFile(f.target, "x".repeat(L.maxPathBytes + 1))
    await expect(readGitMetadataSnapshot(f.target, authorized, f.signal, L.maxPathBytes)).rejects.toMatchObject({ code: "limit_exceeded" })
    expect(open).not.toHaveBeenCalled()
    await writeFile(f.target, "safe\n")
    const abort = new AbortController()
    let closed = false
    vi.mocked(open).mockImplementationOnce(async (target, flags, mode) => {
      const descriptor = await originalOpen(target, flags, mode), close = descriptor.close.bind(descriptor)
      descriptor.close = async () => { closed = true; await close() }
      abort.abort()
      return descriptor
    })
    await expect(readGitMetadataSnapshot(f.target, authorized, abort.signal, L.maxPathBytes)).rejects.toMatchObject({ code: "cancelled" })
    expect(closed).toBe(true)
  })

  it("retains the actual bounded descriptor byte count independently of UTF-8 BOM decoding", async () => {
    const f = await fixture(), authorized = vi.fn(async () => {})
    expect(await readGitMetadataSnapshot(f.target, authorized, f.signal, L.maxPathBytes)).toBeNull()
    await writeFile(f.target, "")
    expect(await readGitMetadataSnapshot(f.target, authorized, f.signal, L.maxPathBytes)).toMatchObject({ text: "", sizeBytes: 0 })
    await writeFile(f.target, Buffer.from([0xef, 0xbb, 0xbf]))
    expect(await readGitMetadataSnapshot(f.target, authorized, f.signal, L.maxPathBytes)).toMatchObject({ text: "", sizeBytes: 3 })
  })

  it("limits nonstandard desktop overrides without interpreting their paths", () => {
    for (const environment of [{ GIT_CONFIG_GLOBAL: "/unapproved" }, { GIT_CONFIG_SYSTEM: "/unapproved" }, { GIT_CONFIG_PARAMETERS: "'core.autocrlf=true'" }, { GIT_CONFIG_COUNT: "1" }, { GIT_CONFIG_COUNT: "invalid" }]) {
      const locations = standardGitConfigurationLocations(environment)
      expect(locations.unsupportedConfigurationOverride).toBe(true)
      expect(() => standardGitConfigurationPaths(locations)).toThrow("git_unavailable")
    }
    expect(standardGitConfigurationLocations({ GIT_CONFIG_COUNT: "0" }).unsupportedConfigurationOverride).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
  })

  it("uses Git's built-in binary conversion heuristic for baseline and disk bytes", () => {
    expect(gitConversionTextStats(Buffer.from("unchanged\r\nold\rX\n")).binary).toBe(true)
    expect(gitConversionTextStats(Buffer.from("unchanged\r\nold\0\n")).binary).toBe(true)
    expect(gitConversionTextStats(Buffer.from("x\r\n\x01")).binary).toBe(true)
    expect(gitConversionTextStats(Buffer.from("\b\t\x1b\f".repeat(32) + "\r\n\x01")).binary).toBe(false)
    expect(gitConversionTextStats(Buffer.from("x\r\n\x1a"))).toEqual({ binary: false, crlf: 1 })
  })
  it("authorizes the exact file before testing existence and bounds its immutable bytes", async () => {
    const f = await fixture(), denied = vi.fn(async () => { throw new MobileWorkspaceFilesError("permission_denied") })
    await expect(readGitConfigurationSnapshot(f.target, denied, f.signal)).rejects.toMatchObject({ code: "permission_denied" })
    expect(denied).toHaveBeenCalledWith(f.target); expect(open).not.toHaveBeenCalled()
    const authorized = vi.fn(async () => {})
    expect(await readGitConfigurationSnapshot(f.target, authorized, f.signal)).toEqual({ text: "", version: `${f.target}:absent` })
    await writeFile(f.target, "[core]\nautocrlf = true\n")
    const first = await readGitConfigurationSnapshot(f.target, authorized, f.signal)
    expect(first.text).toBe("[core]\nautocrlf = true\n")
    await writeFile(f.target, "[core]\nautocrlf = false\n")
    expect((await readGitConfigurationSnapshot(f.target, authorized, f.signal)).version).not.toBe(first.version)
    await writeFile(f.target, Buffer.alloc(64 * 1024 + 1))
    await expect(readGitConfigurationSnapshot(f.target, authorized, f.signal)).rejects.toMatchObject({ code: "limit_exceeded" })
  })

  it.skipIf(process.platform === "win32")("rejects file-to-FIFO races promptly in both config and content readers", async () => {
    for (const kind of ["config", "content"] as const) {
      const f = await fixture()
      await writeFile(f.target, "safe\n")
      vi.mocked(open).mockImplementationOnce(async (target, flags, mode) => {
        expect(Number(flags) & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
        await rm(f.target); await execute("mkfifo", [f.target])
        return originalOpen(target, flags, mode)
      })
      const start = performance.now()
      await expect(kind === "config" ? readGitConfigurationSnapshot(f.target, async () => {}, f.signal) : readDiskFile(f.root, "config", f.signal)).rejects.toMatchObject({ code: "content_stale" })
      expect(performance.now() - start).toBeLessThan(1000)
    }
  })

  it.skipIf(process.platform === "win32")("does not follow a symlink in a trusted configuration location", async () => {
    const f = await fixture(), outside = await fixture()
    await writeFile(outside.target, "private\n"); await symlink(outside.target, f.target)
    await expect(readGitConfigurationSnapshot(f.target, async () => {}, f.signal)).rejects.toMatchObject({ code: "unsafe_path" })
    expect(open).not.toHaveBeenCalled()
  })
})
