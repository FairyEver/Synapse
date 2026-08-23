import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { OpenApiDownloadGrantService } from "./open-api-download-grant.service"

describe("OpenApiDownloadGrantService", () => {
  it("stores only a token digest and stable normalized entries", async () => {
    const created = vi.fn().mockResolvedValue({ id: "grant-1" })
    const tx = { openApiDownloadGrant: { create: created } }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const service = createService(prisma)
    const artifact = publicAssetArtifact()

    const result = await service.create({
      userId: "user-1",
      apiKeyId: "key-1",
      artifact,
      now: new Date("2026-08-23T09:00:00.000Z"),
    })
    const data = created.mock.calls[0]?.[0]?.data

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result.snapshotId).toMatch(/^snap_[A-Za-z0-9_-]{43}$/u)
    expect(result.expiresAt.toISOString()).toBe("2026-08-23T09:10:00.000Z")
    expect(data.leaseUntil).toEqual(result.expiresAt)
    expect(data.tokenHash).toBe(createHash("sha256").update(result.token).digest("hex"))
    expect(JSON.stringify(data, (_key, value) => typeof value === "bigint" ? value.toString() : value))
      .not.toContain(result.token)
    expect(data.entries.create).toEqual([expect.objectContaining({
      ordinal: 0,
      entryType: "file",
      storageKey: "public-assets/current",
    })])

    const repeated = await service.create({
      userId: "user-1",
      apiKeyId: "key-1",
      artifact,
      now: new Date("2026-08-23T09:01:00.000Z"),
    })
    const changed = await service.create({
      userId: "user-1",
      apiKeyId: "key-1",
      artifact: {
        ...artifact,
        entries: artifact.entries.map((entry) => ({ ...entry, etag: "etag-2" })),
      },
      now: new Date("2026-08-23T09:01:00.000Z"),
    })
    expect(repeated.snapshotId).toBe(result.snapshotId)
    expect(changed.snapshotId).not.toBe(result.snapshotId)
  })

  it("authenticates by digest and hides unknown grant state", async () => {
    const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
    const grant = {
      id: "dlg_1",
      tokenHash: createHash("sha256").update(token).digest("hex"),
    }
    const prisma = {
      openApiDownloadGrant: { findUnique: vi.fn().mockResolvedValue(grant) },
    }
    const service = createService(prisma)

    await expect(service.authenticate("dlg_1", token)).resolves.toBe(grant)
    await expect(service.authenticate("dlg_1", `${token.slice(0, -1)}Z`)).rejects.toMatchObject({
      statusCode: 404,
      code: "DOWNLOAD_NOT_FOUND",
    })
    await expect(service.authenticate("dlg_1", "short")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_DOWNLOAD_TOKEN",
    })
  })

  it("rejects expired, revoked, and unknown download plans with one public status", async () => {
    const service = createService({})
    const baseGrant = {
      expiresAt: new Date("2026-08-23T09:10:00.000Z"),
      planVersion: 1,
      apiKey: { scopes: ["drive.share_link.download"], revokedAt: null, user: { status: "active" } },
    }

    await expect(service.assertAvailable({
      ...baseGrant,
      expiresAt: new Date("2026-08-23T08:59:59.000Z"),
    } as never, new Date("2026-08-23T09:00:00.000Z"))).rejects.toMatchObject({
      statusCode: 410,
      code: "DOWNLOAD_UNAVAILABLE",
    })
    await expect(service.assertAvailable({
      ...baseGrant,
      apiKey: {
        scopes: ["drive.share_link.download"],
        revokedAt: new Date("2026-08-23T08:59:00.000Z"),
        user: { status: "active" },
      },
    } as never, new Date("2026-08-23T09:00:00.000Z"))).rejects.toMatchObject({
      statusCode: 410,
      code: "DOWNLOAD_UNAVAILABLE",
    })
    await expect(service.assertAvailable({
      ...baseGrant,
      planVersion: 999,
    } as never, new Date("2026-08-23T09:00:00.000Z"))).rejects.toMatchObject({
      statusCode: 410,
      code: "DOWNLOAD_UNAVAILABLE",
    })
  })

  it("rejects a previously issued download after its API key loses the required scope", async () => {
    const revalidateOpenApiShareTarget = vi.fn().mockResolvedValue(true)
    const service = new OpenApiDownloadGrantService(
      {} as never,
      { revalidateOpenApiShareTarget } as never,
      {} as never,
      {} as never,
      {} as never,
      { warn: vi.fn() } as never,
    )

    await expect(service.assertAvailable({
      expiresAt: new Date("2026-08-23T09:10:00.000Z"),
      planVersion: 1,
      apiKey: { scopes: [], revokedAt: null, user: { status: "active" } },
      target: { kind: "share", shareId: "share-1", itemId: "item-1" },
      entries: [],
    } as never, new Date("2026-08-23T09:00:00.000Z"))).rejects.toMatchObject({
      statusCode: 410,
      code: "DOWNLOAD_UNAVAILABLE",
    })
    expect(revalidateOpenApiShareTarget).not.toHaveBeenCalled()
  })

  it("keeps a previously issued download available while its API key retains the required scope", async () => {
    const revalidateOpenApiShareTarget = vi.fn().mockResolvedValue(true)
    const service = new OpenApiDownloadGrantService(
      {} as never,
      { revalidateOpenApiShareTarget } as never,
      {} as never,
      {} as never,
      {} as never,
      { warn: vi.fn() } as never,
    )

    await expect(service.assertAvailable({
      expiresAt: new Date("2026-08-23T09:10:00.000Z"),
      planVersion: 1,
      apiKey: {
        scopes: ["drive.share_link.download"],
        revokedAt: null,
        user: { status: "active" },
      },
      target: { kind: "share", shareId: "share-1", itemId: "item-1" },
      entries: [],
    } as never, new Date("2026-08-23T09:00:00.000Z"))).resolves.toBeUndefined()
    expect(revalidateOpenApiShareTarget).toHaveBeenCalledOnce()
  })

  it("requires the fixed public asset etag to remain verifiable", async () => {
    const service = new OpenApiDownloadGrantService(
      {} as never,
      {} as never,
      {} as never,
      { revalidateOpenApiPublicAssetTarget: vi.fn().mockResolvedValue(true) } as never,
      { headObject: vi.fn().mockResolvedValue({ size: 12n, etag: null }) } as never,
      { warn: vi.fn() } as never,
    )
    const grant = {
      expiresAt: new Date("2026-08-23T09:10:00.000Z"),
      planVersion: 1,
      apiKey: { scopes: ["drive.share_link.download"], revokedAt: null, user: { status: "active" } },
      target: { kind: "public_asset", assetId: "asset-1", publicAssetId: "public-1" },
      entries: [{
        entryType: "file",
        storageKey: "public-assets/current",
        size: 12n,
        etag: "etag-1",
        driveFileVersionId: null,
      }],
    }

    await expect(service.assertAvailable(
      grant as never,
      new Date("2026-08-23T09:00:00.000Z"),
    )).rejects.toMatchObject({ statusCode: 410, code: "DOWNLOAD_UNAVAILABLE" })
  })
})

function createService(prisma: Record<string, unknown>) {
  return new OpenApiDownloadGrantService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { warn: vi.fn() } as never,
  )
}

function publicAssetArtifact() {
  return {
    sourceType: "public_asset" as const,
    artifactType: "file" as const,
    fileName: "report.pdf",
    mimeType: "application/pdf",
    size: 12n,
    entryPath: null,
    target: { kind: "public_asset" as const, assetId: "asset-1", publicAssetId: "public-1" },
    entries: [{
      entryType: "file" as const,
      relativePath: null,
      storageKey: "public-assets/current",
      driveFileVersionId: null,
      immutableId: "public-1",
      size: 12n,
      mimeType: "application/pdf",
      etag: "etag-1",
      sha256: null,
    }],
  }
}
