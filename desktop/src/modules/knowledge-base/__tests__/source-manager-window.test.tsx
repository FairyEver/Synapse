/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseSourceManagerWindow } from "../source-manager-window"
import type {
  SynapseKnowledgeBaseListSourcesResult,
  SynapseKnowledgeBaseUploadSourcesResult,
} from "@/types/knowledge-base"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  promise: vi.fn(async <T,>(operation: () => Promise<T>) => operation()),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => notifications,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let bridgeMocks: ReturnType<typeof createBridgeMocks>

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  notifications.error.mockClear()
  notifications.success.mockClear()
  notifications.promise.mockClear()
  notifications.promise.mockImplementation(async <T,>(operation: () => Promise<T>) => operation())
  bridgeMocks = createBridgeMocks()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: bridgeMocks,
  })
  window.history.pushState(
    null,
    "",
    "?projectId=project-1&projectName=Knowledge",
  )
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function createBridgeMocks() {
  return {
    knowledgeBase: {
      listSources: vi.fn<(projectId: string) => Promise<SynapseKnowledgeBaseListSourcesResult>>()
        .mockResolvedValue({
          projectId: "project-1",
          sources: [
            {
              relativePath: "raw/AI产品需求说明.md",
              name: "AI产品需求说明.md",
              size: 43008,
              modifiedAt: "2026-05-23T14:20:00.000Z",
              supported: true,
              status: "pending",
            },
            {
              relativePath: "raw/客户访谈纪要.docx",
              name: "客户访谈纪要.docx",
              size: 172032,
              modifiedAt: "2026-05-22T11:03:00.000Z",
              supported: true,
              status: "changed",
            },
            {
              relativePath: "raw/竞品调研.pdf",
              name: "竞品调研.pdf",
              size: 2516582,
              modifiedAt: "2026-05-22T18:11:00.000Z",
              supported: true,
              status: "imported",
            },
          ],
        }),
      uploadSources: vi.fn<(payload: { projectId: string; filePaths: string[] }) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
        .mockResolvedValue({
          projectId: "project-1",
          uploaded: [],
          skipped: [],
        }),
      addUrlSource: vi.fn<(payload: { projectId: string; url: string }) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
        .mockResolvedValue({
          projectId: "project-1",
          uploaded: [{
            originalPath: "https://example.com/article",
            relativePath: ".raw/web/2026/05/24/article.md",
            name: "article.md",
            size: 120,
            sourceKind: "url",
            sourceUrl: "https://example.com/article",
          }],
          skipped: [],
        }),
      selectAndUploadSources: vi.fn<(projectId: string) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
        .mockResolvedValue({
          projectId: "project-1",
          uploaded: [],
          skipped: [],
        }),
      filePathForDroppedFile: vi.fn<(file: File) => string | null>(() => null),
    },
    agent: {
      createSession: vi.fn(),
      send: vi.fn(),
    },
  }
}

function renderWindow() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<KnowledgeBaseSourceManagerWindow />)
  })
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function visibleRowsText(): string {
  return [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .filter((row) => !row.hidden)
    .map((row) => row.textContent ?? "")
    .join("\n")
}

describe("KnowledgeBaseSourceManagerWindow", () => {
  it("prioritizes the source list and keeps file placement actions in the side pane", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("AI产品需求说明.md")
    })

    expect(document.querySelector('[aria-label="资料列表"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="添加资料"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain("导入知识库")
    expect(document.body.textContent).not.toContain("资料管理")
    expect(document.body.textContent).toContain("放入资料")
    expect(document.body.textContent).toContain("支持 Markdown、Word、Excel、PDF、PPT、图片、网页 URL")
    expect(document.body.textContent).toContain("放入后，在知识库对话里说“汲取知识”")
    expect(document.body.textContent).toContain("新文件")
    expect(document.body.textContent).toContain("有更新")
    expect(document.body.textContent).toContain("已放入")

    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="搜索资料"]')
    expect(searchInput).not.toBeNull()

    act(() => {
      changeInput(searchInput!, "客户")
    })

    expect(visibleRowsText()).toContain("客户访谈纪要.docx")
    expect(visibleRowsText()).not.toContain("AI产品需求说明.md")

    expect(bridgeMocks.agent.createSession).not.toHaveBeenCalled()
    expect(bridgeMocks.agent.send).not.toHaveBeenCalled()
  })

  it("adds URL sources from the side pane", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("AI产品需求说明.md")
    })

    const urlInput = document.querySelector<HTMLInputElement>('input[placeholder="粘贴网页 URL"]')
    expect(urlInput).not.toBeNull()

    act(() => {
      changeInput(urlInput!, "https://example.com/article")
    })

    await act(async () => {
      buttonByLabel("添加 URL").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.addUrlSource).toHaveBeenCalledWith({
      projectId: "project-1",
      url: "https://example.com/article",
    })
    expect(bridgeMocks.knowledgeBase.listSources).toHaveBeenCalledTimes(2)
  })

  it("passes dropped image files to knowledge-base upload", async () => {
    renderWindow()
    bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/diagram.png")

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("AI产品需求说明.md")
    })

    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽放入资料"]')
    if (!dropTarget) throw new Error("Drop target not found.")

    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [new File(["image"], "diagram.png", { type: "image/png" })],
      },
    })

    await act(async () => {
      dropTarget.dispatchEvent(event)
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.uploadSources).toHaveBeenCalledWith({
        projectId: "project-1",
        filePaths: ["/tmp/diagram.png"],
      })
    })
  })
})
