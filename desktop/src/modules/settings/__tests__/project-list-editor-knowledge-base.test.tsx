/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectListEditor } from "../components/project-list-editor"
import type { ProjectAddInput, ProjectAddResult } from "@/app-shell/use-project-actions"
import type { SynapseProjectConfig } from "@/types/config"
import type {
  SynapseKnowledgeBaseCreateManagedPayload,
  SynapseKnowledgeBaseCreateManagedResult,
  SynapseKnowledgeBaseDeleteManagedPayload,
  SynapseKnowledgeBaseDeleteManagedResult,
  SynapseKnowledgeBaseExportManagedPayload,
  SynapseKnowledgeBaseExportManagedResult,
  SynapseKnowledgeBaseImportManagedPayload,
  SynapseKnowledgeBaseImportManagedResult,
  SynapseKnowledgeBaseImportPreview,
  SynapseKnowledgeBaseTransferProgress,
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

const standardProject: SynapseProjectConfig = {
  id: "project-standard",
  name: "Synapse",
  path: "/Users/example/projects/synapse",
}

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn() }))

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
  toast.success.mockClear()
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
  const idleTransferState: SynapseKnowledgeBaseTransferProgress = {
    active: false,
    operation: "idle",
    phase: "idle",
    cancellable: false,
    copiedBytes: 0,
    totalBytes: null,
    message: "",
  }
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
      selectImportFolder: vi.fn<() => Promise<SynapseKnowledgeBaseImportPreview | null>>().mockResolvedValue({
        token: "preview-token",
        folderName: "6d525be2-2488-485f-8890-d5f497de5be7",
        suggestedName: "恢复的知识库",
        fileCount: 24,
        totalBytes: 4096,
        warnings: ["legacy-export-metadata-missing"],
      }),
      importManagedFolder: vi.fn<(payload: SynapseKnowledgeBaseImportManagedPayload) => Promise<SynapseKnowledgeBaseImportManagedResult>>().mockResolvedValue({
        project: {
          id: "imported-project-id",
          name: "恢复的知识库",
          path: "synapse-kb://imported-project-id",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "legacy-import",
              managed: true,
              runtimeId: "imported-project-id",
            },
          },
        },
      }),
      exportManagedFolder: vi.fn<(payload: SynapseKnowledgeBaseExportManagedPayload) => Promise<SynapseKnowledgeBaseExportManagedResult | null>>().mockResolvedValue({
        projectId: "project-1",
        folderPath: "/Users/example/export/Knowledge",
      }),
      getTransferState: vi.fn<() => Promise<SynapseKnowledgeBaseTransferProgress>>().mockResolvedValue(idleTransferState),
      cancelTransfer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onTransferChanged: vi.fn<(listener: (progress: SynapseKnowledgeBaseTransferProgress) => void) => () => void>().mockReturnValue(() => undefined),
    },
    agent: {
      listSessions: vi.fn<(projectId: string) => Promise<unknown[]>>().mockResolvedValue([]),
    },
  }
}

function renderEditor(
  projects: SynapseProjectConfig[],
  onSave = vi.fn().mockResolvedValue(undefined),
  onAddProject = vi.fn(async (input: ProjectAddInput): Promise<ProjectAddResult> => ({
    status: "added",
    project: { id: "new-project-id", ...input },
  })),
  onRefresh = vi.fn().mockResolvedValue(undefined),
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <ProjectListEditor
        projects={projects}
        onSave={onSave}
        onAddProject={onAddProject}
        onRefresh={onRefresh}
      />,
    )
  })
  return { onAddProject, onRefresh, onSave }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function openNewKnowledgeBaseDialog(): Promise<void> {
  await openKnowledgeBaseMenuItem("新建知识库")
}

async function openKnowledgeBaseMenuItem(label: string): Promise<void> {
  await act(async () => {
    buttonByText("知识库").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
  const menuItem = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
    .find((item) => item.textContent === label)
  if (!menuItem) throw new Error(`Menu item not found: ${label}`)
  await act(async () => {
    menuItem.click()
    await Promise.resolve()
  })
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
    expect(buttonByText("知识库")).toBeTruthy()
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

  it("reports only the missing project name when the existing path is valid", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([standardProject], onSave)

    await act(async () => {
      buttonByText("修改").click()
      await Promise.resolve()
    })
    await act(async () => {
      changeInput(inputByLabel("项目名称"), "")
      buttonByText("保存").click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("项目名称不能为空。")
    expect(document.body.textContent).not.toContain("项目名称和项目路径都不能为空。")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("returns focus to the edited project action after Escape", async () => {
    renderEditor([standardProject])
    const editButton = buttonByText("修改")

    await act(async () => {
      editButton.click()
      await Promise.resolve()
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.activeElement).toBe(editButton)
    })
  })

  it("returns focus to the project delete action after cancelling with Escape", async () => {
    bridgeMocks.agent.listSessions.mockResolvedValueOnce([{}])
    renderEditor([standardProject])
    const deleteButton = buttonByText("删除")

    await act(async () => {
      deleteButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.activeElement).toBe(deleteButton)
    })
  })

  it("adds a regular project through the shared project dialog", async () => {
    const onAddProject = vi.fn(async (input: ProjectAddInput): Promise<ProjectAddResult> => ({
      status: "added",
      project: { id: "new-project-id", ...input },
    }))
    renderEditor([], undefined, onAddProject)

    await act(async () => {
      buttonByText("添加项目").click()
    })
    await act(async () => {
      buttonByText("浏览").click()
      await Promise.resolve()
    })

    expect(inputByLabel("项目名称").value).toBe("new-kb")
    expect(inputByLabel("项目路径").value).toBe("/Users/example/new-kb")

    await act(async () => {
      buttonByText("添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onAddProject).toHaveBeenCalledWith({
      name: "new-kb",
      path: "/Users/example/new-kb",
    })
    expect(toast.success).toHaveBeenCalledWith("项目已添加。")
  })

  it("focuses the first missing regular project field after validation fails", async () => {
    const onAddProject = vi.fn()
    renderEditor([], undefined, onAddProject)

    await act(async () => {
      buttonByText("添加项目").click()
      await Promise.resolve()
    })
    await act(async () => {
      changeInput(inputByLabel("项目路径"), "/Users/example/new-project")
      const addButton = buttonByText("添加")
      addButton.focus()
      addButton.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("项目名称和项目路径都不能为空。")
    expect(document.activeElement).toBe(inputByLabel("项目名称"))
    expect(onAddProject).not.toHaveBeenCalled()
  })

  it("keeps the shared project dialog open when the path becomes a duplicate", async () => {
    const existingProject = { id: "project-existing", name: "Existing", path: "/Users/example/existing" }
    const onAddProject = vi.fn(async (): Promise<ProjectAddResult> => ({
      status: "existing",
      project: existingProject,
    }))
    renderEditor([existingProject], undefined, onAddProject)

    await act(async () => {
      buttonByText("添加项目").click()
    })
    await act(async () => {
      changeInput(inputByLabel("项目名称"), "Duplicate")
      changeInput(inputByLabel("项目路径"), "/Users/example/existing")
      buttonByText("添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("这个项目路径已经存在了。")
    expect(inputByLabel("项目路径").value).toBe("/Users/example/existing")
    expect(document.activeElement).toBe(inputByLabel("项目路径"))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("keeps the shared project dialog open and focuses the name when it is a duplicate", async () => {
    const onAddProject = vi.fn().mockRejectedValue(new Error("这个项目名称已经存在了。"))
    renderEditor([standardProject], undefined, onAddProject)

    await act(async () => {
      buttonByText("添加项目").click()
      await Promise.resolve()
    })
    await act(async () => {
      changeInput(inputByLabel("项目名称"), standardProject.name)
      changeInput(inputByLabel("项目路径"), "/Users/example/projects/other")
      const addButton = buttonByText("添加")
      addButton.focus()
      addButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("这个项目名称已经存在了。")
    expect(document.activeElement).toBe(inputByLabel("项目名称"))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("prevents duplicate shared project submissions while a save is pending", async () => {
    const pendingAdd = deferred<ProjectAddResult>()
    const onAddProject = vi.fn(() => pendingAdd.promise)
    renderEditor([], undefined, onAddProject)

    await act(async () => {
      buttonByText("添加项目").click()
    })
    await act(async () => {
      changeInput(inputByLabel("项目名称"), "Docs")
      changeInput(inputByLabel("项目路径"), "/Users/example/docs")
    })
    const addButton = buttonByText("添加")

    await act(async () => {
      addButton.click()
      addButton.click()
      await Promise.resolve()
    })

    expect(onAddProject).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("添加中...")

    await act(async () => {
      pendingAdd.resolve({
        status: "added",
        project: { id: "project-new", name: "Docs", path: "/Users/example/docs" },
      })
      await pendingAdd.promise
      await Promise.resolve()
    })
  })

  it("shows shared project save failures without closing the dialog", async () => {
    const onAddProject = vi.fn().mockRejectedValue(new Error("保存项目列表失败，请重试。"))
    renderEditor([], undefined, onAddProject)

    await act(async () => {
      buttonByText("添加项目").click()
    })
    await act(async () => {
      changeInput(inputByLabel("项目名称"), "Docs")
      changeInput(inputByLabel("项目路径"), "/Users/example/docs")
    })

    await act(async () => {
      buttonByText("添加").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("保存项目列表失败，请重试。")
    expect(inputByLabel("项目名称").value).toBe("Docs")
    expect(toast.success).not.toHaveBeenCalled()
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

  it("opens create and import in separate dialogs without sharing state", async () => {
    renderEditor([])

    await openKnowledgeBaseMenuItem("导入知识库")
    expect(document.body.textContent).toContain("选择并校验知识库文件夹。")
    expect(document.body.textContent).not.toContain("输入知识库名称。")

    await act(async () => {
      buttonByText("取消").click()
      await Promise.resolve()
    })
    await openNewKnowledgeBaseDialog()

    expect(document.body.textContent).toContain("输入知识库名称。")
    expect(document.body.textContent).not.toContain("未找到导出信息")
  })

  it("imports a validated legacy knowledge base with a trusted-source confirmation", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderEditor([], undefined, undefined, onRefresh)

    await openKnowledgeBaseMenuItem("导入知识库")
    await act(async () => {
      buttonByText("选择文件夹").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(inputByLabel("知识库名称").value).toBe("恢复的知识库")
    expect(document.body.textContent).toContain("24 个文件")
    expect(document.body.textContent).toContain("未找到导出信息，将按旧版知识库恢复。")

    const trustedCheckbox = document.getElementById("knowledge-base-import-trusted")
    if (!(trustedCheckbox instanceof HTMLButtonElement)) throw new Error("Trusted-source checkbox not found")
    await act(async () => {
      trustedCheckbox.click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("导入知识库").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.importManagedFolder).toHaveBeenCalledWith({
        token: "preview-token",
        name: "恢复的知识库",
        trusted: true,
      })
      expect(onRefresh).toHaveBeenCalledTimes(1)
      expect(toast).toHaveBeenCalledWith("已复制到 Synapse 知识库存储。原文件夹可自行保留或删除。")
    })
  })

  it("exports a single managed knowledge base", async () => {
    renderEditor([kbProject])

    await act(async () => {
      buttonByText("导出").click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(bridgeMocks.knowledgeBase.exportManagedFolder).toHaveBeenCalledWith({ projectId: "project-1" })
      expect(toast).toHaveBeenCalledWith("知识库已导出。")
    })
  })

  it("creates a managed knowledge base project with name only", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([], onSave)

    await openNewKnowledgeBaseDialog()
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

    await openNewKnowledgeBaseDialog()
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

    await openNewKnowledgeBaseDialog()
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

    await openNewKnowledgeBaseDialog()
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

    await openNewKnowledgeBaseDialog()
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

    await openNewKnowledgeBaseDialog()
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
    await openNewKnowledgeBaseDialog()

    expect(inputByLabel("知识库名称").value).toBe("")
    expect(document.body.textContent).not.toContain("知识库名称不能为空。")
  })

  it("keeps the new knowledge base dialog open while creation is pending", async () => {
    const pendingCreate = deferred<SynapseKnowledgeBaseCreateManagedResult>()
    bridgeMocks.knowledgeBase.createManaged.mockReturnValueOnce(pendingCreate.promise)
    renderEditor([])

    await openNewKnowledgeBaseDialog()
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
