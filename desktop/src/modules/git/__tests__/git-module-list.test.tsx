/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GitModule } from "../index"

const bridge = vi.hoisted(() => ({
  git: {
    checkEnvironment: vi.fn(),
    listRepositories: vi.fn(),
    addLocalRepository: vi.fn(),
    cloneRepository: vi.fn(),
    removeRepository: vi.fn(),
    getSnapshot: vi.fn(),
    sync: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
  },
  repository: {
    chooseDirectory: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => bridge,
  requireSynapseBridge: () => bridge,
}))

describe("GitModule repository list", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    bridge.git.checkEnvironment.mockResolvedValue({
      gitAvailable: true,
      gitVersion: "git version 2.50.0",
      gitPath: null,
      sshAvailable: true,
      userName: "Writer",
      userEmail: "writer@example.com",
      commonSshKeyExists: true,
      installHint: null,
    })
    bridge.git.listRepositories.mockResolvedValue([])
    bridge.repository.chooseDirectory.mockResolvedValue(null)
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("shows only the empty state title when no repositories exist", async () => {
    await renderGitModule(roots)

    expect(document.body.textContent).toContain("暂无仓库")
    expect(countButtons("克隆仓库")).toBeGreaterThan(0)
    expect(countButtons("添加本地仓库")).toBeGreaterThan(0)
  })

  it("uses the system app window toolbar for repository actions", async () => {
    await renderGitModule(roots)

    const toolbar = document.querySelector("[data-system-app-window-toolbar]")
    expect(toolbar).toBeTruthy()
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-window-left-spacer]")).toBeTruthy()
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("仓库")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("添加本地仓库")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("克隆仓库")
  })

  it("opens clone dialog and submits clone request", async () => {
    bridge.git.cloneRepository.mockResolvedValue({
      repository: { id: "repo-1", name: "docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      remoteKind: "https",
    })
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.example.com/team/docs.git")
    await changeInput("保存到", "/work/docs")
    await click(findButton("开始克隆"))

    expect(bridge.git.cloneRepository).toHaveBeenCalledWith({
      remoteUrl: "https://git.example.com/team/docs.git",
      targetPath: "/work/docs",
      name: "docs",
    })
  })

  it("uses native folder selection for clone target path", async () => {
    bridge.repository.chooseDirectory.mockResolvedValue("/work/docs")
    bridge.git.cloneRepository.mockResolvedValue({
      repository: { id: "repo-1", name: "docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      remoteKind: "https",
    })
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.example.com/team/docs.git")
    await click(findButton("选择文件夹"))
    await click(findButton("开始克隆"))

    expect(bridge.repository.chooseDirectory).toHaveBeenCalled()
    expect(bridge.git.cloneRepository).toHaveBeenCalledWith({
      remoteUrl: "https://git.example.com/team/docs.git",
      targetPath: "/work/docs",
      name: "docs",
    })
  })

  it("uses native folder selection and folder name for local repositories", async () => {
    bridge.repository.chooseDirectory.mockResolvedValue("/work/team-rules")
    bridge.git.addLocalRepository.mockResolvedValue({
      id: "repo-1",
      name: "team-rules",
      localPath: "/work/team-rules",
      addedAt: "now",
      lastOpenedAt: null,
    })
    await renderGitModule(roots)

    await click(findButton("添加本地仓库"))
    await click(findButton("选择文件夹"))
    expect(inputByLabel("仓库名称").value).toBe("team-rules")

    await click(findButton("添加"))

    expect(bridge.repository.chooseDirectory).toHaveBeenCalled()
    expect(bridge.git.addLocalRepository).toHaveBeenCalledWith({
      localPath: "/work/team-rules",
      name: "team-rules",
    })
  })

  it("keeps repository sync loading scoped to the clicked repository", async () => {
    const sync = deferred<void>()
    bridge.git.listRepositories.mockResolvedValue([
      { id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      { id: "repo-2", name: "App", localPath: "/work/app", addedAt: "now", lastOpenedAt: null },
    ])
    bridge.git.sync.mockReturnValue(sync.promise)
    await renderGitModule(roots)

    const syncButtons = buttonsByLabel("同步")
    expect(syncButtons).toHaveLength(2)

    await click(syncButtons[0])

    expect(bridge.git.sync).toHaveBeenCalledWith("repo-1")
    expect(syncButtons[0].disabled).toBe(true)
    expect(syncButtons[0].querySelector(".animate-spin")).not.toBeNull()
    expect(syncButtons[1].disabled).toBe(false)
    expect(syncButtons[1].querySelector(".animate-spin")).toBeNull()

    sync.resolve()
    await flush()
  })

  it("removes repository records without trashing local files by default", async () => {
    bridge.git.listRepositories
      .mockResolvedValueOnce([
        { id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
      ])
      .mockResolvedValueOnce([])
    bridge.git.removeRepository.mockResolvedValue(undefined)
    await renderGitModule(roots)

    await click(findButton("删除"))
    expect(document.body.textContent).toContain("删除 Git 仓库？")
    expect(document.body.textContent).toContain("仅移除列表记录")

    await click(findButton("删除记录"))

    expect(bridge.git.removeRepository).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      mode: "keep-local",
    })
    expect(bridge.git.listRepositories).toHaveBeenCalledTimes(2)
  })

  it("trashes local files when selected and keeps the dialog open on failure", async () => {
    bridge.git.listRepositories.mockResolvedValue([
      { id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null },
    ])
    bridge.git.removeRepository.mockRejectedValue(new Error("移到废纸篓失败"))
    await renderGitModule(roots)

    await click(findButton("删除"))
    await click(labelByText("移到废纸篓并移除记录"))
    expect(document.body.textContent).toContain("/work/docs")

    const confirmButton = findButton("移到废纸篓")
    await click(confirmButton)

    expect(bridge.git.removeRepository).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      mode: "trash-local",
    })
    expect(document.body.textContent).toContain("移到废纸篓失败")
    expect(document.body.textContent).toContain("删除 Git 仓库？")
  })
})

async function renderGitModule(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<GitModule />)
    await flush()
  })
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
    await flush()
  })
}

async function changeInput(label: string, value: string): Promise<void> {
  const input = inputByLabel(label)
  await act(async () => {
    setNativeInputValue(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}

function findButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"))
  const button = buttons.find((item) => item.textContent === label)
    ?? buttons.find((item) => item.textContent?.includes(label))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function countButtons(label: string): number {
  return buttonsByLabel(label).length
}

function buttonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && Boolean(item.textContent?.includes(label)))
}

function inputByLabel(label: string): HTMLInputElement {
  const labelElement = Array.from(document.querySelectorAll("label"))
    .find((item) => item.textContent === label)
  const id = labelElement?.getAttribute("for")
  const input = id ? document.getElementById(id) : null
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Input not found: ${label}`)
  }
  return input
}

function labelByText(text: string): HTMLLabelElement {
  const labelElement = Array.from(document.querySelectorAll("label"))
    .find((item) => item.textContent?.includes(text))
  if (!(labelElement instanceof HTMLLabelElement)) {
    throw new Error(`Label not found: ${text}`)
  }
  return labelElement
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
  descriptor?.set?.call(input, value)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
