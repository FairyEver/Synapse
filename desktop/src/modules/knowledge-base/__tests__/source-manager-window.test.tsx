/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseSourceManagerWindow } from "../source-manager-window"
import type {
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseRawMutationResult,
} from "@/types/knowledge-base"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  promise: vi.fn(async <T,>(operation: () => Promise<T>, _options?: unknown) => operation()),
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
  notifications.warning.mockClear()
  notifications.promise.mockClear()
  notifications.promise.mockImplementation(async <T,>(operation: () => Promise<T>, _options?: unknown) => operation())
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
  const emptyMutation: SynapseKnowledgeBaseRawMutationResult = {
    projectId: "project-1",
    entries: [],
    skipped: [],
  }
  return {
    knowledgeBase: {
      listRawDirectory: vi.fn<(payload: { projectId: string; directoryPath: string }) => Promise<SynapseKnowledgeBaseListRawDirectoryResult>>()
        .mockImplementation(async ({ directoryPath }) => ({
          projectId: "project-1",
          directoryPath,
          entries: directoryPath === "客户"
            ? [{
              relativePath: "客户/访谈.md",
              name: "访谈.md",
              kind: "file",
              size: 24,
              modifiedAt: "2026-05-23T14:20:00.000Z",
            }]
            : directoryPath === "2026"
              ? [{
                relativePath: "2026/05",
                name: "05",
                kind: "directory",
                size: null,
                modifiedAt: "2026-05-24T16:05:00.000Z",
              }]
            : [
              {
                relativePath: "2026",
                name: "2026",
                kind: "directory",
                size: null,
                modifiedAt: "2026-05-24T16:05:00.000Z",
              },
              {
                relativePath: "客户",
                name: "客户",
                kind: "directory",
                size: null,
                modifiedAt: "2026-05-22T11:03:00.000Z",
              },
              {
                relativePath: "brief.md",
                name: "brief.md",
                kind: "file",
                size: 43008,
                modifiedAt: "2026-05-23T14:20:00.000Z",
              },
            ],
        })),
      uploadRawFiles: vi.fn<(payload: { projectId: string; targetDirectoryPath: string; filePaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      uploadRawItems: vi.fn<(payload: { projectId: string; targetDirectoryPath: string; itemPaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      uploadSources: vi.fn(),
      selectAndUploadRawFiles: vi.fn<(payload: { projectId: string; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      selectAndUploadRawDirectory: vi.fn<(payload: { projectId: string; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      exportRawEntries: vi.fn<(payload: { projectId: string; relativePaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      selectAndUploadSources: vi.fn(),
      createRawFolder: vi.fn<(payload: { projectId: string; parentDirectoryPath: string; name: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      renameRawEntry: vi.fn<(payload: { projectId: string; relativePath: string; newName: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      moveRawEntries: vi.fn<(payload: { projectId: string; relativePaths: string[]; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      trashRawEntries: vi.fn<(payload: { projectId: string; relativePaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
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

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function lastSourceUploadSuccessMessage(result: SynapseKnowledgeBaseRawMutationResult): string | null {
  const options = notifications.promise.mock.calls.at(-1)?.[1] as {
    success?: string | null | ((value: SynapseKnowledgeBaseRawMutationResult) => string | null)
  } | undefined
  if (!options) throw new Error("Promise notification options not found.")
  if (typeof options.success === "function") return options.success(result)
  return options.success ?? null
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function createDragDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  const types: string[] = []
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types,
    clearData: vi.fn((format?: string) => {
      if (!format) {
        store.clear()
        types.splice(0)
        return
      }
      store.delete(format)
      const index = types.indexOf(format)
      if (index >= 0) types.splice(index, 1)
    }),
    getData: vi.fn((format: string) => store.get(format) ?? ""),
    setData: vi.fn((format: string, data: string) => {
      store.set(format, data)
      if (!types.includes(format)) types.push(format)
    }),
    setDragImage: vi.fn(),
  }
}

function dragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return event
}

function externalFileDragEvent(type: string, relatedTarget?: EventTarget | null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [],
      types: ["Files"],
    },
  })
  if (relatedTarget !== undefined) {
    Object.defineProperty(event, "relatedTarget", { value: relatedTarget })
  }
  return event
}

describe("KnowledgeBaseSourceManagerWindow", () => {
  it("renders raw files as a lightweight file browser without import statuses", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    expect(document.querySelector('[aria-label="资料文件"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="文件夹树"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="资料列表"]')).not.toBeNull()
    expect(document.body.textContent).toContain("资料")
    expect(document.body.textContent).toContain("客户")
    expect(document.body.textContent).toContain("上传")
    expect(document.body.textContent).not.toContain("新文件")
    expect(document.body.textContent).not.toContain("已放入")
    expect(document.body.textContent).not.toContain("粘贴网页 URL")
    expect(document.body.textContent).not.toContain("选择文件")
    expect(document.body.textContent).not.toContain("大小")
    expect(document.body.textContent).not.toContain("更新时间")
    expect(document.body.textContent).not.toContain("拖拽文件到这里上传")
    expect(document.body.textContent).not.toContain("拖拽文件到窗口")
    expect(document.body.textContent).not.toContain("已选择")
    expect(bridgeMocks.agent.createSession).not.toHaveBeenCalled()
    expect(bridgeMocks.agent.send).not.toHaveBeenCalled()
  })

  it("shows batch actions only after selecting entries", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    expect(document.body.textContent).not.toContain("已选择")
    expect(document.querySelector('button[aria-label="移动所选"]')).toBeNull()

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })

    expect(document.body.textContent).toContain("已选择 1 项")
    expect(buttonByLabel("移动所选").disabled).toBe(false)
    expect(buttonByLabel("移到废纸篓").disabled).toBe(false)
  })

  it("selects every visible entry from the batch bar", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })
    expect(document.body.textContent).toContain("已选择 1 项")

    await act(async () => {
      buttonByLabel("全选当前可见项").click()
    })

    expect(document.body.textContent).toContain("已选择 3 项")
    await act(async () => {
      buttonByLabel("导出所选").click()
      await Promise.resolve()
    })
    expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["2026", "客户", "brief.md"],
    })
  })

  it("selects only filtered visible entries from the batch bar", async () => {
    bridgeMocks.knowledgeBase.listRawDirectory.mockResolvedValue({
      projectId: "project-1",
      directoryPath: "",
      entries: [
        {
          name: "alpha.md",
          relativePath: "alpha.md",
          kind: "file" as const,
          size: 12,
          modifiedAt: "2026-05-26T00:00:00.000Z",
        },
        {
          name: "beta.md",
          relativePath: "beta.md",
          kind: "file" as const,
          size: 14,
          modifiedAt: "2026-05-26T00:00:00.000Z",
        },
      ],
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("alpha.md")
    })

    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="搜索当前文件夹"]')
    expect(searchInput).not.toBeNull()
    act(() => {
      changeInput(searchInput!, "alpha")
    })
    await act(async () => {
      buttonByLabel("选择 alpha.md").click()
    })
    await act(async () => {
      buttonByLabel("全选当前可见项").click()
    })
    await act(async () => {
      buttonByLabel("导出所选").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["alpha.md"],
    })
  })

  it("opens folders and updates breadcrumbs", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("客户")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 客户").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("访谈.md")
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenLastCalledWith({
      projectId: "project-1",
      directoryPath: "客户",
    })
    expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("客户")
  })

  it("opens folders from the left file tree", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      buttonByLabel("打开树文件夹 客户").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("访谈.md")
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenLastCalledWith({
      projectId: "project-1",
      directoryPath: "客户",
    })
  })

  it("shows a loading state while expanding a tree directory", async () => {
    let resolveChild: ((result: SynapseKnowledgeBaseListRawDirectoryResult) => void) | null = null
    const childRequest = new Promise<SynapseKnowledgeBaseListRawDirectoryResult>((resolve) => {
      resolveChild = resolve
    })
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "2026") return childRequest
      return {
        projectId: "project-1",
        directoryPath,
        entries: [
          {
            relativePath: "2026",
            name: "2026",
            kind: "directory",
            size: null,
            modifiedAt: "2026-05-24T16:05:00.000Z",
          },
        ],
      }
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("2026")
    })

    await act(async () => {
      buttonByLabel("展开 2026").click()
      await Promise.resolve()
    })

    expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("读取中")

    await act(async () => {
      resolveChild?.({
        projectId: "project-1",
        directoryPath: "2026",
        entries: [{
          relativePath: "2026/05",
          name: "05",
          kind: "directory",
          size: null,
          modifiedAt: "2026-05-24T16:05:00.000Z",
        }],
      })
      await childRequest
    })

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("05")
    })
  })

  it("uploads dropped files and folders as raw items in the current directory", async () => {
    renderWindow()
    bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/diagram.png")

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("客户")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 客户").click()
      await Promise.resolve()
    })

    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽上传资料"]')
    if (!dropTarget) throw new Error("Drop target not found.")

    expect(dropTarget.textContent).not.toContain("拖拽文件到这里上传")
    expect(dropTarget.textContent).not.toContain("拖拽文件到窗口")

    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true })
    Object.defineProperty(dragOverEvent, "dataTransfer", {
      value: {
        files: [],
        types: ["Files"],
      },
    })

    await act(async () => {
      dropTarget.dispatchEvent(dragOverEvent)
      await Promise.resolve()
    })

    expect(dropTarget.textContent).toContain("松开上传")

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
      expect(bridgeMocks.knowledgeBase.uploadRawItems).toHaveBeenCalledWith({
        projectId: "project-1",
        targetDirectoryPath: "客户",
        itemPaths: ["/tmp/diagram.png"],
      })
    })
    expect(bridgeMocks.knowledgeBase.uploadRawFiles).not.toHaveBeenCalled()
    expect(bridgeMocks.knowledgeBase.uploadSources).not.toHaveBeenCalled()
  })

  it("keeps the upload hint visible when dragging over children inside the source manager", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    const main = document.querySelector<HTMLElement>('[aria-label="资料文件"]')
    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽上传资料"]')
    const child = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
    if (!main || !dropTarget || !child) throw new Error("Drag fixtures missing")

    await act(async () => {
      dropTarget.dispatchEvent(externalFileDragEvent("dragover"))
      await Promise.resolve()
    })
    expect(dropTarget.textContent).toContain("松开上传")

    await act(async () => {
      main.dispatchEvent(externalFileDragEvent("dragleave", child))
      await Promise.resolve()
    })

    expect(dropTarget.textContent).toContain("松开上传")
  })

  it("reports dropped files whose local paths cannot be resolved", async () => {
    renderWindow()
    bridgeMocks.knowledgeBase.filePathForDroppedFile
      .mockReturnValueOnce("/tmp/ready.md")
      .mockReturnValueOnce(null)

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽上传资料"]')
    if (!dropTarget) throw new Error("Drop target not found.")
    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [
          new File(["ready"], "ready.md", { type: "text/markdown" }),
          new File(["virtual"], "virtual.md", { type: "text/markdown" }),
        ],
      },
    })

    await act(async () => {
      dropTarget.dispatchEvent(event)
      await Promise.resolve()
    })

    expect(notifications.warning).toHaveBeenCalledWith("跳过 1 个无法读取路径的文件")
    expect(bridgeMocks.knowledgeBase.uploadRawItems).toHaveBeenCalledWith({
      projectId: "project-1",
      targetDirectoryPath: "",
      itemPaths: ["/tmp/ready.md"],
    })
  })

  it("selects files for raw upload in the current directory", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("上传文件").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.selectAndUploadRawFiles).toHaveBeenCalledWith({
      projectId: "project-1",
      targetDirectoryPath: "",
    })
    expect(bridgeMocks.knowledgeBase.selectAndUploadSources).not.toHaveBeenCalled()
  })

  it("selects folders for raw upload in the current directory", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("上传文件夹").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.selectAndUploadRawDirectory).toHaveBeenCalledWith({
      projectId: "project-1",
      targetDirectoryPath: "",
    })
  })

  it("reports skipped files in the upload success message", async () => {
    const uploadResult: SynapseKnowledgeBaseRawMutationResult = {
      projectId: "project-1",
      entries: [{
        relativePath: "客户/good.md",
        name: "good.md",
        kind: "file",
        size: 12,
        modifiedAt: "2026-05-23T14:20:00.000Z",
      }],
      skipped: [{ path: "/tmp/locked.pdf", reason: "read-error" }],
    }
    bridgeMocks.knowledgeBase.uploadRawItems.mockResolvedValueOnce(uploadResult)
    bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/good.md")
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("客户")
    })

    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽上传资料"]')
    if (!dropTarget) throw new Error("Drop target not found.")
    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [new File(["file"], "good.md", { type: "text/markdown" })],
      },
    })

    await act(async () => {
      dropTarget.dispatchEvent(event)
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.uploadRawItems).toHaveBeenCalledWith({
        projectId: "project-1",
        targetDirectoryPath: "",
        itemPaths: ["/tmp/good.md"],
      })
    })
    expect(lastSourceUploadSuccessMessage(uploadResult)).toBe("已上传 1 项，跳过 1 项（读取失败 1）")
  })

  it("exports one entry from the row menu", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("更多 brief.md").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    let exportItem: HTMLElement | undefined
    await waitForExpectation(() => {
      exportItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes("导出"))
      expect(exportItem).toBeDefined()
    })
    await act(async () => {
      exportItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
    })
  })

  it("exports selected entries from the batch bar", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })
    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })

    await act(async () => {
      buttonByLabel("导出所选").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
    })
  })

  it("moves one unselected entry when dragged to a folder row", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })
    const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
    const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
    if (!source || !target) throw new Error("Drag fixtures missing")

    await act(async () => {
      source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))
      target.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }))
      target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
      targetDirectoryPath: "客户",
    })
  })

  it("moves selected entries as a group when dragging a selected item", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })
    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })
    const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
    const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
    if (!source || !target) throw new Error("Drag fixtures missing")

    await act(async () => {
      source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))
      target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
      targetDirectoryPath: "客户",
    })
  })

  it("moves multiple selected entries as a group when dragging one selected item", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })
    await act(async () => {
      buttonByLabel("选择 brief.md").click()
      buttonByLabel("选择 2026").click()
    })
    const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
    const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
    if (!source || !target) throw new Error("Drag fixtures missing")

    await act(async () => {
      source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))
      target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md", "2026"],
      targetDirectoryPath: "客户",
    })
  })

  it("keeps selected drag paths in data transfer for resilient grouped drops", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })
    await act(async () => {
      buttonByLabel("选择 brief.md").click()
      buttonByLabel("选择 2026").click()
    })
    const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
    const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
    if (!source || !target) throw new Error("Drag fixtures missing")
    const dataTransfer = createDragDataTransfer()

    await act(async () => {
      source.dispatchEvent(dragEvent("dragstart", dataTransfer))
      source.dispatchEvent(dragEvent("dragend", dataTransfer))
      target.dispatchEvent(dragEvent("drop", dataTransfer))
      await Promise.resolve()
    })

    expect(dataTransfer.effectAllowed).toBe("move")
    expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md", "2026"],
      targetDirectoryPath: "客户",
    })
  })

  it("keeps the upload hint hidden while internally dragging an entry", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽上传资料"]')
    if (!source || !dropTarget) throw new Error("Drag fixtures missing")

    await act(async () => {
      source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))
      dropTarget.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(dropTarget.textContent).not.toContain("松开上传")
    expect(bridgeMocks.knowledgeBase.uploadRawItems).not.toHaveBeenCalled()
  })

  it("does not move a folder into itself", async () => {
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("客户")
    })
    const source = document.querySelector<HTMLElement>('[data-raw-path="客户"]')
    const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
    if (!source || !target) throw new Error("Drag fixtures missing")

    await act(async () => {
      source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }))
      target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.moveRawEntries).not.toHaveBeenCalled()
  })

  it("creates folders and batch mutates selected entries", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("新建文件夹").click()
    })
    const folderInput = document.querySelector<HTMLInputElement>('input[placeholder="文件夹名称"]')
    expect(folderInput).not.toBeNull()
    act(() => {
      changeInput(folderInput!, "归档")
    })
    await act(async () => {
      buttonByLabel("确认新建").click()
      await Promise.resolve()
    })
    expect(bridgeMocks.knowledgeBase.createRawFolder).toHaveBeenCalledWith({
      projectId: "project-1",
      parentDirectoryPath: "",
      name: "归档",
    })

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })
    await act(async () => {
      buttonByLabel("移动所选").click()
    })
    expect(document.querySelector<HTMLInputElement>('input[placeholder="目标文件夹"]')).toBeNull()
    await act(async () => {
      buttonByLabel("选择目标文件夹 客户").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByLabel("确认移动").click()
      await Promise.resolve()
    })
    expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
      targetDirectoryPath: "客户",
    })

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })
    await act(async () => {
      buttonByLabel("移到废纸篓").click()
    })
    expect(document.body.textContent).toContain("移到废纸篓？")
    await act(async () => {
      buttonByLabel("确认移到废纸篓").click()
      await Promise.resolve()
    })
    expect(bridgeMocks.knowledgeBase.trashRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
    })
  })

  it("refreshes cached target tree nodes after moving a directory", async () => {
    const rootDirectory = {
      relativePath: "2026",
      name: "2026",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-24T16:05:00.000Z",
    }
    const targetDirectory = {
      relativePath: "客户",
      name: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-22T11:03:00.000Z",
    }
    const entriesByDirectory = new Map<string, SynapseKnowledgeBaseListRawDirectoryResult>([
      ["", { projectId: "project-1", directoryPath: "", entries: [rootDirectory, targetDirectory] }],
      ["客户", { projectId: "project-1", directoryPath: "客户", entries: [] }],
    ])
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) =>
      entriesByDirectory.get(directoryPath) ?? { projectId: "project-1", directoryPath, entries: [] })
    bridgeMocks.knowledgeBase.moveRawEntries.mockImplementation(async ({ relativePaths, targetDirectoryPath }) => {
      if (relativePaths.includes("2026") && targetDirectoryPath === "客户") {
        entriesByDirectory.set("", { projectId: "project-1", directoryPath: "", entries: [targetDirectory] })
        entriesByDirectory.set("客户", {
          projectId: "project-1",
          directoryPath: "客户",
          entries: [{ ...rootDirectory, relativePath: "客户/2026" }],
        })
      }
      return { projectId: "project-1", entries: [], skipped: [] }
    })

    renderWindow()
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith({
        projectId: "project-1",
        directoryPath: "客户",
      })
    })

    await act(async () => {
      buttonByLabel("选择 2026").click()
    })
    await act(async () => {
      buttonByLabel("移动所选").click()
    })
    await act(async () => {
      buttonByLabel("选择目标文件夹 客户").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByLabel("确认移动").click()
    })
    await act(async () => {
      buttonByText("确认").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("2026")
    })
  })

  it("asks for confirmation before trashing a selected directory", async () => {
    const directoryEntry = {
      name: "客户",
      relativePath: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-26T00:00:00.000Z",
    }
    bridgeMocks.knowledgeBase.listRawDirectory.mockResolvedValue({
      projectId: "project-1",
      directoryPath: "",
      entries: [directoryEntry],
    })
    renderWindow()
    await waitForExpectation(() => expect(document.body.textContent).toContain("客户"))

    await act(async () => {
      buttonByLabel("选择 客户").click()
    })
    await act(async () => {
      buttonByLabel("移到废纸篓").click()
    })

    expect(document.body.textContent).toContain("移到废纸篓？")
    expect(document.body.textContent).toContain("客户")
    expect(bridgeMocks.knowledgeBase.trashRawEntries).not.toHaveBeenCalled()
  })

  it("asks for confirmation before moving multiple selected entries", async () => {
    const directoryEntry = {
      name: "客户",
      relativePath: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-26T00:00:00.000Z",
    }
    bridgeMocks.knowledgeBase.listRawDirectory.mockResolvedValue({
      projectId: "project-1",
      directoryPath: "",
      entries: [
        {
          name: "a.md",
          relativePath: "a.md",
          kind: "file" as const,
          size: 12,
          modifiedAt: "2026-05-26T00:00:00.000Z",
        },
        {
          name: "b.md",
          relativePath: "b.md",
          kind: "file" as const,
          size: 14,
          modifiedAt: "2026-05-26T00:00:00.000Z",
        },
        directoryEntry,
      ],
    })
    renderWindow()
    await waitForExpectation(() => expect(document.body.textContent).toContain("a.md"))

    await act(async () => {
      buttonByLabel("选择 a.md").click()
      buttonByLabel("选择 b.md").click()
    })
    await act(async () => {
      buttonByLabel("移动所选").click()
    })
    await act(async () => {
      buttonByLabel("选择目标文件夹 客户").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByLabel("确认移动").click()
    })

    expect(document.body.textContent).toContain("确认移动？")
    expect(bridgeMocks.knowledgeBase.moveRawEntries).not.toHaveBeenCalled()
  })
})
