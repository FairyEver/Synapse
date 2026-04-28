import { renderToStaticMarkup } from "react-dom/server"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { EditorInstallStatusPanel } from "@/modules/content/components/editor-install-status-panel"
import type { SynapseEditorInstallStatusEntry } from "@/types/editor-install-status"

const baseEntry = {
  editorId: "codex",
  editorLabel: "Codex",
  message: null,
  projectId: undefined,
  projectName: undefined,
  scope: "global",
  targetPath: "/Users/liyang/.codex/AGENTS.md",
} satisfies Omit<SynapseEditorInstallStatusEntry, "status">

function renderPanel(
  props: Partial<ComponentProps<typeof EditorInstallStatusPanel>> = {},
) {
  return renderToStaticMarkup(
    <EditorInstallStatusPanel
      entries={[]}
      error={null}
      isLoading={false}
      onOpenInstallTarget={vi.fn()}
      onRefresh={vi.fn()}
      {...props}
    />,
  )
}

describe("EditorInstallStatusPanel", () => {
  it("renders editor install status entries without filler copy", () => {
    const html = renderPanel({
      entries: [
        {
          ...baseEntry,
          status: "installed",
        },
        {
          ...baseEntry,
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "unsupported",
          targetPath: null,
        },
      ],
    })

    expect(html).toContain("安装状态")
    expect(html).toContain("Codex")
    expect(html).toContain("已安装")
    expect(html).toContain("Cursor")
    expect(html).toContain("不支持")
    expect(html).not.toContain("此页面用于")
  })

  it("renders error state with retry action", () => {
    const html = renderPanel({
      error: "读取失败",
    })

    expect(html).toContain("读取失败")
    expect(html).toContain("重试")
  })

  it("renders install and update actions for writable statuses", () => {
    const html = renderPanel({
      entries: [
        {
          ...baseEntry,
          status: "not_installed",
        },
        {
          ...baseEntry,
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "needs_update",
        },
      ],
    })

    expect(html).toContain("安装")
    expect(html).toContain("更新")
  })
})
