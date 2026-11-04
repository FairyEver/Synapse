import { Readable } from "node:stream"
import { crc32, deflateSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import { collectHubUpload, SkillHubUploadService, validateHubUploadHeaders } from "./skill-hub-upload.service"
import { assertSkillHubIcon } from "./skill-hub-png"
import type { SkillHubRepository } from "./skill-hub.repository"
import type { SkillHubTeamService } from "./skill-hub-team.service"
import * as codec from "./skill-hub-upload-codec"

function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([header, type, data, checksum])
}

function png(scanlines: Buffer, corruptCrc = false) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(256)
  ihdr.writeUInt32BE(256, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = chunk("IDAT", deflateSync(scanlines))
  if (corruptCrc) idat[idat.length - 1] ^= 1
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), idat, chunk("IEND", Buffer.alloc(0))])
}

describe("Skill Hub raw upload", () => {
  const signal = new AbortController().signal
  it("enforces the actual byte count even with missing or false declared size", async () => {
    await expect(collectHubUpload(Readable.from([Buffer.from("abcd")]), 4, undefined, signal)).resolves.toEqual(Buffer.from("abcd"))
    await expect(collectHubUpload(Readable.from([Buffer.from("abcd")]), 4, 3, signal)).rejects.toMatchObject({ response: { code: "HUB_INVALID_UPLOAD_LENGTH" } })
    await expect(collectHubUpload(Readable.from([Buffer.from("abcd"), Buffer.of(0)]), 4, undefined, signal)).rejects.toMatchObject({ response: { code: "HUB_UPLOAD_TOO_LARGE" } })
    expect(() => validateHubUploadHeaders({ "content-type": "application/octet-stream", "content-encoding": "gzip" }, 50)).toThrow()
    expect(() => validateHubUploadHeaders({ "content-type": "application/json" }, 50)).toThrow()
  })

  it("cancels without waiting for the sender to finish an open stream", async () => {
    const controller = new AbortController()
    const source = new Readable({ read: vi.fn() })
    const pending = collectHubUpload(source, 4, undefined, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(source.listenerCount("data")).toBe(0)
    source.destroy()
  })

  it("tracks both keys before writing and never marks a partial package ready", async () => {
    const resolveUploadTeam = vi.fn().mockResolvedValue({ id: "team", name: "团队" })
    const create = vi.fn().mockImplementation(async ({ data }) => data)
    const prisma = { skillHubUpload: { findUnique: vi.fn().mockResolvedValue(null), create }, $transaction: vi.fn() }
    const put = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("object write failed"))
    const service = new SkillHubUploadService({ prisma } as unknown as SkillHubRepository,
      { resolveUploadTeam } as unknown as SkillHubTeamService, { put, open: vi.fn(), head: vi.fn(), remove: vi.fn() })
    const validate = vi.spyOn(codec, "runHubUploadCodec").mockResolvedValue({
      files: [
        { kind: "archive", bytes: Buffer.of(1), contentType: "application/zip" },
        { kind: "main", bytes: Buffer.of(2), contentType: "text/plain" },
      ],
    })
    try {
      await expect(service.stage("caller", {
        teamId: "team", purpose: "package", format: "markdown", requestId: "stable",
      }, Readable.from([Buffer.of(1)]), signal)).rejects.toMatchObject({ response: { code: "HUB_STORAGE_UNAVAILABLE" } })
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
        actorKey: "caller", teamId: "team", objects: { create: [
          expect.objectContaining({ storageKey: expect.stringMatching(/^skill-hub\/.+\/archive$/) }),
          expect.objectContaining({ storageKey: expect.stringMatching(/^skill-hub\/.+\/main$/) }),
        ] },
      }) })
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0])
      expect(prisma.$transaction).not.toHaveBeenCalled()
    } finally {
      validate.mockRestore()
    }
  })

  it("checks the selected team before reading upload bytes", async () => {
    const resolveUploadTeam = vi.fn().mockRejectedValue(new Error("not a member"))
    const put = vi.fn()
    const service = new SkillHubUploadService({} as SkillHubRepository,
      { resolveUploadTeam } as unknown as SkillHubTeamService, { put, open: vi.fn(), head: vi.fn(), remove: vi.fn() })
    const read = vi.fn()
    const stream = new Readable({ read })
    await expect(service.stage("caller", { teamId: "other", purpose: "icon", requestId: "req" }, stream, signal))
      .rejects.toThrow("not a member")
    expect(read).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    stream.destroy()
  })

  it("verifies all normalized PNG chunks, CRC, inflation and scanline filters", () => {
    const image = Buffer.alloc((256 * 4 + 1) * 256)
    expect(() => assertSkillHubIcon(png(image))).not.toThrow()
    expect(() => assertSkillHubIcon(png(image, true))).toThrow()
    expect(() => assertSkillHubIcon(png(image.subarray(0, -1)))).toThrow()
    image[0] = 9
    expect(() => assertSkillHubIcon(png(image))).toThrow()
  })
})
