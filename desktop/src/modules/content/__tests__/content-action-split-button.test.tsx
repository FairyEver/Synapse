import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { createDefaultConfig } from "@/lib/config"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: createDefaultConfig(),
    error: null,
    isReady: true,
    refreshConfig: vi.fn(),
    updateConfig: vi.fn(),
    resetKey: 0,
  }),
}))

const useContentDownloadActionsMock = vi.hoisted(() => vi.fn())

vi.mock("@/modules/content/hooks/use-content-download-actions", () => ({
  useContentDownloadActions: useContentDownloadActionsMock,
}))

vi.mock("@/components/ui/dropdown-menu", async () => {
  const { createElement } = await vi.importActual<typeof import("react")>("react")

  type MockDropdownProps = {
    align?: string
    asChild?: boolean
    children?: ReactNode
    className?: string
    "data-track"?: string
  }

  const createMockComponent =
    (slot: string) =>
      ({ children, "data-track": dataTrack }: MockDropdownProps) =>
        createElement("div", { "data-slot": slot, "data-track": dataTrack }, children)

  return {
    DropdownMenu: createMockComponent("dropdown-menu"),
    DropdownMenuContent: createMockComponent("dropdown-menu-content"),
    DropdownMenuGroup: createMockComponent("dropdown-menu-group"),
    DropdownMenuItem: createMockComponent("dropdown-menu-item"),
    DropdownMenuLabel: createMockComponent("dropdown-menu-label"),
    DropdownMenuSeparator: createMockComponent("dropdown-menu-separator"),
    DropdownMenuTrigger: createMockComponent("dropdown-menu-trigger"),
  }
})

function createContentItem(type: SynapseContentType): SynapseContentMeta {
  return {
    attachmentCount: type === "skill" ? 1 : 0,
    category: "general",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-1",
    createdByDisplayName: "User",
    deleted: false,
    description: "Description",
    icon: "file",
    iconBg: "muted",
    id: `${type}-1`,
    latestHistoryDirname: "20260101000000",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    modifiedBy: "user-1",
    modifiedByDisplayName: "User",
    title: "Title",
    type,
  }
}

function mockDownloadActions() {
  useContentDownloadActionsMock.mockReturnValue({
    auxiliaryMenuSections: [
      {
        key: "copy",
        items: [
          {
            key: "copy-content",
            label: "复制正文",
          },
        ],
      },
    ],
    canCopy: true,
    canDownload: true,
    canInstall: true,
    downloadAction: {
      key: "download-local",
      label: "下载到本地",
    },
    handleCopy: vi.fn(),
    installAction: {
      key: "install",
      label: "安装",
    },
    installDialog: null,
    isBusy: false,
    isCopying: false,
    isDownloading: false,
  })
}

describe("ContentActionSplitButton", () => {
  it.each(["skill", "rule"] as const)(
    "renders a single %s install button and keeps download/copy on the arrow menu",
    (contentType) => {
      mockDownloadActions()

      const html = renderToStaticMarkup(
        <ContentActionSplitButton item={createContentItem(contentType)} />,
      )
      const installMenuStart = html.indexOf('data-track="content-install-menu"')
      const overflowMenuStart = html.indexOf('data-track="content-actions-menu"')

      expect(installMenuStart).toBe(-1)
      expect(overflowMenuStart).toBeGreaterThan(-1)
      expect(html).toContain(">安装<")
      expect(html).not.toContain(">下载</button>")
      const overflowMenu = html.slice(overflowMenuStart)

      expect(html).not.toContain("Codex")
      expect(overflowMenu).toContain("下载到本地")
      expect(overflowMenu).toContain("复制正文")
    },
  )
})
