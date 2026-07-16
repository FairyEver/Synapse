/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseEditorAdapterSummary } from "../../../../src/types/editor"

const codexEditor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["skill"],
}

const claudeEditor: SynapseEditorAdapterSummary = {
  id: "claude" as SynapseEditorAdapterSummary["id"],
  label: "Claude Code",
  order: 2,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["skill"],
}

const preparedSource = {
  kind: "skill",
  origin: "prepared",
  sourceIdentity: "synapse-skill",
  name: "synapse-skill",
  title: "Synapse Skill",
  description: "Synapse MCP 使用指南",
  preparedSourceId: "synapse-skill:/tmp/source",
  mainContent: "# Synapse Skill",
  sourceFingerprint: "sha256:current",
} as const

const synapseSkillBridge = vi.hoisted(() => ({
  prepareInstallSource: vi.fn(async () => ({
    kind: "skill",
    origin: "prepared",
    sourceIdentity: "synapse-skill",
    name: "synapse-skill",
    title: "Synapse Skill",
    description: "Synapse MCP 使用指南",
    preparedSourceId: "synapse-skill:/tmp/source",
    mainContent: "# Synapse Skill",
    sourceFingerprint: "sha256:current",
  })),
}))

const installSourceToEditorTargets = vi.hoisted(() => vi.fn(async () => ({
  results: [{
    target: { editorId: "codex", scope: "global" },
    status: "installed",
  }],
})))
const loadEditors = vi.hoisted(() => vi.fn(async () => undefined))
const inspectGlobalSkillInstallations = vi.hoisted(() => vi.fn(async () => ({
  entries: [
    {
      editorId: "codex",
      editorLabel: "Codex",
      scope: "global",
      status: "not_installed",
      targetPath: "/Users/test/.agents/skills/synapse-skill",
      message: null,
    },
  ],
})))
const showItemInFolder = vi.hoisted(() => vi.fn(async () => undefined))
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
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

vi.mock("@/app-shell/installers", () => ({
  inspectGlobalSkillInstallations,
  installSourceToEditorTargets,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/components/editor-icon", () => ({
  EditorIcon: ({ editorId }: { editorId: string }) => <span data-editor-icon={editorId} />,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "synapseSkill") return synapseSkillBridge
    if (domain === "shell") return { showItemInFolder }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    filteredAdapters: [codexEditor, claudeEditor],
    isLoading: false,
    error: null,
    load: loadEditors,
  }),
}))

vi.mock("@/modules/installers/shared/shared-installer-flow", () => ({
  SharedInstallerFlow: ({
    initialEditor,
    initialSelection,
    onInstalled,
    source,
  }: {
    initialEditor?: SynapseEditorAdapterSummary | null
    initialSelection?: { scope: string } | null
    onInstalled: () => Promise<void> | void
    source: typeof preparedSource
  }) => (
    <div data-testid="installer-flow">
      {source.name}:{initialEditor?.id ?? "none"}:{initialSelection?.scope}
      <button type="button" onClick={() => void onInstalled()}>模拟安装成功</button>
    </div>
  ),
}))

vi.mock("sonner", () => ({
  toast,
}))

import { SynapseSkillModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  synapseSkillBridge.prepareInstallSource.mockClear()
  installSourceToEditorTargets.mockClear()
  loadEditors.mockClear()
  inspectGlobalSkillInstallations.mockClear()
  showItemInFolder.mockClear()
  toast.error.mockClear()
  toast.success.mockClear()
  toast.warning.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("SynapseSkillModule", () => {
  it("shows global editor install status", async () => {
    await renderModule()

    expect(loadEditors).toHaveBeenCalled()
    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalledTimes(1)
    expect(inspectGlobalSkillInstallations).toHaveBeenCalledTimes(1)
    expect(inspectGlobalSkillInstallations).toHaveBeenCalledWith(preparedSource)
    expect(document.body.textContent).toContain("全局安装状态")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).not.toContain("未安装")
    expect(document.body.textContent).toContain("/Users/test/.agents/skills/synapse-skill")
  })

  it("opens the single editor installer flow for missing targets", async () => {
    await renderModule()

    await clickButton("安装")

    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalled()
    expect(document.body.textContent).toContain("synapse-skill:codex:global")
  })

  it("shows only a direct reinstall action for installed targets", async () => {
    const installedResult = {
      entries: [
        {
          editorId: "codex",
          editorLabel: "Codex",
          scope: "global",
          status: "installed",
          targetPath: "/Users/test/.agents/skills/synapse-skill",
          message: null,
        },
      ],
    }
    inspectGlobalSkillInstallations.mockResolvedValueOnce(installedResult)
    await renderModule()

    expect(document.body.textContent).not.toContain("已安装")
    expect(document.body.querySelector('[aria-label="Codex 更多操作"]')).toBeNull()

    await clickButton("重新安装")

    expect(document.body.textContent).toContain("synapse-skill:codex:global")
  })

  it("summarizes conflicting targets as requiring action", async () => {
    const conflictResult = {
      entries: [
        {
          editorId: "codex",
          editorLabel: "Codex",
          scope: "global",
          status: "conflict",
          targetPath: "/Users/test/.agents/skills/synapse-skill",
          message: "目标已被其它内容占用",
        },
      ],
    }
    inspectGlobalSkillInstallations.mockResolvedValueOnce(conflictResult)

    await renderModule()

    expect(document.body.textContent).toContain("1 个需处理")
    expect(document.body.textContent).not.toContain("无需操作")
    expect(document.body.textContent).toContain("处理")
  })

  it("disables installation when the packaged source cannot be loaded", async () => {
    synapseSkillBridge.prepareInstallSource.mockRejectedValueOnce(new Error("安装源损坏"))

    await renderModule()

    expect(document.body.textContent).toContain("安装源不可用")
    expect(document.body.textContent).not.toContain("无需操作")
    const installButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "安装")
    expect(installButton?.disabled).toBe(true)
  })

  it("opens an editor Skill directory from the path row", async () => {
    await renderModule()

    await clickButtonContaining("/Users/test/.agents/skills/synapse-skill")

    expect(showItemInFolder).toHaveBeenCalledWith("/Users/test/.agents/skills/synapse-skill")
  })

  it("opens the standard installer flow from the footer install action", async () => {
    await renderModule()

    await clickLastButton("安装")

    expect(synapseSkillBridge.prepareInstallSource).toHaveBeenCalled()
    expect(document.body.textContent).toContain("synapse-skill:none:global")
  })

  it("installs missing global targets in one batch", async () => {
    await renderModule()

    await clickButton("安装缺失项")

    expect(installSourceToEditorTargets).toHaveBeenCalledWith(expect.objectContaining({
      mode: "install",
      targets: [{ editorId: "codex", scope: "global" }],
    }))
  })

  it("splits mixed install and update targets into correctly audited modes", async () => {
    const mixedResult = {
      entries: [
        {
          editorId: "codex",
          editorLabel: "Codex",
          scope: "global",
          status: "needs_update",
          targetPath: "/Users/test/.agents/skills/synapse-skill",
          message: null,
        },
        {
          editorId: "claude",
          editorLabel: "Claude Code",
          scope: "global",
          status: "not_installed",
          targetPath: "/Users/test/.claude/skills/synapse-skill",
          message: null,
        },
      ],
    }
    inspectGlobalSkillInstallations
      .mockResolvedValueOnce(mixedResult)
      .mockResolvedValueOnce(mixedResult)
    installSourceToEditorTargets
      .mockResolvedValueOnce({
        results: [{ target: { editorId: "claude", scope: "global" }, status: "installed" }],
      })
      .mockResolvedValueOnce({
        results: [{ target: { editorId: "codex", scope: "global" }, status: "installed" }],
      })

    await renderModule()
    await clickButton("安装并更新")

    expect(installSourceToEditorTargets).toHaveBeenNthCalledWith(1, expect.objectContaining({
      mode: "install",
      targets: [{ editorId: "claude", scope: "global" }],
    }))
    expect(installSourceToEditorTargets).toHaveBeenNthCalledWith(2, expect.objectContaining({
      mode: "update",
      targets: [{ editorId: "codex", scope: "global" }],
    }))
  })

  it("shows failed batch targets and allows retry", async () => {
    installSourceToEditorTargets
      .mockResolvedValueOnce({
        results: [{
          target: { editorId: "codex", scope: "global" },
          status: "failed",
          error: "目标目录不可写",
        }],
      })
      .mockResolvedValueOnce({
        results: [{
          target: { editorId: "codex", scope: "global" },
          status: "installed",
        }],
      })
    await renderModule()

    await clickButton("安装缺失项")

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("目标目录不可写")
    })

    await clickButton("安装缺失项")

    expect(installSourceToEditorTargets).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain("目标目录不可写")
    })
  })

  it("prioritizes partial failure when a batch also returns a warning", async () => {
    installSourceToEditorTargets.mockResolvedValueOnce({
      results: [
        {
          target: { editorId: "codex", scope: "global" },
          status: "installed",
          result: { warning: "旧目录需要人工检查" },
        },
        {
          target: { editorId: "cursor", scope: "global" },
          status: "failed",
          error: "目标目录不可写",
        },
      ],
    })
    await renderModule()

    await clickButton("安装缺失项")

    expect(toast.warning).toHaveBeenCalledWith("部分安装失败；旧目录需要人工检查")
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("clears a stale batch error after refresh confirms the target is installed", async () => {
    const missingResult = {
      entries: [{
        editorId: "codex",
        editorLabel: "Codex",
        scope: "global",
        status: "not_installed",
        targetPath: "/Users/test/.agents/skills/synapse-skill",
        message: null,
      }],
    }
    const installedResult = {
      entries: [{
        ...missingResult.entries[0],
        status: "installed",
      }],
    }
    inspectGlobalSkillInstallations
      .mockResolvedValueOnce(missingResult)
      .mockResolvedValueOnce(missingResult)
      .mockResolvedValueOnce(installedResult)
    installSourceToEditorTargets.mockResolvedValueOnce({
      results: [{
        target: { editorId: "codex", scope: "global" },
        status: "failed",
        error: "目标目录不可写",
      }],
    })
    await renderModule()

    await clickButton("安装缺失项")
    await vi.waitFor(() => expect(document.body.textContent).toContain("目标目录不可写"))
    await clickButton("刷新")

    await vi.waitFor(() => expect(document.body.textContent).not.toContain("目标目录不可写"))
  })

  it("clears the selected editor batch error after a successful standard install", async () => {
    installSourceToEditorTargets.mockResolvedValueOnce({
      results: [{
        target: { editorId: "codex", scope: "global" },
        status: "failed",
        error: "目标目录不可写",
      }],
    })
    await renderModule()
    await clickButton("安装缺失项")
    await vi.waitFor(() => expect(document.body.textContent).toContain("目标目录不可写"))

    await clickButton("安装")
    await clickButton("模拟安装成功")

    await vi.waitFor(() => expect(document.body.textContent).not.toContain("目标目录不可写"))
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<SynapseSkillModule />)
    await Promise.resolve()
  })
}

async function clickButton(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}

async function clickButtonContaining(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(text))
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}

async function clickLastButton(text: string): Promise<void> {
  const buttons = Array.from(document.body.querySelectorAll("button"))
    .filter((item) => item.textContent === text)
  const button = buttons.at(-1)
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}
