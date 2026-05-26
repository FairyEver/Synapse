import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { atomicWriteTextFile } from "../atomic-write"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-atomic-write-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("atomicWriteTextFile", () => {
  it("writes through a temporary file and leaves only the final file", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "manifest.json")

    await atomicWriteTextFile(filePath, "{\"version\":1}\n")

    await expect(readFile(filePath, "utf8")).resolves.toBe("{\"version\":1}\n")
    await expect(readdir(root)).resolves.toEqual(["manifest.json"])
  })

  it("cleans up the temporary file if commit fails", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "address-counter.txt")
    await mkdir(filePath)

    await expect(atomicWriteTextFile(filePath, "2\n")).rejects.toThrow()

    await expect(readdir(root)).resolves.toEqual(["address-counter.txt"])
  })
})
