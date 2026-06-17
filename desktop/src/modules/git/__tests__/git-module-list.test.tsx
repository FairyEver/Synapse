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
  })

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })

  it("shows empty state actions", async () => {
    await renderGitModule(roots)

    expect(findButton("克隆仓库")).toBeTruthy()
    expect(findButton("添加本地仓库")).toBeTruthy()
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
  const button = Array.from(document.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(label))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
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

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
  descriptor?.set?.call(input, value)
}
