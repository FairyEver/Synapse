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
    listRepositorySummaries: vi.fn(),
    cloneRepository: vi.fn(),
    addLocalRepository: vi.fn(),
  },
  settings: {
    repository: {
      chooseDirectory: vi.fn(),
    },
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => bridge,
  requireSynapseBridge: () => bridge,
}))

describe("GitModule dialogs", () => {
  const roots: Root[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    bridge.git.checkEnvironment.mockResolvedValue({
      checkedAt: "2026-06-18T10:00:00.000Z",
      platform: "darwin",
      homeDir: "/Users/writer",
      gitAvailable: true,
      gitVersion: "git version 2.50.0",
      gitPath: "/usr/bin/git",
      processPath: "/usr/bin",
      shellPath: "/usr/bin",
      effectivePath: "/usr/bin",
      processGitPath: "/usr/bin/git",
      shellGitPath: "/usr/bin/git",
      effectiveGitPath: "/usr/bin/git",
      sshAvailable: true,
      userName: "Writer",
      userEmail: "writer@example.com",
      userNameSource: "file:/Users/writer/.gitconfig",
      userEmailSource: "file:/Users/writer/.gitconfig",
      commonSshKeyExists: false,
      sshPublicKeyPath: null,
      sshPublicKeyType: null,
      sshPublicKeyComment: null,
      sshPublicKeyFingerprint: null,
      installHint: null,
    })
    bridge.git.listRepositorySummaries.mockResolvedValue([])
    bridge.git.cloneRepository.mockRejectedValue(new Error("目标目录已存在。"))
    bridge.git.addLocalRepository.mockRejectedValue(new Error("仓库登记失败。"))
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
      await flush()
    })
  })

  it("shows clone submit failures inside the open dialog", async () => {
    await renderGitModule(roots)

    await click(findButton("克隆仓库"))
    await changeInput("仓库地址", "https://git.example.com/team/docs.git")
    await changeInput("父目录", "/work")
    await click(findDialogButton("开始克隆"))

    expect(findDialogText()).toContain("目标目录已存在。")
    expect(findDialogText()).toContain("开始克隆")
  })

  it("shows add-local submit failures inside the open dialog", async () => {
    bridge.settings.repository.chooseDirectory.mockResolvedValue("/work/docs")

    await renderGitModule(roots)

    await click(findButton("添加本地仓库"))
    await click(findDialogButton("选择文件夹"))
    await changeInput("仓库名称", "docs")
    await click(findDialogButton("添加"))

    expect(findDialogText()).toContain("仓库登记失败。")
    expect(findDialogText()).toContain("添加")
  })
})

async function renderGitModule(roots: Root[]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<GitModule />)
    await flush()
  })
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function findDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error("Dialog not found")
  return dialog
}

function findDialogText(): string {
  return findDialog().textContent ?? ""
}

function findDialogButton(label: string): HTMLButtonElement {
  const button = Array.from(findDialog().querySelectorAll("button")).find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`Dialog button not found: ${label}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await flush()
  })
}

async function changeInput(label: string, value: string) {
  const input = Array.from(document.querySelectorAll("input")).find((item) => {
    const id = item.getAttribute("id")
    return id ? document.querySelector(`label[for="${id}"]`)?.textContent === label : false
  })
  if (!input) throw new Error(`Input not found: ${label}`)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await flush()
  })
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
