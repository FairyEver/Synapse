/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorScanModule } from "../index"

const refresh = vi.fn()

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
  }: {
    readonly sidebar: ReactNode
    readonly children: ReactNode
  }) => (
    <div>
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
      <nav>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={value === tab.id}
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
  ScanItemDetailDialog: () => null,
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
    document.body.innerHTML = ""
    refresh.mockReset()
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("renders content and directory app tabs", async () => {
    await renderEditorScanModule(roots)

    expect(screenText()).toContain("内容")
    expect(screenText()).toContain("目录")
    expect(screenText()).toContain("Cursor")
    expect(screenText()).toContain("未检测到 Cursor 的 skill 或规则")
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

  it("keeps Skill and Rule filters inside the content view", async () => {
    await renderEditorScanModule(roots)

    expect(buttonByText("Skill")).not.toBeUndefined()
    expect(buttonByText("Rule")).not.toBeUndefined()
    expect(buttonByText("全局")).not.toBeUndefined()
    expect(buttonByText("项目")).not.toBeUndefined()
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
