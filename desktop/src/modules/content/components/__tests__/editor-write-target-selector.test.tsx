/**
 * @vitest-environment jsdom
 */
import {
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary, SynapseEditorResolvedTarget } from "@/types/editor"
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
} from "../editor-write-target-selector"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <button type="button" disabled={disabled}>{children}</button>
  ),
}))

const editor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: false,
  supportedContentTypes: ["skill"],
}

const resolvedTarget: SynapseEditorResolvedTarget = {
  contentType: "skill",
  editorId: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  message: null,
  scope: "global",
  status: "ready",
  targetExists: false,
  targetKind: "directory",
  targetPath: "/tmp/skills/demo",
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("EditorWriteTargetSelector", () => {
  it("does not loop when a parent stores selection with an inline callback", async () => {
    const resolveTarget = vi.fn(async () => resolvedTarget)
    const onSelectionObserved = vi.fn()
    const projects: SynapseProjectConfig[] = []

    function Harness() {
      const [, setSelection] = useState<EditorWriteTargetSelection | null>(null)

      return (
        <EditorWriteTargetSelector
          actionKind="install"
          contentType="skill"
          editor={editor}
          loggerName="test.editor-target"
          onSelectionChange={(nextSelection) => {
            onSelectionObserved(nextSelection)
            setSelection(nextSelection)
          }}
          open
          projects={projects}
          resolveTarget={resolveTarget}
        />
      )
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Harness />)
      await Promise.resolve()
    })

    expect(onSelectionObserved).toHaveBeenCalled()
    expect(onSelectionObserved.mock.calls.length).toBeLessThanOrEqual(3)
    expect(resolveTarget).toHaveBeenCalledTimes(1)
  })
})
