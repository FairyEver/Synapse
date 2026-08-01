/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorBulkSkillCopyDialog } from "../components/editor-bulk-skill-copy-dialog"
import type { EditorWriteTargetSelection } from "@/modules/content/components/editor-write-target-selector"
import type { EditorScanSkillCopyItem } from "../lib/editor-copy-source"

const mocks = vi.hoisted(() => ({
  copyToEditor: vi.fn(),
  resolveEditorCopyTarget: vi.fn(),
  onCopied: vi.fn(),
  promise: vi.fn(async <T,>(factory: () => Promise<T>) => factory()),
  rendererLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
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
  createRendererLogger: () => mocks.rendererLogger,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
    promise: mocks.promise,
    success: vi.fn(),
    warning: vi.fn(),
  }),
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
          targetPath: "/target/base",
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
    editorLabel: "CC/Synapse",
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
      <EditorBulkSkillCopyDialog
        items={items}
        onCopied={mocks.onCopied}
        onOpenChange={vi.fn()}
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

describe("EditorBulkSkillCopyDialog", () => {
  it("preflights selected skills and copies ready items", async () => {
    mocks.resolveEditorCopyTarget.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      message: null,
      scope: "global",
      status: "ready",
      targetExists: false,
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })
    mocks.copyToEditor.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      overwritten: false,
      scope: "global",
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })

    await renderDialog()

    await act(async () => clickButton("Codex"))
    await act(async () => clickButton("选择目标"))

    expect(document.body.textContent).toContain("可复制 1 个")
    expect(mocks.rendererLogger.info).toHaveBeenCalledWith("Bulk Skill copy preflight completed.", {
      editorId: "codex",
      overwrite: 0,
      ready: 1,
      scope: "global",
      total: 1,
      unavailable: 0,
    })

    await act(async () => clickButton("复制"))

    expect(mocks.copyToEditor).toHaveBeenCalledWith(expect.objectContaining({
      overwriteConfirmed: undefined,
      targetEditorId: "codex",
      targetScope: "global",
    }))
    expect(mocks.onCopied).toHaveBeenCalledTimes(1)
    expect(mocks.rendererLogger.info).toHaveBeenCalledWith("Bulk Skill copy started.", {
      editorId: "codex",
      executable: 1,
      overwrite: 0,
      scope: "global",
      skipped: 0,
      total: 1,
    })
    expect(mocks.rendererLogger.info).toHaveBeenCalledWith("Bulk Skill copy completed.", {
      copied: 1,
      durationMs: expect.any(Number),
      editorId: "codex",
      failed: 0,
      scope: "global",
      skipped: 0,
      total: 1,
    })
  })

  it("asks once before copying overwrite items", async () => {
    mocks.resolveEditorCopyTarget.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      message: null,
      scope: "global",
      status: "ready",
      targetExists: true,
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })
    mocks.copyToEditor.mockResolvedValue({
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      overwritten: true,
      scope: "global",
      targetKind: "directory",
      targetPath: "/target/jenkins",
    })

    await renderDialog()

    await act(async () => clickButton("Codex"))
    await act(async () => clickButton("选择目标"))

    expect(document.body.textContent).toContain("将覆盖 1 个")

    await act(async () => clickButton("复制并覆盖"))

    expect(mocks.copyToEditor).toHaveBeenCalledWith(expect.objectContaining({
      overwriteConfirmed: true,
    }))
  })
})
