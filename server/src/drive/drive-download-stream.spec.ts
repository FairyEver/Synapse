import type { Response } from "express"
import { PassThrough, Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { sendDriveZip } from "./drive-download-stream"

describe("sendDriveZip", () => {
  it("destroys opened object streams when the client disconnects", async () => {
    const objectStream = new Readable({ read() {} })
    objectStream.on("error", () => undefined)
    let markOpened: (() => void) | undefined
    const opened = new Promise<void>((resolve) => {
      markOpened = resolve
    })
    const storage = {
      getObjectStream: vi.fn().mockImplementation(async () => {
        markOpened?.()
        return { stream: objectStream }
      }),
    }
    const responseStream = Object.assign(new PassThrough(), {
      setHeader: vi.fn(),
      headersSent: false,
    })
    responseStream.on("error", () => undefined)

    const sending = sendDriveZip(
      responseStream as unknown as Response,
      "archive.zip",
      (async function* () {
        yield { path: "file.txt", storageKey: "drive/file.txt" }
      })(),
      storage as never,
    )

    await opened
    responseStream.emit("close")

    await expect(sending).rejects.toThrow("response closed before completion")
    expect(objectStream.destroyed).toBe(true)
  })
})
