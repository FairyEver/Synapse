/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContentDetailWindowSummary } from "@/modules/content/components/content-detail-window-layout"
import type { SynapseContentDetail } from "@/types/content"

vi.mock("@/app-shell/identity-context", () => ({
  useRepoProfileMap: () => new Map(),
}))

vi.mock("@/modules/content/hooks/use-content-favorites", () => ({
  useContentFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}))

vi.mock("@/modules/content/components/content-detail-menubar", () => ({
  ContentDetailMenubar: () => <div data-testid="content-detail-menubar" />,
}))

vi.mock("@/modules/content/components/content-item-icon", () => ({
  ContentItemIcon: () => <div data-testid="content-item-icon" />,
}))

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

function createDetail(overrides: Partial<SynapseContentDetail> = {}): SynapseContentDetail {
  return {
    attachmentCount: 0,
    attachments: [],
    category: "general",
    content: "# Skill",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-1",
    createdByDisplayName: "User",
    deleted: false,
    description: "简介内容",
    icon: "file",
    iconBg: "muted",
    id: "skill-1",
    latestHistoryDirname: "20260101000000",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    modifiedBy: "user-1",
    modifiedByDisplayName: "User",
    name: "skill-name",
    title: "Skill",
    type: "skill",
    usage: "## 使用说明\n\n**给人看的介绍**",
    ...overrides,
  }
}

async function renderSummary(detail: SynapseContentDetail) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<ContentDetailWindowSummary detail={detail} />)
  })

  return { container }
}

describe("ContentDetailWindowSummary", () => {
  it("renders usage as markdown in the left summary introduction", async () => {
    const { container } = await renderSummary(createDetail())

    expect(container.querySelector("h2")?.textContent).toBe("使用说明")
    expect(container.querySelector(".markdown-viewer h2")?.textContent).toBe("使用说明")
    expect(container.querySelector(".markdown-viewer strong")?.textContent).toBe("给人看的介绍")
    expect(container.textContent).not.toContain("简介内容")
  })
})
