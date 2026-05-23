import type { DragonScaleAddressService } from "./dragonscale/address-service"
import { DragonScaleAddressService as DefaultDragonScaleAddressService } from "./dragonscale/address-service"
import type { DragonScaleAddress } from "./dragonscale/types"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest } from "./manifest"
import { insertAddressIntoWikiPage, readAddressedWikiPages } from "./wiki-page-addresses"

export interface KnowledgeBaseIngestFinalizerResult {
  readonly assigned: readonly { readonly path: string; readonly address: DragonScaleAddress }[]
  readonly reused: readonly { readonly path: string; readonly address: DragonScaleAddress }[]
  readonly skippedReason?: "invalid-manifest"
}

type KnowledgeBaseIngestFinalizerDeps = {
  readonly addressService?: DragonScaleAddressService
}

export class KnowledgeBaseIngestFinalizer {
  private readonly addressService: DragonScaleAddressService

  constructor(deps: KnowledgeBaseIngestFinalizerDeps = {}) {
    this.addressService = deps.addressService ?? new DefaultDragonScaleAddressService()
  }

  async finalize(projectPath: string): Promise<KnowledgeBaseIngestFinalizerResult> {
    const readResult = await readKnowledgeBaseManifest(projectPath)
    if (readResult.status === "invalid") {
      return { assigned: [], reused: [], skippedReason: "invalid-manifest" }
    }

    const manifest = readResult.manifest
    const nextAddressMap = { ...manifest.address_map }
    const assigned: { path: string; address: DragonScaleAddress }[] = []
    const reused: { path: string; address: DragonScaleAddress }[] = []
    const pages = await readAddressedWikiPages(projectPath)

    for (const page of pages) {
      const mappedAddress = nextAddressMap[page.relativePath] as DragonScaleAddress | undefined
      const existing = page.address ?? mappedAddress
      if (existing) {
        if (!page.address) {
          await insertAddressIntoWikiPage(page.absolutePath, existing)
        }
        nextAddressMap[page.relativePath] = existing
        reused.push({ path: page.relativePath, address: existing })
        continue
      }

      const allocation = await this.addressService.allocate(projectPath)
      await insertAddressIntoWikiPage(page.absolutePath, allocation.address)
      nextAddressMap[page.relativePath] = allocation.address
      assigned.push({ path: page.relativePath, address: allocation.address })
    }

    if (assigned.length > 0 || reused.length > 0) {
      await writeKnowledgeBaseManifest(projectPath, {
        ...manifest,
        address_map: nextAddressMap,
      })
    }

    return { assigned, reused }
  }
}
