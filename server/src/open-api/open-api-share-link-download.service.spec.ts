import { describe, expect, it, vi } from "vitest"
import { DriveOpenApiDownloadPreparationError } from "../drive/drive-open-api-download"
import { OpenApiShareLinkDownloadService } from "./open-api-share-link-download.service"

const principal = {
  userId: "user-1",
  apiKeyId: "key-1",
  scopes: ["drive.share_link.download"],
}

describe("OpenApiShareLinkDownloadService", () => {
  it("creates a ten-minute opaque download URL from the complete share URL and one usage row", async () => {
    const artifact = {
      sourceType: "share" as const,
      artifactType: "file" as const,
      fileName: "需求.md",
      mimeType: "text/markdown",
      size: 12n,
      entryPath: null,
      target: { kind: "share" as const, shareId: "shr-1", itemId: "item-1" },
      entries: [],
    }
    const driveLinks = { prepareDownloadArtifact: vi.fn().mockResolvedValue(artifact) }
    const grants = { create: vi.fn().mockResolvedValue({
      grantId: "dlg-1",
      token: "secret-token",
      expiresAt: new Date("2026-08-23T09:10:00.000Z"),
      snapshotId: "snap-1",
    }) }
    const usageLogs = usageLogMock()
    const service = new OpenApiShareLinkDownloadService(driveLinks as never, grants as never, usageLogs as never)

    await expect(service.create({
      principal,
      requestId: "req-1",
      ipAddress: "203.0.113.1",
      publicAppUrl: "https://synapse.example/",
      url: "https://synapse.example/share/shr-1?password=share-secret",
    })).resolves.toEqual({
      sourceType: "share",
      artifact: {
        type: "file",
        fileName: "需求.md",
        mimeType: "text/markdown",
        size: "12",
        entryPath: null,
        snapshotId: "snap-1",
      },
      download: {
        method: "GET",
        url: "https://synapse.example/api/open/v1/downloads/dlg-1?token=secret-token",
        expiresAt: "2026-08-23T09:10:00.000Z",
      },
    })
    expect(driveLinks.prepareDownloadArtifact).toHaveBeenCalledWith({
      url: "https://synapse.example/share/shr-1?password=share-secret",
    })
    expect(usageLogs.start).toHaveBeenCalledOnce()
    expect(usageLogs.finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded",
      httpStatus: 201,
      grantId: "dlg-1",
    }))
  })

  it("maps password failures to the stable public contract", async () => {
    const driveLinks = {
      prepareDownloadArtifact: vi.fn().mockRejectedValue(
        new DriveOpenApiDownloadPreparationError("password_required"),
      ),
    }
    const usageLogs = usageLogMock()
    const service = new OpenApiShareLinkDownloadService(driveLinks as never, {} as never, usageLogs as never)

    await expect(service.create({
      principal,
      requestId: "req-2",
      ipAddress: "203.0.113.2",
      publicAppUrl: "https://synapse.example",
      url: "https://synapse.example/share/shr-1",
    })).rejects.toMatchObject({
      statusCode: 403,
      code: "LINK_PASSWORD_REQUIRED_OR_INVALID",
    })
    expect(usageLogs.finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      httpStatus: 403,
      errorCode: "LINK_PASSWORD_REQUIRED_OR_INVALID",
    }))
  })
})

function usageLogMock() {
  return {
    start: vi.fn().mockResolvedValue({ id: "usage-1", startedAt: new Date("2026-08-23T09:00:00.000Z") }),
    finish: vi.fn().mockResolvedValue(undefined),
  }
}
