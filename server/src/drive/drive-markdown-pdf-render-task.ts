import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

export type DriveMarkdownPdfImageReference = {
  readonly source: string
  readonly resourceKey: string
  readonly occurrences: number
}

export type DriveMarkdownPdfWorkerRequest =
  | {
      readonly kind: "discover-images"
      readonly markdown: string
      readonly allowStandaloneRawImages: boolean
      readonly maxImages: number
      readonly resourceKeys?: ReadonlySet<string>
    }
  | {
      readonly kind: "render-html"
      readonly markdown: string
      readonly allowStandaloneRawImages: boolean
      readonly imageResourceKeys: ReadonlyMap<string, string | null>
    }

export type DriveMarkdownPdfWorkerResult =
  | {
      readonly kind: "image-discovery"
      readonly images: readonly DriveMarkdownPdfImageReference[]
      readonly tooManyImages: boolean
    }
  | {
      readonly kind: "html"
      readonly html: string
    }

export async function executeDriveMarkdownPdfWorkerRequest(
  request: DriveMarkdownPdfWorkerRequest,
): Promise<DriveMarkdownPdfWorkerResult> {
  if (request.kind === "render-html") {
    const rendered = await renderDriveMarkdownFragment(request.markdown, {
      allowStandaloneRawImages: request.allowStandaloneRawImages,
      pdfImageResourceKeys: request.imageResourceKeys,
    })
    return { kind: "html", html: rendered.html }
  }

  const rendered = await renderDriveMarkdownFragment(request.markdown, {
    allowStandaloneRawImages: request.allowStandaloneRawImages,
  })
  const images = new Map<string, DriveMarkdownPdfImageReference>()
  let tooManyImages = false
  for (const image of rendered.projection.images ?? []) {
    if (request.resourceKeys && !request.resourceKeys.has(image.resourceKey)) continue
    const existing = images.get(image.resourceKey)
    if (existing) {
      images.set(image.resourceKey, { ...existing, occurrences: existing.occurrences + 1 })
      continue
    }
    if (images.size >= request.maxImages) {
      tooManyImages = true
      break
    }
    images.set(image.resourceKey, {
      source: image.source,
      resourceKey: image.resourceKey,
      occurrences: 1,
    })
  }
  return { kind: "image-discovery", images: [...images.values()], tooManyImages }
}
