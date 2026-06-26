import type { DriveDocumentImageSource } from "@synapse/shared"

export type DriveDocumentImageInventoryRow = {
  readonly itemId: string
  readonly versionId: string | null
  readonly imageKey: string
  readonly src: string
  readonly kind: DriveDocumentImageSource["kind"]
  readonly occurrenceCount: number
  readonly assetId: string | null
  readonly assetOwnerId: string | null
  readonly status: DriveDocumentImageSource["status"]
}

export function buildDriveDocumentImageInventoryRows(input: {
  readonly itemId: string
  readonly versionId: string | null
  readonly sources: readonly DriveDocumentImageSource[]
}): DriveDocumentImageInventoryRow[] {
  return input.sources.map((source) => ({
    itemId: input.itemId,
    versionId: input.versionId,
    imageKey: source.imageKey,
    src: source.src,
    kind: source.kind,
    occurrenceCount: source.occurrenceCount,
    assetId: source.assetId ?? null,
    assetOwnerId: source.assetOwnerId ?? null,
    status: source.status,
  }))
}
