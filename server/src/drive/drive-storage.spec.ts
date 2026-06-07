import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Readable } from "node:stream"
import { Test } from "@nestjs/testing"

import { LOCAL_DRIVE_STORAGE_OPTIONS, LocalDriveStorage } from "./drive-storage"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
  roots.length = 0
})

describe("LocalDriveStorage", () => {
  it("can be constructed by Nest with explicit local storage options", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocalDriveStorage,
        { provide: LOCAL_DRIVE_STORAGE_OPTIONS, useValue: { publicAppUrl: "http://localhost:3000", root } },
      ],
    }).compile()

    expect(moduleRef.get(LocalDriveStorage)).toBeInstanceOf(LocalDriveStorage)
    await moduleRef.close()
  })

  it("stores uploaded objects on local disk and reports their size", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain" })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    await storage.acceptUpload(token, Readable.from(["hello"]))

    await expect(readFile(path.join(root, "drive/item-1"), "utf8")).resolves.toBe("hello")
    await expect(storage.headObject("drive/item-1")).resolves.toMatchObject({ key: "drive/item-1", size: 5n })
  })
})
