/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorBulkSkillTrashDialog } from "../components/editor-bulk-skill-trash-dialog"
import type { EditorScanSkillCopyItem } from "../lib/editor-copy-source"

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  onOpenChange: vi.fn(),
  onTrashed: vi.fn(),
  success: vi.fn(),
  trashItem: vi.fn(),
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
    editorScan: {
      trashItem: mocks.trashItem,
    },
  }),
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function createItem(name: string): EditorScanSkillCopyItem {
  return {
    key: `global:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "Claude Code",
    scope: "global",
    trash: { mode: "path" },
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

  it("trashes selected skills sequentially and closes after full success", async () => {
    mocks.trashItem.mockResolvedValue({ trashed: true, mode: "path", path: "/source/jenkins" })

    await renderDialog([createItem("jenkins"), createItem("release")])

    await act(async () => clickButton("移到废纸篓"))

    expect(mocks.trashItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
      itemName: "jenkins",
      itemPath: "/source/jenkins",
      itemType: "skill",
      trash: { mode: "path" },
    }))
    expect(mocks.trashItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
      itemName: "release",
      itemPath: "/source/release",
      itemType: "skill",
      trash: { mode: "path" },
    }))
    expect(mocks.onTrashed).toHaveBeenCalledWith(["global:/source/jenkins", "global:/source/release"])
    expect(mocks.success).toHaveBeenCalledWith("已移到废纸篓 2 个 Skill")
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("keeps failed items visible after partial success", async () => {
    mocks.trashItem
      .mockResolvedValueOnce({ trashed: true, mode: "path", path: "/source/jenkins" })
      .mockRejectedValueOnce(new Error("没有写入该位置的权限。"))

    await renderDialog([createItem("jenkins"), createItem("release")])

    await act(async () => clickButton("移到废纸篓"))

    expect(mocks.onTrashed).toHaveBeenCalledWith(["global:/source/jenkins"])
    expect(mocks.warning).toHaveBeenCalledWith("已移到废纸篓 1/2 个 Skill")
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("release")
    expect(document.body.textContent).toContain("没有写入该位置的权限。")
  })
})
