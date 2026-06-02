/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { EditorWriteTargetSelection } from "@/modules/content/components/editor-write-target-selector"
import { ContentInstallDialog, detectInstallPlaceholders } from "@/modules/content/components/content-install-dialog"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

const mocks = vi.hoisted(() => ({
  installToEditor: vi.fn(),
  readContent: vi.fn(),
  resolveEditorInstallTarget: vi.fn(),
  targetStatus: "conflict" as "conflict" | "ready",
  updateRepository: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("@/app-shell/content", () => ({
  installToEditor: mocks.installToEditor,
  readContent: mocks.readContent,
  resolveEditorInstallTarget: mocks.resolveEditorInstallTarget,
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
    promise: async <T,>(factory: () => Promise<T>) => factory(),
    warning: mocks.warning,
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => null,
  useRepositoryActions: () => ({
    updateRepository: mocks.updateRepository,
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

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/modules/content/components/editor-write-target-selector", () => ({
  EditorWriteTargetSelector: ({
    onSelectionChange,
  }: {
    onSelectionChange: (selection: EditorWriteTargetSelection) => void
  }) => (
    <button
      type="button"
      onClick={() => {
        const baseTarget = {
          contentType: "skill" as const,
          editorId: "codex" as SynapseEditorAdapterSummary["id"],
          label: "Codex",
          message: null,
          scope: "global" as const,
          targetKind: "directory" as const,
          targetPath: "/tmp/codex/skills/demo",
        }
        const activeTarget: EditorWriteTargetSelection["activeTarget"] = mocks.targetStatus === "ready"
          ? {
              ...baseTarget,
              status: "ready",
              targetExists: true,
            }
          : {
              ...baseTarget,
              status: "conflict",
              conflictContentId: "installed-skill",
            }

        onSelectionChange({
          activeTarget,
          activeTargetState: {
            error: null,
            isLoading: false,
            value: activeTarget,
          },
          projectPath: "",
          scope: "global",
        })
      }}
    >
      选择冲突目标
    </button>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function createSkillItem(): SynapseContentMeta<"skill"> {
  return {
    attachmentCount: 0,
    category: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user",
    createdByDisplayName: "User",
    deleted: false,
    description: "",
    icon: "",
    iconBg: "",
    id: "skill-1",
    latestHistoryDirname: "current",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    name: "demo",
    title: "Demo",
    type: "skill",
  }
}

const editor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: false,
  supportedContentTypes: ["skill"],
}

function clickButton(text: string, index = 0) {
  const matches = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => button.textContent === text)
  matches[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

async function renderInstallDialog(onOpenChange = vi.fn()) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <ContentInstallDialog
        editor={editor}
        item={createSkillItem()}
        onOpenChange={onOpenChange}
        open
        projects={[]}
      />,
    )
  })

  return { onOpenChange }
}

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
  mocks.targetStatus = "conflict"
})

describe("detectInstallPlaceholders", () => {
  it("reads current content when preload is unavailable before placeholder detection", async () => {
    const readCurrentContent = vi.fn().mockResolvedValue("Hello ${{ token }}")

    await expect(detectInstallPlaceholders(null, readCurrentContent)).resolves.toEqual(["token"])
    expect(readCurrentContent).toHaveBeenCalledTimes(1)
  })
})

describe("ContentInstallDialog", () => {
  it("asks for variables inside code blocks before overwriting an existing Skill directory", async () => {
    mocks.targetStatus = "ready"
    mocks.readContent.mockResolvedValue({ content: "```text\nGITEE_TOKEN=${{ GITEE_TOKEN }}\n```" })

    await renderInstallDialog()

    await act(async () => {
      clickButton("选择冲突目标")
    })
    await act(async () => {
      clickButton("安装")
    })

    expect(document.body.textContent).toContain("变量替换")
    expect(document.body.textContent).toContain("${{ GITEE_TOKEN }}")
    expect(document.body.textContent).not.toContain("确认覆盖目标目录？")
    expect(mocks.installToEditor).not.toHaveBeenCalled()
  })

  it("asks for variables again after cancelling a Skill replacement", async () => {
    mocks.readContent.mockResolvedValue({ content: "Hello ${{ token }}" })

    await renderInstallDialog()

    await act(async () => {
      clickButton("选择冲突目标")
    })
    await act(async () => {
      clickButton("安装")
    })

    expect(document.body.textContent).toContain("变量替换")

    await act(async () => {
      clickButton("继续安装")
    })

    expect(document.body.textContent).toContain("确认替换 Skill？")

    await act(async () => {
      clickButton("取消")
    })

    await act(async () => {
      clickButton("安装")
    })

    expect(document.body.textContent).toContain("变量替换")
    expect(mocks.installToEditor).not.toHaveBeenCalled()
  })

  it("passes the replaced Skill content id after confirming a conflict replacement", async () => {
    mocks.readContent.mockResolvedValue({ content: "plain content" })
    mocks.installToEditor.mockResolvedValue({ targetPath: "/tmp/codex/skills/demo" })

    await renderInstallDialog()

    await act(async () => {
      clickButton("选择冲突目标")
    })
    await act(async () => {
      clickButton("安装")
    })
    await act(async () => {
      clickButton("替换")
    })

    expect(mocks.installToEditor).toHaveBeenCalledWith(expect.objectContaining({
      contentId: "skill-1",
      replaceConfirmed: true,
      replacedContentId: "installed-skill",
    }))
  })

  it("keeps the footer cancel action disabled while installation is running", async () => {
    mocks.targetStatus = "ready"
    mocks.readContent.mockResolvedValue({ content: "plain content" })
    let finishInstall: (() => void) | undefined
    mocks.installToEditor.mockReturnValue(new Promise((resolve) => {
      finishInstall = () => resolve({ targetPath: "/tmp/codex/skills/demo" })
    }))
    const onOpenChange = vi.fn()

    await renderInstallDialog(onOpenChange)

    await act(async () => {
      clickButton("选择冲突目标")
    })
    await act(async () => {
      clickButton("安装")
    })
    expect(document.body.textContent).toContain("确认覆盖目标目录？")

    await act(async () => {
      clickButton("继续安装")
      await Promise.resolve()
    })

    const cancelButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "取消")
    expect(cancelButton?.disabled).toBe(true)

    await act(async () => {
      cancelButton?.click()
    })

    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      finishInstall?.()
      await Promise.resolve()
    })
  })
})
