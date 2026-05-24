import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DragonScaleAddressService, dragonScaleAddressLockPath } from "../dragonscale/address-service"

const roots: string[] = []

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

  it("exports the address service from the knowledge-base service barrel", async () => {
    const module = await import("../index")

    expect(module.DragonScaleAddressService).toBe(DragonScaleAddressService)
  })
})
