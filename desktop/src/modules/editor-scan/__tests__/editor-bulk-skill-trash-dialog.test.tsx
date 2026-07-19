/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorBulkSkillTrashDialog } from "../components/editor-bulk-skill-trash-dialog"
import type { EditorScanSkillCopyItem } from "../lib/editor-copy-source"

const mocks = vi.hoisted(() => ({
  cancelUninstall: vi.fn(),
  error: vi.fn(),
  onOpenChange: vi.fn(),
  onTrashed: vi.fn(),
  success: vi.fn(),
  uninstall: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.error,
    success: mocks.success,
    warning: mocks.warning,
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    skillUninstaller: {
      cancelUninstall: mocks.cancelUninstall,
      uninstall: mocks.uninstall,
    },
  }),
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function createItem(
  name: string,
  overrides: Partial<EditorScanSkillCopyItem> = {},
): EditorScanSkillCopyItem {
  return {
    key: `global:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "ClaudeCode/Synapse",
    scope: "global",
    trash: { mode: "path" },
    ...overrides,
  }
}

async function renderDialog(items = [createItem("jenkins")]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EditorBulkSkillTrashDialog
        items={items}
        onOpenChange={mocks.onOpenChange}
        onTrashed={mocks.onTrashed}
        open
      />,
    )
  })
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((node) => node.textContent === text)
  button?.click()
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("EditorBulkSkillTrashDialog", () => {
  it("asks for confirmation with the selected Skill count", async () => {
    await renderDialog([createItem("jenkins"), createItem("release")])

    expect(document.body.textContent).toContain("移到废纸篓？")
    expect(document.body.textContent).toContain("已选 2 个 Skill")
    expect(document.body.textContent).toContain("可从系统废纸篓恢复。")
  })

  it("uninstalls selected skills in one batch and closes after full success", async () => {
    mocks.uninstall.mockResolvedValue({
      results: [
        { path: "/source/jenkins", status: "trashed" },
        { path: "/source/release", status: "trashed" },
      ],
    })

    await renderDialog([
      createItem("jenkins"),
      createItem("release", {
        key: "project:/source/release",
        projectPath: "/projects/demo",
        scope: "project",
      }),
    ])

    await act(async () => clickButton("移到废纸篓"))

    expect(mocks.uninstall).toHaveBeenCalledTimes(1)
    expect(mocks.uninstall).toHaveBeenCalledWith({
      operationId: expect.any(String),
      targets: [
        { query: { name: "jenkins" }, path: "/source/jenkins" },
        {
          query: { name: "release", searchRootPath: "/projects/demo" },
          path: "/source/release",
        },
      ],
    })
    expect(mocks.onTrashed).toHaveBeenCalledWith(["global:/source/jenkins", "project:/source/release"])
    expect(mocks.success).toHaveBeenCalledWith("已移到废纸篓 2 个 Skill")
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("retries only failed items after partial success", async () => {
    mocks.uninstall
      .mockResolvedValueOnce({
        results: [
          { path: "/source/jenkins", status: "trashed" },
          { path: "/source/release", status: "skipped", error: "没有写入该位置的权限。" },
        ],
      })
      .mockResolvedValueOnce({
        results: [{ path: "/source/release", status: "trashed" }],
      })

    await renderDialog([createItem("jenkins"), createItem("release")])

    await act(async () => clickButton("移到废纸篓"))

    expect(mocks.onTrashed).toHaveBeenCalledWith(["global:/source/jenkins"])
    expect(mocks.warning).toHaveBeenCalledWith("已移到废纸篓 1/2 个 Skill")
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("release")
    expect(document.body.textContent).toContain("没有写入该位置的权限。")
    expect(document.body.textContent).toContain("重试未处理项")

    await act(async () => clickButton("重试未处理项"))

    expect(mocks.uninstall).toHaveBeenCalledTimes(2)
    expect(mocks.uninstall).toHaveBeenNthCalledWith(2, {
      operationId: expect.any(String),
      targets: [{ query: { name: "release" }, path: "/source/release" }],
    })
    expect(mocks.onTrashed).toHaveBeenNthCalledWith(2, ["global:/source/release"])
    expect(mocks.success).toHaveBeenCalledWith("已移到废纸篓 1 个 Skill")
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the uninstall warning when every Skill was moved to trash", async () => {
    mocks.uninstall.mockResolvedValue({
      results: [{
        path: "/source/jenkins",
        status: "trashed",
        warning: "已移到废纸篓，安装状态刷新失败。",
      }],
    })

    await renderDialog()
    await act(async () => clickButton("移到废纸篓"))

    expect(mocks.warning).toHaveBeenCalledWith("已移到废纸篓，安装状态刷新失败。")
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows a failure when the batch service omits an item result", async () => {
    mocks.uninstall.mockResolvedValue({
      results: [{ path: "/source/jenkins", status: "trashed" }],
    })

    await renderDialog([createItem("jenkins"), createItem("release")])

    await act(async () => clickButton("移到废纸篓"))

    expect(mocks.onTrashed).toHaveBeenCalledWith(["global:/source/jenkins"])
    expect(document.body.textContent).toContain("release：未返回卸载结果。")
  })

  it("stops an active batch and keeps unprocessed items available for retry", async () => {
    let resolveUninstall!: (result: {
      results: Array<{ path: string; status: "trashed" }>
      cancelled: true
    }) => void
    mocks.uninstall.mockImplementation(() => new Promise((resolve) => {
      resolveUninstall = resolve
    }))
    mocks.cancelUninstall.mockImplementation(async () => {
      resolveUninstall({
        results: [{ path: "/source/jenkins", status: "trashed" }],
        cancelled: true,
      })
      return { cancelled: true }
    })

    await renderDialog([createItem("jenkins"), createItem("release")])
    await act(async () => clickButton("移到废纸篓"))
    expect(document.body.textContent).toContain("已处理 0/2 个 Skill")
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain("已处理 0/2 个 Skill")
    await act(async () => clickButton("停止处理"))

    expect(mocks.cancelUninstall).toHaveBeenCalledWith({
      operationId: mocks.uninstall.mock.calls[0]?.[0].operationId,
    })
    expect(document.body.textContent).toContain("release：已停止，未处理。")
    expect(document.body.textContent).toContain("重试未处理项")
    expect(mocks.warning).toHaveBeenCalledWith("已停止，已移到废纸篓 1/2 个 Skill")
  })
})
