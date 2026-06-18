/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GitModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bridge = vi.hoisted(() => ({
  git: {
    checkEnvironment: vi.fn(),
    configureIdentity: vi.fn(),
    getSshPublicKey: vi.fn(),
    listRepositories: vi.fn(),
    listRepositorySummaries: vi.fn(),
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

type Repository = {
  readonly id: string
  readonly name: string
  readonly localPath: string
  readonly addedAt: string
  readonly lastOpenedAt: string | null
}

type RepositorySnapshot = {
  readonly repositoryId: string
  readonly pathExists: boolean
  readonly isGitRepository: boolean
  readonly currentBranch: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly hasConflicts: boolean
  readonly changes: readonly {
    readonly path: string
    readonly originalPath: string | null
    readonly status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted" | "unknown"
    readonly staged: boolean
    readonly conflicted: boolean
  }[]
}

function summary(
  repository: Repository,
  snapshot: Partial<RepositorySnapshot> = {},
) {
  return {
    repository,
    snapshot: {
      repositoryId: repository.id,
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      hasConflicts: false,
      changes: [],
      ...snapshot,
    },
    error: null,
  }
}

function gitEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: "2026-06-18T10:00:00.000Z",
    platform: "darwin",
    homeDir: "/Users/writer",
    gitAvailable: true,
    gitVersion: "git version 2.50.0",
    gitPath: "/usr/bin/git",
    processPath: "/usr/bin",
    shellPath: "/opt/homebrew/bin:/usr/bin",
    effectivePath: "/usr/bin:/opt/homebrew/bin",
    processGitPath: "/usr/bin/git",
    shellGitPath: "/opt/homebrew/bin/git",
    effectiveGitPath: "/usr/bin/git",
    sshAvailable: true,
    userName: "Writer",
    userEmail: "writer@example.com",
    userNameSource: "file:/Users/writer/.gitconfig",
    userEmailSource: "file:/Users/writer/.gitconfig",
    commonSshKeyExists: true,
    sshPublicKeyPath: "/Users/writer/.ssh/id_ed25519.pub",
    sshPublicKeyType: "ssh-ed25519",
    sshPublicKeyComment: "writer@example.com",
    sshPublicKeyFingerprint: "SHA256:abc",
    installHint: null,
    ...overrides,
  }
}

describe("GitModule repository list", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    bridge.git.checkEnvironment.mockResolvedValue(gitEnvironment())
    bridge.git.listRepositories.mockResolvedValue([])
    bridge.git.listRepositorySummaries.mockResolvedValue([])
    bridge.git.configureIdentity.mockResolvedValue(undefined)
    bridge.git.getSshPublicKey.mockResolvedValue(null)
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

  it("uses centered system app tabs and repository actions", async () => {
    await renderGitModule(roots)

    const toolbar = document.querySelector("[data-system-app-window-toolbar]")
    expect(toolbar).toBeTruthy()
    expect(toolbar?.className).toContain("grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)]")
    expect(document.querySelector("[data-system-app-window-left-spacer]")).toBeTruthy()
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("仓库")
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("环境")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("添加本地仓库")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).toContain("克隆仓库")
  })

  it("separates Git environment from the repository list tab", async () => {
    await renderGitModule(roots)

    expect(document.body.textContent).toContain("暂无仓库")
    expect(document.body.textContent).not.toContain("Git 环境")

    await click(findButton("环境"))

    expect(document.body.textContent).toContain("Git 环境")
    expect(document.querySelector("[data-system-app-window-actions]")?.textContent).not.toContain("克隆仓库")
  })

  it("shows environment diagnostics and repository issues", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, {
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      }),
      summary({ id: "repo-2", name: "Missing", localPath: "/work/missing", addedAt: "now", lastOpenedAt: null }, { pathExists: false }),
    ])
    await renderGitModule(roots)

    await click(findButton("环境"))

    expect(document.body.textContent).toContain("git version 2.50.0")
    expect(document.body.textContent).toContain("/usr/bin/git")
    expect(document.body.textContent).toContain("/Users/writer/.gitconfig")
    expect(document.body.textContent).toContain("/Users/writer/.ssh/id_ed25519.pub")
    expect(document.body.textContent).toContain("Docs：1 个改动。")
    expect(document.body.textContent).toContain("Missing：目录不可访问。")
    expect(document.body.textContent).toContain("/work/docs")
  })

  it("copies visible Git diagnostics", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, { ahead: 1 }),
    ])
    await renderGitModule(roots)

    await click(findButton("环境"))
    await click(findButton("复制诊断信息"))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Git 环境诊断"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("writer@example.com"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/work/docs"))
    expect(document.body.textContent).toContain("已复制诊断信息。")
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

  it("configures missing Git identity after confirmation", async () => {
    bridge.git.checkEnvironment
      .mockResolvedValueOnce(gitEnvironment({
        userName: null,
        userEmail: null,
        commonSshKeyExists: false,
        sshPublicKeyPath: null,
        sshPublicKeyType: null,
        sshPublicKeyComment: null,
        sshPublicKeyFingerprint: null,
      }))
      .mockResolvedValueOnce(gitEnvironment({
        userName: "Writer",
        userEmail: "writer@example.com",
        commonSshKeyExists: false,
        sshPublicKeyPath: null,
        sshPublicKeyType: null,
        sshPublicKeyComment: null,
        sshPublicKeyFingerprint: null,
      }))
    await renderGitModule(roots)

    await click(findButton("环境"))
    await changeInput("用户名", "Writer")
    await changeInput("邮箱", "writer@example.com")
    await click(findButton("保存身份"))
    await click(findButton("保存"))

    expect(bridge.git.configureIdentity).toHaveBeenCalledWith({
      userName: "Writer",
      userEmail: "writer@example.com",
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
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, { ahead: 1, behind: 1 }),
      summary({ id: "repo-2", name: "App", localPath: "/work/app", addedAt: "now", lastOpenedAt: null }, { ahead: 1, behind: 1 }),
    ])
    bridge.git.sync.mockReturnValue(sync.promise)
    await renderGitModule(roots)

    const syncButtons = exactButtonsByLabel("同步")
    expect(syncButtons).toHaveLength(2)
    expect(countButtons("进入")).toBe(2)

    await click(syncButtons[0])

    expect(bridge.git.sync).toHaveBeenCalledWith("repo-1")
    expect(syncButtons[0].disabled).toBe(true)
    expect(syncButtons[0].querySelector(".animate-spin")).not.toBeNull()
    expect(syncButtons[1].disabled).toBe(false)
    expect(syncButtons[1].querySelector(".animate-spin")).toBeNull()

    sync.resolve()
    await flush()
  })

  it("shows one primary next action for common repository states", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Dirty", localPath: "/work/dirty", addedAt: "now", lastOpenedAt: null }, {
        changes: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      }),
      summary({ id: "repo-2", name: "Behind", localPath: "/work/behind", addedAt: "now", lastOpenedAt: null }, { behind: 2 }),
      summary({ id: "repo-3", name: "Ahead", localPath: "/work/ahead", addedAt: "now", lastOpenedAt: null }, { ahead: 1 }),
      summary({ id: "repo-4", name: "Diverged", localPath: "/work/diverged", addedAt: "now", lastOpenedAt: null }, { ahead: 1, behind: 1 }),
      summary({ id: "repo-5", name: "Missing", localPath: "/work/missing", addedAt: "now", lastOpenedAt: null }, { pathExists: false }),
    ])

    await renderGitModule(roots)

    expect(countButtons("提交改动")).toBe(1)
    expect(countButtons("拉取远程更新")).toBe(1)
    expect(countButtons("推送本地提交")).toBe(1)
    expect(exactButtonsByLabel("同步")).toHaveLength(1)
    expect(countButtons("查看状态")).toBe(1)
  })

  it("keeps secondary repository operations in the more menu", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }, { ahead: 1 }),
    ])
    await renderGitModule(roots)

    await click(findButtonByName("Docs 更多操作"))

    expect(findMenuItem("拉取")).toBeTruthy()
    expect(findMenuItem("推送")).toBeTruthy()
    expect(findMenuItem("同步")).toBeTruthy()
    expect(findMenuItem("移除仓库")).toBeTruthy()
  })

  it("removes repository records without trashing local files by default", async () => {
    bridge.git.listRepositorySummaries
      .mockResolvedValueOnce([
        summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }),
      ])
      .mockResolvedValueOnce([])
    bridge.git.removeRepository.mockResolvedValue(undefined)
    await renderGitModule(roots)

    await click(findButtonByName("Docs 更多操作"))
    await click(findMenuItem("移除仓库"))
    const removalDialogText = document.body.textContent ?? ""
    expect(removalDialogText).toContain("删除 Git 仓库？")
    expect(removalDialogText).toContain("仅移除列表记录")
    expect(removalDialogText).toContain("目录：/work/docs")
    expect(removalDialogText.indexOf("目录：/work/docs")).toBeLessThan(
      removalDialogText.indexOf("仅移除列表记录"),
    )

    await click(findButton("删除记录"))

    expect(bridge.git.removeRepository).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      mode: "keep-local",
    })
    expect(bridge.git.listRepositorySummaries).toHaveBeenCalledTimes(2)
  })

  it("trashes local files when selected and keeps the dialog open on failure", async () => {
    bridge.git.listRepositorySummaries.mockResolvedValue([
      summary({ id: "repo-1", name: "Docs", localPath: "/work/docs", addedAt: "now", lastOpenedAt: null }),
    ])
    bridge.git.removeRepository.mockRejectedValue(new Error("移到废纸篓失败"))
    await renderGitModule(roots)

    await click(findButtonByName("Docs 更多操作"))
    await click(findMenuItem("移除仓库"))
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
    const PointerEventCtor = window.PointerEvent ?? window.MouseEvent
    element.dispatchEvent(new PointerEventCtor("pointerdown", { bubbles: true, cancelable: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }))
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

function findButtonByName(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((item): item is HTMLButtonElement => (
      item instanceof HTMLButtonElement
      && (item.textContent?.includes(label) || item.getAttribute("aria-label") === label)
    ))

  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function findMenuItem(label: string): HTMLElement {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((element) => element.textContent?.includes(label))

  if (!(item instanceof HTMLElement)) {
    throw new Error(`Menu item not found: ${label}`)
  }

  return item
}

function countButtons(label: string): number {
  return buttonsByLabel(label).length
}

function buttonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && Boolean(item.textContent?.includes(label)))
}

function exactButtonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((item): item is HTMLButtonElement => item instanceof HTMLButtonElement && item.textContent === label)
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
