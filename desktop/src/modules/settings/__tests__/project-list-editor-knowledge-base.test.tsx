/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectListEditor } from "../components/project-list-editor"
import type { SynapseProjectConfig } from "@/types/config"

const kbProject: SynapseProjectConfig = {
  id: "project-1",
  name: "Knowledge",
  path: "/Users/example/kb",
  capabilities: {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion: "2026-05-21",
    },
  },
}

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: vi.fn(() => "new-project-id"),
  })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      repository: {
        chooseDirectory: vi.fn().mockResolvedValue("/Users/example/new-kb"),
      },
      knowledgeBase: {
        inspect: vi.fn().mockResolvedValue({
          projectPath: "/Users/example/new-kb",
          isKnowledgeBase: true,
          hasMetadata: true,
          hasRequiredShape: true,
          missingRequiredPaths: [],
          templateVersion: "2026-05-21",
        }),
        initialize: vi.fn().mockResolvedValue({
          projectPath: "/Users/example/new-kb",
          templateVersion: "2026-05-21",
          createdFiles: [],
          existingFiles: [],
        }),
        openRawDirectory: vi.fn().mockResolvedValue({ rawPath: "/Users/example/kb/.raw" }),
      },
      agent: {
        listSessions: vi.fn().mockResolvedValue([]),
      },
    },
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

describe("ProjectListEditor knowledge base actions", () => {
  it("shows a knowledge base badge and maintenance action for knowledge base projects", async () => {
    renderEditor([kbProject])

    expect(document.body.textContent).toContain("知识库")
    await act(async () => {
      buttonByText("维护文件").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(window.synapse?.knowledgeBase.openRawDirectory).toHaveBeenCalledWith("/Users/example/kb")
    })
  })

  it("creates a knowledge base project from the add dialog", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      changeInput(inputByLabel("项目名称"), "Knowledge")
    })
    await act(async () => {
      buttonByText("浏览").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => expect(inputByLabel("项目路径").value).toBe("/Users/example/new-kb"))
    await act(async () => {
      buttonByText("创建").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(window.synapse?.knowledgeBase.initialize).toHaveBeenCalledWith({
        projectPath: "/Users/example/new-kb",
        mode: "create",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "Knowledge",
          path: "/Users/example/new-kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }),
      ])
    })
  })

  it("marks an existing project as a knowledge base", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([{ id: "project-1", name: "Plain", path: "/Users/example/plain" }], onSave)

    await act(async () => {
      buttonByText("设为知识库").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(window.synapse?.knowledgeBase.initialize).toHaveBeenCalledWith({
        projectPath: "/Users/example/plain",
        mode: "repair",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "project-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }),
      ])
    })
  })

  it("opens an existing knowledge base folder as a project", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("打开知识库").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(window.synapse?.repository.chooseDirectory).toHaveBeenCalled()
      expect(window.synapse?.knowledgeBase.inspect).toHaveBeenCalledWith("/Users/example/new-kb")
      expect(window.synapse?.knowledgeBase.initialize).toHaveBeenCalledWith({
        projectPath: "/Users/example/new-kb",
        mode: "repair",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "new-kb",
          path: "/Users/example/new-kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }),
      ])
    })
  })

  it("shows a visible error when the selected folder is not a knowledge base", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    window.synapse?.knowledgeBase.inspect.mockResolvedValue({
      projectPath: "/Users/example/new-kb",
      isKnowledgeBase: false,
      hasMetadata: false,
      hasRequiredShape: false,
      missingRequiredPaths: [".raw"],
      templateVersion: null,
    })
    renderEditor([], onSave)

    await act(async () => {
      buttonByText("打开知识库").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("未识别为知识库目录。")
      expect(window.synapse?.knowledgeBase.initialize).not.toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()
    })
  })

  it("shows a visible error and re-enables the action when marking a project fails", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    window.synapse?.knowledgeBase.initialize.mockRejectedValue(new Error("secret failure detail"))
    renderEditor([{ id: "project-1", name: "Plain", path: "/Users/example/plain" }], onSave)

    await act(async () => {
      buttonByText("设为知识库").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("设置知识库失败。")
      expect(buttonByText("设为知识库").disabled).toBe(false)
      expect(onSave).not.toHaveBeenCalled()
      expect(rendererLogger.error).toHaveBeenCalledWith("Failed to mark project as knowledge base.", {
        error: expect.any(Error),
        projectId: "project-1",
      })
    })
  })

  it("clears stale knowledge base dialog fields and errors after closing", async () => {
    renderEditor([])

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      buttonByText("浏览").click()
      await Promise.resolve()
    })
    await waitForExpectation(() => expect(inputByLabel("项目路径").value).toBe("/Users/example/new-kb"))
    await act(async () => {
      changeInput(inputByLabel("项目名称"), "")
    })
    await act(async () => {
      buttonByText("创建").click()
    })
    expect(document.body.textContent).toContain("项目名称和项目路径都不能为空。")

    await act(async () => {
      buttonByText("取消").click()
    })
    await act(async () => {
      buttonByText("新建知识库").click()
    })

    expect(inputByLabel("项目名称").value).toBe("")
    expect(inputByLabel("项目路径").value).toBe("")
    expect(document.body.textContent).not.toContain("项目名称和项目路径都不能为空。")
  })

  it("shows a dialog error when choosing a knowledge base path fails", async () => {
    window.synapse?.repository.chooseDirectory.mockRejectedValue(new Error("picker failed"))
    renderEditor([])

    await act(async () => {
      buttonByText("新建知识库").click()
    })
    await act(async () => {
      buttonByText("浏览").click()
      await Promise.resolve()
    })

    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("选择目录失败。")
      expect(rendererLogger.error).toHaveBeenCalledWith("Failed to select knowledge base directory.", {
        error: expect.any(Error),
      })
    })
  })
})
