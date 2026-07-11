/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorScanModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
const mocks = vi.hoisted(() => ({
  openSkillUninstaller: vi.fn(),
}))

vi.mock("../../../../app-capabilities/skill-uninstaller/renderer", () => ({
  useSkillUninstallerDialog: () => ({
    dialog: <div data-skill-uninstaller-dialog />,
    openSkillUninstaller: mocks.openSkillUninstaller,
  }),
}))

vi.mock("../hooks/use-editor-scan", () => ({
  useEditorScan: () => ({
    data: {
      global: [
        {
          editorId: "cursor",
          editorLabel: "Cursor",
          status: "detected",
          rulesSupported: false,
          rules: [],
          skills: [],
          duplicateSkillNames: [],
        },
      ],
      projects: [],
    },
    loading: false,
    error: null,
    refresh,
  }),
}))

vi.mock("../hooks/use-editor-directories", () => ({
  useEditorDirectories: () => ({
    directories: [
      {
        editorId: "cursor",
        label: "Cursor",
        rulesPath: null,
        rulesExists: false,
        skillsPath: "/Users/liyang/.cursor/skills",
        skillsExists: true,
      },
    ],
    isLoading: false,
    error: null,
    handleOpen: vi.fn(),
    handleCreate: vi.fn(),
    reload: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn(),
  }),
}))

vi.mock("@/components/sidebar-content-layout", () => ({
  SidebarContentLayout: ({
    sidebar,
    children,
    sidebarResizable,
    sidebarDefaultSize,
    sidebarMinSize,
  }: {
    readonly sidebar: ReactNode
    readonly children: ReactNode
    readonly sidebarResizable?: boolean
    readonly sidebarDefaultSize?: number
    readonly sidebarMinSize?: number
  }) => (
    <div
      data-sidebar-resizable={sidebarResizable ? "true" : "false"}
      data-sidebar-default-size={sidebarDefaultSize}
      data-sidebar-min-size={sidebarMinSize}
    >
      <aside>{sidebar}</aside>
      <main>{children}</main>
    </div>
  ),
}))

vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({
    tabs,
    value,
    onValueChange,
    actions,
    children,
  }: {
    readonly tabs: readonly { readonly id: string; readonly label: string }[]
    readonly value: string
    readonly onValueChange: (value: string) => void
    readonly actions?: ReactNode
    readonly children: ReactNode
  }) => (
    <div>
      <nav aria-label="应用页面">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={value === tab.id}
            data-app-tab={tab.id}
            onClick={() => onValueChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {actions}
      </nav>
      {children}
    </div>
  ),
}))

vi.mock("../components/scan-item-detail-dialog", () => ({
  ScanItemDetailDialog: ({
    onRequestSkillUninstall,
  }: {
    readonly onRequestSkillUninstall?: (item: {
      readonly type: "skill"
      readonly name: string
      readonly path: string
      readonly source: "external"
      readonly preview: string
      readonly editorId: "cursor"
      readonly editorLabel: string
      readonly scope: "global" | "project"
      readonly projectPath?: string
      readonly trash: { readonly mode: "path" }
    }) => void
  }) => (
    <>
      <button
        type="button"
        onClick={() => onRequestSkillUninstall?.({
          type: "skill",
          name: "jenkins",
          path: "/repo/.cursor/skills/jenkins",
          source: "external",
          preview: "",
          editorId: "cursor",
          editorLabel: "Cursor",
          scope: "project",
          projectPath: "/repo",
          trash: { mode: "path" },
        })}
      >
        卸载甲
      </button>
      <button
        type="button"
        onClick={() => onRequestSkillUninstall?.({
          type: "skill",
          name: "jenkins",
          path: "/Users/liyang/.cursor/skills/jenkins",
          source: "external",
          preview: "",
          editorId: "cursor",
          editorLabel: "Cursor",
          scope: "global",
          trash: { mode: "path" },
        })}
      >
        卸载乙
      </button>
    </>
  ),
}))

vi.mock("../components/editor-bulk-skill-copy-dialog", () => ({
  EditorBulkSkillCopyDialog: () => null,
}))

vi.mock("../components/editor-bulk-skill-trash-dialog", () => ({
  EditorBulkSkillTrashDialog: () => null,
}))

describe("EditorScanModule", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ""
    refresh.mockReset()
    mocks.openSkillUninstaller.mockReset()
  })

  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount()
      }
    })
    vi.useRealTimers()
  })

  it("renders content and directory app tabs", async () => {
    await renderEditorScanModule(roots)

    expect(screenText()).toContain("内容")
    expect(screenText()).toContain("目录")
    expect(screenText()).toContain("Cursor")
    expect(screenText()).toContain("未检测到 Cursor 的 skill 或规则")
  })

  it("uses the same resizable sidebar layout as agent surfaces", async () => {
    await renderEditorScanModule(roots)

    expect(document.querySelector("[data-sidebar-resizable]")?.getAttribute("data-sidebar-resizable"))
      .toBe("true")
  })

  it("sets the IDE management sidebar default and minimum width to 250px", async () => {
    await renderEditorScanModule(roots)

    const layout = document.querySelector("[data-sidebar-resizable]")

    expect(layout?.getAttribute("data-sidebar-default-size")).toBe("250")
    expect(layout?.getAttribute("data-sidebar-min-size")).toBe("250")

    await act(async () => {
      buttonByText("目录")?.click()
      await Promise.resolve()
    })

    expect(layout?.getAttribute("data-sidebar-default-size")).toBe("250")
    expect(layout?.getAttribute("data-sidebar-min-size")).toBe("250")
  })

  it("does not render duplicate editor headings in the sidebar or content panel", async () => {
    await renderEditorScanModule(roots)

    const contentPanel = document.querySelector("[data-editor-scan-content-panel]")

    expect(document.querySelector("[data-editor-scan-sidebar-heading]")).toBeNull()
    expect(contentPanel?.querySelector("h2")).toBeNull()
  })

  it("switches to the selected IDE directory view", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      buttonByText("目录")?.click()
      await Promise.resolve()
    })

    expect(screenText()).toContain("全局规则")
    expect(screenText()).toContain("不支持")
    expect(screenText()).toContain("/Users/liyang/.cursor/skills")
  })

  it("keeps content controls inside the content sidebar", async () => {
    await renderEditorScanModule(roots)

    const contentSidebarControls = document.querySelector("[data-editor-scan-sidebar-controls]")
    const contentPanel = document.querySelector("[data-editor-scan-content-panel]")

    expect(contentPanel?.textContent).toContain("Cursor")
    expect(contentPanel?.textContent).not.toContain("类型")
    expect(contentPanel?.textContent).not.toContain("范围")
    expect(contentSidebarControls?.textContent).toContain("类型")
    expect(contentSidebarControls?.textContent).toContain("Skill")
    expect(contentSidebarControls?.textContent).toContain("Rule")
    expect(contentSidebarControls?.textContent).toContain("范围")
    expect(contentSidebarControls?.textContent).toContain("全局")
    expect(contentSidebarControls?.textContent).toContain("项目")
  })

  it("hides content filters in the directory view", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      buttonByText("目录")?.click()
      await Promise.resolve()
    })

    expect(buttonByText("Skill")).toBeUndefined()
    expect(buttonByText("Rule")).toBeUndefined()
    expect(buttonByText("全局")).toBeUndefined()
    expect(buttonByText("项目")).toBeUndefined()
  })

  it("keeps directory view focused on the selected IDE", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      buttonByText("目录")?.click()
      await Promise.resolve()
    })

    const contentPanel = document.querySelector("[data-editor-scan-content-panel]")

    expect(contentPanel?.textContent).toContain("全局规则")
    expect(contentPanel?.textContent).not.toContain("Skill")
    expect(contentPanel?.textContent).not.toContain("Rule")
    expect(contentPanel?.querySelector("h2")).toBeNull()
  })

  it("opens the skill uninstaller with the project scope", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      buttonByText("卸载甲")?.click()
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(mocks.openSkillUninstaller).toHaveBeenCalledWith(expect.objectContaining({
      initialName: "jenkins",
      initialSearchRootPath: "/repo",
    }))
  })

  it("opens the skill uninstaller without a search root for global scope", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      buttonByText("卸载乙")?.click()
      await vi.advanceTimersByTimeAsync(300)
    })

    const options = mocks.openSkillUninstaller.mock.calls[0]?.[0]
    expect(options).toEqual(expect.objectContaining({ initialName: "jenkins" }))
    expect(options).not.toHaveProperty("initialSearchRootPath")
  })

  it("refreshes the IDE scan after skill uninstall completes", async () => {
    await renderEditorScanModule(roots)

    await act(async () => {
      buttonByText("卸载甲")?.click()
      await vi.advanceTimersByTimeAsync(300)
    })

    const options = mocks.openSkillUninstaller.mock.calls[0]?.[0]
    await options.onCompleted()

    expect(refresh).toHaveBeenCalledOnce()
  })
})

async function renderEditorScanModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<EditorScanModule />)
    await Promise.resolve()
  })
}

function screenText(): string {
  return document.body.textContent ?? ""
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(label))
}
