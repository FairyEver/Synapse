import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DriveService } from "./drive.service"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

describe("Drive annotation document computations", () => {
  beforeEach(() => vi.stubEnv("USER_ACCESS_JWT_SECRET", "annotation-document-tests-secret-32"))
  afterEach(() => vi.unstubAllEnvs())

  const item = { id: "item-1", type: "file", name: "note.md", mimeType: "text/markdown", storageKey: "object-1" }

  function fixture() {
    const prisma = {
      driveFileVersion: { findFirst: vi.fn(async () => ({ id: "version-1" })) },
      driveCollaborationDocument: { findUnique: vi.fn(async () => ({ epoch: "epoch-1" })) },
    }
    const storage = { getObjectStream: vi.fn(async () => ({ stream: Readable.from("# 标题\n\n正文😀") })) }
    let projectionRevision: string | null = null
    const projections = {
      getRevision: vi.fn(async () => projectionRevision),
      load: vi.fn(async () => null), loadPrevious: vi.fn(async () => null),
      persist: vi.fn(async ({ projection }) => { projectionRevision = createHash("sha256").update(JSON.stringify(projection)).digest("hex") }),
    }
    const collaboration = { getLiveDocument: vi.fn(() => null as unknown) }
    const service = new DriveService(prisma as never, storage as never, undefined, undefined, undefined, projections as never, collaboration as never)
    return { prisma, storage, projections, collaboration, service }
  }

  it("shares concurrent parses and reuses them while still reading the current version and epoch", async () => {
    const f = fixture()
    const [first, second] = await Promise.all([f.service.resolveAnnotationDocument(item), f.service.resolveAnnotationDocument(item)])
    expect(first).toEqual(second)
    expect(f.storage.getObjectStream).toHaveBeenCalledTimes(1)
    expect(f.projections.persist).toHaveBeenCalledTimes(1)
    f.prisma.driveCollaborationDocument.findUnique.mockResolvedValue({ epoch: "epoch-2" })
    const third = await f.service.resolveAnnotationDocument(item)
    expect(third.epoch).toBe("epoch-2")
    expect(f.storage.getObjectStream).toHaveBeenCalledTimes(1)
    f.prisma.driveFileVersion.findFirst.mockResolvedValue({ id: "version-2" })
    await f.service.resolveAnnotationDocument({ ...item, storageKey: "object-2" })
    expect(f.storage.getObjectStream).toHaveBeenCalledTimes(2)
  })

  it("invalidates cached live content on deletion even when checkpoint and epoch stay the same", async () => {
    const f = fixture()
    const source = "😀正文"
    const rendered = await renderDriveMarkdownFragment(source)
    const live = { sourceText: source, epoch: "epoch-1", checkpointVersionId: "version-1", projection: rendered.projection, projectionSource: source }
    f.collaboration.getLiveDocument.mockReturnValue(live)
    const first = await f.service.resolveAnnotationDocument(item)
    f.collaboration.getLiveDocument.mockReturnValue({ ...live, sourceText: "正文" })
    const second = await f.service.resolveAnnotationDocument(item)
    expect(first.renderedText).toBe("😀正文")
    expect(second.renderedText).toBe("正文")
    expect(second.projection.sourceSha256).not.toBe(first.projection.sourceSha256)
    expect(f.projections.persist).not.toHaveBeenCalled()
  })

  it("uses regenerated persistent block identities for the same version and source", async () => {
    const f = fixture()
    const source = "Intro\n\nNote\n\nNote"
    const previous = await renderDriveMarkdownFragment("Note\n\nNote")
    const original = await renderDriveMarkdownFragment(source, { previousProjection: { source: "Note\n\nNote", projection: previous.projection } })
    const regenerated = await renderDriveMarkdownFragment(source)
    expect(original.projection.blocks.map((block) => block.blockId)).not.toEqual(regenerated.projection.blocks.map((block) => block.blockId))
    f.storage.getObjectStream.mockImplementation(async () => ({ stream: Readable.from(source) }))
    f.projections.getRevision.mockResolvedValueOnce("original").mockResolvedValue("regenerated")
    f.projections.load.mockResolvedValueOnce(original.projection as never).mockResolvedValue(regenerated.projection as never)
    const first = await f.service.resolveAnnotationDocument(item)
    const second = await f.service.resolveAnnotationDocument(item)
    expect(first.projection).toEqual(original.projection)
    expect(second.projection).toEqual(regenerated.projection)
  })

  it("retries a failed source read without retaining a failed computation", async () => {
    const f = fixture()
    f.storage.getObjectStream.mockRejectedValueOnce(new Error("source unavailable"))
    await expect(f.service.resolveAnnotationDocument(item)).rejects.toThrow("source unavailable")
    await expect(f.service.resolveAnnotationDocument(item)).resolves.toMatchObject({ versionId: "version-1" })
    expect(f.storage.getObjectStream).toHaveBeenCalledTimes(2)
  })

  it("does not reuse an unpersisted projection when its persistent identity is unavailable", async () => {
    const f = fixture()
    f.projections.persist.mockResolvedValue(undefined)
    await f.service.resolveAnnotationDocument(item)
    await f.service.resolveAnnotationDocument(item)
    expect(f.storage.getObjectStream).toHaveBeenCalledTimes(2)
  })
})
