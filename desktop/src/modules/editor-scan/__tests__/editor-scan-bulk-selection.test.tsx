/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorScanModule } from "../index"
import type { EditorScanResult } from "@/types/editor-scan"

const mocks = vi.hoisted(() => ({
  data: {
    global: [{
      editorId: "claude-code",
      editorLabel: "CC/Synapse",
      status: "detected",
      skills: [{
        name: "jenkins",
        path: "/Users/test/.claude/skills/jenkins",
        source: "external",
        synapseContentId: null,
        repositoryVersion: null,
        preview: "Operate Jenkins.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
      rules: [{
        name: "review",
        path: "/Users/test/.claude/rules/review.md",
        source: "external",
        synapseContentId: null,
        preview: "Review.",
        metadata: {},
        content: "Review.",
        trash: { mode: "path" },
      }],
      rulesSupported: true,
    }],
    projects: [],
  } satisfies EditorScanResult,
  refresh: vi.fn(),
}))

vi.mock("@/lib/editor-registry", () => ({
  EDITOR_ORDER: ["claude-code"],
}))

vi.mock("@/components/sidebar-content-layout", () => ({
  SidebarContentLayout: ({ children, sidebar }: { children: React.ReactNode; sidebar: React.ReactNode }) => (
    <div>
      <aside>{sidebar}</aside>
      <main>{children}</main>
    </div>
  ),
}))

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react")
  const TabsContext = React.createContext<{
    value: string
    onValueChange: (value: string) => void
  }>({
    value: "",
    onValueChange: () => undefined,
  })

  return {
    Tabs: ({
      children,
      onValueChange,
      value,
    }: {
      children: React.ReactNode
      onValueChange: (value: string) => void
      value: string
    }) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const context = React.useContext(TabsContext)
      return (
        <button
          aria-selected={context.value === value}
          role="tab"
          type="button"
          onClick={() => context.onValueChange(value)}
        >
          {children}
        </button>
      )
    },
  }
})

vi.mock("../hooks/use-editor-scan", () => ({
  useEditorScan: () => ({
    data: mocks.data,
    loading: false,
    error: null,
    refresh: mocks.refresh,
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../components/scan-item-detail-dialog", () => ({
  ScanItemDetailDialog: () => null,
}))

vi.mock("../components/editor-bulk-skill-copy-dialog", () => ({
  EditorBulkSkillCopyDialog: ({ items }: { items: Array<{ name: string }> }) => (
    <div data-bulk-copy-dialog>{items.map((item) => item.name).join(",")}</div>
  ),
}))

vi.mock("../components/editor-bulk-skill-trash-dialog", () => ({
  EditorBulkSkillTrashDialog: ({
    items,
    open,
  }: {
    items: Array<{ name: string }>
    open: boolean
  }) => open ? (
    <div data-bulk-trash-dialog>已选 {items.length} 个 Skill</div>
  ) : null,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

async function renderModule() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<EditorScanModule />)
  })
}

function clickText(text: string) {
  const target = Array.from(document.querySelectorAll<HTMLElement>("button,[role='tab'],[role='checkbox']"))
    .find((node) => node.textContent === text || node.getAttribute("aria-label") === text)
  target?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
  target?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))
  target?.click()
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("EditorScanModule bulk Skill selection", () => {
  it("shows selection actions after selecting a Skill", async () => {
    await renderModule()

    await act(async () => {
      clickText("选择 jenkins")
    })

    expect(document.body.textContent).toContain("已选 1 个")
    expect(document.body.textContent).toContain("复制到...")
    expect(document.body.textContent).toContain("移到废纸篓")
  })

  it("does not show selection checkboxes on the Rule tab", async () => {
    await renderModule()

    await act(async () => {
      clickText("Rule")
    })

    expect(document.querySelector("[role='checkbox']")).toBeNull()
    expect(document.body.textContent).not.toContain("复制到...")
  })

  it("clears selection when switching away from Skill", async () => {
    await renderModule()

    await act(async () => {
      clickText("选择 jenkins")
    })
    await act(async () => {
      clickText("Rule")
    })

    expect(document.body.textContent).not.toContain("已选 1 个")
  })

  it("opens the bulk trash dialog for selected Skills", async () => {
    await renderModule()

    await act(async () => {
      clickText("选择 jenkins")
    })
    await act(async () => {
      clickText("移到废纸篓")
    })

    expect(document.querySelector("[data-bulk-trash-dialog]")?.textContent).toContain("已选 1 个 Skill")
  })
})
