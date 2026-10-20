import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DriveMarkdownProjectionService } from "./drive-markdown-projection.service"
import { DRIVE_MARKDOWN_PARSER_VERSION } from "./drive-markdown-projection"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

describe("Drive Markdown projection cache", () => {
  it("fits the current parser version in the migrated database column", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    const model = schema.split("model DriveMarkdownProjection {")[1]!.split("\n}")[0]!
    const capacity = Number(model.match(/parserVersion\s+String\s+@db\.VarChar\((\d+)\)/)![1])
    expect(capacity).toBeGreaterThanOrEqual(DRIVE_MARKDOWN_PARSER_VERSION.length)
    expect(readFileSync("prisma/migrations/20261020100000_expand_drive_markdown_parser_version/migration.sql", "utf8"))
      .toContain('ALTER COLUMN "parserVersion" TYPE VARCHAR(128)')
  })

  it("persists and reloads a projection with the current parser identity and content hash", async () => {
    let record: unknown = null
    let body = Buffer.alloc(0)
    const prisma = { driveMarkdownProjection: {
      upsert: vi.fn(async ({ create }) => { record = create }),
      findUnique: vi.fn(async () => record), updateMany: vi.fn(),
    } }
    const storage = {
      putObject: vi.fn(async (input) => { body = input.body }),
      getObjectStream: vi.fn(async () => ({ stream: Readable.from(body) })),
    }
    const service = new DriveMarkdownProjectionService(prisma as never, storage as never)
    const { projection } = await renderDriveMarkdownFragment("# 😀 标题\n\n缓存测试")
    await service.persist({ itemId: "item-1", versionId: "version-1", projection })
    expect(record).toMatchObject({ parserVersion: DRIVE_MARKDOWN_PARSER_VERSION, status: "ready", sha256: createHash("sha256").update(body).digest("hex") })
    expect(await service.getRevision("version-1")).toBe(createHash("sha256").update(body).digest("hex"))
    expect(await service.load("version-1")).toEqual(projection)
    record = { ...(record as object), status: "unavailable" }
    expect(await service.getRevision("version-1")).toBeNull()
    record = { ...(record as object), status: "ready", parserVersion: "old-parser" }
    expect(await service.getRevision("version-1")).toBeNull()
  })
})
