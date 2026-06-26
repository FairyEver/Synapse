/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DriveDocumentImageSource, DriveDocumentImageSourcesDto } from "@synapse/shared"

import { DriveMarkdownImageSourcePanel } from "../drive-markdown-image-source-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("DriveMarkdownImageSourcePanel", () => {
  it("imports all importable sources when canImport is true", async () => {
    const onImport = vi.fn()
    await renderPanel({
      sources: createImageSources({
        canImport: true,
        sources: [
          createImageSource({
            id: "source-1",
            src: "https://example.test/a.png",
            kind: "external",
            canImport: true,
          }),
          createImageSource({
            id: "source-2",
            src: "https://example.test/b.png",
            kind: "owner_asset",
            canImport: false,
          }),
        ],
      }),
      onImport,
    })

    expect(document.body.textContent).toContain("图片来源")

    await clickButton("转存全部")

    expect(onImport).toHaveBeenCalledWith(["https://example.test/a.png"])
  })

  it("shows owner import hint when canImport is false", async () => {
    await renderPanel({
      sources: createImageSources({
        canImport: false,
        sources: [
          createImageSource({
            src: "https://example.test/a.png",
            kind: "collaborator_asset",
            canImport: false,
          }),
        ],
      }),
    })

    expect(queryButton("转存全部")).toBeNull()
    expect(document.body.textContent).toContain("所有者可转存")
  })
})

async function renderPanel({
  sources,
  onImport = vi.fn(),
}: {
  readonly sources: DriveDocumentImageSourcesDto
  readonly onImport?: (sources: readonly string[]) => void
}): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <DriveMarkdownImageSourcePanel
        open
        sources={sources}
        onOpenChange={vi.fn()}
        onImport={onImport}
        onRefresh={vi.fn()}
      />
    )
  })
}

async function clickButton(name: string): Promise<void> {
  const button = queryButton(name)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${name}`)

  await act(async () => {
    button.click()
  })
}

function queryButton(name: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll("button"))
    .find((element) => element.textContent?.trim() === name) ?? null
}

function createImageSources(overrides: Partial<DriveDocumentImageSourcesDto> = {}): DriveDocumentImageSourcesDto {
  const sources = overrides.sources ?? []
  return {
    itemId: "item-1",
    versionId: null,
    canImport: false,
    sources,
    summary: {
      total: sources.length,
      ownerAsset: sources.filter((source) => source.kind === "owner_asset").length,
      collaboratorAsset: sources.filter((source) => source.kind === "collaborator_asset").length,
      external: sources.filter((source) => source.kind === "external").length,
      invalid: sources.filter((source) => source.kind === "invalid").length,
      unsupported: sources.filter((source) => source.kind === "unsupported").length,
      importable: sources.filter((source) => source.canImport).length,
    },
    ...overrides,
  }
}

function createImageSource(overrides: Partial<DriveDocumentImageSource> = {}): DriveDocumentImageSource {
  return {
    id: "source-1",
    imageKey: "image-1",
    src: "https://example.test/image.png",
    kind: "external",
    occurrenceCount: 1,
    canImport: true,
    status: "ready",
    ...overrides,
  }
}
