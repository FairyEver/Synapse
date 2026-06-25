/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAccountState } from "@/types/account"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

const mocks = vi.hoisted(() => ({
  accountState: { status: "unauthenticated" } as SynapseAccountState,
  loadEditors: vi.fn(),
  prepare: vi.fn(),
  recordComplete: vi.fn(),
  resolve: vi.fn(),
  resolveEditorInstallTarget: vi.fn(),
  installSourceToEditor: vi.fn(),
  startLogin: vi.fn(),
}))

const editor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["skill", "rule"],
}

vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: mocks.accountState,
    startLogin: mocks.startLogin,
  }),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [],
      },
    },
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/app-shell/content-store-install", () => ({
  prepareContentStoreInstallPackage: mocks.prepare,
  recordContentStoreInstallComplete: mocks.recordComplete,
  resolveContentStoreInstallSession: mocks.resolve,
}))

vi.mock("@/app-shell/content", () => ({
  resolveEditorInstallTarget: mocks.resolveEditorInstallTarget,
}))

vi.mock("@/app-shell/installers", () => ({
  installSourceToEditor: mocks.installSourceToEditor,
}))

vi.mock("@/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    error: null,
    filteredAdapters: [editor],
    isLoading: false,
    load: mocks.loadEditors,
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { ContentStoreInstallWindowPage } from "../content-store-install-window-page"

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  mocks.accountState = { status: "unauthenticated" }
  vi.clearAllMocks()
})

describe("ContentStoreInstallWindowPage", () => {
  it("prepares the package, renders the installer flow, and records completion", async () => {
    mocks.resolve.mockResolvedValue({
      status: "ready",
      session: {
        id: "session-1",
        contentId: "content-1",
        versionId: "version-1",
        type: "skill",
        title: "Store Skill",
        packageSha256: "a".repeat(64),
        expiresAt: "2026-06-10T00:00:00.000Z",
      },
    })
    mocks.prepare.mockResolvedValue({
      status: "prepared",
      source: {
        id: "prepared-1",
        contentId: "content-1",
        versionId: "version-1",
        type: "skill",
        title: "Store Skill",
        mainFile: "content/SKILL.md",
        mainContent: "# Store Skill\n",
        files: [{ path: "content/SKILL.md", size: 14, kind: "text" }],
      },
    })
    mocks.recordComplete.mockResolvedValue({ ok: true })
    mocks.resolveEditorInstallTarget.mockResolvedValue({
      editorId: "codex",
      label: "Codex",
      scope: "global",
      contentType: "skill",
      message: null,
      status: "ready",
      targetKind: "directory",
      targetPath: "/tmp/skills/store-skill",
      targetExists: false,
    })
    mocks.installSourceToEditor.mockResolvedValue({
      editorId: "codex",
      label: "Codex",
      scope: "global",
      contentType: "skill",
      contentId: "content-1",
      targetKind: "directory",
      targetPath: "/tmp/skills/store-skill",
    })

    await renderPage()

    expect(document.body.textContent).toContain("选择编辑器")
    expect(document.body.textContent).toContain("Codex")

    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("目标位置")

    await act(async () => {
      clickButton("安装")
      await Promise.resolve()
    })

    expect(mocks.recordComplete).toHaveBeenCalledWith("session-1")
    expect(document.body.textContent).toContain("已安装")
  })

  it("continues preparing the install package after browser login completes", async () => {
    mocks.resolve
      .mockResolvedValueOnce({ status: "unauthenticated" })
      .mockResolvedValueOnce({
        status: "ready",
        session: {
          id: "session-1",
          contentId: "content-1",
          versionId: "version-1",
          type: "skill",
          title: "Store Skill",
          packageSha256: "a".repeat(64),
          expiresAt: "2026-06-10T00:00:00.000Z",
        },
      })
    mocks.prepare.mockResolvedValue({
      status: "prepared",
      source: {
        id: "prepared-1",
        contentId: "content-1",
        versionId: "version-1",
        type: "skill",
        title: "Store Skill",
        mainFile: "content/SKILL.md",
        mainContent: "# Store Skill\n",
        files: [{ path: "content/SKILL.md", size: 14, kind: "text" }],
      },
    })
    mocks.startLogin.mockResolvedValue({ status: "authenticating", loginUrl: "https://auth.example/login" })

    const root = await renderPage()

    expect(document.body.textContent).toContain("需要登录")

    await act(async () => {
      clickButton("登录")
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.startLogin).toHaveBeenCalledTimes(1)
    expect(mocks.prepare).not.toHaveBeenCalled()

    mocks.accountState = {
      status: "authenticated",
      connectivity: "online",
      profile: {
        syncedAt: "2026-06-10T00:00:00.000Z",
        teams: [],
        user: {
          displayName: "User",
          email: "user@example.com",
          id: "user-1",
          status: "active",
        },
      },
    }
    await rerenderPage(root)

    expect(mocks.prepare).toHaveBeenCalledWith("session-1")
    expect(document.body.textContent).toContain("选择编辑器")
  })
})

async function renderPage(): Promise<Root> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<ContentStoreInstallWindowPage request={{ session: "session-1" }} />)
    await Promise.resolve()
  })
  return root
}

async function rerenderPage(root: Root) {
  await act(async () => {
    root.render(<ContentStoreInstallWindowPage request={{ session: "session-1" }} />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === text)
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}
