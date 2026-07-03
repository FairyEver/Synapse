/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseSourceManagerWindow } from "../source-manager-window"
import type {
  SynapseKnowledgeBaseListRawDirectoryPayload,
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseRawMutationResult,
  SynapseKnowledgeBaseUploadSourcesResult,
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
  const rawEntriesByDirectory: Record<string, SynapseKnowledgeBaseListRawDirectoryResult["entries"]> = {
    "客户": [{
      relativePath: "客户/访谈.md",
      name: "访谈.md",
      kind: "file",
      size: 24,
      modifiedAt: "2026-05-23T14:20:00.000Z",
    }],
    "2026": [{
      relativePath: "2026/05",
      name: "05",
      kind: "directory",
      size: null,
      modifiedAt: "2026-05-24T16:05:00.000Z",
    }],
    "": [
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
  }
  return {
    knowledgeBase: {
      listRawDirectory: vi.fn<(payload: SynapseKnowledgeBaseListRawDirectoryPayload) => Promise<SynapseKnowledgeBaseListRawDirectoryResult>>()
        .mockImplementation(async (payload) => {
          const query = payload.query?.trim().toLowerCase() ?? ""
          const allEntries = rawEntriesByDirectory[payload.directoryPath] ?? []
          const filtered = allEntries.filter((entry) => (
            (payload.entryKind !== "directory" || entry.kind === "directory")
            && (!query || `${entry.name}\n${entry.relativePath}`.toLowerCase().includes(query))
          ))
          const offset = payload.offset ?? 0
          const entries = payload.limit === undefined
            ? filtered.slice(offset)
            : filtered.slice(offset, offset + payload.limit)
          return {
            projectId: payload.projectId,
            directoryPath: payload.directoryPath,
            entries,
            totalCount: filtered.length,
            offset,
            limit: payload.limit,
            hasMore: payload.limit !== undefined && offset + payload.limit < filtered.length,
          }
        }),
      uploadRawFiles: vi.fn<(payload: { projectId: string; targetDirectoryPath: string; filePaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      uploadRawItems: vi.fn<(payload: { projectId: string; targetDirectoryPath: string; itemPaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      addUrlSource: vi.fn<(payload: { projectId: string; targetDirectoryPath: string; url: string }) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
        .mockResolvedValue({
          projectId: "project-1",
          uploaded: [{
            originalPath: "https://example.com/notes",
            relativePath: ".raw/web/2026/05/24/notes.md",
            name: "notes.md",
            size: 120,
            sourceKind: "url",
            sourceUrl: "https://example.com/notes",
          }],
          skipped: [],
        }),
      selectAndUploadRawFiles: vi.fn<(payload: { projectId: string; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      selectAndUploadRawDirectory: vi.fn<(payload: { projectId: string; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      exportRawEntries: vi.fn<(payload: { projectId: string; relativePaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
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

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null
  let reject: ((error: unknown) => void) | null = null
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve: resolve!, reject: reject! }
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

function openContextMenuOnButton(label: string): void {
  buttonByLabel(label).dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  }))
}

function listDirectoryCallCount(
  directoryPath: string,
  entryKind?: SynapseKnowledgeBaseListRawDirectoryPayload["entryKind"],
): number {
  return bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
    payload.directoryPath === directoryPath
    && (entryKind === undefined || payload.entryKind === entryKind)
  )).length
}

function menuItemByText(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!item) throw new Error(`Menu item not found: ${text}`)
  return item
}

function lastRawMutationSuccessMessage(result: SynapseKnowledgeBaseRawMutationResult): string | null {
  const options = notifications.promise.mock.calls.at(-1)?.[1] as {
    success?: string | null | ((value: SynapseKnowledgeBaseRawMutationResult) => string | null)
  } | undefined
  if (!options) throw new Error("Promise notification options not found.")
  if (typeof options.success === "function") return options.success(result)
  return options.success ?? null
}

function lastPromiseErrorMessage(): string | null {
  const options = notifications.promise.mock.calls.at(-1)?.[1] as {
    error?: string | null
  } | undefined
  if (!options) throw new Error("Promise notification options not found.")
  return options.error ?? null
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
    expect(document.body.textContent).toContain("已选择 0 项")
    expect(bridgeMocks.agent.createSession).not.toHaveBeenCalled()
    expect(bridgeMocks.agent.send).not.toHaveBeenCalled()
  })

  it("requests raw entries by page while loading tree folders with directory-only requests", async () => {
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async (payload) => {
      if (payload.entryKind === "directory") {
        return {
          projectId: payload.projectId,
          directoryPath: payload.directoryPath,
          entries: [],
          totalCount: 0,
          offset: 0,
          hasMore: false,
        }
      }
      const offset = payload.offset ?? 0
      const entryName = offset === 0 ? "file-001.md" : "file-201.md"
      return {
        projectId: payload.projectId,
        directoryPath: payload.directoryPath,
        entries: [{
          relativePath: entryName,
          name: entryName,
          kind: "file",
          size: 12,
          modifiedAt: "2026-05-23T14:20:00.000Z",
        }],
        totalCount: 201,
        offset,
        limit: payload.limit,
        hasMore: offset === 0,
      }
    })

    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("file-001.md")
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "",
      entryKind: "all",
      offset: 0,
      limit: 200,
    }))
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "",
      entryKind: "directory",
    }))

    await act(async () => {
      buttonByLabel("下一页").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("file-201.md")
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "",
      entryKind: "all",
      offset: 200,
      limit: 200,
    }))
  })

  it("resets raw directory pagination before searching", async () => {
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async (payload) => {
      if (payload.entryKind === "directory") {
        return {
          projectId: payload.projectId,
          directoryPath: payload.directoryPath,
          entries: [],
          totalCount: 0,
          offset: 0,
          hasMore: false,
        }
      }
      const offset = payload.offset ?? 0
      const query = payload.query ?? ""
      const entryName = query ? "file-001.md" : offset === 0 ? "file-001.md" : "file-201.md"
      return {
        projectId: payload.projectId,
        directoryPath: payload.directoryPath,
        entries: [{
          relativePath: entryName,
          name: entryName,
          kind: "file",
          size: 12,
          modifiedAt: "2026-05-23T14:20:00.000Z",
        }],
        totalCount: query ? 1 : 201,
        offset,
        limit: payload.limit,
        hasMore: !query && offset === 0,
      }
    })

    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("file-001.md")
    })
    await act(async () => {
      buttonByLabel("下一页").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("file-201.md")
    })

    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="搜索当前文件夹"]')
    if (!searchInput) throw new Error("Search input not found.")
    await act(async () => {
      changeInput(searchInput, "file-001")
      await Promise.resolve()
    })

    const searchedCalls = bridgeMocks.knowledgeBase.listRawDirectory.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.entryKind === "all" && payload.query === "file-001")
    expect(searchedCalls.map((payload) => payload.offset)).toEqual([0])
  })

  it("keeps batch actions visible and disabled until entries are selected", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    expect(document.body.textContent).toContain("已选择 0 项")
    expect(buttonByLabel("全选当前可见项").disabled).toBe(false)
    expect(buttonByLabel("移动所选").disabled).toBe(true)
    expect(buttonByLabel("导出所选").disabled).toBe(true)
    expect(buttonByLabel("移到废纸篓").disabled).toBe(true)

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })

    expect(document.body.textContent).toContain("已选择 1 项")
    expect(buttonByLabel("移动所选").disabled).toBe(false)
    expect(buttonByLabel("导出所选").disabled).toBe(false)
    expect(buttonByLabel("移到废纸篓").disabled).toBe(false)
  })

  it("opens a directory when clicking the empty area of its row", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    const row = document.querySelector<HTMLElement>('[data-raw-path="客户"]')
    if (!row) throw new Error("Directory row missing")

    await act(async () => {
      row.click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "客户",
      entryKind: "all",
      offset: 0,
      limit: 200,
    }))
  })

  it("does not open a directory when clicking its selection checkbox", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    const directoryCallCount = listDirectoryCallCount("客户")
    await act(async () => {
      buttonByLabel("选择 客户").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("已选择 1 项")
    expect(document.querySelector('[aria-label="当前位置"]')?.textContent).not.toContain("客户")
    expect(listDirectoryCallCount("客户")).toBe(directoryCallCount)
  })

  it("does not open a directory when clicking its row action button", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    const directoryCallCount = listDirectoryCallCount("客户")
    await act(async () => {
      buttonByLabel("更多 客户").click()
      await Promise.resolve()
    })

    expect(document.querySelector('[aria-label="当前位置"]')?.textContent).not.toContain("客户")
    expect(listDirectoryCallCount("客户")).toBe(directoryCallCount)
  })

  it("selects every visible entry from the selection checkbox", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("全选当前可见项").click()
    })

    expect(document.body.textContent).toContain("已选择 3 项")
    expect(buttonByLabel("全选当前可见项").getAttribute("aria-checked")).toBe("true")
    await act(async () => {
      buttonByLabel("导出所选").click()
      await Promise.resolve()
    })
    expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["2026", "客户", "brief.md"],
    })
  })

  it("marks the selection checkbox indeterminate when some visible entries are selected", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })

    expect(buttonByLabel("全选当前可见项").getAttribute("aria-checked")).toBe("mixed")
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
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "客户",
      entryKind: "all",
      offset: 0,
      limit: 200,
    }))
    expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("客户")
  })

  it("adds a URL source from the source manager toolbar", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("添加 URL").click()
      await Promise.resolve()
    })
    const urlInput = document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/page"]')
    expect(urlInput).not.toBeNull()

    act(() => {
      changeInput(urlInput!, "https://example.com/notes")
    })
    await act(async () => {
      buttonByText("添加").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.addUrlSource).toHaveBeenCalledWith({
      projectId: "project-1",
      targetDirectoryPath: "",
      url: "https://example.com/notes",
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "",
      entryKind: "all",
    }))
  })

  it("keeps the URL dialog open when URL source staging is skipped", async () => {
    bridgeMocks.knowledgeBase.addUrlSource.mockResolvedValueOnce({
      projectId: "project-1",
      uploaded: [],
      skipped: [{ path: "https://example.com/missing", reason: "network_error" }],
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("添加 URL").click()
      await Promise.resolve()
    })
    const urlInput = document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/page"]')
    expect(urlInput).not.toBeNull()

    act(() => {
      changeInput(urlInput!, "https://example.com/missing")
    })
    await act(async () => {
      buttonByText("添加").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.addUrlSource).toHaveBeenCalledWith({
        projectId: "project-1",
        targetDirectoryPath: "",
        url: "https://example.com/missing",
      })
    })
    const preservedInput = document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/page"]')
    expect(preservedInput?.value).toBe("https://example.com/missing")
  })

  it("keeps breadcrumbs in a dedicated scroll row below toolbar actions", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("2026")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 2026").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("05")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 05").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("05")
    })

    const breadcrumbNav = document.querySelector<HTMLElement>('nav[aria-label="当前位置"]')
    expect(breadcrumbNav).not.toBeNull()
    expect(breadcrumbNav?.className).toContain("overflow-x-auto")
    expect(breadcrumbNav?.previousElementSibling?.tagName).toBe("HEADER")
    expect(breadcrumbNav?.previousElementSibling?.querySelector('input[placeholder="搜索当前文件夹"]')).not.toBeNull()
    expect(breadcrumbNav?.querySelector('input[placeholder="搜索当前文件夹"]')).toBeNull()
    expect(breadcrumbNav?.querySelector("div")?.className).toContain("min-w-max")
  })

  it("ignores a stale directory success after navigating away", async () => {
    const customerRequest = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    let customerRequestCount = 0
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        customerRequestCount += 1
        if (customerRequestCount === 1) return { projectId: "project-1", directoryPath, entries: [] }
        return customerRequest.promise
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: [
          {
            relativePath: "客户",
            name: "客户",
            kind: "directory" as const,
            size: null,
            modifiedAt: "2026-05-22T11:03:00.000Z",
          },
          {
            relativePath: "brief.md",
            name: "brief.md",
            kind: "file" as const,
            size: 43008,
            modifiedAt: "2026-05-23T14:20:00.000Z",
          },
        ],
      }
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("客户")
    })
    await act(async () => {
      buttonByText("资料").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="当前位置"]')?.textContent).not.toContain("客户")
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      customerRequest.resolve({
        projectId: "project-1",
        directoryPath: "客户",
        entries: [{
          relativePath: "客户/stale.md",
          name: "stale.md",
          kind: "file",
          size: 24,
          modifiedAt: "2026-05-23T14:20:00.000Z",
        }],
      })
      await customerRequest.promise
    })

    expect(document.body.textContent).toContain("brief.md")
    expect(document.body.textContent).not.toContain("stale.md")
    expect(document.body.textContent).not.toContain("读取中")
    expect(notifications.error).not.toHaveBeenCalledWith("读取资料失败")
  })

  it("ignores a stale directory failure after navigating away", async () => {
    const customerRequest = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    let customerRequestCount = 0
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        customerRequestCount += 1
        if (customerRequestCount === 1) return { projectId: "project-1", directoryPath, entries: [] }
        return customerRequest.promise
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: [
          {
            relativePath: "客户",
            name: "客户",
            kind: "directory" as const,
            size: null,
            modifiedAt: "2026-05-22T11:03:00.000Z",
          },
          {
            relativePath: "brief.md",
            name: "brief.md",
            kind: "file" as const,
            size: 43008,
            modifiedAt: "2026-05-23T14:20:00.000Z",
          },
        ],
      }
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("客户")
    })
    await act(async () => {
      buttonByText("资料").click()
      await Promise.resolve()
    })

    await act(async () => {
      customerRequest.reject(new Error("stale read failed"))
      try {
        await customerRequest.promise
      } catch {
        // Expected from the stale request.
      }
    })

    expect(document.body.textContent).toContain("brief.md")
    expect(document.body.textContent).not.toContain("读取失败")
    expect(document.body.textContent).not.toContain("读取中")
    expect(notifications.error).not.toHaveBeenCalledWith("读取资料失败")
  })

  it("does not mark the active pane loading when a stale captured refresh starts", async () => {
    const uploadRequest = createDeferred<SynapseKnowledgeBaseRawMutationResult>()
    const staleRefreshRequest = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    let customerRequestCount = 0
    bridgeMocks.knowledgeBase.selectAndUploadRawFiles.mockReturnValue(uploadRequest.promise)
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath, entryKind }) => {
      if (directoryPath === "客户") {
        if (entryKind === "directory") {
          return {
            projectId: "project-1",
            directoryPath,
            entries: [],
          }
        }
        customerRequestCount += 1
        if (customerRequestCount === 1) {
          return {
            projectId: "project-1",
            directoryPath,
            entries: [{
              relativePath: "客户/访谈.md",
              name: "访谈.md",
              kind: "file",
              size: 24,
              modifiedAt: "2026-05-23T14:20:00.000Z",
            }],
          }
        }
        return staleRefreshRequest.promise
      }
      if (directoryPath === "2026") {
        return {
          projectId: "project-1",
          directoryPath,
          entries: [],
        }
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: [
          {
            relativePath: "客户",
            name: "客户",
            kind: "directory" as const,
            size: null,
            modifiedAt: "2026-05-22T11:03:00.000Z",
          },
          {
            relativePath: "2026",
            name: "2026",
            kind: "directory" as const,
            size: null,
            modifiedAt: "2026-05-24T16:05:00.000Z",
          },
        ],
      }
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("2026")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("访谈.md")
    })

    await act(async () => {
      buttonByLabel("上传文件").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("资料").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="当前位置"]')?.textContent).not.toContain("客户")
      expect(document.body.textContent).toContain("2026")
    })
    await act(async () => {
      buttonByLabel("打开文件夹 2026").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("2026")
      expect(document.body.textContent).toContain("没有文件")
    })

    await act(async () => {
      uploadRequest.resolve({
        projectId: "project-1",
        entries: [],
        skipped: [],
      })
      await uploadRequest.promise
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "all"
      ))).toHaveLength(2)
    })

    expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("2026")
    expect(document.body.textContent).toContain("没有文件")
    expect(document.body.textContent).not.toContain("读取中")
    expect(document.body.textContent).not.toContain("读取失败")
  })

  it("clears stale entries when opening a folder fails", async () => {
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") throw new Error("read failed")
      return {
        projectId: "project-1",
        directoryPath,
        entries: [
          {
            relativePath: "客户",
            name: "客户",
            kind: "directory" as const,
            size: null,
            modifiedAt: "2026-05-22T11:03:00.000Z",
          },
          {
            relativePath: "brief.md",
            name: "brief.md",
            kind: "file" as const,
            size: 43008,
            modifiedAt: "2026-05-23T14:20:00.000Z",
          },
        ],
      }
    })
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 客户").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(notifications.error).toHaveBeenCalledWith("读取资料失败")
    })
    expect(document.querySelector('[aria-label="当前位置"]')?.textContent).toContain("客户")
    expect(document.body.textContent).toContain("读取失败")
    expect(document.body.textContent).not.toContain("brief.md")
  })

  it("does not preload root child folders before expansion", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("2026")
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).not.toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "2026",
      entryKind: "directory",
    }))
    expect(bridgeMocks.knowledgeBase.listRawDirectory).not.toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "客户",
      entryKind: "directory",
    }))

    await act(async () => {
      buttonByLabel("展开 2026").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "project-1",
        directoryPath: "2026",
        entryKind: "directory",
      }))
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).not.toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "2026/05",
    }))
  })

  it("settles an expanded root child without waiting for a sibling", async () => {
    const yearRequest = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "2026") return yearRequest.promise
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
          {
            relativePath: "客户",
            name: "客户",
            kind: "directory",
            size: null,
            modifiedAt: "2026-05-22T11:03:00.000Z",
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
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "project-1",
        directoryPath: "2026",
        entryKind: "directory",
      }))
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory).not.toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "客户",
      entryKind: "directory",
    }))
    expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("读取中")

    await act(async () => {
      yearRequest.resolve({
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
      await yearRequest.promise
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      const treeText = document.querySelector('[aria-label="文件夹树"]')?.textContent
      expect(treeText).toContain("05")
      expect(treeText).not.toContain("读取中")
    })
    expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
      payload.directoryPath === "客户" && payload.entryKind === "directory"
    ))).toHaveLength(0)
  })

  it("does not duplicate pending explicit tree loads after an intervening render", async () => {
    let resolvePreload: ((result: SynapseKnowledgeBaseListRawDirectoryResult) => void) | null = null
    const preloadRequest = new Promise<SynapseKnowledgeBaseListRawDirectoryResult>((resolve) => {
      resolvePreload = resolve
    })
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "2026") return preloadRequest
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
          {
            relativePath: "客户",
            name: "客户",
            kind: "directory",
            size: null,
            modifiedAt: "2026-05-22T11:03:00.000Z",
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
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "2026" && payload.entryKind === "directory"
      ))).toHaveLength(1)
    })
    await act(async () => {
      buttonByLabel("选择 2026").click()
    })

    expect(
      bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "2026" && payload.entryKind === "directory"
      )),
    ).toHaveLength(1)
    expect(
      bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "directory"
      )),
    ).toHaveLength(0)

    await act(async () => {
      resolvePreload?.({
        projectId: "project-1",
        directoryPath: "2026",
        entries: [],
      })
      await preloadRequest
    })
  })

  it("clears tree loading when opening a folder with a pending explicit tree load", async () => {
    const clientDirectory = {
      relativePath: "客户",
      name: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-22T11:03:00.000Z",
    }
    const projectDirectory = {
      relativePath: "客户/项目",
      name: "项目",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-24T16:05:00.000Z",
    }
    const stalePreload = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    const activeRequest = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    let clientDirectoryRequestCount = 0
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        clientDirectoryRequestCount += 1
        if (clientDirectoryRequestCount === 1) return stalePreload.promise
        return activeRequest.promise
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: directoryPath === "" ? [clientDirectory] : [],
      }
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
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "directory"
      ))).toHaveLength(1)
    })

    await act(async () => {
      buttonByLabel("打开树文件夹 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "directory"
      ))).toHaveLength(2)
    })

    await act(async () => {
      activeRequest.resolve({
        projectId: "project-1",
        directoryPath: "客户",
        entries: [projectDirectory],
      })
      await activeRequest.promise
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("项目")
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).not.toContain("读取中")
    })
    await act(async () => {
      buttonByLabel("折叠 客户").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("项目")
    expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).not.toContain("读取中")

    await act(async () => {
      stalePreload.reject(new Error("stale preload failed"))
      try {
        await stalePreload.promise
      } catch {
        // Expected from the stale request.
      }
      await Promise.resolve()
    })
  })

  it("hides disclosure actions for checked folders without child folders", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="展开 客户"]')).not.toBeNull()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "project-1",
        directoryPath: "客户",
        entryKind: "directory",
      }))
      expect(document.querySelector('[aria-label="展开 2026"]')).not.toBeNull()
      expect(document.querySelector('[aria-label="展开 客户"]')).toBeNull()
      expect(document.querySelector('[aria-label="折叠 客户"]')).toBeNull()
    })
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
    expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      directoryPath: "客户",
      entryKind: "all",
      offset: 0,
      limit: 200,
    }))
  })

  it("does not show rename or delete actions for the left file tree root", async () => {
    renderWindow()

    await act(async () => {
      openContextMenuOnButton("打开树文件夹 资料")
      await Promise.resolve()
    })

    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0)
  })

  it("renames folders from the left file tree context menu", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      openContextMenuOnButton("打开树文件夹 客户")
      await Promise.resolve()
    })
    await act(async () => {
      menuItemByText("重命名").click()
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>('input[placeholder="新名称"]')
    expect(input).not.toBeNull()
    act(() => {
      changeInput(input!, "客户资料")
    })
    await act(async () => {
      buttonByLabel("确认重命名").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.renameRawEntry).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "客户",
      newName: "客户资料",
    })
  })

  it("deletes folders from the left file tree context menu", async () => {
    renderWindow()

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      openContextMenuOnButton("打开树文件夹 客户")
      await Promise.resolve()
    })
    await act(async () => {
      menuItemByText("删除").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("移到废纸篓？")

    await act(async () => {
      buttonByLabel("确认移到废纸篓").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.trashRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["客户"],
    })
  })

  it("keeps active directory content fresh when a tree load for the same directory resolves first", async () => {
    const clientDirectory = {
      relativePath: "客户",
      name: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-22T11:03:00.000Z",
    }
    const projectDirectory = {
      relativePath: "客户/项目",
      name: "项目",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-24T16:05:00.000Z",
    }
    const projectNote = {
      relativePath: "客户/项目/notes.md",
      name: "notes.md",
      kind: "file" as const,
      size: 128,
      modifiedAt: "2026-05-25T09:10:00.000Z",
    }
    const activeProjectRequests: Array<ReturnType<typeof createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>>> = []
    const treeProjectRequests: Array<ReturnType<typeof createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>>> = []
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath, entryKind }) => {
      if (directoryPath === "") {
        return {
          projectId: "project-1",
          directoryPath,
          entries: [clientDirectory],
        }
      }
      if (directoryPath === "客户") {
        return {
          projectId: "project-1",
          directoryPath,
          entries: [projectDirectory],
        }
      }
      if (directoryPath === "客户/项目") {
        const request = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
        if (entryKind === "directory") {
          treeProjectRequests.push(request)
        } else {
          activeProjectRequests.push(request)
        }
        return request.promise
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: [],
      }
    })

    renderWindow()
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("客户")
    })

    await act(async () => {
      buttonByLabel("打开树文件夹 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("项目")
    })

    await act(async () => {
      buttonByLabel("打开文件夹 项目").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(activeProjectRequests).toHaveLength(1)
    })

    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="搜索当前文件夹"]')
    if (!searchInput) throw new Error("Search input not found.")
    await act(async () => {
      changeInput(searchInput, "notes")
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("读取中")
    await waitForExpectation(() => {
      expect(activeProjectRequests.length).toBeGreaterThan(1)
    })

    await act(async () => {
      buttonByLabel("展开 项目").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.some(([payload]) => (
        payload.directoryPath === "客户/项目" && payload.entryKind === "directory"
      ))).toBe(true)
    })

    await act(async () => {
      const treeProjectRequest = treeProjectRequests.at(-1)
      if (!treeProjectRequest) throw new Error("Tree project request not found.")
      treeProjectRequest.resolve({
        projectId: "project-1",
        directoryPath: "客户/项目",
        entries: [],
      })
      await treeProjectRequest.promise
    })

    await act(async () => {
      for (const activeProjectRequest of activeProjectRequests) {
        activeProjectRequest.resolve({
          projectId: "project-1",
          directoryPath: "客户/项目",
          entries: [projectNote],
        })
      }
      await Promise.all(activeProjectRequests.map((request) => request.promise))
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("notes.md")
      expect(document.body.textContent).not.toContain("读取中")
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
  })

  it("uploads external files dropped on a tree folder into that folder", async () => {
    renderWindow()
    bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/diagram.png")

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("客户")
    })

    const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
    if (!target) throw new Error("Drop target not found.")
    const dataTransfer = createDragDataTransfer()
    const dragTypes = dataTransfer.types as string[]
    dragTypes.push("Files")
    Object.defineProperty(dataTransfer, "files", {
      value: [new File(["image"], "diagram.png", { type: "image/png" })],
    })

    await act(async () => {
      target.dispatchEvent(dragEvent("drop", dataTransfer))
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.uploadRawItems).toHaveBeenCalledWith({
        projectId: "project-1",
        targetDirectoryPath: "客户",
        itemPaths: ["/tmp/diagram.png"],
      })
    })
    expect(bridgeMocks.knowledgeBase.moveRawEntries).not.toHaveBeenCalled()
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
    expect(lastRawMutationSuccessMessage(uploadResult)).toBe("已上传 1 项，跳过 1 项（读取失败 1）")
  })

  it("reports all-skipped uploads instead of a no-file success message", async () => {
    const uploadResult: SynapseKnowledgeBaseRawMutationResult = {
      projectId: "project-1",
      entries: [],
      skipped: [{ path: "/tmp/locked.pdf", reason: "read-error" }],
    }
    bridgeMocks.knowledgeBase.uploadRawItems.mockResolvedValueOnce(uploadResult)
    bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/locked.pdf")
    renderWindow()

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("客户")
    })

    const dropTarget = document.querySelector<HTMLElement>('[aria-label="拖拽上传资料"]')
    if (!dropTarget) throw new Error("Drop target not found.")
    const event = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [new File(["file"], "locked.pdf", { type: "application/pdf" })],
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
        itemPaths: ["/tmp/locked.pdf"],
      })
    })
    expect(lastRawMutationSuccessMessage(uploadResult)).toBe("跳过 1 项（读取失败 1）")
  })

  it("reports skipped entries in the move success message", async () => {
    const moveResult: SynapseKnowledgeBaseRawMutationResult = {
      projectId: "project-1",
      entries: [{
        relativePath: "客户/brief.md",
        name: "brief.md",
        kind: "file",
        size: 43008,
        modifiedAt: "2026-05-23T14:20:00.000Z",
      }],
      skipped: [{ path: "locked.md", reason: "collision" }],
    }
    bridgeMocks.knowledgeBase.moveRawEntries.mockResolvedValueOnce(moveResult)
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
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
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
      targetDirectoryPath: "客户",
    })
    expect(lastRawMutationSuccessMessage(moveResult)).toBe("已移动 1 项，跳过 1 项（目标已存在 1）")
  })

  it("reports skipped entries in the trash success message", async () => {
    const trashResult: SynapseKnowledgeBaseRawMutationResult = {
      projectId: "project-1",
      entries: [{
        relativePath: "brief.md",
        name: "brief.md",
        kind: "file",
        size: 43008,
        modifiedAt: "2026-05-23T14:20:00.000Z",
      }],
      skipped: [{ path: "locked.md", reason: "trash-error" }],
    }
    bridgeMocks.knowledgeBase.trashRawEntries.mockResolvedValueOnce(trashResult)
    renderWindow()
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("brief.md")
    })

    await act(async () => {
      buttonByLabel("选择 brief.md").click()
    })
    await act(async () => {
      buttonByLabel("移到废纸篓").click()
    })
    await act(async () => {
      buttonByLabel("确认移到废纸篓").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.trashRawEntries).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePaths: ["brief.md"],
    })
    expect(lastRawMutationSuccessMessage(trashResult)).toBe("已移到废纸篓 1 项，跳过 1 项（删除失败 1）")
    expect(lastPromiseErrorMessage()).toBe("移到废纸篓失败")
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

  it("does not report export success when no entries were exported", async () => {
    const exportResult: SynapseKnowledgeBaseRawMutationResult = {
      projectId: "project-1",
      entries: [],
      skipped: [],
    }
    bridgeMocks.knowledgeBase.exportRawEntries.mockResolvedValueOnce(exportResult)
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

    expect(lastRawMutationSuccessMessage(exportResult)).toBeNull()
  })

  it("reports skipped export entries when nothing was exported", async () => {
    const exportResult: SynapseKnowledgeBaseRawMutationResult = {
      projectId: "project-1",
      entries: [],
      skipped: [{ path: "brief.md", reason: "export-error" }],
    }
    bridgeMocks.knowledgeBase.exportRawEntries.mockResolvedValueOnce(exportResult)
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

    expect(lastRawMutationSuccessMessage(exportResult)).toBe("跳过 1 项（导出失败 1）")
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
      expect(document.querySelector('[aria-label="展开 客户"]')).not.toBeNull()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("2026")
    })
  })

  it("ignores stale pending explicit tree load after moving a directory into its target", async () => {
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
    let moved = false
    let clientDirectoryRequestCount = 0
    let resolveStalePreload: ((result: SynapseKnowledgeBaseListRawDirectoryResult) => void) | null = null
    const stalePreload = new Promise<SynapseKnowledgeBaseListRawDirectoryResult>((resolve) => {
      resolveStalePreload = resolve
    })
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        clientDirectoryRequestCount += 1
        if (clientDirectoryRequestCount === 1) return stalePreload
        return {
          projectId: "project-1",
          directoryPath,
          entries: moved ? [{ ...rootDirectory, relativePath: "客户/2026" }] : [],
        }
      }
      if (directoryPath === "2026") {
        return { projectId: "project-1", directoryPath, entries: [] }
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: moved ? [targetDirectory] : [rootDirectory, targetDirectory],
      }
    })
    bridgeMocks.knowledgeBase.moveRawEntries.mockImplementation(async ({ relativePaths, targetDirectoryPath }) => {
      if (relativePaths.includes("2026") && targetDirectoryPath === "客户") {
        moved = true
      }
      return { projectId: "project-1", entries: [], skipped: [] }
    })

    renderWindow()
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="展开 客户"]')).not.toBeNull()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "directory"
      ))).toHaveLength(1)
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
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户"
      ))).toHaveLength(2)
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("2026")
    })

    await act(async () => {
      resolveStalePreload?.({
        projectId: "project-1",
        directoryPath: "客户",
        entries: [],
      })
      await stalePreload
    })

    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).toContain("2026")
    })
  })

  it("clears loading state when pruning a pending explicit tree load", async () => {
    const targetDirectory = {
      relativePath: "客户",
      name: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-22T11:03:00.000Z",
    }
    let resolveStalePreload: ((result: SynapseKnowledgeBaseListRawDirectoryResult) => void) | null = null
    const stalePreload = new Promise<SynapseKnowledgeBaseListRawDirectoryResult>((resolve) => {
      resolveStalePreload = resolve
    })
    let clientDirectoryRequestCount = 0
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        clientDirectoryRequestCount += 1
        if (clientDirectoryRequestCount === 1) return stalePreload
        return { projectId: "project-1", directoryPath, entries: [] }
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: [targetDirectory],
      }
    })

    renderWindow()
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="展开 客户"]')).not.toBeNull()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "directory"
      ))).toHaveLength(1)
    })

    await act(async () => {
      buttonByLabel("更多 客户").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    let renameItem: HTMLElement | undefined
    await waitForExpectation(() => {
      renameItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes("重命名"))
      expect(renameItem).toBeDefined()
    })
    await act(async () => {
      renameItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    const input = document.querySelector<HTMLInputElement>('input[placeholder="新名称"]')
    expect(input).not.toBeNull()
    act(() => {
      changeInput(input!, "客户")
    })
    await act(async () => {
      buttonByLabel("确认重命名").click()
      await Promise.resolve()
    })

    await act(async () => {
      resolveStalePreload?.({
        projectId: "project-1",
        directoryPath: "客户",
        entries: [],
      })
      await stalePreload
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户"
      ))).toHaveLength(1)
      expect(document.querySelector('[aria-label="文件夹树"]')?.textContent).not.toContain("读取中")
    })
  })

  it("does not report a stale explicit tree load failure after pruning it", async () => {
    const targetDirectory = {
      relativePath: "客户",
      name: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-22T11:03:00.000Z",
    }
    const stalePreload = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    let clientDirectoryRequestCount = 0
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        clientDirectoryRequestCount += 1
        if (clientDirectoryRequestCount === 1) return stalePreload.promise
        return { projectId: "project-1", directoryPath, entries: [] }
      }
      return {
        projectId: "project-1",
        directoryPath,
        entries: [targetDirectory],
      }
    })

    renderWindow()
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="展开 客户"]')).not.toBeNull()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory.mock.calls.filter(([payload]) => (
        payload.directoryPath === "客户" && payload.entryKind === "directory"
      ))).toHaveLength(1)
    })

    await act(async () => {
      buttonByLabel("更多 客户").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    let renameItem: HTMLElement | undefined
    await waitForExpectation(() => {
      renameItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes("重命名"))
      expect(renameItem).toBeDefined()
    })
    await act(async () => {
      renameItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    const input = document.querySelector<HTMLInputElement>('input[placeholder="新名称"]')
    expect(input).not.toBeNull()
    act(() => {
      changeInput(input!, "客户")
    })
    await act(async () => {
      buttonByLabel("确认重命名").click()
      await Promise.resolve()
    })

    await act(async () => {
      stalePreload.reject(new Error("stale preload failed"))
      try {
        await stalePreload.promise
      } catch {
        // Expected from the stale request.
      }
      await Promise.resolve()
    })

    expect(notifications.error).not.toHaveBeenCalledWith("读取资料失败")
    expect(rendererLogger.error).not.toHaveBeenCalledWith(
      "Failed to refresh knowledge base raw tree directories.",
      expect.anything(),
    )
  })

  it("does not report a stale failure from one explicit tree load while another path remains fresh", async () => {
    const clientDirectory = {
      relativePath: "客户",
      name: "客户",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-22T11:03:00.000Z",
    }
    const yearDirectory = {
      relativePath: "2026",
      name: "2026",
      kind: "directory" as const,
      size: null,
      modifiedAt: "2026-05-24T16:05:00.000Z",
    }
    const staleClientPreload = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    const freshYearPreload = createDeferred<SynapseKnowledgeBaseListRawDirectoryResult>()
    let clientDirectoryRequestCount = 0
    bridgeMocks.knowledgeBase.listRawDirectory.mockImplementation(async ({ directoryPath }) => {
      if (directoryPath === "客户") {
        clientDirectoryRequestCount += 1
        if (clientDirectoryRequestCount === 1) return staleClientPreload.promise
        return { projectId: "project-1", directoryPath, entries: [] }
      }
      if (directoryPath === "2026") return freshYearPreload.promise
      return {
        projectId: "project-1",
        directoryPath,
        entries: [clientDirectory, yearDirectory],
      }
    })

    renderWindow()
    await waitForExpectation(() => {
      expect(document.querySelector('[aria-label="展开 客户"]')).not.toBeNull()
      expect(document.querySelector('[aria-label="展开 2026"]')).not.toBeNull()
    })
    await act(async () => {
      buttonByLabel("展开 客户").click()
      buttonByLabel("展开 2026").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "project-1",
        directoryPath: "客户",
        entryKind: "directory",
      }))
      expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "project-1",
        directoryPath: "2026",
        entryKind: "directory",
      }))
    })

    await act(async () => {
      buttonByLabel("更多 客户").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    let renameItem: HTMLElement | undefined
    await waitForExpectation(() => {
      renameItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes("重命名"))
      expect(renameItem).toBeDefined()
    })
    await act(async () => {
      renameItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    const input = document.querySelector<HTMLInputElement>('input[placeholder="新名称"]')
    expect(input).not.toBeNull()
    act(() => {
      changeInput(input!, "客户")
    })
    await act(async () => {
      buttonByLabel("确认重命名").click()
      await Promise.resolve()
    })

    await act(async () => {
      staleClientPreload.reject(new Error("stale client preload failed"))
      try {
        await staleClientPreload.promise
      } catch {
        // Expected from the stale request.
      }
      freshYearPreload.resolve({
        projectId: "project-1",
        directoryPath: "2026",
        entries: [],
      })
      await freshYearPreload.promise
      await Promise.resolve()
    })

    expect(notifications.error).not.toHaveBeenCalledWith("读取资料失败")
    expect(rendererLogger.error).not.toHaveBeenCalledWith(
      "Failed to refresh knowledge base raw tree directories.",
      expect.anything(),
    )
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
