import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acquireDragonScaleAddressFileLock,
  DragonScaleAddressService,
  dragonScaleAddressLockPath,
} from "../dragonscale/address-service"

const roots: string[] = []
const execFileAsync = promisify(execFile)

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-dragonscale-"))
  roots.push(dir)
  return dir
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("DragonScaleAddressService", () => {
  it("allocates the next address and increments the vault counter", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "42\n")
    const service = new DragonScaleAddressService()

    const result = await service.allocate(root)

    expect(result.address).toBe("c-000042")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("43\n")
  })

  it("peeks without incrementing", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "7\n")
    const service = new DragonScaleAddressService()

    await expect(service.peek(root)).resolves.toBe(7)
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("7\n")
  })

  it("peeks a missing counter without creating it", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki"), { recursive: true })
    const service = new DragonScaleAddressService()

    await expect(service.peek(root)).resolves.toBe(1)
    await expect(pathExists(path.join(root, ".vault-meta", "address-counter.txt"))).resolves.toBe(false)
  })

  it("recovers a missing counter by scanning existing wiki frontmatter", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Alpha.md"), [
      "---",
      "type: concept",
      "address: c-000009",
      "---",
      "",
      "# Alpha",
      "",
    ].join("\n"))
    const service = new DragonScaleAddressService()

    const result = await service.allocate(root)

    expect(result.address).toBe("c-000010")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("11\n")
  })

  it("rejects corrupt counters instead of silently resetting", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "abc\n")
    const service = new DragonScaleAddressService()

    await expect(service.allocate(root)).rejects.toThrow("DragonScale address counter is corrupt")
  })

  it("serializes concurrent allocations for one vault", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    const service = new DragonScaleAddressService()

    const results = await Promise.all([
      service.allocate(root),
      service.allocate(root),
      service.allocate(root),
    ])

    expect(results.map((result) => result.address).sort()).toEqual([
      "c-000001",
      "c-000002",
      "c-000003",
    ])
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("4\n")
  })

  it("serializes concurrent allocations across service instances", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")

    const results = await Promise.all([
      new DragonScaleAddressService().allocate(root),
      new DragonScaleAddressService().allocate(root),
      new DragonScaleAddressService().allocate(root),
    ])

    expect(results.map((result) => result.address).sort()).toEqual([
      "c-000001",
      "c-000002",
      "c-000003",
    ])
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("4\n")
  })

  it("uses a project file lock for address counter writes", async () => {
    const root = await tempDir()
    const lockRoot = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    const lockPath = dragonScaleAddressLockPath(root, { lockRoot })
    await mkdir(lockPath, { recursive: true })
    const service = new DragonScaleAddressService({
      lockRoot,
      lockTimeoutMs: 20,
      lockRetryMs: 1,
    })

    await expect(service.allocate(root)).rejects.toThrow("Timed out waiting for DragonScale address lock")

    await rm(lockPath, { recursive: true, force: true })
    await expect(service.allocate(root)).resolves.toMatchObject({ address: "c-000001" })
  })

  it("recovers a stale project file lock whose owner process is gone", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    const lockPath = dragonScaleAddressLockPath(root)
    await mkdir(lockPath, { recursive: true })
    await writeFile(path.join(lockPath, "owner"), "123456789:stale-owner\n")
    vi.spyOn(process, "kill").mockImplementation(((pid: number | string, signal?: NodeJS.Signals | number) => {
      if (pid === 123456789 && signal === 0) {
        throw Object.assign(new Error("process is gone"), { code: "ESRCH" })
      }
      return true
    }) as typeof process.kill)
    const service = new DragonScaleAddressService({
      lockTimeoutMs: 20,
      lockRetryMs: 1,
    })

    await expect(service.allocate(root)).resolves.toMatchObject({ address: "c-000001" })

    await expect(pathExists(lockPath)).resolves.toBe(false)
  })

  it("shares the project-local helper lock with the Bash address allocator", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "scripts"), { recursive: true })
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    await copyFile(
      path.join(process.cwd(), "resources", "knowledge-base", "synapse-knowledge-base-template", "scripts", "allocate-address.sh"),
      path.join(root, "scripts", "allocate-address.sh"),
    )
    const release = await acquireDragonScaleAddressFileLock(root, {
      ownerId: "electron-test",
      timeoutMs: 20,
      retryMs: 1,
    })

    try {
      await expect(execFileAsync("bash", [path.join(root, "scripts", "allocate-address.sh")], {
        env: { ...process.env, ADDRESS_LOCK_TIMEOUT_SECONDS: "0" },
      })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("could not acquire address allocator lock"),
      })
    } finally {
      await release()
    }

    const result = await execFileAsync("bash", [path.join(root, "scripts", "allocate-address.sh")])
    expect(result.stdout.trim()).toBe("c-000001")
  })

  it("does not let an old file lock release remove a new lock owner", async () => {
    const root = await tempDir()
    const lockRoot = await tempDir()
    const lockPath = dragonScaleAddressLockPath(root, { lockRoot })
    const releaseOldOwner = await acquireDragonScaleAddressFileLock(root, {
      lockRoot,
      ownerId: "owner-a",
      retryMs: 1,
      timeoutMs: 20,
    })

    await rm(lockPath, { recursive: true, force: true })
    await mkdir(lockPath, { recursive: true })
    await writeFile(path.join(lockPath, "owner"), "owner-b\n")

    await releaseOldOwner()

    await expect(readFile(path.join(lockPath, "owner"), "utf8")).resolves.toBe("owner-b\n")
  })

  it("exports the address service from the knowledge-base service barrel", async () => {
    const module = await import("../index")

    expect(module.DragonScaleAddressService).toBe(DragonScaleAddressService)
  })
})
