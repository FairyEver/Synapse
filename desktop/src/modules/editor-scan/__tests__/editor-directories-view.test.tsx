/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditorDirectoriesView } from "../components/editor-directories-view"

const mocks = vi.hoisted(() => ({
  handleOpen: vi.fn(),
  handleCreate: vi.fn(),
  reload: vi.fn(),
  state: {
    directories: [
      {
        editorId: "cursor",
        label: "Cursor",
        rulesPath: null,
        rulesExists: false,
        skillsPath: "/Users/liyang/.cursor/skills",
        skillsExists: true,
      },
      {
        editorId: "codex",
        label: "Codex",
        rulesPath: "/Users/liyang/.codex",
        rulesExists: true,
        skillsPath: "/Users/liyang/.agents/skills",
        skillsExists: false,
      },
    ],
    isLoading: false,
    error: null as string | null,
  },
}))

vi.mock("../hooks/use-editor-directories", () => ({
  useEditorDirectories: () => ({
    ...mocks.state,
    handleOpen: mocks.handleOpen,
    handleCreate: mocks.handleCreate,
    reload: mocks.reload,
  }),
}))

describe("EditorDirectoriesView", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
    mocks.handleOpen.mockReset()
    mocks.handleCreate.mockReset()
    mocks.reload.mockReset()
    mocks.state.isLoading = false
    mocks.state.error = null
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("shows only the selected IDE directories", async () => {
    await renderDirectoryView(roots, "codex")

    expect(screenText()).toContain("/Users/liyang/.codex")
    expect(screenText()).toContain("/Users/liyang/.agents/skills")
    expect(screenText()).not.toContain("/Users/liyang/.cursor/skills")
  })

  it("does not render a repeated selected IDE heading", async () => {
    await renderDirectoryView(roots, "codex")

    expect(document.querySelector("h2")).toBeNull()
    expect(screenText()).not.toContain("Codex")
  })

  it("opens existing directories", async () => {
    await renderDirectoryView(roots, "codex")

    await act(async () => {
      buttonByText("打开")?.click()
      await Promise.resolve()
    })

    expect(mocks.handleOpen).toHaveBeenCalledWith("/Users/liyang/.codex")
  })

  it("creates missing directories", async () => {
    await renderDirectoryView(roots, "codex")

    await act(async () => {
      buttonByText("创建并打开")?.click()
      await Promise.resolve()
    })

    expect(mocks.handleCreate).toHaveBeenCalledWith("/Users/liyang/.agents/skills")
  })

  it("shows unsupported rows without actions", async () => {
    await renderDirectoryView(roots, "cursor")

    expect(screenText()).toContain("全局规则")
    expect(screenText()).toContain("不支持")
    expect(document.body.textContent?.match(/打开/g)?.length ?? 0).toBe(1)
  })

  it("shows a retry action on load errors", async () => {
    mocks.state.error = "加载编辑器目录失败"
    await renderDirectoryView(roots, "cursor")

    expect(screenText()).toContain("加载编辑器目录失败")
    await act(async () => {
      buttonByText("重试")?.click()
      await Promise.resolve()
    })
    expect(mocks.reload).toHaveBeenCalled()
  })
})

async function renderDirectoryView(roots: Root[], selectedEditorId: "cursor" | "codex"): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<EditorDirectoriesView selectedEditorId={selectedEditorId} />)
    await Promise.resolve()
  })
}

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(label))
}

function screenText(): string {
  return document.body.textContent ?? ""
}
