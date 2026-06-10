/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseEditorAdapterSummary } from "@/types/editor"

const mocks = vi.hoisted(() => ({
  loadEditors: vi.fn(),
  prepare: vi.fn(),
  recordComplete: vi.fn(),
  resolve: vi.fn(),
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

vi.mock("@/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    error: null,
    filteredAdapters: [editor],
    isLoading: false,
    load: mocks.loadEditors,
  }),
}))

vi.mock("@/modules/content/components/content-install-dialog", () => ({
  ContentInstallDialog: ({
    initialContent,
    onInstalled,
    open,
    preparedSourceId,
  }: {
    initialContent?: string | null
    onInstalled?: () => Promise<void> | void
    open: boolean
    preparedSourceId?: string
  }) => open ? (
    <div>
      <span>{`dialog:${preparedSourceId}:${initialContent}`}</span>
      <button
        type="button"
        onClick={() => {
          void onInstalled?.()
        }}
      >
        完成安装
      </button>
    </div>
  ) : null,
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
  vi.clearAllMocks()
})

describe("ContentStoreInstallWindowPage", () => {
  it("prepares the package, opens the existing install dialog, and records completion", async () => {
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

    await renderPage()

    expect(document.body.textContent).toContain("选择编辑器")

    await act(async () => {
      clickButton("Codex")
    })

    expect(document.body.textContent).toContain("dialog:prepared-1:# Store Skill")

    await act(async () => {
      clickButton("完成安装")
      await Promise.resolve()
    })

    expect(mocks.recordComplete).toHaveBeenCalledWith("session-1")
    expect(document.body.textContent).toContain("已安装")
  })

  it("shows login action when the session cannot be resolved for the current account", async () => {
    mocks.resolve
      .mockResolvedValueOnce({ status: "unauthenticated" })
      .mockResolvedValueOnce({ status: "unauthenticated" })
    mocks.startLogin.mockResolvedValue({ status: "authenticated" })

    await renderPage()

    expect(document.body.textContent).toContain("需要登录")

    await act(async () => {
      clickButton("登录")
      await Promise.resolve()
    })

    expect(mocks.startLogin).toHaveBeenCalledTimes(1)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})

async function renderPage() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<ContentStoreInstallWindowPage request={{ session: "session-1" }} />)
    await Promise.resolve()
  })
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === text)
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}
