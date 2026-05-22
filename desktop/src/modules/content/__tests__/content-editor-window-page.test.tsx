/**
 * @vitest-environment jsdom
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
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
          footer={<button type="button">保存</button>}
        />,
      )
    })

    expect(document.querySelector("h1")?.textContent).toBe("编辑 Rule")
    expect(document.body.textContent).toContain("标题")
    expect(document.body.textContent).toContain("正文")
    expect(document.body.textContent).toContain("预览")
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "保存")).toBe(true)
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

  it("reads create and edit prefill data from the pending editor payload store", async () => {
    const source = await readFile(editorWindowPageSourcePath, "utf8")

    expect(source).toContain("readContentEditorInitPayload")
    expect(source).toContain("initPayload.initialValue")
    expect(source).toContain("initPayload.prefill")
  })
})
