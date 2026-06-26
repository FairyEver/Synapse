import { describe, expect, it } from "vitest"
import { buildDriveDocumentImageInventoryRows } from "./drive-document-image-inventory"

describe("drive document image inventory", () => {
  it("builds cache rows without becoming permission source", () => {
    const rows = buildDriveDocumentImageInventoryRows({
      itemId: "item-1",
      versionId: "ver-1",
      sources: [{
        id: "img_1",
        imageKey: "img_1",
        src: "https://example.test/a.png",
        kind: "external",
        occurrenceCount: 2,
        canImport: true,
        status: "ready",
      }],
    })

    expect(rows).toEqual([{
      itemId: "item-1",
      versionId: "ver-1",
      imageKey: "img_1",
      src: "https://example.test/a.png",
      kind: "external",
      occurrenceCount: 2,
      assetId: null,
      assetOwnerId: null,
      status: "ready",
    }])
  })
})
