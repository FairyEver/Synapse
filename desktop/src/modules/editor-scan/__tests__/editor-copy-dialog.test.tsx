/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorCopyDialog } from "../components/editor-copy-dialog"
import type { EditorWriteTargetSelection } from "@/modules/content/components/editor-write-target-selector"
import type { ScanItemForDetail } from "@/types/editor-scan"

const mocks = vi.hoisted(() => ({
  copyToEditor: vi.fn(),
  onCopied: vi.fn(),
  onOpenChange: vi.fn(),
  promise: vi.fn(async <T,>(factory: () => Promise<T>) => factory()),
  resolveEditorCopyTarget: vi.fn(),
}))

vi.mock("@/app-shell/editor-copy", () => ({
  copyToEditor: mocks.copyToEditor,
  resolveEditorCopyTarget: mocks.resolveEditorCopyTarget,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: { global: { projects: [] } },
  }),
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
    error: vi.fn(),
    promise: mocks.promise,
    success: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock("@/components/editor-icon", () => ({
  EditorIcon: () => <span aria-hidden="true" />,
}))

vi.mock("@/definitions/generated/renderer-registry", () => ({
  installFormDefinitionByEditorId: new Map(),
}))

vi.mock("@/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    error: null,
    filteredAdapters: [{
      id: "codex",
      label: "Codex",
      order: 1,
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["skill"],
    }],
    isLoading: false,
    load: vi.fn(),
  }),
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
        const activeTarget: EditorWriteTargetSelection["activeTarget"] = {
          contentType: "skill",
          editorId: "codex",
          label: "Codex",
          message: null,
          scope: "global",
          status: "ready",
          targetExists: false,
          targetKind: "directory",
          targetPath: "/target/skill",
        }
        onSelectionChange({
          activeTarget,
          activeTargetState: { error: null, isLoading: false, value: activeTarget },
          projectPath: "",
          scope: "global",
        })
      }}
    >
      选择目标
    </button>
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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

const item: ScanItemForDetail = {
  type: "skill",
  name: "jenkins",
  path: "/source/jenkins",
  source: "external",
  preview: "# Jenkins",
  fileCount: 1,
  synapseContentId: null,
  editorId: "claude-code",
  editorLabel: "CC/Synapse",
  scope: "global",
  trash: { mode: "path" },
}

async function renderDialog() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <EditorCopyDialog
        content="# Jenkins"
        item={item}
        onCopied={mocks.onCopied}
        onOpenChange={mocks.onOpenChange}
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

describe("EditorCopyDialog", () => {
  it("refreshes the scan list after a successful copy", async () => {
    mocks.copyToEditor.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      overwritten: false,
      scope: "global",
      targetKind: "directory",
      targetPath: "/target/skill",
    })

    await renderDialog()

    await act(async () => clickButton("Codex"))
    await act(async () => clickButton("选择目标"))
    await act(async () => clickButton("复制"))

    expect(mocks.copyToEditor).toHaveBeenCalledTimes(1)
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.onCopied).toHaveBeenCalledTimes(1)
  })

  it("does not refresh the scan list when copy fails", async () => {
    mocks.copyToEditor.mockRejectedValue(new Error("复制失败：磁盘拒绝"))

    await renderDialog()

    await act(async () => clickButton("Codex"))
    await act(async () => clickButton("选择目标"))
    await act(async () => clickButton("复制"))

    expect(mocks.copyToEditor).toHaveBeenCalledTimes(1)
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false)
    expect(mocks.onCopied).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("复制失败：磁盘拒绝")
  })
})
