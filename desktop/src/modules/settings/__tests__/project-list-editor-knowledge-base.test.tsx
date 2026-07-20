/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectListEditor } from "../components/project-list-editor"
import type { SynapseProjectConfig } from "@/types/config"
import type {
  SynapseKnowledgeBaseCreateManagedPayload,
  SynapseKnowledgeBaseCreateManagedResult,
  SynapseKnowledgeBaseDeleteManagedPayload,
  SynapseKnowledgeBaseDeleteManagedResult,
} from "@/types/knowledge-base"

const kbProject: SynapseProjectConfig = {
  id: "project-1",
  name: "Knowledge",
  path: "synapse-kb://project-1",
  capabilities: {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion: "2026-05-24",
      managed: true,
      runtimeId: "project-1",
    },
  },
}

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

const toast = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("sonner", () => ({
  toast,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let bridgeMocks: ReturnType<typeof createSynapseBridgeMocks>

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  toast.mockClear()
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: vi.fn(() => "new-project-id"),
  })
  bridgeMocks = createSynapseBridgeMocks()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: bridgeMocks,
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function createSynapseBridgeMocks() {
  return {
    settings: {
      repository: {
        chooseDirectory: vi.fn<() => Promise<string | null>>().mockResolvedValue("/Users/example/new-kb"),
      },
    },
    knowledgeBase: {
      createManaged: vi.fn<(payload: SynapseKnowledgeBaseCreateManagedPayload) => Promise<SynapseKnowledgeBaseCreateManagedResult>>().mockResolvedValue({
        projectId: "new-project-id",
        projectPath: "synapse-kb://new-project-id",
        templateVersion: "2026-05-24",
      }),
      deleteManaged: vi.fn<(payload: SynapseKnowledgeBaseDeleteManagedPayload) => Promise<SynapseKnowledgeBaseDeleteManagedResult>>().mockResolvedValue({
        projectId: "project-1",
        deleted: true,
      }),
      openSourceManager: vi.fn<(payload: { projectId: string; projectName: string }) => Promise<void>>().mockResolvedValue(undefined),
    },
    agent: {
      listSessions: vi.fn<(projectId: string) => Promise<unknown[]>>().mockResolvedValue([]),
    },
  }
}

function renderEditor(projects: SynapseProjectConfig[], onSave = vi.fn().mockResolvedValue(undefined)) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<ProjectListEditor projects={projects} onSave={onSave} />)
  })
  return { onSave }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function inputByLabel(labelText: string): HTMLInputElement {
  const label = [...document.querySelectorAll("label")]
    .find((item) => item.textContent === labelText)
  if (!label?.htmlFor) throw new Error(`Label not found: ${labelText}`)
  const input = document.getElementById(label.htmlFor)
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${labelText}`)
  return input
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

describe("ProjectListEditor knowledge base actions", () => {
  it("shows an empty state inside the project section", () => {
    renderEditor([])

    expect(document.body.textContent).toContain("项目和知识库")
    expect(document.body.textContent).toContain("暂无项目")
    expect(buttonByText("新建知识库")).toBeTruthy()
    expect(buttonByText("添加项目")).toBeTruthy()
  })

  it("renders projects in an aligned table layout", () => {
    renderEditor([
      kbProject,
      {
        id: "project-2",
        name: "App",
        path: "/Users/example/projects/app",
      },
    ])

    expect(document.querySelector("table")).toBeTruthy()
    expect(document.body.textContent).toContain("名称")
    expect(document.body.textContent).toContain("位置")
    expect(document.body.textContent).toContain("/Users/example/projects/app")
    expect(document.body.textContent).not.toContain("synapse-kb://project-1")
  })

  it("shows a knowledge base badge and source manager action for knowledge base projects", async () => {
    renderEditor([kbProject])

    expect(document.body.textContent).toContain("知识库")
    expect(document.body.textContent).not.toContain("synapse-kb://project-1")
    await act(async () => {
      buttonByText("资料管理").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.openSourceManager).toHaveBeenCalledWith({
        projectId: "project-1",
        projectName: "Knowledge",
      })
    })
  })

  it("shows feedback when opening knowledge base source manager fails", async () => {
    bridgeMocks.knowledgeBase.openSourceManager.mockRejectedValueOnce(new Error("open failed"))
    renderEditor([kbProject])

    await act(async () => {
      buttonByText("资料管理").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(rendererLogger.error).toHaveBeenCalledWith("Failed to open knowledge base source manager.", {
        projectId: "project-1",
        error: expect.any(Error),
      })
      expect(toast).toHaveBeenCalledWith("打开资料管理失败")
    })
  })

  it("creates a managed knowledge base project with name only", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    expect(document.body.textContent).not.toContain("项目路径")
    expect(document.body.textContent).not.toContain("浏览")
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "Knowledge")
    })
    await act(async () => {
      buttonByText("创建").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.createManaged).toHaveBeenCalledWith({
        projectId: "new-project-id",
        name: "Knowledge",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "new-project-id",
          name: "Knowledge",
          path: "synapse-kb://new-project-id",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId: "new-project-id",
            },
          },
        }),
      ])
    })
  })

  it("ignores duplicate knowledge base create clicks while the first create is pending", async () => {
    const pendingCreate = deferred<SynapseKnowledgeBaseCreateManagedResult>()
    const onSave = vi.fn().mockResolvedValue(undefined)
    bridgeMocks.knowledgeBase.createManaged.mockReturnValue(pendingCreate.promise)
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "Knowledge")
    })

    await act(async () => {
      const createButton = buttonByText("创建")
      createButton.click()
      createButton.click()
      await Promise.resolve()
    })

    expect(bridgeMocks.knowledgeBase.createManaged).toHaveBeenCalledTimes(1)
    expect(bridgeMocks.knowledgeBase.createManaged).toHaveBeenCalledWith({
      projectId: "new-project-id",
      name: "Knowledge",
    })

    await act(async () => {
      pendingCreate.resolve({
        projectId: "new-project-id",
        projectPath: "synapse-kb://new-project-id",
        templateVersion: "2026-05-24",
      })
      await pendingCreate.promise
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("does not show raw filesystem errors when creating a knowledge base fails", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    bridgeMocks.knowledgeBase.createManaged.mockRejectedValueOnce(new Error("EACCES: permission denied, mkdir '/Users/test/secret-path'"))
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "Knowledge")
    })
    await act(async () => {
      buttonByText("创建").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("创建知识库失败。")
    expect(document.body.textContent).not.toContain("secret-path")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("shows safe storage recovery errors when creating a knowledge base fails", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    bridgeMocks.knowledgeBase.createManaged.mockRejectedValueOnce(new Error("知识库存储位置不可用。请在设置中重新检测。"))
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "Knowledge")
    })
    await act(async () => {
      buttonByText("创建").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("知识库存储位置不可用。请在设置中重新检测。")
    expect(document.body.textContent).not.toContain("创建知识库失败。")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("cleans up managed knowledge base runtime when project save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("config save failed"))
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "Knowledge")
    })
    await act(async () => {
      buttonByText("创建").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.createManaged).toHaveBeenCalledWith({
        projectId: "new-project-id",
        name: "Knowledge",
      })
      expect(bridgeMocks.knowledgeBase.deleteManaged).toHaveBeenCalledWith({
        projectId: "new-project-id",
        runtimeId: "new-project-id",
      })
    })
    expect(document.body.textContent).toContain("创建知识库失败。")
  })

  it("removes managed knowledge base project before deleting its runtime", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([kbProject], onSave)

    await act(async () => {
      buttonByText("删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("确认删除「Knowledge」？")
    expect(document.body.textContent).toContain("会同时删除该知识库的托管数据。")
    expect(onSave).not.toHaveBeenCalled()
    expect(bridgeMocks.knowledgeBase.deleteManaged).not.toHaveBeenCalled()

    await act(async () => {
      buttonByText("删除项目").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(onSave).toHaveBeenCalledWith([])
      expect(bridgeMocks.knowledgeBase.deleteManaged).toHaveBeenCalledWith({
        projectId: "project-1",
        runtimeId: "project-1",
      })
      expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
        bridgeMocks.knowledgeBase.deleteManaged.mock.invocationCallOrder[0],
      )
    })
  })

  it("keeps managed knowledge base project when runtime deletion fails", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    bridgeMocks.knowledgeBase.deleteManaged.mockRejectedValueOnce(new Error("trash failed"))
    renderEditor([kbProject], onSave)

    await act(async () => {
      buttonByText("删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("删除项目").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.deleteManaged).toHaveBeenCalledWith({
        projectId: "project-1",
        runtimeId: "project-1",
      })
      expect(rendererLogger.error).toHaveBeenCalledWith("Failed to remove project.", {
        projectId: "project-1",
        error: expect.any(Error),
      })
      expect(toast).toHaveBeenCalledWith("删除项目失败。")
    })
    expect(onSave).toHaveBeenNthCalledWith(1, [])
    expect(onSave).toHaveBeenNthCalledWith(2, [kbProject])
  })

  it("does not delete managed knowledge base runtime when project removal save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("config save failed"))
    renderEditor([kbProject], onSave)

    await act(async () => {
      buttonByText("删除").click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("删除项目").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(onSave).toHaveBeenCalledWith([])
      expect(rendererLogger.error).toHaveBeenCalledWith("Failed to remove project.", {
        projectId: "project-1",
        error: expect.any(Error),
      })
      expect(toast).toHaveBeenCalledWith("删除项目失败。")
    })
    expect(bridgeMocks.knowledgeBase.deleteManaged).not.toHaveBeenCalled()
  })

  it("clears stale knowledge base dialog fields and errors after closing", async () => {
    renderEditor([])

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "")
    })
    await act(async () => {
      buttonByText("创建").click()
    })
    expect(document.body.textContent).toContain("知识库名称不能为空。")

    await act(async () => {
      buttonByText("取消").click()
    })
    await act(async () => {
      buttonByText("新建知识库").click()
    })

    expect(inputByLabel("知识库名称").value).toBe("")
    expect(document.body.textContent).not.toContain("知识库名称不能为空。")
  })

  it("keeps the new knowledge base dialog open while creation is pending", async () => {
    const pendingCreate = deferred<SynapseKnowledgeBaseCreateManagedResult>()
    bridgeMocks.knowledgeBase.createManaged.mockReturnValueOnce(pendingCreate.promise)
    renderEditor([])

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("知识库名称"), "Knowledge")
    })

    await act(async () => {
      buttonByText("创建").click()
      await Promise.resolve()
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
    })

    expect(inputByLabel("知识库名称").value).toBe("Knowledge")

    await act(async () => {
      pendingCreate.resolve({
        projectId: "new-project-id",
        projectPath: "synapse-kb://new-project-id",
        templateVersion: "2026-05-24",
      })
      await pendingCreate.promise
    })
  })
})
