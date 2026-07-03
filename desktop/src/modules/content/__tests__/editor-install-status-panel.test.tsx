import { renderToStaticMarkup } from "react-dom/server"
import type { ComponentProps } from "react"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { DialogContent } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { TooltipContent } from "@/components/ui/tooltip"
import {
  EditorInstallStatusDetailList,
  EditorInstallStatusPanel,
} from "@/modules/content/components/editor-install-status-panel"
import type { SynapseEditorInstallStatusEntry } from "@/types/editor-install-status"

type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuItem>

const showItemInFolder = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

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

function createDetailElement(
  props: Partial<ComponentProps<typeof EditorInstallStatusDetailList>> = {},
) {
  return EditorInstallStatusDetailList({
    entries: [],
    onOpenInstallTarget: vi.fn(),
    ...props,
  })
}

function renderDetail(
  props: Partial<ComponentProps<typeof EditorInstallStatusDetailList>> = {},
) {
  return renderToStaticMarkup(
    <EditorInstallStatusDetailList
      entries={[]}
      onOpenInstallTarget={vi.fn()}
      {...props}
    />,
  )
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

  const element = node as ReactElement<{ actions?: ReactNode; children?: ReactNode }>
  const matches = element.type === Button
    ? [element as ReactElement<ComponentProps<typeof Button>>]
    : []

  return [
    ...matches,
    ...findButtons(element.props.actions),
    ...findButtons(element.props.children),
  ]
}

function findElementsByType<TProps>(
  node: ReactNode,
  type: ReactElement<TProps>["type"],
): ReactElement<TProps>[] {
  const matches: ReactElement<TProps>[] = []

  function visit(current: ReactNode) {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }

    if (!isValidElement(current)) {
      return
    }

    const element = current as ReactElement<{ children?: ReactNode }>

    if (element.type === type) {
      matches.push(element as ReactElement<TProps>)
    }

    visit(element.props.children)
  }

  visit(node)
  return matches
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

function findMenuItemByText(
  node: ReactNode,
  text: string,
): ReactElement<DropdownMenuItemProps> {
  const items = findElementsByType<DropdownMenuItemProps>(node, DropdownMenuItem)
  const item = items.find((candidate) => textFromNode(candidate.props.children) === text)

  if (!item) {
    throw new Error(`Dropdown menu item not found: ${text}`)
  }

  return item
}

describe("EditorInstallStatusPanel", () => {
  it("renders a toolbar trigger without inline status details", () => {
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
    expect(html).not.toContain("已安装")
    expect(html).not.toContain("不支持")
    expect(html).not.toContain("Codex")
    expect(html).not.toContain("/Users/liyang/.codex/AGENTS.md")
    expect(html).not.toContain("此页面用于")
  })

  it("keeps the toolbar trigger text weight aligned with menubar actions", () => {
    const element = createPanelElement()
    const trigger = findButtonByText(element, "安装状态")

    expect(trigger.props.className).toContain("font-normal!")
  })

  it("keeps the install status dialog compact", () => {
    const element = createPanelElement()
    const [content] = findElementsByType<ComponentProps<typeof DialogContent>>(element, DialogContent)

    expect(content?.props.className).toContain("sm:max-w-[420px]")
    expect(content?.props.className).not.toContain("sm:max-w-xl")
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

    expect(html).toContain("安装状态")
    expect(html).not.toContain("刷新失败")
    expect(html).not.toContain("读取失败")
    findButtonByText(element, "重试").props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("calls onOpenInstallTarget when install is selected", () => {
    const onOpenInstallTarget = vi.fn()
    const entry = createEntry({
      status: "not_installed",
    })
    const element = createDetailElement({
      entries: [entry],
      onOpenInstallTarget,
    })

    findMenuItemByText(element, "安装").props.onSelect?.({} as Event)
    expect(onOpenInstallTarget).toHaveBeenCalledWith(entry)
  })

  it("does not offer location action for uninstalled targets", () => {
    const entry = createEntry({
      status: "not_installed",
      targetPath: "/Users/liyang/.codex/AGENTS.md",
    })
    const element = createDetailElement({
      entries: [entry],
    })

    expect(findButtons(element).map((button) => textFromNode(button.props.children))).not.toContain("打开")
    expect(textFromNode(element)).not.toContain("/Users/liyang/.codex/AGENTS.md")
  })

  it("renders editor icon tabs before install target details", () => {
    const element = createDetailElement({
      entries: [
        createEntry({
          editorId: "codex",
          editorLabel: "Codex",
          status: "installed",
        }),
        createEntry({
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "installed",
        }),
      ],
    })
    const html = renderDetail({
      entries: [
        createEntry({
          editorId: "codex",
          editorLabel: "Codex",
          status: "installed",
        }),
        createEntry({
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "installed",
        }),
      ],
    })

    expect(html).toContain('aria-label="Codex"')
    expect(html).toContain('aria-label="Cursor"')
    expect(html).toContain("mx-auto")
    expect(html).toContain("justify-center")
    expect(html).toContain("gap-0")
    expect(html).toContain("size-10")
    expect(html).toContain("size-9")
    expect(html).toContain("h-auto!")
    expect(html).toContain("overflow-visible")
    expect(html).not.toContain("overflow-x-auto")
    expect(html).toContain("data-active:bg-muted")
    expect(html.indexOf('aria-label="Codex"')).toBeLessThan(html.indexOf("全局"))
    expect(findElementsByType<ComponentProps<typeof TooltipContent>>(element, TooltipContent)
      .map((tooltip) => textFromNode(tooltip.props.children))).toEqual(["Codex", "Cursor"])
  })

  it("orders global install status before project status for the selected editor", () => {
    const html = renderDetail({
      entries: [
        createEntry({
          projectId: "project-1",
          projectName: "Work",
          scope: "project",
          status: "installed",
          targetPath: "/Users/liyang/work/.codex/AGENTS.md",
        }),
        createEntry({
          scope: "global",
          status: "installed",
          targetPath: "/Users/liyang/.codex/AGENTS.md",
        }),
      ],
    })

    expect(html.indexOf("全局")).toBeLessThan(html.indexOf("Work"))
  })

  it("uses the selected editor as the group heading and scope names as row titles", () => {
    const html = renderDetail({
      entries: [
        createEntry({
          scope: "global",
          status: "installed",
          targetPath: "/Users/liyang/.codex/AGENTS.md",
        }),
        createEntry({
          projectId: "project-1",
          projectName: "Work",
          scope: "project",
          status: "installed",
          targetPath: "/Users/liyang/work/.codex/AGENTS.md",
        }),
      ],
    })

    expect(html).toMatch(/data-install-status-editor-heading=""[^>]*>Codex<\/p>/)
    expect(html).toMatch(/data-install-status-row-title=""[^>]*>全局<\/p>/)
    expect(html).toMatch(/data-install-status-row-title=""[^>]*>Work<\/p>/)
    expect(html).not.toMatch(/data-install-status-row-title=""[^>]*>Codex<\/p>/)
  })

  it("calls onOpenInstallTarget when update is selected", () => {
    const onOpenInstallTarget = vi.fn()
    const entry = createEntry({
      status: "needs_update",
    })
    const element = createDetailElement({
      entries: [entry],
      onOpenInstallTarget,
    })

    findMenuItemByText(element, "更新").props.onSelect?.({} as Event)
    expect(onOpenInstallTarget).toHaveBeenCalledWith(entry)
  })

  it("offers reinstall for already installed targets", () => {
    const onOpenInstallTarget = vi.fn()
    const entry = createEntry({
      status: "installed",
    })
    const element = createDetailElement({
      entries: [entry],
      onOpenInstallTarget,
    })

    findMenuItemByText(element, "重新安装").props.onSelect?.({} as Event)
    expect(onOpenInstallTarget).toHaveBeenCalledWith(entry)
  })

  it("opens the target path from the clickable install path", () => {
    const entry = createEntry({
      targetPath: "/Users/liyang/.codex/AGENTS.md",
    })
    const element = createDetailElement({
      entries: [entry],
    })
    const html = renderDetail({
      entries: [entry],
    })

    expect(html).toContain("/Users/liyang/.codex/AGENTS.md")
    expect(html).not.toContain(">打开<")
    findButtonByText(element, "/Users/liyang/.codex/AGENTS.md").props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    expect(showItemInFolder).toHaveBeenCalledWith("/Users/liyang/.codex/AGENTS.md")
  })
})
