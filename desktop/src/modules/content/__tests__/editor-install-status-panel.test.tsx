import { renderToStaticMarkup } from "react-dom/server"
import type { ComponentProps } from "react"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { EditorInstallStatusPanel } from "@/modules/content/components/editor-install-status-panel"
import type { SynapseEditorInstallStatusEntry } from "@/types/editor-install-status"

const showItemInFolder = vi.hoisted(() => vi.fn())

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    shell: {
      showItemInFolder,
    },
  }),
}))

const baseEntry = {
  editorId: "codex",
  editorLabel: "Codex",
  message: null,
  projectId: undefined,
  projectName: undefined,
  scope: "global",
  targetPath: "/Users/liyang/.codex/AGENTS.md",
} satisfies Omit<SynapseEditorInstallStatusEntry, "status">

function createEntry(
  overrides: Partial<SynapseEditorInstallStatusEntry>,
): SynapseEditorInstallStatusEntry {
  return {
    ...baseEntry,
    status: "installed",
    ...overrides,
  }
}

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

function createPanelElement(
  props: Partial<ComponentProps<typeof EditorInstallStatusPanel>> = {},
) {
  return EditorInstallStatusPanel({
    entries: [],
    error: null,
    isLoading: false,
    onOpenInstallTarget: vi.fn(),
    onRefresh: vi.fn(),
    ...props,
  })
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(textFromNode).join("")
  }

  if (isValidElement(node)) {
    return textFromNode((node as ReactElement<{ children?: ReactNode }>).props.children)
  }

  return ""
}

function findButtons(node: ReactNode): ReactElement<ComponentProps<typeof Button>>[] {
  if (Array.isArray(node)) {
    return node.flatMap(findButtons)
  }

  if (!isValidElement(node)) {
    return []
  }

  const element = node as ReactElement<{ children?: ReactNode }>
  const matches = element.type === Button
    ? [element as ReactElement<ComponentProps<typeof Button>>]
    : []

  return [
    ...matches,
    ...findButtons(element.props.children),
  ]
}

function findButtonByText(
  node: ReactNode,
  text: string,
): ReactElement<ComponentProps<typeof Button>> {
  const button = findButtons(node).find((candidate) => textFromNode(candidate.props.children) === text)

  if (!button) {
    throw new Error(`Button not found: ${text}`)
  }

  return button
}

describe("EditorInstallStatusPanel", () => {
  it("renders editor install status entries without filler copy", () => {
    const html = renderPanel({
      entries: [
        createEntry({
          status: "installed",
        }),
        createEntry({
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "unsupported",
          targetPath: null,
        }),
      ],
    })

    expect(html).toContain("安装状态")
    expect(html).toContain("Codex")
    expect(html).toContain("已安装")
    expect(html).toContain("Cursor")
    expect(html).toContain("不支持")
    expect(html).not.toContain("此页面用于")
  })

  it("calls onRefresh when retry is clicked in error state", () => {
    const onRefresh = vi.fn()
    const element = createPanelElement({
      error: "读取失败",
      onRefresh,
    })
    const html = renderPanel({
      error: "读取失败",
      onRefresh,
    })

    expect(html).toContain("读取失败")
    expect(html).toContain("重试")
    findButtonByText(element, "重试").props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("calls onOpenInstallTarget when install is clicked", () => {
    const onOpenInstallTarget = vi.fn()
    const entry = createEntry({
      status: "not_installed",
    })
    const element = createPanelElement({
      entries: [entry],
      onOpenInstallTarget,
    })

    findButtonByText(element, "安装").props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    expect(onOpenInstallTarget).toHaveBeenCalledWith(entry)
  })

  it("calls onOpenInstallTarget when update is clicked", () => {
    const onOpenInstallTarget = vi.fn()
    const entry = createEntry({
      status: "needs_update",
    })
    const element = createPanelElement({
      entries: [entry],
      onOpenInstallTarget,
    })

    findButtonByText(element, "更新").props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    expect(onOpenInstallTarget).toHaveBeenCalledWith(entry)
  })

  it("opens the target path from the location action", () => {
    const entry = createEntry({
      targetPath: "/Users/liyang/.codex/AGENTS.md",
    })
    const element = createPanelElement({
      entries: [entry],
    })

    findButtonByText(element, "打开").props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    expect(showItemInFolder).toHaveBeenCalledWith("/Users/liyang/.codex/AGENTS.md")
  })
})
