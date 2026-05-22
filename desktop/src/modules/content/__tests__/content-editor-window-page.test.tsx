/**
 * @vitest-environment jsdom
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-slot="resizable-handle" />,
  ResizablePanel: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => <div className={className}>{children}</div>,
}))

import { ContentEditorWindowLayout } from "../components/content-editor-window-layout"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const editorWindowPageSourcePath = join(__dirname, "../components/content-editor-window-page.tsx")
let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("ContentEditorWindowLayout", () => {
  it("renders metadata, body, auxiliary, and footer regions", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ContentEditorWindowLayout
          title="编辑 Rule"
          meta={<label>标题</label>}
          body={<label>正文</label>}
          auxiliary={<label>预览</label>}
          actions={<button type="button">保存</button>}
        />,
      )
    })

    expect(document.querySelector("h1")?.textContent).toBe("编辑 Rule")
    expect(document.body.textContent).toContain("标题")
    expect(document.body.textContent).toContain("正文")
    expect(document.body.textContent).toContain("预览")
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "保存")).toBe(true)
    expect(document.querySelector("footer")).toBeNull()
    expect(document.querySelectorAll('[data-slot="resizable-handle"]')).toHaveLength(2)
  })
})

describe("ContentEditorWindowPage", () => {
  it("keeps edit windows open on conflict and opens detail after saved edit", async () => {
    const source = await readFile(editorWindowPageSourcePath, "utf8")

    expect(source).toContain('result.status === "conflict"')
    expect(source).toContain("openContentDetailWindow")
    expect(source).toContain("window.close()")
  })

  it("serializes Skill files before saving", async () => {
    const source = await readFile(editorWindowPageSourcePath, "utf8")

    expect(source).toContain("serializeCreateSkillFiles")
  })

  it("supports editing text Skill attachments from the editor body", async () => {
    const source = await readFile(editorWindowPageSourcePath, "utf8")

    expect(source).toContain("readAttachmentFile")
    expect(source).toContain("activeSkillDocument")
    expect(source).toContain("updateSkillAttachmentText")
    expect(source).toContain("不能编辑此文件")
  })

  it("uses the shared Skill file tree for the editor attachment panel", async () => {
    const fieldsSource = await readFile(join(__dirname, "../components/content-editor-fields.tsx"), "utf8")

    expect(fieldsSource).toContain("SkillFileTree")
    expect(fieldsSource).toContain("onRemovePath")
    expect(fieldsSource).not.toContain("拖入文件")
    expect(fieldsSource).not.toContain("已选 {files.length} 个附件")
  })

  it("renders Rule and Prompt editor previews without an extra frame", async () => {
    const source = await readFile(editorWindowPageSourcePath, "utf8")

    expect(source.match(/<ContentPreviewPanel content=\{formState\.form\.content\} framed=\{false\} \/>/g)).toHaveLength(2)
  })

  it("keeps editor previews full-height and scrollable", async () => {
    const source = await readFile(join(__dirname, "../components/content-editor-fields.tsx"), "utf8")

    expect(source).toContain("flex h-full min-h-0 flex-col gap-3")
    expect(source).toContain('ScrollArea className="h-full min-h-0"')
  })

  it("reads create and edit prefill data from the pending editor payload store", async () => {
    const source = await readFile(editorWindowPageSourcePath, "utf8")

    expect(source).toContain("readContentEditorInitPayload")
    expect(source).toContain("initPayload.initialValue")
    expect(source).toContain("initPayload.prefill")
  })
})
