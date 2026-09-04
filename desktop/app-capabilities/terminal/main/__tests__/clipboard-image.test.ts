import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { materializeTerminalClipboardImage } from "../clipboard-image"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })))
})

describe("materializeTerminalClipboardImage", () => {
  it("preserves text clipboard priority without reading or writing an image", async () => {
    const directory = await createTempDirectory()
    const readImage = vi.fn()

    await expect(materializeTerminalClipboardImage({
      clipboard: { readText: () => "plain text", readImage },
      directory,
    })).resolves.toBeNull()

    expect(readImage).not.toHaveBeenCalled()
  })

  it("returns null for an empty clipboard image", async () => {
    const directory = await createTempDirectory()

    await expect(materializeTerminalClipboardImage({
      clipboard: {
        readText: () => "",
        readImage: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
      },
      directory,
    })).resolves.toBeNull()
  })

  it("writes an image-only clipboard as a private PNG", async () => {
    const directory = await createTempDirectory()
    const png = Buffer.from("png-content")

    const filePath = await materializeTerminalClipboardImage({
      clipboard: {
        readText: () => "",
        readImage: () => ({ isEmpty: () => false, toPNG: () => png }),
      },
      directory,
      createId: () => "test-id",
    })

    expect(filePath).toBe(path.join(directory, "clipboard-image-test-id.png"))
    await expect(readFile(filePath!)).resolves.toEqual(png)
    expect((await stat(filePath!)).mode & 0o777).toBe(0o600)
  })

  it("rejects clipboard images larger than 10 MB", async () => {
    const directory = await createTempDirectory()

    await expect(materializeTerminalClipboardImage({
      clipboard: {
        readText: () => "",
        readImage: () => ({
          isEmpty: () => false,
          toPNG: () => Buffer.alloc(10 * 1024 * 1024 + 1),
        }),
      },
      directory,
    })).rejects.toThrow("10 MB")
  })

  it("removes stale terminal clipboard images when writing a new one", async () => {
    const directory = await createTempDirectory()
    const stalePath = path.join(directory, "clipboard-image-stale.png")
    const unrelatedPath = path.join(directory, "keep.txt")
    await writeFile(stalePath, "stale")
    await writeFile(unrelatedPath, "keep")
    const now = Date.now()
    const staleTime = new Date(now - 25 * 60 * 60 * 1000)
    await utimes(stalePath, staleTime, staleTime)

    await materializeTerminalClipboardImage({
      clipboard: {
        readText: () => "",
        readImage: () => ({ isEmpty: () => false, toPNG: () => Buffer.from("new") }),
      },
      directory,
      now,
      createId: () => "new",
    })

    await expect(stat(stalePath)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(unrelatedPath, "utf8")).resolves.toBe("keep")
  })
})

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-clipboard-test-"))
  tempDirectories.push(directory)
  return directory
}
